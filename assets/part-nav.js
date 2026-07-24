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
  }
})();
