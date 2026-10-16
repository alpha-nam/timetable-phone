'use strict';
/*
 * board.js — 메모 탭(패들렛 같은 보드)과 휴지통·백업 복원 화면.
 *
 *  - 섹션(칸)을 직접 만들고, 카드를 끌어서 순서를 바꾸거나 다른 섹션으로 옮긴다. 칸 배치는 가로/세로 선택.
 *  - 지운 카드·섹션·출결·날짜별 할 일은 휴지통에 90일 보관되고 되살릴 수 있다.
 *  - 백업(구글 드라이브 하루 1번, PC 자동 백업)에서 없어진 것만 되살리거나 그 시점으로 되돌린다.
 *  - 폰·PC 동기화는 app.js의 구글 연동이 이 파일의 getSyncState()/applySync()를 부른다.
 * app.js가 먼저 읽히고, 시작은 app.js의 init()이 BOARD.init()을 부른다.
 */
(function () {
  var KEYS = {
    cards: 'dashboardMemoTodos', sections: 'dashboardMemoSections', tombs: 'dashboardMemoTombstones',
    secTombs: 'dashboardMemoSecTombs', trash: 'dashboardTrash', trashTombs: 'dashboardTrashTombs', layout: 'dashboardMemoLayout'
  };
  var TRASH_KEEP_MS = 90 * 24 * 3600 * 1000;
  var TAG_COLORS = ['#f6bd56', '#6aa9f0', '#6cc58b', '#f08bb0', '#a98be8'];
  var KIND_LABEL = { memo: '카드', section: '섹션', attendance: '출결', daytask: '날짜 할 일' };

  var cards = [], sections = [], tombs = {}, secTombs = {}, trash = [], trashTombs = {};
  var sigCards = null, sigSecs = null;
  var layout = 'h';
  var addingIn = null;           // 카드 추가 입력창이 열려 있는 섹션 id
  var editingId = null;          // 제자리 편집 중인 카드 id
  var $ = function (id) { return document.getElementById(id); };
  function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function app() { return window.TTAPP || {}; }

  // ───────── 저장·불러오기 ─────────
  function read(key, fallback) { try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 저장 불가 */ } }

  function sigCard(c) { return JSON.stringify([c.text, !!c.done, c.sectionId, c.order, c.tag ? [c.tag.text, c.tag.color] : null, styleSig(c.style)]); }
  function sigSec(s) { return JSON.stringify([s.name, s.order, styleSig(s.style)]); }
  function sigMap(list, fn) { var m = {}; list.forEach(function (x) { if (x && x.id) m[x.id] = fn(x); }); return m; }

  function load() {
    var raw = read(KEYS.cards, []);
    cards = Array.isArray(raw) ? raw.filter(function (c) { return c && typeof c.text === 'string'; }) : [];
    sections = read(KEYS.sections, []); if (!Array.isArray(sections)) sections = [];
    tombs = read(KEYS.tombs, {}) || {}; secTombs = read(KEYS.secTombs, {}) || {};
    trash = read(KEYS.trash, []); if (!Array.isArray(trash)) trash = [];
    trashTombs = read(KEYS.trashTombs, {}) || {};
    cards.forEach(function (c) { if (!c.id) c.id = uid('m'); });
    // 섹션 없이 쓰는 카드는 sectionId가 ''(빈 값)이다. 섹션이 지워졌거나 없는 카드도 같은 칸(미분류)에 보인다.
    cards.forEach(function (c) { if (c.sectionId == null) c.sectionId = ''; });
    // order가 없던 예전 카드는 저장된 순서대로 번호를 붙인다(새 카드가 맨 위로 끼어들지 않게).
    var seq = {};
    cards.forEach(function (c) { if (c.order == null) { seq[c.sectionId] = (seq[c.sectionId] || 0); c.order = seq[c.sectionId]; } seq[c.sectionId] = Math.max(seq[c.sectionId] || 0, (c.order || 0)) + 1; });
    var cut = Date.now() - TRASH_KEEP_MS;   // 90일이 지난 휴지통 항목은 비운다
    trash = trash.filter(function (t) { return (t.deletedAt || 0) >= cut; });
    // 처음에는 PC·태블릿은 가로 칸, 폰은 세로로 쌓는다(바꾸면 기억).
    layout = read(KEYS.layout, null) || (document.documentElement.hasAttribute('data-phone') && window.innerWidth < 700 ? 'v' : 'h');
    sigCards = sigMap(cards, sigCard); sigSecs = sigMap(sections, sigSec);
  }

  // 저장 전에 "바뀐 것"을 찾아 updatedAt을 찍고, 사라진 것은 삭제 표시로 남긴다.
  function stamp() {
    var t = Date.now();
    if (sigCards) {
      var curC = sigMap(cards, sigCard);
      cards.forEach(function (c) { if (sigCards[c.id] !== curC[c.id]) c.updatedAt = t; });
      Object.keys(sigCards).forEach(function (id) { if (!(id in curC)) tombs[id] = t; });
      sigCards = curC;
    }
    if (sigSecs) {
      var curS = sigMap(sections, sigSec);
      sections.forEach(function (s) { if (sigSecs[s.id] !== curS[s.id]) s.updatedAt = t; });
      Object.keys(sigSecs).forEach(function (id) { if (!(id in curS)) secTombs[id] = t; });
      sigSecs = curS;
    }
  }
  function save() {
    stamp();
    write(KEYS.cards, cards); write(KEYS.sections, sections); write(KEYS.tombs, tombs); write(KEYS.secTombs, secTombs);
    write(KEYS.trash, trash); write(KEYS.trashTombs, trashTombs);
    if (app().scheduleSync) app().scheduleSync();
  }

  // ───────── 구글 동기화 연결부 ─────────
  function getSyncState() {
    stamp();
    write(KEYS.cards, cards); write(KEYS.sections, sections); write(KEYS.tombs, tombs); write(KEYS.secTombs, secTombs); write(KEYS.trash, trash); write(KEYS.trashTombs, trashTombs);
    return {
      memo: { records: cards, tombstones: tombs },
      sections: { records: sections, tombstones: secTombs },
      trash: { records: trash, tombstones: trashTombs }
    };
  }
  function applySync(res) {
    var changed = false;
    if (res.memo) {
      var nc = res.memo.records || [];
      if (JSON.stringify(nc) !== JSON.stringify(cards)) { cards = nc; changed = true; }
      tombs = res.memo.tombstones || {}; sigCards = sigMap(cards, sigCard);
    }
    if (res.sections) {
      var ns = res.sections.records || [];
      if (JSON.stringify(ns) !== JSON.stringify(sections)) { sections = ns; changed = true; }
      secTombs = res.sections.tombstones || {}; sigSecs = sigMap(sections, sigSec);
    }
    if (res.trash) {
      var nt = res.trash.records || [];
      if (JSON.stringify(nt) !== JSON.stringify(trash)) { trash = nt; changed = true; }
      trashTombs = res.trash.tombstones || {};
    }
    write(KEYS.cards, cards); write(KEYS.sections, sections); write(KEYS.tombs, tombs); write(KEYS.secTombs, secTombs); write(KEYS.trash, trash); write(KEYS.trashTombs, trashTombs);
    return changed;
  }

  // ───────── 휴지통 ─────────
  function addToTrash(kind, item) {
    if (!item) return;
    var id = 'tr-' + kind + '-' + item.id;
    trash = trash.filter(function (t) { return t.id !== id; });
    var t = Date.now();
    trash.push({ id: id, kind: kind, item: JSON.parse(JSON.stringify(item)), deletedAt: t, updatedAt: t });
    delete trashTombs[id];
    write(KEYS.trash, trash); write(KEYS.trashTombs, trashTombs);
  }
  function dropTrashEntry(id) {
    trash = trash.filter(function (t) { return t.id !== id; });
    trashTombs[id] = Date.now();
  }

  // ───────── 카드·섹션 조작 ─────────
  // sid가 ''이면 "섹션 없음" 카드(섹션을 안 만든 사람의 메모, 또는 섹션이 지워져 갈 곳 없는 카드).
  function inNone(c) { return !c.sectionId || !sections.some(function (s) { return s.id === c.sectionId; }); }
  function sectionCards(sid) {
    return cards.filter(function (c) { return sid === '' ? inNone(c) : c.sectionId === sid; }).sort(function (a, b) {
      var ao = a.order == null ? 1e9 : a.order, bo = b.order == null ? 1e9 : b.order;
      return ao - bo || (b.updatedAt || 0) - (a.updatedAt || 0) || (a.id < b.id ? -1 : 1);
    });
  }
  function sortedSections() {
    return sections.slice().sort(function (a, b) { return (a.order == null ? 1e9 : a.order) - (b.order == null ? 1e9 : b.order) || (a.id < b.id ? -1 : 1); });
  }
  function renumber(sid) { sectionCards(sid).forEach(function (c, i) { c.order = i; }); }
  function renumberSections() { sortedSections().forEach(function (s, i) { s.order = i; }); }

  function addCard(sid, text) {
    text = String(text || '').trim();
    if (!text) return;
    var list = sectionCards(sid);
    cards.push({ id: uid('m'), text: text, done: false, sectionId: sid, order: list.length });
    save();
  }
  // 카드를 (섹션, 위치)로 옮긴다. index는 그 섹션의 카드 목록(옮기는 카드 제외)에서 들어갈 자리.
  function placeCard(card, sid, index) {
    var from = card.sectionId;
    var list = sectionCards(sid).filter(function (c) { return c.id !== card.id; });
    card.sectionId = sid;
    var i = Math.max(0, Math.min(index == null ? list.length : index, list.length));
    list.splice(i, 0, card);
    list.forEach(function (c, k) { c.order = k; });
    if (from !== sid) renumber(from);
    save();
  }
  function deleteCard(card) {
    addToTrash('memo', card);
    cards = cards.filter(function (c) { return c.id !== card.id; });
    renumber(card.sectionId);
    save();
    toast('카드를 휴지통으로 옮겼습니다.', function () { restoreTrash('tr-memo-' + card.id); });
  }
  function toggleDone(card) {
    card.done = !card.done;
    var list = sectionCards(card.sectionId).filter(function (c) { return c.id !== card.id; });
    var idx;
    if (card.done) idx = list.length;                                   // 완료하면 맨 아래로
    else { idx = list.findIndex(function (c) { return c.done; }); if (idx < 0) idx = list.length; }   // 완료 취소하면 완료된 항목들 바로 위로
    placeCard(card, card.sectionId, idx);
  }
  function addSection(name) {
    name = String(name || '').trim();
    if (!name) return null;
    var s = { id: uid('s'), name: name.slice(0, 30), order: sections.length };
    sections.push(s);
    save();
    return s;
  }
  function deleteSection(sec) {
    var inside = sectionCards(sec.id);
    if (inside.length && !window.confirm('"' + sec.name + '" 섹션과 안의 카드 ' + inside.length + '개를 휴지통으로 옮길까요?\n(휴지통에서 되살릴 수 있습니다.)')) return;
    inside.forEach(function (c) { addToTrash('memo', c); });
    cards = cards.filter(function (c) { return c.sectionId !== sec.id; });
    addToTrash('section', sec);
    sections = sections.filter(function (s) { return s.id !== sec.id; });
    renumberSections();
    save();
    render();
  }
  function moveSection(sec, delta) {
    var list = sortedSections();
    var i = list.findIndex(function (s) { return s.id === sec.id; });
    var j = i + delta;
    if (j < 0 || j >= list.length) return;
    list.splice(j, 0, list.splice(i, 1)[0]);
    list.forEach(function (s, k) { s.order = k; });
    save();
    render();
  }

  // ───────── 작은 UI 도구 ─────────
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function closeMenu() { var m = $('boardMenu'); if (m) m.remove(); }
  function openMenu(anchor, items) {
    closeMenu();
    var m = el('div', 'board-menu'); m.id = 'boardMenu';
    items.forEach(function (it) {
      if (it === '-') { m.appendChild(el('div', 'board-menu-sep')); return; }
      var b = el('button', 'board-menu-item' + (it.danger ? ' danger' : ''), it.label); b.type = 'button';
      b.addEventListener('click', function (ev) { ev.stopPropagation(); closeMenu(); it.onClick(); });
      m.appendChild(b);
    });
    m.addEventListener('click', function (ev) { ev.stopPropagation(); });
    $('board').appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 8)) + 'px';
  }
  var toastTimer = null;
  function toast(msg, undo) {
    var old = $('boardToast'); if (old) old.remove();
    clearTimeout(toastTimer);
    var t = el('div', 'board-toast'); t.id = 'boardToast';
    t.appendChild(el('span', '', msg));
    if (undo) { var b = el('button', '', '되돌리기'); b.type = 'button'; b.addEventListener('click', function (ev) { ev.stopPropagation(); t.remove(); undo(); }); t.appendChild(b); }
    $('board').appendChild(t);
    toastTimer = setTimeout(function () { t.remove(); }, 5000);
  }
  // 글 안의 인터넷 주소를 눌러서 열 수 있게 한다(textContent로만 만들어 스크립트가 끼어들 수 없다).
  function linkify(parent, text) {
    var re = /(https?:\/\/[^\s<>"']+)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = el('a', 'board-link', m[1].length > 40 ? m[1].slice(0, 38) + '…' : m[1]);
      a.href = m[1]; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.addEventListener('click', function (ev) { ev.stopPropagation(); });
      parent.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  // ───────── 그리기 ─────────
  function render() {
    var root = $('memoBoard');
    if (!root) return;
    closeMenu();
    root.innerHTML = '';
    root.className = 'board board--' + layout;
    paintTools();
    var open = cards.filter(function (c) { return !c.done; }).length;
    if ($('memoCount')) $('memoCount').textContent = open ? '남은 일 ' + open : '';

    var secs = sortedSections();
    // 섹션 없음 칸: 섹션을 안 만들었으면 그냥 목록으로, 섹션이 있는데 갈 곳 없는 카드가 있으면 "미분류"로 맨 앞에 보인다.
    if (!secs.length || cards.some(inNone)) root.appendChild(renderSection({ id: '', name: secs.length ? '미분류' : '메모', pseudo: true, plain: !secs.length }));
    secs.forEach(function (s) { root.appendChild(renderSection(s)); });
  }

  function paintTools() {
    var t = $('boardTools');
    var locked = cards.length > 0;   // 할일이 있으면 가로/세로 배치는 바꿀 수 없다(모두 지우면 다시 바꿀 수 있다)
    if (!t || t.dataset.ready === layout + (locked ? 'L' : '')) return;
    t.dataset.ready = layout + (locked ? 'L' : '');
    t.innerHTML = '';
    var seg = el('div', 'board-seg');
    [['h', '가로'], ['v', '세로']].forEach(function (p) {
      var b = el('button', 'board-seg-btn' + (layout === p[0] ? ' active' : ''), p[1]); b.type = 'button';
      b.title = locked ? '할일이 있으면 배치를 바꿀 수 없어요' : (p[0] === 'h' ? '섹션을 가로로 나란히' : '섹션을 세로로 쌓기');
      if (locked) b.disabled = true;
      b.addEventListener('click', function (ev) { ev.stopPropagation(); if (locked) return; layout = p[0]; write(KEYS.layout, layout); t.dataset.ready = ''; render(); });
      seg.appendChild(b);
    });
    var add = el('button', 'board-tool', '+ 섹션'); add.type = 'button';
    add.addEventListener('click', function (ev) { ev.stopPropagation(); promptAddSection(); });
    var rec = el('button', 'board-tool', '휴지통·백업'); rec.type = 'button';
    rec.addEventListener('click', function (ev) { ev.stopPropagation(); openRecovery(); });
    t.appendChild(seg); t.appendChild(add); t.appendChild(rec);
  }

  function promptAddSection() {
    var root = $('memoBoard');
    var old = $('boardNewSection'); if (old) { old.querySelector('input').focus(); return; }
    var box = el('div', 'board-newsec'); box.id = 'boardNewSection';
    var inp = el('input'); inp.type = 'text'; inp.maxLength = 30; inp.placeholder = '섹션 이름을 입력하고 Enter';
    var ok = el('button', '', '만들기'); ok.type = 'button';
    var no = el('button', 'ghost', '취소'); no.type = 'button';
    function done() { var n = inp.value.trim(); if (n) { addSection(n); } box.remove(); render(); }
    inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); done(); } else if (ev.key === 'Escape') { box.remove(); render(); } });
    ok.addEventListener('click', function (ev) { ev.stopPropagation(); done(); });
    no.addEventListener('click', function (ev) { ev.stopPropagation(); box.remove(); render(); });
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });
    box.appendChild(inp); box.appendChild(ok); box.appendChild(no);
    root.parentNode.insertBefore(box, root);
    inp.focus();
  }

  function renderSection(sec) {
    var wrap = el('div', 'bd-sec' + (sec.plain ? ' bd-none-only' : '')); wrap.dataset.sid = sec.id;
    var secBg = sec.style && sec.style.bg;
    if (secBg) wrap.style.background = secBg;
    if (isDark(secBg)) wrap.classList.add('dark');
    var head = el('div', 'bd-sec-head');
    if (!sec.pseudo) {
      var sgrip = el('span', 'bd-sec-grip', '⋮⋮'); sgrip.title = '끌어서 섹션 순서 바꾸기';
      sgrip.addEventListener('pointerdown', function (ev) { startSectionDrag(ev, wrap, sec); });
      head.appendChild(sgrip);
    }
    var title = el('span', 'bd-sec-title', sec.name);
    title.title = '눌러서 이름 바꾸기';
    var secEff = effText(null, sec);
    applyText(title, secEff, secBg);
    if (secEff.size) title.style.fontSize = Math.max(12, secEff.size + 1) + 'px';
    if (secEff.align) title.style.flex = '1 1 auto';
    if (!sec.pseudo) title.addEventListener('click', function (ev) { ev.stopPropagation(); renameSection(sec, title); });
    else { title.title = ''; title.style.cursor = 'default'; }
    var list = sectionCards(sec.id);
    var more = el('button', 'bd-sec-more', '⋮'); more.type = 'button'; more.title = '섹션 메뉴';
    more.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var secs = sortedSections(), i = secs.findIndex(function (s) { return s.id === sec.id; });
      var back = layout === 'h' ? '왼쪽으로' : '위로', fwd = layout === 'h' ? '오른쪽으로' : '아래로';
      var items = [{ label: '이름 바꾸기', onClick: function () { renameSection(sec, title); } }, { label: '꾸미기', onClick: function () { openStylePanel(more, sec, 'section'); } }];
      if (i > 0) items.push({ label: back + ' 이동', onClick: function () { moveSection(sec, -1); } });
      if (i < secs.length - 1) items.push({ label: fwd + ' 이동', onClick: function () { moveSection(sec, 1); } });
      items.push('-', { label: '섹션 삭제', danger: true, onClick: function () { deleteSection(sec); } });
      openMenu(more, items);
    });
    head.appendChild(title); if (!sec.pseudo) head.appendChild(more);
    if (!sec.plain) wrap.appendChild(head);

    var body = el('div', 'bd-sec-body');
    if (addingIn === sec.id) body.appendChild(renderAddForm(sec));
    else {
      var add = el('button', 'bd-add', '+ 할일 추가'); add.type = 'button';
      add.addEventListener('click', function (ev) { ev.stopPropagation(); addingIn = sec.id; render(); var t = document.querySelector('.bd-addform textarea'); if (t) t.focus(); });
      body.appendChild(add);
    }
    var cl = el('div', 'bd-cards'); cl.dataset.sid = sec.id;
    list.forEach(function (c) { cl.appendChild(renderCard(c)); });
    body.appendChild(cl);
    wrap.appendChild(body);
    if (sec.plain) wrap.appendChild(el('div', 'board-hint bd-plain-hint', '섹션으로 나누고 싶으면 위의 "+ 섹션"을 눌러 칸을 만들 수 있어요. (안 만들어도 됩니다)'));
    return wrap;
  }

  function renameSection(sec, titleEl) {
    var inp = el('input', 'bd-sec-rename'); inp.type = 'text'; inp.maxLength = 30; inp.value = sec.name;
    titleEl.replaceWith(inp); inp.focus(); inp.select();
    function finish(commit) {
      var n = inp.value.trim();
      if (commit && n && n !== sec.name) { sec.name = n.slice(0, 30); save(); }
      render();
    }
    inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') finish(true); else if (ev.key === 'Escape') finish(false); });
    inp.addEventListener('blur', function () { finish(true); });
    inp.addEventListener('click', function (ev) { ev.stopPropagation(); });
  }

  function renderAddForm(sec) {
    var f = el('div', 'bd-addform');
    var ta = el('textarea'); ta.rows = 2; ta.maxLength = 500; ta.placeholder = '내용을 입력하고 Enter (줄바꿈은 Shift+Enter)';
    var row = el('div', 'bd-addrow');
    var ok = el('button', '', '추가'); ok.type = 'button';
    var no = el('button', 'ghost', '닫기'); no.type = 'button';
    function submit() { var v = ta.value; if (v.trim()) { addCard(sec.id, v); addingIn = sec.id; render(); var t = document.querySelector('.bd-addform textarea'); if (t) t.focus(); } }
    ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit(); } else if (ev.key === 'Escape') { addingIn = null; render(); } });
    ok.addEventListener('click', function (ev) { ev.stopPropagation(); submit(); });
    no.addEventListener('click', function (ev) { ev.stopPropagation(); addingIn = null; render(); });
    f.addEventListener('click', function (ev) { ev.stopPropagation(); });
    row.appendChild(ok); row.appendChild(no);
    f.appendChild(ta); f.appendChild(row);
    return f;
  }

  function renderCard(c) {
    var row = el('div', 'bd-card' + (c.done ? ' done' : '')); row.dataset.id = c.id;
    var owner = sections.filter(function (x) { return x.id === c.sectionId; })[0];
    var cardBg = c.style && c.style.bg;
    if (cardBg) row.style.background = cardBg;
    var eff = effText(c, owner);
    // 어두운 섹션 안의 카드는 따로 색을 안 줬으면 어두운 반투명 카드로 보여서 흰 글씨가 읽히게 한다.
    var darkOwnerBg = !cardBg && owner && owner.style && isDark(owner.style.bg) ? owner.style.bg : '';
    if (darkOwnerBg) { row.style.background = 'rgba(255,255,255,0.14)'; row.style.borderColor = 'rgba(255,255,255,0.18)'; }
    var grip = el('span', 'bd-grip', '⋮⋮'); grip.title = '끌어서 옮기기';
    grip.addEventListener('pointerdown', function (ev) { startDrag(ev, row, c); });
    var chk = el('button', 'bd-chk', c.done ? '✓' : ''); chk.type = 'button'; chk.setAttribute('aria-label', c.done ? '완료 취소' : '완료');
    chk.addEventListener('click', function (ev) { ev.stopPropagation(); toggleDone(c); render(); });
    var main = el('div', 'bd-main');
    if (editingId === c.id) {
      var ta = el('textarea', 'bd-edit'); ta.value = c.text; ta.rows = Math.min(6, Math.max(2, c.text.split('\n').length));
      function finish(commit) { var v = ta.value.trim(); editingId = null; if (commit && v && v !== c.text) { c.text = v; save(); } render(); }
      ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finish(true); } else if (ev.key === 'Escape') finish(false); });
      ta.addEventListener('blur', function () { finish(true); });
      ta.addEventListener('click', function (ev) { ev.stopPropagation(); });
      main.appendChild(ta);
      setTimeout(function () { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    } else {
      var txt = el('div', 'bd-text'); linkify(txt, c.text);
      applyText(txt, eff, cardBg || darkOwnerBg);
      txt.addEventListener('click', function (ev) { ev.stopPropagation(); editingId = c.id; render(); });
      main.appendChild(txt);
      if (c.tag && c.tag.text) {
        var tag = el('span', 'bd-tag', c.tag.text); tag.style.background = c.tag.color || TAG_COLORS[0];
        main.appendChild(tag);
      }
    }
    var more = el('button', 'bd-more', '⋮'); more.type = 'button'; more.title = '카드 메뉴';
    more.addEventListener('click', function (ev) {
      ev.stopPropagation();
      openMenu(more, [
        { label: '편집', onClick: function () { editingId = c.id; render(); } },
        { label: '꾸미기', onClick: function () { openStylePanel(more, c, 'card'); } },
        { label: c.tag ? '꼬리표 바꾸기' : '꼬리표 달기', onClick: function () { promptTag(c, more); } },
        c.tag ? { label: '꼬리표 지우기', onClick: function () { delete c.tag; save(); render(); } } : null,
        '-', { label: '삭제', danger: true, onClick: function () { deleteCard(c); render(); } }
      ].filter(Boolean));
    });
    row.appendChild(grip); row.appendChild(chk); row.appendChild(main); row.appendChild(more);
    return row;
  }

  function promptTag(card, anchor) {
    closeMenu();
    var m = el('div', 'board-menu board-tagbox'); m.id = 'boardMenu';
    var inp = el('input'); inp.type = 'text'; inp.maxLength = 12; inp.placeholder = '꼬리표 (예: 수요일까지)'; inp.value = (card.tag && card.tag.text) || '';
    var colors = el('div', 'board-colors'); var chosen = (card.tag && card.tag.color) || TAG_COLORS[0];
    TAG_COLORS.forEach(function (col) {
      var b = el('button', 'board-color' + (col === chosen ? ' on' : '')); b.type = 'button'; b.style.background = col;
      b.addEventListener('click', function (ev) { ev.stopPropagation(); chosen = col; [].forEach.call(colors.children, function (x) { x.classList.toggle('on', x === b); }); });
      colors.appendChild(b);
    });
    var ok = el('button', 'board-primary', '저장'); ok.type = 'button';
    function done() { var v = inp.value.trim(); if (v) card.tag = { text: v, color: chosen }; else delete card.tag; save(); closeMenu(); render(); }
    ok.addEventListener('click', function (ev) { ev.stopPropagation(); done(); });
    inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); done(); } else if (ev.key === 'Escape') closeMenu(); });
    m.addEventListener('click', function (ev) { ev.stopPropagation(); });
    m.appendChild(inp); m.appendChild(colors); m.appendChild(ok);
    $('board').appendChild(m);
    var r = anchor.getBoundingClientRect();
    m.style.top = Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, window.innerWidth - m.offsetWidth - 8)) + 'px';
    inp.focus();
  }

  // ───────── 꾸미기(색·글씨·크기·정렬·글꼴·굵기) ─────────
  // 섹션과 카드 각각에 style 객체를 둔다. 카드의 글씨 모양은 "카드 자신의 설정 → 섹션 설정 → 기본" 순서로 정해진다.
  // 글꼴은 모두 무료로 쓸 수 있는 구글 폰트(OFL)이고, 인터넷이 안 될 때는 기본 글꼴로 보인다.
  var FONTS = [
    { key: '', label: '기본 고딕', css: "'Gothic A1','Malgun Gothic',sans-serif" },
    { key: 'nanumgothic', label: '나눔고딕', css: "'Nanum Gothic','Malgun Gothic',sans-serif" },
    { key: 'gowundodum', label: '고운돋움', css: "'Gowun Dodum','Malgun Gothic',sans-serif" },
    { key: 'notoserif', label: '명조', css: "'Noto Serif KR',serif" },
    { key: 'nanummyeongjo', label: '나눔명조', css: "'Nanum Myeongjo',serif" },
    { key: 'gowunbatang', label: '고운바탕', css: "'Gowun Batang',serif" },
    { key: 'nanumpen', label: '손글씨', css: "'Nanum Pen Script',cursive" },
    { key: 'gaegu', label: '개구', css: "'Gaegu',cursive" },
    { key: 'gamja', label: '감자꽃', css: "'Gamja Flower',cursive" },
    { key: 'jua', label: '주아', css: "'Jua',sans-serif" },
    { key: 'dohyeon', label: '도현', css: "'Do Hyeon',sans-serif" },
    { key: 'blackhan', label: '검은고딕', css: "'Black Han Sans',sans-serif" }
  ];
  var FONT_URL = 'https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&family=Gowun+Dodum&family=Noto+Serif+KR:wght@400;700&family=Nanum+Myeongjo:wght@400;700&family=Gowun+Batang:wght@400;700&family=Nanum+Pen+Script&family=Gaegu:wght@400;700&family=Gamja+Flower&family=Jua&family=Do+Hyeon&family=Black+Han+Sans&display=swap';
  var BG_COLORS = ['#eef2f8', '#fdecc8', '#dff3e3', '#e0ecff', '#fbe0ea', '#ece5fb', '#e3f3f3', '#ffffff', '#3a4660'];
  var TEXT_COLORS = ['#2a3140', '#8a5610', '#2e6b3c', '#2f5eb0', '#b3342a', '#7b3fa0', '#ffffff'];
  var SIZE_MIN = 10, SIZE_MAX = 34, SIZE_DEFAULT = 13;

  function fontCss(key) { var f = FONTS.filter(function (x) { return x.key === key; })[0]; return f && f.key ? f.css : ''; }
  function isDark(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return false;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  }
  // 저장 모양을 고정한다(키 순서까지 같게 해서 변경 비교가 흔들리지 않게). 아무 값도 없으면 null.
  function normStyle(s) {
    if (!s) return null;
    var o = {};
    if (s.bg) o.bg = String(s.bg);
    if (s.color) o.color = String(s.color);
    if (s.size != null && isFinite(s.size)) o.size = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(s.size)));
    if (s.align === 'left' || s.align === 'center' || s.align === 'right') o.align = s.align;
    if (s.font) o.font = String(s.font);
    if (s.bold === true || s.bold === false) o.bold = s.bold;
    return Object.keys(o).length ? o : null;
  }
  function styleSig(s) { return JSON.stringify(normStyle(s)); }
  // 카드 글씨 모양: 카드 자신의 설정이 섹션 설정보다 우선한다.
  function effText(card, sec) {
    var out = {}, cs = card && card.style || {}, ss = sec && sec.style || {};
    ['color', 'size', 'align', 'font', 'bold'].forEach(function (k) { var v = cs[k] != null ? cs[k] : ss[k]; if (v != null) out[k] = v; });
    return out;
  }
  function applyText(node, eff, baseBg) {
    var color = eff.color || (isDark(baseBg) ? '#ffffff' : '');
    if (color) node.style.color = color;
    if (eff.size) node.style.fontSize = eff.size + 'px';
    if (eff.align) node.style.textAlign = eff.align;
    var f = fontCss(eff.font); if (f) node.style.fontFamily = f;
    if (eff.bold === true) node.style.fontWeight = '800'; else if (eff.bold === false) node.style.fontWeight = '400';
  }

  function closeStyle() { var p = $('boardStyle'); if (p) p.remove(); }
  function openStylePanel(anchor, obj, kind) {
    closeMenu(); closeStyle();
    var p = el('div', 'board-style'); p.id = 'boardStyle';
    var head = el('div', 'board-style-head');
    head.appendChild(el('div', 'board-style-title', kind === 'section' ? '섹션 꾸미기' : '카드 꾸미기'));
    var x = el('button', 'board-modal-x', '✕'); x.type = 'button'; x.addEventListener('click', closeStyle);
    head.appendChild(x); p.appendChild(head);

    function cur(k) { return obj.style ? obj.style[k] : undefined; }
    function set(k, v) {
      var s = Object.assign({}, obj.style || {});
      if (v == null) delete s[k]; else s[k] = v;
      var n = normStyle(s);
      if (n) obj.style = n; else delete obj.style;
      save(); render(); paint();
    }
    var groups = [];
    function group(label) { var g = el('div', 'board-style-group'); g.appendChild(el('div', 'board-style-label', label)); p.appendChild(g); return g; }
    function swatches(g, colors, key) {
      var row = el('div', 'board-style-sw');
      var none = el('button', 'board-style-swatch none', '기본'); none.type = 'button';
      none.addEventListener('click', function () { set(key, null); });
      row.appendChild(none);
      colors.forEach(function (c) {
        var b = el('button', 'board-style-swatch'); b.type = 'button'; b.style.background = c; b.title = c;
        b.addEventListener('click', function () { set(key, c); });
        row.appendChild(b);
      });
      g.appendChild(row);
      groups.push(function () {
        [].forEach.call(row.children, function (b, i) { var v = i === 0 ? undefined : colors[i - 1]; b.classList.toggle('on', cur(key) === v); });
      });
    }
    function segment(g, key, options) {
      var seg = el('div', 'board-seg');
      options.forEach(function (o) {
        var b = el('button', 'board-seg-btn', o[1]); b.type = 'button';
        b.addEventListener('click', function () { set(key, o[0]); });
        seg.appendChild(b);
      });
      g.appendChild(seg);
      groups.push(function () { [].forEach.call(seg.children, function (b, i) { b.classList.toggle('active', cur(key) === options[i][0]); }); });
    }

    swatches(group(kind === 'section' ? '칸 색' : '카드 색'), BG_COLORS, 'bg');
    swatches(group('글씨 색'), TEXT_COLORS, 'color');

    var gs = group('글자 크기');
    var srow = el('div', 'board-style-size');
    var slider = el('input'); slider.type = 'range'; slider.min = SIZE_MIN; slider.max = SIZE_MAX; slider.step = 1;
    var val = el('span', 'board-style-val');
    var reset = el('button', 'board-tool', '기본'); reset.type = 'button';
    slider.addEventListener('input', function () { val.textContent = slider.value + 'px'; });
    slider.addEventListener('change', function () { set('size', Number(slider.value)); });
    reset.addEventListener('click', function () { set('size', null); });
    srow.appendChild(slider); srow.appendChild(val); srow.appendChild(reset); gs.appendChild(srow);
    groups.push(function () { var v = cur('size'); slider.value = v != null ? v : SIZE_DEFAULT; val.textContent = v != null ? v + 'px' : '기본'; });

    segment(group('정렬'), 'align', [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']]);

    var gf = group('글꼴');
    var grid = el('div', 'board-style-fonts');
    FONTS.forEach(function (f) {
      var b = el('button', 'board-style-font', f.label + ' 가나다 Aa'); b.type = 'button';
      if (f.css) b.style.fontFamily = f.css;
      b.addEventListener('click', function () { set('font', f.key || null); });
      grid.appendChild(b);
    });
    gf.appendChild(grid);
    groups.push(function () { [].forEach.call(grid.children, function (b, i) { b.classList.toggle('on', (cur('font') || '') === FONTS[i].key); }); });

    segment(group('굵기'), 'bold', [[false, '보통'], [true, '굵게']]);

    var foot = el('div', 'board-style-foot');
    var clear = el('button', 'board-tool', '기본값으로'); clear.type = 'button';
    clear.addEventListener('click', function () { delete obj.style; save(); render(); paint(); });
    foot.appendChild(clear);
    if (kind === 'section') {
      var fit = el('button', 'board-tool', '카드 개별 설정 지우기'); fit.type = 'button';
      fit.title = '이 칸 카드에 따로 준 모양을 모두 지우고 섹션 설정에 맞춥니다';
      fit.addEventListener('click', function () { sectionCards(obj.id).forEach(function (c) { delete c.style; }); save(); render(); });
      foot.appendChild(fit);
    }
    var done = el('button', 'board-primary small', '완료'); done.type = 'button'; done.addEventListener('click', closeStyle);
    foot.appendChild(done);
    p.appendChild(foot);

    function paint() { groups.forEach(function (fn) { fn(); }); }
    p.addEventListener('click', function (ev) { ev.stopPropagation(); });
    $('board').appendChild(p);
    paint();
    var r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.right - p.offsetWidth, window.innerWidth - p.offsetWidth - 8)) + 'px';
    p.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - p.offsetHeight - 8)) + 'px';
  }

  // ───────── 끌어서 옮기기 ─────────
  function startDrag(ev, row, card) {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    var grip = ev.currentTarget;
    try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* 일부 기기는 지원 안 함 */ }
    var rect = row.getBoundingClientRect();
    var ghost = row.cloneNode(true); ghost.classList.add('bd-ghost');
    ghost.style.width = rect.width + 'px'; ghost.style.left = rect.left + 'px'; ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);
    var ph = el('div', 'bd-placeholder'); ph.style.height = rect.height + 'px';
    row.parentNode.insertBefore(ph, row); row.style.display = 'none';
    var offY = ev.clientY - rect.top;
    var root = $('memoBoard');

    function move(e) {
      ghost.style.top = (e.clientY - offY) + 'px'; ghost.style.left = (e.clientX - rect.width / 2) + 'px';
      // 가장자리에서는 보드를 자동으로 스크롤한다.
      var br = root.getBoundingClientRect();
      if (e.clientX > br.right - 36) root.scrollLeft += 12; else if (e.clientX < br.left + 36) root.scrollLeft -= 12;
      if (layout === 'v') { if (e.clientY > br.bottom - 36) root.scrollTop += 12; else if (e.clientY < br.top + 36) root.scrollTop -= 12; }
      // 어느 섹션 위인지 찾아서 자리 표시를 옮긴다.
      var hit = document.elementsFromPoint(e.clientX, e.clientY);
      var secEl = null;
      for (var i = 0; i < hit.length; i++) { var s = hit[i].closest && hit[i].closest('.bd-sec'); if (s) { secEl = s; break; } }
      if (!secEl) return;
      var list = secEl.querySelector('.bd-cards');
      var others = [].filter.call(list.children, function (x) { return x !== ph && x.classList.contains('bd-card') && x.style.display !== 'none'; });
      var before = null;
      for (var k = 0; k < others.length; k++) { var r = others[k].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = others[k]; break; } }
      list.insertBefore(ph, before);
    }
    function up() {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', cancel);
      var list = ph.parentNode;
      var sid = list ? list.dataset.sid : null;
      var index = 0;
      if (list) { var seen = 0; for (var i = 0; i < list.children.length; i++) { var x = list.children[i]; if (x === ph) break; if (x.classList.contains('bd-card') && x.style.display !== 'none') seen++; } index = seen; }
      ghost.remove(); ph.remove(); row.style.display = '';
      if (sid !== null && sid !== undefined) placeCard(card, sid, index);
      render();
    }
    function cancel() {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', cancel);
      ghost.remove(); ph.remove(); row.style.display = ''; render();
    }
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', cancel);
    move(ev);
  }

  // 섹션 통째로 끌어서 순서를 바꾼다(가로 배치는 좌우, 세로 배치는 위아래로 자리를 찾는다).
  function startSectionDrag(ev, secEl, sec) {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    var grip = ev.currentTarget;
    try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* 일부 기기는 지원 안 함 */ }
    var root = $('memoBoard');
    var rect = secEl.getBoundingClientRect();
    var ghost = secEl.cloneNode(true); ghost.classList.add('bd-ghost');
    ghost.style.width = rect.width + 'px'; ghost.style.maxHeight = '220px'; ghost.style.overflow = 'hidden';
    ghost.style.left = rect.left + 'px'; ghost.style.top = rect.top + 'px';
    document.body.appendChild(ghost);
    var ph = el('div', 'bd-sec-placeholder');
    if (layout === 'h') ph.style.cssText = 'flex:0 0 ' + rect.width + 'px;width:' + rect.width + 'px;height:' + Math.min(rect.height, 160) + 'px;';
    else ph.style.height = Math.min(rect.height, 80) + 'px';
    root.insertBefore(ph, secEl); secEl.style.display = 'none';
    var offX = ev.clientX - rect.left, offY = ev.clientY - rect.top;

    function move(e) {
      ghost.style.left = (e.clientX - offX) + 'px'; ghost.style.top = (e.clientY - offY) + 'px';
      var br = root.getBoundingClientRect();
      if (layout === 'h') { if (e.clientX > br.right - 40) root.scrollLeft += 14; else if (e.clientX < br.left + 40) root.scrollLeft -= 14; }
      else { if (e.clientY > br.bottom - 40) root.scrollTop += 14; else if (e.clientY < br.top + 40) root.scrollTop -= 14; }
      var others = [].filter.call(root.children, function (x) { return x !== ph && x.classList.contains('bd-sec') && x.style.display !== 'none'; });
      var before = null;
      for (var k = 0; k < others.length; k++) {
        var r = others[k].getBoundingClientRect();
        var mid = layout === 'h' ? r.left + r.width / 2 : r.top + Math.min(r.height, 120) / 2;
        if ((layout === 'h' ? e.clientX : e.clientY) < mid) { before = others[k]; break; }
      }
      root.insertBefore(ph, before);
    }
    function finish(commit) {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', cancel);
      var ids = [];
      [].forEach.call(root.children, function (x) {
        if (x === ph) ids.push(sec.id);
        else if (x.classList.contains('bd-sec') && x.style.display !== 'none') ids.push(x.dataset.sid);
      });
      ghost.remove(); ph.remove(); secEl.style.display = '';
      if (commit) {
        ids.forEach(function (id, i) { var s = sections.filter(function (x) { return x.id === id; })[0]; if (s) s.order = i; });
        save();
      }
      render();
    }
    function up() { finish(true); }
    function cancel() { finish(false); }
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', cancel);
    move(ev);
  }

  // ───────── 휴지통·백업 화면 ─────────
  function closeRecovery() { var o = $('boardModal'); if (o) o.remove(); }
  function fmtDate(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
  function fmtKey(k) { return (+k.slice(4, 6)) + '월 ' + (+k.slice(6, 8)) + '일'; }
  function trashSummary(t) {
    var it = t.item || {};
    if (t.kind === 'memo') return String(it.text || '').slice(0, 60);
    if (t.kind === 'section') return String(it.name || '');
    if (t.kind === 'attendance') return (it.grade || '') + '-' + (it.ban || '') + ' ' + (it.no || '') + '번 ' + (it.studentName || '') + ' · ' + (it.reason || '') + (it.type || '');
    if (t.kind === 'daytask') return String(it.id || '').slice(4, 6) + '/' + String(it.id || '').slice(6, 8) + ' ' + String(it.text || '').slice(0, 50);
    return '';
  }

  function openRecovery(startTab) {
    closeRecovery();
    var ov = el('div', 'board-overlay'); ov.id = 'boardModal';
    var box = el('div', 'board-modal');
    var tabs = el('div', 'board-seg board-modal-tabs');
    var body = el('div', 'board-modal-body');
    var cur = startTab || 'trash';
    function paintTabs() {
      tabs.innerHTML = '';
      [['trash', '휴지통'], ['backup', '백업 복원']].forEach(function (p) {
        var b = el('button', 'board-seg-btn' + (cur === p[0] ? ' active' : ''), p[1]); b.type = 'button';
        b.addEventListener('click', function (ev) { ev.stopPropagation(); cur = p[0]; show(); });
        tabs.appendChild(b);
      });
    }
    function show() { paintTabs(); body.innerHTML = ''; if (cur === 'trash') showTrash(body, show); else showBackups(body); }
    var head = el('div', 'board-modal-head');
    head.appendChild(el('div', 'board-modal-title', '휴지통·백업'));
    var x = el('button', 'board-modal-x', '✕'); x.type = 'button'; x.addEventListener('click', closeRecovery);
    head.appendChild(x);
    box.appendChild(head); box.appendChild(tabs); box.appendChild(body);
    ov.appendChild(box);
    ov.addEventListener('click', function (ev) { if (ev.target === ov) closeRecovery(); });
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });
    $('board').appendChild(ov);
    show();
  }

  function showTrash(body, refresh) {
    body.appendChild(el('div', 'board-hint', '지운 항목은 90일 동안 보관됩니다.'));
    var list = trash.slice().sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); });
    if (!list.length) { body.appendChild(el('div', 'board-none', '휴지통이 비어 있어요.')); return; }
    var clear = el('button', 'board-tool danger', '휴지통 비우기'); clear.type = 'button';
    clear.addEventListener('click', function () {
      if (!window.confirm('휴지통의 ' + list.length + '개 항목을 완전히 지울까요? 되돌릴 수 없습니다.')) return;
      list.forEach(function (t) { dropTrashEntry(t.id); }); save(); refresh();
    });
    body.appendChild(clear);
    list.forEach(function (t) {
      var row = el('div', 'board-row');
      row.appendChild(el('span', 'board-kind', KIND_LABEL[t.kind] || t.kind));
      var mid = el('div', 'board-row-main');
      mid.appendChild(el('div', 'board-row-text', trashSummary(t) || '(내용 없음)'));
      mid.appendChild(el('div', 'board-row-sub', fmtDate(t.deletedAt) + '에 삭제'));
      var b1 = el('button', 'board-primary small', '되살리기'); b1.type = 'button';
      b1.addEventListener('click', function () { restoreTrash(t.id); refresh(); });
      var b2 = el('button', 'board-tool danger', '지우기'); b2.type = 'button';
      b2.addEventListener('click', function () { dropTrashEntry(t.id); save(); refresh(); });
      row.appendChild(mid); row.appendChild(b1); row.appendChild(b2);
      body.appendChild(row);
    });
  }

  // 휴지통 항목 하나를 원래 자리로 되살린다.
  function restoreTrash(id) {
    var t = trash.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var it = JSON.parse(JSON.stringify(t.item));
    if (t.kind === 'memo') {
      var sec = sections.filter(function (s) { return s.id === it.sectionId; })[0];
      it.sectionId = sec ? sec.id : ''; it.order = sectionCards(it.sectionId).length; it.done = !!it.done;
      cards = cards.filter(function (c) { return c.id !== it.id; }); cards.push(it); delete tombs[it.id];
    } else if (t.kind === 'section') {
      sections = sections.filter(function (s) { return s.id !== it.id; }); it.order = sections.length; sections.push(it); delete secTombs[it.id];
    } else if (t.kind === 'attendance') {
      if (app().restoreAttendance) app().restoreAttendance(it);
    } else if (t.kind === 'daytask') {
      if (app().restoreDayTask) app().restoreDayTask(it.id, it.text);
    }
    dropTrashEntry(id);
    sigCards = sigCards || {}; sigSecs = sigSecs || {};
    save();
    render();
  }

  // 백업 파일(드라이브 또는 PC)의 모양을 하나로 맞춘다.
  function normalizeBackup(d) {
    d = d || {};
    var dayMap = {};
    if (Array.isArray(d.dayTasks)) d.dayTasks.forEach(function (x) { if (x && x.id && x.text) dayMap[x.id] = x.text; });
    else if (d.dayTasks && typeof d.dayTasks === 'object') dayMap = d.dayTasks;
    return {
      attendance: d.attendance || d.attendanceRecords || [],
      memo: d.memo || d.memoTodos || [],
      sections: d.sections || d.memoSections || [],
      dayTasks: dayMap
    };
  }

  function showBackups(body) {
    body.appendChild(el('div', 'board-hint', '날짜를 고른 뒤 "없어진 것만 되살리기"(안전) 또는 "이 날짜로 되돌리기"를 누르세요.'));
    var holder = el('div'); body.appendChild(holder);
    holder.appendChild(el('div', 'board-none', '백업 목록을 불러오는 중…'));
    var items = [];
    var T = window.TTCLOUD;
    var jobs = [];
    if (T && T.backups) jobs.push(T.backups().then(function (r) { if (r && r.ok) r.list.forEach(function (b) { items.push({ src: 'drive', label: '구글 드라이브', date: b.date, id: b.id }); }); else if (r && r.error) items.errorDrive = r.error; }).catch(function () {}));
    if (T && T.localBackups) jobs.push(T.localBackups().then(function (r) { if (r && r.ok) r.list.forEach(function (b) { items.push({ src: 'local', label: '이 PC', date: b.date, id: b.name }); }); }).catch(function () {}));
    Promise.all(jobs).then(function () {
      holder.innerHTML = '';
      items.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      if (items.errorDrive) holder.appendChild(el('div', 'board-hint', '드라이브 백업은 연결 후에 보입니다(' + items.errorDrive + ').'));
      if (!items.length) { holder.appendChild(el('div', 'board-none', '아직 백업이 없어요. 동기화가 켜져 있으면 하루에 한 번 만들어집니다.')); return; }
      items.forEach(function (it) {
        var row = el('div', 'board-row');
        row.appendChild(el('span', 'board-kind', it.label));
        var mid = el('div', 'board-row-main');
        mid.appendChild(el('div', 'board-row-text', fmtKey(it.date) + ' 백업'));
        var b1 = el('button', 'board-primary small', '없어진 것만 되살리기'); b1.type = 'button';
        var b2 = el('button', 'board-tool danger', '이 날짜로 되돌리기'); b2.type = 'button';
        function fetchBackup() {
          var p = it.src === 'drive' ? T.readBackup(it.id) : T.readLocalBackup(it.id);
          return p.then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || '백업을 읽지 못했습니다.'); return normalizeBackup(r.data); });
        }
        b1.addEventListener('click', function () { fetchBackup().then(function (b) { var n = restoreMerge(b); closeRecovery(); render(); toast(n ? n + '개를 되살렸습니다.' : '되살릴 항목이 없습니다.'); }).catch(function (e) { window.alert(e.message); }); });
        b2.addEventListener('click', function () {
          fetchBackup().then(function (b) {
            if (!window.confirm(fmtKey(it.date) + ' 백업 상태로 되돌릴까요?\n그 이후에 바뀐 내용은 휴지통으로 옮겨져 나중에 되살릴 수 있습니다.')) return;
            var n = restoreReplace(b); closeRecovery(); render(); toast('되돌렸습니다. (' + n + '개 변경)');
          }).catch(function (e) { window.alert(e.message); });
        });
        row.appendChild(mid); row.appendChild(b1); row.appendChild(b2);
        holder.appendChild(row);
      });
    });
  }

  // 백업에는 있는데 지금은 없는 것만 되살린다. 지금 있는 것은 건드리지 않는다. 되살린 개수를 돌려준다.
  function restoreMerge(b) {
    var n = 0;
    var curSecIds = {}; sections.forEach(function (s) { curSecIds[s.id] = true; });
    (b.sections || []).forEach(function (s) { if (s && s.id && !curSecIds[s.id]) { var c = JSON.parse(JSON.stringify(s)); c.order = sections.length; sections.push(c); curSecIds[c.id] = true; delete secTombs[c.id]; n++; } });
    var curCardIds = {}; cards.forEach(function (c) { curCardIds[c.id] = true; });
    (b.memo || []).forEach(function (c0) {
      if (!c0 || !c0.id || curCardIds[c0.id]) return;
      var c = JSON.parse(JSON.stringify(c0));
      if (!c.sectionId || !curSecIds[c.sectionId]) c.sectionId = '';
      c.order = sectionCards(c.sectionId).length; cards.push(c); delete tombs[c.id]; n++;
    });
    save();
    if (app().mergeRestore) n += app().mergeRestore({ attendance: b.attendance, dayTasks: b.dayTasks });
    return n;
  }
  // 그 날짜의 상태로 통째로 되돌린다. 지금 있고 백업에 없는 것은 휴지통으로 보낸다.
  function restoreReplace(b) {
    var n = 0;
    var bSecIds = {}; (b.sections || []).forEach(function (s) { if (s && s.id) bSecIds[s.id] = true; });
    var bCardIds = {}; (b.memo || []).forEach(function (c) { if (c && c.id) bCardIds[c.id] = true; });
    var t = Date.now();
    cards.filter(function (c) { return !bCardIds[c.id]; }).forEach(function (c) { addToTrash('memo', c); tombs[c.id] = t; n++; });
    sections.filter(function (s) { return !bSecIds[s.id]; }).forEach(function (s) { addToTrash('section', s); secTombs[s.id] = t; n++; });
    sections = (b.sections || []).map(function (s) { return JSON.parse(JSON.stringify(s)); });
    cards = (b.memo || []).map(function (c, i) { var x = JSON.parse(JSON.stringify(c)); if (x.order == null) x.order = i; return x; });
    var okSec = {}; sections.forEach(function (s) { okSec[s.id] = true; });
    cards.forEach(function (c) { if (!c.sectionId || !okSec[c.sectionId]) c.sectionId = ''; });
    // 되돌린 항목이 다른 기기의 삭제 표시에 밀리지 않도록 "지금"으로 다시 찍는다.
    cards.forEach(function (c) { c.updatedAt = t; delete tombs[c.id]; }); sections.forEach(function (s) { s.updatedAt = t; delete secTombs[s.id]; });
    sigCards = sigMap(cards, sigCard); sigSecs = sigMap(sections, sigSec);
    write(KEYS.cards, cards); write(KEYS.sections, sections);
    save();
    if (app().replaceRestore) n += app().replaceRestore({ attendance: b.attendance, dayTasks: b.dayTasks });
    return n;
  }

  // ───────── 바깥(app.js)에서 쓰는 것 ─────────
  function exportState() { return { memoTodos: cards, memoSections: sections }; }
  function importState(d) {
    if (Array.isArray(d.memoSections)) sections = d.memoSections;
    if (Array.isArray(d.memoTodos)) cards = d.memoTodos;
    cards.forEach(function (c) { if (!c.id) c.id = uid('m'); });
    cards.forEach(function (c, i) { if (c.sectionId == null) c.sectionId = ''; if (c.order == null) c.order = i; });
    save();
  }

  function init() {
    load();
    if (!document.getElementById('boardFonts')) { var lk = document.createElement('link'); lk.id = 'boardFonts'; lk.rel = 'stylesheet'; lk.href = FONT_URL; document.head.appendChild(lk); }
    document.addEventListener('click', function () { closeMenu(); closeStyle(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeMenu(); closeStyle(); } });
    window.addEventListener('tt-open-recovery', function () { openRecovery(); });
    var root = $('memoBoard');
    if (root) root.addEventListener('click', function () { if (addingIn !== null || editingId) { addingIn = null; editingId = null; render(); } });
    render();
  }

  window.BOARD = {
    init: init, render: render, getSyncState: getSyncState, applySync: applySync,
    trash: function (kind, item) { addToTrash(kind, item); }, openRecovery: openRecovery,
    exportState: exportState, importState: importState
  };
})();
