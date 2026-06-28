/* AcqVault — Saved clauses & searches + on-device change tracking (client-side only).
   Everything lives in localStorage: no account, no backend, nothing leaves the browser.
   Change tracking: each pinned clause stores the content hash it had when pinned; on load we
   compare against /output/doc-hashes.json (regenerated each build via scripts/gen_doc_hashes.py)
   and flag any clause whose text has changed — "N updated since you saved". Degrades silently
   offline / if the manifest is missing.
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

  // ── Change tracking ────────────────────────────────────────────────────────
  // Compare each pinned clause's content hash (baselined at pin time) against the
  // live /output/doc-hashes.json manifest. The manifest is the single source of
  // truth, so we never hash in JS — we just look ids up. Degrades silently offline.
  var HASHES = null;        // { id: hash }
  var hashesPromise = null;
  function loadHashes() {
    if (HASHES) return Promise.resolve(HASHES);
    if (hashesPromise) return hashesPromise;
    hashesPromise = fetch('/output/doc-hashes.json')
      .then(function (r) { if (!r.ok) throw new Error('hashes ' + r.status); return r.json(); })
      .then(function (h) { HASHES = h || {}; return HASHES; })
      .catch(function (e) { hashesPromise = null; throw e; });
    return hashesPromise;
  }
  function clauseChanged(c) {
    if (!HASHES || c.chash == null) return false;
    var h = HASHES[c.id];
    return !!h && h !== c.chash;
  }
  function changedClauses() { return state.clauses.filter(clauseChanged); }
  function markSeen(id) {
    var c = state.clauses.find(function (x) { return x.id === id; });
    if (c && HASHES && HASHES[id]) {
      c.chash = HASHES[id];
      fetchClauseText(c).then(function (t) { if (t) { c.text = t; persist(); } }); // re-baseline wording to current
      persist(); updateCounts(); if (panelOpen) renderPanel();
    }
  }
  function markAllSeen() {
    if (!HASHES) return;
    state.clauses.forEach(function (c) {
      if (clauseChanged(c)) { c.chash = HASHES[c.id]; fetchClauseText(c).then(function (t) { if (t) { c.text = t; persist(); } }); }
    });
    persist(); updateCounts(); if (panelOpen) renderPanel();
  }
  // After the manifest loads, baseline any pins made before change-tracking existed
  // (no chash) to "seen now" — so we never flash a false "Updated" for old pins.
  function reconcileHashes() {
    if (!HASHES) return;
    var dirty = false;
    state.clauses.forEach(function (c) {
      if (c.chash == null && HASHES[c.id]) { c.chash = HASHES[c.id]; dirty = true; }
    });
    if (dirty) persist();
    updateCounts(); if (panelOpen) renderPanel();
  }
  function ensureHashes() {
    if (!HASHES && state.clauses.length) loadHashes().then(reconcileHashes).catch(function () {});
  }

  // ── Snapshot + diff: show EXACTLY what changed in a pinned clause ────────────
  // We snapshot the clause text at pin time (and re-baseline on "seen"); when it
  // later changes we fetch the current text and render a word-level diff.
  function cleanText(s) {
    if (typeof window.cleanClauseText === 'function') { try { return window.cleanClauseText(s); } catch (e) {} }
    return (s || '').replace(/L\d+:/g, '').replace(/\s+/g, ' ').trim();
  }
  function fetchClauseText(c) {
    if (typeof window.fetchDocumentById !== 'function') return Promise.resolve('');
    return window.fetchDocumentById(c.id, { source: c.source, part: c.part, title: c.title })
      .then(function (doc) { return doc ? cleanText(doc.content || '') : ''; })
      .catch(function () { return ''; });
  }
  function ensurePinText(c) {           // capture a baseline of the wording at pin/seen time
    if (c.text != null) return;
    fetchClauseText(c).then(function (t) { if (t && c.text == null) { c.text = t; persist(); } });
  }
  function wordDiff(oldStr, newStr) {   // LCS over whitespace-preserving word tokens
    var a = (oldStr || '').split(/(\s+)/), b = (newStr || '').split(/(\s+)/);
    var n = a.length, m = b.length, i, j;
    var dp = []; for (i = 0; i <= n; i++) dp.push(new Array(m + 1).fill(0));
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push(['eq', a[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['del', a[i]]); i++; }
      else { out.push(['ins', b[j]]); j++; }
    }
    while (i < n) out.push(['del', a[i++]]);
    while (j < m) out.push(['ins', b[j++]]);
    return out;
  }
  function renderDiffHtml(oldStr, newStr) {
    return wordDiff(oldStr, newStr).map(function (p) {
      var v = esc(p[1]);
      return p[0] === 'eq' ? v : p[0] === 'del' ? '<del>' + v + '</del>' : '<ins>' + v + '</ins>';
    }).join('');
  }
  function toggleDiff(id) {
    var sel = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
    var box = document.querySelector('.saved-clause[data-id="' + sel + '"] .saved-diff');
    if (!box) return;
    if (box.dataset.open === '1') { box.style.display = 'none'; box.dataset.open = '0'; return; }
    box.style.display = 'block'; box.dataset.open = '1';
    var c = state.clauses.find(function (x) { return x.id === id; });
    if (!c) return;
    if (c.text == null) { box.innerHTML = '<div class="saved-diff-note">We didn’t capture the earlier wording for this one, so a side-by-side isn’t available — open it to read the current text.</div>'; return; }
    box.innerHTML = '<div class="saved-diff-loading">Loading what changed…</div>';
    fetchClauseText(c).then(function (cur) {
      if (!cur) { box.innerHTML = '<div class="saved-diff-note">Couldn’t load the current text. Open the clause to read it.</div>'; return; }
      if (cur === c.text) { box.innerHTML = '<div class="saved-diff-note">The wording reads the same now — the change may have been formatting or status.</div>'; return; }
      box.innerHTML = '<div class="saved-diff-body">' + renderDiffHtml(c.text, cur) + '</div>' +
        '<div class="saved-diff-foot"><del>struck</del> removed · <ins>highlighted</ins> added</div>';
    });
  }

  function isPinned(id) { return state.clauses.some(function (c) { return c.id === id; }); }

  function toggleClause(d) {
    if (!d || !d.id) return false;
    var i = state.clauses.findIndex(function (c) { return c.id === d.id; });
    if (i >= 0) { state.clauses.splice(i, 1); }
    else {
      if (state.clauses.length >= MAX) state.clauses.shift();
      var nc = {
        id: d.id, title: d.title || '', source: d.source || '', part: d.part || '',
        filename: d.filename || '', url: d.url || '', anchor: d.anchor || '',
        indexed_at: d.indexed_at || '', status: d.status || '',
        chash: (HASHES && HASHES[d.id]) || null, // content-hash baseline for change tracking
        text: (d.content != null ? cleanText(d.content) : null), // wording baseline for the diff
        savedAt: Date.now()
      };
      state.clauses.push(nc);
      ensurePinText(nc); // fill the text baseline from the corpus if the pin didn't carry content
    }
    persist(); syncStars(d.id); updateCounts(); if (panelOpen) renderPanel();
    ensureHashes(); // baseline the new pin once the manifest is available
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
    var changed = changedClauses().length;
    var badge = document.getElementById('nav-saved-count');
    if (badge) { badge.textContent = n ? String(n) : ''; badge.style.display = n ? '' : 'none'; }
    var btn = document.getElementById('nav-saved');
    if (btn) {
      btn.classList.toggle('has-saved', n > 0);
      btn.classList.toggle('has-changes', changed > 0);
      btn.setAttribute('aria-label', changed > 0
        ? ('Saved — ' + changed + ' clause' + (changed === 1 ? '' : 's') + ' updated since you saved')
        : 'Open saved clauses and searches');
    }
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
      cl.innerHTML = '<div class="saved-empty">No pinned clauses yet. Tap the ★ on any result or in the reader to keep it here — AcqVault will then flag it if the text changes.</div>';
    } else {
      var changed = changedClauses();
      var changedIds = {};
      changed.forEach(function (c) { changedIds[c.id] = true; });
      // changed clauses first, otherwise most-recent first
      var ordered = state.clauses.slice().reverse().sort(function (a, b) {
        return (changedIds[b.id] ? 1 : 0) - (changedIds[a.id] ? 1 : 0);
      });
      var banner = changed.length
        ? '<div class="saved-changed-banner"><span><b>' + changed.length + '</b> updated since you saved ' +
          (changed.length === 1 ? 'it' : 'them') + '</span>' +
          '<button class="saved-markall" data-act="mark-all-seen" type="button">Mark all seen</button></div>'
        : '';
      cl.innerHTML = banner + ordered.map(function (c) {
        var chg = !!changedIds[c.id];
        return '<div class="saved-clause" data-id="' + esc(c.id) + '">' +
          '<div class="saved-item' + (chg ? ' is-changed' : '') + '" data-kind="clause" data-id="' + esc(c.id) + '">' +
            '<button class="saved-item-main" data-act="open-clause" data-id="' + esc(c.id) + '">' +
              '<div class="saved-item-meta">' + sourceTag(c.source) +
                (c.part ? '<span class="rc-part">Part ' + dispPart(c) + '</span>' : '') +
                (chg ? '<span class="saved-updated-pill">Updated</span>' : '') + '</div>' +
              '<div class="saved-item-title">' + esc(c.title || 'Untitled') + '</div>' +
              (c.filename ? '<div class="saved-item-sub">' + esc(c.filename) + '</div>' : '') +
            '</button>' +
            '<button class="saved-item-del" data-act="del-clause" data-id="' + esc(c.id) + '" aria-label="Remove pinned clause">✕</button>' +
          '</div>' +
          (chg ? '<button class="saved-diff-toggle" type="button" data-act="show-diff" data-id="' + esc(c.id) + '" aria-expanded="false">See what changed</button>' +
                 '<div class="saved-diff" style="display:none"></div>' : '') +
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

  // ── First-run coachmark: teach pin + change-tracking (shown once, ever) ──────
  var COACH_KEY = 'acqvault_pin_coach_seen';
  var coachReposition = null;
  function dismissPinCoach() {
    var tip = document.getElementById('pin-coach');
    if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
    if (coachReposition) {
      window.removeEventListener('resize', coachReposition);
      window.removeEventListener('scroll', coachReposition, true);
      coachReposition = null;
    }
  }
  function positionPinCoach(tip, anchor, allowDismiss) {
    var r = anchor.getBoundingClientRect();
    if (allowDismiss && (r.bottom < 8 || r.top > window.innerHeight - 8)) { dismissPinCoach(); return; }
    var w = Math.min(300, window.innerWidth - 24);
    tip.style.width = w + 'px';
    tip.style.left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)) + 'px';
    tip.style.top = Math.max(12, Math.min(r.bottom + 10, window.innerHeight - 96)) + 'px';
  }
  function maybeShowPinCoach() {
    try { if (localStorage.getItem(COACH_KEY)) return; } catch (e) { return; }
    if (state.clauses.length) return;                 // already a pinner — no lesson needed
    if (document.getElementById('pin-coach')) return; // already showing
    var firstPin = document.querySelector('#results-list .rc-pin');
    if (!firstPin) return;
    try { localStorage.setItem(COACH_KEY, '1'); } catch (e) {} // show once, ever
    var tip = document.createElement('div');
    tip.id = 'pin-coach'; tip.className = 'pin-coach'; tip.setAttribute('role', 'status');
    tip.innerHTML = '<span class="pin-coach-star" aria-hidden="true">★</span>' +
      '<span class="pin-coach-text"><b>Save the clauses you rely on.</b> AcqVault flags you the moment the RFO text changes — and shows you exactly what.</span>' +
      '<button type="button" class="pin-coach-x" aria-label="Dismiss">✕</button>';
    document.body.appendChild(tip);
    positionPinCoach(tip, firstPin, false);
    coachReposition = function () { var t = document.getElementById('pin-coach'); if (t) positionPinCoach(t, firstPin, true); };
    window.addEventListener('resize', coachReposition);
    window.addEventListener('scroll', coachReposition, true);
    tip.querySelector('.pin-coach-x').addEventListener('click', dismissPinCoach);
  }

  // ── Event wiring ─────────────────────────────────────────────────────────
  // Capture-phase for the card ★ so it never bubbles into the card's open-drawer handler.
  function onClickCapture(e) {
    var star = e.target.closest && e.target.closest('.rc-pin');
    if (star) { e.preventDefault(); e.stopPropagation(); dismissPinCoach(); toggleClause(hitFromStar(star)); }
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
    if (act === 'open-clause') { var c = state.clauses.find(function (x) { return x.id === t.dataset.id; }); if (c) { markSeen(c.id); openSavedClause(c); } }
    else if (act === 'del-clause') { removeClause(t.dataset.id); }
    else if (act === 'mark-all-seen') { markAllSeen(); }
    else if (act === 'show-diff') { var open = t.getAttribute('aria-expanded') === 'true'; t.setAttribute('aria-expanded', String(!open)); t.textContent = open ? 'See what changed' : 'Hide changes'; toggleDiff(t.dataset.id); }
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
    document.addEventListener('acqvault:searched', function (e) { refreshSaveSearchBtn(e); setTimeout(maybeShowPinCoach, 650); });
    var si = document.getElementById('search-input');
    if (si) si.addEventListener('input', refreshSaveSearchBtn);
    updateCounts();
    ensureHashes(); // check whether any pinned clause's text has changed since it was saved
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public surface used by inline handlers / app.js
  window.AcqSaved = { isPinned: isPinned, openPanel: openPanel, closePanel: closePanel };
})();
