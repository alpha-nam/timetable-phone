/*
 * subject.js — "교과 출결" 탭: 선생님 본인의 수업 시간별 학생 명단에서 결석·지각·조퇴·결과를 체크한다.
 * 담임 학급 출결(app.js의 "학급 출결")과 기록·저장·종합이 완전히 따로다.
 *
 * 수업의 학생 명단은 시간표 자료(dashboard-timetable.json)에서 만든다.
 *   ① 그 요일·교시에 같은 과목을 같은 선생님께 듣는 학생(학생 개별 시간표가 있는 2·3학년, 선택과목 포함)
 *   ② ①이 없으면 시간표의 반(예: "1-3")의 학생 — 2·3학년은 학생 시간표, 1학년은 학급 명렬표(class-roster.json)
 * 출석이 아닌 것만 기록한다(기록이 없으면 출석). 한 번 누르면 켜지고, 같은 버튼을 다시 누르면 꺼진다.
 * 구글 드라이브 동기화는 notes 파일의 "subj" 묶음으로 PC·폰이 같이 쓴다(app.js가 getSyncState/applySync를 부른다).
 */
(function () {
  'use strict';

  var KEY = 'dashboardSubjectAtt';
  var TOMB_KEY = 'dashboardSubjectAttTombs';
  var TEACHER_KEY = 'dashboardSubjTeacher';
  var TYPES = ['결석', '지각', '조퇴', '결과'];
  var REASONS = ['질병', '미인정', '기타', '출석인정'];
  var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  var TYPE_CLASS = { '결석': 'abs', '지각': 'late', '조퇴': 'early', '결과': 'out' };

  var records = [];
  var tombs = {};
  var viewDate = new Date();
  var teacherName = '';
  var selKey = '';

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
  function hooks() { return window.TTHOOKS || {}; }
  function timetable() { return hooks().timetable ? hooks().timetable() : null; }
  function roster() { return hooks().roster ? hooks().roster() : []; }

  // ───────── 저장 ─────────
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); records = Array.isArray(v) ? v : []; } catch (e) { records = []; }
    try { tombs = JSON.parse(localStorage.getItem(TOMB_KEY) || '{}') || {}; } catch (e) { tombs = {}; }
    try { teacherName = localStorage.getItem(TEACHER_KEY) || ''; } catch (e) { teacherName = ''; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(records)); localStorage.setItem(TOMB_KEY, JSON.stringify(tombs)); } catch (e) { /* 저장 공간 문제는 조용히 넘어간다 */ }
  }
  function save() {
    persist();
    if (window.TTAPP && window.TTAPP.scheduleSync) window.TTAPP.scheduleSync();
  }

  // ───────── 수업·명단 ─────────
  function studentKey(s) { return s.studentId ? String(s.studentId) : s.grade + '-' + s.ban + '-' + s.no; }
  function byNo(a, b) { return (+a.grade - +b.grade) || (+a.ban - +b.ban) || (+a.no - +b.no); }

  // 선생님 한 칸(요일 dow=1~5, 교시 index pi)의 수업 묶음들. 묶음 하나 = { label, subject, students }.
  function groupsFor(tt, teacher, dow, pi) {
    var cell = ((teacher.days || {})[dow] || [])[pi];
    if (!cell) return [];
    var students = tt.students || [];
    var mine = students.filter(function (s) {
      var c = ((s.days || {})[dow] || [])[pi];
      return c && c.subject === cell.subject && c.classLabel === teacher.teacherName;
    });
    if (mine.length) return [{ label: cell.classLabel || '', subject: cell.subject, students: mine.slice().sort(byNo) }];
    var labels = [];
    (String(cell.classLabel || '').match(/\d-\d+/g) || []).forEach(function (l) { if (labels.indexOf(l) < 0) labels.push(l); });
    return labels.map(function (l) {
      var gb = l.split('-');
      var list = students.filter(function (s) { return String(s.grade) === gb[0] && String(s.ban) === gb[1]; });
      if (!list.length) list = roster().filter(function (s) { return String(s.grade) === gb[0] && String(s.ban) === gb[1]; });
      return { label: l, subject: cell.subject, students: list.slice().sort(byNo) };
    }).filter(function (g) { return g.students.length; });
  }

  // 그 날짜의 내 수업 목록 = [{ key, period, label, subject, students }]
  function lessonsOn(date) {
    var tt = timetable();
    var teacher = tt && (tt.teachers || []).filter(function (t) { return t.teacherName === teacherName; })[0];
    var dow = date.getDay();
    if (!teacher || dow < 1 || dow > 5) return [];
    var out = [];
    for (var pi = 0; pi < (tt.periodsPerDay || 7); pi++) {
      groupsFor(tt, teacher, dow, pi).forEach(function (g) {
        out.push({ key: (pi + 1) + '|' + g.label + '|' + g.subject, period: pi + 1, label: g.label, subject: g.subject, students: g.students });
      });
    }
    return out;
  }

  function recId(dateStr, lesson, s) { return dateStr + '|' + lesson.period + '|' + lesson.label + '|' + studentKey(s); }
  function recOf(id) { for (var i = 0; i < records.length; i++) if (records[i].id === id) return records[i]; return null; }

  function setType(dateStr, lesson, s, type) {
    var id = recId(dateStr, lesson, s), r = recOf(id), now = Date.now();
    if (r && r.type === type) {
      records = records.filter(function (x) { return x.id !== id; });
      tombs[id] = now;
    } else if (r) {
      r.type = type; r.updatedAt = now;
    } else {
      records.push({
        id: id, date: dateStr, period: lesson.period, label: lesson.label, subject: lesson.subject,
        grade: s.grade, ban: s.ban, no: s.no, studentName: s.studentName, type: type, reason: '', memo: '', updatedAt: now
      });
      delete tombs[id];
    }
    save();
  }
  function patch(id, fields) {
    var r = recOf(id);
    if (!r) return;
    Object.assign(r, fields, { updatedAt: Date.now() });
    save();
  }

  // ───────── 화면 ─────────
  function dateLabel(d) { return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DAY_NAMES[d.getDay()] + ')'; }

  function fillTeachers() {
    var sel = $('subjTeacher'), tt = timetable();
    if (!sel || !tt) return;
    var names = (tt.teachers || []).map(function (t) { return t.teacherName; }).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    if (!teacherName && hooks().selectedTeacherName) teacherName = hooks().selectedTeacherName() || '';
    sel.innerHTML = '';
    var blank = el('option', '', '선생님 선택'); blank.value = ''; sel.appendChild(blank);
    names.forEach(function (n) { var o = el('option', '', n); o.value = n; sel.appendChild(o); });
    sel.value = names.indexOf(teacherName) >= 0 ? teacherName : '';
    if (sel.value !== teacherName) teacherName = '';
  }

  function render() {
    var body = $('subjBody');
    if (!body) return;
    var dl = $('subjDate');
    if (dl) dl.textContent = dateLabel(viewDate);
    var tt = timetable();
    body.innerHTML = '';
    if (!tt) { body.appendChild(el('div', 'subj-empty', '시간표 자료를 불러오는 중이에요.')); return; }
    if (!$('subjTeacher').options.length) fillTeachers();
    if (!teacherName) { body.appendChild(el('div', 'subj-empty', '위에서 선생님 이름을 고르면 내 수업이 나와요.')); return; }

    var lessons = lessonsOn(viewDate);
    if (!lessons.length) { body.appendChild(el('div', 'subj-empty', dateLabel(viewDate) + '에는 출결을 볼 수업이 없어요.')); return; }
    if (!lessons.some(function (l) { return l.key === selKey; })) selKey = defaultLesson(lessons).key;
    var lesson = lessons.filter(function (l) { return l.key === selKey; })[0];
    var dateStr = ymd(viewDate);

    var chips = el('div', 'subj-chips');
    lessons.forEach(function (l) {
      var c = el('button', 'subj-chip' + (l.key === selKey ? ' on' : ''), l.period + '교시 ' + (l.label ? l.label + ' ' : '') + l.subject);
      c.type = 'button';
      c.addEventListener('click', function (ev) { ev.stopPropagation(); selKey = l.key; render(); });
      chips.appendChild(c);
    });
    body.appendChild(chips);

    var info = el('div', 'subj-info', lesson.students.length + '명 · 이름 옆 버튼을 눌러 체크하고, 다시 누르면 취소돼요');
    body.appendChild(info);

    var list = el('div', 'subj-list');
    var counts = { total: lesson.students.length };
    TYPES.forEach(function (t) { counts[t] = 0; });
    lesson.students.forEach(function (s) {
      var r = recOf(recId(dateStr, lesson, s));
      if (r) counts[r.type] = (counts[r.type] || 0) + 1;
      list.appendChild(studentRow(dateStr, lesson, s, r));
    });
    body.appendChild(list);

    var sum = el('div', 'subj-sum');
    var present = counts.total - TYPES.reduce(function (n, t) { return n + (counts[t] || 0); }, 0);
    sum.appendChild(el('span', '', '출석 ' + present));
    TYPES.forEach(function (t) { if (counts[t]) sum.appendChild(el('span', 'subj-sum-' + TYPE_CLASS[t], t + ' ' + counts[t])); });
    body.appendChild(sum);
  }

  function defaultLesson(lessons) {
    if (ymd(viewDate) === ymd(new Date()) && hooks().currentPeriod) {
      var cur = hooks().currentPeriod();
      if (cur != null && cur >= 0) {
        var upcoming = lessons.filter(function (l) { return l.period - 1 >= cur; })[0];
        if (upcoming) return upcoming;
      }
    }
    return lessons[0];
  }

  function studentRow(dateStr, lesson, s, r) {
    var wrap = el('div', 'subj-row' + (r ? ' has' : ''));
    var line = el('div', 'subj-line');
    line.appendChild(el('span', 'subj-no', String(s.no)));
    var nm = el('span', 'subj-name', s.studentName);
    line.appendChild(nm);
    line.appendChild(el('span', 'subj-cls', s.grade + '-' + s.ban));
    TYPES.forEach(function (t) {
      var b = el('button', 'subj-btn' + (r && r.type === t ? ' on ' + TYPE_CLASS[t] : ''), t);
      b.type = 'button';
      b.addEventListener('click', function (ev) { ev.stopPropagation(); setType(dateStr, lesson, s, t); render(); });
      line.appendChild(b);
    });
    wrap.appendChild(line);
    if (r) {
      var more = el('div', 'subj-more');
      REASONS.forEach(function (rs) {
        var b = el('button', 'subj-reason' + (r.reason === rs ? ' on' : ''), rs);
        b.type = 'button';
        b.addEventListener('click', function (ev) { ev.stopPropagation(); patch(r.id, { reason: r.reason === rs ? '' : rs }); render(); });
        more.appendChild(b);
      });
      var memo = el('input', 'subj-memo'); memo.type = 'text'; memo.placeholder = '메모'; memo.value = r.memo || '';
      memo.addEventListener('change', function () { patch(r.id, { memo: memo.value.trim() }); });
      memo.addEventListener('click', function (ev) { ev.stopPropagation(); });
      more.appendChild(memo);
      wrap.appendChild(more);
    }
    return wrap;
  }

  // ───────── 종합 ─────────
  function openSummary() {
    var old = $('subjSummaryOverlay');
    if (old) old.remove();
    var overlay = el('div', 'subj-overlay'); overlay.id = 'subjSummaryOverlay';
    var box = el('div', 'subj-sbox');
    box.appendChild(el('h3', '', '교과 출결 종합'));
    var bar = el('div', 'subj-sbar');
    var range = el('select'); [['month', '이번 달'], ['all', '전체']].forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; range.appendChild(op); });
    var cls = el('select');
    bar.appendChild(range); bar.appendChild(cls);
    box.appendChild(bar);
    var out = el('div', 'subj-sout');
    box.appendChild(out);
    var close = el('button', 'subj-sclose', '닫기'); close.type = 'button';
    close.addEventListener('click', function (ev) { ev.stopPropagation(); overlay.remove(); });
    box.appendChild(close);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) overlay.remove(); });
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });
    ($('board') || document.body).appendChild(overlay);

    function groupName(r) { return (r.label ? r.label + ' ' : '') + r.subject; }
    function inRange(r) {
      if (range.value === 'all') return true;
      var n = new Date(), p = String(n.getFullYear()) + String(n.getMonth() + 1).padStart(2, '0');
      return String(r.date).slice(0, 6) === p;
    }
    function fillClasses() {
      var names = [];
      records.filter(inRange).forEach(function (r) { var g = groupName(r); if (names.indexOf(g) < 0) names.push(g); });
      names.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
      var keep = cls.value;
      cls.innerHTML = '';
      var all = el('option', '', '전체 수업'); all.value = ''; cls.appendChild(all);
      names.forEach(function (n) { var o = el('option', '', n); o.value = n; cls.appendChild(o); });
      cls.value = names.indexOf(keep) >= 0 ? keep : '';
    }
    function draw() {
      out.innerHTML = '';
      var rows = records.filter(inRange).filter(function (r) { return !cls.value || groupName(r) === cls.value; });
      if (!rows.length) { out.appendChild(el('div', 'subj-empty', '기록이 없어요.')); return; }
      var groups = {};
      rows.forEach(function (r) {
        var g = groups[groupName(r)] = groups[groupName(r)] || {};
        var k = r.grade + '-' + r.ban + '-' + r.no + '|' + r.studentName;
        var s = g[k] = g[k] || { r: r, c: { '결석': 0, '지각': 0, '조퇴': 0, '결과': 0 }, items: [] };
        s.c[r.type] = (s.c[r.type] || 0) + 1;
        s.items.push(r);
      });
      Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (gn) {
        out.appendChild(el('h4', '', gn));
        var t = el('table', 'subj-table');
        var head = el('tr'); ['학생'].concat(TYPES).concat(['합계']).forEach(function (h) { head.appendChild(el('th', '', h)); }); t.appendChild(head);
        Object.keys(groups[gn]).map(function (k) { return groups[gn][k]; }).sort(function (a, b) { return byNo(a.r, b.r); }).forEach(function (s) {
          var tr = el('tr', 'subj-srow'); tr.appendChild(el('td', 'l', '▸ ' + s.r.grade + '-' + s.r.ban + ' ' + s.r.no + ' ' + s.r.studentName));
          var total = 0; TYPES.forEach(function (ty) { total += s.c[ty]; tr.appendChild(el('td', '', s.c[ty] ? String(s.c[ty]) : '')); });
          tr.appendChild(el('td', 'tot', String(total))); t.appendChild(tr);
          // 줄을 누르면 이 학생이 언제 어떤 수업에서 체크됐는지 날짜순으로 펼쳐진다.
          var dr = el('tr', 'subj-drow'); dr.hidden = true;
          var dc = el('td'); dc.colSpan = 6;
          s.items.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.period - b.period); }).forEach(function (it) {
            var line = el('div', 'subj-dline');
            var dd = new Date(+it.date.slice(0, 4), +it.date.slice(4, 6) - 1, +it.date.slice(6, 8));
            line.appendChild(el('b', '', (+it.date.slice(4, 6)) + '월 ' + (+it.date.slice(6, 8)) + '일 (' + DAY_NAMES[dd.getDay()] + ') ' + it.period + '교시'));
            line.appendChild(el('span', '', it.type + (it.reason ? ' · ' + it.reason : '')));
            if (it.memo) line.appendChild(el('i', '', it.memo));
            dc.appendChild(line);
          });
          dr.appendChild(dc); t.appendChild(dr);
          tr.addEventListener('click', function (ev) {
            ev.stopPropagation(); dr.hidden = !dr.hidden;
            tr.firstChild.textContent = (dr.hidden ? '▸ ' : '▾ ') + tr.firstChild.textContent.slice(2);
          });
        });
        out.appendChild(t);
      });
    }
    range.addEventListener('change', function () { fillClasses(); draw(); });
    cls.addEventListener('change', draw);
    fillClasses(); draw();
  }

  // ───────── 동기화(app.js가 부른다) ─────────
  function getSyncState() { return { subj: { records: records, tombstones: tombs } }; }
  function applySync(res) {
    if (!res || !res.subj) return false;
    var next = res.subj.records || [];
    var changed = JSON.stringify(next) !== JSON.stringify(records);
    records = next;
    tombs = res.subj.tombstones || {};
    persist();
    return changed;
  }

  function shiftDate(n) { var d = new Date(viewDate); d.setDate(d.getDate() + n); viewDate = d; render(); }

  function init() {
    load();
    var card = $('subjCard');
    if (!card) return;
    $('subjPrev').addEventListener('click', function (ev) { ev.stopPropagation(); shiftDate(-1); });
    $('subjNext').addEventListener('click', function (ev) { ev.stopPropagation(); shiftDate(1); });
    $('subjToday').addEventListener('click', function (ev) { ev.stopPropagation(); viewDate = new Date(); render(); });
    $('subjSummaryBtn').addEventListener('click', function (ev) { ev.stopPropagation(); openSummary(); });
    var pick = $('subjDatePick');
    $('subjDate').addEventListener('click', function (ev) {
      ev.stopPropagation();
      var d = viewDate;
      pick.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (pick.showPicker) { try { pick.showPicker(); } catch (e) { pick.click(); } } else pick.click();
    });
    pick.addEventListener('change', function () {
      var p = pick.value.split('-');
      if (p.length === 3) { viewDate = new Date(+p[0], +p[1] - 1, +p[2]); render(); }
    });
    $('subjTeacher').addEventListener('change', function () {
      teacherName = this.value; selKey = '';
      try { localStorage.setItem(TEACHER_KEY, teacherName); } catch (e) { /* 무시 */ }
      render();
    });
  }

  window.SUBJ = {
    init: init,
    show: function () { if (timetable() && !$('subjTeacher').options.length) fillTeachers(); render(); },
    render: render,
    getSyncState: getSyncState,
    applySync: applySync,
    _groupsFor: groupsFor
  };

  document.addEventListener('DOMContentLoaded', init);
})();
