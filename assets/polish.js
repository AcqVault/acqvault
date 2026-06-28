/* ══ Newcomer "new to the RFO?" strip — stay dismissed once closed ══ */
(function () {
  try {
    if (localStorage.getItem('acqvault_newhere_dismissed')) {
      var e = document.getElementById('hero-newhere');
      if (e) e.style.display = 'none';
    }
  } catch (x) {}
})();

/* ══ POLISH — ⌘K shortcut ════════════════════════════════════ */
(function () {
  const input = document.getElementById('search-input');
  if (!input) return;
  const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform || '');
  const metaKbd = document.getElementById('kbd-meta');
  if (metaKbd && !isMac) metaKbd.textContent = 'Ctrl';
  function focusSearch() {
    if (document.body.classList.contains('reader-mode')) {
      const r = document.getElementById('reader-search-input');
      if (r) { r.focus(); r.select(); return; }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    input.focus({ preventScroll: true });
    input.select();
  }
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); focusSearch(); return; }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault(); focusSearch();
    }
  });
})();

/* ══ KINETIC LIGHT — example-query chips ═════════════════════
   Fills the real #search-input with an example and triggers the
   existing search pipeline (input event → debounced runSearch). */
window.runExampleQuery = function (q) {
  var input = document.getElementById('search-input');
  if (!input) return;
  if (typeof setMode === 'function') { try { setMode('search'); } catch (e) {} }
  input.value = q;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
};

/* ══ KINETIC LIGHT — typewriter placeholder ══════════════════
   Cycles example queries through the hero search placeholder.
   Only runs while the field is empty AND unfocused, so it never
   interferes with typing. Stilled under reduced-motion. */
(function () {
  const input = document.getElementById('search-input');
  if (!input) return;
  const STATIC = input.getAttribute('placeholder') || 'Search regulations, parts, guidance…';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const PHRASES = [
    'commercial item determination threshold',
    'micro-purchase threshold',
    'R-DFARS 252.204 class deviation',
    'sole source justification',
    'commercial solutions opening',
    'simplified acquisition procedures',
    'other than full and open competition'
  ];
  const PREFIX = 'Try: ';
  let pi = 0, ci = 0, deleting = false, timer = null, running = false;

  function idle() { return document.activeElement !== input && !input.value; }

  function step() {
    if (!idle()) { stop(); return; }
    const phrase = PHRASES[pi];
    if (!deleting) {
      ci++;
      input.placeholder = PREFIX + phrase.slice(0, ci);
      if (ci >= phrase.length) { deleting = true; timer = setTimeout(step, 2000); return; }
      timer = setTimeout(step, 55);
    } else {
      ci--;
      input.placeholder = PREFIX + phrase.slice(0, ci);
      if (ci <= 0) { deleting = false; pi = (pi + 1) % PHRASES.length; timer = setTimeout(step, 420); return; }
      timer = setTimeout(step, 28);
    }
  }
  function start() {
    if (running || !idle()) return;
    running = true; ci = 0; deleting = false;
    timer = setTimeout(step, 600);
  }
  function stop() {
    running = false;
    if (timer) { clearTimeout(timer); timer = null; }
    input.placeholder = STATIC;
  }
  input.addEventListener('focus', stop);
  input.addEventListener('input', stop);
  input.addEventListener('blur', () => { setTimeout(() => { if (idle()) start(); }, 400); });
  // Kick off after the hero settles
  setTimeout(start, 1400);
})();

/* ══ PART SEARCH — filter sections within Browse view ════════ */
(function () {
  // Initialise whenever a part finishes rendering
  const SEARCH_ID  = 'br-part-search-input';
  const CLEAR_ID   = 'br-part-search-clear';
  const COUNT_ID   = 'br-part-search-count';
  const NAV_ID     = 'br-part-search-nav';
  const PREV_ID    = 'br-part-search-prev';
  const NEXT_ID    = 'br-part-search-next';
  const READER_ID  = 'browse-reader-inner';

  let attached = false;
  let activeIndex = -1;
  let marks = [];
  let compactTarget = null;
  let compactAnchorY = 0;
  let compactScrollBound = false;

  function updateCompactState() {
    if (!compactTarget) return;
    const hasQuery = !!document.getElementById(SEARCH_ID)?.value.trim();
    const hasScrolledPastSearch = window.scrollY > compactAnchorY + 12;
    const sourceBar = document.querySelector('.browse-source-bar');
    if (sourceBar) {
      const sourceBottom = sourceBar.getBoundingClientRect().bottom;
      compactTarget.style.setProperty('--part-search-fixed-top', `${Math.max(10, sourceBottom + 10)}px`);
    }
    compactTarget.classList.toggle('compact', hasQuery && hasScrolledPastSearch);
  }

  function attach() {
    const inp   = document.getElementById(SEARCH_ID);
    const bar   = document.getElementById('br-part-search');
    const clr   = document.getElementById(CLEAR_ID);
    const count = document.getElementById(COUNT_ID);
    const nav   = document.getElementById(NAV_ID);
    const prev  = document.getElementById(PREV_ID);
    const next  = document.getElementById(NEXT_ID);
    if (!inp || attached) return;
    attached = true;
    compactTarget = bar;
    compactAnchorY = bar ? bar.getBoundingClientRect().top + window.scrollY : 0;
    if (!compactScrollBound) {
      compactScrollBound = true;
      window.addEventListener('scroll', updateCompactState, { passive: true });
      window.addEventListener('resize', () => {
        if (compactTarget) compactAnchorY = compactTarget.getBoundingClientRect().top + window.scrollY;
        updateCompactState();
      }, { passive: true });
    }

    inp.addEventListener('input', () => { filter(inp.value); clr.classList.toggle('visible', !!inp.value); updateCompactState(); });
    clr.addEventListener('click', () => { inp.value = ''; filter(''); clr.classList.remove('visible'); inp.focus(); updateCompactState(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (marks.length) activate(e.shiftKey ? activeIndex - 1 : activeIndex + 1);
      }
    });
    if (prev) prev.addEventListener('click', () => { activate(activeIndex - 1); inp.focus(); });
    if (next) next.addEventListener('click', () => { activate(activeIndex + 1); inp.focus(); });

    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function clearMarks(reader) {
      reader.querySelectorAll('.br-part-mark').forEach(mark => {
        mark.replaceWith(document.createTextNode(mark.textContent || ''));
      });
      reader.normalize();
      marks = [];
      activeIndex = -1;
    }

    function highlightNode(node, regex) {
      const text = node.nodeValue;
      regex.lastIndex = 0;
      if (!text || !regex.test(text)) return 0;
      regex.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let count = 0;
      text.replace(regex, (match, offset) => {
        if (offset > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
        const mark = document.createElement('mark');
        mark.className = 'br-part-mark';
        mark.textContent = match;
        frag.appendChild(mark);
        marks.push(mark);
        count++;
        lastIndex = offset + match.length;
        return match;
      });
      if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      node.replaceWith(frag);
      return count;
    }

    function highlightSection(section, regex) {
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest('button,input,textarea,select,script,style,mark')) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      return nodes.reduce((total, node) => total + highlightNode(node, regex), 0);
    }

    function updateNav() {
      const hasMatches = marks.length > 0;
      if (nav) nav.classList.toggle('visible', hasMatches);
      if (prev) prev.disabled = !hasMatches;
      if (next) next.disabled = !hasMatches;
      if (count) {
        if (!inp.value.trim()) count.textContent = '';
        else if (!hasMatches) count.textContent = 'No matches';
        else if (activeIndex >= 0) count.textContent = `${activeIndex + 1} of ${marks.length}`;
        else count.textContent = `${marks.length} match${marks.length !== 1 ? 'es' : ''}`;
      }
    }

    function activate(index) {
      if (!marks.length) return;
      activeIndex = (index + marks.length) % marks.length;
      marks.forEach(mark => mark.classList.remove('active'));
      const current = marks[activeIndex];
      current.classList.add('active');
      if (count) count.textContent = `${activeIndex + 1} of ${marks.length}`;
      updateCompactState();
      current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function filter(q) {
      const reader = document.getElementById(READER_ID);
      if (!reader) return;
      clearMarks(reader);
      const sections = Array.from(reader.querySelectorAll('.br-section'));
      const noMatch  = reader.querySelector('.br-no-match');
      if (noMatch) noMatch.remove();
      sections.forEach(s => { s.classList.remove('ps-hidden', 'ps-match'); });

      if (!q.trim()) {
        updateNav();
        return;
      }

      const term = q.trim();
      const regex = new RegExp(escapeRegExp(term), 'gi');
      sections.forEach(s => {
        const sectionMatches = highlightSection(s, regex);
        if (sectionMatches) {
          s.classList.add('ps-match');
        }
      });

      updateNav();
      updateCompactState();
    }
  }

  // Watch for part loads by observing DOM changes on the reader container
  const observer = new MutationObserver(() => {
    attached = false; // reset so we can re-attach each time a new part loads
    const inp = document.getElementById(SEARCH_ID);
    if (inp) { attach(); }
  });

  function startObserving() {
    const reader = document.getElementById(READER_ID);
    if (reader) observer.observe(reader, { childList: true, subtree: false });
  }
  startObserving();
  // Also re-check on first render in case reader exists immediately
  attach();
})();
