/* AcqVault — Saved clauses & searches (client-side only).
   Everything lives in localStorage: no account, no backend, nothing leaves the browser.
   Seeds Phase-2 change tracking by baselining each pinned clause's indexed_at/status at save time.
   Reuses app.js globals when present (sourceTag, openDrawer, fetchDocumentById, runSearch,
   setMode, searchInput, activeSources) but degrades gracefully if any are missing. */
(function () {
  'use strict';

  var KEY = 'acqvault_saved_v1';
  var MAX = 250; // generous cap; oldest trimmed first

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sourceTag(src) {
    if (typeof window.sourceTag === 'function') { try { return window.sourceTag(src); } catch (e) {} }
    return src ? '<span class="rc-part">' + esc(src) + '</span>' : '';
  }
  function dispPart(c) {
    if (!c.part) return '';
    if (typeof window.displayPartForSource === 'function') {
      try { return esc(window.displayPartForSource(c.source, c.part)); } catch (e) {}
    }
    return esc(c.part);
  }

  // ── Storage ──────────────────────────────────────────────────────────────
  function load() {
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { clauses: Array.isArray(o.clauses) ? o.clauses : [],
               searches: Array.isArray(o.searches) ? o.searches : [] };
    } catch (e) { return { clauses: [], searches: [] }; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode / quota: degrade */ }
  }
  var state = load();
  var panelOpen = false;

  function isPinned(id) { return state.clauses.some(function (c) { return c.id === id; }); }

  function toggleClause(d) {
    if (!d || !d.id) return false;
    var i = state.clauses.findIndex(function (c) { return c.id === d.id; });
    if (i >= 0) { state.clauses.splice(i, 1); }
    else {
      if (state.clauses.length >= MAX) state.clauses.shift();
      state.clauses.push({
        id: d.id, title: d.title || '', source: d.source || '', part: d.part || '',
        filename: d.filename || '', url: d.url || '', anchor: d.anchor || '',
        indexed_at: d.indexed_at || '', status: d.status || '', // Phase-2 change-tracking baseline
        savedAt: Date.now()
      });
    }
    persist(); syncStars(d.id); updateCounts(); if (panelOpen) renderPanel();
    return isPinned(d.id);
  }
  function removeClause(id) {
    var i = state.clauses.findIndex(function (c) { return c.id === id; });
    if (i >= 0) { state.clauses.splice(i, 1); persist(); syncStars(id); updateCounts(); if (panelOpen) renderPanel(); }
  }

  // app.js declares searchInput/activeSources with const/let, so they are NOT on window.
  // Read straight from the DOM instead — robust and avoids coupling to internals.
  function searchInputEl() { return document.getElementById('search-input'); }
  function activeSourcesFromDOM() {
    var out = [];
    document.querySelectorAll('#source-filters .fpill.active').forEach(function (p) {
      if (p.dataset.source && p.dataset.source !== 'all') out.push(p.dataset.source);
    });
    return out;
  }
  function currentSearchSig() {
    var el = searchInputEl();
    return { q: (el && el.value || '').trim(), sources: activeSourcesFromDOM() };
  }
  function sameSearch(a, b) {
    return a.q === b.q &&
      JSON.stringify((a.sources || []).slice().sort()) === JSON.stringify((b.sources || []).slice().sort());
  }
  function currentSearchSaved() {
    var sig = currentSearchSig();
    return !!sig.q && state.searches.some(function (s) { return sameSearch(s, sig); });
  }
  function saveCurrentSearch() {
    var sig = currentSearchSig();
    if (!sig.q) return false;
    if (state.searches.some(function (s) { return sameSearch(s, sig); })) return true;
    if (state.searches.length >= MAX) state.searches.shift();
    state.searches.push({ q: sig.q, sources: sig.sources, savedAt: Date.now() });
    persist(); updateCounts(); if (panelOpen) renderPanel();
    return true;
  }
  function removeSearch(idx) {
    state.searches.splice(idx, 1); persist(); updateCounts(); if (panelOpen) renderPanel();
  }

  // ── Acting on saved items ────────────────────────────────────────────────
  function runSavedSearch(s) {
    closePanel();
    var el = searchInputEl();
    if (el) el.value = s.q;
    // Restore the source scope by driving the app's own filter pills (which own activeSources).
    var allPill = document.querySelector('#source-filters .fpill[data-source="all"]');
    if (s.sources && s.sources.length) {
      if (allPill && allPill.classList.contains('active')) allPill.click();
      // turn everything off, then on for the saved set
      document.querySelectorAll('#source-filters .fpill.active').forEach(function (p) {
        if (p.dataset.source && p.dataset.source !== 'all' && s.sources.indexOf(p.dataset.source) < 0) p.click();
      });
      s.sources.forEach(function (src) {
        var p = document.querySelector('#source-filters .fpill[data-source="' + src + '"]');
        if (p && !p.classList.contains('active')) p.click();
      });
    } else if (allPill && !allPill.classList.contains('active')) {
      allPill.click(); // back to All sources
    }
    if (typeof window.setMode === 'function') window.setMode('search');
    if (typeof window.runSearch === 'function') window.runSearch();
  }
  function openSavedClause(c) {
    closePanel();
    if (typeof window.fetchDocumentById === 'function') {
      window.fetchDocumentById(c.id, { source: c.source, part: c.part, title: c.title })
        .then(function (hit) { if (hit && typeof window.openDrawer === 'function') window.openDrawer(hit); })
        .catch(function () {});
    }
  }

  // ── DOM sync: stars on cards + drawer pin ────────────────────────────────
  function paintStar(btn, pinned) {
    if (!btn) return;
    btn.classList.toggle('is-pinned', pinned);
    btn.setAttribute('aria-pressed', String(pinned));
    btn.setAttribute('title', pinned ? 'Saved — click to remove' : 'Save this clause');
    btn.setAttribute('aria-label', pinned ? 'Remove saved clause' : 'Save this clause');
  }
  function syncStars(id) {
    var pinned = isPinned(id);
    document.querySelectorAll('.rc-pin[data-pin-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]')
      .forEach(function (b) { paintStar(b, pinned); });
    var dp = document.getElementById('drawer-pin');
    if (dp && dp.dataset.pinId === id) paintStar(dp, pinned);
  }
  function hitFromStar(btn) {
    return { id: btn.dataset.pinId, title: btn.dataset.pinTitle, source: btn.dataset.pinSource,
             part: btn.dataset.pinPart, filename: btn.dataset.pinFile, url: btn.dataset.pinUrl,
             anchor: btn.dataset.pinAnchor, indexed_at: btn.dataset.pinIndexed, status: btn.dataset.pinStatus };
  }

  // ── Save-search button (in the results meta bar) ─────────────────────────
  function refreshSaveSearchBtn() {
    var b = document.getElementById('save-search-btn');
    if (!b) return;
    var saved = currentSearchSaved();
    b.classList.toggle('is-saved', saved);
    b.innerHTML = saved ? '★ Search saved' : '☆ Save this search';
    b.setAttribute('aria-pressed', String(saved));
  }

  // ── Counts / nav badge ───────────────────────────────────────────────────
  function updateCounts() {
    var n = state.clauses.length + state.searches.length;
    var badge = document.getElementById('nav-saved-count');
    if (badge) { badge.textContent = n ? String(n) : ''; badge.style.display = n ? '' : 'none'; }
    var btn = document.getElementById('nav-saved');
    if (btn) btn.classList.toggle('has-saved', n > 0);
    refreshSaveSearchBtn();
  }

  // ── Panel ────────────────────────────────────────────────────────────────
  function buildPanel() {
    if (document.getElementById('saved-panel')) return;
    var back = document.createElement('div');
    back.id = 'saved-backdrop'; back.className = 'saved-backdrop';
    var p = document.createElement('aside');
    p.id = 'saved-panel'; p.className = 'saved-panel';
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true');
    p.setAttribute('aria-hidden', 'true'); p.setAttribute('aria-label', 'Saved clauses and searches');
    p.innerHTML =
      '<div class="saved-head"><div class="saved-head-title">★ Saved</div>' +
      '<button class="saved-close" id="saved-close" aria-label="Close saved panel">✕</button></div>' +
      '<div class="saved-body">' +
        '<section class="saved-sec"><h3 class="saved-sec-h">Pinned clauses<span class="saved-n" id="saved-n-clauses"></span></h3>' +
        '<div class="saved-list" id="saved-clauses"></div></section>' +
        '<section class="saved-sec"><h3 class="saved-sec-h">Saved searches<span class="saved-n" id="saved-n-searches"></span></h3>' +
        '<div class="saved-list" id="saved-searches"></div></section>' +
      '</div>' +
      '<div class="saved-foot">Stored only in this browser — nothing leaves your device.</div>';
    document.body.appendChild(back); document.body.appendChild(p);
    back.addEventListener('click', closePanel);
  }

  function renderPanel() {
    var cl = document.getElementById('saved-clauses');
    var se = document.getElementById('saved-searches');
    if (!cl || !se) return;
    document.getElementById('saved-n-clauses').textContent = state.clauses.length ? String(state.clauses.length) : '';
    document.getElementById('saved-n-searches').textContent = state.searches.length ? String(state.searches.length) : '';

    if (!state.clauses.length) {
      cl.innerHTML = '<div class="saved-empty">No pinned clauses yet. Tap the ★ on any result or in the reader to keep it here.</div>';
    } else {
      cl.innerHTML = state.clauses.slice().reverse().map(function (c) {
        return '<div class="saved-item" data-kind="clause" data-id="' + esc(c.id) + '">' +
          '<button class="saved-item-main" data-act="open-clause" data-id="' + esc(c.id) + '">' +
            '<div class="saved-item-meta">' + sourceTag(c.source) +
              (c.part ? '<span class="rc-part">Part ' + dispPart(c) + '</span>' : '') + '</div>' +
            '<div class="saved-item-title">' + esc(c.title || 'Untitled') + '</div>' +
            (c.filename ? '<div class="saved-item-sub">' + esc(c.filename) + '</div>' : '') +
          '</button>' +
          '<button class="saved-item-del" data-act="del-clause" data-id="' + esc(c.id) + '" aria-label="Remove pinned clause">✕</button>' +
        '</div>';
      }).join('');
    }

    if (!state.searches.length) {
      se.innerHTML = '<div class="saved-empty">No saved searches yet. Run a search and tap “Save this search”.</div>';
    } else {
      se.innerHTML = state.searches.slice().reverse().map(function (s, ri) {
        var idx = state.searches.length - 1 - ri; // map reversed index back to storage index
        var scope = (s.sources && s.sources.length)
          ? s.sources.map(function (x) { return esc(x); }).join(', ')
          : 'All sources';
        return '<div class="saved-item" data-kind="search">' +
          '<button class="saved-item-main" data-act="run-search" data-idx="' + idx + '">' +
            '<div class="saved-item-title">' + esc(s.q) + '</div>' +
            '<div class="saved-item-sub">' + scope + '</div>' +
          '</button>' +
          '<button class="saved-item-del" data-act="del-search" data-idx="' + idx + '" aria-label="Remove saved search">✕</button>' +
        '</div>';
      }).join('');
    }
  }

  function openPanel() {
    buildPanel(); renderPanel();
    var p = document.getElementById('saved-panel');
    var b = document.getElementById('saved-backdrop');
    p.classList.add('open'); p.setAttribute('aria-hidden', 'false');
    b.classList.add('visible'); panelOpen = true;
    document.body.style.overflow = 'hidden';
    if (typeof window.trapFocus === 'function') { try { window.trapFocus(p); } catch (e) {} }
    var close = document.getElementById('saved-close');
    if (close) close.focus();
  }
  function closePanel() {
    var p = document.getElementById('saved-panel');
    var b = document.getElementById('saved-backdrop');
    if (p) { p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); }
    if (b) b.classList.remove('visible');
    panelOpen = false;
    if (!document.getElementById('drawer') || !document.getElementById('drawer').classList.contains('open')) {
      document.body.style.overflow = '';
    }
    if (typeof window.releaseFocus === 'function') { try { window.releaseFocus(); } catch (e) {} }
    var nav = document.getElementById('nav-saved'); if (nav) nav.focus();
  }

  // ── Event wiring ─────────────────────────────────────────────────────────
  // Capture-phase for the card ★ so it never bubbles into the card's open-drawer handler.
  function onClickCapture(e) {
    var star = e.target.closest && e.target.closest('.rc-pin');
    if (star) { e.preventDefault(); e.stopPropagation(); toggleClause(hitFromStar(star)); }
  }
  function onKeydownCapture(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var star = e.target.closest && e.target.closest('.rc-pin');
    if (star) { e.preventDefault(); e.stopPropagation(); toggleClause(hitFromStar(star)); }
  }

  function onClick(e) {
    var t = e.target.closest && e.target.closest('[data-act], #nav-saved, #save-search-btn, #drawer-pin, #saved-close');
    if (!t) return;
    if (t.id === 'nav-saved') { e.preventDefault(); openPanel(); return; }
    if (t.id === 'saved-close') { closePanel(); return; }
    if (t.id === 'save-search-btn') { saveCurrentSearch(); return; }
    if (t.id === 'drawer-pin') {
      var hit = window.currentHit || (t.dataset.pinId ? hitFromStar(t) : null);
      if (hit) toggleClause(hit);
      return;
    }
    var act = t.dataset.act;
    if (act === 'open-clause') { var c = state.clauses.find(function (x) { return x.id === t.dataset.id; }); if (c) openSavedClause(c); }
    else if (act === 'del-clause') { removeClause(t.dataset.id); }
    else if (act === 'run-search') { var s = state.searches[+t.dataset.idx]; if (s) runSavedSearch(s); }
    else if (act === 'del-search') { removeSearch(+t.dataset.idx); }
  }

  function onDrawerOpen(e) {
    var hit = e.detail || window.currentHit;
    var dp = document.getElementById('drawer-pin');
    if (!dp || !hit) return;
    dp.dataset.pinId = hit.id || '';
    dp.dataset.pinTitle = hit.title || ''; dp.dataset.pinSource = hit.source || '';
    dp.dataset.pinPart = hit.part || ''; dp.dataset.pinFile = hit.filename || '';
    dp.dataset.pinUrl = hit.url || ''; dp.dataset.pinAnchor = hit.anchor || '';
    dp.dataset.pinIndexed = hit.indexed_at || ''; dp.dataset.pinStatus = hit.status || '';
    paintStar(dp, isPinned(hit.id));
  }

  function init() {
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('keydown', onKeydownCapture, true);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panelOpen) closePanel(); });
    document.addEventListener('acqvault:draweropen', onDrawerOpen);
    document.addEventListener('acqvault:searched', refreshSaveSearchBtn);
    var si = document.getElementById('search-input');
    if (si) si.addEventListener('input', refreshSaveSearchBtn);
    updateCounts();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public surface used by inline handlers / app.js
  window.AcqSaved = { isPinned: isPinned, openPanel: openPanel, closePanel: closePanel };
})();
