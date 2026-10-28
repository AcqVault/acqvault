/* ══ PART NAV — Contents, in-part search, back-to-top for SERVER-RENDERED pages ══
 *
 * The crawlable /<source>/part-N pages are the ones Google sends people to, and
 * they were the ones with no way to move: /pgi/part-4 is 62,017px tall and
 * /rfo/part-19 is 136,720px at 375. The in-app reader has had all three
 * affordances for months; this gives the SSR pages the same ones.
 *
 * Deliberate parity with assets/polish.js "PART SEARCH": highlight every match,
 * count them, step with prev/next or Enter/Shift+Enter, clear with ✕. Same
 * algorithm, same words on screen — a reader who learns one has learned both.
 *
 * The Contents list itself is SERVER-RENDERED (see renderPartPage in api/_seo.js)
 * so it works, and crawls, with JavaScript off. Everything this file adds is a
 * control that would be dead without JS, so JS is what creates it.
 *
 * CSP is script-src 'self' — this ships as a versioned self-hosted asset, never
 * an inline <script>.
 */
(function () {
  'use strict';

  var main = document.querySelector('main');
  var toc = document.getElementById('ptoc');
  if (!main) return;
  var sections = Array.prototype.slice.call(main.querySelectorAll('section.sec'));
  if (!sections.length) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var scrollBehavior = reduceMotion ? 'auto' : 'smooth';

  /* ── in-part search ─────────────────────────────────────────────── */
  var marks = [];
  var activeIndex = -1;

  var bar = document.createElement('div');
  bar.className = 'pn-search';
  bar.id = 'pn-search';
  bar.setAttribute('role', 'search');
  bar.innerHTML =
    '<label class="pn-search-lbl" for="pn-search-input">Search this page</label>' +
    '<span class="pn-search-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
      '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg></span>' +
    '<input class="pn-search-input" id="pn-search-input" type="search" autocomplete="off" spellcheck="false">' +
    '<span class="pn-search-count" id="pn-search-count" role="status" aria-live="polite"></span>' +
    '<span class="pn-search-nav" id="pn-search-nav">' +
      '<button type="button" class="pn-step" id="pn-prev" aria-label="Previous match" disabled>↑</button>' +
      '<button type="button" class="pn-step" id="pn-next" aria-label="Next match" disabled>↓</button>' +
    '</span>' +
    '<button type="button" class="pn-clear" id="pn-clear" aria-label="Clear search">✕</button>';

  // Above the Contents when there is one, otherwise at the head of the sections.
  if (toc) toc.parentNode.insertBefore(bar, toc);
  else sections[0].parentNode.insertBefore(bar, sections[0]);

  var input = document.getElementById('pn-search-input');
  var countEl = document.getElementById('pn-search-count');
  var navEl = document.getElementById('pn-search-nav');
  var prevBtn = document.getElementById('pn-prev');
  var nextBtn = document.getElementById('pn-next');
  var clearBtn = document.getElementById('pn-clear');

  // The placeholder names the unit the page is actually showing ("Search within
  // Part 19…") — the heading is the only place that word is reliable.
  var unit = (document.querySelector('h1') && document.querySelector('h1').textContent || '').split('·').pop().trim();
  input.placeholder = unit ? 'Search within ' + unit + '…' : 'Search this page…';

  function escapeRegExp(v) { return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function clearMarks() {
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (m.parentNode) m.replaceWith(document.createTextNode(m.textContent || ''));
    }
    // normalize() only where we touched, so a 136,000px page isn't re-walked whole
    for (var j = 0; j < sections.length; j++) {
      if (sections[j].dataset.pnTouched) { sections[j].normalize(); delete sections[j].dataset.pnTouched; }
    }
    marks = [];
    activeIndex = -1;
  }

  function highlightNode(node, regex) {
    var text = node.nodeValue;
    regex.lastIndex = 0;
    if (!text || !regex.test(text)) return 0;
    regex.lastIndex = 0;
    var frag = document.createDocumentFragment();
    var lastIndex = 0, n = 0;
    text.replace(regex, function (match, offset) {
      if (offset > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
      var mark = document.createElement('mark');
      mark.className = 'pn-mark';
      mark.textContent = match;
      frag.appendChild(mark);
      marks.push(mark);
      n++;
      lastIndex = offset + match.length;
      return match;
    });
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.replaceWith(frag);
    return n;
  }

  function highlightSection(section, regex) {
    var walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('button,input,textarea,select,script,style,mark')) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], total = 0;
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i++) total += highlightNode(nodes[i], regex);
    if (total) section.dataset.pnTouched = '1';
    return total;
  }

  function updateNav() {
    var has = marks.length > 0;
    if (navEl) navEl.classList.toggle('visible', has);
    prevBtn.disabled = !has;
    nextBtn.disabled = !has;
    clearBtn.classList.toggle('visible', !!input.value);
    if (!input.value.trim()) countEl.textContent = '';
    else if (!has) countEl.textContent = 'No matches';
    else if (activeIndex >= 0) countEl.textContent = (activeIndex + 1) + ' of ' + marks.length;
    else countEl.textContent = marks.length + ' match' + (marks.length !== 1 ? 'es' : '');
  }

  function activate(index) {
    if (!marks.length) return;
    activeIndex = (index + marks.length) % marks.length;
    for (var i = 0; i < marks.length; i++) marks[i].classList.remove('active');
    var current = marks[activeIndex];
    current.classList.add('active');
    countEl.textContent = (activeIndex + 1) + ' of ' + marks.length;
    current.scrollIntoView({ behavior: scrollBehavior, block: 'center' });
  }

  function runFilter(q) {
    clearMarks();
    var term = q.trim();
    if (!term) { updateNav(); return; }
    // One character matches most of the page and costs a full re-walk for nothing.
    // Still run updateNav so the nav bar and prev/next reset to the now-cleared marks —
    // then blank the count, because "No matches" is a false negative on a page full of
    // matches when the search simply hasn't started yet.
    if (term.length < 2) { updateNav(); if (countEl) countEl.textContent = ''; return; }
    var regex = new RegExp(escapeRegExp(term), 'gi');
    for (var i = 0; i < sections.length; i++) highlightSection(sections[i], regex);
    updateNav();
  }

  var debounce;
  input.addEventListener('input', function () {
    clearTimeout(debounce);
    clearBtn.classList.toggle('visible', !!input.value);
    // Debounced: these pages carry thousands of text nodes and highlighting on
    // every keystroke made typing stutter.
    debounce = setTimeout(function () { runFilter(input.value); }, 160);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(debounce);
      if (!marks.length) runFilter(input.value);
      if (marks.length) activate(e.shiftKey ? activeIndex - 1 : activeIndex + 1);
    } else if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      input.value = ''; runFilter(''); input.focus();
    }
  });
  prevBtn.addEventListener('click', function () { activate(activeIndex - 1); input.focus(); });
  nextBtn.addEventListener('click', function () { activate(activeIndex + 1); input.focus(); });
  clearBtn.addEventListener('click', function () {
    input.value = ''; clearTimeout(debounce); runFilter(''); input.focus();
  });

  // ⌘F / Ctrl+F is the browser's own find, and it cannot see text we have not
  // highlighted — but it also cannot be intercepted politely. "/" is the
  // convention for page-local search and costs nothing.
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  /* ── back to top ────────────────────────────────────────────────── */
  // Named topBtn, not top: a bare `top` is window.top, and shadowing it inside a
  // closure is a trap waiting for whoever edits this next.
  var topBtn = document.createElement('button');
  topBtn.type = 'button';
  topBtn.className = 'pn-top';
  topBtn.setAttribute('aria-label', 'Back to top');
  topBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg><span>Top</span>';
  topBtn.addEventListener('click', function () {
    // These documents run to 137,000px. A smooth scroll across that distance is
    // a multi-second glide the user has to sit through, so past a few screens
    // "Top" means top, now. Short parts keep the animation.
    var far = window.scrollY > 4000;
    window.scrollTo({ top: 0, behavior: far ? 'auto' : scrollBehavior });
    // Focus the search box rather than dumping the user at the top with no
    // keyboard position — that is where they would go next anyway.
    input.focus({ preventScroll: true });
  });
  document.body.appendChild(topBtn);

  function applyTopState() { topBtn.classList.toggle('visible', window.scrollY > 900); }

  // Throttled on a timestamp, NOT on requestAnimationFrame. The rAF version of
  // this was written first and could not be verified: rAF does not fire at all
  // in an offscreen or non-compositing frame, which left the button permanently
  // invisible with no error. A dropped frame must never be able to hide a
  // navigation control — and a stale timestamp, unlike a latched `ticking`
  // flag, cannot wedge. polish.js listens on scroll the same plain way.
  var lastRun = 0, trailing;
  function onScroll() {
    var now = Date.now();
    clearTimeout(trailing);
    if (now - lastRun >= 120) { lastRun = now; applyTopState(); }
    // Always settle on the final position, even if the last event was throttled.
    else trailing = setTimeout(function () { lastRun = Date.now(); applyTopState(); }, 120);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  applyTopState();

  // ── On-this-page: highlight the section you're reading in the Contents ──
  // On wide screens the Contents is a sticky right rail; syncing the active
  // item turns it into a live map of the (60,000-137,000px) document.
  if (toc && 'IntersectionObserver' in window) {
    var tocList = toc.querySelector('.ptoc-list');
    var tocLinks = Array.prototype.slice.call(toc.querySelectorAll('.ptoc-list a'));
    var linkFor = {};
    tocLinks.forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.charAt(0) === '#') linkFor[h.slice(1)] = a;
    });
    var activeId = null;
    function setActive(id) {
      if (id === activeId || !linkFor[id]) return;
      activeId = id;
      tocLinks.forEach(function (a) { a.classList.remove('ptoc-active'); a.removeAttribute('aria-current'); });
      var a = linkFor[id];
      a.classList.add('ptoc-active');
      a.setAttribute('aria-current', 'true');
      // keep the active item visible within the rail WITHOUT scrolling the page
      if (tocList && tocList.scrollHeight > tocList.clientHeight + 4) {
        var lr = tocList.getBoundingClientRect(), ar = a.getBoundingClientRect();
        if (ar.top < lr.top) tocList.scrollTop += ar.top - lr.top - 8;
        else if (ar.bottom > lr.bottom) tocList.scrollTop += ar.bottom - lr.bottom + 8;
      }
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting && e.target.id) setActive(e.target.id); });
    }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 });
    sections.forEach(function (s) { if (s.id) io.observe(s); });

    // A focused Contents link must be visible inside the rail's own scroller
    // (Tab landed on "15.000 Scope" while the list showed 15.408). Scroll the
    // list only, never the page.
    toc.addEventListener('focusin', function (e) {
      var a = e.target.closest && e.target.closest('.ptoc-list a');
      if (!a || !tocList || tocList.scrollHeight <= tocList.clientHeight + 4) return;
      var lr = tocList.getBoundingClientRect(), ar = a.getBoundingClientRect();
      if (ar.top < lr.top) tocList.scrollTop += ar.top - lr.top - 8;
      else if (ar.bottom > lr.bottom) tocList.scrollTop += ar.bottom - lr.bottom + 8;
    });
    // Back at the top of the page the rail starts at the top too, with nothing marked.
    window.addEventListener('scroll', function () {
      if (window.scrollY > 200 || activeId === null) return;
      activeId = null;
      tocLinks.forEach(function (a) { a.classList.remove('ptoc-active'); a.removeAttribute('aria-current'); });
      if (tocList) tocList.scrollTop = 0;
    }, { passive: true });
  }
})();


/* ---- Contents: collapse on narrow screens -------------------------------------------
   The rail is a rail only above 1000px. Below it the list renders inline and costs the
   reader ~350px of scrolling before the first section — on the page they opened to read
   that section. Collapsed by default there, with the heading carrying a real toggle.

   Progressive by construction: the CSS only hides the list when THIS script has set
   data-collapsed, so with JS off, or before this runs, the list is exactly what it has
   always been. */
(function () {
  var toc = document.getElementById('ptoc');
  if (!toc) return;
  var head = toc.querySelector('.ptoc-head');
  var list = toc.querySelector('.ptoc-list');
  if (!head || !list) return;

  var mq = window.matchMedia('(max-width:999px)');
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ptoc-toggle';
  btn.setAttribute('aria-controls', list.id || (list.id = 'ptoc-list'));
  head.appendChild(btn);

  function paint(collapsed) {
    toc.setAttribute('data-collapsed', collapsed ? '1' : '0');
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    btn.textContent = collapsed ? 'Show' : 'Hide';
  }
  function sync() {
    toc.setAttribute('data-collapsible', mq.matches ? '1' : '0');
    // Above the breakpoint it is a sticky rail and must never be left collapsed.
    paint(mq.matches);
  }
  btn.addEventListener('click', function () {
    paint(toc.getAttribute('data-collapsed') !== '1');
  });
  // Tapping the heading is the bigger target, but only where it is actually collapsible.
  head.addEventListener('click', function (e) {
    if (!mq.matches || e.target === btn || e.target.closest('a')) return;
    paint(toc.getAttribute('data-collapsed') !== '1');
  });
  // A link inside the list is a jump: on a phone, close behind it so the reader lands on
  // the section rather than on the list they just used.
  list.addEventListener('click', function (e) {
    if (mq.matches && e.target.closest('a')) paint(true);
  });
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(sync);
  sync();
})();

/* ── Retired anchors: #<old id> → its successor ─────────────────────
 * Corpus updates retire section ids (DPCAP renumbering, the FMR restructure); bookmarks
 * and shared links still carry them as #fragments, which the server never sees. When the
 * fragment names nothing on the page, look it up in output/id-aliases.json: jump to the
 * successor here, or open it in the reader when it lives on another page. */
(function () {
  'use strict';
  function resolve() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
    if (!id || document.getElementById(id)) return;
    fetch('/output/id-aliases.json').then(function (r) { return r.ok ? r.json() : {}; }).then(function (A) {
      if (!Object.prototype.hasOwnProperty.call(A, id)) return;
      var to = A[id], el = document.getElementById(to);
      if (el) {
        try { history.replaceState(history.state, '', '#' + encodeURIComponent(to)); } catch (e) {}
        el.scrollIntoView();
      } else {
        location.replace('/?view=reader&doc=' + encodeURIComponent(to));
      }
    }).catch(function () {});
  }
  resolve();
  window.addEventListener('hashchange', resolve);
})();

/* ── Cross-reference previews: hover or focus an a.xref, see the cited section ──
 * Parity with the in-app reader's showXrefPop (app.js): 120ms intent delay, a card
 * that grows out of the citation, clamped to the viewport. A target on THIS page is
 * read straight from the DOM (free, works offline); a target on another part is
 * fetched once from /api/search {action:'document'} and cached. No network, no card —
 * the link itself still navigates. Pointer-precise devices only: on touch a tap is
 * a navigation, and a card that opened on tap would steal it. */
(function () {
  'use strict';

  // Pure helpers — exercised by features/rules-selftest.js.
  function cleanText(content) {
    return String(content || '').split('\n').map(function (s) { return s.replace(/^L\d+:\s*/, '').trim(); })
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }
  // The corpus often opens a section's content with its own title; the card already shows it.
  function snippet(text, max, title) {
    var t = cleanText(text), h = cleanText(title);
    if (h && t.indexOf(h) === 0) t = t.slice(h.length).trim();
    if (t.length <= max) return { text: t, cut: false };
    return { text: t.slice(0, max).replace(/\s+\S*$/, '') + '…', cut: true };
  }
  // href → { path, anchor } relative to the page origin.
  function parseXref(href, base) {
    var u = new URL(href, base), a = '';
    try { a = decodeURIComponent(u.hash.slice(1)); } catch (e) { a = u.hash.slice(1); }
    return { path: u.pathname, anchor: a };
  }
  // Card below the link, flipped above when it would run off the bottom, clamped on
  // both axes; transform-origin on the link so the scale grows out of the citation.
  function place(r, w, h, vw, vh) {
    var gap = 8, pad = 12, top = r.bottom + gap, flip = false;
    if (top + h > vh - pad && r.top - gap - h >= pad) { top = r.top - gap - h; flip = true; }
    top = Math.max(pad, Math.min(top, vh - pad - h));
    var left = Math.max(pad, Math.min(r.left, vw - pad - w));
    var ox = Math.round(Math.max(0, Math.min(w, r.left + r.width / 2 - left)));
    return { top: Math.round(top), left: Math.round(left), flip: flip, origin: ox + 'px ' + (flip ? '100%' : '0') };
  }
  if (typeof module === 'object' && module.exports) module.exports.xref = { cleanText: cleanText, snippet: snippet, parseXref: parseXref, place: place };

  if (typeof document === 'undefined' || !window.matchMedia) return;
  if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if (!document.querySelector('main a.xref')) return;

  var MAX = 320, card = null, cur = null, showT = 0, hideT = 0, docs = {};

  function el() {
    if (card) return card;
    card = document.createElement('div');
    card.id = 'pxref';
    card.className = 'pxref';
    card.setAttribute('role', 'tooltip');
    card.innerHTML = '<div class="pxref-title"></div><div class="pxref-body"></div>' +
      '<div class="pxref-foot"><a class="pxref-more" tabindex="-1">Read full section →</a>' +
      '<span class="pxref-note">AcqVault copy — verify at source</span></div>';
    card.addEventListener('mouseenter', function () { clearTimeout(hideT); });
    card.addEventListener('mouseleave', hideSoon);
    document.body.appendChild(card);
    return card;
  }

  function sameSection(anchor) {
    var sec = document.getElementById(anchor);
    if (!sec) return null;
    var h = sec.querySelector('.sec-hd h2') || sec.querySelector('h2');
    var ps = sec.querySelectorAll(':scope > p:not(.srcref)');
    var text = Array.prototype.map.call(ps, function (p) { return p.textContent; }).join('\n');
    return { title: h ? h.textContent.trim() : '', content: text };
  }

  function render(a, d) {
    if (a !== cur || !d) return;
    var c = el(), s = snippet(d.content, MAX, d.title);
    if (!d.title && !s.text) return;
    c.querySelector('.pxref-title').textContent = d.title || '';
    c.querySelector('.pxref-body').textContent = s.text;
    var more = c.querySelector('.pxref-more');
    more.href = a.getAttribute('href');
    more.hidden = !s.cut;
    c.style.maxWidth = Math.min(380, window.innerWidth - 24) + 'px';
    c.classList.remove('show');
    // offsetWidth/Height are layout size — unaffected by the .97 scale, so the clamp is exact.
    var p = place(a.getBoundingClientRect(), c.offsetWidth, c.offsetHeight, window.innerWidth, window.innerHeight);
    c.style.top = p.top + 'px';
    c.style.left = p.left + 'px';
    c.style.transformOrigin = p.origin;
    void c.offsetWidth;   // commit the hidden state so the entry transitions from it
    c.classList.add('show');
    a.setAttribute('aria-describedby', 'pxref');
  }

  function show(a) {
    cur = a;
    var t = parseXref(a.getAttribute('href'), location.href);
    if (t.path === location.pathname) return render(a, sameSection(t.anchor));
    var id = a.getAttribute('data-doc');
    if (!id) return;
    if (docs[id]) return render(a, docs[id]);
    if (navigator.onLine === false) return;
    fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'document', id: id }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { docs[id] = d; render(a, d); } })
      .catch(function () {});
  }

  function dismiss() {
    if (cur) cur.removeAttribute('aria-describedby');
    cur = null;
    if (card) card.classList.remove('show');
  }
  function hide() { clearTimeout(showT); clearTimeout(hideT); dismiss(); }
  function hideSoon() { clearTimeout(showT); clearTimeout(hideT); hideT = setTimeout(hide, 150); }
  function arm(a) { clearTimeout(hideT); clearTimeout(showT); showT = setTimeout(function () { show(a); }, 120); }
  function xrefOf(e) { return e.target.closest && e.target.closest('main a.xref'); }

  document.addEventListener('mouseover', function (e) { var a = xrefOf(e); if (a && a !== cur) arm(a); else if (a) clearTimeout(hideT); });
  document.addEventListener('mouseout', function (e) { if (xrefOf(e)) hideSoon(); });
  document.addEventListener('focusin', function (e) { var a = xrefOf(e); if (a) arm(a); });
  document.addEventListener('focusout', function (e) { if (xrefOf(e)) hideSoon(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cur) hide(); });
  // Scrolling detaches the card from its link. Timers survive: Tab scrolls the next link
  // into view right after focusin armed it, and that preview should still arrive.
  window.addEventListener('scroll', function () { if (card && card.classList.contains('show')) dismiss(); }, { passive: true });
  window.addEventListener('resize', function () { if (cur) hide(); });
})();
