/*
 * subject.js — "교과 출결" 탭: 선생님 본인의 수업 시간별 학생 명단에서 결석·지각·조퇴·결과를 체크한다.
 * 담임 학급 출결(app.js의 "학급 출결")과 기록·저장·종합이 완전히 따로다.
 *
 * 수업의 학생 명단은 시간표 자료(dashboard-timetable.json)에서 만든다.
 *   ① 그 요일·교시에 학생 시간표 칸에 내 이름이 적힌 학생(학생 개별 시간표가 있는 2·3학년, 선택과목 포함)
 *   ② ①이 없으면 시간표의 반(예: "1-3")의 학생 — 2·3학년은 학생 시간표, 1학년은 학급 명렬표(class-roster.json)
 * 출석이 아닌 것만 기록한다(기록이 없으면 출석). 한 번 누르면 켜지고, 같은 버튼을 다시 누르면 꺼진다.
 * 구글 드라이브 동기화는 notes 파일의 "subj" 묶음으로 PC·폰이 같이 쓴다(app.js가 getSyncState/applySync를 부른다).
 */
(function () {
  'use strict';

  var KEY = 'dashboardSubjectAtt';
  var TOMB_KEY = 'dashboardSubjectAttTombs';
  var TYPES = ['결석', '지각', '조퇴', '결과'];   // 예전 기록(종합표)에 쓴다. 새 체크는 CHECK 하나만 쓴다.
  var CHECK = '결과';
  var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  var TYPE_CLASS = { '결석': 'abs', '지각': 'late', '조퇴': 'early', '결과': 'out' };

  var records = [];
  var tombs = {};
  var viewDate = new Date();
  var teacherName = '';
  var lastFollow = '';   // 마지막으로 따라간 "시간표 탭의 선생님"
  var selKey = '';
  var curConfirm = null;   // 지금 화면에 보이는 수업({ dateStr, lesson }) — 위쪽 "확인" 버튼이 쓴다

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
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(records)); localStorage.setItem(TOMB_KEY, JSON.stringify(tombs)); } catch (e) { /* 저장 공간 문제는 조용히 넘어간다 */ }
  }
  function save() {
    persist();
    if (window.TTAPP && window.TTAPP.refreshCalendar) window.TTAPP.refreshCalendar();   // 캘린더 배지 갱신
    if (window.TTAPP && window.TTAPP.scheduleSync) window.TTAPP.scheduleSync();
  }

  // ───────── 수업·명단 ─────────
  function studentKey(s) { return s.studentId ? String(s.studentId) : s.grade + '-' + s.ban + '-' + s.no; }
  function byNo(a, b) { return (+a.grade - +b.grade) || (+a.ban - +b.ban) || (+a.no - +b.no); }

  // 선생님 한 칸(요일 dow=1~5, 교시 index pi)의 수업 묶음들. 묶음 하나 = { label, subject, students }.
  function groupsFor(tt, teacher, dow, pi) {
    var cell = ((teacher.days || {})[dow] || [])[pi];
    if (!cell) return [];
    var students = (tt.students || []).filter(function (x) { return !x.entrusted; });   // 위탁 학생(시간표 자료의 entrusted 표시)은 교과출결 명단에서 뺀다. 원적교로 돌아오면 나이스 명단에 다시 뜨고, 나이스와 맞추기가 자동으로 넣는다.
    // 선생님은 한 교시에 한 곳에만 있으므로, 그 칸에서 "내 이름"이 적힌 학생이 곧 내 수업의 학생이다.
    // (학생 시간표의 과목명은 정식 과목명이고 선생님 시간표는 반코드라 과목명으로는 맞출 수 없다.)
    // 먼저 선생님 한 분만 적힌 칸을 찾고, 없으면 공동 수업("갑·을")까지 넓힌다. 격주 칸("2-7 / 2-6")은 반별로 나눈다.
    var mine = [];
    if (String(cell.classLabel || '').indexOf('/') < 0) {
      var at = function (s) { return String((((s.days || {})[dow] || [])[pi] || {}).classLabel || ''); };
      mine = students.filter(function (s) { return at(s).trim() === teacher.teacherName; });
      if (!mine.length) {
        mine = students.filter(function (s) { return at(s).split(/[·,\/]/).map(function (x) { return x.trim(); }).indexOf(teacher.teacherName) >= 0; });
      }
    }
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
  function baseLessonsOn(date) {
    var tt = timetable();
    var teacher = tt && (tt.teachers || []).filter(function (t) { return t.teacherName === teacherName; })[0];
    var dow = date.getDay(), ds = ymd(date);
    var out = [];
    if (teacher && dow >= 1 && dow <= 5) {
      for (var pi = 0; pi < (tt.periodsPerDay || 7); pi++) {
        groupsFor(tt, teacher, dow, pi).forEach(function (g) {
          out.push({ key: (pi + 1) + '|' + g.label + '|' + g.subject, period: pi + 1, label: g.label, subject: g.subject, students: applyFixes(g.students, ds, dow, pi + 1, g.label) });
        });
      }
    }
    // 나이스에 없는 수업(연가·체험학습·다른 선생님이 대신 들어감 등): 확인된 날의 그 수업은 시간표에서 뺀다(체크 기록은 지우지 않는다)
    out = out.filter(function (l) { return !records.some(function (r) { return r && r.kind === 'skip' && r.date === ds && r.period === l.period && r.label === l.label; }); });
    return out;
  }
  function lessonsOn(date) {
    var out = baseLessonsOn(date), ds = ymd(date);
    // 교체·땜빵으로 들어온 수업(나이스 명단에서 가져온 임시 수업)
    records.forEach(function (r) {
      if (!r || r.kind !== 'extra' || r.date !== ds) return;
      if (out.some(function (l) { return l.period === r.period && l.label === r.label; })) return;
      out.push({ key: r.period + '|' + r.label + '|' + r.subject, period: r.period, label: r.label, subject: r.subject, extra: true, students: (r.students || []).slice().sort(byNo) });
    });
    out.sort(function (a, b) { return a.period - b.period; });
    return out;
  }
  // 나이스에 맞춘 명단 수정(전학·자퇴 등): 확인한 날짜(from)부터 그 수업(요일·교시·반)에 적용한다. 날짜 순서대로 쌓아서 적용.
  function applyFixes(students, ds, dow, period, label) {
    var fx = records.filter(function (r) { return r && r.kind === 'rosterfix' && r.dow === dow && r.period === period && r.label === label && r.from <= ds; })
      .sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
    if (!fx.length) return students;
    var list = students.slice();
    fx.forEach(function (f) {
      var rm = {}; (f.remove || []).forEach(function (k) { rm[k] = 1; });
      list = list.filter(function (s) { return !rm[s.grade + '-' + s.ban + '-' + s.no]; });
      (f.add || []).forEach(function (a) {
        if (!list.some(function (s) { return Number(s.grade) === a.grade && Number(s.ban) === a.ban && Number(s.no) === a.no; })) list.push({ grade: a.grade, ban: a.ban, no: a.no, studentName: a.studentName });
      });
    });
    return list.sort(byNo);
  }

  function recId(dateStr, lesson, s) { return dateStr + '|' + lesson.period + '|' + lesson.label + '|' + studentKey(s); }
  function recOf(id) { for (var i = 0; i < records.length; i++) if (records[i].id === id) return records[i]; return null; }

  // 이름을 누르면 체크가 켜지고, 다시 누르면 꺼진다. 새 체크는 나이스의 "결과 /" 와 같은 하나의 체크(CHECK)다.
  // (예전 기록의 결석·지각·조퇴·사유는 지우지 않고 그대로 보여 준다.)
  function toggleCheck(dateStr, lesson, s) {
    var id = recId(dateStr, lesson, s), r = recOf(id), now = Date.now();
    if (r) {
      records = records.filter(function (x) { return x.id !== id; });
      tombs[id] = now;
    } else {
      records.push({
        id: id, date: dateStr, period: lesson.period, label: lesson.label, subject: lesson.subject,
        grade: s.grade, ban: s.ban, no: s.no, studentName: s.studentName, type: CHECK, reason: '', memo: '', updatedAt: now
      });
      delete tombs[id];
    }
    save();
  }

  // 학급출결의 "일일 마감": 반(예: 3-6) 하나의 하루를 마감한다. 같은 목록(subj)에 kind:'confirm' 으로 저장해서 PC·폰이 같이 쓴다.
  // 마감해도 출결 기록은 그대로이고, 학급출결 표가 잠길 뿐이다(다시 누르면 풀린다).
  function classDayId(dateStr, classKey) { return dateStr + '|class|' + classKey + '|__confirm'; }
  function dayClosed(dateStr, classKey) { return !!recOf(classDayId(dateStr, classKey)); }
  function toggleDayClosed(dateStr, classKey) {
    var id = classDayId(dateStr, classKey), now = Date.now();
    if (recOf(id)) {
      records = records.filter(function (x) { return x.id !== id; });
      tombs[id] = now;
    } else {
      records.push({ id: id, kind: 'confirm', scope: 'class-day', date: dateStr, label: classKey, type: '마감', updatedAt: now });
      delete tombs[id];
    }
    save();
  }

  // "이 수업 확인 완료" 표시. 학생 기록과 같은 목록(subj)에 kind:'confirm' 으로 저장해서 PC·폰이 같이 쓴다.
  function isConfirm(r) { return !!r && r.kind === 'confirm'; }
  // 학생 체크 기록 = kind 가 없는 기록. 마감('confirm')·임시 수업('extra')·명단 수정('rosterfix') 같은 표시 기록은 체크가 아니다.
  function notConfirm(r) { return !!r && !r.kind; }
  function confirmId(dateStr, lesson) { return dateStr + '|' + lesson.period + '|' + lesson.label + '|__confirm'; }
  function toggleConfirm(dateStr, lesson) {
    var id = confirmId(dateStr, lesson), now = Date.now();
    if (recOf(id)) {
      records = records.filter(function (x) { return x.id !== id; });
      tombs[id] = now;
    } else {
      records.push({ id: id, kind: 'confirm', date: dateStr, period: lesson.period, label: lesson.label, subject: lesson.subject, type: '확인', updatedAt: now });
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

  // 시간표 탭에서 고른 선생님을 그대로 따라간다(시간표에서 선생님을 바꾸면 교과출결도 같이 바뀐다).
  // 교과출결의 목록에서 직접 다른 선생님을 골라 볼 수도 있지만, 시간표의 선생님이 바뀌면 다시 그 선생님으로 맞춘다.
  function followTimetableTeacher() {
    var h = hooks().selectedTeacherName ? (hooks().selectedTeacherName() || '') : '';
    if (h && h !== lastFollow) { lastFollow = h; teacherName = h; selKey = ''; }
  }

  function fillTeachers() {
    var sel = $('subjTeacher'), tt = timetable();
    if (!sel || !tt) return;
    var names = (tt.teachers || []).map(function (t) { return t.teacherName; }).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    sel.innerHTML = '';
    var blank = el('option', '', '선생님 선택'); blank.value = ''; sel.appendChild(blank);
    names.forEach(function (n) { var o = el('option', '', n); o.value = n; sel.appendChild(o); });
    sel.value = names.indexOf(teacherName) >= 0 ? teacherName : '';
    if (sel.value !== teacherName) teacherName = '';
  }

  function render() {
    var body = $('subjBody');
    if (!body) return;
    var cfBtn = $('subjConfirmBtn'); if (cfBtn) cfBtn.hidden = true; curConfirm = null;   // 수업이 있을 때만 아래에서 다시 보인다
    var dl = $('subjDate');
    if (dl) dl.textContent = dateLabel(viewDate);
    var sn = document.querySelector('#subjCard .subj-nav'); if (sn) sn.classList.toggle('is-today', ymd(viewDate) === ymd(new Date()));
    var tt = timetable();
    body.innerHTML = '';
    if (!tt) { body.appendChild(el('div', 'subj-empty', '시간표 자료를 불러오는 중이에요.')); return; }
    followTimetableTeacher();
    if (!$('subjTeacher').options.length) fillTeachers();
    var tsel = $('subjTeacher'); if (tsel && tsel.value !== teacherName && [].some.call(tsel.options, function (o) { return o.value === teacherName; })) tsel.value = teacherName;
    if (!teacherName) { body.appendChild(el('div', 'subj-empty', '위에서 선생님 이름을 고르면 내 수업이 나와요.')); return; }

    var lessons = lessonsOn(viewDate);
    if (!lessons.length) { body.appendChild(el('div', 'subj-empty', dateLabel(viewDate) + '에는 출결을 볼 수업이 없어요.')); return; }
    if (!lessons.some(function (l) { return l.key === selKey; })) selKey = defaultLesson(lessons).key;
    var lesson = lessons.filter(function (l) { return l.key === selKey; })[0];
    var dateStr = ymd(viewDate);

    var confirmed = !!recOf(confirmId(dateStr, lesson));
    var chips = el('div', 'subj-chips');
    lessons.forEach(function (l) {
      var c = el('button', 'subj-chip' + (l.key === selKey ? ' on' : ''));
      c.type = 'button';
      // 수업 앞의 점: 확인 전은 빨강, 확인 완료는 초록 — 확인 안 한 수업이 한눈에 보인다.
      c.appendChild(el('i', 'subj-dot' + (recOf(confirmId(dateStr, l)) ? ' ok' : '')));
      c.appendChild(document.createTextNode(l.period + '교시 ' + (l.label ? l.label + ' ' : '') + l.subject));
      if (l.extra) c.appendChild(el('span', 'subj-extra-tag', '대신 수업'));
      c.addEventListener('click', function (ev) { ev.stopPropagation(); selKey = l.key; render(); });
      chips.appendChild(c);
    });
    body.appendChild(chips);
    if (lesson.extra && !confirmed) body.appendChild(el('div', 'subj-extra-note', '나이스에서 가져온 수업이에요. 체크하고 마감 완료를 눌러 주세요.'));

    var head = el('div', 'subj-head');
    ['연번', '번호', '이름', '결과', document.documentElement.hasAttribute('data-phone') ? '사유·메모' : '사유·메모 (선택)'].forEach(function (h) { head.appendChild(el('span', '', h)); });
    body.appendChild(head);
    var list = el('div', 'subj-list');
    var checked = 0;
    lesson.students.forEach(function (s, i) {
      var r = recOf(recId(dateStr, lesson, s));
      if (r) checked++;
      list.appendChild(studentRow(dateStr, lesson, s, r, confirmed, i + 1));
    });
    body.appendChild(list);


    // 나이스로 보낼 수업은 선생님이 위쪽 "확인 전" 버튼을 직접 눌러 확인한 것만이다. 확인한 수업은 잠기고, 다시 누르면 풀려서 고칠 수 있다.
    var cf = $('subjConfirmBtn');
    if (cf) {
      cf.hidden = false;
      cf.className = 'subj-confirm-top' + (confirmed ? ' ok' : '');
      cf.textContent = confirmed ? '마감 완료' : '마감 전';
      cf.title = confirmed ? '눌러서 마감을 풀면 다시 고칠 수 있어요' : '이 수업의 출결을 다 입력했으면 눌러요 (나이스로 보낼 수업 표시 · 나이스 마감은 아니에요)';
      curConfirm = { dateStr: dateStr, lesson: lesson };
    }
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

  // 한 줄: 번호 · 이름 · (체크하면) 사유·메모 칸. 이름 줄을 누르면 체크가 켜지고 꺼진다.
  function studentRow(dateStr, lesson, s, r, locked, seq) {
    var wrap = el('div', 'subj-row' + (r ? ' has' : '') + (locked ? ' locked' : ''));
    var line = el('div', 'subj-line');
    line.appendChild(el('span', 'subj-seq', String(seq)));   // 연번: 번호순으로 1부터
    line.appendChild(el('span', 'subj-id', s.grade + '-' + s.ban + '-' + s.no));
    line.appendChild(el('span', 'subj-name', s.studentName));
    line.appendChild(el('span', 'subj-box', r ? '/' : ''));   // 나이스의 "결과" 칸: 체크하면 "/" 가 켜진다
    var cell = el('div', 'subj-mcell');
    if (r) {
      // 예전에 결석·지각·조퇴나 사유 버튼으로 남긴 기록은 지우지 않고 "결석 · 질병" 처럼 보여 준다.
      var old = (r.type && r.type !== CHECK ? r.type : '') + (r.reason ? (r.type && r.type !== CHECK ? ' · ' : '') + r.reason : '');
      if (old) cell.appendChild(el('span', 'subj-tag', old));
      var memo = el('input', 'subj-memo'); memo.type = 'text'; memo.placeholder = '사유·메모'; memo.value = r.memo || '';
      memo.readOnly = !!locked;
      memo.addEventListener('change', function () { patch(r.id, { memo: memo.value.trim() }); });
      memo.addEventListener('click', function (ev) { ev.stopPropagation(); });
      cell.appendChild(memo);
    }
    line.appendChild(cell);
    line.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (locked) return;
      // 체크를 취소할 때는 실수로 풀리지 않게 한 번 확인한다.
      if (r && !window.confirm(s.studentName + ' 학생의 체크를 취소할까요?')) return;
      toggleCheck(dateStr, lesson, s); render();
    });
    wrap.appendChild(line);
    return wrap;
  }

  // ───────── 종합 ─────────
  // 학급출결 종합과 같은 모양: 제목 · 학년도/월 선택 · 월별/1학기/2학기/학년도 전체 · 학생별 줄(누르면 날짜별로 펼침)
  function openSummary() {
    var old = $('subjSummaryOverlay');
    if (old) old.remove();
    var overlay = el('div', 'day-task-overlay'); overlay.id = 'subjSummaryOverlay';
    var box = el('div', 'day-task-box day-task-box--wide att-summary-box');
    var title = el('div', 'day-task-title');
    var pickRow = el('div', 'att-pick-row');
    var yearSel = el('select', 'att-summary-select'), monthSel = el('select', 'att-summary-select'), cls = el('select', 'att-summary-select');
    var tabRow = el('div', 'day-task-tabs');
    var wrap = el('div', 'att-summary-table-wrap');
    var MODES = [['month', '월별'], ['sem1', '1학기'], ['sem2', '2학기'], ['year', '학년도 전체']];
    var now0 = new Date();
    var selYear = now0.getMonth() >= 2 ? now0.getFullYear() : now0.getFullYear() - 1;   // 학년도: 3월 ~ 다음 해 2월
    var selMonthIdx = (now0.getMonth() + 10) % 12;   // 0 = 3월 … 11 = 2월
    var mode = 'month';

    function pad(n) { return String(n).padStart(2, '0'); }
    function groupName(r) { return (r.label ? r.label + ' ' : '') + r.subject; }
    function marks() { return records.filter(notConfirm); }
    function acYear(r) { var y = +String(r.date).slice(0, 4), m = +String(r.date).slice(4, 6); return m >= 3 ? y : y - 1; }
    function fillYears() {
      var years = {}; years[selYear] = true; years[now0.getMonth() >= 2 ? now0.getFullYear() : now0.getFullYear() - 1] = true;
      marks().forEach(function (r) { years[acYear(r)] = true; });
      yearSel.innerHTML = '';
      Object.keys(years).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) { var o = el('option', '', y + '학년도'); o.value = y; yearSel.appendChild(o); });
      yearSel.value = String(selYear);
    }
    function fillMonths() {
      monthSel.innerHTML = '';
      for (var k = 0; k < 12; k++) { var mo = (2 + k) % 12, o = el('option', '', (mo + 1) + '월'); o.value = k; monthSel.appendChild(o); }
      monthSel.value = String(selMonthIdx);
    }
    // 수업 선택: 전체 / 맡은 과목별(반 구분 없이 그 과목 전부) / 수업별(반까지)
    function mySubjects() {
      var tt = timetable(), names = [];
      var t = tt && (tt.teachers || []).filter(function (x) { return x.teacherName === teacherName; })[0];
      if (t) Object.keys(t.days || {}).forEach(function (d) { (t.days[d] || []).forEach(function (c) { if (c && c.subject && names.indexOf(c.subject) < 0) names.push(c.subject); }); });
      marks().forEach(function (r) { if (r.subject && names.indexOf(r.subject) < 0) names.push(r.subject); });
      return names.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
    }
    function fillClasses() {
      var keep = cls.value;
      cls.innerHTML = '';
      var all = el('option', '', '전체 수업'); all.value = ''; cls.appendChild(all);
      var gs = el('optgroup'); gs.label = '과목별';
      mySubjects().forEach(function (n) { var o = el('option', '', n); o.value = 's:' + n; gs.appendChild(o); });
      if (gs.children.length) cls.appendChild(gs);
      var names = [];
      marks().forEach(function (r) { var g = groupName(r); if (names.indexOf(g) < 0) names.push(g); });
      names.sort(function (a, b) { return a.localeCompare(b, 'ko'); });
      var gc = el('optgroup'); gc.label = '수업별(반)';
      names.forEach(function (n) { var o = el('option', '', n); o.value = 'c:' + n; gc.appendChild(o); });
      if (gc.children.length) cls.appendChild(gc);
      cls.value = [].some.call(cls.options, function (o) { return o.value === keep; }) ? keep : '';
    }
    function matchesClass(r) {
      var v = cls.value;
      if (!v) return true;
      return v.charAt(0) === 's' ? r.subject === v.slice(2) : groupName(r) === v.slice(2);
    }
    function bounds() {   // [from, to, 이름] (YYYYMMDD)
      var acStart = selYear + '0301', acEnd = (selYear + 1) + '0229';
      var s2 = (hooks().semesterStartOf && hooks().semesterStartOf(selYear)) || (selYear + '0901');
      if (s2 <= acStart || s2 > acEnd) s2 = selYear + '0901';
      if (mode === 'month') {
        var mo = (2 + selMonthIdx) % 12, yy = selMonthIdx <= 9 ? selYear : selYear + 1;
        return [yy + pad(mo + 1) + '01', yy + pad(mo + 1) + '31', selYear + '학년도 ' + (mo + 1) + '월'];
      }
      if (mode === 'sem1') return [acStart, String(+s2 - 1), selYear + '학년도 1학기'];
      if (mode === 'sem2') return [s2, acEnd, selYear + '학년도 2학기'];
      return [acStart, acEnd, selYear + '학년도'];
    }

    function draw() {
      var b = bounds();
      title.textContent = '출결 종합 · ' + b[2] + ' · 교과출결';
      monthSel.hidden = mode !== 'month';
      [].forEach.call(tabRow.children, function (bt, k) { bt.classList.toggle('active', MODES[k][0] === mode); });
      wrap.innerHTML = '';
      var rows = marks().filter(function (r) { return String(r.date) >= b[0] && String(r.date) <= b[1]; }).filter(matchesClass);
      if (!rows.length) { wrap.appendChild(el('div', 'att-list-empty', '기록된 출결이 없습니다.')); return; }
      // 학생 × 수업 한 줄. 예전 기록(결석·지각·조퇴)이 있을 때만 그 열을 보여 준다.
      var by = {};
      rows.forEach(function (r) {
        var k = groupName(r) + '|' + r.grade + '-' + r.ban + '-' + r.no + '|' + r.studentName;
        var g = by[k] = by[k] || { r: r, group: groupName(r), c: {}, items: [] };
        g.c[r.type] = (g.c[r.type] || 0) + 1; g.items.push(r);
      });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, c) { return a.group.localeCompare(c.group, 'ko') || byNo(a.r, c.r); });
      var cols = ['결석', '지각', '조퇴'].filter(function (t) { return list.some(function (g) { return g.c[t]; }); }).concat(['결과']);
      var grid = 'minmax(64px, 1.3fr) minmax(112px, 2.2fr) repeat(' + cols.length + ', minmax(34px, 0.8fr)) minmax(30px, 0.7fr)';
      var table = el('div', 'att-summary-table');
      var head = el('div', 'att-summary-row att-summary-row--head'); head.style.gridTemplateColumns = grid;
      ['수업', '학생'].concat(cols, ['합계']).forEach(function (h, k) { var hc = el('div', '', h); if (k === 1) hc.style.textAlign = 'left'; head.appendChild(hc); });
      table.appendChild(head);
      var prevGroup = null;
      list.forEach(function (g) {
        var item = el('div', 'att-summary-item');
        var r = el('div', 'att-summary-row att-summary-row--click'); r.style.gridTemplateColumns = grid;
        r.appendChild(el('div', 'att-summary-type', g.group === prevGroup ? '' : g.group)); prevGroup = g.group;   // 같은 수업이 이어지면 첫 줄에만 이름을 보인다
        var nameCell = el('div'), nameLine = el('div', '', g.r.grade + '-' + g.r.ban + ' ' + g.r.no + '번 ' + g.r.studentName);
        nameCell.style.textAlign = 'left'; nameCell.style.whiteSpace = 'nowrap';
        var caret = el('span', 'att-summary-caret', '▸'); nameLine.appendChild(caret); nameCell.appendChild(nameLine); r.appendChild(nameCell);
        var total = 0;
        cols.forEach(function (t) { total += g.c[t] || 0; r.appendChild(el('div', '', String(g.c[t] || 0))); });
        r.appendChild(el('div', 'att-summary-total', String(total)));
        var detail = el('div', 'att-sum-detail'); detail.hidden = true;
        g.items.slice().sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : (a.period - c.period); }).forEach(function (it) {
          var line = el('div', 'att-sum-detail-line att-sum-detail-line--go');
          line.title = '누르면 캘린더의 그 날짜로 이동해요';
          line.addEventListener('click', function (ev2) { ev2.stopPropagation(); if (window.TTAPP && window.TTAPP.jumpToDate) window.TTAPP.jumpToDate(it.date, 'subject'); });
          var dd = new Date(+it.date.slice(0, 4), +it.date.slice(4, 6) - 1, +it.date.slice(6, 8));
          line.appendChild(el('b', '', (+it.date.slice(4, 6)) + '월 ' + (+it.date.slice(6, 8)) + '일 (' + DAY_NAMES[dd.getDay()] + ') ' + it.period + '교시'));
          line.appendChild(el('span', '', it.type + (it.reason ? ' · ' + it.reason : '')));
          if (it.memo) line.appendChild(el('i', '', it.memo));
          detail.appendChild(line);
        });
        r.addEventListener('click', function (ev) {
          ev.stopPropagation(); detail.hidden = !detail.hidden;
          caret.textContent = detail.hidden ? '▸' : '▾';
          r.classList.toggle('att-summary-row--open', !detail.hidden);
        });
        item.appendChild(r); item.appendChild(detail); table.appendChild(item);
      });
      wrap.appendChild(table);
    }

    yearSel.addEventListener('change', function () { selYear = +yearSel.value; draw(); });
    monthSel.addEventListener('change', function () { selMonthIdx = +monthSel.value; draw(); });
    cls.addEventListener('change', draw);
    MODES.forEach(function (p) {
      var bt = el('button', 'day-task-tab', p[1]); bt.type = 'button';
      bt.addEventListener('click', function (ev) { ev.stopPropagation(); mode = p[0]; draw(); });
      tabRow.appendChild(bt);
    });
    pickRow.appendChild(yearSel); pickRow.appendChild(monthSel); pickRow.appendChild(cls); cls.classList.add('subj-sum-cls');

    var close = el('button', 'day-task-close day-task-close--bottom', '닫기'); close.type = 'button';
    close.addEventListener('click', function (ev) { ev.stopPropagation(); overlay.remove(); });
    box.appendChild(title); box.appendChild(pickRow);
    box.appendChild(tabRow); box.appendChild(wrap); box.appendChild(close);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) overlay.remove(); });
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });
    ($('board') || document.body).appendChild(overlay);
    fillYears(); fillMonths(); fillClasses(); draw();
  }

  // ───────── 동기화(app.js가 부른다) ─────────
  function getSyncState() { return { subj: { records: records, tombstones: tombs } }; }
  function applySync(res) {
    if (!res || !res.subj) return false;
    // 동기화 중에 사용자가 바꾼 체크가 서버 결과에 덮이지 않도록 항목별로 최신인 쪽을 남긴다.
    var m = window.TTMERGE ? window.TTMERGE(records, tombs, res.subj.records, res.subj.tombstones)
      : { records: res.subj.records || [], tombstones: res.subj.tombstones || {} };
    var changed = JSON.stringify(m.records) !== JSON.stringify(records);
    records = m.records;
    tombs = m.tombstones;
    persist();
    return changed;
  }

  // 백업에서 되살리기(app.js의 복원 화면이 부른다). 없는 것만 더하기 / 백업 상태로 통째로 되돌리기.
  function mergeRestore(list) {
    var n = 0, t = Date.now();
    (list || []).forEach(function (r) {
      if (!r || !r.id || recOf(r.id)) return;
      records.push(Object.assign({}, r, { updatedAt: t })); delete tombs[r.id]; n++;
    });
    if (n) { save(); render(); }
    return n;
  }
  function replaceRestore(list) {
    var t = Date.now(), n = 0, keep = {};
    (list || []).forEach(function (r) { if (r && r.id) keep[r.id] = true; });
    records.forEach(function (r) { if (!keep[r.id]) { tombs[r.id] = t; n++; } });
    records = (list || []).filter(function (r) { return r && r.id; }).map(function (r) { delete tombs[r.id]; return Object.assign({}, r, { updatedAt: t }); });
    save(); render();
    return n;
  }

  // 캘린더 배지·날짜 팝업이 쓴다.
  function listOn(dateStr) {
    return records.filter(function (r) { return r.date === dateStr && notConfirm(r); })
      .sort(function (a, b) { return (a.period - b.period) || byNo(a, b); });
  }
  function openDate(d) { viewDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function shiftDate(n) { var d = new Date(viewDate); d.setDate(d.getDate() + n); viewDate = d; render(); }

  function init() {
    load();
    var card = $('subjCard');
    if (!card) return;
    $('subjPrev').addEventListener('click', function (ev) { ev.stopPropagation(); shiftDate(-1); });
    $('subjNext').addEventListener('click', function (ev) { ev.stopPropagation(); shiftDate(1); });
    $('subjToday').addEventListener('click', function (ev) { ev.stopPropagation(); viewDate = new Date(); render(); });
    $('subjSummaryBtn').addEventListener('click', function (ev) { ev.stopPropagation(); openSummary(); });
    $('subjConfirmBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!curConfirm) return;
      toggleConfirm(curConfirm.dateStr, curConfirm.lesson); render();
    });
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
      render();
    });
  }

  // ───────── 나이스 입력 연동(PC 앱의 neis-bridge.js가 요청하면 부른다) ─────────
  // "마감 완료"한 수업(교과출결)만, 그 수업에서 체크한 학생과 함께 돌려준다. 체크한 학생이 없으면 marks 가 비어 있다(전원 출석).
  // 학급출결의 일일 마감(scope:'class-day')은 나이스 과목별출결과 상관없어서 넣지 않는다.
  function exportForNeis(from, to) {
    var lessons = records.filter(function (r) { return isConfirm(r) && r.scope !== 'class-day' && String(r.date) >= from && String(r.date) <= to; })
      .sort(function (a, b) { return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.period - b.period); })
      .map(function (c) {
        var marks = records.filter(function (r) { return notConfirm(r) && r.date === c.date && r.period === c.period && r.label === c.label; })
          .sort(byNo)
          .map(function (r) { return { grade: Number(r.grade), ban: Number(r.ban), no: Number(r.no), name: r.studentName }; });
        // 나이스 명단 확인용: 이 수업의 전체 명단(체크 여부와 상관없이). 수업을 못 찾으면 roster 를 생략한다.
        var roster;
        try {
          var ds = String(c.date), day = new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8));
          var ls = lessonsOn(day).filter(function (l) { return l.period === Number(c.period) && l.label === c.label; })[0];
          if (ls) roster = ls.students.map(function (s) { return { grade: Number(s.grade), ban: Number(s.ban), no: Number(s.no), name: s.name || s.studentName || '' }; });
        } catch (e) { roster = undefined; }
        var out = { date: String(c.date), period: Number(c.period), label: c.label, subject: c.subject, confirmed: true, marks: marks };
        if (roster) out.roster = roster;
        return out;
      });
    return { version: 1, teacher: teacherName, lessons: lessons };
  }
  // 나이스에 로그인한 선생님 이름(확장프로그램이 읽어서 보낸다)으로 잠깐 바꿔서 계산한다. 시간표 선생님 목록에 있는 이름일 때만.
  function withTeacher(name, fn) {
    var prev = teacherName, tt = timetable();
    if (name && tt && (tt.teachers || []).some(function (t) { return t.teacherName === name; })) teacherName = name;
    try { return fn(); } finally { teacherName = prev; }
  }
  function ensureTeacher() { if (!teacherName) { try { followTimetableTeacher(); } catch (e) { /* 시간표가 아직 없으면 건너뜀 */ } } }
  function pruneExtras() {   // 평소 수업과 같은 날·교시·반인 임시 수업 기록은 필요 없다(선생님을 모르는 채로 만들어진 것 등)
    if (!teacherName) return 0;
    var removed = 0;
    records = records.filter(function (r) {
      if (!r || r.kind !== 'extra') return true;
      var d = new Date(+String(r.date).slice(0, 4), +String(r.date).slice(4, 6) - 1, +String(r.date).slice(6, 8));
      var dup = baseLessonsOn(d).some(function (l) { return l.period === r.period && l.label === r.label; });
      if (dup) { tombs[r.id] = Date.now(); removed++; return false; }
      return true;
    });
    if (removed) save();
    return removed;
  }
  function neisSyncOk() { return document.documentElement.getAttribute('data-cloud-state') !== 'err'; }
  window.TTNEIS = {
    run: function (opts) {
      ensureTeacher();
      opts = opts || {};
      var who = opts.teacher || '';
      var wantSync = !!(opts.sync && window.TTAPP && window.TTAPP.syncNow);
      var syncFailed = false;
      // 폰에서 방금 체크한 기록이 구글 드라이브에 있을 수 있어서, 요청이 오면 먼저 한 번 동기화한다(15초까지만 기다린다).
      // 시간이 지나도 안 끝났거나 실패하면 syncOk:false 로 알려서, 확장프로그램이 "최신이 아닐 수 있다"고 말할 수 있게 한다.
      var done = wantSync ? new Promise(function (resolve) {
        var timer = setTimeout(function () { syncFailed = true; resolve(); }, opts.syncTimeoutMs || 15000);
        Promise.resolve().then(function () { return window.TTAPP.syncNow(); })
          .then(function () { clearTimeout(timer); resolve(); }, function () { clearTimeout(timer); syncFailed = true; resolve(); });
      }) : Promise.resolve();
      return done.then(function () {
        var data = withTeacher(who, function () { return exportForNeis(String(opts.from), String(opts.to)); });
        data.syncOk = !syncFailed && neisSyncOk();
        data.syncedAt = new Date().toISOString();
        return data;
      });
    },
    _export: exportForNeis,
    // 확장프로그램의 "나이스 명단 확인"용: 기간(주중)의 모든 수업과 명단(마감 여부와 상관없이)
    lessons: function (from, to, who) {
      ensureTeacher();
      return withTeacher(who, function () {
      pruneExtras();
      var out = [], a = new Date(+String(from).slice(0, 4), +String(from).slice(4, 6) - 1, +String(from).slice(6, 8)), b = new Date(+String(to).slice(0, 4), +String(to).slice(4, 6) - 1, +String(to).slice(6, 8));
      for (var d = a; d <= b; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        lessonsOn(d).forEach(function (l) {
          out.push({ date: ymd(d), dow: d.getDay(), period: l.period, label: l.label, subject: l.subject, extra: !!l.extra, confirmed: !!recOf(confirmId(ymd(d), l)),
            roster: l.students.map(function (s) { return { grade: Number(s.grade), ban: Number(s.ban), no: Number(s.no), name: s.studentName || '' }; }) });
        });
      }
      return { version: 1, teacher: teacherName, lessons: out };
      });
    },
    // 확장프로그램이 나이스 기준으로 보낸 변경을 반영한다: 임시 수업 추가/갱신(extras), 명단 수정(fixes). 모양을 엄격히 검사한다.
    apply: function (p) {
      var okS = function (s) { return s && Number.isInteger(s.grade) && Number.isInteger(s.ban) && Number.isInteger(s.no) && s.grade > 0 && s.ban > 0 && s.no > 0 && s.grade < 10 && s.ban < 100 && s.no < 100 && typeof s.name === 'string' && s.name.length <= 20; };
      var okD = function (d) { return /^\d{8}$/.test(String(d)); };
      var okL = function (x) { return typeof x === 'string' && x.length > 0 && x.length <= 20; };
      var ex = (p && p.extras) || [], fx = (p && p.fixes) || [], sk = (p && p.skips) || [];
      if (!Array.isArray(ex) || !Array.isArray(fx) || !Array.isArray(sk) || ex.length > 60 || fx.length > 60 || sk.length > 200) throw new Error('bad');
      var now = Date.now(), n1 = 0, n2 = 0, n3 = 0;
      ex.forEach(function (e) {
        if (!e || !okD(e.date) || !Number.isInteger(e.period) || e.period < 1 || e.period > 12 || !okL(e.label) || !okL(e.subject) || !Array.isArray(e.students) || e.students.length > 80 || !e.students.every(okS)) throw new Error('bad');
      });
      fx.forEach(function (f) {
        if (!f || !okD(f.from) || !Number.isInteger(f.dow) || f.dow < 1 || f.dow > 5 || !Number.isInteger(f.period) || f.period < 1 || f.period > 12 || !okL(f.label) || !Array.isArray(f.add) || !Array.isArray(f.remove) || f.add.length > 80 || f.remove.length > 80 || !f.add.every(okS) || !f.remove.every(function (k) { return /^\d{1,2}-\d{1,2}-\d{1,2}$/.test(String(k)); })) throw new Error('bad');
      });
      sk.forEach(function (k) {
        if (!k || !okD(k.date) || !Number.isInteger(k.period) || k.period < 1 || k.period > 12 || !okL(k.label)) throw new Error('bad');
      });
      var put = function (rec) { records = records.filter(function (x) { return x.id !== rec.id; }); records.push(rec); delete tombs[rec.id]; };
      ex.forEach(function (e) { put({ id: e.date + '|' + e.period + '|' + e.label + '|__extra', kind: 'extra', date: e.date, period: e.period, label: e.label, subject: e.subject, students: e.students.map(function (s) { return { grade: s.grade, ban: s.ban, no: s.no, studentName: s.name }; }), updatedAt: now }); n1++; });
      fx.forEach(function (f) { put({ id: 'fix|' + f.from + '|' + f.dow + '|' + f.period + '|' + f.label, kind: 'rosterfix', from: f.from, dow: f.dow, period: f.period, label: f.label, add: f.add.map(function (s) { return { grade: s.grade, ban: s.ban, no: s.no, studentName: s.name }; }), remove: f.remove, updatedAt: now }); n2++; });
      sk.forEach(function (k) { put({ id: k.date + '|' + k.period + '|' + k.label + '|__skip', kind: 'skip', date: k.date, period: k.period, label: k.label, updatedAt: now }); n3++; });
      if (n1 || n2 || n3) { save(); try { render(); } catch (e) { /* 화면이 없으면 건너뜀 */ } }
      return { ok: true, extras: n1, fixes: n2, skips: n3 };
    }
  };

  window.SUBJ = {
    init: init,
    show: function () { if (timetable() && !$('subjTeacher').options.length) fillTeachers(); render(); },
    render: render,
    listOn: listOn,
    dayClosed: dayClosed,
    toggleDayClosed: toggleDayClosed,
    openDate: openDate,
    mergeRestore: mergeRestore,
    replaceRestore: replaceRestore,
    getSyncState: getSyncState,
    applySync: applySync,
    _groupsFor: groupsFor
  };

  document.addEventListener('DOMContentLoaded', init);
})();
