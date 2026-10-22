/*
 * app.js — 데이터 연동 + 렌더링. 화면 구조(index.html)와 색(style.css)은 안 건드림.
 */
(function () {
  'use strict';

  var CONFIG = window.DASHBOARD_CONFIG;

  // ── 공통 유틸 ──
  function pad2(n) {
    return String(n).padStart(2, '0');
  }
  function ymd(d) {
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }
  function dayLabel(n) {
    return ['일', '월', '화', '수', '목', '금', '토'][n];
  }
  function $(id) {
    return document.getElementById(id);
  }

  // ── 설정(테마 색상 variation + 화면 해상도) ──
  // 다크 모드는 사용자가 별로라고 해서 뺐다 — 라이트 톤 하나만 쓰고, 그 안에서 강조색만 다른
  // variation 4가지(하늘/민트/피치/라벤더) 중 고르게 했다. "혼합모드(자동)"도 요청으로 뺐다.
  var VARIANT_KEY = 'dashboardVariant';
  var RESOLUTION_KEY = 'dashboardResolution';

  function applyVariant(variant) {
    // <html>에 붙인다(#board가 아니라) — 배율(줌)로 #board를 축소했을 때 그 바깥 여백도
    // 같은 배경색을 칠할 수 있어야 해서, 테마 토큰을 html까지 물려줄 수 있는 위치로 올림.
    document.documentElement.setAttribute('data-variant', variant);
    document.querySelectorAll('.swatch').forEach(function (b) {
      b.classList.toggle('active', b.dataset.variant === variant);
    });
    try { localStorage.setItem(VARIANT_KEY, variant); } catch (e) {}
  }

  // 실제 모니터 해상도(예: 2560x1080 울트라와이드)를 직접 고를 수 있게 한 설정 — Lively가 보고하는
  // 창 크기가 실제 화면과 다를 때(디스플레이 배율 등) 레이아웃을 그 해상도 기준으로 다시 맞추기
  // 위해, #board를 해당 해상도 픽셀 크기로 고정한 뒤 실제 창 크기에 맞게 scale()로 늘려 채운다.
  // 버그였던 부분: 원래 가로/세로를 따로(scale(x,y)) 늘렸는데, 그러면 실제 화면 비율이 고른
  // 해상도와 다를 때(듀얼모니터 울트라와이드용 해상도를 노트북 16:9 화면에 그대로 적용하는 등)
  // 가로세로가 다르게 늘어나 내용이 찌그러졌다 — "화면 비율이 안 맞는다"던 피드백의 원인.
  // 가로/세로 중 더 작은 비율 하나로 통일해서 늘리도록(= 비율 유지, letterbox) 고침. 여기에
  // 더해 "설정에서 크기를 직접 조절하고 싶다"는 요청으로 별도 확대/축소 배율(줌)을 곱해서
  // 최종 배율을 낸다 — 해상도를 몰라도 그냥 줌만으로 맞출 수 있게.
  var ZOOM_KEY = 'dashboardZoom';
  var OFFSET_X_KEY = 'dashboardOffsetX';
  var OFFSET_Y_KEY = 'dashboardOffsetY';
  var currentResolution = 'auto';
  var currentZoom = 100;
  var currentOffsetX = 0;
  var currentOffsetY = 0;

  // translate를 scale보다 앞에 써서(transform 함수는 뒤에서부터 적용되므로 translate가
  // "이미 배율 적용된 뒤" 화면 좌표계에서 그대로 px만큼 움직임 — 배율을 몇 %로 하든 위치
  // 이동량이 항상 같은 화면 픽셀 단위로 예측 가능하게).
  function applyTransform() {
    var board = $('board');
    var zoomFactor = currentZoom / 100;
    var fitScale = 1;
    if (currentResolution && currentResolution !== 'auto') {
      var parts = currentResolution.split('x');
      var w = +parts[0], h = +parts[1];
      fitScale = Math.min(window.innerWidth / w, window.innerHeight / h);
      board.style.width = w + 'px';
      board.style.height = h + 'px';
    } else {
      board.style.width = '';
      board.style.height = '';
    }
    var finalScale = fitScale * zoomFactor;
    board.style.transformOrigin = 'top left';
    var t = 'translate(' + currentOffsetX + 'px,' + currentOffsetY + 'px) scale(' + finalScale + ')';
    board.style.transform = (finalScale === 1 && currentOffsetX === 0 && currentOffsetY === 0) ? '' : t;
  }

  function applyResolutionChoice(value) {
    currentResolution = value;
    try { localStorage.setItem(RESOLUTION_KEY, value); } catch (e) {}
    document.querySelectorAll('.res-option').forEach(function (b) {
      b.classList.toggle('active', b.dataset.resolution === value);
    });
    applyTransform();
  }

  function applyZoom(percent) {
    currentZoom = percent;
    $('zoomValue').textContent = percent + '%';
    applyTransform();
  }

  function applyOffset(x, y) {
    currentOffsetX = x;
    currentOffsetY = y;
    $('offsetXValue').textContent = x + 'px';
    $('offsetYValue').textContent = y + 'px';
    applyTransform();
  }

  // ── 화면 모드(노트북용 / 듀얼모니터용) ── 같은 카드를 창 크기에 따라 다르게 배치한다. 자동일 땐
  // 창 가로가 LAPTOP_MAX_WIDTH(CSS px)보다 좁으면 노트북용. 실제 배치는 style.css의
  // html[data-mode="laptop"] 규칙이 하고, 여기선 그 속성만 바꾼다.
  var MODE_KEY = 'dashboardScreenMode';
  var LAPTOP_MAX_WIDTH = 1500;
  var currentModeChoice = 'auto';

  function effectiveMode() {
    if (currentModeChoice === 'laptop' || currentModeChoice === 'wide') return currentModeChoice;
    return window.innerWidth < LAPTOP_MAX_WIDTH ? 'laptop' : 'wide';
  }

  function applyScreenMode(choice, persist) {
    currentModeChoice = choice;
    document.documentElement.setAttribute('data-mode', effectiveMode());
    document.querySelectorAll('.mode-option').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === choice);
    });
    if (persist) { try { localStorage.setItem(MODE_KEY, choice); } catch (e) {} }
    applyLayoutSizes();
    refitVisibleCards();
  }

  function initSettings() {
    var savedMode = 'auto';
    try { savedMode = localStorage.getItem(MODE_KEY) || 'auto'; } catch (e) {}
    document.documentElement.setAttribute('data-mode', savedMode === 'laptop' || savedMode === 'wide' ? savedMode : (window.innerWidth < LAPTOP_MAX_WIDTH ? 'laptop' : 'wide'));
    currentModeChoice = savedMode;
    document.querySelectorAll('.mode-option').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === savedMode);
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        applyScreenMode(b.dataset.mode, true);
      });
    });

    var savedVariant = 'sky';
    try { savedVariant = localStorage.getItem(VARIANT_KEY) || 'sky'; } catch (e) {}
    applyVariant(savedVariant);

    var savedResolution = 'auto';
    try { savedResolution = localStorage.getItem(RESOLUTION_KEY) || 'auto'; } catch (e) {}
    applyResolutionChoice(savedResolution);

    var savedZoom = 100;
    try { savedZoom = +(localStorage.getItem(ZOOM_KEY)) || 100; } catch (e) {}
    $('zoomSlider').value = savedZoom;

    var savedOffsetX = 0, savedOffsetY = 0;
    try { savedOffsetX = +(localStorage.getItem(OFFSET_X_KEY)) || 0; } catch (e) {}
    try { savedOffsetY = +(localStorage.getItem(OFFSET_Y_KEY)) || 0; } catch (e) {}
    $('offsetXSlider').value = savedOffsetX;
    $('offsetYSlider').value = savedOffsetY;

    // 배율 하나가 두 값(줌·오프셋)을 다 같이 적용해야 해서 순서 상관없이 마지막에 한 번만
    // applyTransform이 불리도록, 상태만 먼저 세팅해두고 마지막에 같이 반영한다.
    currentZoom = savedZoom; $('zoomValue').textContent = savedZoom + '%';
    currentOffsetX = savedOffsetX; $('offsetXValue').textContent = savedOffsetX + 'px';
    currentOffsetY = savedOffsetY; $('offsetYValue').textContent = savedOffsetY + 'px';
    applyTransform();

    $('zoomSlider').addEventListener('input', function () {
      var v = +this.value;
      applyZoom(v);
      try { localStorage.setItem(ZOOM_KEY, String(v)); } catch (e) {}
    });
    $('offsetXSlider').addEventListener('input', function () {
      applyOffset(+this.value, currentOffsetY);
      try { localStorage.setItem(OFFSET_X_KEY, this.value); } catch (e) {}
    });
    $('offsetYSlider').addEventListener('input', function () {
      applyOffset(currentOffsetX, +this.value);
      try { localStorage.setItem(OFFSET_Y_KEY, this.value); } catch (e) {}
    });
    $('offsetResetBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      $('offsetXSlider').value = 0;
      $('offsetYSlider').value = 0;
      applyOffset(0, 0);
      try { localStorage.setItem(OFFSET_X_KEY, '0'); localStorage.setItem(OFFSET_Y_KEY, '0'); } catch (e) {}
    });
    window.addEventListener('resize', function () {
      if (currentModeChoice === 'auto') document.documentElement.setAttribute('data-mode', effectiveMode());
      applyTransform(); applyLayoutSizes(); refitVisibleCards();
    });

    $('backupExportBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      exportBackup();
    });
    $('backupImportBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      $('backupFileInput').click();
    });
    $('backupFileInput').addEventListener('click', function (ev) { ev.stopPropagation(); });
    $('backupFileInput').addEventListener('change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (file) importBackup(file);
      ev.target.value = '';
    });

    document.querySelectorAll('.swatch').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        applyVariant(b.dataset.variant);
      });
    });

    var btn = $('settingsBtn');
    var panel = $('settingsPanel');
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
    });
    panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('click', function () {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    });

    // 네이티브 <select>는 Lively(WebView2)에서 팝업이 열려도 선택이 실제로 반영되지 않는
    // 고질적인 문제가 있어서(시간표 선생님 드롭다운 때 이미 한 번 겪음) 여기도 처음부터
    // 클릭 버튼 목록으로 만들었다 — <select>를 다시 쓰지 말 것.
    document.querySelectorAll('.res-option').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        applyResolutionChoice(b.dataset.resolution);
      });
    });
  }

  // ── 카드 표시 on/off ── 선생님마다 필요한 카드가 달라서(시간표만 쓰거나 급식·날씨만 쓰는 등)
  // 설정에서 카드별로 끄고 켤 수 있게 했다. "꺼진 카드만" 저장한다(기본값=전부 켜짐) — 나중에
  // 카드가 새로 생겨도 기존 저장값이 영향을 주지 않고 자동으로 켜진 채로 나온다. 꺼진 카드는
  // 화면에서만 숨기는 게 아니라 날씨·급식·학사일정 같은 외부 API 호출도 같이 멈춘다(같은 키를
  // 여러 선생님이 나눠 쓰는 하루 호출 한도를 아끼려고).
  var HIDDEN_CARDS_KEY = 'dashboardHiddenCards';
  var ALL_CARD_IDS = ['clockCard', 'weatherCard', 'eventsCard', 'mealCard', 'timetableCard', 'calendarCard'];
  var hiddenCards = {};

  function isCardOn(id) { return !hiddenCards[id]; }

  function loadHiddenCards() {
    hiddenCards = {};
    try {
      var saved = JSON.parse(localStorage.getItem(HIDDEN_CARDS_KEY) || '{}');
      if (saved && typeof saved === 'object') {
        ALL_CARD_IDS.forEach(function (id) { if (saved[id]) hiddenCards[id] = true; });
      }
    } catch (e) {}
  }

  function saveHiddenCards() {
    try { localStorage.setItem(HIDDEN_CARDS_KEY, JSON.stringify(hiddenCards)); } catch (e) {}
  }

  // 끈 카드는 "자리는 그대로 두고 카드만(배경까지) 사라지게" 한다 — 남은 카드가 빈자리를 채우며
  // 커지거나 움직이지 않고, 크기·위치가 전부 그대로다(display:none이 아니라 visibility:hidden).
  function applyCardLayout() {
    document.querySelectorAll('.card-toggle').forEach(function (b) {
      var on = isCardOn(b.dataset.card);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    ALL_CARD_IDS.forEach(function (id) {
      $(id).classList.toggle('card-off', !isCardOn(id));
    });
  }

  // 카드를 다시 켠 직후 — 숨겨져 있는 동안 갱신이 멈춰 있었으니 그 카드만 바로 다시 채운다.
  var CARD_REFRESH = {
    clockCard: function () { renderClock(); },
    weatherCard: function () { fetchWeather(); },
    eventsCard: function () { fetchSchoolEvents(); },
    mealCard: function () { fetchMeal(); },
    timetableCard: function () { renderWeeklyTimetable(); },
    calendarCard: function () { renderCalendar(); }
  };

  // 숨겨진 카드는 크기가 0이라 자동 글자 축소(fit*)를 돌리면 의미 없는 결과가 나오므로 켜진 것만.
  function refitVisibleCards() {
    if (isCardOn('clockCard')) fitClockFont();
    if (isCardOn('weatherCard')) fitWeatherFont();
    if (isCardOn('timetableCard')) fitTimetableFont();
  }

  function initCardToggles() {
    loadHiddenCards();
    applyCardLayout();
    document.querySelectorAll('.card-toggle').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var id = b.dataset.card;
        var turningOn = !isCardOn(id);
        if (turningOn) delete hiddenCards[id]; else hiddenCards[id] = true;
        saveHiddenCards();
        applyCardLayout();
        if (turningOn && CARD_REFRESH[id]) CARD_REFRESH[id]();
        refitVisibleCards();
      });
    });
  }

  // ── 카드 크기 조절(경계 드래그) ── 카드 사이 16px 빈틈에 투명한 손잡이를 얹고, 끌면 양옆 카드의
  // 크기가 바뀐다. 손잡이 5개: col(왼쪽 묶음↔캘린더), r1(윗줄↔아랫줄), r2(아랫줄↔시간표),
  // s1(시계↔날씨), s2(학사일정↔급식). 값은 기본값과 다를 때만 저장한다(기본값=CSS 그대로).
  // 마우스 이벤트(mousedown + document의 mousemove/mouseup)로 구현 — Lively는 마우스 입력을
  // 페이지로 전달하는 방식이라 pointer capture에 기대지 않는 쪽이 안전하다.
  var LAYOUT_KEY = 'dashboardLayoutSizes';
  var LAYOUT_KEYS = ['col', 'h1', 'h2', 's1', 's2'];
  var GAP = 16, DEFAULT_ROW_H = 158, MIN_ROW_H = 90, MIN_TIMETABLE_H = 150, MIN_SPLIT = 0.25, MAX_SPLIT = 0.75;
  var layoutSizes = {}; // col: 왼쪽 묶음 가로 %(25~75), h1/h2: 윗줄·아랫줄 높이(px), s1/s2: 줄 안 왼쪽 카드 비율(0.25~0.75)
  var handleEls = {};

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function loadLayoutSizes() {
    layoutSizes = {};
    try {
      var saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
      LAYOUT_KEYS.forEach(function (k) {
        if (saved && typeof saved[k] === 'number' && isFinite(saved[k])) layoutSizes[k] = saved[k];
      });
    } catch (e) {}
  }

  function saveLayoutSizes() {
    try {
      if (Object.keys(layoutSizes).length) localStorage.setItem(LAYOUT_KEY, JSON.stringify(layoutSizes));
      else localStorage.removeItem(LAYOUT_KEY);
    } catch (e) {}
  }

  function splitTemplate(s) { return (s * 100) + 'fr ' + ((1 - s) * 100) + 'fr'; }

  function applyLayoutSizes() {
    var bento = document.querySelector('.bento');
    var leftCol = $('leftCol');
    var rows = leftCol.querySelectorAll('.left-row');

    bento.style.gridTemplateColumns = layoutSizes.col != null
      ? layoutSizes.col + 'fr ' + (100 - layoutSizes.col) + 'fr' : '';

    if (layoutSizes.h1 != null || layoutSizes.h2 != null) {
      var h1 = layoutSizes.h1 != null ? layoutSizes.h1 : DEFAULT_ROW_H;
      var h2 = layoutSizes.h2 != null ? layoutSizes.h2 : DEFAULT_ROW_H;
      // 저장된 값이 지금 화면 높이에 비해 너무 크면(작은 모니터로 옮겼을 때 등) 시간표가 찌그러지지
      // 않게 비율로 줄여서만 적용한다(저장값 자체는 건드리지 않음).
      var room = leftCol.offsetHeight - 2 * GAP - MIN_TIMETABLE_H;
      if (h1 + h2 > room) {
        var k = Math.max(room, 2 * MIN_ROW_H) / (h1 + h2);
        h1 = Math.max(MIN_ROW_H, Math.floor(h1 * k));
        h2 = Math.max(MIN_ROW_H, Math.floor(h2 * k));
      }
      leftCol.style.gridTemplateRows = h1 + 'px ' + h2 + 'px 1fr';
    } else {
      leftCol.style.gridTemplateRows = '';
    }

    ['s1', 's2'].forEach(function (key, i) {
      rows[i].style.gridTemplateColumns = layoutSizes[key] != null ? splitTemplate(layoutSizes[key]) : '';
    });
    positionResizeHandles();
  }

  function placeHandle(el, left, top, width, height) {
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.width = width + 'px';
    el.style.height = height + 'px';
  }

  // offset* 값은 화면 배율(transform: scale)의 영향을 안 받는 "레이아웃 픽셀"이라, 손잡이를 같은
  // 좌표계(.bento 안 absolute)에 그대로 놓을 수 있다.
  function positionResizeHandles() {
    if (!handleEls.col) return;
    var bento = document.querySelector('.bento');
    var leftCol = $('leftCol');
    var rows = leftCol.querySelectorAll('.left-row');
    var clock = $('clockCard'), events = $('eventsCard');
    placeHandle(handleEls.col, leftCol.offsetLeft + leftCol.offsetWidth, 0, GAP, bento.offsetHeight);
    placeHandle(handleEls.r1, leftCol.offsetLeft, rows[0].offsetTop + rows[0].offsetHeight, leftCol.offsetWidth, GAP);
    placeHandle(handleEls.r2, leftCol.offsetLeft, rows[1].offsetTop + rows[1].offsetHeight, leftCol.offsetWidth, GAP);
    placeHandle(handleEls.s1, clock.offsetLeft + clock.offsetWidth, rows[0].offsetTop, GAP, rows[0].offsetHeight);
    placeHandle(handleEls.s2, events.offsetLeft + events.offsetWidth, rows[1].offsetTop, GAP, rows[1].offsetHeight);
  }

  function startResize(id, ev) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();

    var bento = document.querySelector('.bento');
    var leftCol = $('leftCol');
    var rows = leftCol.querySelectorAll('.left-row');
    var scale = bento.getBoundingClientRect().width / bento.offsetWidth || 1;
    var startX = ev.clientX, startY = ev.clientY;
    // 드래그 시작 시점의 크기를 한 번만 재고, 이후엔 "시작값 + 이동량"으로만 계산한다(누적 오차 방지).
    var start = {
      leftW: leftCol.offsetWidth,
      h1: rows[0].offsetHeight,
      h2: rows[1].offsetHeight,
      colTotal: bento.offsetWidth - GAP,
      s1LeftW: $('clockCard').offsetWidth, s1Total: rows[0].offsetWidth - GAP,
      s2LeftW: $('eventsCard').offsetWidth, s2Total: rows[1].offsetWidth - GAP,
      leftColH: leftCol.offsetHeight
    };
    var handle = handleEls[id];
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    var refitQueued = false;

    function onMove(e) {
      var dx = (e.clientX - startX) / scale;
      var dy = (e.clientY - startY) / scale;
      if (id === 'col') {
        layoutSizes.col = Math.round(clamp((start.leftW + dx) / start.colTotal * 100, 25, 75) * 10) / 10;
      } else if (id === 'r1') {
        var sum = start.h1 + start.h2;
        var h1 = Math.round(clamp(start.h1 + dy, MIN_ROW_H, sum - MIN_ROW_H));
        layoutSizes.h1 = h1;
        layoutSizes.h2 = sum - h1;
      } else if (id === 'r2') {
        var maxH2 = start.leftColH - 2 * GAP - MIN_TIMETABLE_H - start.h1;
        layoutSizes.h1 = start.h1;
        layoutSizes.h2 = Math.round(clamp(start.h2 + dy, MIN_ROW_H, Math.max(MIN_ROW_H, maxH2)));
      } else if (id === 's1') {
        layoutSizes.s1 = Math.round(clamp((start.s1LeftW + dx) / start.s1Total, MIN_SPLIT, MAX_SPLIT) * 1000) / 1000;
      } else if (id === 's2') {
        layoutSizes.s2 = Math.round(clamp((start.s2LeftW + dx) / start.s2Total, MIN_SPLIT, MAX_SPLIT) * 1000) / 1000;
      }
      applyLayoutSizes();
      if (!refitQueued) {
        refitQueued = true;
        requestAnimationFrame(function () { refitQueued = false; refitVisibleCards(); });
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      saveLayoutSizes();
      refitVisibleCards();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function initLayoutResize() {
    loadLayoutSizes();
    var bento = document.querySelector('.bento');
    [['col', 'x'], ['r1', 'y'], ['r2', 'y'], ['s1', 'x'], ['s2', 'x']].forEach(function (def) {
      var el = document.createElement('div');
      el.className = 'resize-handle resize-handle--' + def[1];
      el.addEventListener('mousedown', function (ev) { startResize(def[0], ev); });
      bento.appendChild(el);
      handleEls[def[0]] = el;
    });
    applyLayoutSizes();
    $('layoutResetBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      layoutSizes = {};
      saveLayoutSizes();
      applyLayoutSizes();
      refitVisibleCards();
    });
  }

  // 시간 칸이 좁아지면(윗줄 비율 조정·화면 배율 축소 등) 큼직한 글자가 카드 밖으로 잘려
  //보였던 문제 — 폰트를 고정 크기로 두는 대신, 실제 렌더된 너비를 재서 부모 칸에 맞을
  // 때까지 1px씩 줄인다("비율에 맞게 자동으로 폰트 크기를 조정" 요청).
  function fitClockFont() {
    var el = $('clockTimeDigits');
    var container = el && el.parentElement;
    if (!el || !container) return;
    var maxFont = 32, minFont = 16;
    el.style.fontSize = maxFont + 'px';
    var fs = maxFont;
    while (fs > minFont && el.scrollWidth > container.clientWidth) {
      fs -= 1;
      el.style.fontSize = fs + 'px';
    }

    // 날짜(2줄)도 극단적으로 좁으면 두 줄로도 모자라 3번째 줄이 line-clamp에 잘릴 수 있다 —
    // 이 경우는 가로(scrollWidth)가 아니라 세로(scrollHeight)로 넘치는지를 봐야 한다(2줄 높이를
    // 넘어서면 그만큼 내용이 잘리고 있다는 뜻).
    var dateEl = $('clockDate');
    if (dateEl) {
      var dateMax = 12, dateMin = 9;
      dateEl.style.fontSize = dateMax + 'px';
      var dfs = dateMax;
      while (dfs > dateMin && dateEl.scrollHeight > dateEl.clientHeight) {
        dfs -= 1;
        dateEl.style.fontSize = dfs + 'px';
      }
    }
  }

  // 날씨 카드도 같은 문제(노트북 등 좁은 화면에서 "32°C"나 요일 타일 숫자가 카드 밖으로 잘림) —
  // 다만 날씨는 크기가 다른 글자 여러 개(큰 기온 + 작은 설명, 요일 타일 안 최고/최저)를 같이
  // 줄여야 해서, fitClockFont()처럼 한 요소를 1px씩 줄이는 대신 "요소 그룹 전체를 같은 비율로"
  // 줄인다(요소마다 원래 크기 비율은 유지하면서). items: [{el, base, min}], container가 더는
  // 안 넘칠 때까지 5%씩 비율을 낮춘다.
  function shrinkGroupToFit(container, items) {
    if (!container) return;
    var ratio = 1;
    items.forEach(function (it) { it.el.style.fontSize = it.base + 'px'; });
    // 컨테이너 자체(container.scrollWidth>clientWidth)만 보면 못 잡는 경우가 있다 — 안전장치로
    // 넣어둔 min-width:0+ellipsis가 있는 요소(예: weatherSub)는 자기 스스로 조용히 말줄임 처리돼
    // 버려서 부모 컨테이너 입장에선 "안 넘친다"고 보인다(실제로는 내용이 잘려서 안 보이는데도).
    // 그래서 그룹 안 요소 하나하나도 자기 자신 기준(el.scrollWidth>el.clientWidth)으로 같이
    // 검사한다 — 이렇게 해야 ellipsis 뒤에 숨어 조용히 잘린 텍스트까지 잡아서 줄일 수 있다.
    function overflowing() {
      if (container.scrollWidth > container.clientWidth) return true;
      return items.some(function (it) { return it.el.scrollWidth > it.el.clientWidth; });
    }
    while (ratio > 0.55 && overflowing()) {
      ratio -= 0.05;
      items.forEach(function (it) {
        it.el.style.fontSize = Math.max(it.min, Math.round(it.base * ratio)) + 'px';
      });
    }
  }

  function fitWeatherFont() {
    var tempEl = $('weatherTemp'), subEl = $('weatherSub');
    var nowRow = tempEl && tempEl.parentElement;
    if (tempEl && subEl && nowRow) {
      shrinkGroupToFit(nowRow, [
        { el: tempEl, base: 34, min: 22 },
        { el: subEl, base: 14, min: 11 }
      ]);
    }
    document.querySelectorAll('.weather-day').forEach(function (tile) {
      var icon = tile.querySelector('.weather-day-icon');
      var hi = tile.querySelector('.weather-day-temp');
      var lo = tile.querySelector('.weather-day-temp-lo');
      if (!icon || !hi || !lo) return;
      shrinkGroupToFit(tile, [
        { el: icon, base: 13, min: 9 },
        { el: hi, base: 12, min: 8 },
        { el: lo, base: 10, min: 7 }
      ]);
    });
  }

  // ── 시계 ── 아날로그를 시도해봤다가("못생겼다") 사용자가 보여준 참고 이미지대로 큼직한
  // 디지털(오전/오후 + 시:분:초) + 작은 회색 날짜 두 줄로 다시 바꿈. 초까지 보여주니 여전히
  // 1초마다 갱신해야 자연스럽다.
  function renderClock() {
    var now = new Date();
    // 칸에 여유가 있으면 "2026년 8월 22일 토요일" 한 줄로, 좁을 때만 자동으로 줄바꿈되게 —
    // \n으로 강제 줄바꿈하는 대신 그냥 띄어쓰기로 이어붙이고 CSS(white-space:normal)가 브라우저
    // 기본 줄바꿈에 맡기게 했다(공간이 있으면 한 줄, 모자라면 자동으로 다음 줄로 넘어감).
    var dateStr = now.getFullYear() + '년 ' + (now.getMonth() + 1) + '월 ' + now.getDate() + '일 ' + dayLabel(now.getDay()) + '요일';
    $('clockDate').textContent = dateStr;

    var h = now.getHours();
    var ampm = h < 12 ? '오전' : '오후';
    var h12 = h % 12;
    if (h12 === 0) h12 = 12;
    $('clockAmpm').textContent = ampm;
    $('clockTimeDigits').textContent = h12 + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
    fitClockFont();

    // 아날로그 시계는 그대로 두고("그거 그대로 놔두라"는 피드백) 참고 이미지 스타일 디지털을
    // 옆에 같이 두는 걸로 — 초침까지 실시간으로 돌아가야 해서 여기서 매초 각도를 다시 계산.
    var hh24 = h % 12, m = now.getMinutes(), s = now.getSeconds();
    var hourDeg = (hh24 + m / 60) * 30;
    var minDeg = (m + s / 60) * 6;
    var secDeg = s * 6;
    $('clockHourHand').style.transform = 'rotate(' + hourDeg + 'deg)';
    $('clockMinHand').style.transform = 'rotate(' + minDeg + 'deg)';
    $('clockSecHand').style.transform = 'rotate(' + secDeg + 'deg)';
  }

  // ── 날씨(기상청 단기예보) ──
  var SKY_LABEL = { '1': '맑음', '3': '구름많음', '4': '흐림' };
  var PTY_LABEL = { '1': '비', '2': '비/눈', '3': '눈', '4': '소나기', '5': '빗방울', '6': '빗방울눈날림', '7': '눈날림' };

  // 단기예보는 02/05/08/11/14/17/20/23시에 발표되고 발표 후 약 10분 뒤부터 조회 가능하다.
  function computeBaseDateTime(now) {
    var d = new Date(now.getTime() - 10 * 60 * 1000);
    var candidates = [23, 20, 17, 14, 11, 8, 5, 2];
    var hh = d.getHours();
    var chosen = candidates.find(function (h) { return h <= hh; });
    var baseDate = d;
    if (chosen === undefined) {
      chosen = 23;
      baseDate = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    }
    return { baseDate: ymd(baseDate), baseTime: pad2(chosen) + '00' };
  }

  // 가장 최근 발표분이 아직 올라오지 않았거나(NO_DATA) 서버가 비어 있는 경우가 있어서,
  // 최신 발표시각부터 한 단계씩 거슬러 올라가며(최대 6개) 데이터가 있는 첫 발표분을 쓴다.
  function baseDateTimeCandidates(now) {
    var hours = [2, 5, 8, 11, 14, 17, 20, 23];
    var d = new Date(now.getTime() - 10 * 60 * 1000);
    var list = [];
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var started = false;
    for (var back = 0; back < 3 && list.length < 6; back++) {
      for (var i = hours.length - 1; i >= 0 && list.length < 6; i--) {
        if (back === 0 && !started) { if (hours[i] > d.getHours()) continue; started = true; }
        list.push({ baseDate: ymd(new Date(day.getTime() - back * 86400000)), baseTime: pad2(hours[i]) + '00' });
      }
    }
    return list;
  }

  var WEATHER_ICON = {
    '맑음': '☀️', '구름많음': '⛅', '흐림': '☁️',
    '비': '🌧️', '비/눈': '🌨️', '눈': '❄️', '소나기': '🌦️',
    '빗방울': '🌦️', '빗방울눈날림': '🌨️', '눈날림': '🌨️'
  };

  function weatherLabel(sky, pty) {
    if (pty && pty !== '0' && PTY_LABEL[pty]) return PTY_LABEL[pty];
    return SKY_LABEL[sky] || '-';
  }

  // 기상청 단기예보(getVilageFcst)는 발표 시각 기준으로 오늘부터 이후 4~5일치 시간대별 예보를
  // 한 번에 준다 — "오늘 날씨뿐 아니라 주간 날씨도" 요청으로, 기존엔 가장 가까운 한 시간대만
  // 골라 썼던 걸 날짜별로 묶어 여러 날을 같이 보여주게 바꿨다. (진짜 7일 중기예보는 기상청의
  // 별도 API(중기예보 조회서비스)로, 이 서비스키는 아직 그 API 사용신청이 안 돼 있어 이번엔
  // 단기예보가 커버하는 범위까지만 "주간"으로 보여준다.)
  function fetchWeather() {
    var kma = CONFIG.kma;
    var cands = baseDateTimeCandidates(new Date());

    function tryAt(i) {
      if (i >= cands.length) return Promise.reject(new Error('날씨 응답 없음'));
      var bt = cands[i];
      var url = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst'
        + '?serviceKey=' + kma.serviceKey
        + '&pageNo=1&numOfRows=1000&dataType=JSON'
        + '&base_date=' + bt.baseDate + '&base_time=' + bt.baseTime
        + '&nx=' + kma.nx + '&ny=' + kma.ny;
      return fetch(url)
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var items = data && data.response && data.response.body && data.response.body.items && data.response.body.items.item;
          if (!items || !items.length) return tryAt(i + 1);
          return items;
        }, function () { return tryAt(i + 1); });
    }

    return tryAt(0)
      .then(function (items) {
        var nowKey = ymd(new Date()) + pad2(new Date().getHours()) + '00';
        var slots = Array.from(new Set(items.map(function (i) { return i.fcstDate + i.fcstTime; }))).sort();
        var slot = slots.find(function (k) { return k >= nowKey; }) || slots[0];

        var byCat = {};
        items.forEach(function (i) {
          if (i.fcstDate + i.fcstTime === slot) byCat[i.category] = i.fcstValue;
        });

        renderWeather({
          temp: byCat.TMP,
          humidity: byCat.REH,
          label: weatherLabel(byCat.SKY, byCat.PTY)
        });

        renderWeatherWeek(buildWeeklyWeather(items));
        fitWeatherFont();
      })
      .catch(function (err) {
        console.error('날씨 갱신 실패:', err);
      });
  }

  function renderWeather(w) {
    $('weatherTemp').textContent = (w.temp != null ? w.temp : '-') + '℃';
    $('weatherSub').textContent = w.label + ' · 습도 ' + (w.humidity != null ? w.humidity : '-') + '%';
  }

  // 날짜별로 묶어서 대표 하늘상태(정오에 가장 가까운 시간대)와 최고/최저기온(TMX/TMN이 있으면
  // 그걸 쓰고, 없는 날(오늘·먼 날짜)은 그 날짜 안의 TMP 값들 중 최댓값/최솟값으로 대신한다)을 뽑는다.
  function buildWeeklyWeather(items) {
    var byDate = {};
    items.forEach(function (i) {
      if (!byDate[i.fcstDate]) byDate[i.fcstDate] = [];
      byDate[i.fcstDate].push(i);
    });
    var todayStr = ymd(new Date());
    return Object.keys(byDate).sort().map(function (dateStr) {
      var rows = byDate[dateStr];
      var tmpVals = rows.filter(function (r) { return r.category === 'TMP'; }).map(function (r) { return +r.fcstValue; });
      var tmn = rows.find(function (r) { return r.category === 'TMN'; });
      var tmx = rows.find(function (r) { return r.category === 'TMX'; });
      var lo = tmn ? +tmn.fcstValue : (tmpVals.length ? Math.min.apply(null, tmpVals) : null);
      var hi = tmx ? +tmx.fcstValue : (tmpVals.length ? Math.max.apply(null, tmpVals) : null);

      var noonRow = rows.filter(function (r) { return r.category === 'SKY' || r.category === 'PTY'; })
        .slice().sort(function (a, b) { return Math.abs(+a.fcstTime - 1200) - Math.abs(+b.fcstTime - 1200); })[0];
      var repTime = noonRow ? noonRow.fcstTime : (rows[0] && rows[0].fcstTime);
      var sky = rows.find(function (r) { return r.category === 'SKY' && r.fcstTime === repTime; });
      var pty = rows.find(function (r) { return r.category === 'PTY' && r.fcstTime === repTime; });
      var label = weatherLabel(sky && sky.fcstValue, pty && pty.fcstValue);

      var y = +dateStr.slice(0, 4), m = +dateStr.slice(4, 6) - 1, d = +dateStr.slice(6, 8);
      var date = new Date(y, m, d);
      // "월요일"처럼 3글자로 쓰면 타일이 좁을 때 줄바꿈돼서 그 밑 기온 숫자를 밀어내며 잘리게
      // 만들었다("요일 하고 온도 짤리는거" 피드백의 원인) — 달력 요일머리처럼 한 글자로 축약.
      var dayName = dateStr === todayStr ? '오늘' : dayLabel(date.getDay());

      return { dateStr: dateStr, dayName: dayName, isToday: dateStr === todayStr, lo: lo, hi: hi, label: label };
    });
  }

  // 타일 세로 공간이 넉넉하지 않아서(요일 5개를 가로로 나열) 4줄(요일/아이콘/최고/최저)이
  // 아니라 2줄(요일 / 아이콘+최고°·최저°를 한 줄에)로 압축했다 — 세로로 쌓으면 칸 높이를
  // 넘어서 글자가 카드 밖으로 삐져나오는 버그가 있었음(실측: 타일 45px인데 내용 필요 높이
  // 88px+ — 위아래로 다른 카드와 겹쳐 보였음).
  function renderWeatherWeek(days) {
    var wrap = $('weatherWeek');
    wrap.innerHTML = '';
    days.forEach(function (d) {
      var tile = document.createElement('div');
      tile.className = 'weather-day' + (d.isToday ? ' weather-day--today' : '');

      var label = document.createElement('div');
      label.className = 'weather-day-label';
      label.textContent = d.dayName;

      var main = document.createElement('div');
      main.className = 'weather-day-main';

      var icon = document.createElement('span');
      icon.className = 'weather-day-icon';
      icon.textContent = WEATHER_ICON[d.label] || '🌡️';

      // 최저 / 최고를 한 줄로(최저는 파랑, 최고는 빨강 — 잘 보이게)
      var temps = document.createElement('span');
      temps.className = 'weather-day-temps';
      var lo = document.createElement('span');
      lo.className = 'weather-day-temp-lo';
      lo.textContent = (d.lo != null ? Math.round(d.lo) : '-') + '°';
      var sep = document.createElement('span');
      sep.className = 'weather-day-sep';
      sep.textContent = '/';
      var hi = document.createElement('span');
      hi.className = 'weather-day-temp';
      hi.textContent = (d.hi != null ? Math.round(d.hi) : '-') + '°';
      temps.appendChild(lo);
      temps.appendChild(sep);
      temps.appendChild(hi);

      main.appendChild(icon);
      main.appendChild(temps);
      tile.appendChild(label);
      tile.appendChild(main);
      wrap.appendChild(tile);
    });
  }

  // ── 급식(NEIS) ──
  function parseDishes(ddishNm) {
    return ddishNm
      .split(/<br\s*\/?>/i)
      .map(function (s) { return s.replace(/\s*\([\d.\s]*\)\s*$/, '').trim(); })
      .filter(Boolean);
  }

  function fetchMeal() {
    var neis = CONFIG.neis;
    var url = 'https://open.neis.go.kr/hub/mealServiceDietInfo'
      + '?KEY=' + neis.key + '&Type=json&pIndex=1&pSize=10'
      + '&ATPT_OFCDC_SC_CODE=' + neis.officeCode + '&SD_SCHUL_CODE=' + neis.schoolCode
      + '&MLSV_YMD=' + ymd(new Date());

    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var rows = data.mealServiceDietInfo && data.mealServiceDietInfo[1] && data.mealServiceDietInfo[1].row;
        renderMeal(rows || []);
      })
      .catch(function (err) {
        console.error('급식 갱신 실패:', err);
        renderMeal([]);
      });
  }

  // 조식/중식/석식이 나오는 대로 탭으로 나눠 보여준다(처음엔 다 한 목록에 이어붙였는데,
  // "중식/석식 탭을 따로 만들어달라"는 요청으로 바꿈). 마지막으로 본 탭은 세션 동안(새로고침
  // 전까지) 기억한다.
  var MEAL_ORDER = { '1': 0, '2': 1, '3': 2 };
  var mealActiveCode = null;
  var mealRowsCache = [];

  // 메뉴 이름 키워드로 대충 어울리는 이모지를 골라준다 — 별도 이미지 없이 "아이콘"을 붙이는
  // 가장 간단한 방법. 매칭 안 되면 기본 접시 아이콘.
  var DISH_ICON_RULES = [
    [/김치/, '🥬'], [/우유|요구르트|요거트/, '🥛'],
    [/밥|비빔밥|덮밥|초밥|주먹밥/, '🍚'], [/국|탕|찌개/, '🍲'],
    [/빵|케이크|파이|와플/, '🍞'], [/돈까스|까스|튀김|핫도그|너겟/, '🍤'],
    [/면|국수|파스타|우동|짜장|스파게티/, '🍜'],
    [/딸기|사과|바나나|포도|귤|수박|과일/, '🍓'],
    [/샐러드|나물|무침/, '🥗'], [/계란|달걀/, '🥚'],
    [/고기|갈비|삼겹|불고기|스테이크|치킨|닭/, '🍖'],
    [/생선|고등어|갈치|조기|오징어/, '🐟'], [/음료|주스|식혜|에이드/, '🥤']
  ];
  function dishIcon(name) {
    for (var i = 0; i < DISH_ICON_RULES.length; i++) {
      if (DISH_ICON_RULES[i][0].test(name)) return DISH_ICON_RULES[i][1];
    }
    return '🍽️';
  }

  // 급식 카드가 윗줄(시계·날씨와 같은 짧은 줄)로 올라오면서 세로 목록이 안 들어가 — 메뉴를
  // 가로로 나열하는 칩(아이콘+이름, 옆으로 스크롤)으로 바꿨다. 탭(조식/중식/석식)은 카드
  // 헤더 줄에 같이 넣어 줄 하나를 아꼈다.
  function renderMeal(rows) {
    mealRowsCache = rows;
    var tabsEl = $('mealTabs');
    var listEl = $('mealList');
    tabsEl.innerHTML = '';
    listEl.innerHTML = '';
    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'meal-chip meal-chip--empty';
      empty.textContent = '오늘은 급식 정보가 없습니다.';
      listEl.appendChild(empty);
      return;
    }
    var sorted = rows.slice().sort(function (a, b) {
      return (MEAL_ORDER[a.MMEAL_SC_CODE] != null ? MEAL_ORDER[a.MMEAL_SC_CODE] : 9)
        - (MEAL_ORDER[b.MMEAL_SC_CODE] != null ? MEAL_ORDER[b.MMEAL_SC_CODE] : 9);
    });
    var stillExists = sorted.some(function (m) { return m.MMEAL_SC_CODE === mealActiveCode; });
    if (!stillExists) mealActiveCode = sorted[0].MMEAL_SC_CODE;

    sorted.forEach(function (meal) {
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'meal-tab' + (meal.MMEAL_SC_CODE === mealActiveCode ? ' active' : '');
      tab.textContent = meal.MMEAL_SC_NM;
      tab.addEventListener('click', function () {
        mealActiveCode = meal.MMEAL_SC_CODE;
        renderMeal(mealRowsCache);
      });
      tabsEl.appendChild(tab);
    });

    var active = sorted.filter(function (m) { return m.MMEAL_SC_CODE === mealActiveCode; })[0];
    parseDishes(active.DDISH_NM).forEach(function (name) {
      var chip = document.createElement('div');
      chip.className = 'meal-chip';
      var icon = document.createElement('span');
      icon.className = 'meal-icon';
      icon.textContent = dishIcon(name);
      var label = document.createElement('span');
      label.textContent = name;
      chip.appendChild(icon);
      chip.appendChild(label);
      listEl.appendChild(chip);
    });
  }

  // ── D-Day(가장 가까운 학사일정 1건) ──
  function computeDday(ymdStr) {
    var y = +ymdStr.slice(0, 4), m = +ymdStr.slice(4, 6) - 1, d = +ymdStr.slice(6, 8);
    var target = new Date(y, m, d);
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var diff = Math.round((target - now) / 86400000);
    if (diff === 0) return 'D-DAY';
    return diff > 0 ? 'D-' + diff : 'D+' + -diff;
  }

  // 학년도(3월~다음해 2월) 전체 범위 — "해당 달만 뜨는 것 같다"는 피드백으로 범위를 한 달치가
  // 아니라 학년도 전체로 넓히고, 대신 한 화면에 다 못 넣으니 페이지 넘기기를 추가했다.
  function academicYearRange(refDate) {
    var y = refDate.getFullYear();
    var startYear = refDate.getMonth() >= 2 ? y : y - 1; // 3월 기준(0-based month 2)
    return { start: new Date(startYear, 2, 1), end: new Date(startYear + 1, 2, 0) };
  }

  // 매주 있는 "토요휴업일"은 다 아는 내용이라 일정 목록·캘린더 어디에도 보이지 않게 한다.
  function isHiddenEvent(r) { return /토요\s*휴업/.test(r.EVENT_NM || ''); }

  var eventsAllSorted = [];

  function fetchSchoolEvents() {
    var neis = CONFIG.neis;
    var today = new Date();
    var range = academicYearRange(today);
    var url = 'https://open.neis.go.kr/hub/SchoolSchedule'
      + '?KEY=' + neis.key + '&Type=json&pIndex=1&pSize=300'
      + '&ATPT_OFCDC_SC_CODE=' + neis.officeCode + '&SD_SCHUL_CODE=' + neis.schoolCode
      + '&AA_FROM_YMD=' + ymd(range.start) + '&AA_TO_YMD=' + ymd(range.end);

    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var rows = data.SchoolSchedule && data.SchoolSchedule[1] && data.SchoolSchedule[1].row;
        var sorted = (rows || []).slice().sort(function (a, b) { return a.AA_YMD.localeCompare(b.AA_YMD); });

        // "지나간 일정만 잔뜩 뜬다"는 피드백으로, 2일 이상(그제 이전) 지난 건 목록에서 뺀다 —
        // 즉 어제·오늘까지만 지난 일정으로 잠깐 남기고, 그보다 오래된 건 다 숨긴다.
        var cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() - 1);
        var cutoffStr = ymd(cutoff);
        eventsAllSorted = sorted.filter(function (r) { return r.AA_YMD >= cutoffStr && !isHiddenEvent(r); });
        renderEventsList();
      })
      .catch(function (err) {
        console.error('학사일정 갱신 실패:', err);
        eventsAllSorted = [];
        renderEventsList();
      });
  }

  function formatEventDate(ymdStr) {
    var m = +ymdStr.slice(4, 6), d = +ymdStr.slice(6, 8);
    var y = +ymdStr.slice(0, 4);
    var wd = dayLabel(new Date(y, m - 1, d).getDay());
    return m + '월 ' + d + '일 (' + wd + ')';
  }

  // 학사일정 카드가 시계·날씨와 같은 짧은 윗줄로 올라오면서(레이아웃 개편) 페이지 넘기기를 둘
  // 자리가 없어졌다 — 대신 카드 안에서 세로 스크롤로 다 보게 하고, 페이지 버튼은 없앴다.
  function renderEventsList() {
    var wrap = $('eventList');
    wrap.innerHTML = '';
    if (!eventsAllSorted.length) {
      var empty = document.createElement('div');
      empty.className = 'event-empty';
      empty.textContent = '예정된 학사일정이 없습니다.';
      wrap.appendChild(empty);
      return;
    }
    var todayStr = ymd(new Date());

    eventsAllSorted.forEach(function (r) {
      var isPast = r.AA_YMD < todayStr;
      var row = document.createElement('div');
      row.className = 'event-row' + (isPast ? ' event-row--past' : '');
      var badge = document.createElement('div');
      badge.className = 'event-badge';
      badge.textContent = computeDday(r.AA_YMD);
      var info = document.createElement('div');
      var name = document.createElement('div');
      name.className = 'event-name';
      name.textContent = r.EVENT_NM;
      var date = document.createElement('div');
      date.className = 'event-date';
      date.textContent = formatEventDate(r.AA_YMD);
      info.appendChild(name);
      info.appendChild(date);
      row.appendChild(badge);
      row.appendChild(info);
      wrap.appendChild(row);
    });
  }

  // ── 캘린더(이번 달 월간력, NEIS 학사일정 이름을 날짜 칸에 바로 표시) ──
  var WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

  var monthEventCache = {};   // 'YYYY-M' → { at, p } (메모를 고칠 때마다 캘린더를 다시 그려도 학사일정을 매번 새로 받지 않게 10분간 기억한다)
  function fetchMonthEvents(year, month) {
    var ck = year + '-' + month, hit = monthEventCache[ck];
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.p;
    var pr = fetchMonthEventsRaw(year, month);
    monthEventCache[ck] = { at: Date.now(), p: pr };
    pr.then(function (d) { if (!d || !Object.keys(d).length) delete monthEventCache[ck]; });   // 실패·빈 결과는 기억하지 않는다
    return pr;
  }
  function fetchMonthEventsRaw(year, month) {
    var neis = CONFIG.neis;
    var from = new Date(year, month, 1);
    var to = new Date(year, month + 1, 0);
    var url = 'https://open.neis.go.kr/hub/SchoolSchedule'
      + '?KEY=' + neis.key + '&Type=json&pIndex=1&pSize=100'
      + '&ATPT_OFCDC_SC_CODE=' + neis.officeCode + '&SD_SCHUL_CODE=' + neis.schoolCode
      + '&AA_FROM_YMD=' + ymd(from) + '&AA_TO_YMD=' + ymd(to);

    return fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var rows = data.SchoolSchedule && data.SchoolSchedule[1] && data.SchoolSchedule[1].row;
        var days = {};
        // 같은 날짜에 행사가 여러 건이면(방학 기간 등) 첫 번째 것만 칸 안에 표시한다.
        (rows || []).forEach(function (r) {
          if (isHiddenEvent(r)) return;
          if (!days[r.AA_YMD]) days[r.AA_YMD] = r.EVENT_NM;
          if (r.SBTR_DD_SC_NM === '공휴일') neisHolidays[r.AA_YMD] = true;   // 개천절·한글날처럼 이름에 "공휴일"이 없는 공휴일도 빨갛게
        });
        return days;
      })
      .catch(function (err) {
        console.error('캘린더 학사일정 갱신 실패:', err);
        return {};
      });
  }

  // ── 캘린더 날짜별 개인 할 일(로컬 저장만, 서버 전송 없음) ──
  var DAY_TASK_KEY = 'dashboardDayTasks';
  var dayTasks = {};
  var dayEditorTab = 'memo'; // 'memo' | 'attendance' | 'subject' — 팝업 안에서 탭 전환한 걸 기억(다음 열 때도 그대로)

  function loadDayTasks() {
    try { dayTasks = JSON.parse(localStorage.getItem(DAY_TASK_KEY) || '{}'); } catch (e) { dayTasks = {}; }
    loadNoteMeta();
    daySig = Object.assign({}, dayTasks);   // 변경 비교의 기준(이후 저장부터 "바뀐 것"으로 친다)
  }
  function saveDayTasks() {
    stampDayTasks();
    try { localStorage.setItem(DAY_TASK_KEY, JSON.stringify(dayTasks)); } catch (e) {}
    saveNoteMeta();
    scheduleCloudSync();
  }

  // ── 출결 기록(구조화, 로컬 저장만, 서버 전송 없음) ──
  // 처음엔 "출석" 탭이 그냥 자유 텍스트 한 줄이었는데(Phase 15~16), "학생별로 출결을 누적
  // 기록하고 월간/연간 종합을 보고 싶다"는 요청으로 완전히 구조화된 레코드 배열로 바꿨다.
  // 레코드 하나 = { id, date(YYYYMMDD), grade, ban, no, studentName, studentId(있으면),
  // type(결석/지각/조퇴/결과), reason(질병/미인정/기타), memo }.
  var ATTENDANCE_KEY = 'dashboardAttendanceRecords';
  var ATTENDANCE_TYPES = ['결석', '조퇴', '지각', '결과'];   // 입력 버튼·출결 종합 정렬 순서 (4종류를 한 줄에 보여 준다)
  var ATTENDANCE_REASONS = ['질병', '미인정', '기타', '출석인정'];
  var attendanceRecords = [];

  function loadAttendanceRecords() {
    try { attendanceRecords = JSON.parse(localStorage.getItem(ATTENDANCE_KEY) || '[]'); } catch (e) { attendanceRecords = []; }
  }
  function saveAttendanceRecords() {
    try { localStorage.setItem(ATTENDANCE_KEY, JSON.stringify(attendanceRecords)); } catch (e) {}
    scheduleCloudSync();
  }

  // ── 폰 출결 연동(구글 드라이브) ── 폰에서 입력한 출결을 PC로 가져오고, PC 기록도 같은 곳에 올린다.
  // 실제 구글 통신은 Electron 메인 프로세스(window.TTCLOUD)가 한다. 브라우저에서 열었거나 연동 설정이 없으면 조용히 꺼진 채로 둔다.
  // 같은 기록은 updatedAt이 최신인 쪽이 이기고, 지운 기록은 삭제 표시(tombstone)로 남겨서 다시 살아나지 않게 한다.
  var TOMB_KEY = 'dashboardAttendanceTombstones';
  var attendanceTombstones = {};
  var cloudState = { configured: false, connected: false, busy: false, error: '', last: 0 };
  var cloudApplying = false, cloudTimer = null;

  function loadTombstones() {
    try { attendanceTombstones = JSON.parse(localStorage.getItem(TOMB_KEY) || '{}') || {}; } catch (e) { attendanceTombstones = {}; }
  }
  function saveTombstones() {
    try { localStorage.setItem(TOMB_KEY, JSON.stringify(attendanceTombstones)); } catch (e) {}
  }
  function scheduleCloudSync(delay) {
    if (cloudApplying || !cloudState.connected) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(cloudSyncNow, delay == null ? 2000 : delay);
  }
  // ── 날짜별 할 일의 변경 표시 ── 저장할 때마다 "무엇이 바뀌었는지"를 비교해서 바뀐 항목에만 updatedAt을 찍고,
  // 지워진 항목은 삭제 표시(tombstone)로 남긴다. 그래야 폰과 합칠 때 최신 쪽이 이기고 지운 게 되살아나지 않는다.
  // (메모 카드·섹션·휴지통의 같은 처리는 board.js가 한다.)
  var PREFS_KEY = 'dashboardPrefs';
  var prefs = [];   // [{ id:'sem-2026', date:'20260810', updatedAt }] — 2학기 시작일(학년도별)
  function loadPrefs() { try { var v = JSON.parse(localStorage.getItem(PREFS_KEY) || '[]'); prefs = Array.isArray(v) ? v : []; } catch (e) { prefs = []; } }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} scheduleCloudSync(); }
  // 2학기 시작일(YYYYMMDD). 정해 둔 게 없으면 9월 1일. 학교마다·해마다 달라서 직접 바꿀 수 있게 한다.
  var SEMAUTO_KEY = 'dashboardSemAuto', semAuto = {}, semAutoTried = {};
  try { semAuto = JSON.parse(localStorage.getItem(SEMAUTO_KEY) || '{}') || {}; } catch (e) { semAuto = {}; }
  function semesterStartOf(startYear) {
    var p = prefs.filter(function (x) { return x.id === 'sem-' + startYear; })[0];
    if (p && p.date) return p.date;
    return semAuto[startYear] || String(startYear) + '0901';
  }
  // 학사일정(NEIS)에서 "개학"(입학 제외) 중 가장 이른 날을 그 학년도의 2학기 시작일 기본값으로 쓴다(학교마다 8월일 수도, 9월일 수도 있다).
  function ensureSemAuto(startYear) {
    if (semAuto[startYear] || semAutoTried[startYear] || !CONFIG || !CONFIG.neis) return Promise.resolve(false);
    semAutoTried[startYear] = true;
    var neis = CONFIG.neis;
    return fetch('https://open.neis.go.kr/hub/SchoolSchedule?KEY=' + neis.key + '&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=' + neis.officeCode + '&SD_SCHUL_CODE=' + neis.schoolCode + '&AA_FROM_YMD=' + startYear + '0701&AA_TO_YMD=' + startYear + '0930')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var rows = (d.SchoolSchedule && d.SchoolSchedule[1] && d.SchoolSchedule[1].row) || [];
        var days = rows.filter(function (r) { return /개학/.test(r.EVENT_NM) && !/입학/.test(r.EVENT_NM); }).map(function (r) { return r.AA_YMD; }).sort();
        if (!days.length) return false;
        semAuto[startYear] = days[0];
        try { localStorage.setItem(SEMAUTO_KEY, JSON.stringify(semAuto)); } catch (e) {}
        return true;
      })
      .catch(function () { return false; });
  }
  function setSemesterStart(startYear, dateStr) {
    var id = 'sem-' + startYear, p = prefs.filter(function (x) { return x.id === id; })[0];
    if (!p) { p = { id: id }; prefs.push(p); }
    p.date = dateStr || ''; p.updatedAt = Date.now();
    savePrefs();
  }
  var DAYTASK_TOMB_KEY = 'dashboardDayTaskTombstones', DAYTASK_STAMP_KEY = 'dashboardDayTaskStamps';
  var dayTombs = {}, dayStamps = {};
  var daySig = null;   // 마지막으로 저장한 상태의 요약(처음엔 null = 아직 기준 없음)

  function loadNoteMeta() {
    try { dayTombs = JSON.parse(localStorage.getItem(DAYTASK_TOMB_KEY) || '{}') || {}; } catch (e) { dayTombs = {}; }
    try { dayStamps = JSON.parse(localStorage.getItem(DAYTASK_STAMP_KEY) || '{}') || {}; } catch (e) { dayStamps = {}; }
  }
  function saveNoteMeta() {
    try {
      localStorage.setItem(DAYTASK_TOMB_KEY, JSON.stringify(dayTombs));
      localStorage.setItem(DAYTASK_STAMP_KEY, JSON.stringify(dayStamps));
    } catch (e) {}
  }
  function stampDayTasks() {
    var now = Date.now();
    if (daySig) {
      Object.keys(dayTasks).forEach(function (k) { if (daySig[k] !== dayTasks[k]) dayStamps[k] = now; });
      Object.keys(daySig).forEach(function (k) { if (!(k in dayTasks)) { dayTombs[k] = now; delete dayStamps[k]; } });
    }
    daySig = Object.assign({}, dayTasks);
  }
  // 동기화가 진행되는 몇 초 사이에 사용자가 바꾼 것이 서버 결과로 덮여 사라지지 않게, 결과와 "지금 화면의 기록"을
  // 항목별로 updatedAt이 더 최근인 쪽으로 합친다(삭제 표시도 같은 규칙).
  function mergeKeepNewest(localRecs, localTombs, resRecs, resTombs) {
    var best = {};
    function put(id, rec, t, isRes) { var c = best[id]; if (!c || t > c.t || (t === c.t && isRes)) best[id] = { rec: rec, t: t }; }
    (localRecs || []).forEach(function (r) { put(r.id, r, Number(r.updatedAt) || 0, false); });
    Object.keys(localTombs || {}).forEach(function (id) { put(id, null, Number(localTombs[id]) || 0, false); });
    (resRecs || []).forEach(function (r) { put(r.id, r, Number(r.updatedAt) || 0, true); });
    Object.keys(resTombs || {}).forEach(function (id) { put(id, null, Number(resTombs[id]) || 0, true); });
    var records = [], tombs = {};
    Object.keys(best).forEach(function (id) { if (best[id].rec) records.push(best[id].rec); else tombs[id] = best[id].t; });
    return { records: records, tombstones: tombs };
  }
  window.TTMERGE = mergeKeepNewest;

  function buildCloudPayload() {
    stampDayTasks(); saveNoteMeta();
    var dayRecords = Object.keys(dayTasks).map(function (k) { return { id: k, text: dayTasks[k], updatedAt: dayStamps[k] || 0 }; });
    var payload = {
      attendance: { records: attendanceRecords, tombstones: attendanceTombstones },
      dayTasks: { records: dayRecords, tombstones: dayTombs },
      prefs: { records: prefs, tombstones: {} }
    };
    if (window.BOARD) Object.assign(payload, window.BOARD.getSyncState());   // memo(카드)·sections·trash
    if (window.SUBJ) Object.assign(payload, window.SUBJ.getSyncState());     // 교과 출결(subj)
    return payload;
  }
  // 합친 결과를 화면 상태로 되돌린다. 바뀐 게 있으면 true.
  function applyCloudResult(res) {
    var changed = false;
    if (res.attendance) {
      var mergedAtt = mergeKeepNewest(attendanceRecords, attendanceTombstones, res.attendance.records, res.attendance.tombstones);
      var nextAtt = mergedAtt.records;
      attendanceTombstones = mergedAtt.tombstones;
      saveTombstones();
      if (JSON.stringify(nextAtt) !== JSON.stringify(attendanceRecords)) { attendanceRecords = nextAtt; changed = true; }
    }
    if (window.BOARD && (res.memo || res.sections || res.trash)) { if (window.BOARD.applySync(res)) changed = true; }
    if (window.SUBJ && res.subj) { if (window.SUBJ.applySync(res)) changed = true; }
    if (res.prefs) { var np = (window.TTMERGE ? window.TTMERGE(prefs, {}, res.prefs.records, {}).records : (res.prefs.records || [])); if (JSON.stringify(np) !== JSON.stringify(prefs)) { prefs = np; try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} changed = true; } }
    if (res.dayTasks) {
      var nextDay = {}, nextStamps = {};
      (res.dayTasks.records || []).forEach(function (r) { if (r.text) { nextDay[r.id] = r.text; nextStamps[r.id] = r.updatedAt || 0; } });
      dayTombs = res.dayTasks.tombstones || {};
      if (JSON.stringify(nextDay) !== JSON.stringify(dayTasks)) { dayTasks = nextDay; changed = true; }
      dayStamps = nextStamps;
      daySig = Object.assign({}, dayTasks);
    }
    saveNoteMeta();
    return changed;
  }

  // ── board.js(메모 보드·휴지통·백업 복원)가 쓰는 출결·할 일 통로 ──
  function refreshAfterRestore() {
    var tab = document.documentElement.getAttribute('data-tab');
    if (tab === 'attendance') renderAttendanceTab();
    renderCalendar();
  }
  window.TTAPP = {
    scheduleSync: function () { scheduleCloudSync(); },
    refreshCalendar: function () { renderCalendar(); },
    jumpToDate: function (dateStr, which) { jumpToDate(dateStr, which); },
    syncNow: function () { cloudState.error = ''; return cloudSyncNow(); },
    restoreAttendance: function (rec) {
      var r = Object.assign({}, rec, { updatedAt: Date.now() });
      attendanceRecords = attendanceRecords.filter(function (x) { return x.id !== r.id; });
      attendanceRecords.push(r);
      delete attendanceTombstones[r.id]; saveTombstones();
      saveAttendanceRecords(); refreshAfterRestore();
    },
    restoreDayTask: function (date, text) {
      dayTasks[date] = text; delete dayTombs[date];
      saveDayTasks(); refreshAfterRestore();
    },
    // 백업에는 있는데 지금은 없는 것만 되살린다. 되살린 개수를 돌려준다.
    mergeRestore: function (b) {
      var n = 0, t = Date.now();
      (b.attendance || []).forEach(function (r) {
        if (!r || !r.id || attendanceRecords.some(function (x) { return x.id === r.id; })) return;
        attendanceRecords.push(Object.assign({}, r, { updatedAt: t })); delete attendanceTombstones[r.id]; n++;
      });
      Object.keys(b.dayTasks || {}).forEach(function (d) { if (!dayTasks[d] && b.dayTasks[d]) { dayTasks[d] = b.dayTasks[d]; delete dayTombs[d]; n++; } });
      if (window.SUBJ && b.subj) n += window.SUBJ.mergeRestore(b.subj);
      saveTombstones(); saveAttendanceRecords(); saveDayTasks(); refreshAfterRestore();
      return n;
    },
    // 그 날짜 상태로 통째로 되돌린다. 지금 있고 백업에 없는 것은 휴지통으로 보낸다. 바뀐 개수를 돌려준다.
    replaceRestore: function (b) {
      var n = 0, t = Date.now();
      var keep = {}; (b.attendance || []).forEach(function (r) { if (r && r.id) keep[r.id] = true; });
      attendanceRecords.filter(function (r) { return !keep[r.id]; }).forEach(function (r) {
        if (window.BOARD) window.BOARD.trash('attendance', r);
        attendanceTombstones[r.id] = t; n++;
      });
      attendanceRecords = (b.attendance || []).filter(function (r) { return r && r.id; }).map(function (r) { delete attendanceTombstones[r.id]; return Object.assign({}, r, { updatedAt: t }); });
      var bd = b.dayTasks || {};
      Object.keys(dayTasks).filter(function (d) { return !bd[d]; }).forEach(function (d) {
        if (window.BOARD) window.BOARD.trash('daytask', { id: d, text: dayTasks[d] }); n++;
      });
      var nd = {}; Object.keys(bd).forEach(function (d) { if (bd[d]) { nd[d] = bd[d]; delete dayTombs[d]; } });
      dayTasks = nd;
      if (window.SUBJ && b.subj) n += window.SUBJ.replaceRestore(b.subj);
      saveTombstones(); saveAttendanceRecords(); saveDayTasks(); refreshAfterRestore();
      return n;
    }
  };
  function cloudSyncNow() {
    if (!window.TTCLOUD || !cloudState.connected || cloudState.busy) return Promise.resolve();
    cloudState.busy = true; paintCloudChip();
    return window.TTCLOUD.sync(buildCloudPayload()).then(function (res) {
      cloudState.busy = false;
      if (!res || !res.ok) {
        cloudState.error = (res && res.error) || '동기화 실패';
        window.TTCLOUD.status().then(function (st) { cloudState.connected = st.connected; paintCloudChip(); });
        paintCloudChip();
        return;
      }
      cloudState.error = ''; cloudState.last = Date.now();
      if (applyCloudResult(res.result || {})) {
        cloudApplying = true;
        saveAttendanceRecords();
        try { localStorage.setItem(DAY_TASK_KEY, JSON.stringify(dayTasks)); } catch (e) {}
        cloudApplying = false;
        // 입력 중인 칸이 있으면 화면을 다시 그리지 않는다(입력이 날아가지 않게) — 다음에 탭을 열 때 새 내용이 보인다.
        var active = document.activeElement;
        var typing = active && active.closest && /^(INPUT|TEXTAREA)$/.test(active.tagName);
        var tab = document.documentElement.getAttribute('data-tab');
        if (!typing) {
          if (tab === 'attendance') renderAttendanceTab();
          else if (tab === 'memo') renderMemo();
          else if (tab === 'subject' && window.SUBJ) window.SUBJ.render();
        }
        renderCalendar();
      }
      paintCloudChip();
    }).catch(function (e) {
      cloudState.busy = false; cloudState.error = String(e && e.message || e); paintCloudChip();
    });
  }
  // 버튼 모양: [● 휴대폰 연동 | 상태] — 왼쪽은 이름과 상태 점, 오른쪽 작은 칸이 상태(꺼짐/연결됨/동기화/오류)를 글자와 색으로 알려 준다.
  function setCloudChip(kind, stateText, title) {
    var chip = $('cloudChip');
    if (!chip) return;
    chip.className = 'cloud-chip cloud-chip--' + kind;
    chip.innerHTML = '<span class="cc-name"><i class="cc-dot"></i>휴대폰 연동</span><span class="cc-state"></span>';
    chip.lastChild.textContent = stateText;
    chip.title = title || '';
  }
  function paintCloudChip() {
    // 설정(톱니) 창이 읽어 갈 수 있게 동기화 상태를 문서에 적어 두고 알린다.
    var de = document.documentElement;
    de.setAttribute('data-cloud-state', !cloudState.connected ? 'off' : cloudState.busy ? 'busy' : cloudState.error ? 'err' : 'ok');
    de.setAttribute('data-cloud-error', cloudState.error || '');
    de.setAttribute('data-cloud-last', String(cloudState.last || 0));
    window.dispatchEvent(new Event('ttcloud-state'));
    var chip = $('cloudChip');
    if (!chip) return;
    chip.hidden = !cloudState.configured;
    if (!cloudState.connected) setCloudChip('off', '꺼짐', '구글 드라이브로 휴대폰에서 입력한 출결·메모를 가져옵니다. 눌러서 연결하세요.');
    else if (cloudState.busy) setCloudChip('busy', '동기화', '');
    else if (cloudState.error) setCloudChip('err', '오류', cloudState.error + ' (눌러서 다시 시도)');
    else setCloudChip('on', '연결됨', '눌러서 지금 동기화');
  }
  function onCloudChipClick() {
    if (!window.TTCLOUD) return;
    if (!cloudState.connected) {
      setCloudChip('busy', '로그인 중', '브라우저에서 구글 로그인을 마치세요.');
      window.TTCLOUD.connect().then(function (r) {
        if (!r || !r.ok) { cloudState.error = (r && r.error) || '연결 실패'; alert('구글 연결에 실패했습니다.\n' + cloudState.error); cloudState.error = ''; paintCloudChip(); return; }
        cloudState.connected = true; cloudState.error = ''; paintCloudChip(); cloudSyncNow();
      });
    } else { cloudState.error = ''; cloudSyncNow(); }
  }
  function initCloud() {
    loadTombstones();
    // 휴대폰 연동 버튼은 이제 설정(톱니) 창에만 있다. 여기서는 연결돼 있으면 조용히 동기화만 한다.
    if (!window.TTCLOUD) return;
    window.TTCLOUD.status().then(function (st) {
      cloudState.configured = !!st.configured; cloudState.connected = !!st.connected; paintCloudChip();
      if (cloudState.connected) { setTimeout(cloudSyncNow, 3000); }
    });
    setInterval(function () { if (cloudState.connected) cloudSyncNow(); }, 60 * 1000);
    window.addEventListener('focus', function () { scheduleCloudSync(500); });
    // 설정 패널에서 연결을 해제했을 때 상태 표시를 다시 읽는다.
    window.addEventListener('ttcloud-changed', function () {
      window.TTCLOUD.status().then(function (st) { cloudState.connected = !!st.connected; cloudState.error = ''; paintCloudChip(); if (cloudState.connected) cloudSyncNow(); });
    });
  }


  // ── 출결·메모 백업/복원 ── Lively가 종료될 때 WebView 저장공간(localStorage)을 통째로
  // 비워버리는 경우가 있어서("디스크 캐시" 설정이 꺼져 있으면) 출결·할일 데이터가 통째로
  // 사라지는 사고가 생겼다 — Lively 설정만 믿을 수 없어서, 파일로 직접 내보내고 다시 불러올
  // 수 있는 수동 백업 기능을 별도로 둔다(둘 다 이 컴퓨터 로컬에서만 오가고 서버 전송 없음).
  function exportBackup() {
    var payload = {
      exportedAt: new Date().toISOString(),
      attendanceRecords: attendanceRecords,
      subjectAtt: window.SUBJ ? window.SUBJ.getSyncState().subj.records : [],
      dayTasks: dayTasks,
      memoTodos: window.BOARD ? window.BOARD.exportState().memoTodos : [],
      memoSections: window.BOARD ? window.BOARD.exportState().memoSections : []
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var stamp = ymd(new Date());
    a.href = url;
    a.download = '대시보드백업_' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) {
        alert('백업 파일을 읽을 수 없습니다 — 올바른 백업 파일인지 확인해주세요.');
        return;
      }
      var attCount = Array.isArray(data.attendanceRecords) ? data.attendanceRecords.length : 0;
      var taskCount = data.dayTasks && typeof data.dayTasks === 'object' ? Object.keys(data.dayTasks).length : 0;
      if (!confirm('백업 파일(' + (data.exportedAt || '날짜 미상') + ')을 불러오면 지금 있는 출결 ' + attendanceRecords.length + '건·메모 ' + Object.keys(dayTasks).length + '건이 백업 파일의 출결 ' + attCount + '건·메모 ' + taskCount + '건으로 덮어써집니다. 계속할까요?')) return;
      if (Array.isArray(data.attendanceRecords)) { attendanceRecords = data.attendanceRecords; saveAttendanceRecords(); }
      if (data.dayTasks && typeof data.dayTasks === 'object') { dayTasks = data.dayTasks; saveDayTasks(); }
      if (Array.isArray(data.subjectAtt) && window.SUBJ) { window.SUBJ.replaceRestore(data.subjectAtt); }
      if (Array.isArray(data.memoTodos) && window.BOARD) { window.BOARD.importState(data); }
      renderCalendar();
      alert('불러오기 완료: 출결 ' + attCount + '건, 메모 ' + taskCount + '건.');
    };
    reader.readAsText(file);
  }
  function attendanceRecordsForDate(dateStr) {
    return attendanceRecords.filter(function (r) { return r.date === dateStr; });
  }
  function attendanceStudentLabel(r) {
    return r.grade + '-' + r.ban + ' ' + r.no + '번 ' + r.studentName;
  }
  // "결석"만 보여주지 말고 "질병결석"처럼 구분까지 붙여서 보여달라는 요청 — 사유+종류를
  // 붙여쓰는 학교 출결 서식 관례 그대로.
  function attendanceTypeLabel(r) {
    return r.reason + r.type;
  }
  // 교과 출결 / 학급 출결 — 새 필드를 따로 안 만들고 이미 있는 "종류"에서 그대로 유도한다.
  // 실제 학교 현장에서 "결과"(그 교시만 빠짐)는 교과교사가 관리하는 교과출결이고, 결석·지각·
  // 조퇴는 담임이 관리하는 학급출결이라는 관례를 그대로 따름 — 입력할 때 따로 고를 필요 없이
  // 자동으로 분류되고, 기존에 이미 저장된 기록에도 그대로(소급) 적용됨.
  var ATTENDANCE_CATEGORIES = ['학급', '교과'];
  function attendanceCategoryOf(r) {
    // 입력할 때 고른 구분(학급/교과)을 그대로 쓴다. 구분이 없던 옛 기록만 예전 규칙(결과=교과)으로 가른다.
    if (r.category === '학급' || r.category === '교과') return r.category;
    return r.type === '결과' ? '교과' : '학급';
  }
  // 입력 폼에서 "종류" 버튼 목록을 교과/학급 선택에 맞춰 좁혀서 보여준다(위 attendanceCategoryOf
  // 규칙과 항상 같은 결과가 나오도록 — 교과를 고르면 "결과"만, 학급을 고르면 나머지 셋만 뜬다).
  var ATTENDANCE_TYPES_BY_CATEGORY = { '학급': ['결석', '지각', '조퇴'], '교과': ['결과'] };

  function closeDayTaskEditor() {
    var existing = document.getElementById('dayTaskOverlay');
    if (existing) existing.remove();
  }

  // 할일/출석 두 탭을 하나의 팝업 안에 두되, 구조가 완전히 달라서(할일=자유 텍스트,
  // 출석=학생 검색+유형 선택+목록) 각각 별도의 패널 DOM을 만들어 tab에 따라 보이기/숨기기만
  // 한다(예전처럼 textarea 하나를 공유하는 방식으로는 출석의 구조화된 입력을 못 담아서
  // 이번에 갈아엎음).
  function openDayTaskEditor(cellDate) {
    closeDayTaskEditor();
    var key = ymd(cellDate);

    var overlay = document.createElement('div');
    overlay.className = 'day-task-overlay';
    overlay.id = 'dayTaskOverlay';

    var box = document.createElement('div');
    box.className = 'day-task-box day-task-box--wide';

    var title = document.createElement('div');
    title.className = 'day-task-title';
    title.textContent = (cellDate.getMonth() + 1) + '월 ' + cellDate.getDate() + '일 (' + dayLabel(cellDate.getDay()) + ')';

    var tabRow = document.createElement('div');
    tabRow.className = 'day-task-tabs';
    var taskTabBtn = document.createElement('button');
    taskTabBtn.type = 'button';
    taskTabBtn.className = 'day-task-tab';
    taskTabBtn.textContent = '메모';
    var attTabBtn = document.createElement('button');
    attTabBtn.type = 'button';
    attTabBtn.className = 'day-task-tab';
    attTabBtn.textContent = '학급';
    var subjTabBtn = document.createElement('button');
    subjTabBtn.type = 'button';
    subjTabBtn.className = 'day-task-tab';
    subjTabBtn.textContent = '교과';
    tabRow.appendChild(taskTabBtn);
    tabRow.appendChild(attTabBtn);
    tabRow.appendChild(subjTabBtn);

    // ── 메모 패널(그 날짜로 지정한 메모 카드) ──
    var taskPanel = document.createElement('div');
    taskPanel.className = 'day-editor-panel';
    var memoList = document.createElement('div');
    memoList.className = 'dm-list';
    var memoAdd = document.createElement('div');
    memoAdd.className = 'dm-add';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dm-input';
    input.placeholder = '이 날짜의 메모를 입력하세요';
    input.autocomplete = 'off';
    var addMemoBtn = document.createElement('button');
    addMemoBtn.type = 'button';
    addMemoBtn.className = 'day-task-save';
    addMemoBtn.textContent = '+ 추가';
    function paintMemos() {
      memoList.innerHTML = '';
      var ms = window.BOARD && window.BOARD.memosOn ? window.BOARD.memosOn(key) : [];
      if (!ms.length) {
        var e = document.createElement('div');
        e.className = 'att-list-empty';
        e.textContent = '이 날짜에 지정된 메모가 없습니다.';
        memoList.appendChild(e);
        return;
      }
      ms.forEach(function (m) {
        var row = document.createElement('div');
        row.className = 'dm-row' + (m.done ? ' done' : '');
        var chk = document.createElement('button');
        chk.type = 'button'; chk.className = 'dm-chk'; chk.textContent = m.done ? '✓' : '';
        chk.setAttribute('aria-label', m.done ? '완료 취소' : '완료');
        chk.addEventListener('click', function (ev) { ev.stopPropagation(); window.BOARD.toggleById(m.id); paintMemos(); });
        var txt = document.createElement('div');
        txt.className = 'dm-text'; txt.textContent = m.text; txt.title = '눌러서 고치기';
        txt.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var inp = document.createElement('input');
          inp.type = 'text'; inp.className = 'dm-input'; inp.value = m.text;
          function fin(commit) { if (commit) window.BOARD.setTextById(m.id, inp.value); paintMemos(); }
          inp.addEventListener('keydown', function (e2) { if (e2.key === 'Enter') { e2.preventDefault(); fin(true); } else if (e2.key === 'Escape') fin(false); });
          inp.addEventListener('blur', function () { fin(true); });
          inp.addEventListener('click', function (e2) { e2.stopPropagation(); });
          row.replaceChild(inp, txt);
          inp.focus(); inp.select();
        });
        var del = document.createElement('button');
        del.type = 'button'; del.className = 'dm-del'; del.textContent = '삭제';
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          if (!window.confirm('"' + m.text.split('\n')[0].slice(0, 20) + '" 메모를 삭제할까요?\n(삭제해도 휴지통에서 되살릴 수 있어요.)')) return;
          window.BOARD.removeById(m.id); paintMemos();
        });
        row.appendChild(chk); row.appendChild(txt); row.appendChild(del);
        memoList.appendChild(row);
      });
    }
    function addMemo() {
      var v = input.value.trim();
      if (!v || !window.BOARD || !window.BOARD.addDated) return;
      window.BOARD.addDated(key, v);
      input.value = '';
      paintMemos();
    }
    addMemoBtn.addEventListener('click', function (ev) { ev.stopPropagation(); addMemo(); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); addMemo(); }
      else if (ev.key === 'Escape') { closeDayTaskEditor(); }
    });
    memoAdd.appendChild(input);
    memoAdd.appendChild(addMemoBtn);
    taskPanel.appendChild(memoAdd);
    taskPanel.appendChild(memoList);
    paintMemos();

    // ── 출석 패널 ──
    var attPanel = buildAttendancePanel(key);

    // ── 교과 출결 패널(그날 체크된 것을 보여 준다. 입력은 "교과출결" 탭에서) ──
    var subjPanel = document.createElement('div');
    subjPanel.className = 'day-editor-panel';
    var subjRows = window.SUBJ ? window.SUBJ.listOn(key) : [];
    if (!subjRows.length) {
      var se = document.createElement('div'); se.className = 'att-list-empty'; se.textContent = '이 날짜에 체크된 교과 출결이 없습니다.'; subjPanel.appendChild(se);
    } else {
      subjRows.forEach(function (r) {
        var row = document.createElement('div'); row.className = 'att-record-row';
        var info = document.createElement('div'); info.className = 'att-record-info';
        var nm = document.createElement('div'); nm.className = 'att-record-name'; nm.textContent = r.period + '교시 ' + (r.label ? r.label + ' ' : '') + r.subject;
        var meta = document.createElement('div'); meta.className = 'att-record-meta';
        meta.textContent = r.grade + '-' + r.ban + '-' + r.no + ' ' + r.studentName + ' · ' + r.type + (r.reason ? ' · ' + r.reason : '') + (r.memo ? ' · ' + r.memo : '');
        info.appendChild(nm); info.appendChild(meta); row.appendChild(info); subjPanel.appendChild(row);
      });
    }
    var subjGo = document.createElement('button'); subjGo.type = 'button'; subjGo.className = 'day-task-save'; subjGo.textContent = '이 날짜의 교과 출결 열기';
    subjGo.addEventListener('click', function (ev) { ev.stopPropagation(); closeDayTaskEditor(); if (window.SUBJ) window.SUBJ.openDate(cellDate); setTab('subject', true); });
    var subjBtnRow = document.createElement('div'); subjBtnRow.className = 'day-task-btns'; subjBtnRow.appendChild(subjGo); subjPanel.appendChild(subjBtnRow);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'day-task-close day-task-close--bottom';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', function (ev) { ev.stopPropagation(); closeDayTaskEditor(); });

    function switchTab(tab) {
      dayEditorTab = tab;
      taskPanel.hidden = tab !== 'memo';
      attPanel.hidden = tab !== 'attendance';
      subjPanel.hidden = tab !== 'subject';
      taskTabBtn.classList.toggle('active', tab === 'memo');
      attTabBtn.classList.toggle('active', tab === 'attendance');
      subjTabBtn.classList.toggle('active', tab === 'subject');
      if (tab === 'memo') input.focus();
    }
    taskTabBtn.addEventListener('click', function (ev) { ev.stopPropagation(); switchTab('memo'); });
    attTabBtn.addEventListener('click', function (ev) { ev.stopPropagation(); switchTab('attendance'); });
    subjTabBtn.addEventListener('click', function (ev) { ev.stopPropagation(); switchTab('subject'); });

    box.appendChild(title);
    box.appendChild(tabRow);
    box.appendChild(taskPanel);
    box.appendChild(attPanel);
    box.appendChild(subjPanel);
    box.appendChild(closeBtn);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeDayTaskEditor(); });
    box.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (attPanel.closeMiniDropdowns) attPanel.closeMiniDropdowns(ev.target);
    });

    // body가 아니라 #board에 붙인다 — 테마 색(--panel-bg 등)이 #board[data-theme=...]에 걸려
    // 있어서, body 바로 밑에 붙이면 그 변수들을 못 물려받아 배경이 다 투명해져 버린다(실제로
    // 겪은 버그 — 팝업이 "매우 투명해서 안 보인다"는 피드백의 원인이었음).
    $('board').appendChild(overlay);
    switchTab(dayEditorTab);
  }

  // 클릭식 미니 드롭다운(학년/반/번호 선택용) — 네이티브 <select>는 Lively에서 선택이 안
  // 먹는 고질적인 문제가 있어서 여기도 처음부터 버튼+패널로 만들었다. panel[hidden]을
  // display:none으로 확실히 덮어써야 하는 것도 이미 겪은 버그(Phase 15)라 CSS에서 처리.
  function createMiniDropdown(placeholder) {
    var wrap = document.createElement('div');
    wrap.className = 'att-mini-dd';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'att-mini-dd-btn';
    btn.textContent = placeholder;
    var panel = document.createElement('div');
    panel.className = 'att-mini-dd-panel';
    panel.hidden = true;
    var currentOptions = [];
    var onSelectCb = null;

    function renderPanel() {
      panel.innerHTML = '';
      if (!currentOptions.length) {
        var e = document.createElement('div');
        e.className = 'att-search-empty';
        e.textContent = '선택 가능한 항목 없음';
        panel.appendChild(e);
        return;
      }
      currentOptions.forEach(function (opt) {
        var o = document.createElement('div');
        o.className = 'att-mini-dd-option';
        o.textContent = opt.label;
        o.addEventListener('click', function (ev) {
          ev.stopPropagation();
          btn.textContent = opt.label;
          panel.hidden = true;
          if (onSelectCb) onSelectCb(opt.value);
        });
        panel.appendChild(o);
      });
    }
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var willOpen = panel.hidden;
      if (willOpen) renderPanel();
      panel.hidden = !willOpen;
    });
    panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    wrap.appendChild(btn);
    wrap.appendChild(panel);

    return {
      el: wrap,
      panelEl: panel,
      setOptions: function (opts) { currentOptions = opts; },
      setLabel: function (text) { btn.textContent = text; },
      reset: function () { btn.textContent = placeholder; },
      onSelect: function (cb) { onSelectCb = cb; }
    };
  }

  // 출석 패널: 학년/반/번호 드롭다운(3단, timetableData.students 기반) + 종류/구분 버튼 +
  // 사유 입력 + 추가/수정 + 이 날짜 기록 목록(수정·삭제). "이름 검색이 아니라 학년-반-번호를
  // 드롭다운으로 고르게 해달라"는 피드백으로 검색창 방식에서 이렇게 바꿨다.
  // 마지막으로 고른 학년·반은 기억해 둔다 — 출결을 하나 추가한 뒤에도, 날짜를 넘기거나 다시 열어도 같은 반이 그대로 선택돼 있어야
  // 같은 반 학생을 연달아 입력하기 편하다. (번호만 초기화)
  var ATT_PICK_KEY = 'dashboardAttPick';
  var lastPick = {};
  try { lastPick = JSON.parse(localStorage.getItem(ATT_PICK_KEY) || '{}') || {}; } catch (e) { lastPick = {}; }
  function saveLastPick() { try { localStorage.setItem(ATT_PICK_KEY, JSON.stringify(lastPick)); } catch (e) {} }

  function buildAttendancePanel(dateKey) {
    var panel = document.createElement('div');
    panel.className = 'day-editor-panel att-panel';

    var editingId = null;
    var pickedGrade = null, pickedBan = null, pickedNo = null;
    var selectedStudent = null; // {grade, ban, no, studentName, studentId}
    var selectedCategory = '학급';
    var selectedType = ATTENDANCE_TYPES[0];
    var selectedReason = ATTENDANCE_REASONS[0];

    // grade는 원본 데이터에 문자열("2")로, ban/no는 숫자로 들어있어서(edutech-app export
    // 그대로) 값을 다시 만들어내지 않고 실제 데이터에서 나온 원본 값을 그대로 쓴다 — 한 번
    // Object.keys()로 재구성하면서 문자열↔숫자 타입이 어긋나 "학년 고르면 반이 하나도 안
    // 뜨는" 버그를 겪었음(항상 String()으로 비교해서 타입이 뭐든 매칭되게 함).
    // timetableData.students는 edutech-app이 있어야만 채워지는데(선택과목 이동수업 매칭이
    // 필요한 학생 개별 시간표 탭용) 출결 입력은 그런 매칭이 전혀 필요 없고 학년-반-번호-이름만
    // 있으면 된다 — 그래서 담임 학급 명렬표(class-roster.json)를 별도로 받아 여기(출결 패널의
    // 학생 선택)에만 얹었다. entityListOf('students')(학생 시간표 탭)는 이 함수를 안 거치므로
    // 그쪽엔 영향 없음(edutech-app 없이는 학생 시간표 탭 자체가 애초에 못 뜸 — 시간표 데이터가
    // 없어서 어차피 보여줄 수 없음, 출결만 별도로 굴러가는 구조).
    function studentsList() { return ((timetableData && timetableData.students) || []).concat(classRoster); }
    function sortByStr(arr) { return arr.sort(function (a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }); }
    function availableGrades() {
      var seen = {}, out = [];
      studentsList().forEach(function (s) {
        var k = String(s.grade);
        if (!seen[k]) { seen[k] = true; out.push(s.grade); }
      });
      return sortByStr(out);
    }
    function availableBans(grade) {
      var seen = {}, out = [];
      studentsList().forEach(function (s) {
        if (String(s.grade) !== String(grade)) return;
        var k = String(s.ban);
        if (!seen[k]) { seen[k] = true; out.push(s.ban); }
      });
      return sortByStr(out);
    }
    function availableStudentsOf(grade, ban) {
      return studentsList().filter(function (s) { return String(s.grade) === String(grade) && String(s.ban) === String(ban); })
        .sort(function (a, b) { return a.no - b.no; });
    }

    var noDataHint = document.createElement('div');
    noDataHint.className = 'att-hint';
    noDataHint.textContent = '시간표 데이터를 아직 못 불러왔습니다 — 드롭다운이 비어있으면 잠시 후 다시 열어주세요.';
    if (studentsList().length) noDataHint.hidden = true;

    var gradeDD = createMiniDropdown('학년');
    var banDD = createMiniDropdown('반');
    var noDD = createMiniDropdown('번호');

    function refreshGradeOptions() {
      gradeDD.setOptions(availableGrades().map(function (g) { return { value: g, label: g + '학년' }; }));
    }
    function refreshBanOptions() {
      banDD.setOptions(pickedGrade == null ? [] : availableBans(pickedGrade).map(function (b) { return { value: b, label: b + '반' }; }));
    }
    function refreshNoOptions() {
      noDD.setOptions((pickedGrade == null || pickedBan == null) ? [] : availableStudentsOf(pickedGrade, pickedBan).map(function (s) {
        return { value: s.no, label: s.no + '번 ' + s.studentName };
      }));
    }
    gradeDD.onSelect(function (v) {
      pickedGrade = v; pickedBan = null; pickedNo = null; selectedStudent = null;
      banDD.reset(); noDD.reset();
      refreshBanOptions();
      lastPick = { grade: v, ban: null }; saveLastPick();
    });
    banDD.onSelect(function (v) {
      pickedBan = v; pickedNo = null; selectedStudent = null;
      noDD.reset();
      refreshNoOptions();
      lastPick = { grade: pickedGrade, ban: v }; saveLastPick();
    });
    noDD.onSelect(function (v) {
      pickedNo = v;
      selectedStudent = availableStudentsOf(pickedGrade, pickedBan).filter(function (s) { return String(s.no) === String(v); })[0] || null;
    });
    refreshGradeOptions();
    // 고른 학년·반을 화면에 되살린다(번호는 비움).
    function applyPick() {
      pickedNo = null; selectedStudent = null; noDD.reset();
      if (pickedGrade != null) gradeDD.setLabel(pickedGrade + '학년'); else gradeDD.reset();
      refreshBanOptions();
      if (pickedBan != null) banDD.setLabel(pickedBan + '반'); else banDD.reset();
      refreshNoOptions();
    }
    (function restorePick() {
      if (lastPick.grade == null) return;
      var g = availableGrades().filter(function (x) { return String(x) === String(lastPick.grade); })[0];
      if (g == null) return;
      pickedGrade = g;
      if (lastPick.ban != null) {
        var b = availableBans(g).filter(function (x) { return String(x) === String(lastPick.ban); })[0];
        if (b != null) pickedBan = b;
      }
      applyPick();
    })();

    var pickerRow = document.createElement('div');
    pickerRow.className = 'att-picker-row';
    pickerRow.appendChild(gradeDD.el);
    pickerRow.appendChild(banDD.el);
    pickerRow.appendChild(noDD.el);

    function buttonGroup(options, getSelected, onPick, extraClass) {
      var wrap = document.createElement('div');
      wrap.className = 'att-btn-group' + (extraClass ? ' ' + extraClass : '');
      options.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'att-btn' + (getSelected() === opt ? ' active' : '');
        btn.textContent = opt;
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          onPick(opt);
          Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('active'); });
          btn.classList.add('active');
        });
        wrap.appendChild(btn);
      });
      return wrap;
    }
    // 교과/학급 출결 구분 — 출결 종합(openAttendanceSummary)의 탭과 같은 디자인을 그대로 써서
    // "그 구분도 입력할 때 보이게 해달라"는 요청에 맞췄다. 새 필드를 따로 만들지 않고(기존
    // attendanceCategoryOf 규칙을 그대로 따름), 카테고리를 고르면 "종류" 버튼 목록 자체가
    // 그 카테고리에 맞는 것만 남도록 좁혀서, 저장되는 type 값이 항상 카테고리와 일치하게 했다.
    // 학급/교과는 종류(결석·조퇴·지각·결과)와 별개로 고른다 — 어떤 종류든 학급 출결일 수도, 교과 출결일 수도 있다.
    var categoryTabRow = document.createElement('div');
    categoryTabRow.className = 'att-seg';
    var categoryBtns = ATTENDANCE_CATEGORIES.map(function (cat) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'att-seg-btn';
      b.textContent = cat;
      b.addEventListener('click', function (ev) { ev.stopPropagation(); setCategory(cat); });
      categoryTabRow.appendChild(b);
      return b;
    });

    var typeGroup = document.createElement('div');
    typeGroup.className = 'att-btn-group';
    function renderTypeButtons() {
      typeGroup.innerHTML = '';
      ATTENDANCE_TYPES.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'att-btn att-btn--' + ({ '결석': 'abs', '조퇴': 'early', '지각': 'late', '결과': 'out' }[opt] || 'abs') + (selectedType === opt ? ' active' : '');
        btn.textContent = opt;
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          selectedType = opt;
          Array.prototype.forEach.call(typeGroup.children, function (c) { c.classList.remove('active'); });
          btn.classList.add('active');
        });
        typeGroup.appendChild(btn);
      });
    }
    // 교과 카테고리는 선택지가 "결과" 하나뿐이라 버튼을 보여주는 것 자체가 군더더기라는 요청 —
    // ("교과담임은 그냥 체크만 하고, 어떤 사항인지는 담임이 확인해서 올린다") 학급 카테고리일
    // 때만 이 줄("종류": 결석/지각/조퇴 중 선택) 자체를 보여주고, 교과일 땐 통째로 숨긴다
    // (selectedType은 setCategory 안에서 이미 항상 "결과"로 맞춰지므로 값 자체는 정상 저장됨).
    var typeFieldRow = field('종류', typeGroup);
    function setCategory(cat) {
      selectedCategory = cat;
      categoryBtns.forEach(function (b, i) { b.classList.toggle('active', ATTENDANCE_CATEGORIES[i] === cat); });
      if (ATTENDANCE_TYPES.indexOf(selectedType) === -1) selectedType = ATTENDANCE_TYPES[0];
      renderTypeButtons();
      typeFieldRow.hidden = false;   // 종류 4개(결석·조퇴·지각·결과)를 항상 한 줄에 보여 준다
    }
    setCategory(selectedCategory);

    var reasonGroup = buttonGroup(ATTENDANCE_REASONS, function () { return selectedReason; }, function (v) { selectedReason = v; }, 'att-btn-group--reason');

    var memoInput = document.createElement('input');
    memoInput.className = 'att-memo-input';
    memoInput.placeholder = '교시, 사유 등 입력';
    memoInput.autocomplete = 'off';

    var addRow = document.createElement('div');
    addRow.className = 'att-add-row';
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'day-task-save';
    addBtn.textContent = '추가';
    var cancelEditBtn = document.createElement('button');
    cancelEditBtn.type = 'button';
    cancelEditBtn.className = 'day-task-del';
    cancelEditBtn.textContent = '수정 취소';
    cancelEditBtn.hidden = true;
    var addSpacer = document.createElement('div');
    addSpacer.style.flex = '1';
    addRow.appendChild(addSpacer);
    addRow.appendChild(addBtn);
    addRow.appendChild(cancelEditBtn);

    var listTitle = document.createElement('div');
    listTitle.className = 'att-list-title';
    listTitle.textContent = '이 날짜 출결 기록';
    var listCount = document.createElement('span');
    listCount.className = 'att-list-count';
    listTitle.appendChild(listCount);
    var list = document.createElement('div');
    list.className = 'att-record-list';

    function resetForm() {
      editingId = null;
      selectedReason = ATTENDANCE_REASONS[0];
      memoInput.value = '';
      applyPick();   // 학년·반은 그대로 두고 번호만 비운다
      selectedType = ATTENDANCE_TYPES[0];
      setCategory('학급');
      Array.prototype.forEach.call(reasonGroup.children, function (c, i) { c.classList.toggle('active', i === 0); });
      addBtn.textContent = '추가';
      cancelEditBtn.hidden = true;
    }

    function renderList() {
      list.innerHTML = '';
      var records = attendanceRecordsForDate(dateKey);
      listCount.textContent = ' (총 ' + records.length + '건)';
      if (!records.length) {
        var empty = document.createElement('div');
        empty.className = 'att-list-empty';
        empty.textContent = '이 날짜에 기록된 출결이 없습니다.';
        list.appendChild(empty);
        return;
      }
      records.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'att-record-row';
        var info = document.createElement('div');
        info.className = 'att-record-info';
        var name = document.createElement('div');
        name.className = 'att-record-name';
        name.textContent = attendanceStudentLabel(r) + ' ';
        var catTag = document.createElement('span');
        var recCat = attendanceCategoryOf(r);
        catTag.className = 'att-cat-tag att-cat-tag--' + (recCat === '교과' ? 'subject' : 'class');
        catTag.textContent = recCat;
        if (recCat === '교과') name.appendChild(catTag);   // 학급 출결만 쓰므로 예전 "교과" 기록에만 표시
        var meta = document.createElement('div');
        meta.className = 'att-record-meta';
        meta.textContent = attendanceTypeLabel(r) + (r.memo ? ' · ' + r.memo : '');
        info.appendChild(name);
        info.appendChild(meta);
        var btns = document.createElement('div');
        btns.className = 'att-record-btns';
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = '수정';
        editBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          editingId = r.id;
          pickedGrade = r.grade; pickedBan = r.ban; pickedNo = r.no;
          selectedStudent = { grade: r.grade, ban: r.ban, no: r.no, studentName: r.studentName, studentId: r.studentId };
          selectedType = r.type;
          selectedReason = r.reason;
          memoInput.value = r.memo || '';
          gradeDD.setLabel(r.grade + '학년');
          refreshBanOptions();
          banDD.setLabel(r.ban + '반');
          refreshNoOptions();
          noDD.setLabel(r.no + '번 ' + r.studentName);
          setCategory(attendanceCategoryOf(r));
          Array.prototype.forEach.call(reasonGroup.children, function (c) { c.classList.toggle('active', c.textContent === r.reason); });
          addBtn.textContent = '수정 저장';
          cancelEditBtn.hidden = false;
        });
        var rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.textContent = '삭제';
        rmBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          // 실수로 지워지지 않게 한 번 확인한다(교과 출결의 취소 확인과 같은 방식).
          if (!window.confirm(attendanceStudentLabel(r) + ' ' + attendanceTypeLabel(r) + ' 기록을 삭제할까요?\n(삭제해도 휴지통에서 되살릴 수 있어요.)')) return;
          if (window.BOARD) window.BOARD.trash('attendance', r);
          attendanceRecords = attendanceRecords.filter(function (x) { return x.id !== r.id; });
          attendanceTombstones[r.id] = Date.now();
          saveTombstones();
          saveAttendanceRecords();
          renderList();
          renderCalendar();
          if (editingId === r.id) resetForm();
        });
        btns.appendChild(editBtn);
        btns.appendChild(rmBtn);
        row.appendChild(info);
        row.appendChild(btns);
        list.appendChild(row);
      });
    }

    addBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!selectedStudent) return;
      if (editingId) {
        var rec = attendanceRecords.find(function (x) { return x.id === editingId; });
        if (rec) {
          rec.grade = selectedStudent.grade; rec.ban = selectedStudent.ban; rec.no = selectedStudent.no;
          rec.studentName = selectedStudent.studentName; rec.studentId = selectedStudent.studentId;
          rec.type = selectedType; rec.reason = selectedReason; rec.memo = memoInput.value.trim();
          rec.category = selectedCategory;
          rec.updatedAt = Date.now();
        }
      } else {
        attendanceRecords.push({
          id: dateKey + '-' + Math.random().toString(36).slice(2, 9),
          date: dateKey,
          grade: selectedStudent.grade, ban: selectedStudent.ban, no: selectedStudent.no,
          studentName: selectedStudent.studentName, studentId: selectedStudent.studentId,
          type: selectedType, reason: selectedReason, memo: memoInput.value.trim(),
          category: selectedCategory,
          updatedAt: Date.now()
        });
      }
      saveAttendanceRecords();
      resetForm();
      renderList();
      renderCalendar();
    });
    cancelEditBtn.addEventListener('click', function (ev) { ev.stopPropagation(); resetForm(); });

    function field(labelText, control) {
      var row = document.createElement('div');
      row.className = 'att-field-row';
      var label = document.createElement('div');
      label.className = 'att-field-label';
      label.textContent = labelText;
      row.appendChild(label);
      row.appendChild(control);
      return row;
    }

    panel.appendChild(noDataHint);
    panel.appendChild(field('학생', pickerRow));
    panel.appendChild(typeFieldRow);
    panel.appendChild(field('구분', reasonGroup));
    panel.appendChild(field('비고', memoInput));
    panel.appendChild(addRow);
    panel.appendChild(listTitle);
    panel.appendChild(list);
    renderList();

    // 이 패널 안에 미니 드롭다운이 3개(학년/반/번호) 있어서, 패널 밖(box)에서 클릭이 나면
    // 열려 있는 드롭다운을 닫아야 한다 — openDayTaskEditor의 box 클릭 핸들러가 이 함수를
    // 통해 호출한다.
    panel.closeMiniDropdowns = function (target) {
      [gradeDD, banDD, noDD].forEach(function (dd) {
        if (!dd.panelEl.contains(target) && !dd.el.contains(target)) dd.panelEl.hidden = true;
      });
    };
    return panel;
  }

  // 보고 있는 달(오늘이 기본) — 이전/다음 버튼으로 다른 달도 넘겨볼 수 있게.
  var calViewYear = null;
  var calViewMonth = null;

  function initCalNav() {
    var now = new Date();
    if (calViewYear === null) { calViewYear = now.getFullYear(); calViewMonth = now.getMonth(); }
    $('calPrevBtn').onclick = function () {
      calViewMonth -= 1;
      if (calViewMonth < 0) { calViewMonth = 11; calViewYear -= 1; }
      renderCalendar();
    };
    $('calNextBtn').onclick = function () {
      calViewMonth += 1;
      if (calViewMonth > 11) { calViewMonth = 0; calViewYear += 1; }
      renderCalendar();
    };
    $('calTodayBtn').onclick = function () {
      var t = new Date();
      calViewYear = t.getFullYear();
      calViewMonth = t.getMonth();
      renderCalendar();
    };
  }

  // ── 출결 종합(월간/학년도 전체) — 학생×종류(결석/지각/조퇴/결과)별로 한 줄씩, 그 안에서
  // 사유(질병/미인정/기타/출석인정)별 횟수까지 나눠서 보여준다("결석 중에 질병 1회, 미인정
  // 0회..." 요청). grade가 문자열이라(dashboard-timetable.json) 정렬도 숫자 뺄셈이 아니라
  // localeCompare(numeric)로 해야 안전 — 반/번호는 숫자라 그대로 뺄셈해도 됨.
  // 출결 종합 표에서 "M/D" 짧은 형식으로 날짜를 나열할 때 쓴다(YYYYMMDD → "8/17").
  function formatShortDate(ymdStr) {
    return (+ymdStr.slice(4, 6)) + '/' + (+ymdStr.slice(6, 8));
  }

  function aggregateAttendance(records) {
    var map = {};
    records.forEach(function (r) {
      var studentKey = r.studentId || (r.grade + '-' + r.ban + '-' + r.no + '-' + r.studentName);
      var key = studentKey + '|' + r.type;
      if (!map[key]) {
        map[key] = { grade: r.grade, ban: r.ban, no: r.no, studentName: r.studentName, type: r.type, reasonCounts: {}, total: 0, dates: [], items: [] };
        ATTENDANCE_REASONS.forEach(function (rs) { map[key].reasonCounts[rs] = 0; });
      }
      map[key].reasonCounts[r.reason] = (map[key].reasonCounts[r.reason] || 0) + 1;
      map[key].total += 1;
      map[key].dates.push(r.date);
      map[key].items.push({ date: r.date, reason: r.reason, memo: r.memo || '' });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      if (String(a.grade) !== String(b.grade)) return String(a.grade).localeCompare(String(b.grade), undefined, { numeric: true });
      if (a.ban !== b.ban) return a.ban - b.ban;
      if (a.no !== b.no) return a.no - b.no;
      return ATTENDANCE_TYPES.indexOf(a.type) - ATTENDANCE_TYPES.indexOf(b.type);
    });
  }

  // 출결 종합의 날짜 줄을 누르면 그 날짜의 캘린더 팝업(학급 또는 교과 탭)으로 바로 넘어간다.
  function jumpToDate(dateStr, which) {
    var d = String(dateStr || '');
    if (d.length !== 8) return;
    var date = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
    var ov = $('attSummaryOverlay'); if (ov) ov.remove();
    var sv = $('subjSummaryOverlay'); if (sv) sv.remove();
    calViewYear = date.getFullYear(); calViewMonth = date.getMonth();
    dayEditorTab = which === 'subject' ? 'subject' : 'attendance';
    setTab('calendar', true);
    setTimeout(function () { renderCalendar(); openDayTaskEditor(date); }, 60);
  }

  function closeAttendanceSummary() {
    var existing = document.getElementById('attSummaryOverlay');
    if (existing) existing.remove();
  }

  function initAttendanceSummary() {
    $('attendanceSummaryBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      openAttendanceSummary();
    });
  }

  // "이번 달"은 지금 화면에 떠 있는 달력 달(calViewYear/calViewMonth) 기준 — 다른 달을 보고
  // 있을 때 열면 그 달 기준으로 보여준다. "학년도 전체"는 기존 학사일정에서 쓰던 3월~다음해
  // 2월 범위(academicYearRange)를 그대로 재사용.
  var ATTENDANCE_CATEGORY_ICON = { '학급': '🏫', '교과': '📚' };

  function openAttendanceSummary() {
    closeAttendanceSummary();
    var mode = 'month';
    var category = '학급';

    var overlay = document.createElement('div');
    overlay.className = 'day-task-overlay';
    overlay.id = 'attSummaryOverlay';
    var box = document.createElement('div');
    box.className = 'day-task-box day-task-box--wide att-summary-box';

    var title = document.createElement('div');
    title.className = 'day-task-title';

    // 학급출결/교과출결 — "따로 관리할 수 있게 탭으로" 요청. 위 시간범위 탭과는 다른 축이라
    // 시각적으로도 구분되게(아이콘+알약 모양) 별도 줄로 뒀다.
    var categoryTabRow = document.createElement('div');
    categoryTabRow.className = 'att-category-tabs';
    var categoryBtns = ATTENDANCE_CATEGORIES.map(function (cat) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'att-category-tab';
      b.innerHTML = '<span class="att-category-tab-icon">' + ATTENDANCE_CATEGORY_ICON[cat] + '</span><span>' + cat + ' 출결</span>';
      b.addEventListener('click', function (ev) { ev.stopPropagation(); category = cat; render(); });
      categoryTabRow.appendChild(b);
      return b;
    });
    // 학급 출결만 쓰므로, 예전에 "교과"로 입력한 기록이 있을 때만 탭을 보여 준다(그 기록을 볼 수 있게).
    categoryTabRow.hidden = !attendanceRecords.some(function (r) { return attendanceCategoryOf(r) === '교과'; });

    // 학년도(3월~다음 해 2월) 드롭다운 + 월 드롭다운, 그 아래에 월별/1학기/2학기/학년도 전체 탭.
    var now0 = new Date();
    var selYear = academicYearRange(now0).start.getFullYear();
    var selMonthIdx = (now0.getMonth() + 10) % 12;   // 0 = 3월 … 11 = 2월
    var MODES = [['month', '월별'], ['sem1', '1학기'], ['sem2', '2학기'], ['year', '학년도 전체']];

    var pickRow = document.createElement('div');
    pickRow.className = 'att-pick-row';
    var yearSel = document.createElement('select');
    yearSel.className = 'att-summary-select';
    var monthSel = document.createElement('select');
    monthSel.className = 'att-summary-select';
    function fillYears() {
      var years = {}; years[academicYearRange(new Date()).start.getFullYear()] = true;
      attendanceRecords.forEach(function (r) { var d = r.date; var y = +d.slice(0, 4), mo = +d.slice(4, 6); years[mo >= 3 ? y : y - 1] = true; });
      years[selYear] = true;
      yearSel.innerHTML = '';
      Object.keys(years).map(Number).sort(function (a, c) { return c - a; }).forEach(function (y) {
        var o = document.createElement('option'); o.value = y; o.textContent = y + '학년도'; yearSel.appendChild(o);
      });
      yearSel.value = String(selYear);
    }
    function fillMonths() {
      monthSel.innerHTML = '';
      for (var i = 0; i < 12; i++) {
        var mo = (2 + i) % 12, yy = i <= 9 ? selYear : selYear + 1;
        var o = document.createElement('option'); o.value = i; o.textContent = (mo + 1) + '월'; o.title = yy + '년';
        monthSel.appendChild(o);
      }
      monthSel.value = String(selMonthIdx);
    }
    yearSel.addEventListener('change', function () { selYear = +yearSel.value; fillMonths(); render(); });
    monthSel.addEventListener('change', function () { selMonthIdx = +monthSel.value; render(); });
    pickRow.appendChild(yearSel); pickRow.appendChild(monthSel);

    var tabRow = document.createElement('div');
    tabRow.className = 'day-task-tabs';
    var modeBtns = MODES.map(function (p) {
      var bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'day-task-tab'; bt.textContent = p[1];
      bt.addEventListener('click', function (ev) { ev.stopPropagation(); mode = p[0]; render(); });
      tabRow.appendChild(bt);
      return bt;
    });

    // 학기 시작일 안내·바꾸기(1학기/2학기 탭에서만 보임)
    var semNote = document.createElement('div');
    semNote.className = 'att-sem-note';
    function showSemEditor() {
      var old = $('attSemEditor'); if (old) { old.remove(); return; }
      var box2 = document.createElement('div'); box2.id = 'attSemEditor'; box2.className = 'att-sem-editor';
      var cur = semesterStartOf(selYear);
      var lab = document.createElement('div'); lab.className = 'att-sem-editor-title'; lab.textContent = selYear + '학년도 2학기 시작일';
      var inp = document.createElement('input'); inp.type = 'date'; inp.value = cur.slice(0, 4) + '-' + cur.slice(4, 6) + '-' + cur.slice(6, 8);
      inp.addEventListener('change', function () { if (inp.value) { setSemesterStart(selYear, inp.value.split('-').join('')); box2.remove(); render(); } });
      var cand = document.createElement('div'); cand.className = 'att-sem-cands'; cand.textContent = '학교 학사일정에서 찾는 중…';
      var reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '기본(9월 1일)으로';
      reset.addEventListener('click', function (ev) { ev.stopPropagation(); setSemesterStart(selYear, ''); box2.remove(); render(); });
      box2.appendChild(lab); box2.appendChild(inp); box2.appendChild(cand); box2.appendChild(reset);
      box2.addEventListener('click', function (ev) { ev.stopPropagation(); });
      semNote.parentNode.insertBefore(box2, semNote.nextSibling);
      // 학사일정(NEIS)의 "개학" 행사에서 후보를 보여 준다(학년별로 날짜가 다를 수 있다).
      var from = String(selYear) + '0701', to = String(selYear) + '0930';
      var neis = CONFIG.neis;
      fetch('https://open.neis.go.kr/hub/SchoolSchedule?KEY=' + neis.key + '&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=' + neis.officeCode + '&SD_SCHUL_CODE=' + neis.schoolCode + '&AA_FROM_YMD=' + from + '&AA_TO_YMD=' + to)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var rows = (d.SchoolSchedule && d.SchoolSchedule[1] && d.SchoolSchedule[1].row) || [];
          var hits = rows.filter(function (r) { return /개학/.test(r.EVENT_NM) && !/입학/.test(r.EVENT_NM); });
          cand.textContent = hits.length ? '학사일정: ' : '학사일정에서 개학일을 찾지 못했습니다.';
          hits.forEach(function (h) {
            var bt = document.createElement('button'); bt.type = 'button';
            bt.textContent = (+h.AA_YMD.slice(4, 6)) + '월 ' + (+h.AA_YMD.slice(6, 8)) + '일 ' + h.EVENT_NM;
            bt.addEventListener('click', function (ev) { ev.stopPropagation(); setSemesterStart(selYear, h.AA_YMD); box2.remove(); render(); });
            cand.appendChild(bt);
          });
        })
        .catch(function () { cand.textContent = '학사일정을 불러오지 못했습니다.'; });
    }

    var tableWrap = document.createElement('div');
    tableWrap.className = 'att-summary-table-wrap';

    function render() {
      var acStart = ymd(new Date(selYear, 2, 1)), acEnd = ymd(new Date(selYear + 1, 2, 0));
      var semStart = semesterStartOf(selYear);
      if (semStart <= acStart || semStart > acEnd) semStart = String(selYear) + '0901';
      var from, to, rangeLabel;
      if (mode === 'month') {
        var mo = (2 + selMonthIdx) % 12, yy = selMonthIdx <= 9 ? selYear : selYear + 1;
        from = ymd(new Date(yy, mo, 1)); to = ymd(new Date(yy, mo + 1, 0));
        rangeLabel = selYear + '학년도 ' + (mo + 1) + '월';
      } else if (mode === 'sem1') {
        from = acStart; to = ymd(new Date(+semStart.slice(0, 4), +semStart.slice(4, 6) - 1, +semStart.slice(6, 8) - 1));
        rangeLabel = selYear + '학년도 1학기';
      } else if (mode === 'sem2') {
        from = semStart; to = acEnd;
        rangeLabel = selYear + '학년도 2학기';
      } else {
        from = acStart; to = acEnd;
        rangeLabel = selYear + '학년도';
      }
      var records = attendanceRecords.filter(function (r) { return r.date >= from && r.date <= to; });
      monthSel.hidden = mode !== 'month';
      var showSem = mode === 'sem1' || mode === 'sem2';
      if (showSem && !prefs.some(function (x) { return x.id === 'sem-' + selYear && x.date; })) {
        ensureSemAuto(selYear).then(function (changed) { if (changed && $('attSummaryOverlay')) render(); });
      }
      semNote.hidden = !showSem;
      if (showSem) {
        semNote.innerHTML = '';
        var fm = function (d) { return (+d.slice(4, 6)) + '월 ' + (+d.slice(6, 8)) + '일'; };
        var txt = document.createElement('span');
        txt.textContent = mode === 'sem1' ? '1학기: ' + fm(acStart) + ' ~ ' + fm(to) : '2학기: ' + fm(semStart) + ' ~ ' + fm(acEnd);
        var chg = document.createElement('button'); chg.type = 'button'; chg.textContent = '2학기 시작일 바꾸기';
        chg.addEventListener('click', function (ev) { ev.stopPropagation(); showSemEditor(); });
        semNote.appendChild(txt); semNote.appendChild(chg);
      } else { var oe = $('attSemEditor'); if (oe) oe.remove(); }
      fillYears();
      records = records.filter(function (r) { return attendanceCategoryOf(r) === category; });
      title.textContent = '출결 종합 · ' + rangeLabel + ' · ' + category + '출결';
      modeBtns.forEach(function (bt, i) { bt.classList.toggle('active', MODES[i][0] === mode); });
      categoryBtns.forEach(function (b, i) { b.classList.toggle('active', ATTENDANCE_CATEGORIES[i] === category); });

      var agg = aggregateAttendance(records);
      tableWrap.innerHTML = '';
      if (!agg.length) {
        var empty = document.createElement('div');
        empty.className = 'att-list-empty';
        empty.textContent = '기록된 출결이 없습니다.';
        tableWrap.appendChild(empty);
        return;
      }
      var table = document.createElement('div');
      table.className = 'att-summary-table';
      var head = document.createElement('div');
      head.className = 'att-summary-row att-summary-row--head';
      ['학생', '종류'].concat(ATTENDANCE_REASONS, ['합계']).forEach(function (h) {
        var c = document.createElement('div'); c.textContent = h; head.appendChild(c);
      });
      table.appendChild(head);
      agg.forEach(function (row) {
        var r = document.createElement('div');
        r.className = 'att-summary-row';
        var nameCell = document.createElement('div');
        var nameLine = document.createElement('div');
        nameLine.textContent = row.grade + '-' + row.ban + ' ' + row.no + '번 ' + row.studentName;
        var caret = document.createElement('span');
        caret.className = 'att-summary-caret';
        caret.textContent = '▸';
        nameLine.appendChild(caret);
        nameCell.appendChild(nameLine);
        r.appendChild(nameCell);
        r.classList.add('att-summary-row--click');
        var typeCell = document.createElement('div');
        typeCell.textContent = row.type;
        typeCell.className = 'att-summary-type';
        r.appendChild(typeCell);
        ATTENDANCE_REASONS.forEach(function (rs) {
          var c = document.createElement('div');
          c.textContent = row.reasonCounts[rs] || 0;
          r.appendChild(c);
        });
        var totalCell = document.createElement('div');
        totalCell.textContent = row.total;
        totalCell.className = 'att-summary-total';
        r.appendChild(totalCell);
        // 줄을 누르면 이 학생·종류의 기록이 날짜순으로 한 줄씩(날짜 · 사유+종류 · 비고) 펼쳐진다.
        var item = document.createElement('div');
        item.className = 'att-summary-item';
        var detail = document.createElement('div');
        detail.className = 'att-sum-detail';
        detail.hidden = true;
        row.items.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (it) {
          var line = document.createElement('div');
          line.className = 'att-sum-detail-line att-sum-detail-line--go';
          line.title = '누르면 캘린더의 그 날짜로 이동해요';
          line.addEventListener('click', function (ev2) { ev2.stopPropagation(); jumpToDate(it.date, 'attendance'); });
          var d = document.createElement('b'); d.textContent = formatShortDate(it.date);
          var lab = document.createElement('span'); lab.textContent = it.reason + row.type;
          line.appendChild(d); line.appendChild(lab);
          if (it.memo) { var memo = document.createElement('i'); memo.textContent = it.memo; line.appendChild(memo); }
          detail.appendChild(line);
        });
        r.addEventListener('click', function (ev) {
          ev.stopPropagation();
          detail.hidden = !detail.hidden;
          caret.textContent = detail.hidden ? '▸' : '▾';
          r.classList.toggle('att-summary-row--open', !detail.hidden);
        });
        item.appendChild(r);
        item.appendChild(detail);
        table.appendChild(item);
      });
      tableWrap.appendChild(table);
    }


    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'day-task-close day-task-close--bottom';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', function (ev) { ev.stopPropagation(); closeAttendanceSummary(); });

    box.appendChild(title);
    box.appendChild(pickRow);
    box.appendChild(tabRow);
    box.appendChild(semNote);
    box.appendChild(categoryTabRow);
    box.appendChild(tableWrap);
    box.appendChild(closeBtn);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeAttendanceSummary(); });
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });

    $('board').appendChild(overlay);
    fillMonths();
    render();
  }

  // 캘린더 배지 아이콘은 위쪽 탭 버튼(학급출결·교과출결)의 아이콘을 그대로 가져와 같은 모양으로 보여 준다.
  function tabIconHtml(tab) {
    var svg = document.querySelector('.tabbtn[data-tab="' + tab + '"] svg');
    return svg ? svg.outerHTML : '';
  }

  // ── 휴대폰(폭 좁은 화면) 캘린더: 칸을 정사각형에 가깝게 두고, 남는 아래 공간에 "누른 날짜"의 일정·할 일·출결을 목록으로 보여 준다 ──
  var calSelected = null;       // 'YYYYMMDD'
  var calEventDays = {};        // 이번에 그린 달의 학사일정 이름
  function agendaMode() { return document.documentElement.hasAttribute('data-phone') || document.documentElement.getAttribute('data-shell') === 'tabs'; }   // 폰·태블릿·폴드 모두 같은 방식(칸은 배지, 아래에 목록)
  function dateFromKey(k) { return new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)); }

  function selectCalDate(key) {
    var d = dateFromKey(key);
    if (d.getFullYear() !== calViewYear || d.getMonth() !== calViewMonth) {   // 다른 달의 날짜를 눌렀으면 그 달로 넘어간다
      calViewYear = d.getFullYear(); calViewMonth = d.getMonth(); calSelected = key; renderCalendar(); return;
    }
    calSelected = key;
    Array.prototype.forEach.call(document.querySelectorAll('#calGrid .cal-cell'), function (c) { c.classList.toggle('cal-cell--sel', c.dataset.date === key); });
    renderAgenda();
    renderUpcoming();
  }

  // ── 휴대폰 "이번 달 학사일정" 버튼: 누르면 달력 자리에 그 달 학사일정 목록이 펼쳐진다 ──
  var eventsOpen = false;
  function eventRanges() {   // 같은 이름이 이어지는 날은 한 줄로 묶는다
    var keys = Object.keys(calEventDays).sort(), out = [];
    keys.forEach(function (k) {
      var last = out[out.length - 1], prev = last ? dateFromKey(last.to) : null;
      if (last && last.name === calEventDays[k] && prev && ymd(new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1)) === k) last.to = k;
      else out.push({ from: k, to: k, name: calEventDays[k] });
    });
    return out;
  }
  function applyEventsView() {
    var btn = $('calEventsBtn'), list = $('calEventsList');
    if (!btn || !list) return;
    var on = agendaMode(), ranges = eventRanges();
    btn.hidden = !on;
    if (!on) { list.hidden = true; $('calWeekdays').hidden = false; $('calGrid').hidden = false; return; }
    var open = eventsOpen;
    btn.classList.toggle('open', open);
    btn.innerHTML = '';
    var t = document.createElement('b'); t.textContent = (calViewMonth + 1) + '월 학사일정';
    var n = document.createElement('span'); n.className = 'cal-events-cnt'; n.textContent = ranges.length;
    var ar = document.createElement('span'); ar.className = 'cal-events-arrow'; ar.textContent = open ? '▲' : '▼';
    btn.appendChild(t); btn.appendChild(n); btn.appendChild(ar);
    list.hidden = !open;
    $('calWeekdays').hidden = open; $('calGrid').hidden = open;
    if (open) { $('calAgenda').hidden = true; if ($('calUpcoming')) $('calUpcoming').hidden = true; } else { renderAgenda(); renderUpcoming(); }
    list.innerHTML = '';
    if (!ranges.length) { var em = document.createElement('div'); em.className = 'cal-events-empty'; em.textContent = '이 달에는 학사일정이 없어요.'; list.appendChild(em); return; }
    ranges.forEach(function (r) {
      var row = document.createElement('button'); row.type = 'button'; row.className = 'cal-events-row';
      var f = dateFromKey(r.from), d = document.createElement('span'); d.className = 'cal-events-date';
      var txt = (f.getMonth() + 1) + '/' + f.getDate() + '(' + dayLabel(f.getDay()) + ')';
      if (r.to !== r.from) { var tt = dateFromKey(r.to); txt += ' ~ ' + (tt.getMonth() + 1) + '/' + tt.getDate() + '(' + dayLabel(tt.getDay()) + ')'; }
      d.textContent = txt;
      var nm = document.createElement('span'); nm.className = 'cal-events-name'; nm.textContent = r.name;
      row.appendChild(d); row.appendChild(nm);
      row.addEventListener('click', function () { eventsOpen = false; selectCalDate(r.from); applyEventsView(); });
      list.appendChild(row);
    });
    // 날짜 칸 너비를 가장 긴 날짜에 맞춰, 일정 이름이 모두 같은 자리에서 시작하게 한다
    if (open) {
      list.style.removeProperty('--evw');
      var mw = 0; Array.prototype.forEach.call(list.querySelectorAll('.cal-events-date'), function (x) { mw = Math.max(mw, x.offsetWidth); });
      if (mw) list.style.setProperty('--evw', mw + 'px');
    }
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('#calEventsBtn') : null;
    if (b) { eventsOpen = !eventsOpen; applyEventsView(); }
  });

  // ── "다가오는 일정": 오늘부터 30일 안의 학사일정·메모를 D-day와 함께 모은다 ──
  // 중요(★) 메모가 맨 위, 그다음 가까운 날짜순. 줄 왼쪽 손잡이(⋮⋮)를 끌어 순서를 바꿀 수 있고(저장·동기화),
  // 메모 줄의 ★·Aa 버튼으로 중요 표시와 색·글꼴·크기를 바꾼다(메모 탭의 "꾸미기"와 같은 설정).
  var upExpanded = false, upToken = 0;
  function renderUpcoming() {
    var box = $('calUpcoming');
    if (!box) return;
    if (!agendaMode() || eventsOpen) { box.hidden = true; return; }
    var my = ++upToken;
    var today = new Date(); today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
    var fromKey = ymd(today), toKey = ymd(end);
    var months = [{ y: today.getFullYear(), m: today.getMonth() }];
    if (end.getMonth() !== today.getMonth()) months.push({ y: end.getFullYear(), m: end.getMonth() });
    Promise.all(months.map(function (mm) { return Promise.resolve(fetchMonthEvents(mm.y, mm.m)).then(function (d) { return d || {}; }, function () { return {}; }); })).then(function (maps) {
      if (my !== upToken) return;
      var evMap = Object.assign.apply(null, [{}].concat(maps));
      var items = [];
      var days = Object.keys(evMap).filter(function (k) { return k >= fromKey && k <= toKey; }).sort();
      days.forEach(function (k) {
        var last = items[items.length - 1];
        var prev = last && last.kind === 'event' ? dateFromKey(last.end) : null;
        if (last && last.kind === 'event' && last.text === evMap[k] && prev && ymd(new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1)) === k) last.end = k;
        else items.push({ id: 'e:' + k + ':' + evMap[k], kind: 'event', start: k, end: k, text: evMap[k] });
      });
      ((window.BOARD && window.BOARD.upcoming) ? window.BOARD.upcoming(fromKey, toKey) : []).forEach(function (c) {
        items.push({ id: 'm:' + c.id, kind: 'memo', cid: c.id, start: c.date, end: c.dateEnd || c.date, text: String(c.text || '').split(String.fromCharCode(10))[0], star: !!c.star });
      });
      // 선택한 날짜에 걸리는 항목은 아래 목록이 보여 주므로 여기서는 뺀다(위아래가 겹쳐 보이지 않게)
      items = items.filter(function (it) { return !(calSelected && it.start <= calSelected && calSelected <= it.end); });
      items.forEach(function (it) { it.eff = it.start < fromKey ? fromKey : it.start; });
      items.sort(function (x, y) { return (y.star ? 1 : 0) - (x.star ? 1 : 0) || (x.eff < y.eff ? -1 : x.eff > y.eff ? 1 : 0) || (x.kind === y.kind ? 0 : x.kind === 'event' ? -1 : 1); });
      var op = prefs.filter(function (x) { return x.id === 'upord'; })[0], ord = (op && op.order) || [];
      if (ord.length) items.sort(function (x, y) {
        var ix = ord.indexOf(x.id), iy = ord.indexOf(y.id);
        if (ix < 0 && iy < 0) return 0;
        return (ix < 0 ? 1e6 : ix) - (iy < 0 ? 1e6 : iy);
      });

      box.hidden = false; box.innerHTML = '';
      var head = document.createElement('div'); head.className = 'cal-up-head';
      var t = document.createElement('b'); t.textContent = '다가오는 일';
      var sm = document.createElement('small'); sm.textContent = '앞으로 30일 · 선택한 날 제외';
      head.appendChild(t); head.appendChild(sm); box.appendChild(head);
      if (!items.length) { var em = document.createElement('div'); em.className = 'cal-ag-empty'; em.textContent = '이 밖에 30일 안에 예정된 일이 없어요.'; box.appendChild(em); return; }
      var LIMIT = document.documentElement.hasAttribute('data-phone') ? 5 : 3;
      var shown = upExpanded ? items : items.slice(0, LIMIT);
      var list = document.createElement('div'); list.className = 'cal-up-list'; box.appendChild(list);
      var dd = function (it) {
        if (it.start <= fromKey && it.end >= fromKey) return '오늘';
        var n = Math.round((dateFromKey(it.start) - today) / 86400000);
        return n === 1 ? '내일' : 'D-' + n;
      };
      var shortDate = function (k) { return Number(k.slice(4, 6)) + '/' + Number(k.slice(6)); };
      shown.forEach(function (it) {
        var row = document.createElement('div'); row.className = 'cal-up-item' + (it.star ? ' star' : '') + (it.kind === 'event' ? ' ev' : ' memo');
        row.dataset.rid = it.id;
        var grip = document.createElement('span'); grip.className = 'cal-ag-grip'; grip.textContent = '⋮⋮'; grip.title = '끌어서 순서 바꾸기';
        var chip = document.createElement('span'); var d = dd(it); chip.className = 'cal-up-d' + (d === '오늘' ? ' today' : it.star ? ' star' : '');
        chip.textContent = d;
        var txt = document.createElement('span'); txt.className = 'cal-up-text';
        txt.textContent = it.text + (it.end !== it.start ? '  ~' + shortDate(it.end) : '');
        txt.title = it.text;
        row.appendChild(grip); row.appendChild(chip); row.appendChild(txt);
        var ed = dateFromKey(it.eff), dsp = document.createElement('span'); dsp.className = 'cal-up-date';
        dsp.textContent = (ed.getMonth() + 1) + '/' + ed.getDate() + '(' + dayLabel(ed.getDay()) + ')';
        row.appendChild(dsp);
        if (it.kind === 'memo') {
          var sb = document.createElement('button'); sb.type = 'button'; sb.className = 'cal-up-btn star' + (it.star ? ' on' : ''); sb.textContent = it.star ? '★' : '☆'; sb.title = '중요 표시';
          sb.addEventListener('click', function (ev) { ev.stopPropagation(); window.BOARD.toggleStarById(it.cid); });
          var ab = document.createElement('button'); ab.type = 'button'; ab.className = 'cal-up-btn'; ab.textContent = 'Aa'; ab.title = '색·글꼴·크기';
          ab.addEventListener('click', function (ev) { ev.stopPropagation(); window.BOARD.openStyleById(ab, it.cid); });
          row.appendChild(sb); row.appendChild(ab);
          if (window.BOARD.styleRow) window.BOARD.styleRow(row, txt, it.cid);
        }
        row.addEventListener('click', function () { selectCalDate(it.eff); });
        grip.addEventListener('click', function (ev) { ev.stopPropagation(); });
        grip.addEventListener('pointerdown', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          try { grip.setPointerCapture(ev.pointerId); } catch (e0) {}
          row.classList.add('dragging');
          var move = function (e) {
            var peers = Array.prototype.slice.call(list.querySelectorAll('.cal-up-item')).filter(function (r2) { return r2 !== row; });
            var placed = false;
            for (var pi = 0; pi < peers.length; pi++) {
              var rc = peers[pi].getBoundingClientRect();
              if (e.clientY < rc.top + rc.height / 2) { if (row.nextSibling !== peers[pi]) list.insertBefore(row, peers[pi]); placed = true; break; }
            }
            if (!placed && peers.length) { var lastp = peers[peers.length - 1]; if (lastp.nextSibling !== row) list.insertBefore(row, lastp.nextSibling); }
          };
          var up = function () {
            grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
            row.classList.remove('dragging');
            var ids = Array.prototype.map.call(list.querySelectorAll('.cal-up-item'), function (r3) { return r3.dataset.rid; });
            var rest = ord.filter(function (x) { return ids.indexOf(x) < 0; });
            var p2 = prefs.filter(function (x) { return x.id === 'upord'; })[0];
            if (!p2) { p2 = { id: 'upord' }; prefs.push(p2); }
            p2.order = ids.concat(rest); p2.updatedAt = Date.now(); savePrefs();
          };
          grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
        });
        list.appendChild(row);
      });
      if (items.length > LIMIT) {
        var more = document.createElement('button'); more.type = 'button'; more.className = 'cal-up-more';
        more.textContent = upExpanded ? '접기 ▴' : '+ ' + (items.length - LIMIT) + '개 더 보기 ▾';
        more.addEventListener('click', function () { upExpanded = !upExpanded; renderUpcoming(); });
        box.appendChild(more);
      }
    });
  }

  function renderAgenda() {
    var box = $('calAgenda');
    if (!box) return;
    if (!agendaMode() || !calSelected) { box.hidden = true; return; }
    var date = dateFromKey(calSelected);
    box.hidden = false;
    box.innerHTML = '';
    var head = document.createElement('div'); head.className = 'cal-ag-head';
    var ttl = document.createElement('b'); ttl.textContent = (date.getMonth() + 1) + '월 ' + date.getDate() + '일 (' + dayLabel(date.getDay()) + ')';
    var open = document.createElement('button'); open.type = 'button'; open.textContent = '입력·수정';
    open.addEventListener('click', function (ev) { ev.stopPropagation(); openDayTaskEditor(date); });
    head.appendChild(ttl); head.appendChild(open);
    box.appendChild(head);

    var items = [];
    // 학급·교과 출결은 번호순이 기본이고, 손잡이(⋮⋮)를 끌어 순서를 바꿀 수 있다(바꾼 순서는 날짜별로 저장·동기화).
    var agNo = function (x, y) { return (+x.grade - +y.grade) || (+x.ban - +y.ban) || (+x.no - +y.no); };
    var agOrdered = function (list, g) {
      var p = prefs.filter(function (x) { return x.id === 'agord-' + calSelected + '-' + g; })[0], ord = (p && p.order) || [];
      return list.slice().sort(function (x, y) {
        var ix = ord.indexOf(x.id), iy = ord.indexOf(y.id);
        if (ix < 0 && iy < 0) return 0;
        return (ix < 0 ? 1e6 : ix) - (iy < 0 ? 1e6 : iy);
      });
    };
    var saveAgOrder = function (g, ids) {
      var id = 'agord-' + calSelected + '-' + g, p = prefs.filter(function (x) { return x.id === id; })[0];
      if (!p) { p = { id: id }; prefs.push(p); }
      p.order = ids; p.updatedAt = Date.now(); savePrefs();
    };
    if (calEventDays[calSelected]) items.push({ c: '#3d7fd6', k: '학사일정', t: calEventDays[calSelected], tab: 'memo' });
    agOrdered(window.BOARD && window.BOARD.memosOn ? window.BOARD.memosOn(calSelected) : [], 'memo').forEach(function (mm) { items.push({ id: mm.id, g: 'memo', cid: mm.id, star: !!mm.star, c: '#2fa866', k: '메모', t: (mm.done ? '✓ ' : '') + mm.text + (mm.dateEnd && mm.dateEnd !== mm.date ? '  (' + Number(mm.date.slice(4, 6)) + '/' + Number(mm.date.slice(6)) + '~' + Number(mm.dateEnd.slice(4, 6)) + '/' + Number(mm.dateEnd.slice(6)) + ')' : ''), tab: 'memo' }); });
    agOrdered(attendanceRecordsForDate(calSelected).slice().sort(agNo), 'att').forEach(function (r) { items.push({ id: r.id, g: 'att', c: '#d6483f', k: '학급 출결', t: attendanceStudentLabel(r) + ' · ' + attendanceTypeLabel(r), d: r.memo ? r.memo : '', tab: 'attendance' }); });
    agOrdered(window.SUBJ ? window.SUBJ.listOn(calSelected) : [], 'subj').forEach(function (r) {
      items.push({ id: r.id, g: 'subj', c: '#8b7cf6', k: '교과 출결', t: r.period + '교시 ' + r.subject + ' ' + r.grade + '-' + r.ban + '-' + r.no + ' ' + r.studentName + ' · ' + (r.reason || '') + r.type, d: r.memo ? r.memo : '', tab: 'subject' });
    });
    if (!items.length) { var e = document.createElement('div'); e.className = 'cal-ag-empty'; e.textContent = '이 날짜에는 일정이 없어요.'; box.appendChild(e); return; }
    items.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'cal-ag-item' + (it.star ? ' starred' : '');
      var bar = document.createElement('i'); bar.style.background = it.c;
      var kind = document.createElement('span'); kind.className = 'cal-ag-kind'; kind.textContent = it.k; kind.style.color = it.c;
      var txt = document.createElement('span'); txt.className = 'cal-ag-text'; txt.textContent = it.t;
      row.appendChild(bar); row.appendChild(kind); row.appendChild(txt);
      if (it.g) {
        row.dataset.g = it.g; row.dataset.rid = it.id;
        var grip = document.createElement('span'); grip.className = 'cal-ag-grip'; grip.textContent = '⋮⋮'; grip.title = '끌어서 순서 바꾸기';
        row.insertBefore(grip, bar.nextSibling);
        grip.addEventListener('click', function (ev) { ev.stopPropagation(); });
        grip.addEventListener('pointerdown', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          try { grip.setPointerCapture(ev.pointerId); } catch (e0) {}
          row.classList.add('dragging');
          var move = function (e) {
            var peers = Array.prototype.slice.call(box.querySelectorAll('.cal-ag-item[data-g="' + it.g + '"]')).filter(function (r2) { return r2 !== row; });
            var placed = false;
            for (var pi = 0; pi < peers.length; pi++) {
              var rc = peers[pi].getBoundingClientRect();
              if (e.clientY < rc.top + rc.height / 2) { if (row.nextSibling !== peers[pi]) box.insertBefore(row, peers[pi]); placed = true; break; }
            }
            if (!placed && peers.length) { var last = peers[peers.length - 1]; if (last.nextSibling !== row) box.insertBefore(row, last.nextSibling); }
          };
          var up = function () {
            grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
            row.classList.remove('dragging');
            saveAgOrder(it.g, Array.prototype.map.call(box.querySelectorAll('.cal-ag-item[data-g="' + it.g + '"]'), function (r3) { return r3.dataset.rid; }));
          };
          grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
        });
      }
      if (it.cid && window.BOARD) {
        var sb2 = document.createElement('button'); sb2.type = 'button'; sb2.className = 'cal-up-btn star' + (it.star ? ' on' : ''); sb2.textContent = it.star ? '★' : '☆'; sb2.title = '중요 표시';
        sb2.addEventListener('click', function (ev) { ev.stopPropagation(); window.BOARD.toggleStarById(it.cid); });
        var ab2 = document.createElement('button'); ab2.type = 'button'; ab2.className = 'cal-up-btn'; ab2.textContent = 'Aa'; ab2.title = '색·글꼴·크기';
        ab2.addEventListener('click', function (ev) { ev.stopPropagation(); window.BOARD.openStyleById(ab2, it.cid); });
        row.appendChild(sb2); row.appendChild(ab2);
        if (window.BOARD.styleRow) window.BOARD.styleRow(row, txt, it.cid);
      }
      var openEditor = function () { dayEditorTab = it.tab; openDayTaskEditor(date); };
      if (it.d) {   // 사유·메모가 있으면 누를 때 세부사항을 펼친다(수정은 펼친 곳의 버튼으로)
        row.classList.add('cal-ag-item--more');
        var det = document.createElement('div'); det.className = 'cal-ag-detail'; det.hidden = true;
        var dt = document.createElement('span'); dt.textContent = it.d;
        var eb = document.createElement('button'); eb.type = 'button'; eb.textContent = '수정';
        eb.addEventListener('click', function (ev) { ev.stopPropagation(); openEditor(); });
        det.appendChild(dt); det.appendChild(eb); row.appendChild(det);
        row.addEventListener('click', function (ev) { ev.stopPropagation(); det.hidden = !det.hidden; row.classList.toggle('open', !det.hidden); });
      } else {
        row.addEventListener('click', function (ev) { ev.stopPropagation(); openEditor(); });
      }
      box.appendChild(row);
    });
  }

  // 캘린더 칸 배지 아이콘: 학급(체크 상자) / 교과(클립보드) / 메모(쪽지). 색은 글자색(currentColor)을 따른다.
  function badgeIcon(kind) {
    var open = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
    if (kind === 'cls') return open + '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12.5l2.7 2.7L16 9.5"/></svg>';
    if (kind === 'subj') return open + '<rect x="5" y="4.5" width="14" height="16.5" rx="3"/><path d="M9 4.5V3h6v1.5"/><path d="M8.5 11.5l1.6 1.6 2.9-3M8.5 17h7"/></svg>';
    if (kind === 'event') return open + '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>';
    if (kind === 'star') return open + '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>';
    return open + '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M9 12.5h7M9 16.5h5"/></svg>';
  }

  function renderCalendar() {
    var now = new Date();
    if (calViewYear === null) { calViewYear = now.getFullYear(); calViewMonth = now.getMonth(); }
    var year = calViewYear, month = calViewMonth;
    var titleText = year + '년 ' + (month + 1) + '월';
    if (year === now.getFullYear() && month === now.getMonth()) titleText += ' · 이번 달';
    $('calendarTitle').textContent = titleText;
    // 탭 화면: 제목은 숨기고, 가운데 "오늘" 버튼 자리에 보고 있는 달(예: 10월)을 보여 준다. 누르면 이번 달로 돌아온다.
    // 올해가 아닌 해를 보고 있을 때만 해를 앞에 붙인다.
    if (isTabShell()) {
      var mb = $('calTodayBtn');
      mb.textContent = (year === now.getFullYear() ? '' : year + '년 ') + (month + 1) + '월';
      mb.title = '이번 달로 돌아가기';
    }

    var wd = $('calWeekdays');
    wd.innerHTML = '';
    WEEKDAY_LABELS.forEach(function (label, i) {
      var cell = document.createElement('div');
      cell.textContent = label;
      if (i === 0) cell.classList.add('cal-weekday--sun');
      else if (i === 6) cell.classList.add('cal-weekday--sat');
      wd.appendChild(cell);
    });

    fetchMonthEvents(year, month).then(function (eventDays) {
      var grid = $('calGrid');
      grid.innerHTML = '';
      calEventDays = eventDays || {};
      // 선택한 날짜: 보고 있는 달 안이어야 한다(아니면 오늘 또는 그 달 1일)
      var selOk = calSelected && calSelected.slice(0, 6) === year + String(month + 1).padStart(2, '0');
      if (!selOk) calSelected = (year === now.getFullYear() && month === now.getMonth()) ? ymd(now) : ymd(new Date(year, month, 1));

      var firstWeekday = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var daysInPrevMonth = new Date(year, month, 0).getDate();
      var todayStr = ymd(now);

      var totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
      for (var i = 0; i < totalCells; i++) {
        var dayNum = i - firstWeekday + 1;
        var cell = document.createElement('div');
        cell.className = 'cal-cell';

        var cellDate, inMonth;
        if (dayNum < 1) {
          cellDate = new Date(year, month - 1, daysInPrevMonth + dayNum);
          inMonth = false;
        } else if (dayNum > daysInMonth) {
          cellDate = new Date(year, month + 1, dayNum - daysInMonth);
          inMonth = false;
        } else {
          cellDate = new Date(year, month, dayNum);
          inMonth = true;
        }

        var num = document.createElement('div');
        num.className = 'cal-num';
        num.textContent = cellDate.getDate();
        cell.appendChild(num);

        var eventName = eventDays[ymd(cellDate)];
        if (eventName) {
          var label = document.createElement('div');
          label.className = 'cal-event-label';
          label.textContent = eventName;
          label.title = eventName;
          cell.appendChild(label);
          cell.classList.add('cal-cell--event');
        }

        // 날짜를 지정한 메모(메모 탭의 카드): 첫 메모를 초록 한 줄로, 여러 개면 "메모 N"
        var dayMemos = window.BOARD && window.BOARD.memosOn ? window.BOARD.memosOn(ymd(cellDate)) : [];
        if (dayMemos.length && !agendaMode()) {
          var ml = document.createElement('div');
          ml.className = 'cal-memo-label' + (dayMemos[0].done && dayMemos.length === 1 ? ' done' : '');
          ml.textContent = dayMemos.length === 1 ? dayMemos[0].text.split('\n')[0] : '메모 ' + dayMemos.length;
          ml.title = dayMemos.map(function (m2) { return (m2.done ? '✓ ' : '') + m2.text; }).join('\n');
          cell.appendChild(ml);
        }

        // 학급 출결 / 교과 출결 / (휴대폰에서는) 메모는 칸이 좁아서 이름 대신 작은 배지(건수)로 보여 준다.
        // 색은 아래 목록·팝업과 같다: 학급=빨강, 교과=보라, 메모=초록. 자세한 건 날짜를 눌러 본다.
        var attRecords = attendanceRecordsForDate(ymd(cellDate));
        var subjRecords = window.SUBJ ? window.SUBJ.listOn(ymd(cellDate)) : [];
        var memoBadgeRecs = agendaMode() ? dayMemos : [];
        var eventBadge = agendaMode() && eventName;
        if (attRecords.length || subjRecords.length || memoBadgeRecs.length || eventBadge) {
          var badges = document.createElement('div');
          badges.className = 'cal-badges';
          var addBadge = function (kind, count, title) {
            var b = document.createElement('span');
            b.className = 'cal-badge cal-badge--' + kind;
            b.innerHTML = badgeIcon(kind) + '<b></b>';
            b.lastChild.textContent = count;
            if (count === '') b.lastChild.remove();
            b.title = title;
            badges.appendChild(b);
          };
          if (eventBadge) addBadge('event', '', '학사일정\n' + eventName);
          if (memoBadgeRecs.length) addBadge(memoBadgeRecs.some(function (m4) { return m4.star; }) ? 'star' : 'memo', memoBadgeRecs.length, '메모\n' + memoBadgeRecs.map(function (m3) { return (m3.done ? '✓ ' : '') + m3.text; }).join('\n'));
          if (attRecords.length) addBadge('cls', attRecords.length, '학급 출결\n' + attRecords.map(function (r) { return attendanceStudentLabel(r) + ' - ' + attendanceTypeLabel(r); }).join('\n'));
          if (subjRecords.length) addBadge('subj', subjRecords.length, '교과 출결\n' + subjRecords.map(function (r) { return r.period + '교시 ' + r.studentName + ' - ' + r.type; }).join('\n'));
          cell.appendChild(badges);
        }

        // 토요일=파랑, 일요일=빨강, 공휴일(대체공휴일 포함 — NEIS 학사일정 이름에 "공휴일"이
        // 들어간 날)은 일요일과 동일하게 표시해서 평일과 구분되게 했다.
        var dow = cellDate.getDay();
        if ((eventName && eventName.indexOf('공휴일') !== -1) || neisHolidays[ymd(cellDate)]) cell.classList.add('cal-cell--sun');
        else if (dow === 0) cell.classList.add('cal-cell--sun');
        else if (dow === 6) cell.classList.add('cal-cell--sat');

        if (!inMonth) cell.classList.add('cal-cell--other');
        if (ymd(cellDate) === todayStr) cell.classList.add('cal-cell--today');

        cell.dataset.date = ymd(cellDate);
        if (agendaMode() && ymd(cellDate) === calSelected) cell.classList.add('cal-cell--sel');
        (function (clickDate) {
          cell.addEventListener('click', function () { if (agendaMode()) selectCalDate(ymd(clickDate)); else openDayTaskEditor(clickDate); });
        })(cellDate);

        grid.appendChild(cell);
      }
      renderAgenda();
      renderUpcoming();
      applyEventsView();
    });
  }

  // ── 시간표(edutech-app에서 내보낸 JSON, 주간 그리드로 표시) ──
  // 탭 3개(교사/학급/학생)로 나눠 보여준다 — edutech-app이 이미 세 가지를 다 내보내므로(교사별
  // 시간표 탭의 "배경화면 데이터 내보내기"가 학급별·학생 개별 시간표까지 계산해서 함께 담음),
  // 위젯 쪽은 탭에 따라 timetableData.teachers/classes/students 중 하나를 골라 보여주기만 하면 된다.
  var timetableData = null;
  // 담임 학급 명렬표(edutech-app 내보내기엔 없는 자료 — 출결 입력 학생 선택에만 쓴다,
  // studentsList() 참고). 자퇴·전출·제적 표시된 학생은 미리 빼고 등록하는 관례(원래 번호는
  // 그대로 유지, 빠진 번호는 그 학생 자리). edutech-app 없이 이 대시보드만 받은 교사는
  // setup.html로 이 파일을 직접 만들 수 있다.
  var classRoster = [];
  function loadClassRoster() {
    return fetch('./class-roster.json')
      .then(function (res) { return res.json(); })
      .then(function (data) { classRoster = data; })
      .catch(function (err) {
        console.error('명렬표 로드 실패:', err);
        classRoster = [];
      });
  }
  var selectedView = 'teachers'; // 'teachers' | 'classes' | 'students'
  var selectedEntityId = { teachers: null, classes: null, students: null };
  var VIEW_STORAGE_KEY = 'dashboardTimetableView';
  var ENTITY_STORAGE_KEYS = { teachers: 'dashboardTeacherId', classes: 'dashboardClassName', students: 'dashboardStudentId' };
  var DAY_LABELS_MF = ['월', '화', '수', '목', '금'];

  function entityListOf(view) {
    return (timetableData && timetableData[view]) || [];
  }
  function entityIdOf(view, item) {
    if (view === 'teachers') return item.teacherId;
    if (view === 'classes') return item.className;
    return item.studentId;
  }
  function entityLabelOf(view, item) {
    if (view === 'teachers') return item.teacherName;
    if (view === 'classes') return item.className + '반';
    return item.grade + '-' + item.ban + ' ' + item.no + '번 ' + item.studentName;
  }

  function loadTimetable() {
    return fetch(CONFIG.timetableFile + '?t=' + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error('시간표 파일을 찾을 수 없음');
        return res.json();
      })
      .then(function (data) {
        timetableData = data;
        initViewTabs();
        setupEntitySelectOnce();
        refreshEntityForView();
        renderWeeklyTimetable();
      })
      .catch(function (err) {
        console.error('시간표 로드 실패:', err);
        renderTimetableError();
      });
  }

  function initViewTabs() {
    var saved = 'teachers';
    try { saved = localStorage.getItem(VIEW_STORAGE_KEY) || 'teachers'; } catch (e) {}
    selectedView = saved;
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.vtab'));
    tabs.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === selectedView);
      btn.onclick = function () {
        if (btn.dataset.view === selectedView) return;
        selectedView = btn.dataset.view;
        try { localStorage.setItem(VIEW_STORAGE_KEY, selectedView); } catch (e) {}
        tabs.forEach(function (b) { b.classList.toggle('active', b === btn); });
        refreshEntityForView();
        renderWeeklyTimetable();
      };
    });
  }

  // (교사/학급/학생 공용) 선택 드롭다운 — 네이티브 <select>가 Lively Wallpaper 안에서 팝업이
  // 깨져서(글씨 안 보임, 선택해도 안 바뀜) 직접 만든 버튼+목록 패널로 바꿨다. 학생은 357명이라
  // 검색창도 같이 둠(교사·학급은 목록이 짧아 검색창을 숨김). 탭·항목 선택 모두 localStorage에
  // 저장돼 다음에 열어도 그대로 유지된다.
  function setupEntitySelectOnce() {
    var btn = $('entitySelectBtn');
    var panel = $('entitySelectPanel');
    var searchInput = $('entitySearch');

    btn.onclick = function (ev) {
      ev.stopPropagation();
      if (panel.hidden) openEntityPanel(); else closeEntityPanel();
    };
    panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    searchInput.addEventListener('input', function () { renderEntityOptions(searchInput.value); });
    document.addEventListener('click', closeEntityPanel);

    // 마우스 휠이 안 먹는 환경(Lively/WebView2)을 위한 클릭 스크롤 버튼.
    $('entityScrollUpBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      $('entityOptions').scrollTop -= 160;
    });
    $('entityScrollDownBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      $('entityOptions').scrollTop += 160;
    });
  }

  // 버그 수정: 패널이 카드 안(overflow:hidden)에 그대로 있으면 마우스 휠 스크롤이 안 먹고,
  // 선택해도 안 닫히는 것처럼 보이는 문제가 있었다 — 카드의 overflow:hidden에 잘려서 실제
  // 그려지는 영역과 클릭 판정 영역이 어긋난 것으로 추정. 열 때마다 패널을 document.body로
  // 옮기고(한 번 옮기면 계속 거기 있음) position:fixed로 버튼 위치를 직접 계산해 붙인다 —
  // 그러면 어떤 카드의 overflow:hidden에도 안 걸린다.
  function openEntityPanel() {
    var btn = $('entitySelectBtn');
    var panel = $('entitySelectPanel');
    var searchInput = $('entitySearch');
    // body가 아니라 #board에 붙인다 — 테마 색 변수가 #board[data-theme=...] 스코프라 body
    // 바로 밑에 붙이면 배경색을 못 물려받아 투명해진다(day-task 팝업에서 겪은 것과 같은 버그).
    if (panel.parentElement !== $('board')) $('board').appendChild(panel);
    var r = btn.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = (r.bottom + 8) + 'px';
    panel.style.left = 'auto';
    panel.style.right = (window.innerWidth - r.right) + 'px';
    searchInput.hidden = selectedView !== 'students';
    searchInput.value = '';
    renderEntityOptions('');
    panel.hidden = false;
  }
  function closeEntityPanel() {
    $('entitySelectPanel').hidden = true;
  }

  function renderEntityOptions(filterText) {
    var view = selectedView;
    var list = entityListOf(view);
    var optionsWrap = $('entityOptions');
    optionsWrap.innerHTML = '';
    var filtered = list;
    var q = (filterText || '').trim();
    if (q) {
      filtered = list.filter(function (item) { return entityLabelOf(view, item).indexOf(q) !== -1; });
    }
    if (!filtered.length) {
      var empty = document.createElement('div');
      empty.className = 'ts-empty';
      empty.textContent = '결과 없음';
      optionsWrap.appendChild(empty);
      return;
    }
    filtered.forEach(function (item) {
      var id = entityIdOf(view, item);
      var opt = document.createElement('div');
      opt.className = 'ts-option' + (id === selectedEntityId[view] ? ' ts-option--active' : '');
      opt.textContent = entityLabelOf(view, item);
      opt.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selectEntity(id);
      });
      optionsWrap.appendChild(opt);
    });
  }

  function selectEntity(id) {
    var view = selectedView;
    selectedEntityId[view] = id;
    try { localStorage.setItem(ENTITY_STORAGE_KEYS[view], id); } catch (e) {}
    updateEntityLabel();
    closeEntityPanel();
    renderWeeklyTimetable();
  }

  function updateEntityLabel() {
    var view = selectedView;
    var list = entityListOf(view);
    var id = selectedEntityId[view];
    var item = list.find(function (x) { return entityIdOf(view, x) === id; });
    $('entitySelectLabel').textContent = item ? entityLabelOf(view, item) : '이름 선택';
  }

  // 탭을 바꿨을 때(또는 처음 로드 시) 그 탭에서 마지막으로 골랐던 항목을 localStorage에서
  // 복원하거나, 없으면 첫 항목으로.
  // 저장된 선택이 없을 때(처음 실행, 또는 Lively가 재시작되며 localStorage를 지워버렸을 때
  // — 디스크 캐시를 켜도 가끔 발생) 그냥 목록 맨 앞 사람으로 떨어지면 "매번 내 시간표로 다시
  // 바꿔야 한다"는 불편이 생긴다 — "교사" 탭만은 config.js의 myTeacherName과 이름이 일치하는
  // 사람을 기본값으로 우선 찾는다(찾으면 그 사람, 없으면 기존처럼 목록 맨 앞).
  function defaultEntityId(view, list) {
    if (view === 'teachers') {
      // 기본 선생님이 정해져 있지 않으면(배포본) 아무도 고르지 않은 채로 시작해 이름을 직접 고르게 한다.
      var mine = CONFIG.myTeacherName && list.find(function (item) { return item.teacherName === CONFIG.myTeacherName; });
      return mine ? entityIdOf(view, mine) : null;
    }
    return list[0] && entityIdOf(view, list[0]);
  }

  function refreshEntityForView() {
    var view = selectedView;
    var list = entityListOf(view);
    var saved = null;
    try { saved = localStorage.getItem(ENTITY_STORAGE_KEYS[view]); } catch (e) {}
    var stillExists = list.some(function (item) { return entityIdOf(view, item) === saved; });
    selectedEntityId[view] = stillExists ? saved : defaultEntityId(view, list);
    updateEntityLabel();
  }

  // 긴 과목명을 칸에 맞게 줄여 보여준다(사용자가 직접 정한 줄임말) — 폭이 좁을 때(fitTimetableFont)
  // 폰트를 줄이는 것만으론 부족했던 유난히 긴 과목명들을 아예 짧은 이름으로 표시. 색 배정
  // (subjectColor)·데이터 자체는 원래 과목명(entry.subject) 그대로 쓰고, 화면 표시만 바꾼다.
  var SUBJECT_ABBREV = {
    '창의적 체험활동': '창체',
    '데이터베이스 프로그래밍': '데베프',
    '수학적 사고와 통계': '수사통',
    '수학적 사고와 적분': '수사적',
    '영어 독해와 작문': '영독',
    '음악 연주와 창작': '음악',
    '미술 감상과 비평': '미술',
    '동아시아역사기행': '동아',
    '영미 문학 읽기': '영미',
    '진로/체육 탐구': '진로/체육',
    '지구시스템과학': '지구',
    '사회문제 탐구': '사문탐',
    '세포와물질대사': '세포',
    '화학반응의세계': '화학',
    '일본어 회화Ⅰ': '일본어',
    '인공지능기초': '인공지능',
    '언어와 매체': '언매',
    '한국지리탐구': '한지',
    '역학과에너지': '역학',
    '인문학과윤리': '윤리',
    '심화 영어Ⅰ': '심영',
    '생활과 윤리': '생윤',
    '화법과 작문': '화작',
    '과학과제연구': '과연',
    '컴퓨터 구조': '컴구'
  };
  function displaySubject(subject) {
    return SUBJECT_ABBREV[subject] || subject;
  }

  // 공동수업(선생님 2인 이상, "정재훈·이민경·강진원"처럼 가운뎃점으로 이어붙여 옴)은 과목명을
  // 줄여도 선생님 이름 줄 자체가 여전히 길어서 잘렸다 — 이름을 줄임말로 바꾸는 건 어색하니,
  // 캘린더 출결 칸에서 이미 쓰던 "OOO 외 N명" 패턴을 그대로 가져와 첫 선생님만 보여준다.
  // 전체 명단은 title 속성(마우스 오버)으로 확인 가능.
  function displayClassLabel(classLabel) {
    var names = classLabel.split('·');
    if (names.length <= 1) return classLabel;
    return names[0] + ' 외';
  }

  // 과목명 해시로 색을 고정 배정 — 같은 과목은 항상 같은 색(edutech-app의 subjectColor와 같은
  // 발상), 다른 과목·다른 선생님을 오갈 때 화면이 알록달록해지도록.
  // 수업이 있는 칸은 진하게, 공강은 연하게(--text-veryfaint) 대비를 주기 위해 배경 불투명도를
  // 올렸다(0.24~0.28 → 0.4 안팎) — 색상 자체(hue)는 그대로 유지.
  var SUBJECT_PALETTE = [
    { bg: 'rgba(139,124,246,0.4)', text: '#8b7cf6' },
    { bg: 'rgba(95,212,200,0.4)', text: '#2f9d8f' },
    { bg: 'rgba(246,124,166,0.4)', text: '#e0568f' },
    { bg: 'rgba(246,189,86,0.42)', text: '#c98a1a' },
    { bg: 'rgba(110,190,120,0.4)', text: '#3f9a52' },
    { bg: 'rgba(100,160,246,0.4)', text: '#3d7fd6' },
    { bg: 'rgba(246,140,90,0.4)', text: '#d9622a' },
    { bg: 'rgba(180,120,246,0.4)', text: '#9c4fd6' }
  ];
  function subjectColor(subject) {
    var hash = 0;
    for (var i = 0; i < subject.length; i++) hash = (hash * 31 + subject.charCodeAt(i)) >>> 0;
    return SUBJECT_PALETTE[hash % SUBJECT_PALETTE.length];
  }

  function currentPeriodIndex(periodTimes) {
    var now = new Date();
    var hm = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    for (var i = 0; i < periodTimes.length; i++) {
      var pt = periodTimes[i];
      if (pt && hm >= pt[0] && hm <= pt[1]) return i;
    }
    return -1;
  }

  // 아직 아무도 고르지 않았을 때(배포본의 첫 실행) — 이름을 고르도록 안내한다.
  function renderPickPrompt(view) {
    var wrap = $('weeklyGrid');
    wrap.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'wt-pick-prompt';
    row.textContent = '오른쪽 위에서 ' + (view === 'classes' ? '학급' : view === 'students' ? '학생' : '선생님 이름') + '을 골라 주세요.';
    wrap.appendChild(row);
  }

  function renderTimetableError() {
    var wrap = $('weeklyGrid');
    wrap.innerHTML = '';
    var row = document.createElement('div');
    row.style.gridColumn = '1 / -1';
    row.style.fontSize = '13px';
    row.style.color = 'var(--text-faint)';
    row.textContent = 'dashboard-timetable.json을 아직 못 읽었습니다 (edutech-app에서 내보내기 해주세요).';
    wrap.appendChild(row);
  }

  // 요일(월~금) × 교시 그리드 — edutech-app "교사별 시간표" 탭의 박스형 스타일(공강=점선)을
  // 가져오되, 요일 전체를 한 화면에 보여준다(참고한 스쿨보드류 제품의 "주간 시간표" 위젯처럼).
  function renderWeeklyTimetable() {
    if (!timetableData) return renderTimetableError();
    var view = selectedView;
    var list = entityListOf(view);
    var entity = list.find(function (x) { return entityIdOf(view, x) === selectedEntityId[view]; });
    if (!entity) return selectedEntityId[view] == null ? renderPickPrompt(view) : renderTimetableError();

    var jsDay = new Date().getDay();
    var todayKey = jsDay >= 1 && jsDay <= 5 ? String(jsDay) : null;
    var periodTimes = timetableData.periodTimes || [];
    var curIdx = currentPeriodIndex(periodTimes);
    var periodsN = timetableData.periodsPerDay;

    var wrap = $('weeklyGrid');
    wrap.innerHTML = '';

    wrap.appendChild(document.createElement('div')).className = 'wt-corner';
    DAY_LABELS_MF.forEach(function (label, i) {
      var head = document.createElement('div');
      head.className = 'wt-day-head' + (String(i + 1) === todayKey ? ' wt-day-head--today' : '');
      head.textContent = label;
      wrap.appendChild(head);
    });

    for (var p = 0; p < periodsN; p++) {
      var periodLabel = document.createElement('div');
      periodLabel.className = 'wt-period-label';
      var periodNo = document.createElement('div');
      periodNo.className = 'wt-period-no';
      periodNo.textContent = (p + 1) + '교시';
      periodLabel.appendChild(periodNo);
      var pt = periodTimes[p];
      if (pt) {
        var periodTime = document.createElement('div');
        periodTime.className = 'wt-period-time';
        periodTime.textContent = pt[0];
        periodLabel.appendChild(periodTime);
      }
      wrap.appendChild(periodLabel);

      for (var d = 1; d <= 5; d++) {
        var dayKey = String(d);
        var isToday = dayKey === todayKey;
        var entry = (entity.days[dayKey] || [])[p];
        var isCurrent = isToday && p === curIdx;
        var isCreative = entry && entry.subject === '창의적 체험활동';

        var cell = document.createElement('div');
        var cls = 'wt-cell';
        if (isCurrent) cls += ' wt-cell--current';
        else if (!entry) cls += ' wt-cell--free';
        else if (isToday) cls += ' wt-cell--today';
        if (entry && entry.elective) cls += ' wt-cell--elective'; // 이동수업(택○) 표시
        cell.className = cls;

        if (entry) {
          // 진행 중인 칸은 고유 색을 그대로 두고, 나머지 칸(창체 포함)은 과목별 색으로 알록달록하게.
          if (!isCurrent) {
            var c = subjectColor(entry.subject);
            cell.style.background = c.bg;
          }
          var subj = document.createElement('div');
          subj.className = 'wt-subject';
          subj.textContent = displaySubject(entry.subject);
          if (!isCurrent) subj.style.color = subjectColor(entry.subject).text;
          cell.appendChild(subj);
          if (entry.classLabel) {
            var cl = document.createElement('div');
            cl.className = 'wt-class';
            cl.textContent = displayClassLabel(entry.classLabel);
            cl.title = entry.classLabel;
            cell.appendChild(cl);
          }
        } else {
          // 빈 칸에도 "공강" 문구를 넣어 칸이 비어있는 게 아니라 "확인해서 공강임을 안다"는
          // 느낌이 들게 했다 — "수업 없음" 보조문구는 중복이라는 피드백으로 한 줄로 줄임.
          var freeSubj = document.createElement('div');
          freeSubj.className = 'wt-subject';
          freeSubj.textContent = '공강';
          cell.appendChild(freeSubj);
        }
        wrap.appendChild(cell);
      }
    }
    fitTimetableFont();
  }

  // 시간표 칸도 날씨·시계와 같은 문제 — 좁은 화면(노트북 등)에서 과목명(특히 "사회문제 탐구"
  // 같은 공동수업 과목은 선생님 이름까지 길어짐)이 칸 밖으로 넘치면 .wt-subject의 ellipsis가
  // 조용히 잘라버려서(선생님 이름만 남고 과목명이 안 보이는 것처럼 보임) 배율을 낮췄을 때
  // "과목명이 없어졌다"는 착시를 만들었다("배율이 적어서 짤린건가?" 피드백) — 날씨와 같은
  // shrinkGroupToFit()으로 칸마다 과목명+선생님 이름을 같이 축소한다.
  function fitTimetableFont() {
    document.querySelectorAll('.wt-cell').forEach(function (cell) {
      var subj = cell.querySelector('.wt-subject');
      var cls = cell.querySelector('.wt-class');
      if (!subj) return;
      // 태블릿처럼 큰 화면은 CSS 변수 --wt-scale로 기본 글자 크기를 키운다(없으면 1배 = PC 창 그대로).
      var sc = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wt-scale')) || 1;
      var items = [{ el: subj, base: 14 * sc, min: 10 * sc }];
      if (cls) items.push({ el: cls, base: 11 * sc, min: 9 * sc });
      shrinkGroupToFit(cell, items);
    });
  }

  // ── 시작 ──
  // 할 일 카드는 뺐다 — 캘린더 날짜 클릭 팝업에 이미 "할 일" 탭이 있어서 중복이라는 피드백.

  // ── 탭 화면(Electron 위젯: <html data-shell="tabs">) ── 한 번에 한 화면만 보여 준다. 화면 크기가 정해져
  // 있어서 카드를 여러 개 한꺼번에 놓을 때 생기던 배치 깨짐·글자 잘림이 없다. 탭: 오늘(시계·날씨·급식·학사일정) /
  // 시간표 / 캘린더 / 출결(기존 출결 패널을 그대로 가져옴) / 메모(할 일 목록).
  // 어느 카드를 보일지는 CSS(html[data-tab=...])가 정하고, 여기서는 속성만 바꾸고 보이게 된 카드를 다시 그린다.
  var TAB_KEY = 'dashboardActiveTab';
  var TABS = ['timetable', 'swap', 'calendar', 'today', 'attendance', 'subject', 'memo'];
  var attViewDate = new Date();

  function isTabShell() { return document.documentElement.getAttribute('data-shell') === 'tabs'; }

  // 메모 탭 화면은 board.js가 그린다.
  function renderMemo() { if (window.BOARD) window.BOARD.render(); }

  function renderAttendanceTab() {
    var d = attViewDate;
    $('attDateLabel').textContent = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + dayLabel(d.getDay()) + ')';
    var body = $('attTabBody');
    body.innerHTML = '';
    body.appendChild(buildAttendancePanel(ymd(d)));
  }

  // 출결 탭의 날짜(예: "10월 16일 (금)")를 누르면 작은 달력이 떠서 원하는 날로 바로 이동한다(‹ › 로 하루씩 넘기기 불편해서).
  // 기본 날짜 선택창은 색을 바꿀 수 없어서 직접 그린다: 토요일=파랑, 일요일·공휴일(NEIS 학사일정의 "공휴일" 표시)=빨강.
  var neisHolidays = {};        // 'YYYYMMDD' → true (NEIS가 공휴일로 표시한 날)
  var holidayMonthsLoaded = {}; // 'YYYY-M' → true
  function loadHolidaysFor(year, month) {
    var key = year + '-' + month;
    if (holidayMonthsLoaded[key]) return Promise.resolve();
    return fetchMonthEvents(year, month).then(function (days) {
      if (days && Object.keys(days).length) holidayMonthsLoaded[key] = true;
    });
  }

  function closeAttCalendar() {
    var p = $('attCalPop');
    if (p) p.remove();
  }
  function openAttCalendar() {
    closeAttCalendar();
    var label = $('attDateLabel');
    var r = label.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.id = 'attCalPop';
    pop.className = 'att-cal-pop';
    var viewY = attViewDate.getFullYear(), viewM = attViewDate.getMonth();
    var DOW = ['일', '월', '화', '수', '목', '금', '토'];

    function render() {
      pop.innerHTML = '';
      var head = document.createElement('div');
      head.className = 'att-cal-head';
      var prev = document.createElement('button'); prev.type = 'button'; prev.textContent = '‹'; prev.title = '이전 달';
      var next = document.createElement('button'); next.type = 'button'; next.textContent = '›'; next.title = '다음 달';
      var ttl = document.createElement('span'); ttl.textContent = viewY + '년 ' + (viewM + 1) + '월';
      prev.addEventListener('click', function (ev) { ev.stopPropagation(); viewM--; if (viewM < 0) { viewM = 11; viewY--; } go(); });
      next.addEventListener('click', function (ev) { ev.stopPropagation(); viewM++; if (viewM > 11) { viewM = 0; viewY++; } go(); });
      head.appendChild(prev); head.appendChild(ttl); head.appendChild(next);
      pop.appendChild(head);

      var grid = document.createElement('div');
      grid.className = 'att-cal-grid';
      DOW.forEach(function (n, i) {
        var h = document.createElement('div');
        h.className = 'att-cal-dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
        h.textContent = n;
        grid.appendChild(h);
      });
      var first = new Date(viewY, viewM, 1);
      var start = new Date(viewY, viewM, 1 - first.getDay());
      var todayKey = ymd(new Date()), selKey = ymd(attViewDate);
      for (var i = 0; i < 42; i++) {
        var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        var key = ymd(d);
        var c = document.createElement('button');
        c.type = 'button';
        c.textContent = d.getDate();
        var cls = 'att-cal-day';
        if (d.getMonth() !== viewM) cls += ' other';
        if (d.getDay() === 0 || neisHolidays[key]) cls += ' sun';
        else if (d.getDay() === 6) cls += ' sat';
        if (key === todayKey) cls += ' today';
        if (key === selKey) cls += ' sel';
        c.className = cls;
        (function (date) {
          c.addEventListener('click', function (ev) {
            ev.stopPropagation();
            attViewDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            closeAttCalendar();
            renderAttendanceTab();
          });
        })(d);
        grid.appendChild(c);
      }
      pop.appendChild(grid);

      var foot = document.createElement('div');
      foot.className = 'att-cal-foot';
      var today = document.createElement('button'); today.type = 'button'; today.textContent = '오늘';
      today.addEventListener('click', function (ev) { ev.stopPropagation(); attViewDate = new Date(); closeAttCalendar(); renderAttendanceTab(); });
      foot.appendChild(today);
      pop.appendChild(foot);
    }
    // 보이는 달의 공휴일을 먼저 불러온 뒤(처음 한 번) 다시 그린다.
    function go() { render(); loadHolidaysFor(viewY, viewM).then(function () { if ($('attCalPop') === pop) render(); }); }

    pop.addEventListener('click', function (ev) { ev.stopPropagation(); });
    $('board').appendChild(pop);
    go();
    var w = 270;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = (r.bottom + 6) + 'px';
  }
  function initAttDatePicker() {
    var label = $('attDateLabel');
    if (!label || label.dataset.calReady) return;
    label.dataset.calReady = '1';
    label.classList.add('att-date-btn');
    label.setAttribute('role', 'button');
    label.setAttribute('tabindex', '0');
    label.title = '눌러서 날짜 고르기';
    function toggle(ev) { ev.stopPropagation(); if ($('attCalPop')) closeAttCalendar(); else openAttCalendar(); }
    label.addEventListener('click', toggle);
    label.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(ev); } });
    document.addEventListener('click', closeAttCalendar);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeAttCalendar(); });
  }

  function shiftAttDate(days) {
    var d = new Date(attViewDate);
    d.setDate(d.getDate() + days);
    attViewDate = d;
    renderAttendanceTab();
  }

  // 탭을 바꾼 직후 — 그 탭의 카드가 이제 막 보이게 됐으니 크기에 맞는 글자 축소와 내용 갱신을 한 번 돌린다.
  function refreshTab(tab) {
    if (tab === 'today') { renderClock(); fitClockFont(); fitWeatherFont(); }
    else if (tab === 'timetable') { renderWeeklyTimetable(); fitTimetableFont(); }
    else if (tab === 'calendar') renderCalendar();
    else if (tab === 'attendance') renderAttendanceTab();
    else if (tab === 'memo') renderMemo();
    else if (tab === 'subject' && window.SUBJ) window.SUBJ.show();
    else if (tab === 'swap' && window.SWAP) window.SWAP.show();
  }

  function setTab(tab, persist) {
    if (TABS.indexOf(tab) < 0) tab = 'timetable';
    document.documentElement.setAttribute('data-tab', tab);
    document.querySelectorAll('.tabbtn').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    if (persist) { try { localStorage.setItem(TAB_KEY, tab); } catch (e) {} }
    requestAnimationFrame(function () { refreshTab(tab); });
  }

  // 결보강 탭(swap.js)이 "시간표 탭에서 고른 교사"를 기본값으로 쓸 수 있게 알려 준다.
  window.TTHOOKS = {
    periodTimes: function () { return (timetableData && timetableData.periodTimes) || []; },
    currentPeriod: function () { return currentPeriodIndex((timetableData && timetableData.periodTimes) || []); },
    fitTimetable: function () { fitTimetableFont(); },
    timetable: function () { return timetableData; },
    semesterStartOf: function (startYear) { return semesterStartOf(startYear); },
    ensureSemAuto: function (startYear) { return ensureSemAuto(startYear); },
    roster: function () { return classRoster; },
    selectedTeacherName: function () {
      var list = entityListOf('teachers');
      var x = list.filter(function (i) { return entityIdOf('teachers', i) === selectedEntityId.teachers; })[0];
      return x ? (x.teacherName || entityLabelOf('teachers', x) || '') : '';
    }
  };

  // 교사/학급/학생 버튼 3개는 화면에서 숨기고(로직은 그대로 재사용), "교사 ▾ | 이름 ▾" 한 덩어리로 합친다.
  function initViewTypeCombo(vt, es) {
    var NAMES = { teachers: '교사', classes: '학급', students: '학생' };
    var combo = document.createElement('div');
    combo.className = 'view-combo';
    var typeBtn = document.createElement('button');
    typeBtn.type = 'button'; typeBtn.className = 'view-type-btn'; typeBtn.id = 'viewTypeBtn';
    var typeLabel = document.createElement('span');
    typeBtn.appendChild(typeLabel);
    typeBtn.insertAdjacentHTML('beforeend', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>');
    var panel = document.createElement('div');
    panel.className = 'entity-select-panel view-type-panel'; panel.hidden = true;
    var board = $('board') || document.body;
    board.appendChild(panel);
    var icons = {};
    Array.prototype.forEach.call(vt.querySelectorAll('.vtab'), function (vb) { icons[vb.dataset.view] = vb.querySelector('svg').outerHTML; });
    function sync() { typeLabel.innerHTML = (icons[selectedView] || '') + '<b>' + (NAMES[selectedView] || '교사') + '</b>'; }
    Array.prototype.slice.call(vt.querySelectorAll('.vtab')).forEach(function (vb) {
      var o = document.createElement('div');
      o.className = 'ts-option view-type-option'; o.dataset.view = vb.dataset.view;
      o.innerHTML = vb.querySelector('svg').outerHTML + '<span>' + (NAMES[vb.dataset.view] || '') + '</span>';
      o.onclick = function (ev) { ev.stopPropagation(); panel.hidden = true; vb.click(); sync(); };
      panel.appendChild(o);
    });
    typeBtn.onclick = function (ev) {
      ev.stopPropagation();
      if (!panel.hidden) { panel.hidden = true; return; }
      var r = typeBtn.getBoundingClientRect();
      panel.style.position = 'fixed'; panel.style.width = '130px';
      panel.style.top = (r.bottom + 8) + 'px'; panel.style.left = r.left + 'px'; panel.style.right = 'auto';
      Array.prototype.forEach.call(panel.children, function (o) { o.classList.toggle('ts-option--active', o.dataset.view === selectedView); });
      var ep = $('entitySelectPanel'); if (ep) ep.hidden = true;
      panel.hidden = false;
    };
    panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('click', function () { panel.hidden = true; });
    $('entitySelectBtn').addEventListener('click', function () { panel.hidden = true; });
    combo.appendChild(typeBtn); combo.appendChild(es);
    vt.appendChild(combo);
    sync();
  }

  function initTabs() {
    if (!isTabShell()) return;
    document.querySelectorAll('.tabbtn').forEach(function (b) {
      b.addEventListener('click', function (ev) { ev.stopPropagation(); setTab(b.dataset.tab, true); });
    });
    $('attPrevBtn').addEventListener('click', function (ev) { ev.stopPropagation(); shiftAttDate(-1); });
    $('attNextBtn').addEventListener('click', function (ev) { ev.stopPropagation(); shiftAttDate(1); });
    $('attTodayBtn').addEventListener('click', function (ev) { ev.stopPropagation(); attViewDate = new Date(); renderAttendanceTab(); });
    initAttDatePicker();
    $('attTabSummaryBtn').addEventListener('click', function (ev) { ev.stopPropagation(); openAttendanceSummary(); });
    // 시간표 카드: 제목 줄(아이콘·"주간 시간표"·이름 선택)을 없애고, 이름 선택 버튼을 교사/학급/학생 버튼 줄의 오른쪽 끝으로 옮긴다.
    var vt = $('viewTabs'), es = $('entitySelect');
    if (vt && es) vt.appendChild(es);    if (vt && es) initViewTypeCombo(vt, es);

    // 열 때마다 "시간표" 탭에서 시작한다(마지막에 보던 탭을 기억하지 않는다).
    setTab('timetable', false);
  }

  // 예전 "날짜별 할 일"은 메모 카드(날짜 지정)로 옮긴다. 옛 데이터는 그대로 두고(되돌릴 수 있게), 화면에서만 뺀다.
  // 어느 기기든 한 번 옮기면 동기화되는 설정(dt-migrated)에 표시해서 다른 기기가 또 옮기지 않게 한다.
  function migrateDayTasks() {
    if (!window.BOARD || !window.BOARD.addMigrated) return;
    if (prefs.some(function (p0) { return p0.id === 'dt-migrated'; })) return;
    var list = Object.keys(dayTasks).filter(function (k) { return dayTasks[k]; }).map(function (k) { return { id: 'dt' + k, text: dayTasks[k], date: k }; });
    if (list.length) window.BOARD.addMigrated(list);
    prefs.push({ id: 'dt-migrated', date: '1', updatedAt: Date.now() });
    savePrefs();
  }

  function init() {
    initSettings();
    initCardToggles(); // 첫 렌더 전에 꺼진 카드부터 숨겨둬야 숨은 카드가 불필요하게 그려/호출되지 않는다
    initLayoutResize(); // 저장된 카드 크기를 첫 렌더 전에 적용(글자 자동축소가 최종 크기 기준으로 돌게)
    loadDayTasks();
    loadPrefs();
    loadAttendanceRecords();
    initCloud();
    if (window.BOARD) window.BOARD.init();
    migrateDayTasks();
    initAttendanceSummary();
    initTabs();

    // 아래 갱신들은 전부 "켜진 카드만" 돈다(isCardOn) — 꺼진 카드는 API 호출도 안 한다.
    if (isCardOn('clockCard')) renderClock();
    // 아날로그 시계 초침이 실시간으로 돌아야 해서 1초마다 갱신 — 교시 강조 갱신은 그렇게
    // 자주 다시 그릴 필요가 없어서 따로 15초 주기로 유지.
    setInterval(function () { if (isCardOn('clockCard')) renderClock(); }, 1000);
    setInterval(function () { if (isCardOn('timetableCard')) renderWeeklyTimetable(); }, 15000);

    // 시간표 데이터는 로컬 파일이라 항상 읽어둔다(카드를 나중에 켰을 때 바로 보이게).
    loadTimetable();
    loadClassRoster();

    if (isCardOn('weatherCard')) fetchWeather();
    setInterval(function () { if (isCardOn('weatherCard')) fetchWeather(); }, 30 * 60 * 1000);

    if (isCardOn('mealCard')) fetchMeal();
    if (isCardOn('eventsCard')) fetchSchoolEvents();
    initCalNav();
    if (isCardOn('calendarCard')) renderCalendar();
    setInterval(function () {
      if (isCardOn('mealCard')) fetchMeal();
      if (isCardOn('eventsCard')) fetchSchoolEvents();
      if (isCardOn('calendarCard')) renderCalendar();
    }, 60 * 60 * 1000);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
