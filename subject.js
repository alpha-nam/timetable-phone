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
    if (window.TTSHARE) { try { window.TTSHARE.changed(); } catch (e) { /* 공유가 안 돼도 저장은 그대로 */ } }
    if (window.TTAPP && window.TTAPP.refreshCalendar) window.TTAPP.refreshCalendar();   // 캘린더 배지 갱신
    if (window.TTAPP && window.TTAPP.scheduleSync) window.TTAPP.scheduleSync();
  }

  // ───────── 수업·명단 ─────────
  function studentKey(s) { return s.studentId ? String(s.studentId) : s.grade + '-' + s.ban + '-' + s.no; }
  // 위탁 학생(시간표 자료의 excludedStudents): 나이스 명단에 보이더라도 교과출결 수업 명단·임시 수업·명단 수정에 넣지 않는다.
  // 동명이인 보호: 학년·반·번호가 같고 이름까지 같을 때만 제외한다(이름이 같아도 반·번호가 다르면 정상 학생).
  function exclKey(g, b, n) { return Number(g) + '-' + Number(b) + '-' + Number(n); }
  function exclSet() {
    var tt = timetable(), set = {};
    ((tt && tt.excludedStudents) || []).forEach(function (x) { set[exclKey(x.grade, x.ban, x.no)] = String(x.name || ''); });
    return set;
  }
  function isExcl(ex, g, b, n, name) { var k = exclKey(g, b, n); return ex[k] !== undefined && ex[k] !== '' && ex[k] === String(name || ''); }
  function notExcluded(list) { var ex = exclSet(); return list.filter(function (s) { return !isExcl(ex, s.grade, s.ban, s.no, s.studentName || s.name); }); }
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
    // 선생님 칸에 적힌 반(예: 1-5)의 학년과 다른 학년 학생이 "내 이름"으로 잡히면(학생 시간표가 선생님 시간표와 어긋난 경우) 그 학생들은 뺀다 → 아래에서 그 반 명단을 쓴다.
    var lgr = (String(cell.classLabel || '').match(/\d-\d+/g) || []).map(function (l) { return l.split('-')[0]; });
    if (lgr.length && mine.length) mine = mine.filter(function (s) { return lgr.indexOf(String(s.grade)) >= 0; });
    if (mine.length) return [{ label: cell.classLabel || '', subject: cell.subject, students: mine.slice().sort(byNo) }];
    var labels = [];
    (String(cell.classLabel || '').match(/\d-\d+/g) || []).forEach(function (l) { if (labels.indexOf(l) < 0) labels.push(l); });
    var biweekly = String(cell.classLabel || '').indexOf('/') >= 0 ? (labels.length >= 2 ? 'pair' : 'off') : '';   // 격주: 'pair' = 두 반이 번갈아, 'off' = 한 반과 공강이 번갈아
    return labels.map(function (l) {
      var gb = l.split('-');
      var list = students.filter(function (s) { return String(s.grade) === gb[0] && String(s.ban) === gb[1]; });
      if (!list.length) list = roster().filter(function (s) { return String(s.grade) === gb[0] && String(s.ban) === gb[1]; });
      return { label: l, subject: cell.subject, biweekly: biweekly, bwKey: biweekly ? ((pi + 1) + '|' + dow + '|' + labels.slice().sort().join(',')) : '', students: list.slice().sort(byNo) };
    }).filter(function (g) { return g.students.length; });
  }

  // 그 날짜의 내 수업 목록 = [{ key, period, label, subject, students }]
  function baseLessonsOn(date, raw) {
    var tt = timetable();
    var teacher = tt && (tt.teachers || []).filter(function (t) { return t.teacherName === teacherName; })[0];
    var dow = date.getDay(), ds = ymd(date);
    var out = [];
    if (teacher && dow >= 1 && dow <= 5) {
      for (var pi = 0; pi < (tt.periodsPerDay || 7); pi++) {
        groupsFor(tt, teacher, dow, pi).forEach(function (g) {
          out.push({ key: (pi + 1) + '|' + g.label + '|' + g.subject, period: pi + 1, label: g.label, subject: g.subject, biweekly: g.biweekly || '', bwKey: g.bwKey || '', students: applyFixes(g.students, ds, dow, pi + 1, g.label) });
        });
      }
    }
    // 나이스에 없는 수업(연가·체험학습·다른 선생님이 대신 들어감 등): 확인된 날의 그 수업은 시간표에서 뺀다(체크 기록은 지우지 않는다)
    if (raw) return out;
    out = out.filter(function (l) { return !records.some(function (r) { return r && r.kind === 'skip' && r.date === ds && r.period === l.period && r.label === l.label; }); });
    // 격주 칸: 나이스에서 확인한 주(기준 주)와 같은 홀짝 주면 그 반, 다른 주면 다른 반(또는 공강). 앞으로의 날에만 쓰고, 이미 체크·마감한 수업은 숨기지 않는다.
    if (ds >= ymd(new Date())) {
      out = out.filter(function (l) {
        if (!l.bwKey) return true;
        var rule = bwRule(l.bwKey); if (!rule) return true;
        var act = bwActive(rule, date);
        if (act === l.label) return true;
        return records.some(function (r) { return r && r.date === ds && r.period === l.period && r.label === l.label && (notConfirm(r) || isConfirm(r)); });
      });
    }
    return out;
  }
  function weekNo(d) { return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)) / 604800000); }
  function bwRule(key) { for (var i = 0; i < records.length; i++) if (records[i] && records[i].kind === 'bw' && records[i].id === 'bw|' + key) return records[i]; return null; }
  function bwActive(rule, date) {
    var a = new Date(+rule.anchor.slice(0, 4), +rule.anchor.slice(4, 6) - 1, +rule.anchor.slice(6, 8));
    if (Math.abs(weekNo(date) - weekNo(a)) % 2 === 0) return rule.active;
    var other = (rule.labels || []).filter(function (x) { return x !== rule.active; })[0];
    return other || '';   // 공강인 주는 ''
  }
  function lessonsOn(date) {
    var out = baseLessonsOn(date), ds = ymd(date);
    // 교체·땜빵으로 들어온 수업(나이스 명단에서 가져온 임시 수업)
    records.forEach(function (r) {
      if (!r || r.kind !== 'extra' || r.date !== ds) return;
      if (out.some(function (l) { return l.period === r.period && l.label === r.label; })) return;
      out.push({ key: r.period + '|' + r.label + '|' + r.subject, period: r.period, label: r.label, subject: r.subject, extra: true, students: notExcluded(r.students || []).sort(byNo) });
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
    return notExcluded(list).sort(byNo);
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
  // 교과출결의 "마감 완료"는 이제 하루 단위다. 학급출결의 일일 마감과 같은 방식(scope:'class-day')으로 저장하되 반 이름 자리에 '교과'를 쓴다
  // (옛 버전 앱은 'class-day' 기록을 수업 마감으로 읽지 않고 건너뛰므로 안전하다). 예전에 수업마다 한 마감 기록은 그대로 인정한다.
  var SUBJ_DAY = '교과';
  function subjDayClosed(ds) { return dayClosed(ds, SUBJ_DAY); }
  function lessonDone(ds, l) { return subjDayClosed(ds) || !!recOf(confirmId(ds, l)); }
  function dayAllDone(ds, lessons) { return lessons.length > 0 && lessons.every(function (l) { return lessonDone(ds, l); }); }
  // 마감을 누르면: 아직 덜 됐으면 그날 전체를 마감하고(예전 수업별 마감 기록은 정리), 다 된 상태면 그날 마감을 푼다.
  function toggleSubjDay(ds, lessons) {
    var done = dayAllDone(ds, lessons), now = Date.now();
    records = records.filter(function (r) {
      if (r && r.kind === 'confirm' && r.scope !== 'class-day' && String(r.date) === ds) { tombs[r.id] = now; return false; }
      return true;
    });
    var id = classDayId(ds, SUBJ_DAY);
    if (done) { if (recOf(id)) { records = records.filter(function (x) { return x.id !== id; }); tombs[id] = now; } }
    else if (!recOf(id)) { records.push({ id: id, kind: 'confirm', scope: 'class-day', date: ds, label: SUBJ_DAY, type: '마감', updatedAt: now }); delete tombs[id]; }
    save();
  }
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

    if (isRest(viewDate) && !listOn(ymd(viewDate)).length) { body.appendChild(el('div', 'subj-empty', '쉬는 날이에요.')); return; }   // 쉬는 날에는 빈 화면(이미 체크한 기록이 있으면 그대로 보여 준다)
    var lessons = lessonsOn(viewDate);
    if (!lessons.length) { body.appendChild(el('div', 'subj-empty', dateLabel(viewDate) + '에는 출결을 볼 수업이 없어요.')); return; }
    if (!lessons.some(function (l) { return l.key === selKey; })) selKey = defaultLesson(lessons).key;
    var lesson = lessons.filter(function (l) { return l.key === selKey; })[0];
    var dateStr = ymd(viewDate);

    var confirmed = lessonDone(dateStr, lesson);
    var dayDone = dayAllDone(dateStr, lessons);
    var chips = el('div', 'subj-chips');
    lessons.forEach(function (l) {
      var c = el('button', 'subj-chip' + (l.key === selKey ? ' on' : ''));
      c.type = 'button';
      // 수업 앞의 점: 확인 전은 빨강, 확인 완료는 초록 — 확인 안 한 수업이 한눈에 보인다.
      c.appendChild(el('i', 'subj-dot' + (lessonDone(dateStr, l) ? ' ok' : '')));
      c.appendChild(document.createTextNode(l.period + '교시 ' + (l.label ? l.label + ' ' : '') + l.subject));
      if (l.extra) c.appendChild(el('span', 'subj-extra-tag', '대신 수업'));
      c.addEventListener('click', function (ev) { ev.stopPropagation(); selKey = l.key; render(); });
      chips.appendChild(c);
    });
    body.appendChild(chips);
    if (lesson.extra && !confirmed) body.appendChild(el('div', 'subj-extra-note', '나이스에서 가져온 수업이에요. 체크하고 마감 완료를 눌러 주세요.'));

    var head = el('div', 'subj-head');
    ['연번', '번호', '이름', '결과', '비고'].forEach(function (h) { head.appendChild(el('span', '', h)); });
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
      cf.className = 'subj-confirm-top' + (dayDone ? ' ok' : '');
      cf.textContent = dayDone ? '마감 완료' : '마감 전';
      cf.title = dayDone ? '눌러서 이 날의 마감을 풀면 다시 고칠 수 있어요' : '이 날의 교과 출결을 모두 입력했으면 눌러요 (하루 단위 · 나이스로 보낼 날 표시 · 나이스 마감은 아니에요)';
      curConfirm = { dateStr: dateStr, lessons: lessons };
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

  // 한 줄: 번호 · 이름 · (체크하면) 비고 칸. 이름 줄을 누르면 체크가 켜지고 꺼진다.
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
      var memo = el('input', 'subj-memo'); memo.type = 'text'; memo.placeholder = '비고'; memo.value = r.memo || '';
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
  function openSummary(init) {
    var old = $('subjSummaryOverlay');
    if (old) old.remove();
    var overlay = el('div', 'day-task-overlay'); overlay.id = 'subjSummaryOverlay';
    var box = el('div', 'day-task-box day-task-box--wide att-summary-box');
    var pickRow = el('div', 'att-pick-row att-ctl-row');
    var yearSel = el('select', 'att-summary-select'), monthSel = el('select', 'att-summary-select'), cls = el('select', 'att-summary-select');
    var tabRow = el('div', 'day-task-tabs');
    var wrap = el('div', 'att-summary-table-wrap');
    var MODES = [['month', '월별'], ['sem1', '1학기'], ['sem2', '2학기'], ['year', '학년도 전체'], ['custom', '기간 선택']];
    var now0 = new Date();
    var selYear = now0.getMonth() >= 2 ? now0.getFullYear() : now0.getFullYear() - 1;   // 학년도: 3월 ~ 다음 해 2월
    var selMonthIdx = (now0.getMonth() + 10) % 12;   // 0 = 3월 … 11 = 2월
    var mode = 'month';
    var customFrom = ymd(new Date(now0.getFullYear(), now0.getMonth(), 1)), customTo = ymd(now0);
    if (init) {   // 학급출결 종합에서 넘어올 때 보던 기간을 그대로 이어받는다
      if (init.mode) mode = init.mode;
      if (init.selYear) selYear = init.selYear;
      if (init.selMonthIdx != null) selMonthIdx = init.selMonthIdx;
      if (init.customFrom) customFrom = init.customFrom;
      if (init.customTo) customTo = init.customTo;
    }

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
      if (mode === 'custom') { var f = customFrom <= customTo ? customFrom : customTo, tt2 = customFrom <= customTo ? customTo : customFrom; return [f, tt2, f + ' ~ ' + tt2]; }
      return [acStart, acEnd, selYear + '학년도'];
    }

    // '기간 선택': 학급출결 종합과 같은 알약 모양 날짜 칸(글자만 보이고 누르면 달력)
    function makeDatePill(onPick) {
      var w = el('span', 'att-date-pill'), txt = el('span', 'att-date-pill-t');
      var inp = el('input'); inp.type = 'date'; inp.setAttribute('aria-label', '날짜 고르기');
      inp.addEventListener('click', function () { try { inp.showPicker(); } catch (e) { /* 달력이 안 열려도 직접 입력은 된다 */ } });
      inp.addEventListener('change', function () { if (inp.value) onPick(inp.value.split('-').join('')); });
      w.appendChild(txt); w.appendChild(inp);
      return { el: w, set: function (v) { inp.value = v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8); txt.textContent = v.slice(0, 4) + '.' + v.slice(4, 6) + '.' + v.slice(6, 8); } };
    }
    var rangeRow = el('span', 'att-range-row'); rangeRow.hidden = true;
    var fromPill = makeDatePill(function (v) { customFrom = v; draw(); });
    var toPill = makeDatePill(function (v) { customTo = v; draw(); });
    rangeRow.appendChild(fromPill.el); rangeRow.appendChild(el('span', 'att-range-tilde', '~')); rangeRow.appendChild(toPill.el);

    function draw() {
      var b = bounds();
      monthSel.hidden = mode !== 'month';
      yearSel.hidden = mode === 'custom';
      rangeRow.hidden = mode !== 'custom';
      if (mode === 'custom') { fromPill.set(b[0]); toPill.set(b[1]); }
      [].forEach.call(tabRow.children, function (bt, k) { bt.classList.toggle('active', MODES[k][0] === mode); });
      wrap.innerHTML = '';
      var rows = marks().filter(function (r) { return String(r.date) >= b[0] && String(r.date) <= b[1]; }).filter(matchesClass);
      if (!rows.length) { wrap.appendChild(el('div', 'att-list-empty', '기록된 출결이 없습니다.')); return; }
      // 학생 × 수업 한 줄. 예전 기록(결석·지각·조퇴)이 있을 때만 그 열을 보여 준다.
      var by = {};
      rows.forEach(function (r) {
        var k = groupName(r) + '|' + r.grade + '-' + r.ban + '-' + r.no + '|' + r.studentName;
        var g = by[k] = by[k] || { r: r, group: groupName(r), c: {}, items: [] };
        g.c['결과'] = (g.c['결과'] || 0) + 1; g.items.push(r);   // 교과출결은 모두 "결과"로 센다
      });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, c) { return a.group.localeCompare(c.group, 'ko') || byNo(a.r, c.r); });
      var cols = ['결과'];
      // 학급출결 종합과 같은 표(att-mx): 연한 줄, 회색 머리글, 0은 연하게·기록 있는 숫자는 굵게, 합계는 파랑
      var tbl = el('table', 'att-mx att-mx--subj');
      var cg = el('colgroup'), totalW = 0;
      var addW = function (w) { var c = el('col'); c.style.width = w + 'px'; cg.appendChild(c); totalW += w; };
      var layoutA = window.__subjLayout !== 'B';   // A: 수업 칸을 세로로 합쳐 가운데 · B: 수업별 제목 줄
      if (layoutA) { addW(120); addW(80); addW(100); cols.forEach(function () { addW(80); }); } else { addW(100); addW(100); cols.forEach(function () { addW(100); }); }
      tbl.style.width = '100%'; tbl.style.minWidth = (totalW + 10) + 'px'; tbl.appendChild(cg);
      var thead = el('thead'), htr = el('tr');
      (layoutA ? ['수업', '반-번호', '성명'] : ['반-번호', '성명']).concat(cols).forEach(function (h) { htr.appendChild(el('th', '', h)); });
      thead.appendChild(htr); tbl.appendChild(thead);
      var tbody = el('tbody'), prevGroup = null, rowIdx = 0, groupSize = {}, lessonCell = {}; var lessonIn = [];
      list.forEach(function (g) { groupSize[g.group] = (groupSize[g.group] || 0) + 1; });
      list.forEach(function (g) {
        var newGroup = g.group !== prevGroup;
        if (newGroup && !layoutA) {
          var btr = el('tr', 'mx-bandrow'), btd = el('td', 'mx-band'); btd.colSpan = 2 + cols.length;
          btd.appendChild(el('b', '', g.group)); btd.appendChild(el('span', '', groupSize[g.group] + '명'));
          btr.appendChild(btd); tbody.appendChild(btr);
        }
        // 줄무늬는 수업이 바뀌어도 이어서 번갈아 넣고, 수업이 바뀌는 곳은 굵은 선으로 가른다
        var tr = el('tr', 'mx-click' + (rowIdx % 2 === 1 ? ' mx-even' : '') + (newGroup && prevGroup !== null ? ' mx-gstart' : ''));
        rowIdx++;
        var td = function (text, cls2) { var d = el('td', cls2 || '', text); tr.appendChild(d); return d; };
        if (layoutA && newGroup) { var lt = td('', 'mx-lesson'); lt.appendChild(el('span', 'mx-lesson-in', g.group)); lessonIn.push(lt.firstChild); lt.rowSpan = groupSize[g.group]; lessonCell[g.group] = lt; }   // 같은 수업은 칸을 세로로 합쳐 가운데에 둔다. 상세 줄을 펴면 그만큼 칸을 늘린다(숨긴 줄은 표 계산에서 빠진다)
        prevGroup = g.group;
        td(g.r.ban + '-' + g.r.no).title = g.r.grade + '-' + g.r.ban + ' ' + g.r.no + '번';
        td(g.r.studentName, 'mx-nm2');
        cols.forEach(function (t2) { var v = g.c[t2] || 0; td(String(v), v ? 'mx-n1' : 'mx-z'); });
        tbody.appendChild(tr);
        var dtr = el('tr', 'mx-detail'); dtr.hidden = true;
        var dtd = el('td'); dtd.colSpan = 2 + cols.length;
        var detail = el('div', 'att-sum-detail');
        g.items.slice().sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : (a.period - c.period); }).forEach(function (it) {
          var line = el('div', 'att-sum-detail-line att-sum-detail-line--go');
          line.title = '누르면 캘린더의 그 날짜로 이동해요';
          line.addEventListener('click', function (ev2) { ev2.stopPropagation(); if (window.TTAPP && window.TTAPP.jumpToDate) window.TTAPP.jumpToDate(it.date, it.legacy ? 'attendance' : 'subject'); });
          var dd = new Date(+it.date.slice(0, 4), +it.date.slice(4, 6) - 1, +it.date.slice(6, 8));
          line.appendChild(el('b', '', (+it.date.slice(4, 6)) + '월 ' + (+it.date.slice(6, 8)) + '일 (' + DAY_NAMES[dd.getDay()] + ')' + (it.period ? ' ' + it.period + '교시' : '')));
          line.appendChild(el('span', '', it.type + (it.reason ? ' · ' + it.reason : '')));
          if (it.memo) line.appendChild(el('i', '', it.memo));
          detail.appendChild(line);
        });
        dtd.appendChild(detail); dtr.appendChild(dtd); tbody.appendChild(dtr);
        tr.addEventListener('click', function (ev) { ev.stopPropagation(); dtr.hidden = !dtr.hidden; tr.classList.toggle('mx-open', !dtr.hidden); if (lessonCell[g.group]) lessonCell[g.group].rowSpan += dtr.hidden ? -1 : 1; });
      });
      // 수업명 상자 폭: 가장 긴 수업명에 딱 맞춰, 짧은 이름도 같은 시작 위치에서 시작하면서 칸 가운데에 오게 한다
      var nameEm = function (str) { var w = 0; for (var q = 0; q < str.length; q++) w += /[ᄀ-ᇿ㄰-㆏가-힯Ⅰ-ⅿ]/.test(str[q]) ? 1 : 0.58; return w; };
      var maxEm = 0; list.forEach(function (g) { maxEm = Math.max(maxEm, nameEm(g.group)); });
      lessonIn.forEach(function (sp) { sp.style.width = Math.min(9, maxEm + 0.4) + 'em'; });
      tbl.appendChild(tbody);
      var mxWrap = el('div', 'att-mx-wrap'); mxWrap.appendChild(tbl);
      wrap.appendChild(mxWrap);
    }

    yearSel.addEventListener('change', function () { selYear = +yearSel.value; draw(); });
    monthSel.addEventListener('change', function () { selMonthIdx = +monthSel.value; draw(); });
    cls.addEventListener('change', draw);
    MODES.forEach(function (p) {
      var bt = el('button', 'day-task-tab', p[1]); bt.type = 'button';
      bt.addEventListener('click', function (ev) { ev.stopPropagation(); mode = p[0]; draw(); });
      tabRow.appendChild(bt);
    });
    pickRow.appendChild(yearSel); pickRow.appendChild(monthSel); pickRow.appendChild(rangeRow); pickRow.appendChild(tabRow);

    // 표 바로 위 얇은 줄: 왼쪽 학급/교과 스위치, 오른쪽 수업 선택 (학급출결 종합과 같은 자리·같은 모양)
    var slimRow = el('div', 'att-slim-row');
    var seg = el('div', 'att-seg');
    [['학급', '학급 출결'], ['교과', '교과 출결']].forEach(function (p) {
      var sb = el('button', 'att-seg-btn att-seg-btn--' + (p[0] === '학급' ? 'cls' : 'subj') + (p[0] === '교과' ? ' active' : '')); sb.type = 'button';
      var iconSrc = document.querySelector('.tabbtn[data-tab="' + (p[0] === '학급' ? 'attendance' : 'subject') + '"] svg');
      sb.innerHTML = (iconSrc ? iconSrc.outerHTML : '') + '<span>' + p[1] + '</span>';
      sb.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (p[0] === '교과') return;
        var st = { mode: mode, selYear: selYear, selMonthIdx: selMonthIdx, customFrom: customFrom, customTo: customTo };
        overlay.remove();
        if (window.TTAPP && window.TTAPP.openAttendanceSummary) window.TTAPP.openAttendanceSummary(st);
      });
      seg.appendChild(sb);
    });
    slimRow.appendChild(seg); slimRow.appendChild(cls); cls.classList.add('subj-sum-cls');

    var close = el('button', 'day-task-close day-task-close--bottom', '닫기'); close.type = 'button';
    close.addEventListener('click', function (ev) { ev.stopPropagation(); overlay.remove(); });
    box.appendChild(pickRow); box.appendChild(slimRow); box.appendChild(wrap); box.appendChild(close);
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
    var purged = purgeTestRecords();
    persist();
    return changed || purged > 0;
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
  // 학급출결 표의 교시 칸용: 그날 체크된 학생별 [{period, subject, type}] ("학년-반-번호" → 목록). 지금은 이 PC에 있는 교과출결만 쓴다.
  function periodsOn(dateStr) {
    ensureTeacher();   // 교과출결 탭을 아직 안 열어 선생님이 정해지지 않았어도 내 수업 마감이 학급출결 칸에 보이게
    var m = {};
    listOn(dateStr).forEach(function (r) {
      var k = r.grade + '-' + r.ban + '-' + r.no;
      (m[k] = m[k] || []).push({ period: Number(r.period), subject: r.subject || '', type: r.type || '', teacher: teacherName || '', memo: String(r.memo || '').trim() });
    });
    try {   // 내 수업을 마감(전원 출석 포함)했으면, 그 수업 명단의 학생 칸도 초록으로 켠다. 체크한 학생은 위에서 이미 들어 있다.
      var ds0 = String(dateStr), day0 = new Date(+ds0.slice(0, 4), +ds0.slice(4, 6) - 1, +ds0.slice(6, 8));
      lessonsOn(day0).forEach(function (l) {
        if (!lessonDone(ds0, l)) return;
        notExcluded(l.students || []).forEach(function (s) {
          var k = s.grade + '-' + s.ban + '-' + s.no;
          if ((m[k] || []).some(function (h) { return h.period === Number(l.period); })) return;
          (m[k] = m[k] || []).push({ period: Number(l.period), subject: l.subject || '', type: '마감', teacher: teacherName || '', memo: '' });
        });
      });
    } catch (e) { /* 시간표가 아직 없으면 체크한 칸만 보여 준다 */ }
    if (window.TTSHARE) {   // 다른 선생님이 올린 체크(공유 서버)도 합친다
      var pm = window.TTSHARE.peerPeriods(dateStr);
      Object.keys(pm).forEach(function (k) { (m[k] = m[k] || []).push.apply(m[k], pm[k]); });
    }
    return m;
  }
  // 교과출결 공유용: 오늘 앞뒤(최근 3일~내일)에 내가 체크한 학생들 {id,date,period,grade,ban,no,subject,type}
  function shareMarks() {
    var lo = ymd(new Date(Date.now() - 3 * 86400000)), hi = ymd(new Date(Date.now() + 86400000)), out = [], ex = exclSet();
    records.forEach(function (r) {
      if (!notConfirm(r) || !r.grade || !r.ban || !r.no || !r.date || String(r.date) < lo || String(r.date) > hi) return;
      if (ex[exclKey(r.grade, r.ban, r.no)] !== undefined) return;
      out.push({ id: r.id, date: String(r.date), period: Number(r.period), grade: Number(r.grade), ban: Number(r.ban), no: Number(r.no), subject: String(r.subject || '').slice(0, 20), type: (r.type === '결석' || r.type === '지각' || r.type === '조퇴') ? r.type : '결과', memo: String(r.memo || '').replace(/\s+/g, ' ').trim().slice(0, 60) });
    });
    // 내가 마감한 수업(전원 출석 포함)은 명단 학생 전원을 "결과"로 올려서, 담임 선생님 학급출결 칸이 초록으로 켜지게 한다. 이미 체크한 학생은 위에서 올라갔으니 건너뛴다.
    try {
      var have = {}; out.forEach(function (m) { have[m.date + '|' + m.period + '|' + m.grade + '-' + m.ban + '-' + m.no] = 1; });
      for (var dd = new Date(Date.now() - 3 * 86400000); ymd(dd) <= hi; dd = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate() + 1)) {
        var ds1 = ymd(dd);
        lessonsOn(dd).forEach(function (l) {
          if (!lessonDone(ds1, l)) return;
          notExcluded(l.students || []).forEach(function (st) {
            if (!st.grade || !st.ban || !st.no) return;
            var hk = ds1 + '|' + l.period + '|' + st.grade + '-' + st.ban + '-' + st.no;
            if (have[hk]) return;
            have[hk] = 1;
            out.push({ id: ds1 + '|' + l.period + '|' + l.label + '|' + st.grade + '-' + st.ban + '-' + st.no + '|__ok', date: ds1, period: Number(l.period), grade: Number(st.grade), ban: Number(st.ban), no: Number(st.no), subject: String(l.subject || '').slice(0, 20), type: '결과', memo: '' });
          });
        });
      }
    } catch (e) { /* 시간표가 아직 없으면 체크한 학생만 올린다 */ }
    return out;
  }
  // 학생 한 명의 그날 그 교시 수업(과목·선생님). 마감하지 않은 칸도 누구 수업인지 알 수 있게 학급출결 칸 설명에 쓴다.
  // 학생 시간표에 적힌 선생님이 선생님 시간표와 어긋나면(그 선생님은 그 시간에 다른 학년 수업을 하거나 수업이 없음) 그 이름은 빼고,
  // 하나도 안 남으면 선생님 시간표에서 이 학생의 반(예: 3-6) 수업을 하는 선생님을 찾는다. 그래도 없으면 선생님 이름은 비워 둔다(틀린 이름을 보이지 않는다).
  function slotOf(dateStr, grade, ban, no, period) {
    try {
      var tt = timetable(); if (!tt) return null;
      var ds = String(dateStr), d = new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8)), dow = d.getDay(), pi = Number(period) - 1;
      var cellOf = function (x) { return (((x && x.days) || {})[dow] || [])[pi] || null; };
      var s = (tt.students || []).filter(function (x) { return String(x.grade) === String(grade) && String(x.ban) === String(ban) && String(x.no) === String(no); })[0];
      var c = cellOf(s);
      if (!c || (!c.subject && !c.classLabel)) return null;
      var gr = String(grade), gb = gr + '-' + ban, teachers = tt.teachers || [];
      var codesOf = function (tc) { return String((tc && tc.classLabel) || '').match(/\d-\d+/g) || []; };
      var names = String(c.classLabel || '').split(/[·,\/]/).map(function (x) { return x.trim(); }).filter(Boolean);
      var valid = names.filter(function (n) {
        var t = teachers.filter(function (x) { return x.teacherName === n; })[0], tc = cellOf(t);
        if (!t || !tc) return false;
        var codes = codesOf(tc);
        return !codes.length || codes.some(function (x) { return x.split('-')[0] === gr; });
      });
      if (!valid.length) valid = teachers.filter(function (t) { return codesOf(cellOf(t)).indexOf(gb) >= 0; }).map(function (t) { return t.teacherName; });
      return { subject: String(c.subject || ''), teacher: valid.join('·') };
    } catch (e) { return null; }
  }
  // 학급출결 교시 칸용: 그 학생(반)이 그 요일 그 교시에 "수업이 없는" 시간이면 true. 시간표가 없거나 평일이 아니면 false(모르면 수업 있음으로 본다).
  // 학생 시간표가 있는 학년(2·3학년)은 학생의 칸이 비었는지로, 학생 시간표가 없는 학년(1학년)은 선생님 시간표에 그 반의 수업이 하나도 없는지로 본다.
  function noLessonOf(dateStr, grade, ban, no, period) {
    try {
      var tt = timetable(); if (!tt) return false;
      var ds = String(dateStr), d = new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8)), dow = d.getDay(), pi = Number(period) - 1;
      if (dow < 1 || dow > 5) return false;
      var cellOf = function (x) { return (((x && x.days) || {})[dow] || [])[pi] || null; };
      var s = (tt.students || []).filter(function (x) { return String(x.grade) === String(grade) && String(x.ban) === String(ban) && String(x.no) === String(no); })[0];
      if (s) { var c = cellOf(s); return !c || (!c.subject && !c.classLabel); }
      var gr = String(grade), gb = gr + '-' + ban, any = false;
      var teachers = tt.teachers || [];
      for (var i = 0; i < teachers.length; i++) {
        var row = (teachers[i].days || {});
        for (var dw = 1; dw <= 5 && !any; dw++) ((row[dw] || [])).forEach(function (cc) { if (cc && String(cc.classLabel || '').match(/\d-\d+/g)) any = any || (cc.classLabel.indexOf(gr + '-') >= 0); });
        if (any) break;
      }
      if (!any) return false;   // 이 학년 자료가 시간표에 아예 없으면 모른다
      for (var j = 0; j < teachers.length; j++) {
        var tc = cellOf(teachers[j]);
        if (tc && (String(tc.classLabel || '').match(/\d-\d+/g) || []).indexOf(gb) >= 0) return false;
      }
      return true;
    } catch (e) { return false; }
  }
  function shareTeacher() { ensureTeacher(); return teacherName; }
  function openDate(d) { viewDate = new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // 쉬는 날(토·일·공휴일)은 하루씩 넘길 때 건너뛴다.
  function isRest(d) { return hooks().isRestDay ? hooks().isRestDay(d) : (d.getDay() === 0 || d.getDay() === 6); }
  function nextSchoolDay(from, step) {
    var d = new Date(from);
    for (var i = 0; i < 14; i++) { d.setDate(d.getDate() + step); if (!isRest(d)) break; }
    return d;
  }
  function shiftDate(n) {
    var step = n < 0 ? -1 : 1;
    viewDate = nextSchoolDay(viewDate, step); render();
    settleDate(viewDate, step, 0);
  }
  // 새로 도착한 날의 달 공휴일을 불러온 뒤에도 쉬는 날이면 한 번 더 건너뛴다(달이 바뀌면 그 달도 불러온다).
  function settleDate(shown, step, depth) {
    if (!hooks().loadHolidays) return;
    var p; try { p = hooks().loadHolidays(shown.getFullYear(), shown.getMonth()); } catch (e) { return; }
    p.then(function () {
      if (viewDate !== shown || !isRest(shown)) return;
      var n = nextSchoolDay(shown, step);
      viewDate = n; render();
      if (depth < 4) settleDate(n, step, depth + 1);
    });
  }

  // 개발 중 시험(11/9 가짜 나이스)으로 잘못 들어온 임시 수업·명단 수정·수업 빼기 기록을 한 번 지운다(삭제 표시를 남겨 구글 드라이브·폰에서도 지워진다).
  // 지운 뒤 "나이스 읽고 시간표 맞추기"를 다시 하면 진짜 나이스 기준으로 다시 만들어진다.
  var TEST_RECORD_IDS = ['20261109|4|3-7|__extra', '20261109|4|3-7강의실|__extra', '20261109|2|3-3강의실|__extra', '20261109|2|3-3|__skip', 'fix|20261109|1|6|3-2', 'fix|20261109|1|2|3-3', '20261110|5|3-9|__extra', '20261110|3|3-9|__extra', 'fix|20261110|2|2|3-2'];
  function purgeTestRecords() {
    var removed = 0, now = Date.now();
    records = records.filter(function (r) {
      if (r && TEST_RECORD_IDS.indexOf(r.id) >= 0 && (r.kind === 'extra' || r.kind === 'skip' || r.kind === 'rosterfix')) { tombs[r.id] = now; removed++; return false; }
      return true;
    });
    if (removed) save();
    return removed;
  }
  function init() {
    load();
    purgeTestRecords();
    var card = $('subjCard');
    if (!card) return;
    $('subjPrev').addEventListener('click', function (ev) { ev.stopPropagation(); shiftDate(-1); });
    $('subjNext').addEventListener('click', function (ev) { ev.stopPropagation(); shiftDate(1); });
    $('subjToday').addEventListener('click', function (ev) { ev.stopPropagation(); viewDate = new Date(); render(); });
    $('subjSummaryBtn').addEventListener('click', function (ev) { ev.stopPropagation(); openSummary(); });
    $('subjConfirmBtn').addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!curConfirm) return;
      toggleSubjDay(curConfirm.dateStr, curConfirm.lessons); render();
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
    // ① 마감한 날(교과 일 단위): 그날 내 수업 전부  ② 예전에 수업마다 한 마감 기록
    var cands = [], seen = {};
    function addCand(date, l) {
      var key = date + '|' + l.period + '|' + l.label;
      if (seen[key]) return; seen[key] = 1;
      cands.push({ date: String(date), period: Number(l.period), label: l.label, subject: l.subject });
    }
    records.forEach(function (r) {
      if (!r || r.kind !== 'confirm' || r.scope !== 'class-day' || r.label !== SUBJ_DAY) return;
      if (String(r.date) < from || String(r.date) > to) return;
      var ds = String(r.date), day = new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8));
      lessonsOn(day).forEach(function (l) { addCand(ds, l); });
    });
    records.forEach(function (r) {
      if (isConfirm(r) && r.scope !== 'class-day' && String(r.date) >= from && String(r.date) <= to) addCand(r.date, { period: r.period, label: r.label, subject: r.subject });
    });
    var lessons = cands
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
          if (ls) roster = notExcluded(ls.students).map(function (s) { return { grade: Number(s.grade), ban: Number(s.ban), no: Number(s.no), name: s.name || s.studentName || '' }; });
        } catch (e) { roster = undefined; }
        var out = { date: c.date, period: c.period, label: c.label, subject: c.subject, confirmed: true, marks: marks };
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
          out.push({ date: ymd(d), dow: d.getDay(), period: l.period, label: l.label, subject: l.subject, extra: !!l.extra, biweekly: l.biweekly || '', confirmed: lessonDone(ymd(d), l),
            roster: notExcluded(l.students).map(function (s) { return { grade: Number(s.grade), ban: Number(s.ban), no: Number(s.no), name: s.studentName || '' }; }) });
        });
      }
      var tt0 = timetable();
      return { version: 1, teacher: teacherName, lessons: out, excluded: ((tt0 && tt0.excludedStudents) || []).map(function (x) { return { grade: Number(x.grade), ban: Number(x.ban), no: Number(x.no), name: String(x.name || '') }; }) };
      });
    },
    // 확장프로그램이 나이스 기준으로 보낸 변경을 반영한다: 임시 수업 추가/갱신(extras), 명단 수정(fixes). 모양을 엄격히 검사한다.
    apply: function (p) {
      var whoApply = p && typeof p.teacher === 'string' ? p.teacher.slice(0, 30) : '';
      return withTeacher(whoApply, function () {
      var okS = function (s) { return s && Number.isInteger(s.grade) && Number.isInteger(s.ban) && Number.isInteger(s.no) && s.grade > 0 && s.ban > 0 && s.no > 0 && s.grade < 10 && s.ban < 100 && s.no < 100 && typeof s.name === 'string' && s.name.length <= 20; };
      var okD = function (d) { return /^\d{8}$/.test(String(d)); };
      var okL = function (x) { return typeof x === 'string' && x.length > 0 && x.length <= 20; };
      var ex = (p && p.extras) || [], fx = (p && p.fixes) || [], sk = (p && p.skips) || [];
      if (!Array.isArray(ex) || !Array.isArray(fx) || !Array.isArray(sk) || ex.length > 60 || fx.length > 60 || sk.length > 200) throw new Error('bad');
      var exs = exclSet();
      ex.forEach(function (e) { e.students = e.students.filter(function (s) { return !isExcl(exs, s.grade, s.ban, s.no, s.name); }); });
      fx.forEach(function (f) { f.add = f.add.filter(function (s) { return !isExcl(exs, s.grade, s.ban, s.no, s.name); }); });
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
      // 격주 관찰: 나이스에서 확인한 날(date)·교시·반(label) → 그 칸의 홀짝 기준을 저장한다. 같은 칸은 가장 나중 날짜가 이긴다.
      var ob = (p && p.obs) || [];
      if (Array.isArray(ob) && ob.length <= 400) {
        var bwChanged = false;
        ob.forEach(function (o) {
          if (!o || !okD(o.date) || !Number.isInteger(o.period) || !okL(o.label)) return;
          var ds0 = String(o.date), day0 = new Date(+ds0.slice(0, 4), +ds0.slice(4, 6) - 1, +ds0.slice(6, 8));
          var hit = baseLessonsOn(day0, true).filter(function (l) { return l.period === o.period && l.label === o.label && l.bwKey; })[0];
          if (!hit) return;
          var cur = bwRule(hit.bwKey);
          if (cur && cur.anchor >= ds0) return;
          var rec = { id: 'bw|' + hit.bwKey, kind: 'bw', key: hit.bwKey, labels: hit.bwKey.split('|')[2].split(','), anchor: ds0, active: o.label, updatedAt: now };
          records = records.filter(function (x) { return x.id !== rec.id; }); records.push(rec); delete tombs[rec.id]; bwChanged = true;
        });
        if (bwChanged) { save(); try { render(); } catch (e0) { /* 화면이 없으면 건너뜀 */ } }
      }
      return { ok: true, extras: n1, fixes: n2, skips: n3 };
      });
    }
  };

  window.SUBJ = {
    init: init,
    show: function () { if (timetable() && !$('subjTeacher').options.length) fillTeachers(); render(); },
    render: render,
    openSummary: openSummary,
    listOn: listOn,
    periodsOn: periodsOn,
    slotOf: slotOf,
    noLessonOf: noLessonOf,
    shareMarks: shareMarks,
    shareTeacher: shareTeacher,
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

/* ───────── 교과출결 공유 (Cloudflare 서버) ─────────
   · 내가 체크한 학생을 서버에 올리고(학년·반·번호·교시·과목·내 이름만, 학생 이름은 올리지 않음),
   · 담임 반 학생에 대한 다른 선생님의 체크를 실시간으로 받아 학급출결 표의 "교과출결" 칸에 보여 준다.
   설정(주소·학교 코드)이 없으면 아무 일도 하지 않는다. */
(function () {
  var CFG_KEY = 'ttShareCfgV1', SENT_KEY = 'ttShareSentV1';
  var cfg = null, sent = {}, peers = {}, ws = null, wsFor = '', pingT = null, retryT = null, flushT = null, flushing = false;
  var state = { text: '꺼짐', ok: false };
  var URL_OK = /^(https:\/\/[A-Za-z0-9.-]+|http:\/\/127\.0\.0\.1:\d+)$/;
  var source = '';   // 'manual'(직접 입력) | 'auto'(배포·동기화로 들어온 설정) | ''
  function okCfg(v) { return v && typeof v.url === 'string' && URL_OK.test(v.url) && typeof v.code === 'string' && v.code.length >= 8 ? { url: v.url.replace(/\/+$/, ''), code: v.code } : null; }
  function bakedCfg() { try { var c = window.DASHBOARD_CONFIG && window.DASHBOARD_CONFIG.share; return okCfg(c); } catch (e) { return null; } }
  function prefCfg() { try { return okCfg(window.TTAPP && window.TTAPP.getPref ? window.TTAPP.getPref('share-cfg') : null); } catch (e) { return null; } }
  function readCfg() {
    var m = null; try { m = okCfg(JSON.parse(localStorage.getItem(CFG_KEY) || 'null')); } catch (e) { m = null; }
    if (m) { source = 'manual'; return m; }
    var b = bakedCfg();
    if (b) {   // 배포에 들어 있는 설정이면, 폰도 입력 없이 쓰도록 드라이브 동기화 목록(prefs)에 한 번 적어 둔다
      source = 'auto';
      var p = prefCfg();
      if (!p || p.url !== b.url || p.code !== b.code) { try { if (window.TTAPP && window.TTAPP.setPref) window.TTAPP.setPref({ id: 'share-cfg', url: b.url, code: b.code }); } catch (e) { /* 다음에 다시 */ } }
      return b;
    }
    var q = prefCfg();
    if (q) { source = 'auto'; return q; }
    source = ''; return null;
  }
  function readSent() { try { var v = JSON.parse(localStorage.getItem(SENT_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  function saveSent() { try { localStorage.setItem(SENT_KEY, JSON.stringify(sent)); } catch (e) { /* 저장 공간 문제는 넘어간다 */ } }
  function setState(text, ok) { state = { text: text, ok: !!ok }; try { if (window.TTAPP && window.TTAPP.refreshShareStatus) window.TTAPP.refreshShareStatus(); } catch (e) { /* 화면이 없으면 건너뜀 */ } }
  function configured() { return !!cfg; }
  function hdr() { return { 'Content-Type': 'application/json', 'X-TT-Code': cfg.code }; }
  function api(path, opt) { return fetch(cfg.url + path, Object.assign({ headers: hdr() }, opt || {})); }

  function changed() { if (!configured()) return; clearTimeout(flushT); flushT = setTimeout(flush, 700); }

  // 내 체크 올리기: 지난번에 올린 것과 비교해서 달라진 것만 보낸다. 실패하면 다음에 다시 시도한다.
  async function flush() {
    if (!configured() || flushing || !window.SUBJ || !window.SUBJ.shareMarks) return;
    var teacher = window.SUBJ.shareTeacher();
    if (!teacher || !/^[가-힣A-Za-z0-9 ._-]{1,30}$/.test(teacher)) return;
    flushing = true;
    try {
      var own = {}; window.SUBJ.shareMarks().forEach(function (m) { own[m.id] = m; });
      var items = [];
      Object.keys(own).forEach(function (id) { var m = own[id], h = JSON.stringify(m); if (!sent[id] || sent[id].h !== h) items.push(Object.assign({ op: 'set' }, m)); });
      Object.keys(sent).forEach(function (id) { if (!own[id] && sent[id].m) items.push(Object.assign({}, sent[id].m, { op: 'del' })); });
      if (!items.length) return;
      for (var i = 0; i < items.length; i += 150) {
        var chunk = items.slice(i, i + 150);
        var r = await api('/v1/marks', { method: 'POST', body: JSON.stringify({ teacher: teacher, items: chunk }) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        chunk.forEach(function (it) { if (it.op === 'set') sent[it.id] = { h: JSON.stringify(own[it.id]), m: own[it.id] }; else delete sent[it.id]; });
        saveSent();
      }
      setState('연결됨', true);
    } catch (e) {
      setState('보내지 못했어요(곧 다시 시도)', false);
      clearTimeout(retryT); retryT = setTimeout(flush, 30000);
    } finally { flushing = false; }
  }

  // 담임 반 학생에 대한 다른 선생님의 체크 받기(실시간 연결)
  function homeroom() { try { return window.TTAPP && window.TTAPP.homeroom ? window.TTAPP.homeroom() : null; } catch (e) { return null; } }
  function repaint() { try { if (window.TTAPP && window.TTAPP.refreshAttendance) window.TTAPP.refreshAttendance(); } catch (e) { /* 화면이 없으면 건너뜀 */ } }
  function applySnap(marks) { peers = {}; (marks || []).forEach(function (m) { peers[m.k] = m; }); repaint(); }
  function closeWs() { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) { /* 이미 닫힘 */ } } ws = null; wsFor = ''; clearInterval(pingT); }
  function connect() {
    var h = homeroom();
    if (!configured() || !h) { closeWs(); return; }
    var key = h.grade + '-' + h.ban;
    if (ws && wsFor === key) return;
    closeWs(); wsFor = key;
    try {
      var w = new WebSocket(cfg.url.replace(/^http/, 'ws') + '/v1/live?grade=' + encodeURIComponent(h.grade) + '&ban=' + encodeURIComponent(h.ban), ['tt.' + cfg.code]);
      ws = w;
      w.onopen = function () { setState('연결됨', true); clearInterval(pingT); pingT = setInterval(function () { try { w.send('ping'); } catch (e) { /* 끊김 */ } }, 25000); };
      w.onmessage = function (e) {
        if (e.data === 'pong') return;
        var d; try { d = JSON.parse(e.data); } catch (x) { return; }
        if (d.t === 'snap') applySnap(d.marks);
        else if (d.t === 'set' && d.m) { peers[d.m.k] = d.m; repaint(); }
        else if (d.t === 'del' && d.k) { delete peers[d.k]; repaint(); }
      };
      w.onclose = function () { if (ws !== w) return; ws = null; wsFor = ''; clearInterval(pingT); setState('다시 연결하는 중…', false); clearTimeout(retryT); retryT = setTimeout(connect, 5000); };
      w.onerror = function () { /* onclose에서 다시 시도 */ };
    } catch (e) { setState('연결하지 못했어요', false); }
  }

  // 학급출결 표용: 날짜별로 "학년-반-번호" → [{period, subject, type, teacher}]
  function peerPeriods(dateStr) {
    var out = {}, h = homeroom(), me = (window.SUBJ && window.SUBJ.shareTeacher) ? window.SUBJ.shareTeacher() : '';
    if (!configured() || !h) return out;
    Object.keys(peers).forEach(function (k) {
      var m = peers[k];
      if (!m || m.date !== dateStr || m.teacher === me) return;   // 내 체크는 내 앱에 이미 있다
      var key = h.grade + '-' + h.ban + '-' + m.no;
      (out[key] = out[key] || []).push({ period: Number(m.period), subject: m.subject, type: /\|__ok$/.test(String(k)) ? '마감' : m.type, teacher: m.teacher, memo: m.memo || '' });
    });
    return out;
  }

  function start() {
    cfg = readCfg(); sent = readSent();
    if (!configured()) { closeWs(); setState('꺼짐', false); return; }
    setState('연결하는 중…', false);
    flush(); connect();
  }
  async function test(url, code) {
    var u = String(url || '').trim().replace(/\/+$/, '');
    if (!URL_OK.test(u)) return { ok: false, msg: '주소가 https:// 로 시작해야 해요' };
    try {
      var r = await fetch(u + '/v1/ping', { headers: { 'X-TT-Code': String(code || '').trim() } });
      if (r.status === 401) return { ok: false, msg: '학교 코드가 맞지 않아요' };
      if (r.status === 503) return { ok: false, msg: '서버에 학교 코드가 아직 없어요' };
      return r.ok ? { ok: true, msg: '연결됐어요' } : { ok: false, msg: '서버가 응답하지 않아요(' + r.status + ')' };
    } catch (e) { return { ok: false, msg: '서버에 닿지 않아요(주소·인터넷을 확인해 주세요)' }; }
  }
  function setConfig(url, code) {
    try {
      if (!url && !code) { localStorage.removeItem(CFG_KEY); localStorage.removeItem(SENT_KEY); }
      else localStorage.setItem(CFG_KEY, JSON.stringify({ url: String(url).trim().replace(/\/+$/, ''), code: String(code).trim() }));
    } catch (e) { /* 저장 못 하면 그대로 */ }
    closeWs(); peers = {}; start(); repaint();
  }

  window.TTSHARE = {
    changed: changed, peerPeriods: peerPeriods, start: start, test: test, setConfig: setConfig, connect: connect,
    configured: configured, status: function () { return state; }, url: function () { return cfg ? cfg.url : ''; }, source: function () { return source; }
  };
  document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 1500); });
})();
