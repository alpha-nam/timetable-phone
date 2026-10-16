/*
 * swap.js — "결보강" 탭: 수업 교체 가능한 선생님 찾기.
 * edutech-app의 수업 교체 모듈(swap-finder.js)의 규칙을 그대로 옮겼다.
 *   ① 대체(보강): 내 수업을 누가 대신 맡아줄 수 있나 → 그 시간이 공강인 교사(같은 교과 우선, 격주 공강은 "확인 필요")
 *   ② 1:1 교체: 두 교사가 서로 시간을 맞바꿈 → 1학년 공통교과만. 상대가 그 시간에 공강이고, 상대의 다른
 *      1학년 수업 시간 중 내가 공강인 시간이 있어야 한다.
 *   ③ 창의적체험활동(수 6·7교시): 담임↔부담임을 먼저 보여 주는 별도 흐름(1:1 교체 없음).
 * 데이터는 swap-data.json(학기마다 scripts/extract-swap-data.js로 새로 만든다).
 */
(function () {
  'use strict';

  var DAYS = ['월', '화', '수', '목', '금'];
  var PERIODS = 7;
  var CREATIVE = '창의적체험활동';
  var CREATIVE_DAY = 3;
  var CREATIVE_PERIODS = [6, 7];
  var TEACHER_KEY = 'dashboardSwapTeacher';
  var PALETTE = [
    ['rgba(139,124,246,0.4)', '#6f5fe0'], ['rgba(95,212,200,0.4)', '#2f9d8f'], ['rgba(246,124,166,0.4)', '#e0568f'],
    ['rgba(246,189,86,0.42)', '#b07410'], ['rgba(110,190,120,0.4)', '#3f9a52'], ['rgba(100,160,246,0.4)', '#3d7fd6'],
    ['rgba(246,140,90,0.4)', '#d9622a'], ['rgba(180,120,246,0.4)', '#9c4fd6']
  ];

  var data = null, loadError = null, loading = false;
  var st = { teacherId: null, view: 'grid', cell: null, mode: 'substitute', detail: null };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }

  // ───────── 데이터 준비 ─────────
  function key(tid, d, p) { return tid + '_' + d + '_' + p; }
  function normalizeSubject(v) { return String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase(); }
  function stripGroupSuffix(label) {
    var s = String(label == null ? '' : label).trim();
    var u = s.lastIndexOf('_');
    if (u >= 0) s = s.slice(u + 1);
    return s.replace(/([^A-Za-z0-9])[A-Za-z]+(\d*)$/, '$1$2').trim();
  }
  function colorOf(subject) {
    var h = 0, s = String(subject || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  function slotText(d, p) { return DAYS[d - 1] + ' ' + p + '교시'; }
  function classLabel(e) { return e.room ? e.room + '반' + (e.className ? '(' + e.className + ')' : '') : (e.className || ''); }
  function shortClass(e) { return e.room || e.className || ''; }

  function prepare(d) {
    data = d;
    data.byId = {};
    d.teachers.forEach(function (t) { data.byId[t.id] = t; });
    var creative = [];
    (d.homerooms || []).forEach(function (h) {
      if (!h.className || !h.teacherId) return;
      CREATIVE_PERIODS.forEach(function (p) {
        creative.push({ teacherId: h.teacherId, day: CREATIVE_DAY, period: p, subject: CREATIVE, className: h.className, room: null, roomNote: null });
      });
    });
    data.all = d.entries.concat(creative);
    data.map = new Map();
    data.all.forEach(function (e) { data.map.set(key(e.teacherId, e.day, e.period), e); });
    var has = {};
    d.entries.forEach(function (e) { has[e.teacherId] = true; });
    data.active = d.teachers.filter(function (t) { return has[t.id]; }); // 담당 수업이 없는 교사(상담 등)는 후보에서 뺀다
  }

  function load(cb) {
    if (data || loadError) return cb();
    if (loading) return;
    loading = true;
    fetch('./swap-data.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) { prepare(d); loading = false; cb(); })
      .catch(function (e) { loading = false; loadError = String(e && e.message || e); cb(); });
  }

  // ───────── 후보 찾기 규칙(swap-finder.js와 같은 규칙) ─────────
  function isAlternatingFree(e) { return !!(e && e.roomNote && String(e.roomNote).split('@').indexOf('공강') !== -1); }
  function entryAt(tid, d, p) { return data.map.get(key(tid, d, p)); }
  function isFree(tid, d, p) { return !data.map.has(key(tid, d, p)); }

  function findFree(day, period, o) {
    var pref = normalizeSubject(o.preferredSubject || '');
    var res = data.active.filter(function (t) {
      if (o.excludeTeacherId && t.id === o.excludeTeacherId) return false;
      var e = entryAt(t.id, day, period);
      return !e || isAlternatingFree(e);
    }).map(function (t) {
      return {
        teacher: t,
        isSame: pref !== '' && normalizeSubject(t.subject) === pref,
        isPinned: !!o.pinnedTeacherId && t.id === o.pinnedTeacherId,
        isAlternating: !!entryAt(t.id, day, period)
      };
    });
    res.sort(function (a, b) {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isSame !== b.isSame) return a.isSame ? -1 : 1;
      return (a.teacher.name || '').localeCompare(b.teacher.name || '', 'ko');
    });
    return res;
  }

  function reciprocalEligible(className) {
    var raw = String(className || '').trim(), base = stripGroupSuffix(raw), g = data.codeGrades || {};
    if (Object.prototype.hasOwnProperty.call(g, base) && g[base] != null && g[base] !== '') return Number(g[base]) === 1;
    if (Object.prototype.hasOwnProperty.call(g, raw) && g[raw] != null && g[raw] !== '') return Number(g[raw]) === 1;
    return /^1-\d+$/.test(raw);
  }

  function findSwapPartners(day, period, myId, o) {
    var pref = normalizeSubject(o.preferredSubject || '');
    var res = data.active.filter(function (t) { return t.id !== myId; }).map(function (t) {
      var primary = entryAt(t.id, day, period);
      if (primary && !isAlternatingFree(primary)) return null;
      var slots = [];
      for (var d = 1; d <= 5; d++) {
        for (var p = 1; p <= PERIODS; p++) {
          if (d === day && p === period) continue;
          var theirs = entryAt(t.id, d, p);
          if (!theirs) continue;
          if (theirs.subject === CREATIVE) continue;
          if (theirs.roomNote && !isAlternatingFree(theirs)) continue;
          if (!reciprocalEligible(theirs.className)) continue;
          if (!isFree(myId, d, p)) continue;
          slots.push({ day: d, period: p, entry: theirs, isAlternating: !!theirs.roomNote });
        }
      }
      return { teacher: t, slots: slots, isSame: pref !== '' && normalizeSubject(t.subject) === pref };
    }).filter(function (c) { return c && c.slots.length > 0; });
    res.sort(function (a, b) {
      if (a.isSame !== b.isSame) return a.isSame ? -1 : 1;
      return (a.teacher.name || '').localeCompare(b.teacher.name || '', 'ko');
    });
    return res;
  }

  // ───────── 현재 선택된 교사 ─────────
  function teacherNameGuess() {
    var saved = null;
    try { saved = localStorage.getItem(TEACHER_KEY); } catch (e) {}
    return saved || (window.TTHOOKS && window.TTHOOKS.selectedTeacherName && window.TTHOOKS.selectedTeacherName()) ||
      (window.DASHBOARD_CONFIG && window.DASHBOARD_CONFIG.myTeacherName) || '';
  }
  function resolveTeacher() {
    if (st.teacherId && data.byId[st.teacherId]) return data.byId[st.teacherId];
    var name = teacherNameGuess();
    var t = name ? data.active.filter(function (x) { return x.name === name; })[0] : null;
    if (!t) return null;   // 아직 아무도 고르지 않음(배포본의 첫 실행)
    st.teacherId = t.id;
    return t;
  }

  // ───────── 화면 ─────────
  function rootBar() { return $('swapBar'); }
  function rootBody() { return $('swapBody'); }

  function teacherButton() {
    var t = resolveTeacher();
    var btn = el('button', 'swap-teacher-btn');
    btn.type = 'button';
    btn.appendChild(el('span', '', t ? t.name : '선생님 선택'));
    btn.insertAdjacentHTML('beforeend', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>');
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); openTeacherPicker(btn); });
    return btn;
  }

  function closePicker() { var p = $('swapPicker'); if (p) p.remove(); }
  function openTeacherPicker(anchor) {
    closePicker();
    var panel = el('div', 'entity-select-panel');
    panel.id = 'swapPicker';
    var search = el('input', 'entity-search');
    search.placeholder = '이름 검색';
    var list = el('div', 'entity-options');
    panel.appendChild(search);
    panel.appendChild(list);
    function fill() {
      list.innerHTML = '';
      var q = search.value.trim();
      var shown = data.active.filter(function (t) { return !q || t.name.indexOf(q) >= 0 || (t.subject || '').indexOf(q) >= 0; });
      if (!shown.length) list.appendChild(el('div', 'ts-empty', '검색 결과 없음'));
      shown.forEach(function (t) {
        var o = el('div', 'ts-option' + (t.id === st.teacherId ? ' ts-option--active' : ''), t.name + (t.subject ? '  ·  ' + t.subject : ''));
        o.addEventListener('click', function (ev) {
          ev.stopPropagation();
          st.teacherId = t.id; st.view = 'grid'; st.cell = null;
          try { localStorage.setItem(TEACHER_KEY, t.name); } catch (e) {}
          closePicker();
          render();
        });
        list.appendChild(o);
      });
    }
    search.addEventListener('input', fill);
    panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    fill();
    var r = anchor.getBoundingClientRect();
    $('board').appendChild(panel);
    panel.style.top = Math.min(r.bottom + 6, window.innerHeight - 330) + 'px';
    panel.style.left = Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)) + 'px';
    setTimeout(function () { search.focus(); }, 0);
  }

  function weekGrid(teacherId, opts) {
    opts = opts || {};
    var g = el('div', 'weekly-grid swap-grid');
    var hooks = window.TTHOOKS || {};
    var times = hooks.periodTimes ? hooks.periodTimes() : [];
    var jsDay = new Date().getDay();
    var todayCol = jsDay >= 1 && jsDay <= 5 ? jsDay : 0;
    var curIdx = hooks.currentPeriod ? hooks.currentPeriod() : -1;
    g.appendChild(el('div', 'wt-corner'));
    DAYS.forEach(function (d, i) { g.appendChild(el('div', 'wt-day-head' + (i + 1 === todayCol ? ' wt-day-head--today' : ''), d)); });
    for (var p = 1; p <= PERIODS; p++) {
      var pl = el('div', 'wt-period-label');
      pl.appendChild(el('div', 'wt-period-no', p + '교시'));
      if (times[p - 1] && times[p - 1][0]) pl.appendChild(el('div', 'wt-period-time', times[p - 1][0]));
      g.appendChild(pl);
      for (var d = 1; d <= 5; d++) {
        (function (d, p) {
          var e = entryAt(teacherId, d, p);
          var isNow = d === todayCol && curIdx === p - 1;
          var cell = el('div', 'wt-cell' + (e ? '' : ' wt-cell--free') + (isNow ? ' wt-cell--current' : ''));
          if (e) {
            var c = colorOf(e.subject === CREATIVE ? '창의적 체험활동' : e.subject);
            if (c && !isNow) cell.style.background = c[0];
            var s = el('div', 'wt-subject', e.subject === CREATIVE ? '창체' : e.subject);
            if (c && !isNow) s.style.color = c[1];
            cell.appendChild(s);
            var sc = e.subject === CREATIVE ? '' : shortClass(e);   // 창체 칸은 시간표 탭처럼 반 표시 없이 "창체"만
            if (sc) cell.appendChild(el('div', 'wt-class', sc));
            if (e.roomNote) cell.title = '격주로 내용이 바뀌는 시간: ' + e.roomNote;
          } else {
            cell.appendChild(el('div', 'wt-subject', '공강'));
          }
          if (opts.mark && opts.mark[d + '_' + p]) {
            var m = opts.mark[d + '_' + p];
            cell.classList.add('swap-mark', 'swap-mark--' + m.kind);
            if (m.label) cell.appendChild(el('div', 'swap-mark-label', m.label));
          }
          if (opts.onCell && e) {
            cell.classList.add('swap-clickable');
            cell.addEventListener('click', function (ev) { ev.stopPropagation(); opts.onCell(d, p, e); });
          }
          g.appendChild(cell);
        })(d, p);
      }
    }
    setTimeout(function () { if (hooks.fitTimetable) hooks.fitTimetable(); }, 0);
    return g;
  }

  function renderGrid() {
    var t = resolveTeacher();
    var bar = rootBar(); bar.innerHTML = '';
    bar.appendChild(teacherButton());
    var body = rootBody(); body.innerHTML = '';
    if (!t) { body.appendChild(el('div', 'wt-pick-prompt', '오른쪽 위에서 선생님 이름을 골라 주세요.')); return; }
    body.appendChild(weekGrid(t.id, {
      onCell: function (d, p, e) { st.cell = { day: d, period: p, entry: e }; st.view = 'result'; st.mode = 'substitute'; render(); }
    }));
  }

  function backBtn(label, onClick) {
    var b = el('button', 'swap-back', '‹ ' + label);
    b.type = 'button';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); onClick(); });
    return b;
  }

  function badge(text, cls) { return el('span', 'swap-tag' + (cls ? ' ' + cls : ''), text); }

  function renderResult() {
    var t = resolveTeacher(), c = st.cell, e = c.entry;
    var bar = rootBar(); bar.innerHTML = '';
    bar.appendChild(backBtn('시간표', function () { st.view = 'grid'; render(); }));
    bar.appendChild(el('span', 'swap-title', slotText(c.day, c.period) + ' · ' + (e.subject === CREATIVE ? '창체' : e.subject) + ' ' + shortClass(e)));
    bar.appendChild(teacherButton());
    var body = rootBody(); body.innerHTML = '';
    var creative = e.subject === CREATIVE;
    var eligible = !creative && reciprocalEligible(e.className);
    var pref = t.subject || e.subject;

    if (e.roomNote) body.appendChild(el('div', 'swap-warn', '홀수/짝수주에 따라 수업이 바뀌는 칸입니다. 확인 후 교체하세요.'));

    if (creative) {
      var hr = (data.homerooms || []).filter(function (h) { return h.className === e.className && h.teacherId === t.id; })[0];
      var co = hr && hr.coTeacherId ? data.byId[hr.coTeacherId] : null;
      body.appendChild(el('div', 'swap-note', '창의적체험활동은 담임 ↔ 부담임 순서로 대체합니다.' + (co ? '' : ' (이 반의 부담임이 지정되어 있지 않습니다)')));
      listSubstitute(body, t, c, { preferredSubject: pref, pinnedTeacherId: co && co.id });
      return;
    }
    var tog = el('div', 'swap-mode');
    [['substitute', '대체 가능 선생님'], ['reciprocal', '1:1 교체 가능 선생님']].forEach(function (m) {
      var b = el('button', 'swap-mode-btn' + (st.mode === m[0] ? ' active' : ''), m[1]);
      b.type = 'button';
      if (m[0] === 'reciprocal' && !eligible) { b.disabled = true; b.title = '선택과목은 반마다 내용이 달라 1:1 교체가 불가능합니다.'; }
      b.addEventListener('click', function (ev) { ev.stopPropagation(); if (b.disabled) return; st.mode = m[0]; render(); });
      tog.appendChild(b);
    });
    body.appendChild(tog);
    if (!eligible) body.appendChild(el('div', 'swap-note', '이 수업은 선택과목이라 1:1 교체는 불가능하고 대체(보강)만 가능합니다.'));
    if (st.mode === 'reciprocal' && eligible) listReciprocal(body, t, c, pref);
    else listSubstitute(body, t, c, { preferredSubject: pref });
  }

  function listSubstitute(body, t, c, o) {
    o.excludeTeacherId = t.id;
    var cands = findFree(c.day, c.period, o);
    var list = el('div', 'swap-list');
    if (!cands.length) list.appendChild(el('div', 'ts-empty', '이 시간에 공강인 선생님이 없습니다.'));
    cands.forEach(function (x) {
      var row = el('div', 'swap-row' + (x.isSame || x.isPinned ? ' match' : ''));
      var info = el('div', 'swap-row-info');
      info.appendChild(el('span', 'swap-name', x.teacher.name));
      if (x.teacher.subject) info.appendChild(badge(x.teacher.subject));
      if (x.isPinned) info.appendChild(badge('부담임', 'good'));
      if (x.isSame) info.appendChild(badge('같은 교과', 'good'));
      if (x.isAlternating) info.appendChild(badge('격주 공강(확인)', 'warn'));
      row.appendChild(info);
      row.appendChild(el('span', 'swap-go', '시간표 ›'));
      row.addEventListener('click', function (ev) { ev.stopPropagation(); st.detail = { teacher: x.teacher, kind: 'substitute' }; st.view = 'detail'; render(); });
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  function listReciprocal(body, t, c, pref) {
    var partners = findSwapPartners(c.day, c.period, t.id, { preferredSubject: pref });
    var list = el('div', 'swap-list');
    if (!partners.length) list.appendChild(el('div', 'ts-empty', '맞바꿀 수 있는 선생님이 없습니다.'));
    partners.forEach(function (x) {
      var row = el('div', 'swap-row swap-row--col' + (x.isSame ? ' match' : ''));
      var info = el('div', 'swap-row-info');
      info.appendChild(el('span', 'swap-name', x.teacher.name));
      if (x.teacher.subject) info.appendChild(badge(x.teacher.subject));
      if (x.isSame) info.appendChild(badge('같은 교과', 'good'));
      if (x.slots.some(function (s) { return s.isAlternating; })) info.appendChild(badge('격주 공강(확인)', 'warn'));
      row.appendChild(info);
      var chips = el('div', 'swap-chips');
      x.slots.forEach(function (s) {
        var b = el('button', 'swap-chip' + (s.isAlternating ? ' warn' : ''), slotText(s.day, s.period) + ' (' + shortClass(s.entry) + ')');
        b.type = 'button';
        b.addEventListener('click', function (ev) { ev.stopPropagation(); st.detail = { teacher: x.teacher, kind: 'reciprocal', slot: s }; st.view = 'detail'; render(); });
        chips.appendChild(b);
      });
      row.appendChild(chips);
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  function renderDetail() {
    var t = resolveTeacher(), c = st.cell, dt = st.detail;
    var bar = rootBar(); bar.innerHTML = '';
    bar.appendChild(backBtn('목록', function () { st.view = 'result'; render(); }));
    bar.appendChild(el('span', 'swap-title', dt.teacher.name + ' 선생님 시간표'));
    var body = rootBody(); body.innerHTML = '';
    var mark = {};
    var line;
    if (dt.kind === 'reciprocal') {
      var s = dt.slot;
      mark[c.day + '_' + c.period] = { kind: 'take', label: '맡음' };
      mark[s.day + '_' + s.period] = { kind: 'give', label: '내 시간' };
      line = t.name + ' 선생님의 ' + slotText(c.day, c.period) + ' 수업(' + shortClass(c.entry) + ')을 ' + dt.teacher.name + ' 선생님이 맡고, ' +
        dt.teacher.name + ' 선생님의 ' + slotText(s.day, s.period) + ' 수업(' + shortClass(s.entry) + ')을 ' + t.name + ' 선생님이 맡습니다.';
    } else {
      mark[c.day + '_' + c.period] = { kind: 'take', label: '맡음' };
      line = t.name + ' 선생님의 ' + slotText(c.day, c.period) + ' 수업(' + classLabel(c.entry) + ')을 ' + dt.teacher.name + ' 선생님이 대신 맡습니다.\n앞뒤 교시가 연속 수업인지 확인하세요.';
    }
    body.appendChild(el('div', 'swap-summary', line));
    body.appendChild(weekGrid(dt.teacher.id, { mark: mark }));
  }

  function render() {
    if (!$('swapCard')) return;
    if (!data) {
      rootBar().innerHTML = '';
      var body = rootBody(); body.innerHTML = '';
      body.appendChild(el('div', 'ts-empty', loadError ? '결보강 데이터를 읽지 못했습니다 (' + loadError + ')' : '불러오는 중…'));
      return;
    }
    closePicker();
    if (st.view === 'detail' && st.detail) renderDetail();
    else if (st.view === 'result' && st.cell) renderResult();
    else renderGrid();
  }

  window.SWAP = {
    show: function () { load(render); },
    rerender: render,
    _api: { load: load, findFree: findFree, findSwapPartners: findSwapPartners, reciprocalEligible: reciprocalEligible, getData: function () { return data; } }   // 시험용
  };
  document.addEventListener('click', closePicker);
})();
