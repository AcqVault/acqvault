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
    // Module-scope state survives a part re-render, so Enter in the fresh, empty search box
    // used to jump using the PREVIOUS part's match list.
    marks = []; activeIndex = -1;
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

    var searchDebounce;
    inp.addEventListener('input', () => {
      clr.classList.toggle('visible', !!inp.value);
      updateCompactState();
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => filter(inp.value), 160);  // mirror part-nav.js — don't re-highlight the whole reader on every keystroke
    });
    clr.addEventListener('click', () => { inp.value = ''; filter(''); clr.classList.remove('visible'); inp.focus(); updateCompactState(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!inp.value.trim()) return;                 // nothing typed: no stale jump
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
      var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      current.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
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

/* ══ RETURNING VISITOR — since-last-visit marker + personal study strip ══
   Read-only views of state already on this device. New visitors see the page unchanged:
   a first visit records what exists and shows nothing. Offline → fail silent. */
var AcqPersonal = (function () {
  /* ---- study (mirrors assets/study.js — keep in step if those change) ---- */
  function today(now) { return Math.floor((now == null ? Date.now() : now) / 86400000); } // study.js today(): UTC day
  // Seen cards only: unseen cards are box 0 and live in the 1.3 MB deck, which the home page never loads.
  function dueReviews(S, t) {
    var n = 0, c = (S && S.cards) || {};
    for (var k in c) { var x = c[k]; if (x && x.box > 0 && x.due <= t) n++; }
    return n;
  }
  function streakRun(S, t) {   // study.js streakRun(), plus viewHome's comeback rule (gap ≥ 5 and ≥ 10 waiting → no counter)
    var st = S && S.streak;
    if (!st || !st.run) return 0;
    if (st.last && t - st.last >= 5 && dueReviews(S, t) >= 10) return 0;
    return st.last >= t - 1 ? st.run : 0;
  }
  function resumeLabel(S) {    // what /study's resumeSession() would reopen on public /study, or ''
    var r = S && S.resume;
    if (!r || typeof r !== 'object') return '';
    var org = typeof r.org === 'boolean' ? r.org : (r.mode === 'ladder' || r.mode === 'ladderBoard');
    if (org) return '';
    if (['ladder', 'ladderBoard', 'governs', 'sprint'].indexOf(r.mode) < 0 && !S.track) return '';
    if (/^(recall|sprint|ladder)$/.test(r.mode) && Array.isArray(r.ids) && r.i >= r.ids.length) return '';
    if (r.mode === 'lesson') return 'your lesson';
    if (r.mode === 'governs') return 'Which Part Governs';
    return r.label ? String(r.label) : 'your session';
  }
  // The Combination flips at 5 a.m. America/Chicago (study.js comboToday / tzOffsetMs).
  function tzOffsetMs(t) {
    try {
      var p = {}, f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, year: 'numeric',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      f.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
    } catch (e) { return -6 * 3600000; }
  }
  function comboToday(t) { t = t == null ? Date.now() : t; return Math.floor((t + tzOffsetMs(t) - 5 * 3600000) / 86400000); }
  function comboLine(S, now) {
    var c = S && S.games && S.games.combo;
    if (!c || c.day !== comboToday(now)) return '';
    var n = Array.isArray(c.rows) ? c.rows.length : 0;
    if (c.done) return c.win ? 'Solved today in ' + n : 'Today’s word: played';
    return n ? 'Today’s word: ' + n + ' of 6 tries' : '';
  }
  function studySummary(S, now) {
    if (!S || typeof S !== 'object') return null;
    var t = today(now), due = dueReviews(S, t), run = streakRun(S, t), res = resumeLabel(S);
    var seen = S.cards && Object.keys(S.cards).length;
    if (!seen && !run && !res) return null;   // nothing personal to say
    var parts = [];
    if (due) parts.push(due + ' review' + (due !== 1 ? 's' : '') + ' due');
    else if (seen) parts.push('All caught up');
    if (run >= 2) parts.push(run + '-day streak');   // /study shows the counter from 2 days
    return { parts: parts, resume: res };
  }

  /* ---- what changed since the last visit ---- */
  function runSlugger(runs) {  // api/_seo.js renderChangesPage runSlug(): same-day runs carry HHMM
    var dayCount = {};
    runs.forEach(function (r) { var d = String(r.run_at || '').slice(0, 10); dayCount[d] = (dayCount[d] || 0) + 1; });
    return function (iso) {
      var d = String(iso || '').slice(0, 10);
      return dayCount[d] > 1 ? d + '-' + String(iso).slice(11, 16).replace(':', '') : d;
    };
  }
  // runs/devs may be null (that fetch failed): that half is neither counted nor re-recorded.
  function changesSince(runs, devs, seen) {
    runs = Array.isArray(runs) ? runs : null; devs = Array.isArray(devs) ? devs : null;
    seen = seen && typeof seen === 'object' ? seen : {};
    var out = { sections: 0, devs: 0, anchor: '', next: { run: seen.run, dars: seen.dars } };
    if (runs) {
      var newest = 0, oldestNew = null, ids = {}, since = Date.parse(seen.run);
      runs.forEach(function (r) {
        var at = Date.parse(r.run_at); if (isNaN(at)) return;
        if (at > newest) newest = at;
        if (isNaN(since) || at <= since) return;
        if (!oldestNew || at < Date.parse(oldestNew.run_at)) oldestNew = r;
        var f = r.rfo || {};
        [].concat(f.added || [], f.modified || [], f.removed || []).forEach(function (s) { if (s && s.id) ids[s.id] = 1; });
      });
      out.sections = Object.keys(ids).length;
      if (oldestNew) out.anchor = 'run-' + runSlugger(runs)(oldestNew.run_at);
      if (newest) out.next.run = new Date(newest).toISOString().replace('.000Z', 'Z');
    }
    if (devs) {
      var all = devs.map(function (d) { return d && d.dars; }).filter(Boolean);
      if (Array.isArray(seen.dars)) out.devs = all.filter(function (x) { return seen.dars.indexOf(x) < 0; }).length;
      out.next.dars = all.concat(Array.isArray(seen.dars) ? seen.dars : []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    }
    return out;
  }
  function changesText(c) {
    var p = [];
    if (c.sections) p.push(c.sections + ' section' + (c.sections !== 1 ? 's' : ''));
    if (c.devs) p.push(c.devs + ' new deviation' + (c.devs !== 1 ? 's' : ''));
    return p.length ? p.join(' · ') + ' since your last visit' : '';
  }

  return { today: today, dueReviews: dueReviews, streakRun: streakRun, resumeLabel: resumeLabel, comboToday: comboToday,
    comboLine: comboLine, studySummary: studySummary, changesSince: changesSince, changesText: changesText };
})();

(function () {
  if (typeof document === 'undefined' || !document.getElementById('study')) return;
  var P = AcqPersonal;
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  /* Study strip + The Combination: personal only when acq-study-v1 exists. */
  var S = readJSON('acq-study-v1');
  var sum = P.studySummary(S), me = document.getElementById('study-me');
  if (sum && me) {
    me.textContent = sum.parts.join(' · ');
    if (sum.resume) {
      // /study reopens S.resume on boot (resumeSession), so the plain URL lands on the spot.
      var a = document.createElement('a');
      a.href = '/study'; a.className = 'study-me-resume';
      a.textContent = 'Resume ' + sum.resume + ' →';
      if (sum.parts.length) me.appendChild(document.createTextNode(' · '));
      me.appendChild(a);
    }
    if (me.textContent) me.hidden = false;
  }
  var combo = P.comboLine(S), cta = document.querySelector('#daily-strip .daily-cta');
  if (combo && cta) { cta.textContent = combo + (/^Solved|played/.test(combo) ? ' ✓' : ' →'); cta.classList.add('daily-cta-me'); }

  /* What Changed marker, inside the existing footer link. */
  var KEY = 'acq-seen-v1', link = document.getElementById('foot-changes');
  if (!link || typeof changeLedgerRuns === 'undefined') return;
  var devFetch = fetch('/output/deviations.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  Promise.all([changeLedgerRuns, devFetch]).then(function (got) {
    var seen = readJSON(KEY), c = P.changesSince(got[0], got[1], seen);
    function markSeen() { try { localStorage.setItem(KEY, JSON.stringify(c.next)); } catch (e) {} }
    if (!seen) { if (c.next.run || c.next.dars) markSeen(); return; }   // first visit: record, say nothing
    if (got[0] && !seen.run || got[1] && !seen.dars) {                  // half recorded last time: fill it quietly
      var fill = { run: seen.run || c.next.run, dars: seen.dars || c.next.dars };
      try { localStorage.setItem(KEY, JSON.stringify(fill)); } catch (e) {}
    }
    var text = P.changesText(c);
    if (!text) return;
    link.insertAdjacentHTML('beforeend', ' <span class="chg-since"><span class="chg-since-dot" aria-hidden="true"></span></span>');
    link.lastElementChild.appendChild(document.createTextNode(text));
    if (c.anchor) link.setAttribute('href', '/changes#' + c.anchor);
    // Any route to /changes from this page counts as having looked.
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (a && a.pathname === '/changes') { markSeen(); var m = link.querySelector('.chg-since'); if (m) m.remove(); }   // href left alone: the click is still navigating to the anchor
    }, true);
  });
})();
