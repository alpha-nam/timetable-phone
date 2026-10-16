'use strict';
/*
 * drive-sync-core.js — PC 앱(Node)과 폰 앱(브라우저)이 같이 쓰는 구글 드라이브 동기화 핵심.
 * 로그인(토큰 얻기)은 각자 하고, 여기서는 "토큰이 주어졌을 때 파일 읽기·쓰기와 합치기"만 한다.
 *
 * 드라이브에 만드는 파일(모두 이 앱이 만든 파일, 권한 drive.file):
 *  - TimeTablePlus-attendance.json : { records:[출결 기록] }                 폰·PC가 같이 읽고 씀
 *  - TimeTablePlus-notes.json      : { memo:[메모 카드], sections:[섹션], dayTasks:[날짜별 할 일], trash:[휴지통], prefs:[설정(학기 시작일 등)], subj:[교과 출결] } 폰·PC가 같이 읽고 씀
 *  - TimeTablePlus-backup-YYYYMMDD.json : 하루 한 번 남기는 전체 사본(최근 14개만 보관)
 *  - TimeTablePlus-bundle.json     : { hash, files:{...} } 시간표·명단·결보강·API 키 — PC가 올리고 폰이 읽음
 *  - TimeTablePlus-meta.json       : { hash, updatedAt } 번들이 바뀌었는지 가볍게 확인하는 용도
 * 기록마다 id·updatedAt이 있고 삭제는 deleted:true 표시로 남긴다. 합치는 규칙: 같은 id면 updatedAt이 큰 쪽이 이긴다(같으면 원격 우선).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DriveSyncCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var FILES = {
    attendance: 'TimeTablePlus-attendance.json',
    notes: 'TimeTablePlus-notes.json',
    bundle: 'TimeTablePlus-bundle.json',
    meta: 'TimeTablePlus-meta.json'
  };
  var TOMBSTONE_KEEP_MS = 90 * 24 * 3600 * 1000;
  var NOTE_LISTS = ['memo', 'sections', 'dayTasks', 'trash', 'prefs', 'subj'];
  var BACKUP_PREFIX = 'TimeTablePlus-backup-';

  function mergeEntries(a, b) {
    var byId = new Map();
    [a, b].forEach(function (list, idx) {
      (list || []).forEach(function (e) {
        if (!e || !e.id) return;
        var cur = byId.get(e.id);
        var t = Number(e.updatedAt) || 0;
        var ct = cur ? Number(cur.updatedAt) || 0 : -1;
        if (!cur || t > ct || (t === ct && idx === 1)) byId.set(e.id, e);   // 같은 시각이면 b(원격) 우선
      });
    });
    return Array.from(byId.values());
  }

  // 로컬 기록 + 삭제 표시(tombstones: {id: 삭제시각})를 한 목록으로 만든다.
  function withTombstones(records, tombstones) {
    return (records || []).map(function (r) { return Object.assign({}, r, { updatedAt: Number(r.updatedAt) || 0 }); })
      .concat(Object.keys(tombstones || {}).map(function (id) { return { id: id, deleted: true, updatedAt: Number(tombstones[id]) || 0 }; }));
  }
  function split(merged) {
    var records = merged.filter(function (e) { return !e.deleted; });
    var tombstones = {};
    merged.filter(function (e) { return e.deleted; }).forEach(function (e) { tombstones[e.id] = e.updatedAt; });
    return { records: records, tombstones: tombstones };
  }
  function norm(list) { return JSON.stringify((list || []).slice().sort(function (x, y) { return x.id < y.id ? -1 : 1; })); }

  // deps: { fetch, getToken(): Promise<string>, apiBase, uploadBase, now }
  function createDrive(deps) {
    var f = deps.fetch;
    var apiBase = deps.apiBase || 'https://www.googleapis.com';
    var uploadBase = deps.uploadBase || apiBase;
    var now = deps.now || function () { return Date.now(); };
    var ids = {};

    function api(method, url, opts) {
      opts = opts || {};
      return deps.getToken().then(function (token) {
        var init = { method: method, headers: Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {}) };
        if (opts.body !== undefined) init.body = opts.body;
        return f(url, init);
      }).then(function (res) {
        if (res.ok) return res;
        return res.text().then(function (t) {
          var e = new Error('구글 드라이브 오류(' + res.status + ') ' + String(t).slice(0, 120));
          e.status = res.status;
          throw e;
        }, function () { var e = new Error('구글 드라이브 오류(' + res.status + ')'); e.status = res.status; throw e; });
      });
    }
    function findFile(name) {
      if (ids[name]) return Promise.resolve(ids[name]);
      var q = "name='" + name + "' and trashed=false";
      return api('GET', apiBase + '/drive/v3/files?spaces=drive&fields=files(id,name)&q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var hit = (j.files || [])[0];
          if (hit) ids[name] = hit.id;
          return hit ? hit.id : null;
        });
    }
    function readJson(id) {
      return api('GET', apiBase + '/drive/v3/files/' + id + '?alt=media').then(function (r) { return r.json(); }).catch(function (e) {
        if (e && e.status) throw e;
        return null;   // 내용이 비었거나 JSON이 아님
      });
    }
    function createJson(name, obj) {
      var boundary = 'tt' + Math.random().toString(16).slice(2) + now().toString(16);
      var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: name, mimeType: 'application/json' })
        + '\r\n--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(obj) + '\r\n--' + boundary + '--';
      return api('POST', uploadBase + '/upload/drive/v3/files?uploadType=multipart&fields=id', { headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body })
        .then(function (r) { return r.json(); }).then(function (j) { ids[name] = j.id; return j.id; });
    }
    function updateJson(id, obj) {
      return api('PATCH', uploadBase + '/upload/drive/v3/files/' + id + '?uploadType=media', { headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(obj) });
    }
    function writeJson(name, obj) {
      return findFile(name).then(function (id) { return id ? updateJson(id, obj) : createJson(name, obj); });
    }
    function readByName(name) { return findFile(name).then(function (id) { return id ? readJson(id) : null; }); }
    // 출결·메모 파일 전용: 파일이 아직 없으면 null(새로 만들면 됨), 있는데 읽지 못하면 오류로 멈춘다.
    // (읽지 못한 걸 "비어 있음"으로 착각해 덮어쓰면 드라이브에 있던 기록이 사라질 수 있어서)
    function readListDoc(name) {
      return findFile(name).then(function (id) {
        if (!id) return null;
        return readJson(id).then(function (doc) {
          if (!doc || typeof doc !== 'object') throw new Error('드라이브의 ' + name + ' 파일을 읽지 못해 동기화를 멈췄습니다(데이터 보호). 잠시 뒤 다시 시도해 보세요.');
          return doc;
        });
      });
    }

    // 한 묶음(예: 출결 기록)을 드라이브와 합친다. 원격이 바뀐 경우에만 다시 쓴다.
    // key: 파일 안에서 배열을 담는 이름, local: { records, tombstones }
    function syncList(fileName, key, local, remoteDoc) {
      var remoteEntries = remoteDoc && Array.isArray(remoteDoc[key]) ? remoteDoc[key] : [];
      var cutoff = now() - TOMBSTONE_KEEP_MS;
      var merged = mergeEntries(withTombstones(local.records, local.tombstones), remoteEntries)
        .filter(function (e) { return !(e.deleted && (Number(e.updatedAt) || 0) < cutoff); });
      return { merged: merged, changed: norm(merged) !== norm(remoteEntries) };
    }

    // local: { attendance:{records,tombstones}, memo:{...}, dayTasks:{...} } (없는 묶음은 건너뜀)
    // 돌려주는 값: 같은 모양으로 합쳐진 { attendance, memo, dayTasks } (각 {records(삭제 제외), tombstones})
    function syncAll(local) {
      local = local || {};
      var out = {};
      var tasks = [];

      if (local.attendance) {
        tasks.push(readListDoc(FILES.attendance).then(function (doc) {
          var r = syncList(FILES.attendance, 'records', local.attendance, doc);
          out.attendance = split(r.merged);
          return (doc && !r.changed) ? null : writeJson(FILES.attendance, { version: 1, records: r.merged });
        }));
      }
      // 메모 카드(memo)·섹션(sections)·날짜별 할 일(dayTasks)·휴지통(trash)은 notes 파일 하나에 같이 저장한다.
      if (NOTE_LISTS.some(function (k) { return local[k]; })) {
        tasks.push(readListDoc(FILES.notes).then(function (doc) {
          var changed = false, doc2 = { version: 1 };
          NOTE_LISTS.forEach(function (k) {
            if (local[k]) {
              var r = syncList(FILES.notes, k, local[k], doc);
              out[k] = split(r.merged);
              doc2[k] = r.merged;
              if (r.changed) changed = true;
            } else {
              doc2[k] = (doc && doc[k]) || [];   // 이번에 안 보낸 묶음은 원격 값을 그대로 보존한다
            }
          });
          return (doc && !changed) ? null : writeJson(FILES.notes, doc2);
        }));
      }
      return Promise.all(tasks).then(function () { return out; });
    }

    // ── 하루 한 번 백업: 오늘 날짜 백업 파일이 없으면 지금 합쳐진 상태를 새 파일로 남기고, 최근 keep개만 둔다 ──
    function dateKey() {
      var d = new Date(now());
      return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    }
    function listBackups() {
      var q = "name contains '" + BACKUP_PREFIX + "' and trashed=false";
      return api('GET', apiBase + '/drive/v3/files?spaces=drive&pageSize=100&fields=files(id,name)&q=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (j) {
          return (j.files || []).map(function (f) { var m = /(\d{8})\.json$/.exec(f.name); return m ? { id: f.id, name: f.name, date: m[1] } : null; })
            .filter(Boolean).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        });
    }
    function pruneBackups(keep) {
      return listBackups().then(function (list) {
        return Promise.all(list.slice(keep).map(function (b) { return api('DELETE', apiBase + '/drive/v3/files/' + b.id); }));
      });
    }
    function backupDaily(snapshot, keep) {
      var name = BACKUP_PREFIX + dateKey() + '.json';
      return findFile(name).then(function (id) {
        if (id) return false;
        return createJson(name, Object.assign({ version: 1, createdAt: now() }, snapshot))
          .then(function () { return pruneBackups(keep || 14); }).then(function () { return true; });
      });
    }
    function readBackup(id) {
      return readJson(id).then(function (doc) {
        if (!doc || typeof doc !== 'object') throw new Error('백업 파일을 읽지 못했습니다.');
        return doc;
      });
    }

    // 시간표·명단·결보강·키 묶음(PC가 올림). hash가 같으면 다시 올리지 않는다.
    function uploadBundle(bundle) {
      return readByName(FILES.meta).then(function (meta) {
        if (meta && meta.hash === bundle.hash) return false;
        return writeJson(FILES.bundle, bundle).then(function () { return writeJson(FILES.meta, { hash: bundle.hash, updatedAt: now() }); }).then(function () { return true; });
      });
    }
    // 폰이 쓴다: 캐시한 hash와 같으면 내려받지 않는다. 돌려주는 값: 새 번들 또는 null(변경 없음)
    function downloadBundle(cachedHash) {
      return readByName(FILES.meta).then(function (meta) {
        if (!meta) return { missing: true };
        if (cachedHash && meta.hash === cachedHash) return null;
        return readByName(FILES.bundle).then(function (b) { return b || { missing: true }; });
      });
    }

    return { findFile: findFile, readByName: readByName, writeJson: writeJson, syncAll: syncAll, uploadBundle: uploadBundle, downloadBundle: downloadBundle, backupDaily: backupDaily, listBackups: listBackups, readBackup: readBackup };
  }

  return { FILES: FILES, mergeEntries: mergeEntries, withTombstones: withTombstones, split: split, createDrive: createDrive, TOMBSTONE_KEEP_MS: TOMBSTONE_KEEP_MS };
});
