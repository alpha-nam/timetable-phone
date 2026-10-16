'use strict';
/*
 * phone-host.js — 폰에서 PC와 똑같은 TimeTable+ 화면(app.js)을 띄우는 껍데기.
 *
 * PC 앱은 Electron이 데이터 파일(시간표·명단·결보강)을 디스크에서 읽고 구글 연동을 main.js가 한다.
 * 폰에서는 그 역할을 이 파일이 대신한다:
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
  // 토큰이 만료된 뒤 사용자가 화면을 한 번 누르면 조용히 새 토큰을 받는다(너무 자주 시도하지 않게 60초 간격).
  function refreshOnGesture() {
    if (!appStarted || tokenValid() || !CFG.clientId || Date.now() - lastGesture < 60000) return;
    if (!lsGet('tt_everLoggedIn')) return;
    lastGesture = Date.now();
    requestToken('').then(function () { note('', ''); document.dispatchEvent(new Event('tt-token-ok')); }).catch(function () { /* 다음에 다시 */ });
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
        if (b && b.missing) { if (!cached) throw new Error('PC의 TimeTable+에서 먼저 "폰 연동"을 켜 주세요. (시간표 데이터가 아직 드라이브에 없습니다)'); return; }
        if (b) { bundle = b; return idbSet('bundle', b); }
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
        if (!tokenValid()) return Promise.resolve({ ok: false, error: '로그인이 필요합니다. 화면을 한 번 누르거나 "폰 연동"을 누르세요.' });
        return drive.syncAll(local || {}).then(function (result) { return { ok: true, result: result }; })
          .catch(function (e) { return { ok: false, error: e.message }; });
      }
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
    return loadScript('./app.js').then(function () { return loadScript('./swap.js'); }).then(function () {
      document.dispatchEvent(new Event('DOMContentLoaded'));   // app.js는 DOMContentLoaded에서 시작한다(이미 지나갔으니 한 번 더 알려 준다)
      document.dispatchEvent(new Event('tt-phone-ready'));
    });
  }

  // ───────── 시작 화면 ─────────
  function showGate(msg, kind, canLogin) {
    $('phoneGate').hidden = false;
    $('gateMsg').textContent = msg || '';
    $('gateMsg').className = 'gate-msg ' + (kind || '');
    $('gateLogin').hidden = !canLogin;
  }

  function boot() {
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
      else showGate('구글 계정으로 로그인하면 PC의 TimeTable+와 이어집니다.', '', true);
    });
  }

  function enter() {
    showGate('시간표 불러오는 중…', '', false);
    return loadBundle().then(function () {
      if (!bundle) throw new Error('시간표 데이터가 없습니다. PC의 TimeTable+에서 "폰 연동"을 켠 뒤 다시 열어 주세요.');
      return startApp();
    }).catch(function (e) { showGate(e.message, 'err', true); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
