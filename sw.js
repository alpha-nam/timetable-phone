'use strict';
/*
 * sw.js — 폰 화면의 서비스 워커. 앱 화면 파일(HTML·CSS·JS·아이콘)을 기기에 저장해 두었다가
 * 인터넷이 약하거나 끊겨도 앱이 열리게 한다. 데이터(시간표·출결·메모)는 여기서 다루지 않는다
 * (구글 드라이브와 IndexedDB가 맡는다).
 * 원칙: 인터넷이 되면 항상 최신 파일을 받아 오고(그래서 업데이트가 바로 반영된다), 안 될 때만 저장해 둔 것을 쓴다.
 */
var CACHE = 'ttplus-shell-v1';
var SHELL = [
  './', './index.html', './style.css', './phone.css', './app.js', './board.js', './swap.js',
  './drive-sync-core.js', './phone-host.js', './config.js', './manifest.json',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // 하나가 없어도 설치가 깨지지 않게 하나씩 담는다.
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { /* 없는 파일은 건너뜀 */ }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 구글 API·글꼴 등 바깥 요청은 그대로 둔다
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()); });
    })
  );
});
