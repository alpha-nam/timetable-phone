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

  function sigCard(c) { return JSON.stringify([c.text, !!c.done, c.sectionId, c.order, c.tag ? [c.tag.text, c.tag.color] : null]); }
  function sigSec(s) { return JSON.stringify([s.name, s.order]); }
  function sigMap(list, fn) { var m = {}; list.forEach(function (x) { if (x && x.id) m[x.id] = fn(x); }); return m; }

  function load() {
    var raw = read(KEYS.cards, []);
    cards = Array.isArray(raw) ? raw.filter(function (c) { return c && typeof c.text === 'string'; }) : [];
    sections = read(KEYS.sections, []); if (!Array.isArray(sections)) sections = [];
    tombs = read(KEYS.tombs, {}) || {}; secTombs = read(KEYS.secTombs, {}) || {};
    trash = read(KEYS.trash, []); if (!Array.isArray(trash)) trash = [];
    trashTombs = read(KEYS.trashTombs, {}) || {};
    cards.forEach(function (c) { if (!c.id) c.id = uid('m'); });
    // 예전(섹션이 없던) 메모는 "메모" 섹션 하나에 담는다. 섹션 기본값은 없고, 이건 옮겨 담기 위한 것뿐이다.
    var orphan = cards.filter(function (c) { return !c.sectionId || !sections.some(function (s) { return s.id === c.sectionId; }); });
    if (orphan.length) {
      var target = sections[0];
      if (!target) { target = { id: uid('s'), name: '메모', order: 0, updatedAt: Date.now() }; sections.push(target); }
      orphan.forEach(function (c, i) { c.sectionId = target.id; if (c.order == null) c.order = i; c.updatedAt = Date.now(); });
      write(KEYS.cards, cards); write(KEYS.sections, sections);
    }
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
  function sectionCards(sid) {
    return cards.filter(function (c) { return c.sectionId === sid; }).sort(function (a, b) {
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
    if (!secs.length) {
      var empty = el('div', 'board-empty');
      empty.appendChild(el('div', 'board-empty-title', '아직 섹션이 없어요'));
      empty.appendChild(el('div', 'board-empty-sub', '섹션은 카드를 모아 두는 칸이에요. 이름은 마음대로 정하세요. (예: 오늘 할 일, 수업 준비 …)'));
      var b = el('button', 'board-primary', '+ 섹션 추가'); b.type = 'button';
      b.addEventListener('click', function (ev) { ev.stopPropagation(); promptAddSection(); });
      empty.appendChild(b);
      root.appendChild(empty);
      return;
    }
    secs.forEach(function (s) { root.appendChild(renderSection(s)); });
  }

  function paintTools() {
    var t = $('boardTools');
    if (!t || t.dataset.ready === layout) return;
    t.dataset.ready = layout;
    t.innerHTML = '';
    var seg = el('div', 'board-seg');
    [['h', '가로'], ['v', '세로']].forEach(function (p) {
      var b = el('button', 'board-seg-btn' + (layout === p[0] ? ' active' : ''), p[1]); b.type = 'button';
      b.title = p[0] === 'h' ? '섹션을 가로로 나란히' : '섹션을 세로로 쌓기';
      b.addEventListener('click', function (ev) { ev.stopPropagation(); layout = p[0]; write(KEYS.layout, layout); t.dataset.ready = ''; render(); });
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
    var wrap = el('div', 'bd-sec'); wrap.dataset.sid = sec.id;
    var head = el('div', 'bd-sec-head');
    var title = el('span', 'bd-sec-title', sec.name);
    title.title = '눌러서 이름 바꾸기';
    title.addEventListener('click', function (ev) { ev.stopPropagation(); renameSection(sec, title); });
    var list = sectionCards(sec.id);
    var count = el('span', 'bd-sec-count', String(list.length));
    var more = el('button', 'bd-sec-more', '⋮'); more.type = 'button'; more.title = '섹션 메뉴';
    more.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var secs = sortedSections(), i = secs.findIndex(function (s) { return s.id === sec.id; });
      var back = layout === 'h' ? '왼쪽으로' : '위로', fwd = layout === 'h' ? '오른쪽으로' : '아래로';
      var items = [{ label: '이름 바꾸기', onClick: function () { renameSection(sec, title); } }];
      if (i > 0) items.push({ label: back + ' 이동', onClick: function () { moveSection(sec, -1); } });
      if (i < secs.length - 1) items.push({ label: fwd + ' 이동', onClick: function () { moveSection(sec, 1); } });
      items.push('-', { label: '섹션 삭제', danger: true, onClick: function () { deleteSection(sec); } });
      openMenu(more, items);
    });
    head.appendChild(title); head.appendChild(count); head.appendChild(more);
    wrap.appendChild(head);

    var body = el('div', 'bd-sec-body');
    if (addingIn === sec.id) body.appendChild(renderAddForm(sec));
    else {
      var add = el('button', 'bd-add', '+ 카드 추가'); add.type = 'button';
      add.addEventListener('click', function (ev) { ev.stopPropagation(); addingIn = sec.id; render(); var t = document.querySelector('.bd-addform textarea'); if (t) t.focus(); });
      body.appendChild(add);
    }
    var cl = el('div', 'bd-cards'); cl.dataset.sid = sec.id;
    list.forEach(function (c) { cl.appendChild(renderCard(c)); });
    body.appendChild(cl);
    wrap.appendChild(body);
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
      var sid = list && list.dataset.sid;
      var index = 0;
      if (list) { var seen = 0; for (var i = 0; i < list.children.length; i++) { var x = list.children[i]; if (x === ph) break; if (x.classList.contains('bd-card') && x.style.display !== 'none') seen++; } index = seen; }
      ghost.remove(); ph.remove(); row.style.display = '';
      if (sid) placeCard(card, sid, index);
      render();
    }
    function cancel() {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', cancel);
      ghost.remove(); ph.remove(); row.style.display = ''; render();
    }
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
      if (!sec) { sec = sections.filter(function (s) { return s.name === '복구됨'; })[0] || addSection('복구됨'); }
      it.sectionId = sec.id; it.order = sectionCards(sec.id).length; it.done = !!it.done;
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
      if (!c.sectionId || !curSecIds[c.sectionId]) {
        var rs = sections.filter(function (s) { return s.name === '복구됨'; })[0] || addSection('복구됨');
        curSecIds[rs.id] = true; c.sectionId = rs.id;
      }
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
    var legacy = (b.memo || []).some(function (c) { return c && !c.sectionId; }) && !(b.sections || []).length;
    sections = (b.sections || []).map(function (s) { return JSON.parse(JSON.stringify(s)); });
    cards = (b.memo || []).map(function (c, i) { var x = JSON.parse(JSON.stringify(c)); if (x.order == null) x.order = i; return x; });
    if (legacy) { var s0 = { id: uid('s'), name: '메모', order: 0 }; sections.push(s0); cards.forEach(function (c) { c.sectionId = s0.id; }); }
    var okSec = {}; sections.forEach(function (s) { okSec[s.id] = true; });
    cards.forEach(function (c) { if (!c.sectionId || !okSec[c.sectionId]) { var rs = sections.filter(function (s) { return s.name === '복구됨'; })[0]; if (!rs) { rs = { id: uid('s'), name: '복구됨', order: sections.length }; sections.push(rs); okSec[rs.id] = true; } c.sectionId = rs.id; } });
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
    var orphan = cards.filter(function (c) { return !c.sectionId || !sections.some(function (s) { return s.id === c.sectionId; }); });
    if (orphan.length) { var tg = sections[0] || addSection('메모'); orphan.forEach(function (c, i) { c.sectionId = tg.id; c.order = c.order == null ? i : c.order; }); }
    save();
  }

  function init() {
    load();
    document.addEventListener('click', function () { closeMenu(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { closeMenu(); } });
    window.addEventListener('tt-open-recovery', function () { openRecovery(); });
    var root = $('memoBoard');
    if (root) root.addEventListener('click', function () { if (addingIn || editingId) { addingIn = null; editingId = null; render(); } });
    render();
  }

  window.BOARD = {
    init: init, render: render, getSyncState: getSyncState, applySync: applySync,
    trash: function (kind, item) { addToTrash(kind, item); }, openRecovery: openRecovery,
    exportState: exportState, importState: importState
  };
})();
