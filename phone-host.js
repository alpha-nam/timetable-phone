'use strict';
/*
 * phone-host.js — 휴대폰에서 PC와 똑같은 TimeTable+ 화면(app.js)을 띄우는 껍데기.
 *
 * PC 앱은 Electron이 데이터 파일(시간표·명단·결보강)을 디스크에서 읽고 구글 연동을 main.js가 한다.
 * 휴대폰에서는 그 역할을 이 파일이 대신한다:
 *   1) 구글 로그인(GIS 토큰) → 선생님 본인의 드라이브에서 번들(시간표·명단·결보강·API 키)을 내려받아 기기에 보관(IndexedDB)
 *   2) app.js가 부르는 fetch('./dashboard-timetable.json' 등)를 그 번들로 대신 답해 준다
 *   3) app.js가 쓰는 window.TTCLOUD(출결·메모·할 일 동기화)를 브라우저용으로 제공한다
 * 그다음 app.js와 swap.js를 불러오면 PC와 같은 화면이 뜬다. 학생 데이터는 이 페이지 파일에는 들어 있지 않다.
 */
(function () {
  var CFG = window.PHONE_CONFIG || {};
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var BUNDLE_FILES = { 'dashboard-timetable.json': 1, 'class-roster.json': 1, 'swap-data.json': 1 };
  var Core = window.DriveSyncCore;
  var $ = function (id) { return document.getElementById(id); };

  var token = null;        // { value, exp }
  var tokenClient = null;
  var drive = null;
  var bundle = null;       // { hash, files }
  var appStarted = false;
  var lastGesture = 0;

  // ───────── 작은 도구 ─────────
  function lsGet(k) { try { var v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } }
  function tokenValid() { return !!(token && token.exp > Date.now() + 60000); }
  function note(msg, kind) {
    var el = $('phoneNote');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'phone-note' + (msg ? ' show ' + (kind || '') : '');
  }

  // ───────── 기기에 보관(IndexedDB): 번들은 1MB가 넘어서 localStorage 대신 쓴다 ─────────
  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('tt-phone', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function idbSet(key, val) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    }).catch(function () { /* 보관 실패는 무시(다음에 다시 내려받음) */ });
  }

  // ───────── 구글 로그인(토큰 1시간) ─────────
  function loadGis() {
    return new Promise(function (resolve, reject) {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인하세요.')); };
      document.head.appendChild(s);
    });
  }
  // 반드시 사용자가 화면을 누른 그 순간에 불러야 한다(팝업 차단 방지).
  function requestToken(prompt) {
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CFG.clientId, scope: SCOPE, callback: function () {} });
        tokenClient.callback = function (r) {
          if (r.error) return reject(new Error('로그인이 취소되었거나 실패했습니다.'));
          token = { value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
          lsSet('tt_token', token);
          resolve();
        };
        tokenClient.error_callback = function () { reject(new Error('로그인 창이 닫혔습니다.')); };
        tokenClient.requestAccessToken({ prompt: prompt || '' });
      });
    });
  }
  // 로그인(출입증)은 1시간짜리라서, 화면을 누를 때마다 "곧 만료(10분 안)이거나 이미 만료"인지 보고 조용히 새로 받는다
  // (너무 자주 시도하지 않게 60초 간격). 쓰는 동안에는 만료되지 않게 이어 가고, 새로 받으면 바로 동기화를 다시 시작한다.
  function refreshOnGesture() {
    if (!appStarted || !CFG.clientId || Date.now() - lastGesture < 60000) return;
    var left = token ? token.exp - Date.now() : -1;
    if (left > 10 * 60 * 1000) return;
    if (!lsGet('tt_everLoggedIn')) return;
    lastGesture = Date.now();
    requestToken('').then(function () {
      note('', ''); document.dispatchEvent(new Event('tt-token-ok'));
      window.dispatchEvent(new Event('ttcloud-changed'));   // 앱이 연결 상태를 다시 읽고 바로 동기화한다
    }).catch(function () { /* 다음에 다시 */ });
  }

  function getToken() {
    if (!tokenValid()) return Promise.reject(new Error('로그인이 필요합니다.'));
    return Promise.resolve(token.value);
  }
  function makeDrive() { drive = Core.createDrive({ fetch: function (u, o) { return fetch(u, o); }, getToken: getToken, apiBase: CFG.apiBase }); }   // apiBase는 시험용 가짜 서버 주소(평소엔 비워 둔다)

  // ───────── 번들 ─────────
  function loadBundle() {
    return idbGet('bundle').then(function (cached) {
      bundle = cached;
      if (!tokenValid()) return;
      return drive.downloadBundle(cached && cached.hash).then(function (b) {
        if (b && b.missing) { if (!cached) throw new Error('PC의 TimeTable+에서 먼저 "휴대폰 연동"을 켜 주세요. (시간표 데이터가 아직 드라이브에 없습니다)'); return; }
        if (b) { bundle = b; return idbSet('bundle', b); }
      }, function (e) {
        // 인터넷이 안 되거나 구글이 일시적으로 안 될 때는, 기기에 저장해 둔 시간표가 있으면 그걸로 연다.
        if (cached) { note('인터넷에 연결되지 않아 저장해 둔 시간표를 보여 줍니다.', 'err'); return; }
        throw e;
      });
    });
  }

  // ───────── app.js가 기대하는 것들을 대신 제공 ─────────
  function installFetchOverride() {
    var realFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var m = /^\.\/([^?#]+)/.exec(url);
      if (m && BUNDLE_FILES[m[1]]) {
        var text = bundle && bundle.files && bundle.files[m[1]];
        if (text == null) return Promise.resolve(new Response('', { status: 404 }));
        return Promise.resolve(new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(input, init);
    };
  }
  function installConfig() {
    var keys = {};
    try { keys = JSON.parse((bundle && bundle.files && bundle.files['keys.json']) || '{}'); } catch (e) { keys = {}; }
    window.DASHBOARD_CONFIG = { kma: keys.kma || {}, neis: keys.neis || {}, timetableFile: './dashboard-timetable.json', myTeacherName: '' };
  }
  function installTTCloud() {
    window.TTCLOUD = {
      status: function () { return Promise.resolve({ configured: !!CFG.clientId, connected: tokenValid() }); },
      connect: function () {
        return requestToken('consent').then(function () { lsSet('tt_everLoggedIn', true); return { ok: true }; })
          .catch(function (e) { return { ok: false, error: e.message }; });
      },
      disconnect: function () {
        if (token && window.google && google.accounts) { try { google.accounts.oauth2.revoke(token.value, function () {}); } catch (e) { /* 무시 */ } }
        token = null; lsSet('tt_token', null); lsSet('tt_everLoggedIn', null); makeDrive();
        return Promise.resolve({ ok: true });
      },
      sync: function (local) {
        if (!tokenValid()) return Promise.resolve({ ok: false, error: '로그인이 필요합니다. 화면을 한 번 누르거나 "휴대폰 연동"을 누르세요.' });
        return drive.syncAll(local || {}).then(function (result) {
          // 하루 한 번 전체 사본을 드라이브에 남긴다(실패해도 동기화는 성공으로 본다).
          var snap = {};
          Object.keys(result).forEach(function (k) { snap[k] = result[k].records; });
          return drive.backupDaily(snap).catch(function () { /* 다음 동기화 때 다시 */ }).then(function () { return { ok: true, result: result }; });
        }).catch(function (e) { return { ok: false, error: e.message }; });
      },
      backups: function () {
        if (!tokenValid()) return Promise.resolve({ ok: false, error: '로그인이 필요합니다.' });
        return drive.listBackups().then(function (list) { return { ok: true, list: list }; }).catch(function (e) { return { ok: false, error: e.message }; });
      },
      readBackup: function (id) {
        if (!tokenValid()) return Promise.resolve({ ok: false, error: '로그인이 필요합니다.' });
        return drive.readBackup(id).then(function (data) { return { ok: true, data: data }; }).catch(function (e) { return { ok: false, error: e.message }; });
      },
      localBackups: function () { return Promise.resolve({ ok: true, list: [] }); },
      readLocalBackup: function () { return Promise.resolve({ ok: false, error: '휴대폰에는 PC 백업 파일이 없습니다.' }); }
    };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error(src + ' 로드 실패')); };
      document.body.appendChild(s);
    });
  }
  function startApp() {
    if (appStarted) return;
    appStarted = true;
    installFetchOverride(); installConfig(); installTTCloud();
    // 로그인 직후이거나 토큰이 아직 유효할 때는 곧바로 연동 상태로 시작한다.
    $('phoneGate').hidden = true;
    return loadScript('./app.js').then(function () { return loadScript('./board.js'); }).then(function () { return loadScript('./swap.js'); }).then(function () { return loadScript('./subject.js'); }).then(function () {
      document.dispatchEvent(new Event('DOMContentLoaded'));   // app.js는 DOMContentLoaded에서 시작한다(이미 지나갔으니 한 번 더 알려 준다)
      document.dispatchEvent(new Event('tt-phone-ready'));
      showInstallBanner();
      initSyncStatus();
    });
  }

  // ───────── 시작 화면 ─────────
  function showGate(msg, kind, canLogin) {
    $('phoneGate').hidden = false;
    $('gateMsg').textContent = msg || '';
    $('gateMsg').className = 'gate-msg ' + (kind || '');
    $('gateLogin').hidden = !canLogin;
  }

  // ───────── 접근성: 앱 안 브라우저 막기, 홈 화면 설치 안내, 오프라인 준비 ─────────
  var APP_URL = location.origin + location.pathname.replace(/[^/]*$/, '');

  // 카카오톡·네이버·다음 앱 안에서 열린 링크는 "앱 안 브라우저(웹뷰)"라서 구글이 로그인을 막는다. 그럴 때는 크롬·사파리 등으로 다시 열도록 안내한다.
  function inAppBrowserName() {
    var ua = navigator.userAgent || '';
    if (/KAKAOTALK/i.test(ua)) return '카카오톡';
    if (/NAVER\(inapp/i.test(ua)) return '네이버 앱';
    if (/DaumApps/i.test(ua)) return '다음 앱';
    if (/FBAN|FBAV/i.test(ua)) return '페이스북';
    if (/Instagram/i.test(ua)) return '인스타그램';
    if (/\bLine\//i.test(ua)) return '라인';
    if (/Android/i.test(ua) && /; wv\)/.test(ua)) return '앱 안 브라우저';
    return '';
  }
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return false; });
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* 복사 불가 */ }
    ta.remove(); return Promise.resolve(ok);
  }
  function showInAppNotice(name) {
    var isAndroid = /Android/i.test(navigator.userAgent);
    var o = document.createElement('div'); o.id = 'phoneInApp'; o.className = 'phone-inapp';
    var box = document.createElement('div'); box.className = 'phone-inapp-box';
    var h = document.createElement('h2'); h.textContent = name + ' 안에서는 구글 로그인이 안 돼요';
    var p = document.createElement('p');
    p.textContent = (isAndroid || name === '카카오톡') ? '아래 버튼으로\n크롬(또는 기본 브라우저)에서 다시 열어 주세요.'
      : '화면 위·아래의 공유 또는 ⋯ 버튼을 누르고\n"Safari로 열기"(또는 "다른 브라우저로 열기")를\n선택해 주세요.';
    box.appendChild(h); box.appendChild(p);
    if (name === '카카오톡') {
      // 카카오톡은 intent:// 링크를 막고, 자체 주소로만 바깥 브라우저를 열어 준다(안드로이드·아이폰 공통).
      var kk = document.createElement('a'); kk.className = 'phone-btn'; kk.textContent = isAndroid ? '크롬(기본 브라우저)으로 열기' : '사파리로 열기';
      kk.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(APP_URL);
      box.appendChild(kk);
    } else if (isAndroid) {
      var chrome = document.createElement('a'); chrome.className = 'phone-btn'; chrome.textContent = '크롬으로 열기';
      chrome.href = 'intent://' + APP_URL.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end';
      box.appendChild(chrome);
    }
    var cp = document.createElement('button'); cp.type = 'button'; cp.className = 'phone-btn ghost'; cp.textContent = '주소 복사';
    cp.addEventListener('click', function () { copyText(APP_URL).then(function (ok) { cp.textContent = ok ? '복사했어요. 브라우저에 붙여넣으세요' : APP_URL; }); });
    box.appendChild(cp);
    var url = document.createElement('div'); url.className = 'phone-inapp-url'; url.textContent = APP_URL;
    box.appendChild(url);
    o.appendChild(box);
    document.body.appendChild(o);
  }

  // 홈 화면 설치: 안드로이드 크롬 등은 설치 버튼이 뜨고, 아이폰은 방법 안내만 가능하다.
  var installEvent = null;
  function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
  function initInstall() {
    if (isStandalone()) return;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); installEvent = e;
      var b = $('gateInstall'); if (b) b.hidden = false;
      if (appStarted) showInstallBanner();
    });
    window.addEventListener('appinstalled', function () { installEvent = null; var b = $('gateInstall'); if (b) b.hidden = true; var bn = $('phoneInstallBanner'); if (bn) bn.remove(); });
    var gi = $('gateInstall');
    if (gi) gi.addEventListener('click', function () { doInstall(); });
    var help = $('gateInstallHelp'); if (help) help.hidden = false;
  }
  function doInstall() { if (!installEvent) return; installEvent.prompt(); installEvent.userChoice.then(function () { installEvent = null; var bn = $('phoneInstallBanner'); if (bn) bn.remove(); }); }
  function showInstallBanner() {
    if (!installEvent || lsGet('tt_installDismissed') || $('phoneInstallBanner')) return;
    var bn = document.createElement('div'); bn.id = 'phoneInstallBanner'; bn.className = 'phone-install-banner';
    var t = document.createElement('span'); t.textContent = '홈 화면에 설치하면 앱처럼 열려요';
    var go = document.createElement('button'); go.type = 'button'; go.textContent = '설치'; go.addEventListener('click', doInstall);
    var x = document.createElement('button'); x.type = 'button'; x.className = 'ghost'; x.textContent = '닫기';
    x.addEventListener('click', function () { lsSet('tt_installDismissed', true); bn.remove(); });
    bn.appendChild(t); bn.appendChild(go); bn.appendChild(x);
    document.body.appendChild(bn);
  }
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    navigator.serviceWorker.register('./sw.js').catch(function () { /* 오프라인 준비는 없어도 앱은 동작한다 */ });
  }

  // ───────── 동기화 상태 표시 ─────────
  // 휴대폰에는 설정 창이 없어서, 오른쪽 아래 작은 알약으로 상태를 보여 주고 누르면 자세히(지금 동기화·다시 로그인·로그아웃)를 연다.
  function initSyncStatus() {
    if ($('phoneSync')) return;
    var pill = document.createElement('button'); pill.type = 'button'; pill.id = 'phoneSync'; pill.className = 'phone-sync';
    var sheet = document.createElement('div'); sheet.id = 'phoneSyncSheet'; sheet.className = 'phone-sync-sheet'; sheet.hidden = true;
    document.body.appendChild(pill); document.body.appendChild(sheet);
    function st() { return document.documentElement.getAttribute('data-cloud-state') || (tokenValid() ? 'ok' : 'off'); }
    function ago() {
      var t = Number(document.documentElement.getAttribute('data-cloud-last')) || 0;
      if (!t) return '';
      var m = Math.round((Date.now() - t) / 60000);
      return m < 1 ? '방금 동기화됨' : m < 60 ? m + '분 전 동기화됨' : '오래 전 동기화됨';
    }
    function paint() {
      var s0 = st();
      var label = s0 === 'ok' ? '동기화됨' : s0 === 'busy' ? '동기화 중' : s0 === 'err' ? '오류' : '로그인 필요';
      pill.className = 'phone-sync phone-sync--' + s0;
      pill.innerHTML = '<i></i><span></span>'; pill.lastChild.textContent = label;
      if (!sheet.hidden) fillSheet();
    }
    function btn(text, cls, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'phone-btn' + (cls ? ' ' + cls : ''); b.textContent = text; b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); }); return b; }
    function fillSheet() {
      sheet.innerHTML = '';
      var s0 = st();
      var t = document.createElement('div'); t.className = 'phone-sync-title';
      t.textContent = s0 === 'ok' ? '구글 드라이브와 동기화 중' : s0 === 'busy' ? '동기화하는 중…' : s0 === 'err' ? '동기화 오류' : '로그인이 필요해요';
      var d = document.createElement('div'); d.className = 'phone-sync-detail';
      d.textContent = s0 === 'err' ? (document.documentElement.getAttribute('data-cloud-error') || '') : s0 === 'off' ? '로그인은 1시간마다 풀려요. 다시 로그인하면 바로 이어집니다.' : ago();
      sheet.appendChild(t); if (d.textContent) sheet.appendChild(d);
      var row = document.createElement('div'); row.className = 'phone-sync-btns';
      if (s0 === 'off') {
        row.appendChild(btn('다시 로그인', '', function () {
          requestToken('consent').then(function () { lsSet('tt_everLoggedIn', true); sheet.hidden = true; window.dispatchEvent(new Event('ttcloud-changed')); })
            .catch(function (e) { d.textContent = e.message; if (!d.parentNode) sheet.insertBefore(d, row); });
        }));
      } else {
        row.appendChild(btn('지금 동기화', '', function () { if (window.TTAPP && window.TTAPP.syncNow) window.TTAPP.syncNow(); sheet.hidden = true; }));
      }
      row.appendChild(btn('로그아웃', 'ghost', function () {
        if (!window.confirm('로그아웃할까요? 이 휴대폰에서 연동이 끊기고, 다시 쓰려면 로그인해야 해요.')) return;
        window.TTCLOUD.disconnect().then(function () { location.reload(); });
      }));
      sheet.appendChild(row);
    }
    pill.addEventListener('click', function (ev) { ev.stopPropagation(); sheet.hidden = !sheet.hidden; if (!sheet.hidden) fillSheet(); });
    document.addEventListener('click', function (ev) { if (!sheet.hidden && !sheet.contains(ev.target)) sheet.hidden = true; });
    window.addEventListener('ttcloud-state', paint);
    setInterval(paint, 30000);
    paint();
  }

  function boot() {
    var inApp = inAppBrowserName();
    if (inApp) { showInAppNotice(inApp); $('phoneGate').hidden = true; return; }
    registerWorker();
    initInstall();
    document.addEventListener('pointerdown', refreshOnGesture, true);
    $('gateLogin').addEventListener('click', function () {
      showGate('로그인 중…', '', false);
      requestToken('consent').then(function () { lsSet('tt_everLoggedIn', true); return enter(); })
        .catch(function (e) { showGate(e.message, 'err', true); });
    });
    if (!CFG.clientId) { showGate('아직 구글 연동 설정(clientId)이 안 되어 있습니다.', 'err', false); return; }

    token = lsGet('tt_token');
    makeDrive();
    if (tokenValid()) { enter(); return; }
    // 토큰이 만료됐어도 기기에 보관한 데이터가 있으면 일단 그걸로 연다(동기화만 로그인 후에).
    idbGet('bundle').then(function (cached) {
      if (cached && lsGet('tt_everLoggedIn')) { bundle = cached; startApp(); }
      else showGate('구글 계정으로 로그인하면\nPC의 TimeTable+와 이어집니다.', '', true);
    });
  }

  function enter() {
    showGate('시간표 불러오는 중…', '', false);
    return loadBundle().then(function () {
      if (!bundle) throw new Error('시간표 데이터가 없습니다. PC의 TimeTable+에서 "휴대폰 연동"을 켠 뒤 다시 열어 주세요.');
      return startApp();
    }).catch(function (e) { showGate(e.message, 'err', true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
