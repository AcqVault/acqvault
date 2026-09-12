/* AcqVault Study — client-side drill engine. No accounts, no server state, no AI.
   Progress lives in localStorage ('acq-study-v1'); Export/Import moves it between browsers. */
(function () {
  'use strict';
  /* The shell writes these, content-hashed by assetV() — see DECK_ATTRS in api/_seo.js.
     The literals below are a fallback for a cached shell that predates the attributes;
     they are deliberately stale-proof, because a shell old enough to lack them is old
     enough that its deck is the one it shipped with. */
  var _app0 = document.getElementById('study-app');
  var DECK_URL = (_app0 && _app0.getAttribute('data-deck')) || '/assets/study-deck.json?v=43';
  var ELEMENTS_URL = (_app0 && _app0.getAttribute('data-elements')) || '/assets/study-elements.json?v=3';
  var ELEMENTS = null;
  var LS_KEY = 'acq-study-v1';
  var INTERVALS = [0, 1, 3, 7, 21]; // days until due, by box (box 1..5 → idx 0..4)
  var SESSION_CAP = 25;
  var HINT_COOLDOWN_MS = 4000; // hammering the hint button slows down — think between hints

  var deck = null;
  var S = load();
  /* Which page this engine booted on. The shell sets data-mode on #study-app: '48cons' is
     the unlisted 48 CONS page, anything else is public /study. The Warrant Ladder and
     its board sims render ONLY in '48cons' mode — same engine, same corpus-built deck, same
     progress key, so the ladder keeps tracking the corpus refresh instead of forking a copy
     that would silently rot. LADDER_ENABLED still kills it everywhere. */
  var MODE = 'study';
  function isOrg() { return MODE === '48cons'; }

  /* One sanitizer for BOTH ways state arrives — localStorage on boot and a file via Import.
     Every branch a view writes through must be object-shaped or absent: 'use strict' makes
     an assignment through a primitive (S.streak = "x" in an imported file, then st.run = 1)
     a TypeError, and the array branches feed .filter/.map directly. Older builds normalized
     4 branches in load() and 4 in doImport(); every branch added since crashed on import. */
  function normalize(s) {
    if (!s || typeof s !== 'object') s = {};
    ['cards', 'scen', 'sprint', 'games', 'daily', 'streak', 'intro', 'resume', 'bdNotes', 'ladderBoard', 'lessons'].forEach(function (k) {
      if (s[k] != null && typeof s[k] !== 'object') delete s[k];
    });
    ['ladderMiss', 'ladderBoardRough'].forEach(function (k) {
      if (s[k] != null && Object.prototype.toString.call(s[k]) !== '[object Array]') delete s[k];
    });
    if (!s.cards) s.cards = {};
    if (!s.lessons) s.lessons = {};
    if (!s.scen) s.scen = {};
    if (!s.games) s.games = {};
    if (!s.sprint) s.sprint = { best: 0 };
    if (s.track !== 'basic' && s.track !== 'advanced') s.track = null;
    // Board Sim scenario filter. A string, not an object, so it needs its own branch:
    // anything that is not one of the three known values is dropped rather than trusted.
    if (s.boardPick !== 'rough' && s.boardPick !== 'unseen') s.boardPick = 'any';
    if (!s.created) s.created = Date.now();
    return s;
  }
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
    return normalize(s);
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }
  function today() { return Math.floor(Date.now() / 86400000); }
  function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function el(id) { return document.getElementById(id); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---- history: back inside the tool steps back through the tool, not off the page ----
     depth 0 = track select · depth 1 = dashboard · depth 2 = an activity */
  var navDepth = 0, popping = false, pendingRender = null;
  function goDepth(depth, renderFn) {
    if (!popping) {
      if (depth < navDepth) {
        // Real entries exist between here and the target — pop them instead of pushing a
        // fresh one on top. Pushing (the old behavior) grew the stack on every trip home,
        // so leaving the page cost one Back press per activity ever opened this visit.
        pendingRender = renderFn;
        history.go(depth - navDepth); // popstate fires async, renders pendingRender
        return;
      }
      if (depth === navDepth) history.replaceState({ st: depth }, '');
      else for (var d = navDepth + 1; d <= depth; d++) history.pushState({ st: d }, '');
      navDepth = depth;
    }
    renderFn();
  }
  // Games and track-dashboards both live at history depth 1 now (games moved up from the
  // old hub level so they sit right on the main page). depth1View remembers which one to
  // re-render on a back/forward pop.
  var depth1View = null;
  /* Which view is "home" depends on WHICH PAGE the engine booted on. /48cons has no track
     picker and no dashboard, so every generic exit — popstate, backHome, a resumed session —
     must resolve through here. Without it, stepping back out of the ladder on the org page
     painted /study's track picker ("Pick your depth") straight over it, taking the rungs and
     the Introduction Builder with it. Declaration is hoisted for the listener below. */
  function homeFn() { return isOrg() ? view48Cons : viewHome; }
  function topFn() { return isOrg() ? view48Cons : viewTrack; }
  window.addEventListener('popstate', function (e) {
    var d = (e.state && typeof e.state.st === 'number') ? e.state.st : 0;
    navDepth = d; popping = true; keyHandler(null);
    // Stepping back out of a board sim ends its recording (declaration is hoisted).
    recRelease();
    if (!deck) { popping = false; pendingRender = null; return; }
    var r = pendingRender; pendingRender = null;
    if (r) r(); // a goDepth() that popped its way down renders its own target view
    else if (d === 2 && e.state && e.state.lesson) viewLesson(e.state.lesson);
    else if (d <= 0) topFn()(); else (depth1View || homeFn())();
    popping = false;
  });

  /* ---- deck accessors ---- */
  function recallPool() {
    if (S.track === 'basic') return deck.recall_basic;
    return deck.recall_basic.concat(deck.recall_advanced, deck.thresholds.map(function (t) {
      /* keep d/x/ref so threshold cards stay MCQ with their debriefs outside the Sprint,
         and keep LINKS: dropping them meant 40 cards showed "where it lives" as dead text
         while every other card in the tool carried a link to the governing section. The
         whole claim this site makes is that the cite is one click away.
         `kind` survives the remap so a renderer can tell a figure from a narrative —
         `type` has to stay 'recall' because the scheduler and the session code key on it. */
      return { id: t.id, type: 'recall', kind: 'threshold', topic: threshTopic(t),
        q: t.q, a: t.a, d: t.d, x: t.x, ref: t.ref, links: t.links };
    }));
  }
  function cardState(id) { return S.cards[id] || { box: 0, due: 0, lapses: 0 }; }
  /* The element checklist. A self-grade is a judgment made one second after the answer
     appears, at peak fluency, and learners' own predictions of later performance are
     essentially uncorrelated with it. Giving them an explicit standard to grade against
     measurably improves calibration, and helps the weakest performers most. Element 1 is
     the core one; the rest are supporting. Ticking is never scored - on a bare threshold
     card a complete answer ticks a single box, and that must not read as a failure. */
  function elementsFor(id) {
    var e = ELEMENTS && ELEMENTS.elements && ELEMENTS.elements[id];
    return (e && e.length) ? e : null;
  }
  function checklistHtml(id) {
    var els = elementsFor(id);
    if (!els) return '';
    return '<div class="st-check" id="st-check"><div class="st-check-h">Did you say these? Grade against this, ' +
      'not against how familiar it felt</div><ul class="st-check-list">' +
      els.map(function (t, i) {
        return '<li><button type="button" class="st-check-item' + (i === 0 ? ' st-check-core' : '') +
          '" aria-pressed="false"><span class="st-check-box" aria-hidden="true"></span>' +
          '<span>' + esc(t) + (i === 0 ? ' <i class="st-check-tag">core</i>' : '') + '</span></button></li>';
      }).join('') + '</ul></div>';
  }
  function wireChecklist() {
    Array.prototype.forEach.call(app.querySelectorAll('.st-check-item'), function (b) {
      b.onclick = function () {
        var on = b.getAttribute('aria-pressed') === 'true';
        b.setAttribute('aria-pressed', on ? 'false' : 'true');
        b.classList.toggle('is-on', !on);
      };
    });
  }

  function isDue(id) { var c = cardState(id); return c.box === 0 || c.due <= today(); }
  /* Per-day Daily Review record, so finishing a session is an end state the tool acknowledges
     instead of a number that barely moved. Resets itself on the first read of a new day. */
  function dailyState() {
    var t = today();
    if (!S.daily || S.daily.day !== t) S.daily = { day: t, done: 0, sessions: 0 };
    return S.daily;
  }
  function noteDailyDone(n) {
    if (!n) return;                 // quitting before answering anything isn't a session
    var d = dailyState();
    d.done += n; d.sessions++;
    save();
  }
  function bumpStreak() { // consecutive days with at least one graded card
    var t = today(), st = S.streak || { last: 0, run: 0 };
    if (st.last === t) return;
    st.run = (st.last === t - 1) ? st.run + 1 : 1;
    st.last = t;
    S.streak = st;
  }
  function streakRun() {
    var st = S.streak;
    if (!st || !st.run) return 0;
    return (st.last >= today() - 1) ? st.run : 0; // a missed day quietly resets
  }
  function grade(id, g) { // g: 1 missed, 2 shaky, 3 got it
    var c = cardState(id);
    if (g === 1) { c.box = 1; c.lapses++; }
    else if (g === 2) { c.box = Math.max(1, c.box); }
    else { c.box = Math.min(5, Math.max(1, c.box) + 1); }
    c.due = today() + INTERVALS[c.box - 1];
    S.cards[id] = c; bumpStreak(); save();
  }
  function topicsFor(pool) {
    var map = {};
    pool.forEach(function (c) { var t = c.topic || 'General'; (map[t] = map[t] || []).push(c); });
    return map;
  }
  function mastery(cards) {
    if (!cards.length) return 0;
    var sum = 0; cards.forEach(function (c) { sum += cardState(c.id).box / 5; });
    return Math.round(100 * sum / cards.length);
  }
  function mcqOptions(card) {
    // Multiple choice ONLY from hand-authored distractors (card.d, built into the deck).
    // The old fallback — random same-topic answers — produced giveaway options (an answer
    // about fiscal law as a "distractor" on an authority question), so it's gone: a card
    // without authored distractors renders produce-then-reveal instead. Long board-probe
    // narratives are deliberately in that group.
    if (!card.d || card.d.length < 3) return null;
    return shuffle([card.a, card.d[0], card.d[1], card.d[2]]);
  }
  /* Produce first; the options are a costed escape hatch.
     A promotion board hands you nothing to choose from, so picking the right string out
     of four is not the skill being trained — producing it is. Every card now OPENS as a
     blank card. Where authored distractors exist they stay one keystroke away, and
     taking them holds that card at Shaky however clean the pick: you recognised the
     answer, you did not produce it. Nothing was removed — the multiple choice the owner
     asked for is still there, it just costs something now. Threshold Sprint is
     deliberately exempt: it is a timed recognition game in the Practice Range, not
     a learning loop. */
  function produceFirstCard(o) {
    var c = o.card, opts = o.opts;
    render(o.head +
      '<div class="st-card" aria-live="polite">' +
      '<div class="st-chip">' + esc(c.topic || 'General') + '</div>' +
      '<div class="st-q">' + esc(c.q) + '</div>' +
      '<div id="st-a" class="st-a" hidden>' + esc(c.a) + explainHtml(c, null) + '</div>' +
      '<div class="st-produce-hint" id="st-hint">Answer it out loud, then check yourself.</div>' +
      '<div class="st-actions" id="st-act">' +
      '<button class="st-btn st-btn-reveal" id="st-reveal">Reveal <kbd>space</kbd></button>' +
      (opts ? '<button class="st-btn st-btn-opts" id="st-opts-btn">Show me the options <kbd>o</kbd></button>' : '') +
      '</div></div>' +
      '<button class="st-link st-quit" id="st-quit">' + o.quitText + '</button>');
    el('st-quit').onclick = o.onQuit;
    function dropHint() { var h = el('st-hint'); if (h && h.parentNode) h.parentNode.removeChild(h); }

    function selfGrade() {
      dropHint();
      el('st-a').hidden = false;
      // Self-explanation is the best-evidenced thing that can be added here for the
      // price of one line of copy: a meta-analysis of 64 reports puts prompting a
      // learner to explain at g = 0.55, ahead of the entire case for answering aloud,
      // and it needs no microphone and no permission. Open-ended on purpose — reading
      // our explanation is not a substitute for producing your own first.
      var card0 = app.querySelector('.st-card');
      if (card0 && !el('st-why')) {
        var why = document.createElement('div');
        why.className = 'st-why'; why.id = 'st-why';
        why.innerHTML = 'Before you grade &mdash; say <b>why</b>. Not the answer, the reason it is the answer.';
        el('st-a').insertAdjacentElement('afterend', why);
      }
      el('st-act').innerHTML =
        '<button class="st-btn st-g1" id="g1">Missed <kbd>1</kbd></button>' +
        (o.showShaky ? '<button class="st-btn st-g2" id="g2">Shaky <kbd>2</kbd></button>' : '') +
        '<button class="st-btn st-g3" id="g3">Got it <kbd>3</kbd></button>';
      el('g1').onclick = function () { o.onGrade(1); };
      if (o.showShaky) el('g2').onclick = function () { o.onGrade(2); };
      el('g3').onclick = function () { o.onGrade(3); };
      var chk = checklistHtml(c.id);
      if (chk && !el('st-check')) { el('st-a').insertAdjacentHTML('afterend', chk); wireChecklist(); }
      // Revealing replaces the action row in place, which blurs whatever held focus and
      // drops it to <body>. Hand focus to the card — never to a grade button, which would
      // both swallow the number-key shortcuts and pre-select the destructive default.
      var c0 = app.querySelector('.st-card');
      if (c0) { c0.setAttribute('tabindex', '-1');
                try { c0.focus({ preventScroll: true }); } catch (e) { c0.focus(); } }
      keyHandler(function (k) {
        if (k === '1') { o.onGrade(1); return true; }
        if (k === '2' && o.showShaky) { o.onGrade(2); return true; }
        if (k === '3' || (!o.showShaky && k === ' ')) { o.onGrade(3); return true; }
      });
    }

    function showOptions() {
      dropHint();
      var card = app.querySelector('.st-card');
      var ans = el('st-a'); if (ans && ans.parentNode) ans.parentNode.removeChild(ans);
      el('st-act').outerHTML = '<div class="st-opts">' + opts.map(function (opt, k) {
        return '<button class="st-opt" data-k="' + k + '"><kbd>' + (k + 1) + '</kbd><span>' + esc(opt) + '</span></button>';
      }).join('') + '</div>';
      var answered = false;
      function pick(k) {
        if (answered) return; answered = true;
        var right = opts[k] === c.a;
        Array.prototype.forEach.call(app.querySelectorAll('.st-opt'), function (b) {
          var bk = +b.getAttribute('data-k'), kb = b.querySelector('kbd');
          if (opts[bk] === c.a) { b.classList.add('st-opt-right'); if (kb) kb.textContent = '✓'; }
          else if (bk === k) { b.classList.add('st-opt-wrong'); if (kb) kb.textContent = '✗'; }
          b.disabled = true;
        });
        appendExplain(c, right);
        if (right) card.insertAdjacentHTML('beforeend',
          '<div class="st-capped">Recognised with the options up — held at <b>Shaky</b>, so it comes back sooner. A board offers no choices.</div>');
        var g = right ? 2 : 1;
        var act = document.createElement('div'); act.className = 'st-actions';
        act.innerHTML = '<button class="st-btn st-btn-reveal" id="st-next">' + (right ? 'Next' : 'Got it — next') + ' <kbd>space</kbd></button>';
        card.appendChild(act);
        el('st-next').onclick = function () { o.onGrade(g); };
        el('st-next').focus();   // answering disables the picked option, blurring it
        keyHandler(function (key) { if (key === ' ' || key === 'Enter') { o.onGrade(g); return true; } });
      }
      Array.prototype.forEach.call(app.querySelectorAll('.st-opt'), function (b) {
        b.onclick = function () { pick(+b.getAttribute('data-k')); };
      });
      keyHandler(function (k) {
        var n = parseInt(k, 10);
        if (n >= 1 && n <= opts.length) { pick(n - 1); return true; }
      });
    }

    el('st-reveal').onclick = selfGrade;
    if (opts) el('st-opts-btn').onclick = showOptions;
    keyHandler(function (k) {
      if (k === ' ' || k === 'Enter') { selfGrade(); return true; }
      if (opts && (k === 'o' || k === 'O')) { showOptions(); return true; }
    });
  }
  // Post-answer debrief: the rule, the trap, and where the reference lives — with the
  // rulebook itself one click away (links resolved into the deck at build time).
  // right === true/false → verdict line (MCQ); right === null → no verdict (reveal cards).
  var RIGHT_LINES = ['✓ Right', '✓ Clean', '✓ Locked in', '✓ That’s the rule', '✓ Board-ready'];
  /* Same-tab, and without the little diagonal arrow that promised a new one. These opened in
     a new tab only because losing your place was worse than the tab clutter; now that every
     mode restores where you were, that trade is gone and so is the exception. */
  function citesHtml(links) {
    if (!links || !links.length) return '';
    return '<div class="st-cites"><span class="st-cites-lab">Described in</span>' +
      links.map(function (l) {
        return '<a class="st-cite" href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.t) + '</a>';
      }).join('') + '</div>';
  }
  function explainHtml(card, right) {
    if (!card.x && !card.ref && !(card.links && card.links.length)) return '';
    var v = '';
    if (right === true) v = '<div class="st-verdict st-verdict-right">' + RIGHT_LINES[Math.floor(Math.random() * RIGHT_LINES.length)] + '</div>';
    else if (right === false) v = '<div class="st-verdict st-verdict-wrong">✗ Not quite — the correct answer is highlighted above</div>';
    return '<div class="st-explain">' + v +
      (card.x ? '<p>' + esc(card.x) + '</p>' : '') +
      (card.ref ? '<div class="st-explain-ref">Where it lives: <b>' + esc(card.ref) + '</b></div>' : '') +
      citesHtml(card.links) +
      '</div>';
  }
  function appendExplain(card, right) {
    var html = explainHtml(card, right);
    if (!html) return;
    var host = app.querySelector('.st-card');
    if (!host) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    host.appendChild(wrap.firstChild);
  }

  /* ---- views ---- */
  var app, rendered = false;
  function render(html) {
    app.innerHTML = html;
    // The marketing hero persists through every card, every phase and every result.
    // Measured at 375x812: entering a session put the question at y=869 and Reveal at
    // y=954 — the entire first screen of a study session contained no study content.
    // Collapse it the moment the app is in a working state, restore it on the menus.
    try {
      var working = (/class="st-session-head"/.test(html) && /class="st-q"/.test(html))
        || /id="gv-card"/.test(html);
      document.documentElement.classList.toggle('st-working',
        working && !/st-summary/.test(html));
      // st-to-course appears only in viewHome, which is inside the course as well.
      var rise = /rz-cover|rz-lesson-shell|st-to-course|rz-sim|rz-home/.test(html);
      document.documentElement.classList.toggle('st-rise', rise);
      /* Hiding the marketing hero and widening the shell were one class, and /48cons
         needs them apart. Its cover collapses the hero, but its interior views are not
         rz- views, so entering a ceiling popped the hero and its second <h1> back onto
         a page you are working in — the exact thing .st-rise exists to prevent. The
         interiors still want the 880px reading measure they were built for, so only the
         hero half follows org mode. */
      document.documentElement.classList.toggle('st-hero-off', rise || isOrg());
      /* The stage stepper is overflow-x:auto, so a long sequence simply scrolls — and the
         step you are ON can sit outside the visible run with nothing saying so. Seven
         stages (the ladder's sim adds a saved record) overflow at 1084px, and /study
         overflows too once a scenario carries enough follow-ups. Scroll the container,
         never the element: scrollIntoView() would also move the page vertically and
         undo the anchoring done a few lines below. */
      var steps = app.querySelector('.rz-steps');
      var now = steps && steps.querySelector('[aria-current="step"]');
      if (steps && now && steps.scrollWidth > steps.clientWidth) {
        var want = now.offsetLeft - (steps.clientWidth - now.offsetWidth) / 2;
        steps.scrollLeft = Math.max(0, Math.min(want, steps.scrollWidth - steps.clientWidth));
      }
      document.documentElement.classList.toggle('st-lesson', /rz-lesson-shell/.test(html));
      document.documentElement.classList.toggle('st-sim', /class="rz-sim"/.test(html));
    } catch (e) { /* styling only; never break a render */ }
    // Anchor each new view just below the top of the drill container so every card
    // lands in the same readable spot. NB: app.offsetTop is relative to the
    // position:relative .st-wrap (~its padding), NOT the page — using it scrolled
    // to y≈0 (the hero) on every question advance. Use the document-absolute top.
    // Skip the very first paint so a cold page load stays on the hero instead of
    // auto-scrolling past it.
    if (!rendered) { rendered = true; return; }
    var y = Math.max(0, app.getBoundingClientRect().top + window.scrollY - 20);
    if (Math.abs(y - window.scrollY) > 2) window.scrollTo({ top: y, behavior: 'instant' });
    // Move focus into the new view (skipping the first paint, like the scroll above) so a
    // keyboard user isn't dropped on <body> and a screen reader announces the new card.
    try { app.focus({ preventScroll: true }); } catch (e) { try { app.focus(); } catch (e2) {} }
  }

  var VAULT_GLYPH = '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#cdb277" stroke-width="2"><circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="10"/></g><g stroke="#cdb277" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="27" x2="50" y2="38"/><line x1="50" y1="73" x2="50" y2="62"/><line x1="27" y1="50" x2="38" y2="50"/><line x1="73" y1="50" x2="62" y2="50"/></g><circle cx="50" cy="50" r="3.6" fill="#cdb277"/></svg>';
  function viewTrack() {
    var last = S.track;
    function cardHtml(id, kicker, name, blurb, active, vol) {
      // The continue badge lives IN the flow, first line of the body. It used to be
      // position:absolute over the top-right corner, where it sat on the kicker text at
      // every width — an overlay can only be collision-free at widths somebody checked.
      return '<button class="st-trackcard' + (active ? ' st-trackcard-active' : '') + '" id="' + id + '">' +
        '<span class="st-tcover" aria-hidden="true">' + VAULT_GLYPH + '<span class="st-tcover-vol">' + vol + '</span></span>' +
        '<span class="st-tc-body">' +
        (active ? '<span class="st-tc-continue">Continue — you were here</span>' : '') +
        '<span class="st-tc-kicker">' + kicker + '</span><b>' + name + '</b><p>' + blurb + '</p></span></button>';
    }
    render(
      '<p class="st-intro"><b>Learn</b> the whole domain as a course, then <b>practice by deciding</b> in the simulators.</p>' +
      '<h2 class="st-h2" style="margin-top:2px">Courses</h2>' +
      '<p class="st-sub">Two courses, walked lesson by lesson. Progress saves per lesson and per card, and you can switch between them any time without losing it.</p>' +
      '<div class="st-tracks">' +
      cardHtml('t-basic', 'Course 1 · start here if contracting is new', 'Basic',
        'Field Guide Vol. 1 as a 15-lesson course — the players, the money, the methods. Every lesson ends in a knowledge check.', last === 'basic', 'VOL I') +
      cardHtml('t-adv', 'Course 2 · the full board-prep course', 'Advanced',
        'All 15 Basic lessons plus 29 more from Vol. 2 — 44 lessons at board-probe level, each ending in its own knowledge check.', last === 'advanced', 'VOL I·II') +
      '</div>' +
      gamesSectionHtml());
    el('t-basic').onclick = function () { S.track = 'basic'; depth1View = viewCourse; save(); goDepth(1, viewCourse); };
    el('t-adv').onclick = function () { S.track = 'advanced'; depth1View = viewCourse; save(); goDepth(1, viewCourse); };
    wireGamesSection();
  }

  /* Coming back after a gap is where warrant prep actually dies, and it is the moment
     this tool handled worst: a fortnight away produced a bigger pile and a streak reset
     to zero. The largest field experiment on habitual return (61,293 people, 54
     programmes) found the single best-performing intervention rewarded the COMEBACK
     after a missed session — the empirical inverse of a streak. And Anki's own manual
     calls an unbounded backlog a hazard and says to stop introducing new cards until it
     is cleared. So: a lapse is named and welcomed, not scored, and while there is a real
     backlog of cards you have SEEN, unseen cards wait their turn. */
  var COMEBACK_GAP = 5;      // days away before the return is worth naming
  var COMEBACK_BACKLOG = 10; // and enough waiting for suppression to matter
  function lapseDays() {
    var st = S.streak;
    if (!st || !st.last) return 0;
    var d = today() - st.last;
    return d > 0 ? d : 0;
  }

  function viewHome() {
    if (!S.track) return viewTrack();
    depth1View = viewHome;
    var pool = recallPool();
    var dueAll = pool.filter(function (c) { return isDue(c.id); });
    var seenDue = dueAll.filter(function (c) { return cardState(c.id).box > 0; });
    var gap = lapseDays();
    var comeback = gap >= COMEBACK_GAP && seenDue.length >= COMEBACK_BACKLOG;
    // Under a comeback, the session is drawn from cards already met. Meeting new material
    // on the day you return is how a backlog becomes a wall.
    var due = comeback ? seenDue : dueAll;
    var byTopic = topicsFor(pool);
    var names = Object.keys(byTopic).sort();
    var rows = names.map(function (t) {
      var m = mastery(byTopic[t]);
      var d = byTopic[t].filter(function (c) { return isDue(c.id); }).length;
      return '<button class="st-topic" data-topic="' + esc(t) + '" aria-label="Study ' + esc(t) + ', mastery ' + m + ' percent">' +
        '<span class="st-topic-name">' + esc(t) + '</span>' +
        '<span class="st-bar" aria-hidden="true"><span class="st-bar-fill" style="width:' + m + '%"></span></span>' +
        '<span class="st-topic-meta">' + m + '%' + (d ? ' <b class="st-due">· ' + d + ' due</b>' : '') + '</span></button>';
    }).join('');
    /* The scenario self-grade (1 rough / 2 getting there / 3 board-ready) reads back on
       the Board Simulator card on the landing page — see gamesSectionHtml(). */
    var overall = mastery(pool);
    /* The headline used to be the whole backlog — 337 — while a session hands you 25, and
       finishing those 25 moved it to 333 because a missed card is due again immediately.
       A number that only ever goes down by the cards you already knew reads as punishment.
       So: the big number is the session you're about to run, the backlog is context, and
       finishing one is an end state rather than a slightly smaller pile. */
    var dstate = dailyState();
    var sessionSize = Math.min(due.length, SESSION_CAP);
    /* The panel spans the shell but its copy holds a reading measure, so the right
       half sat empty. Fill it with the split the session is actually made of —
       first-time cards, scheduled reviews, and how far past due the oldest one is.
       All three are already in hand; nothing new is computed for the display. */
    var newDue = due.filter(function (c) { return cardState(c.id).box === 0; }).length;
    var revDue = due.length - newDue;
    var oldest = 0;
    due.forEach(function (c) { var st = cardState(c.id);
      if (st.box > 0) { var d = today() - st.due; if (d > oldest) oldest = d; } });
    /* These three count the whole due pile, not the 25 in front of you — the session's
       cards are not chosen until startSession() shuffles and slices. Unlabelled, that put
       "337 new" beside "25 cards in today's session" and read as a contradiction. */
    function statBlock() {
      return '<div class="st-daily-stats"><span class="st-daily-stats-lab">Waiting overall</span>' +
        '<div><b>' + newDue + '</b><span>new</span></div>' +
        '<div><b>' + revDue + '</b><span>review</span></div>' +
        '<div><b>' + (oldest > 0 ? oldest + 'd' : '0') + '</b><span>' +
          (oldest > 0 ? 'oldest wait' : 'overdue') + '</span></div></div>';
    }
    var dailyInner;
    if (!due.length) {
      dailyInner = '<div class="st-daily-row"><span class="st-daily-what" style="font-size:19px">All caught up — nothing due today.</span></div>' +
        '<span class="st-daily-sub">The scheduler has nothing urgent. Take the next lesson, or run a Deep Study shuffle to stay sharp.</span>';
    } else if (dstate.sessions) {
      dailyInner = '<div class="st-daily-row"><span class="st-daily-what" style="font-size:19px">Done for today — ' +
        dstate.done + ' card' + (dstate.done !== 1 ? 's' : '') + ' answered.</span></div>' +
        '<span class="st-daily-sub">Cards you missed stay in the pile until they stick, so the count doesn’t drop to zero — that’s the schedule working, not a backlog. Another round of ' +
        sessionSize + ' whenever you want it.</span>';
    } else if (comeback) {
      dailyInner = '<div class="st-daily-row"><span class="st-daily-num">' + sessionSize + '</span><span class="st-daily-what">waiting for you</span></div>' +
        '<span class="st-daily-sub">Welcome back — it’s been ' + gap + ' days. These are cards you have already met, not new ground: ' +
        'coming back after a gap is the hard part, and you just did it. New material waits until the pile is down.' +
        (seenDue.length > sessionSize ? ' ' + seenDue.length + ' are due in total; you will see ' + sessionSize + ' now.' : '') +
        '</span>' + statBlock();
    } else {
      dailyInner = '<div class="st-daily-row"><span class="st-daily-num">' + sessionSize + '</span><span class="st-daily-what">card' + (sessionSize !== 1 ? 's' : '') + ' in today’s session</span></div>' +
        '<span class="st-daily-sub">Spaced repetition picked these — the ones you’re about to forget, right before you forget them.' +
        (due.length > sessionSize ? ' Drawn from ' + due.length + ' due; a session caps at ' + SESSION_CAP + ' on purpose, because short and often beats long and rare.' : '') +
        '</span>' + statBlock();
    }
    var run = comeback ? 0 : streakRun();   // never greet a return with a reset counter
    render(
      '<div class="st-head">' +
      '<button class="rz-side-back st-to-course" id="st-to-course">\u2190 Course outline</button>' +
      (run >= 2 ? '<div class="st-streak" title="Days in a row with at least one card answered">' +
        '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l1.4 3.1L10.8 5 8.4 7.2l.7 3.3L6 8.8l-3.1 1.7.7-3.3L1.2 5l3.4-.9z"/></svg>' +
        run + '-day streak</div>' : '') +
      '<div class="st-track-chip">' + (S.track === 'basic' ? 'Basic' : 'Advanced') +
      ' <button class="st-link" id="st-switch">switch</button></div></div>' +
      '<h2 class="st-h2" style="margin:0 0 14px">Review</h2>' +
      '<button class="st-daily' + (due.length ? '' : ' st-daily-dead') + '" id="m-daily"' + (due.length ? '' : ' disabled') + '><div class="st-daily-eyebrow">Today’s session · Daily Review</div>' + dailyInner + (due.length ? '<span class="st-daily-go" aria-hidden="true">→</span>' : '') + '</button>' +
      '<div class="st-modes">' +
      '<button class="st-mode" id="m-deep"><b><span class="st-mode-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></span>Deep Study</b><span>Endless random cards, every topic in the mix — go as long as you want</span></button>' +
      '<button class="st-mode" id="m-sprint"><b><span class="st-mode-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>Threshold Sprint</b><span>Rapid-fire numbers · best streak ' + (S.sprint.best || 0) + '</span></button>' +
      '</div>' +
      '<div class="st-ready-head"><h2 class="st-h2">Readiness by topic</h2><span class="st-overall">' + overall + '% overall</span></div>' +
      '<p class="st-sub">Tap a topic to study it directly, due or not.</p>' +
      '<div class="st-topics">' + rows + '</div>' +
      footToolsHtml()
    );
    if (due.length) el('m-daily').onclick = function () { goDepth(2, function () { startSession(due, 'Daily Review'); }); };
    el('m-deep').onclick = function () { goDepth(2, viewDeep); };
    el('m-sprint').onclick = function () { goDepth(2, viewSprint); };
    el('st-switch').onclick = function () { goDepth(0, viewTrack); };
    el('st-to-course').onclick = function () { goDepth(1, viewCourse); };
    wireFootTools();
    Array.prototype.forEach.call(app.querySelectorAll('.st-topic'), function (b) {
      b.onclick = function () {
        var t = b.getAttribute('data-topic');
        goDepth(2, function () { startSession(shuffle(byTopic[t].slice()), t); });
      };
    });
  }

  /* Export/Import/Reset footer — one builder for /study's dashboard and /48cons, so the org
     page's progress (same storage key) is movable and erasable from the page that uses it. */
  function footToolsHtml() {
    return '<div class="st-foot-tools"><button class="st-link" id="st-export">Export progress</button> · ' +
      '<button class="st-link" id="st-import">Import</button> · ' +
      '<button class="st-link" id="st-reset">Reset</button><input type="file" id="st-file" accept="application/json" hidden></div>';
  }
  function wireFootTools() {
    el('st-export').onclick = doExport;
    el('st-import').onclick = function () { el('st-file').click(); };
    el('st-file').onchange = doImport;
    el('st-reset').onclick = function () {
      if (confirm('Erase all study progress on this device?')) { S = normalize({ track: S.track }); save(); homeFn()(); }
    };
  }


  /* ══ COURSE LAYER (Rise-style) ═══════════════════════════════════════════════
     The spine is a course now: sections → lessons → blocks, walked front to back,
     with a knowledge check at the end of each lesson. The spaced-repetition engine
     did not go anywhere — it sits behind "Review" and every knowledge check still
     grades into it, so walking the course schedules the cards you answered.

     A lesson is a (level, topic) pair, never a bare topic: Vol. 1 and Vol. 2 both
     carry "Competition (CICA)" and "Small Business Programs", and The Board course
     contains both volumes. Keying on topic alone collapsed them into one lesson and
     lost the Vol. 2 cards.
     ──────────────────────────────────────────────────────────────────────────── */
  /* All 40 threshold cards used to carry one topic, so the course showed them as a
     single lesson whose knowledge check caps at 6 — 34 cards you could finish the
     lesson without ever seeing. The grouping is read from each card's own governing
     part rather than invented, so a deck refresh keeps sorting itself. */
  var THRESH_GROUPS = [
    ['Dollar Tiers & Buying Methods', [1, 2, 10, 12, 13]],
    ['Competition & Sole Source', [6]],
    ['Protests & Claims', [33]],
    ['Pricing & Cost Data', [15]],
    ['Contract Type & Finance', [16, 32]],
    ['Small Business & Labor Standards', [19, 22, 28]],
    ['Changes, Funds & Closeout', [43, 49, 52]]
  ];
  var THRESH_FALLBACK = 'Changes, Funds & Closeout';
  function threshPart(t) {
    var links = t.links || [];
    for (var i = 0; i < links.length; i++) {
      var m = /\/rfo\/part-(\d+)/.exec(String(links[i] && links[i].u || ''));
      if (m) return +m[1];
    }
    var r = /\b(\d{1,2})\.\d/.exec(String(t.ref || ''));
    return r ? +r[1] : null;
  }
  function threshTopic(t) {
    var p = threshPart(t);
    for (var i = 0; i < THRESH_GROUPS.length; i++) {
      if (THRESH_GROUPS[i][1].indexOf(p) !== -1) return THRESH_GROUPS[i][0];
    }
    return THRESH_FALLBACK;
  }
  var VOL1 = [
    ['Ground Rules', ['What Air Force Contracting Is', 'The Players: Roles & Who Does What',
      'Authority, Unauthorized Commitments & Ratification', 'The Rulebook: The RFO, R-DFARS & DAF Policy']],
    ['Money and Time', ['Colors of Money & Fiscal Law Basics', 'The Acquisition Lifecycle']],
    ['Before the Buy', ['Requirements & Market Research', 'Competition (CICA)', 'Buying Methods by Dollar Value']],
    ['Shaping the Deal', ['Contract Types & Risk', 'Pricing: Getting to Fair & Reasonable', 'Source Selection Basics']],
    ['Guardrails and After Award', ['Ethics & Procurement Integrity', 'Small Business Programs',
      'Contract Administration: Mods, Options, Claims & Terminations']]
  ];
  var VOL2 = [
    ['Planning the Buy', ['Acquisition Planning & Strategy', 'Market Research',
      'Required Sources of Supplies & Services', 'Commercial Products & Services']],
    ['Integrity and Authority', ['Authority, Unauthorized Commitments & Ratification', 'Procurement Integrity',
      'Organizational Conflict of Interest', 'Contractor Qualifications — Responsibility']],
    ['Choosing the Method', ['Simplified Acquisition Procedures', 'Small Business Programs',
      'Competition (CICA)', 'Contracting by Negotiation — Source Selection']],
    ['Pricing and Contract Type', ['Certified Cost or Pricing Data & Proposal Analysis', 'Contract Types',
      'IDIQ Ordering & Fair Opportunity', 'Options']],
    ['Money, Property and Rights', ['Interagency Acquisitions & the Economy Act', 'Contract Finance & Fiscal Law',
      'Data Rights', 'Government Property']],
    ['Changes and Disputes', ['Contract Modifications & Scope', 'Undefinitized Contract Actions',
      'Clearance — Independent Review & Approval', 'Protests', 'REAs & Claims', 'Terminations']],
    ['Specialized Buys', ['R&D Contracting — BAAs, SBIR & OTs', 'Construction & Service Contracting']],
    ['Numbers You Must Know', THRESH_GROUPS.map(function (g) { return g[0]; })]
  ];
  var COURSE_META = {
    basic: { name: 'Basic', vol: 'Field Guide Vol. 1',
      blurb: 'The players, the money, the methods. Fifteen lessons that build the base everything else stands on — who can bind the Government, whose money you are spending, and how a requirement becomes a contract.' },
    advanced: { name: 'Advanced', vol: 'Field Guide Vol. 1 & 2',
      blurb: 'Everything in Basic, then the depth a board actually probes: planning, integrity, pricing, contract type, changes, disputes and the numbers you are expected to know cold.' }
  };
  // Every card in the course, grouped by lesson. Built once per track from the live pool,
  // so a deck refresh flows straight through instead of needing the outline re-authored.
  function courseSections() {
    return S.track === 'basic' ? VOL1.map(function (s) { return ['basic', s[0], s[1]]; })
      : VOL1.map(function (s) { return ['basic', s[0], s[1]]; })
        .concat(VOL2.map(function (s) { return ['advanced', s[0], s[1]]; }));
  }
  function lessonKey(level, topic) { return level + '|' + topic; }
  function lessonCards(level, topic) {
    return recallPool().filter(function (c) {
      return (c.level || 'advanced') === level && (c.topic || '') === topic;
    });
  }
  /* A flat, numbered walk of the whole course — what the outline renders, what "next
     lesson" steps through, and what the progress ring counts. Lessons whose topic has no
     cards in this deck are dropped here rather than rendered as dead rows. */
  function courseLessons() {
    var out = [], n = 0;
    courseSections().forEach(function (sec) {
      sec[2].forEach(function (topic) {
        var cards = lessonCards(sec[0], topic);
        if (!cards.length) return;
        out.push({ level: sec[0], section: sec[1], topic: topic, cards: cards,
          key: lessonKey(sec[0], topic), n: ++n });
      });
    });
    return out;
  }
  function lessonDone(key) { return !!(S.lessons && S.lessons[key]); }
  function markLesson(key) { if (!S.lessons) S.lessons = {}; S.lessons[key] = today(); save(); }
  function courseProgress(lessons) {
    var done = lessons.filter(function (l) { return lessonDone(l.key); }).length;
    return { done: done, total: lessons.length, pct: lessons.length ? Math.round(100 * done / lessons.length) : 0 };
  }
  /* Persistent course chrome. Every commercial course player keeps a bar pinned while you
     work — where you are, how far in, what is next. Without one the page reads as a
     document you happen to be scrolling rather than an application you are inside. */
  function chromeHtml(o) {
    var p = o.prog;
    return '<div class="rz-bar">' +
      (o.back ? '<button class="rz-bar-back" id="rz-bar-back" aria-label="' +
        esc(o.backAria || 'Back to the course outline') + '">' +
        '<span aria-hidden="true">\u2190</span> ' + esc(o.backLabel || 'Outline') + '</button>' : '') +
      '<span class="rz-bar-crumb"><b>' + esc(o.course) + '</b>' +
      (o.now ? '<span class="rz-bar-sep" aria-hidden="true">/</span><span class="rz-bar-now">' +
        esc(o.now) + '</span>' : '') + '</span>' +
      /* Some views inside the course have nothing countable — the Introduction Builder is
         four text fields, not a sequence. An empty meter reading "0 / 0" beside them looks
         like a broken counter, so a view with no total simply gets no meter. */
      (p && p.total
        ? '<span class="rz-bar-prog">' +
          '<span class="rz-bar-track" aria-hidden="true"><i style="width:' + p.pct + '%"></i></span>' +
          '<span class="rz-bar-n">' + p.done + '<span> / ' + p.total + '</span></span></span>'
        : '') +
      (o.nextLabel ? '<button class="rz-btn rz-btn-go rz-bar-next" id="rz-bar-next">' +
        esc(o.nextLabel) + ' <span aria-hidden="true">\u2192</span></button>' : '') +
      '</div>';
  }
  /* `unit` because this meter now serves two courses with different units: /study counts
     lessons complete, /48cons counts cards met at a ceiling. It read "64 lessons" on a
     page that has no lessons. */
  function barHtml(prog, cls, unit) {
    var u = unit || { one: 'lesson', many: 'lessons', verb: 'complete' };
    return '<div class="rz-meter' + (cls ? ' ' + cls : '') + '">' +
      '<div class="rz-meter-bar" aria-hidden="true"><span style="width:' + prog.pct + '%"></span></div>' +
      '<span class="rz-meter-n">' + (prog.done
        ? prog.done + ' of ' + prog.total + ' ' + u.many + ' ' + u.verb
        : 'Not started \u00b7 ' + prog.total + ' ' + (prog.total === 1 ? u.one : u.many)) + '</span></div>';
  }
  /* An e-learning outline that says "5 key points \u00b7 knowledge check" on all 44 rows is
     44 rows of the same sentence. Minutes differ per lesson and are the thing somebody
     picking a lesson on a lunch break actually needs. Deliberately approximate. */
  function lessonMins(cards, checks) {
    var n = cards.length == null ? cards : cards.length;
    var per = (cards.length && cards[0] && cards[0].kind === 'threshold') ? 12 : 45;
    return Math.max(2, Math.round((n * per + checks * 30) / 60));
  }
  function checkCount(cards) {
    return cards.filter(function (c) { return mcqOptions(c); }).slice(0, KC_MAX).length;
  }

  /* ---- course home: cover, then the outline ---- */
  function viewCourse() {
    depth1View = viewCourse;
    var meta = COURSE_META[S.track === 'basic' ? 'basic' : 'advanced'];
    var lessons = courseLessons();
    var prog = courseProgress(lessons);
    var next = lessons.filter(function (l) { return !lessonDone(l.key); })[0] || lessons[0];
    var full = prog.total && prog.done === prog.total;
    var due = recallPool().filter(function (c) { return isDue(c.id); }).length;
    var secHtml = '', seen = {}, lastVol = null, secList = [];
    courseSections().forEach(function (sec) {
      var rows = lessons.filter(function (l) { return l.level === sec[0] && l.section === sec[1]; });
      if (!rows.length) return;
      var sdone = rows.filter(function (l) { return lessonDone(l.key); }).length;
      var smins = rows.reduce(function (t, l) {
        return t + lessonMins(l.cards, checkCount(l.cards)); }, 0);
      var schecks = rows.filter(function (l) { return checkCount(l.cards); }).length;
      secList.push({ name: sec[1], vol: sec[0], done: sdone, total: rows.length });
      if (sec[0] !== lastVol) {
        lastVol = sec[0];
        secHtml += '<div class="rz-vol"><span>' + (sec[0] === 'basic' ? 'Field Guide Vol. 1' : 'Field Guide Vol. 2') + '</span></div>';
      }
      secHtml += '<section class="rz-sec" id="rz-s' + secList.length + '"><div class="rz-sec-head">' +
        '<h3>' + esc(sec[1]) + '</h3>' +
        '<span class="rz-sec-count">' + (sdone ? sdone + ' of ' + rows.length + ' complete'
          : rows.length + ' lesson' + (rows.length !== 1 ? 's' : '') +
            (schecks ? ' · ' + schecks + ' knowledge check' + (schecks !== 1 ? 's' : '') : '')) +
        ' · \u2248 ' + smins + ' min</span></div>' +
        '<ol class="rz-lessons">' + rows.map(function (l) {
          var d = lessonDone(l.key);
          return '<li><button class="rz-lesson' + (d ? ' rz-lesson-done' : '') + '" data-key="' + esc(l.key) + '">' +
            '<span class="rz-lesson-mark" aria-hidden="true">' + (d ? '✓' : l.n) + '</span>' +
            '<span class="rz-lesson-body"><b>' + esc(l.topic) + '</b>' +
            (d ? '<span>Complete \u00b7 revisit</span>' : '') + '</span>' +
            '<span class="rz-lesson-go" aria-hidden="true">→</span></button></li>';
        }).join('') + '</ol></section>';
    });
    var nSections = (function () {
      var seen = {}; lessons.forEach(function (l) { seen[l.level + '|' + l.section] = 1; });
      return Object.keys(seen).length;   // sections that actually render, not all declared
    })();
    var nChecks = lessons.filter(function (l) { return checkCount(l.cards); }).length;
    var nHours = Math.round(lessons.reduce(function (t, l) {
      return t + lessonMins(l.cards, checkCount(l.cards)); }, 0) / 60);
    var reviewLine = due ? (function () {
      var seen = recallPool().filter(function (c) { return isDue(c.id) && cardState(c.id).box > 0; }).length;
      return seen ? seen + ' due for review · ' + (due - seen) + ' not met yet'
        : due + ' card' + (due !== 1 ? 's' : '') + ' waiting, none met yet';
    })() : 'Spaced repetition across everything you have studied';
    /* The cover describes the course; the rail acts on it. Splitting them is what every
       course platform does at this width, and it stops the page being one 830px column
       down the middle of a 1600px screen with the CTA buried in the hero. The rail is
       order:-1 under the breakpoint so the action never falls below the outline on a
       phone. */
    render(
      // no next button in the bar here: the hero card carries the action, and both were
      // on screen at once saying the same thing
      chromeHtml({ course: meta.name, prog: prog }) +
      '<div class="rz-cover">' +
      '<div class="rz-cover-body">' +
      '<span class="rz-eyebrow">' + esc(meta.vol) + '</span>' +
      '<h1 class="rz-cover-h">' + esc(meta.name) + '</h1>' +
      '<p class="rz-cover-p">' + esc(meta.blurb) + '</p>' +
      '<ul class="rz-facts" role="list">' +
      '<li><b>' + lessons.length + '</b> lessons</li>' +
      '<li><b>' + nSections + '</b> sections</li>' +
      '<li><b>\u2248 ' + nHours + ' hr</b> of material</li>' +
      '</ul></div>' +
      /* The action card sits IN the hero, not under it. The cover was a 1230px navy slab
         with copy in its left 40% and a void on the right, and the card repeated the
         progress and the CTA a scroll below. One object now: describe on the left, act on
         the right. */
      '<div class="rz-card rz-card-hero">' +
      barHtml(prog) +
      '<button class="rz-btn rz-btn-go rz-btn-wide" id="rz-start">' +
      (full ? 'Revisit — Lesson 1' : prog.done ? 'Continue — Lesson ' + next.n : 'Start course') + '</button>' +
      '<button class="rz-btn rz-btn-ghost rz-btn-wide" id="rz-switch">Switch course</button>' +
      '<div class="rz-card-h">What\u2019s included</div>' +
      '<ul class="rz-incl" role="list">' +
      '<li><b>' + lessons.length + '</b> readings, one per lesson</li>' +
      '<li><b>' + nChecks + '</b> knowledge checks</li>' +
      '<li>Every answer cited to the governing text</li>' +
      '</ul></div></div>' +
      '<div class="rz-home">' +
      '<div class="rz-home-main">' +
      '<h2 class="rz-outline-head">Course outline</h2>' + secHtml + '</div>' +
      '<aside class="rz-aside" aria-label="More in this course">' +
      '<button class="rz-extra-card" id="rz-review"><b>Review</b><span>' + reviewLine + '</span></button>' +
      '<button class="rz-extra-card" id="rz-practice"><b>Practice Range</b><span>Both simulators and the daily rounds</span></button>' +
      '<nav class="rz-secnav" aria-label="Jump to a section">' +
      '<div class="rz-card-h rz-secnav-h">Sections</div>' +
      secList.map(function (x, i) {
        return '<a class="rz-secnav-i' + (x.done === x.total ? ' rz-secnav-done' : '') +
          '" href="#rz-s' + i + '"><span>' + esc(x.name) + '</span>' +
          '<b>' + x.done + '/' + x.total + '</b></a>';
      }).join('') + '</nav>' +
      '</aside></div>' + footToolsHtml());
    if (next) {
      el('rz-start').onclick = function () { openLesson(next.key); };
    } else { el('rz-start').disabled = true; }
    el('rz-switch').onclick = function () { goDepth(0, viewTrack); };
    el('rz-review').onclick = function () { goDepth(1, viewHome); };
    el('rz-practice').onclick = function () {
      // it and "Switch course" land on the same view, so send this one to the part it
      // names. Inside the render callback: goDepth pops asynchronously, so a scroll
      // beside it runs against the outgoing DOM and render() re-anchors afterwards.
      goDepth(0, function () {
        viewTrack();
        var g = app.querySelector('.st-tools-label');
        if (g) g.scrollIntoView({ block: 'start' });
      });
    };
    wireFootTools();
    Array.prototype.forEach.call(app.querySelectorAll('.rz-lesson'), function (b) {
      b.onclick = function () { openLesson(b.getAttribute('data-key')); };
    });
  }
  function openLesson(key) {
    goDepth(2, function () { viewLesson(key); });
    // Stamp the key on the entry goDepth just pushed. Without it a Forward pop carried
    // only {st:2}, fell through to depth1View and repainted the OUTLINE at depth 2 —
    // the outline twice in a row, the lesson unreachable forward, an extra Back to leave.
    if (navDepth === 2) { try { history.replaceState({ st: 2, lesson: key }, ''); } catch (e) {} }
  }

  /* ---- a lesson: teaching blocks, a continue gate, then the knowledge check ---- */
  var KC_MAX = 6;   // a lesson checks at most this many points; "Thresholds" has 40 cards
  var ICON_READ = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2h7l3 3v9H3z"/><path d="M9.5 2v4h4"/><path d="M5.5 8.5h5M5.5 11h3.5"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h11v11h-11z"/><path d="M5 8.2l2.1 2.1L11.2 6"/></svg>';
  var ICON_TABLE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12v10H2z"/><path d="M2 6.5h12M9.5 6.5v6.5"/></svg>';
  function itemHead(icon, name, meta, done) {
    return '<div class="rz-item' + (done ? ' rz-item-done' : '') + '">' +
      '<span class="rz-item-ic" aria-hidden="true">' + icon + '</span>' +
      '<h3 class="rz-item-n">' + name + '</h3>' +
      '<span class="rz-item-meta">' + meta + '</span></div>';
  }
  /* Removing the gate, advancing a question and finishing the check each destroy the
     node that held focus. Hand it to the panel, the way produceFirstCard() hands it to
     the card — never to a button, which would swallow the keyboard shortcuts. */
  function focusKc(host) {
    try { host.focus({ preventScroll: true }); } catch (e) { try { host.focus(); } catch (e2) {} }
  }
  /* The reference table. Each row is a figure you can scan for, with the note and the
     citation folded into a <details> so forty rows stay forty rows — open one and you get
     the same debrief the card would have given you. Native <details>: no state to keep,
     works with find-in-page expanded or not, and keyboard-operable for free. */
  function tableHtml(cards) {
    return '<div class="rz-table">' + cards.map(function (c) {
      var body = (c.x ? '<p>' + esc(c.x) + '</p>' : '') + srcLine(c);
      var label = esc(c.q).replace(/\s*\?\s*$/, '');
      /* Half of these "thresholds" are not figures — the answers run to 238 characters.
         A short one earns the scannable label/figure row; a long one stacks under its
         label rather than squeezing the label to one word per line. Never truncated:
         a clipped number in a study tool is worse than a taller row. */
      var cls = 'rz-row rz-row-x' + (c.a.length > 40 ? ' rz-row-tall' : '');
      var head = '<span class="rz-row-k">' + label + '</span>' +
        '<b class="rz-row-v">' + esc(c.a) + '</b>' +
        '<span class="rz-row-go" aria-hidden="true"></span>';
      if (!body) return '<div class="' + cls.replace(' rz-row-x', '') + '">' + head + '</div>';
      return '<details class="' + cls + '"><summary>' + head + '</summary>' +
        '<div class="rz-row-body">' + body + '</div></details>';
    }).join('') + '</div>';
  }
  function srcLine(c) {
    var links = (c.links || []).map(function (l) {
      return '<a class="rz-cite" href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.t) + '</a>';
    }).join('');
    if (!c.ref && !links) return '';
    // no separator between the ref and the pills: when the pills wrap to their own line
    // the separator is left dangling at the end of the one above it.
    return '<p class="rz-src">' + (c.ref ? '<span class="rz-src-t">' + esc(c.ref) + '</span>' : '') + links + '</p>';
  }
  function viewLesson(key, resume) {
    var lessons = courseLessons();
    var idx = -1;
    lessons.forEach(function (l, i) { if (l.key === key) idx = i; });
    if (idx < 0) return viewCourse();
    var L = lessons[idx], next = lessons[idx + 1] || null;
    var prog = courseProgress(lessons);
    /* Shuffled, not the first six in deck order: 14 Advanced lessons hold more mcq-able
       cards than KC_MAX, so a fixed slice left 54 cards that could be read but never
       asked, and made "revisit" mean "answer the identical six again". */
    var checks = shuffle(L.cards.filter(function (c) { return mcqOptions(c); })).slice(0, KC_MAX);
    // Resuming: rebuild the exact question set that was saved, in its saved order, so
    // "question 3 of 5" means the same three you had already answered.
    if (resume && resume.ids && resume.ids.length) {
      var byId = {};
      L.cards.forEach(function (c) { byId[c.id] = c; });
      var rebuilt = resume.ids.map(function (id) { return byId[id]; }).filter(Boolean);
      if (rebuilt.length === resume.ids.length) checks = rebuilt;
    }

    var isTable = L.cards.length > 1 && L.cards.every(function (c) { return c.kind === 'threshold'; });
    var blocks = isTable ? tableHtml(L.cards) : L.cards.map(function (c, i) {
      return '<article class="rz-block" id="rz-b' + i + '">' +
        '<h3 class="rz-block-h">' + esc(c.q) + '</h3>' +
        '<p class="rz-lead">' + esc(c.a) + '</p>' +
        (c.x ? '<p class="rz-block-p">' + esc(c.x) + '</p>' : '') +
        srcLine(c) + '</article>';
    }).join('');

    render(
      chromeHtml({ course: COURSE_META[S.track === 'basic' ? 'basic' : 'advanced'].name,
        now: L.topic, prog: prog, back: true, nextLabel: next ? 'Next lesson' : null }) +
      '<div class="rz-lesson-shell">' +
      '<aside class="rz-side" id="rz-side">' +
      '<nav class="rz-side-nav" aria-label="Lessons in this course">' + (function () {
        var out = '', lastSec = null;
        lessons.forEach(function (l) {
          var sec = l.level + '|' + l.section;
          if (sec !== lastSec) {
            lastSec = sec;
            out += '<div class="rz-side-sec">' + esc(l.section) + '</div>';
          }
          out += '<button class="rz-side-lesson' + (l.key === key ? ' rz-side-now' : '') +
            (lessonDone(l.key) ? ' rz-side-done' : '') + '" data-key="' + esc(l.key) + '"' +
            (l.key === key ? ' aria-current="true"' : '') + '>' +
            '<span class="rz-side-mark" aria-hidden="true">' + (lessonDone(l.key) ? '\u2713' : l.n) + '</span>' +
            (lessonDone(l.key) ? '<span class="sr">Completed. </span>' : '') +
            esc(l.topic) + '</button>';
        });
        return out;
      })() + '</nav></aside>' +
      '<div class="rz-main">' +
      '<button class="rz-side-open" id="rz-side-open" aria-expanded="false" aria-controls="rz-side">' +
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 3h14M1 8h14M1 13h9"/></svg>Lessons</button>' +
      '<header class="rz-lhead">' +
      '<span class="rz-eyebrow">' + (L.level === 'basic' ? 'Vol. 1' : 'Vol. 2') + ' · ' + esc(L.section) + '</span>' +
      '<h1>' + esc(L.topic) + '</h1>' +
      '<p class="rz-lhead-meta">Lesson ' + L.n + ' of ' + lessons.length + ' · \u2248 ' +
      lessonMins(L.cards, checks.length) + ' min' +
      (checks.length ? ' · ' + checks.length + '-question check' : '') + '</p>' +
      '</header>' +
      itemHead(isTable ? ICON_TABLE : ICON_READ,
        isTable ? 'Reference' : 'Reading',
        isTable ? L.cards.length + ' figures'
          : '\u2248 ' + Math.max(1, Math.round(L.cards.length * 45 / 60)) + ' min',
        lessonDone(L.key)) +
      blocks +
      (checks.length
        ? '<div class="rz-gate" id="rz-gate"><p>' + (isTable
            ? 'Answer ' + checks.length + ' of these from memory and the lesson is done.'
            : 'That is the reading. Answer ' + checks.length +
              ' question' + (checks.length !== 1 ? 's' : '') + ' on it and the lesson is done.') + '</p>' +
          '<button class="rz-btn rz-btn-go" id="rz-continue">Start the knowledge check</button></div>' +
          '<section class="rz-kc" id="rz-kc" hidden></section>'
        : '<div class="rz-gate" id="rz-gate"><p>Reference material \u2014 there is no check on this one.</p>' +
          '<button class="rz-btn rz-btn-go" id="rz-continue">Mark lesson complete</button></div>' +
          '<section class="rz-kc" id="rz-kc" hidden></section>') +
      navBar() +
      '</div>' + railHtml() + '</div>');

    function navBar() {
      var prev = lessons[idx - 1];
      return '<nav class="rz-nav" aria-label="Lesson navigation">' +
        (prev ? '<button class="rz-nav-b rz-nav-prev" id="rz-prev">' +
          '<span>Previous</span><b>' + esc(prev.topic) + '</b></button>' : '<span></span>') +
        (next ? '<button class="rz-nav-b rz-nav-next" id="rz-next-lesson">' +
          '<span>Next lesson</span><b>' + esc(next.topic) + '</b></button>'
          : '<button class="rz-nav-b rz-nav-next" id="rz-next-lesson"><span>Last lesson</span><b>Back to the outline</b></button>') +
        '</nav>';
    }
    function wireNav() {
      var prev = lessons[idx - 1];
      if (el('rz-prev')) el('rz-prev').onclick = function () { openLesson(prev.key); };
      if (el('rz-next-lesson')) el('rz-next-lesson').onclick = function () {
        if (next) openLesson(next.key); else goDepth(1, viewCourse);
      };
    }
    wireNav();
    keyHandler(null);   // a fresh lesson owns no shortcuts until its check opens
    /* The right rail. A lesson with a left nav and nothing on the right leaves a third of
       a wide screen empty and gives the reader no sense of the shape of what they are in.
       An on-this-page list is what the reading actually covers, jumpable, and doubles as a
       scan of the lesson before committing to it. Suppressed for a reference table —
       forty jump links is not a summary, it is the table again. */
    function railHtml() {
      var jump = (!isTable && L.cards.length <= 12)
        ? '<div class="rz-rail-h">On this page</div><ol class="rz-jump">' +
          L.cards.map(function (c, i) {
            return '<li><a href="#rz-b' + i + '">' + esc(c.a) + '</a></li>';
          }).join('') + '</ol>'
        : '';
      return '<aside class="rz-rail" aria-label="In this lesson">' +
        '<div class="rz-rail-pos">Lesson <b>' + L.n + '</b> of ' + lessons.length +
        '<span>' + esc(L.section) + '</span></div>' + jump +
        (checks.length ? '<a class="rz-rail-kc" href="#rz-kc">Knowledge check \u00b7 ' +
          checks.length + ' question' + (checks.length !== 1 ? 's' : '') + '</a>' : '') +
        '</aside>';
    }
    el('rz-bar-back').onclick = function () { goDepth(1, viewCourse); };
    if (el('rz-bar-next')) el('rz-bar-next').onclick = function () { openLesson(next.key); };
    el('rz-side-open').onclick = function () {
      var open = el('rz-side').classList.toggle('rz-side-shown');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var f = el('rz-side').querySelector('.rz-side-lesson'); if (f) f.focus(); }
    };
    el('rz-side').onkeydown = function (e) {
      if (e.key !== 'Escape' || !this.classList.contains('rz-side-shown')) return;
      this.classList.remove('rz-side-shown');
      el('rz-side-open').setAttribute('aria-expanded', 'false');
      el('rz-side-open').focus();
    };
    Array.prototype.forEach.call(app.querySelectorAll('.rz-side-lesson'), function (b) {
      b.onclick = function () { openLesson(b.getAttribute('data-key')); };
    });

    // Wire the gate BEFORE resuming into the check: openCheck() removes #rz-gate, and
    // #rz-continue lives inside it, so calling it first left this assigning onto null.
    el('rz-continue').onclick = openCheck;
    if (resume) openCheck();
    function openCheck() {
      var gate = el('rz-gate'); if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
      var kc = el('rz-kc'); kc.hidden = false; kc.setAttribute('tabindex', '-1');
      if (!checks.length) { finish(kc, 0, 0); focusKc(kc); return; }
      runChecks(kc, resume);
      kc.scrollIntoView({ block: 'start', behavior: resume ? 'instant' : 'smooth' });
      focusKc(kc);
    }

    /* The knowledge check. One question at a time, Rise-style: pick, submit, get the
       verdict and the explanation, move on. Every answer grades into the spaced-repetition
       engine — walking the course IS scheduling the cards, so Review is never empty for
       someone who has only ever taken lessons. */
    function runChecks(host, resume) {
      var i = (resume && resume.i) || 0, right = (resume && resume.got) || 0;
      function step() {
        if (i >= checks.length) return finish(host, right, checks.length);
        saveResume('lesson', S.track, checks, i, right, L.key);
        var c = checks[i], opts = mcqOptions(c), picked = -1;
        host.innerHTML = '<div class="rz-kc-head"><span class="rz-kc-lab">Knowledge check</span>' +
          '<span class="rz-kc-count">Question ' + (i + 1) + ' of ' + checks.length + '</span></div>' +
          '<div class="rz-prog" aria-hidden="true"><span style="width:' + Math.round(100 * i / checks.length) + '%"></span></div>' +
          '<h2 class="rz-kc-q" id="rz-kc-q">' + esc(c.q) + '</h2>' +
          '<div class="rz-opts" role="radiogroup" aria-labelledby="rz-kc-q">' + opts.map(function (o, k) {
            return '<button class="rz-opt" role="radio" aria-checked="false" data-k="' + k +
              '" tabindex="' + (k ? '-1' : '0') + '">' +
              '<span class="rz-opt-dot" aria-hidden="true"></span>' +
              '<kbd class="rz-opt-k" aria-hidden="true">' + (k + 1) + '</kbd>' +
              '<span>' + esc(o) + '</span></button>';
          }).join('') + '</div>' +
          '<div class="rz-kc-act"><button class="rz-btn rz-btn-go" id="rz-submit" disabled>Submit</button></div>';
        var optEls = Array.prototype.slice.call(host.querySelectorAll('.rz-opt'));
        function select(b, focus) {
          picked = +b.getAttribute('data-k');
          optEls.forEach(function (o) {
            var on = o === b;
            o.classList.toggle('rz-opt-on', on);
            o.setAttribute('aria-checked', on ? 'true' : 'false');
            // roving tabindex: the group is one tab stop, arrows move within it
            o.setAttribute('tabindex', on ? '0' : '-1');
          });
          if (focus) b.focus();
          el('rz-submit').disabled = false;
        }
        optEls.forEach(function (b, k) {
          b.onclick = function () { select(b, false); };
          b.onkeydown = function (e) {
            var d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1
              : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
            if (!d) return;
            e.preventDefault();
            select(optEls[(k + d + optEls.length) % optEls.length], true);
          };
        });
        keyHandler(function (key) {
          var n = parseInt(key, 10);
          if (n >= 1 && n <= optEls.length) { select(optEls[n - 1], false); return true; }
          if ((key === ' ' || key === 'Enter') && picked >= 0) { submit(); return true; }
        });
        el('rz-submit').onclick = submit;
        function submit() {
          if (picked < 0) return;
          var ok = opts[picked] === c.a;
          if (ok) right++;
          grade(c.id, ok ? 2 : 1);   // the course feeds the scheduler — capped, see below
          bumpStreak();
          Array.prototype.forEach.call(host.querySelectorAll('.rz-opt'), function (o) {
            var k = +o.getAttribute('data-k');
            if (opts[k] === c.a) o.classList.add('rz-opt-right');
            else if (k === picked) o.classList.add('rz-opt-wrong');
            o.disabled = true;
          });
          el('rz-submit').outerHTML =
            '<div class="rz-fb ' + (ok ? 'rz-fb-ok' : 'rz-fb-no') + '" role="status">' +
            '<b>' + (ok ? RIGHT_LINES[Math.floor(Math.random() * RIGHT_LINES.length)]
              : '✗ Not quite') + '</b>' +
            (ok ? '' : '<span class="rz-fb-ans">The answer is: ' + esc(c.a) + '</span>') +
            (c.x ? '<p>' + esc(c.x) + '</p>' : '') +
            srcLine(c) +
            (ok ? '<p class="rz-fb-cap">Held at <b>Shaky</b> in Review \u2014 you picked it out of four, ' +
              'which is not what a board asks of you. It comes back sooner.</p>' : '') + '</div>' +
            '<button class="rz-btn rz-btn-go" id="rz-kc-next">' +
            (i + 1 >= checks.length ? 'Finish lesson' : 'Next question') + '</button>';
          el('rz-kc-next').onclick = advance;
          el('rz-kc-next').focus();
          keyHandler(function (key) {
            if (key === ' ' || key === 'Enter') { advance(); return true; }
          });
          function advance() { keyHandler(null); i++; step(); }
        }
      }
      step();
    }

    /* Finishing a lesson used to change nothing outside this panel: the rail still showed
       the lesson numbered and unfinished, and the reading item still looked undone. The
       whole view is not worth re-rendering to tick three things, so tick them. */
    function markDoneInPlace() {
      var b = app.querySelector('.rz-side-lesson[data-key="' + L.key.replace(/"/g, '\\"') + '"]');
      if (b && !b.classList.contains('rz-side-done')) {
        b.classList.add('rz-side-done');
        var m = b.querySelector('.rz-side-mark');
        if (m) {
          m.textContent = '\u2713';
          m.insertAdjacentHTML('afterend', '<span class="sr">Completed. </span>');
        }
      }
      var item = app.querySelector('.rz-item');
      if (item) item.classList.add('rz-item-done');
      var p3 = courseProgress(courseLessons());
      var bar = app.querySelector('.rz-bar-track > i');
      if (bar) bar.style.width = p3.pct + '%';
      var lab = app.querySelector('.rz-bar-n');
      if (lab) lab.innerHTML = p3.done + '<span> / ' + p3.total + '</span>';
    }
    function finish(host, right, total) {
      keyHandler(null);
      clearResume();
      markLesson(L.key);
      markDoneInPlace();
      var p2 = courseProgress(courseLessons());
      var whole = p2.total && p2.done === p2.total;
      var meta = COURSE_META[S.track === 'basic' ? 'basic' : 'advanced'];
      var due = recallPool().filter(function (c) { return isDue(c.id); }).length;
      host.innerHTML = '<div class="rz-done' + (whole ? ' rz-done-all' : '') + '">' +
        '<div class="rz-done-tick" aria-hidden="true">✓</div>' +
        '<h3>' + (whole ? esc(meta.name) + ' complete' : 'Lesson complete') + '</h3>' +
        (whole
          ? '<p class="rz-done-score">All ' + p2.total + ' lessons, end to end. Reading them is the ' +
            'easy half — a board asks you to produce the answer cold, with nothing on the screen. ' +
            'That is what Review is for, and everything you just answered is already queued in it.</p>'
          : total ? '<p class="rz-done-score">' + right + ' of ' + total + ' correct — the ones you missed are already queued in Review.</p>'
          : '<p class="rz-done-score">Marked complete.</p>') +
        '<div class="rz-prog rz-prog-lg" aria-hidden="true"><span style="width:' + p2.pct + '%"></span></div>' +
        '<p class="rz-done-prog">' + p2.done + ' of ' + p2.total + ' lessons complete</p>' +
        '<div class="rz-done-actions">' +
        // the bar below already names what is next; this one only has to be the way on
        (whole
          ? '<button class="rz-btn rz-btn-go" id="rz-to-review">Start reviewing' +
            (due ? ' — ' + due + ' waiting' : '') + '</button>'
          : next ? '<button class="rz-btn rz-btn-go" id="rz-next">Next lesson →</button>' : '') +
        '<button class="rz-btn rz-btn-ghost" id="rz-outline">Course outline</button>' +
        '</div></div>';
      if (el('rz-next')) el('rz-next').onclick = function () { openLesson(next.key); };
      if (el('rz-to-review')) el('rz-to-review').onclick = function () { goDepth(1, viewHome); };
      el('rz-outline').onclick = function () { goDepth(1, viewCourse); };
    }
  }

  function backHome() { keyHandler(null); if (navDepth >= 2) history.back(); else homeFn()(); }
  // Games sit at depth 1 (on the main page), so their "back" returns to the tool select.
  function backToTools() { keyHandler(null); if (navDepth >= 1) history.back(); else viewTrack(); }

  /* ---- recall session (mixed reveal + multiple-choice) ---- */
  function startSession(cards, label, startAt, startGot, startShaky) {
    if (!cards.length) { homeFn()(); return; }
    var q = startAt == null ? interleave(shuffle(cards.slice()).slice(0, SESSION_CAP)) : cards;
    var i = startAt || 0, got = startGot || 0, shaky = (startShaky || []).slice();
    function step() {
      if (i >= q.length) return summary();
      saveResume('recall', S.track, q, i, got, label,
        { shaky: shaky.map(function (m) { return m.id; }) });
      var c = q[i];
      var head = '<div class="st-session-head"><span>' + esc(label) + '</span><span>' + (i + 1) + ' / ' + q.length + '</span></div>' +
        '<div class="st-prog" aria-hidden="true"><span style="width:' + Math.round(100 * i / q.length) + '%"></span></div>';
      produceFirstCard({
        card: c, opts: mcqOptions(c), head: head, quitText: 'End session', onQuit: summary, showShaky: true,
        onGrade: function (g) { grade(c.id, g); if (g === 3) got++; else shaky.push(c); i++; step(); }
      });
    }
    /* Parity with the ladder's ending: name what you dropped and offer to run just those.
       This summary used to be a score and one button — the audit's "every session
       dead-ends" finding — and Daily Review is the loop people actually live in. */
    function summary() {
      keyHandler(null);
      clearResume();
      if (label === 'Daily Review') noteDailyDone(i);
      var pct = i ? Math.round(100 * got / i) : 0;
      var missHtml = '';
      if (shaky.length) {
        missHtml = '<div class="st-sum-miss"><div class="st-sum-miss-head">Say these out loud before you close this tab</div>' +
          shaky.map(function (m) {
            var l = m.links && m.links[0];
            return '<div class="st-sum-miss-item">' + esc(m.q) +
              (l ? ' <a class="st-lad-quote-link" href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.t) + '</a>' : '') + '</div>';
          }).join('') +

          '</div>';
      }
      render('<div class="st-card st-summary"><div class="st-chip">' + esc(label) + '</div>' +
        '<div class="st-sum-num">' + got + '<span> of ' + i + ' solid</span></div>' +
        '<div class="st-prog st-prog-lg" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
        '<p class="st-sub">' + sumFlavor(pct, i) + '</p>' + missHtml +
        '<div class="st-actions">' +
        (shaky.length ? '<button class="st-btn st-btn-reveal" id="st-again">Go back over the ' + shaky.length + ' you dropped</button>' : '') +
        '<button class="st-btn' + (shaky.length ? ' st-btn-hint' : ' st-btn-reveal') + '" id="st-home">Back to Review</button>' +
        '</div></div>');
      if (shaky.length) el('st-again').onclick = function () { startSession(shaky.slice(), label); };
      el('st-home').onclick = backHome;
    }
    step();
  }
  function sumFlavor(pct, n) {
    if (!n) return 'Missed cards come back tomorrow; solid ones stretch out. Come back daily — short and often beats long and rare.';
    if (pct >= 90) return 'Board-ready pace. What you nailed stretches out on the schedule — tomorrow brings the few that got away.';
    if (pct >= 70) return 'Solid session. The misses come back tomorrow, right when they’re about to slip — that’s the system working.';
    return 'Good reps — every miss you just took is a question the board can’t surprise you with. They’ll circle back tomorrow.';
  }
  function interleave(cards) { // avoid same-topic adjacency where possible
    for (var i = 1; i < cards.length; i++) {
      if ((cards[i].topic || '') === (cards[i - 1].topic || '')) {
        for (var j = i + 1; j < cards.length; j++) {
          if ((cards[j].topic || '') !== (cards[i - 1].topic || '')) { var t = cards[i]; cards[i] = cards[j]; cards[j] = t; break; }
        }
      }
    }
    return cards;
  }

  /* ---- deep study: endless random cards, every topic in the mix ---- */
  function viewDeep(resumeCard, startSeen, startGot) {
    var pool = recallPool();
    var order = shuffle(pool.slice());
    var i = 0, seen = startSeen || 0, got = startGot || 0;
    var pending = resumeCard || null;   // the card you were on when you left
    function nextCard() {
      if (pending) { var p = pending; pending = null; return p; }
      if (i >= order.length) { order = shuffle(pool.slice()); i = 0; } // deck exhausted → reshuffle, keep going
      return order[i++];
    }
    function step() {
      var c = nextCard();
      /* Deep Study is endless, so its "place" is the card in front of you plus the tally —
         storing the whole shuffled order would persist hundreds of ids to no purpose. */
      saveResume('deep', S.track, [c], 0, got, 'Deep Study', { seen: seen });
      var head = '<div class="st-session-head"><span>Deep Study · endless</span><span>' + got + ' / ' + seen + ' solid</span></div>';
      produceFirstCard({
        card: c, opts: mcqOptions(c), head: head, quitText: 'That\u2019s enough for now', onQuit: summary, showShaky: false,
        onGrade: function (g) { grade(c.id, g); seen++; if (g === 3) got++; step(); }
      });
    }
    function summary() {
      keyHandler(null);
      clearResume();
      var pct = seen ? Math.round(100 * got / seen) : 0;
      render('<div class="st-card st-summary"><div class="st-chip">Deep Study</div>' +
        '<div class="st-sum-num">' + got + '<span> of ' + seen + ' solid</span></div>' +
        '<div class="st-prog st-prog-lg" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
        '<p class="st-sub">' + (seen ? sumFlavor(pct, seen) + ' ' : '') + 'Every answer here also updated your spaced schedule.</p>' +
        '<div class="st-actions"><button class="st-btn st-btn-reveal" id="st-home">Back to Review</button></div></div>');
      el('st-home').onclick = backHome;
    }
    step();
  }

  /* ---- threshold sprint (multiple choice, streak on correct) ---- */
  function viewSprint(resumeQ, startAt, startStreak) {
    var q = resumeQ || shuffle(deck.thresholds.slice());
    var i = startAt || 0, streak = startStreak || 0;
    function step() {
      if (i >= q.length) return done();
      saveResume('sprint', S.track, q, i, 0, 'Threshold Sprint', { streak: streak });
      var c = q[i];
      var opts = mcqOptions(c) || [c.a];
      /* Position + a progress bar, both of which the card session two views over already
         renders. The tool card advertises "40 thresholds" and the drill then never said
         where you were in them; best moves to the summary, which already leads with it. */
      render(
        '<div class="st-session-head"><span>Threshold Sprint</span><span>' + (i + 1) + ' / ' + q.length +
        ' · streak ' + streak + '</span></div>' +
        '<div class="st-prog" aria-hidden="true"><span style="width:' + Math.round(100 * i / q.length) + '%"></span></div>' +
        '<div class="st-card st-sprint" aria-live="polite">' +
        '<div class="st-q">' + esc(c.q) + '</div>' +
        '<div class="st-opts">' + opts.map(function (o, k) {
          return '<button class="st-opt" data-k="' + k + '"><kbd>' + (k + 1) + '</kbd><span>' + esc(o) + '</span></button>';
        }).join('') + '</div></div>' +
        '<button class="st-link st-quit" id="st-quit">End sprint</button>');
      el('st-quit').onclick = done;
      var answered = false;
      function pick(k) {
        if (answered) return; answered = true;
        var right = opts[k] === c.a;
        Array.prototype.forEach.call(app.querySelectorAll('.st-opt'), function (b) {
          var bk = +b.getAttribute('data-k'), kb = b.querySelector('kbd');
          if (opts[bk] === c.a) { b.classList.add('st-opt-right'); if (kb) kb.textContent = '✓'; }
          else if (bk === k) { b.classList.add('st-opt-wrong'); if (kb) kb.textContent = '✗'; }
          b.disabled = true;
        });
        if (right) { streak++; if (streak > (S.sprint.best || 0)) { S.sprint.best = streak; save(); } }
        else streak = 0;
        appendExplain(c, right);
        var act = document.createElement('div'); act.className = 'st-actions';
        act.innerHTML = '<button class="st-btn st-btn-reveal" id="st-next">Next <kbd>space</kbd></button>';
        app.querySelector('.st-card').appendChild(act);
        el('st-next').onclick = function () { i++; step(); };
        keyHandler(function (key) { if (key === ' ' || key === 'Enter') { i++; step(); return true; } });
        var sc = app.querySelector('.st-card');
        if (sc) { sc.setAttribute('tabindex', '-1');
                  try { sc.focus({ preventScroll: true }); } catch (e) { sc.focus(); } }
      }
      Array.prototype.forEach.call(app.querySelectorAll('.st-opt'), function (b) {
        b.onclick = function () { pick(+b.getAttribute('data-k')); };
      });
      keyHandler(function (k) {
        var n = parseInt(k, 10);
        if (n >= 1 && n <= opts.length) { pick(n - 1); return true; }
      });
    }
    function done() {
      keyHandler(null);
      clearResume();
      render('<div class="st-card st-summary"><div class="st-chip">Threshold Sprint</div>' +
        '<div class="st-sum-num">' + (S.sprint.best || 0) + '<span> best streak</span></div>' +
        '<p class="st-sub">Numbers rot fastest — sprint a few times a week and the board can’t rattle you with a dollar figure.</p>' +
        '<div class="st-actions"><button class="st-btn st-btn-reveal" id="st-home">' +
        (isOrg() ? 'Back to the tools' : 'Back to Review') + '</button></div></div>');
      el('st-home').onclick = backHome;
    }
    step();
  }

  /* ---- quick rounds: The Combination (daily vault word) · Which Part Governs (90s tempo) ----
     v2 — v1's three games retired (owner verdict: not fun). Design notes: one signature
     moment per game (the vault dial spinning open · the draining countdown ring), sub-100ms
     feedback on every input, a number worth beating, and a reason to come back at 0000Z. */
  function gamesState() {
    if (!S.games) S.games = {};
    S.games.combo = S.games.combo || { streak: { last: 0, run: 0 }, hist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, X: 0 }, day: 0, rows: [], done: false, win: false, hints: 0 };
    S.games.governs = S.games.governs || { best: 0, bestCombo: 0 };
    S.games.log = S.games.log || {}; // dayNum → true when any game was completed that day
    // Normalize today's Combination round in one place (both the hub card and the game view
    // read state through here): roll over on a new day, AND reset when the word for today
    // changed — so a stale round played against the old (longer) word can't render against
    // the new five-letter answer. Guarded to no-op until the deck/pool is available.
    if (deck && deck.games && deck.games.combination && deck.games.combination.length) {
      var _cd = comboToday(), _e = comboWordFor(_cd), _cb = S.games.combo;
      if (_e && _e.w && (_cb.day !== _cd || _cb.wk !== comboKey(_e.w))) {
        _cb.day = _cd; _cb.wk = comboKey(_e.w); _cb.rows = []; _cb.done = false; _cb.win = false; _cb.hints = 0; save();
      }
    }
    return S.games;
  }
  // Accept lists, packed as fixed-width strings and unpacked per length on first use.
  // Five letters keeps Wordle's generous list (games.dict, already shipped); 6-8 come from
  // games.dict_ext, drawn from the corpus itself by scripts/build_combo_dict.py — general
  // English at those lengths costs ~530KB and would roughly double the deck, which is a bad
  // trade for an offline PWA. A rejected guess reads "Not in the rulebook."
  var _comboDict = {};
  function comboDictHas(w) {
    var n = w.length, i;
    if (!_comboDict[n]) {
      var set = new Set();
      if (n === 5) {
        var d = (deck.games && deck.games.dict) || '';
        for (i = 0; i + 5 <= d.length; i += 5) set.add(d.slice(i, i + 5));
      }
      var ext = (deck.games && deck.games.dict_ext && deck.games.dict_ext[n]) || '';
      for (i = 0; i + n <= ext.length; i += n) set.add(ext.slice(i, i + n));
      _comboDict[n] = set;
    }
    return _comboDict[n].has(w);
  }
  function gamesMarkToday() { gamesState().log[comboToday()] = true; }
  function gamesHubStreak() { // consecutive active days, weekends never break it
    var log = gamesState().log, day = comboToday(), run = 0, d = day;
    if (!log[d]) { d--; while (d > day - 4 && isWeekend(d)) d--; if (!log[d]) return 0; }
    while (log[d] || isWeekend(d)) { if (log[d]) run++; d--; if (run > 400) break; }
    return run;
  }
  // The combination flips at 5 a.m. Central, not midnight Zulu (which landed at 7pm Central
  // the evening before). A FIXED UTC OFFSET WOULD BE WRONG HALF THE YEAR: 5am CST is 11:00Z
  // but 5am CDT is 10:00Z, so a hardcoded offset drifts an hour twice a year. Ask Intl for
  // Chicago's actual offset at the instant in question instead. Everyone still flips at one
  // global instant, so "same word for everyone" holds.
  var COMBO_TZ = 'America/Chicago', COMBO_RESET_H = 5;
  function tzOffsetMs(t) {
    try {
      var p = {}, f = new Intl.DateTimeFormat('en-US', {
        timeZone: COMBO_TZ, hour12: false, year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      f.formatToParts(new Date(t)).forEach(function (x) { p[x.type] = x.value; });
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
             - Math.floor(t / 1000) * 1000;
    } catch (e) { return -6 * 3600000; }   // no Intl: fall back to standard time
  }
  function comboToday(t) {
    t = (t === undefined) ? Date.now() : t;
    return Math.floor((t + tzOffsetMs(t) - COMBO_RESET_H * 3600000) / 86400000);
  }
  function comboResetAt(day) {   // the instant round `day` ends, in real epoch ms
    // `approx` is a pseudo-LOCAL timestamp, so asking for the offset AT approx samples the
    // zone ~5h before the true roll — on a DST-transition day that is the wrong side of the
    // change and the countdown came out an hour off. Converge: offset at approx gives a
    // first real instant, then re-read the offset there.
    var approx = (day + 1) * 86400000 + COMBO_RESET_H * 3600000;
    var t = approx - tzOffsetMs(approx);
    return approx - tzOffsetMs(t);
  }
  var COMBO_EPOCH = comboToday(Date.UTC(2026, 6, 12, 12)); // No. 1 = 12 Jul 2026, Central
  function comboNo(day) { return day - COMBO_EPOCH + 1; }
  // FIVE LETTERS ONLY. The 6-8 letter words played as too hard / arbitrary (owner call,
  // 2026-07-23), so the pool is filtered to length 5. The full pool stays in the deck data
  // and the 6-8 accept lists remain shipped, so the longer ladder can be restored by
  // dropping this filter — no data regen needed.
  var _combo5 = null;
  function comboPool() {
    if (!_combo5) _combo5 = (deck.games.combination || []).filter(function (e) { return e.w && e.w.length === 5; });
    return _combo5;
  }
  function comboWordFor(day) {
    var pool = comboPool();
    if (!pool.length) return { w: '' };
    return pool[((day - COMBO_EPOCH) % pool.length + pool.length) % pool.length];
  }
  // Non-reversible key for the day's answer, so a changed word invalidates a stale saved
  // round (length/word mismatch) without ever storing the answer in plaintext.
  function comboKey(w) { var h = 0, i; for (i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; return h; }
  // day index counts from the 5am boundary, so add it back to land on the Central calendar date
  function isWeekend(day) {
    var dow = new Date(day * 86400000 + COMBO_RESET_H * 3600000).getUTCDay();
    return dow === 0 || dow === 6;
  }
  function comboBumpStreak(win) { // duty-day streak: weekends never break it
    var st = gamesState().combo.streak, day = comboToday();
    if (!win) { st.run = 0; st.last = day; return; }
    var d = st.last + 1;
    while (d < day && isWeekend(d)) d++;
    st.run = (st.last && d === day) ? st.run + 1 : 1;
    st.last = day;
  }
  var DIAL_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="50" cy="50" r="34"/><circle cx="50" cy="50" r="12"/></g><g stroke="currentColor" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="8" x2="50" y2="20"/><line x1="50" y1="92" x2="50" y2="80"/><line x1="8" y1="50" x2="20" y2="50"/><line x1="92" y1="50" x2="80" y2="50"/><line x1="20.3" y1="20.3" x2="28.8" y2="28.8"/><line x1="79.7" y1="20.3" x2="71.2" y2="28.8"/><line x1="20.3" y1="79.7" x2="28.8" y2="71.2"/><line x1="79.7" y1="79.7" x2="71.2" y2="71.2"/></g><circle cx="50" cy="50" r="4" fill="currentColor"/></svg>';

  function nextRoundLine() {
    var at = comboResetAt(comboToday()), ms = Math.max(0, at - Date.now());
    var h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
    var local = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return 'New round in ' + h + 'h ' + (m < 10 ? '0' : '') + m + 'm — ' + local + ' your time';
  }
  /* ---- Combination hints ----------------------------------------------------------------
     Two at most, and each one SPENDS a try. That is the whole design: a hint is not free
     help, it is a trade you make against the six rows you were given, so the honest score
     for a solved round is rows + hints.

     A hint must narrow the field without handing the word over. The ladder runs weakest to
     strongest — where the term lives, then what it means — because a candidate who knows the
     part is still guessing, while one who knows the definition usually is not. */
  var COMBO_MAX_HINTS = 2;
  var ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

  /* The gloss is only a clue while it does not contain the answer, and 53 of the 128 entries
     name the term inside their own definition ("…the HCA WAIVING certified cost data", "The
     BOARD of Contract Appeals"). Redact by STEM so inflections go with it, and replace the
     whole token with a fixed bar — sizing the bar to the match would leak the letter count of
     the inflected form, which is not the answer's length anyway. Over-redaction is harmless
     here; under-redaction ends the round. */
  function comboRedact(text, word) {
    if (!text || !word) return text || '';
    var stem = word.slice(0, Math.max(4, word.length - 2)).toUpperCase();
    return text.replace(/[A-Za-z][A-Za-z’'\-]*/g, function (tok) {
      return tok.toUpperCase().indexOf(stem) > -1 ? '▮▮▮▮' : tok;
    });
  }
  /* Always exactly two rungs. 8 of the 128 entries carry no citation, and rather than offer a
     shorter ladder on those days the last rung falls back to the smallest concrete assist
     there is: one letter, in place. The MIDDLE letter specifically — it is fixed by the word
     alone, so the hint cannot quietly grow into a better hint as the board fills up. */
  function comboHintList(entry, target) {
    var out = [];
    if (entry.cite) out.push({ k: 'Where it lives', v: entry.cite });
    out.push({ k: 'What it means', v: comboRedact(entry.def, target) });
    if (out.length < COMBO_MAX_HINTS) {
      var i = Math.floor(target.length / 2);
      out.push({ k: 'One letter', v: 'The ' + ORD[i] + ' letter is “' + target[i] + '”.' });
    }
    return out.slice(0, COMBO_MAX_HINTS);
  }
  // Solved-in score, hints included. One place, because the board, the share text, the
  // histogram and the hub card must never disagree about what a round cost.
  function comboScore(G) { return G.rows.length + (G.hints || 0); }

  function comboGridMini(G) { // tiny result grid for the status card
    var entry = comboWordFor(G.day), target = entry.w, n = target.length;
    return G.rows.map(function (g) {
      var res = [], left = {}, i;
      for (i = 0; i < n; i++) { if (g[i] === target[i]) res[i] = 'c'; else { res[i] = 'a'; left[target[i]] = (left[target[i]] || 0) + 1; } }
      for (i = 0; i < n; i++) if (res[i] === 'a' && left[g[i]]) { res[i] = 'p'; left[g[i]]--; }
      return '<span class="st-hub-gridrow">' + res.map(function (r) { return '<i class="st-hub-cell st-hub-cell-' + r + '"></i>'; }).join('') + '</span>';
    }).join('');
  }
  // The "Quick rounds" section — rendered straight onto the main tool-select page (no
  // separate hub screen). Returns HTML; wireGamesSection() attaches the launch handlers.
  function gamesSectionHtml() {
    var G = gamesState();
    var day = comboToday(), no = comboNo(day);
    var comboDone = G.combo.day === day && G.combo.done;
    var govToday = G.gov_day && G.gov_day.day === day && G.gov_day.plays > 0 ? G.gov_day : null;
    var allDone = comboDone && govToday;
    var run = gamesHubStreak();
    var gv = G.governs;
    var gvBest = gv.best_advanced || gv.best || 0;
    var donePanel = allDone
      ? '<div class="st-hub-done"><div class="st-hub-done-mark">\u2713</div><div><b>That\u2019s today\u2019s round.</b>' +
        '<span>' + (G.combo.win ? 'Combination cracked in ' + comboScore(G.combo) : 'The combination held') + ' \u00b7 tempo best today ' + govToday.best.toLocaleString() + '. ' + esc(nextRoundLine()) + '.</span></div></div>'
      : '';
    var comboCard = comboDone
      ? '<button class="st-plate st-plate-done" id="g-combo">' +
        '<span class="st-plate-eyebrow">Daily \u00b7 No. ' + no + ' \u00b7 ' + (G.combo.win ? 'Solved in ' + comboScore(G.combo) : 'Sealed') + '</span>' +
        '<span class="st-plate-art st-hub-grid" aria-hidden="true">' + comboGridMini(G.combo) + '</span>' +
        '<b>The Combination</b>' +
        '<span class="st-plate-sub">' + (G.combo.win ? 'Cracked. The word was worth knowing \u2014 the debrief has the cite.' : 'Sealed for today \u2014 see the word and its cite in the debrief.') + '</span>' +
        '<span class="st-plate-meta">View result &amp; copy your grid \u2192</span></button>'
      : '<button class="st-plate" id="g-combo">' +
        '<span class="st-plate-eyebrow">Daily \u00b7 No. ' + no + '</span>' +
        '<span class="st-plate-art" aria-hidden="true">' +
        'VAULT'.split('').map(function (ch, i) {
          return '<span class="st-mini-tile' + (i === 1 || i === 4 ? ' st-mini-hit' : (i === 2 ? ' st-mini-near' : '')) + '">' + ch + '</span>';
        }).join('') + '</span>' +
        '<b>The Combination</b>' +
        '<span class="st-plate-sub">Guess today\u2019s term of the trade in six tries \u2014 Wordle, for the acquisition world. Same word for everyone.</span>' +
        '<span class="st-plate-meta">Play today\u2019s word \u2192</span></button>';
    var govMeta = govToday
      ? 'Today\u2019s best ' + govToday.best.toLocaleString() + (gvBest > govToday.best ? ' \u00b7 record ' + gvBest.toLocaleString() : ' \u00b7 that\u2019s your record') + ' \u00b7 run it again \u2192'
      : (gvBest ? 'Personal best ' + gvBest.toLocaleString() + ' \u00b7 play \u2192' : 'No score on the board yet \u00b7 play \u2192');
    var scen = deck.scenarios, scenDone = scen.filter(function (x) { return S.scen[x.id]; }).length;
    var scenReady = scen.filter(function (x) { return S.scen[x.id] === 3; }).length;
    return '<div class="st-tools-label">Interactive practice · jump in any time</div>' +
      '<div class="st-games-head"><h2 class="st-h2" style="margin:2px 0 0">Practice Range</h2>' +
      (run >= 2 ? '<span class="st-streak" title="Days in a row with at least one round played \u2014 weekends don\u2019t break it"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l1.4 3.1L10.8 5 8.4 7.2l.7 3.3L6 8.8l-3.1 1.7.7-3.3L1.2 5l3.4-.9z"/></svg>' + run + '-day streak</span>' : '') +
      '</div>' +
      '<p class="st-sub">Practice by deciding, not reviewing \u2014 from the daily word to a 90-second reflex round to a full source selection you sit down with.</p>' +
      '<div class="st-sims">' +
      '<a class="st-sim-feature" href="/source-selection">' +
      '<span class="st-sim-kick">Simulator</span>' +
      '<b class="st-sim-title">Source Selection Simulator</b>' +
      '<span class="st-sim-desc">Take the Source Selection Authority\u2019s chair on a $250M best-value tradeoff \u2014 nine decisions, a live protest-risk score, and every call cited to the DoD Source Selection Procedures.</span>' +
      '<span class="st-sim-chips"><span class="st-sim-chip">\u2248 18 min</span><span class="st-sim-meta">$250M best-value \u00b7 9 decisions \u00b7 untimed</span></span>' +
      '<span class="st-sim-go" aria-hidden="true">\u2192</span></a>' +
      '<button class="st-sim-feature" id="g-board">' +
      '<span class="st-sim-kick">Simulator</span>' +
      '<b class="st-sim-title">Board Simulator</b>' +
      '<span class="st-sim-desc">Sit the board. A panel puts a situation to you, you answer out loud, then the debrief and its follow-ups press on the parts you left thin \u2014 every call cited.</span>' +
      '<span class="st-sim-chips"><span class="st-sim-chip">' + scen.length + ' scenarios</span><span class="st-sim-meta">' +
      (scenDone ? scenDone + ' faced \u00b7 ' + scenReady + ' board-ready' : 'answer aloud \u00b7 untimed \u00b7 follow-ups') + '</span></span>' +
      '<span class="st-sim-go" aria-hidden="true">\u2192</span></button>' +
      '</div>' +
      donePanel +
      '<div class="st-plates">' + comboCard +
      '<button class="st-plate' + (govToday ? ' st-plate-played' : '') + '" id="g-governs">' +
      '<span class="st-plate-eyebrow">Tempo \u00b7 90 seconds' + (govToday ? ' \u00b7 played today' : '') + '</span>' +
      '<span class="st-plate-art st-plate-art-ring" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="none" stroke="rgba(228,196,119,.25)" stroke-width="4"/><circle cx="24" cy="24" r="19" fill="none" stroke="#e4c477" stroke-width="4" stroke-linecap="round" stroke-dasharray="119.4" stroke-dashoffset="30" transform="rotate(-90 24 24)"/></svg><span class="st-plate-ring-n">90</span></span>' +
      '<b>Which Part Governs?</b>' +
      '<span class="st-plate-sub">A situation flashes \u2014 call the part of the rulebook that governs it before the clock runs out. Combos multiply; misses teach.</span>' +
      '<span class="st-plate-meta">' + govMeta + '</span></button>' +
      '</div>';
  }
  function wireGamesSection() {
    if (el('g-combo')) el('g-combo').onclick = function () { depth1View = viewCombo; goDepth(1, viewCombo); };
    if (el('g-governs')) el('g-governs').onclick = function () { depth1View = viewGoverns; goDepth(1, viewGoverns); };
    // Board Sim is track-independent (it reads deck.scenarios), so it runs straight from
    // the landing page without a module chosen first.
    if (el('g-board')) el('g-board').onclick = function () { goDepth(1, viewBoard); };
  }

  /* ---- The Warrant Ladder — rung-scoped recall, every answer backed by the regulation's
     own words (deck.ladder, built + verified by build_deck_v2.py). Lives ONLY on the
     unlisted /48cons page (MODE === '48cons'); it no longer renders on public /study. The
     four rungs are legal authority levels — all always available, never gated. Ladder ids
     are globally unique and share the same per-card scheduler (grade/cardState) but the
     pools stay out of recallPool() entirely. */
  /* KILL SWITCH. Set to false and the ladder disappears from /48cons — no other edit
     required, no deck rebuild, nothing else on that page or /study affected. Flip it, bump
     STUDY_V in api/_seo.js and the sw.js cache, push.
     To remove the feature outright rather than hide it, see docs/WARRANT_LADDER.md. */
  var LADDER_ENABLED = true;

  /* The ceiling is the hero of each rung — it is the most motivating thing on the card and
     the thing a candidate actually organises around. `what` says which material lives there
     so the rungs read as coverage rather than as difficulty settings. */
  var RUNGS = [
    { k: 'sat', label: 'SAT · $350K', ceiling: '$350K', what: 'Simplified acquisitions (SAT)' },
    { k: '5m', label: '$5M', ceiling: '$5M', what: 'Competition &amp; ordering' },
    { k: '25m', label: '$25M', ceiling: '$25M', what: 'Source selection &amp; pricing' },
    { k: 'unlimited', label: 'Unlimited', ceiling: 'Unlimited', what: 'Senior authority' }
  ];
  /* ---- My Cards -------------------------------------------------------------------------
     Robert Maughan's deck-customisation idea, built so it cannot dilute the corpus deck.

     ⚠ THE THREE RULES THIS DEPENDS ON — do not relax them:
     1. User cards NEVER merge into the ladder rungs, the recall pools or any count. They are
        a separate deck with a separate study view. A card typed with a wrong threshold would
        otherwise be indistinguishable from a corpus-verified one, and the bank this idea came
        from teaches SAT $250K and MPT $10K. Every card here is labelled as theirs and
        unverified, on the list AND while studying.
     2. Its own localStorage key. S is written through save(), a silent try/catch — a 100-card
        deck sharing that key could push the whole object past quota and destroy study
        progress with nothing surfaced. Separate key, hard caps, and a real message when it
        will not fit.
     3. Files, not servers. Export/import is the entire sync story; the repo is pinned at the
        Vercel Hobby 12-function cap, so there is no endpoint to add even if we wanted one.
     Import accepts only files this tool exported — the legacy decks this idea came from carry
     289 legacy FAR citations and superseded thresholds. */
  var MY_KEY = 'acq-mycards-v1';
  var MY_MAX = 100;              // cards
  var MY_BYTES = 64 * 1024;      // serialized ceiling, well inside a 5MB origin budget
  var MY_Q = 300, MY_A = 1200, MY_SUBJ = 60;
  var MY = null, myErr = '', myEditId = null;

  function myDeck() {
    if (!MY) {
      MY = { v: 1, cards: [] };
      try {
        var raw = JSON.parse(localStorage.getItem(MY_KEY));
        if (raw && Object.prototype.toString.call(raw.cards) === '[object Array]') {
          MY = { v: 1, cards: raw.cards.filter(myValid).slice(0, MY_MAX) };
        }
      } catch (e) {}
    }
    return MY;
  }
  function myValid(c) {
    return !!(c && typeof c.q === 'string' && typeof c.a === 'string' && c.q.trim() && c.a.trim());
  }
  function myBytes() { try { return JSON.stringify(myDeck()).length; } catch (e) { return 0; } }
  /* Returns false and sets myErr rather than failing silently — the quota-swallow that once
     cost people their saved clauses started exactly like this. */
  function mySave() {
    var s;
    try { s = JSON.stringify(myDeck()); } catch (e) { myErr = 'Could not read your deck.'; return false; }
    if (s.length > MY_BYTES) {
      myErr = 'Your deck is at its size limit. Delete a card, or export and trim it.';
      return false;
    }
    try { localStorage.setItem(MY_KEY, s); myErr = ''; return true; }
    catch (e) {
      myErr = 'Your browser refused to save — storage may be full, or blocked in private ' +
        'browsing. Export your deck so you do not lose it.';
      return false;
    }
  }
  function myId() {
    return 'my-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }
  function myAdd(q, a, subj) {
    var d = myDeck();
    if (d.cards.length >= MY_MAX) { myErr = 'That is ' + MY_MAX + ' cards — the most this holds.'; return false; }
    d.cards.push({ id: myId(), q: String(q).slice(0, MY_Q).trim(),
                   a: String(a).slice(0, MY_A).trim(), subj: String(subj || '').slice(0, MY_SUBJ).trim() });
    return mySave();
  }
  function myUpdate(id, q, a, subj) {
    var c = myDeck().cards.filter(function (x) { return x.id === id; })[0];
    if (!c) return false;
    c.q = String(q).slice(0, MY_Q).trim(); c.a = String(a).slice(0, MY_A).trim();
    c.subj = String(subj || '').slice(0, MY_SUBJ).trim();
    return mySave();
  }
  function myDelete(id) {
    var d = myDeck();
    d.cards = d.cards.filter(function (x) { return x.id !== id; });
    return mySave();
  }
  function myExport() {
    var blob = new Blob([JSON.stringify({ acqvault_mycards: 1, v: 1, cards: myDeck().cards }, null, 2)],
      { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'my-cards.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 0);
  }
  function myImport(ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = '';                       // let the same file be chosen twice
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      var parsed;
      try { parsed = JSON.parse(r.result); }
      catch (e) { myErr = 'That file is not readable JSON.'; viewMyCards(); return; }
      // Only files this tool wrote. A legacy deck would import superseded thresholds and
      // legacy FAR citations wearing exactly the same styling as everything else here.
      if (!parsed || !parsed.acqvault_mycards) {
        myErr = 'That is not a My Cards export from this tool.'; viewMyCards(); return;
      }
      var incoming = (Object.prototype.toString.call(parsed.cards) === '[object Array]' ? parsed.cards : [])
        .filter(myValid).slice(0, MY_MAX);
      if (!incoming.length) { myErr = 'That file has no usable cards in it.'; viewMyCards(); return; }
      var have = myDeck().cards.length;
      if (have && !confirm('Replace your ' + have + ' card' + (have === 1 ? '' : 's') +
          ' with the ' + incoming.length + ' in this file? This cannot be undone.')) return;
      var prevMY = MY;
      MY = { v: 1, cards: incoming.map(function (c) {
        return { id: c.id || myId(), q: String(c.q).slice(0, MY_Q), a: String(c.a).slice(0, MY_A),
                 subj: String(c.subj || '').slice(0, MY_SUBJ) };
      }) };
      // If the save is refused (size ceiling, quota), showing the imported deck would be a
      // lie — it was never written, and a reload silently reverts. Put the old deck back.
      if (!mySave()) { MY = prevMY; myErr = 'Import cancelled — your cards are untouched. ' + myErr; }
      myEditId = null; viewMyCards();
    };
    r.onerror = function () { myErr = 'Could not read that file.'; viewMyCards(); };
    r.readAsText(f);
  }

  var MY_UNVERIFIED = 'Yours · not corpus-verified';
  function myKb(n) { return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }
  // Counted, never typed. A hardcoded total is a number that goes quietly wrong the next time
  // the deck is rebuilt — the same way "500+ questions" outlived the ladder leaving /study.
  function ladderTotal() {
    if (!deck || !deck.ladder) return 0;
    return RUNGS.reduce(function (n, r) { return n + ladderPool(r.k).length; }, 0);
  }
  function viewMyCards() {
    var d = myDeck(), cards = d.cards;
    var editing = myEditId && cards.filter(function (c) { return c.id === myEditId; })[0];
    var full = cards.length >= MY_MAX;
    render(
      '<div class="st-session-head"><span>My Cards</span><span>' + cards.length + ' of ' + MY_MAX + '</span></div>' +
      '<div class="st-card">' +
      '<p class="st-sub" style="margin-top:0">Cards you write yourself — local policy, your ' +
      'squadron’s approval chains, anything the rulebook cannot know. They are kept apart from ' +
      'the ' + ladderTotal() + ' corpus cards and never mixed into the ladder, because only the ' +
      'corpus ones are checked against the regulation.</p>' +
      (myErr ? '<p class="st-my-err" role="alert">' + esc(myErr) + '</p>' : '') +
      '<label class="st-bd-bluf-lab" for="my-q">' + (editing ? 'Edit the question' : 'Question') + '</label>' +
      '<textarea class="st-bd-bluf st-intro-ta" id="my-q" rows="2" maxlength="' + MY_Q + '" ' +
      'placeholder="e.g. Who approves a sole-source above $5M at this squadron?">' +
      esc(editing ? editing.q : '') + '</textarea>' +
      '<label class="st-bd-bluf-lab" for="my-a">Answer</label>' +
      '<textarea class="st-bd-bluf st-intro-ta" id="my-a" rows="3" maxlength="' + MY_A + '" ' +
      'placeholder="Write it the way you would say it to the panel.">' +
      esc(editing ? editing.a : '') + '</textarea>' +
      '<label class="st-bd-bluf-lab" for="my-subj">Subject <span class="st-my-opt">(optional)</span></label>' +
      '<input class="st-bd-bluf" id="my-subj" type="text" maxlength="' + MY_SUBJ + '" autocomplete="off" ' +
      'placeholder="e.g. Local policy" value="' + esc(editing ? (editing.subj || '') : '') + '">' +
      '<div class="st-actions">' +
      '<button class="st-btn st-btn-reveal" id="my-save"' + (!editing && full ? ' disabled' : '') + '>' +
      (editing ? 'Save changes' : 'Add card') + '</button>' +
      (editing ? '<button class="st-btn st-btn-hint" id="my-cancel">Cancel</button>' : '') +
      '</div>' +
      (!editing && full ? '<p class="st-my-meta">Deck is full at ' + MY_MAX + ' cards.</p>' : '') +
      '</div>' +

      (cards.length
        ? '<div class="st-my-list">' + cards.map(function (c) {
            return '<div class="st-my-item"><div class="st-my-item-top">' +
              '<span class="st-my-tag">' + MY_UNVERIFIED + '</span>' +
              (c.subj ? '<span class="st-my-subj">' + esc(c.subj) + '</span>' : '') + '</div>' +
              '<div class="st-my-q">' + esc(c.q) + '</div>' +
              '<div class="st-my-a">' + esc(c.a) + '</div>' +
              '<div class="st-my-row">' +
              '<button class="st-link st-my-act" data-my-edit="' + esc(c.id) + '">Edit</button>' +
              '<button class="st-link st-my-act" data-my-del="' + esc(c.id) + '">Delete</button>' +
              '</div></div>';
          }).join('') + '</div>'
        : '<p class="st-sub">No cards yet. The box above writes your first one.</p>') +

      '<div class="st-my-bar">' +
      (cards.length ? '<button class="st-btn st-btn-reveal" id="my-study">Study these ' + cards.length + '</button>' : '') +
      (cards.length ? '<button class="st-btn st-btn-hint" id="my-export">Export .json</button>' : '') +
      '<button class="st-btn st-btn-hint" id="my-import-btn">Import .json</button>' +
      '<input type="file" id="my-import" accept="application/json,.json" hidden>' +
      '</div>' +
      // Suppressed on an empty deck: it reported "18 B used on this device" for the JSON
      // envelope alone. The privacy promise is already in the footer and on the tool card.
      (cards.length
        ? '<p class="st-my-meta">' + myKb(myBytes()) + ' used on this device · never uploaded · ' +
          'export to move them to another machine or share them.</p>'
        : '') +
      '<button class="st-link st-quit" id="st-quit">← Warrant board prep</button>');

    el('st-quit').onclick = function () { myEditId = null; myErr = ''; goDepth(0, view48Cons); };
    el('my-save').onclick = function () {
      var qv = el('my-q').value.trim(), av = el('my-a').value.trim(), sv = el('my-subj').value.trim();
      if (!qv || !av) { myErr = 'A card needs both a question and an answer.'; viewMyCards(); return; }
      if (myEditId) { myUpdate(myEditId, qv, av, sv); myEditId = null; }
      else myAdd(qv, av, sv);
      viewMyCards();
    };
    if (el('my-cancel')) el('my-cancel').onclick = function () { myEditId = null; myErr = ''; viewMyCards(); };
    Array.prototype.forEach.call(app.querySelectorAll('[data-my-edit]'), function (b) {
      b.onclick = function () { myEditId = b.getAttribute('data-my-edit'); myErr = ''; viewMyCards(); };
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-my-del]'), function (b) {
      b.onclick = function () {
        if (!confirm('Delete this card? It is only on this device, so it cannot be recovered.')) return;
        myDelete(b.getAttribute('data-my-del'));
        if (myEditId === b.getAttribute('data-my-del')) myEditId = null;
        viewMyCards();
      };
    });
    if (el('my-study')) el('my-study').onclick = function () { goDepth(2, viewMyStudy); };
    if (el('my-export')) el('my-export').onclick = myExport;
    el('my-import-btn').onclick = function () { el('my-import').click(); };
    el('my-import').onchange = myImport;
  }

  /* A plain flip review, deliberately NOT the corpus scheduler. grade()/S.cards is keyed by
     corpus card ids and feeds mastery and "what would sink you"; letting user-written cards
     into it would put unverified material into the numbers the ladder reports. */
  function viewMyStudy(startAt) {
    var cards = myDeck().cards.slice();
    if (!cards.length) { viewMyCards(); return; }
    var q = shuffle(cards), i = startAt || 0;
    function step() {
      if (i >= q.length) {
        render('<div class="st-card st-summary"><div class="st-chip">My Cards</div>' +
          '<div class="st-sum-num">' + q.length + '<span> reviewed</span></div>' +
          '<p class="st-sub">These are your own notes, so nothing here changed your ladder ' +
          'mastery — that number only counts cards checked against the regulation.</p>' +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="my-again">Go again</button>' +
          '<button class="st-btn st-btn-hint" id="my-back">Back to my cards</button></div></div>');
        el('my-again').onclick = function () { i = 0; q = shuffle(cards); step(); };
        el('my-back').onclick = function () { keyHandler(null); viewMyCards(); };
        keyHandler(null);
        return;
      }
      var c = q[i];
      render(
        '<div class="st-session-head"><span>My Cards</span><span>' + (i + 1) + ' / ' + q.length + '</span></div>' +
        '<div class="st-prog" aria-hidden="true"><span style="width:' + Math.round(100 * i / q.length) + '%"></span></div>' +
        '<div class="st-card" aria-live="polite">' +
        '<div class="st-chip">' + esc(c.subj || 'Your card') + '</div>' +
        '<div class="st-q">' + esc(c.q) + '</div>' +
        '<div id="st-a" class="st-a" hidden>' + esc(c.a) +
        '<p class="st-my-warn">' + MY_UNVERIFIED + ' — this is what you wrote, not what the ' +
        'rulebook says. Check it against the regulation before you rely on it.</p></div>' +
        '<div class="st-actions" id="st-act">' +
        '<button class="st-btn st-btn-reveal" id="st-reveal">Reveal <kbd>space</kbd></button></div></div>' +
        '<button class="st-link st-quit" id="st-quit">End review</button>');
      el('st-quit').onclick = function () { keyHandler(null); viewMyCards(); };
      el('st-reveal').onclick = reveal;
      keyHandler(function (k) { if (k === ' ' || k === 'Enter') { reveal(); return true; } });
      function reveal() {
        el('st-a').hidden = false;
        el('st-act').innerHTML = '<button class="st-btn st-btn-reveal" id="my-next">Next <kbd>space</kbd></button>';
        el('my-next').onclick = function () { i++; step(); };
        keyHandler(function (k) { if (k === ' ' || k === 'Enter') { i++; step(); return true; } });
      }
    }
    step();
  }

  /* ---- topic vocabulary -----------------------------------------------------------------
     The authored decks drifted into split labels for one subject — "Competition (CICA)" (12
     cards) alongside a bare "Competition" (2), and "Contract Finance & Fiscal Law" (6)
     alongside "Contract Financing" (1). Harmless while `topic` was an internal field; the
     moment it became a user-facing filter it would have offered the same subject twice.

     Merged HERE, once, over the loaded deck rather than in the authoring files, because
     `topic` is also the join `bridgePool()` uses to match a board sim to the cards behind it
     (`c.topic === sc.topic`). Rewriting one side in data and not the other would break that
     bridge silently. Canonicalising both pools at load keeps a single source of truth and
     needs no deck rebuild. Promote into build_deck_v2.py if the authoring files are ever
     cleaned up. */
  var TOPIC_CANON = {
    'Competition': 'Competition (CICA)',
    'Contract Financing': 'Contract Finance & Fiscal Law'
  };
  function canonTopic(t) { return TOPIC_CANON[t] || t; }
  function canonTopics() {
    if (!deck) return;
    [deck.ladder, deck.ladder_boards].forEach(function (group) {
      if (!group) return;
      Object.keys(group).forEach(function (k) {
        (group[k] || []).forEach(function (c) { if (c && c.topic) c.topic = canonTopic(c.topic); });
      });
    });
  }

  function ladderPool(rung) { return (deck.ladder && deck.ladder[rung]) || []; }
  /* Topics present on THIS rung, commonest first — the rungs differ a lot (18 subjects at
     SAT, 7 at $25M), so the list is built per rung rather than from the whole ladder. */
  function ladderTopics(rung) {
    var n = {};
    ladderPool(rung).forEach(function (c) { var t = c.topic || 'Other'; n[t] = (n[t] || 0) + 1; });
    return Object.keys(n).map(function (t) { return { t: t, n: n[t] }; })
      .sort(function (a, b) { return b.n - a.n || a.t.localeCompare(b.t); });
  }
  /* A selection only survives while it exists on the rung you are looking at — switching
     rungs must never leave you filtered to a subject with nothing in it. */
  function ladderTopicSel(rung) {
    var t = S.ladderTopic;
    return (t && ladderTopics(rung).some(function (x) { return x.t === t; })) ? t : '';
  }
  /* Hiding a corpus card is the cheap half of deck customisation: no authoring, no storage
     pressure, no question of provenance — just a list of ids the drill skips. Nothing is
     deleted, so it is always reversible, and the rung chips keep showing the true totals. */
  function hiddenMap() { if (!S.hidden) S.hidden = {}; return S.hidden; }
  function isHidden(id) { return !!hiddenMap()[id]; }
  function hideCard(id) { hiddenMap()[id] = 1; save(); }
  function unhideRung(rung) {
    var H = hiddenMap();
    ladderPool(rung).forEach(function (c) { delete H[c.id]; });
    save();
  }
  function hiddenIn(rung) {
    return ladderPool(rung).filter(function (c) { return isHidden(c.id); }).length;
  }
  function ladderTopicPool(rung) {
    var sel = ladderTopicSel(rung);
    var pool = ladderPool(rung).filter(function (c) { return !isHidden(c.id); });
    return sel ? pool.filter(function (c) { return c.topic === sel; }) : pool;
  }
  function ladderRung() {
    var r = S.ladderRung;
    return RUNGS.some(function (x) { return x.k === r; }) ? r : 'sat';
  }
  function ladderNoteMiss(id) { // most-recent-first, for "What would sink you"
    var lm = (S.ladderMiss || []).filter(function (x) { return x !== id; });
    lm.unshift(id);
    if (lm.length > 50) lm.length = 50;
    S.ladderMiss = lm; // grade() saves right after
  }
  function ladderCiteHtml(c) { // the point of the feature: the regulation's own words, in the card body
    if (!c.cite || !c.cite.quote) return '';
    var l = c.cite.link;
    var out = '<figure class="st-lad-q">' +
      (l ? '<figcaption class="st-lad-q-bar"><a class="st-lad-q-src" href="' + esc(l.u) + '">' + esc(l.t) + '</a></figcaption>' : '') +
      '<blockquote class="st-lad-q-body">“' + esc(c.cite.quote) + '”</blockquote></figure>';
    // Where DoD deviates, the deviation is the operative rule for this audience — so it
    // gets the same treatment as the baseline, not a footnote.
    var d = c.dod;
    if (d && d.quote && d.link) {
      out += '<figure class="st-lad-q st-lad-q-dod"><figcaption class="st-lad-q-bar"><span class="st-lad-q-dodtag">DoD deviation</span><a class="st-lad-q-src" href="' + esc(d.link.u) + '">' +
        esc(d.link.t) + '</a></figcaption><blockquote class="st-lad-q-body">“' +
        esc(d.quote) + '”</blockquote></figure>';
    }
    return out;
  }
  /* nav=true on the 48 CONS home view, where a rung OPENS the ladder; nav is omitted in
     viewLadder, where the same strip FILTERS in place. The two are not the same control:
     aria-pressed describes a toggle and is only honest in the filter case, and the ::after
     arrow affordance only belongs on the one that navigates. The button's own text is a
     better accessible name than the aria-label that used to replace it. */
  function rungStripHtml(sel, nav) {
    return '<div class="st-rungs"' + (nav ? ' data-nav="1"' : '') + '>' + RUNGS.map(function (r) {
      var n = ladderPool(r.k).length;
      return '<button class="st-rung' + (r.k === sel ? ' st-rung-on' : '') + '" data-rung="' + r.k + '"' +
        (nav ? ' aria-current="' + (r.k === sel ? 'true' : 'false') + '"'
             : ' aria-pressed="' + (r.k === sel) + '"') + '>' +
        '<b class="st-rung-ceiling">' + r.ceiling + '</b>' +
        '<span class="st-rung-what">' + r.what + '</span>' +
        '<span class="st-rung-n">' + n + ' cards</span></button>';
    }).join('') + '</div>';
  }
  /* role=status so the new total is spoken when a rung or subject filter repaints it. The
     due count is the one number that tells you what to do today, so it leads when there is
     one; "nothing due today" must never read as "done" — a candidate three weeks out who
     clears the queue has not finished the rung. */
  function ladderCountLine(pool, nDue, filtered) {
    /* An empty pool is never "nothing due on this rung" — the rung is full. It means the
       subject filter plus whatever has been hidden has emptied the SELECTION, and saying
       "0 cards scheduled on this rung" about a rung holding sixty-odd cards is simply untrue.
       Name the real cause so the way out (clear the filter, or unhide) is obvious. */
    var s = !pool.length
      ? (filtered ? 'No cards left in this subject — clear the filter, or show hidden cards.'
                  : 'No cards left at this level — show hidden cards to bring them back.')
      : nDue == null ? pool.length + ' cards, every one cited to the rulebook.'
      : nDue ? nDue + ' of ' + pool.length + ' cards due today.'
      : 'Nothing due today · ' + pool.length + ' cards scheduled at this level.';
    return '<p class="st-lad-count" role="status">' + s + '</p>';
  }
  function ladderSectionHtml() {
    // The ladder is the 48 CONS page's main event now — no step kicker, it isn't step 2 of
    // anything. S.ladderBeta is a leftover record of the original unlisted link and is no
    // longer a gate; LADDER_ENABLED still kills the whole feature.
    // The heading carried a "Beta" chip while the ladder sat on public /study behind an
    // unlisted link. It is not a beta any more, and the hero eyebrow, the crumb and the lede
    // all name 48 CONS already — a chip here only said it a third time, so there is none.
    if (!LADDER_ENABLED || !deck.ladder) return '';
    var sel = ladderRung();
    /* The bolded clause used to read "Each ceiling includes everything under it." It was not
       true of the deck: the four rung pools are disjoint (64+61+51+30 = 206 cards, 206 unique
       ids, zero overlap), and ladderPool() hands back only the selected rung. An Unlimited
       candidate was being told their 30 cards covered the 176 below them. */
    return '<h2 class="st-h2" style="margin-top:2px">The Warrant Ladder</h2>' +
      '<p class="st-sub">A warrant carries signature authority up to a dollar ceiling — and holds you ' +
      'to every rule below it. Scope your prep to the warrant you’re testing for. ' +
      '<span class="st-lad-cum">Each level holds the material that ceiling adds — the levels below it still apply.</span></p>' +
      rungStripHtml(sel, true);
  }
  function wireLadderSection() {
    Array.prototype.forEach.call(app.querySelectorAll('.st-rung'), function (b) {
      b.onclick = function () {
        S.ladderRung = b.getAttribute('data-rung'); save();
        depth1View = viewLadder; goDepth(1, viewLadder);
      };
    });
  }

  /* ---- 48 CONS page ---------------------------------------------------------------------
     The unlisted org page: the Warrant Ladder plus the Board Introduction Builder. The cards
     are the same corpus-built deck the rest of the site uses, so a corpus refresh reaches
     this page automatically — the whole reason the ladder was not forked into a static copy
     when it moved off /study. */
  function view48Cons() {
    /* The Rise treatment, same vocabulary as the course on /study: a cover that describes
       the thing and an action card that starts it, then an outline, then a rail. Rendering
       rz-cover is also what flips documentclass st-rise, which collapses the marketing hero
       above and widens the wrap to 1280 — the same fix /study got when its hero and its
       course cover were stacked, and the hero was the page's second <h1>.
       Every piece of content the old page carried is still here: the ladder and its lede,
       the four ceilings with their card counts, and all three tools. What changed is that
       the ceilings are rows with their own progress instead of four chips, and the tools
       moved into the rail where the course keeps Review and the Practice Range. */
    var sel = ladderRung();
    var selR = RUNGS.filter(function (r) { return r.k === sel; })[0] || RUNGS[0];
    var pool = ladderPool(sel);
    var seen = pool.filter(function (c) { return cardState(c.id).box > 0; }).length;
    // isDue() is true at box 0, so "due" on an untouched rung means "all of them".
    // Only cards that have been met and come back around are a review backlog.
    var due = pool.filter(function (c) { return isDue(c.id) && cardState(c.id).box > 0; }).length;
    var prog = { done: seen, total: pool.length,
                 pct: pool.length ? Math.round(100 * seen / pool.length) : 0 };
    var nCards = RUNGS.reduce(function (t, r) { return t + ladderPool(r.k).length; }, 0);
    var nBoards = RUNGS.reduce(function (t, r) { return t + ladderBoardPool(r.k).length; }, 0);
    var nThresh = (deck.thresholds && deck.thresholds.length) || 0;
    var nMy = myDeck().cards.length;
    var bmap = ladderBoardMap();

    /* One row per ceiling. The old strip showed a card count and nothing else; a candidate
       choosing where to spend an evening wants to know what is met and what is due, and the
       row has room for it where a chip did not. aria-label carries ceiling + state, because
       the whole row would otherwise read as a 20-word accessible name. */
    var rungRows = RUNGS.map(function (r, i) {
      var p = ladderPool(r.k), b = ladderBoardPool(r.k);
      var met = p.filter(function (c) { return cardState(c.id).box > 0; }).length;
      var bFaced = b.filter(function (x) { return bmap[x.id]; }).length;
      var on = r.k === sel;
      var state = met ? met + ' of ' + p.length + ' cards met' : p.length + ' cards, none met yet';
      var meta = state + ' · ' + b.length + ' board sim' + (b.length === 1 ? '' : 's') +
        (bFaced ? ' (' + bFaced + ' faced)' : '');
      return '<li><button class="rz-lesson' + (met === p.length && p.length ? ' rz-lesson-done' : '') +
        '" data-rung="' + r.k + '"' + (on ? ' aria-current="true"' : '') +
        ' aria-label="' + esc(r.ceiling + ' — ' + r.what.replace(/&amp;/g, 'and') + ' — ' + state) + '">' +
        '<span class="rz-lesson-mark" aria-hidden="true">' + (met === p.length && p.length ? '\u2713' : (i + 1)) + '</span>' +
        '<span class="rz-lesson-body"><b>' + esc(r.ceiling) + ' \u00b7 ' + r.what + '</b><span>' + esc(meta) +
        (on ? ' · your ceiling' : '') + '</span></span>' +
        '<span class="rz-lesson-go" aria-hidden="true">\u2192</span></button></li>';
    }).join('');

    render(
      chromeHtml({ course: '48 CONS \u00b7 Warrant Prep', now: selR.ceiling, prog: prog }) +
      '<div class="rz-cover">' +
      '<div class="rz-cover-body">' +
      '<span class="rz-eyebrow">AcqVault \u00b7 48 CONS</span>' +
      // NOT the hero's "Hold the ceiling": .st-rise hides that hero on screen but
      // @media print restores it, and two h1s reading the same five words is what the
      // course cover was fixed for in round 2. The cover carries the course name.
      '<h1 class="rz-cover-h">48 CONS Warrant Prep</h1>' +
      '<p class="rz-cover-p">A warrant carries signature authority up to a dollar ceiling \u2014 and holds ' +
      'you to every rule below it. Scope your prep to the warrant you\u2019re testing for, and every card ' +
      'carries the governing rule in its own words.</p>' +
      '<ul class="rz-facts" role="list">' +
      '<li><b>' + nCards + '</b> cards</li>' +
      '<li><b>' + RUNGS.length + '</b> ceilings</li>' +
      '<li><b>' + nBoards + '</b> board sims</li>' +
      '</ul></div>' +
      '<div class="rz-card rz-card-hero">' +
      barHtml(prog, '', { one: 'card', many: 'cards', verb: 'met' }) +
      '<button class="rz-btn rz-btn-go rz-btn-wide" id="rz-lad-start">' +
      (seen ? 'Continue \u2014 ' + selR.ceiling : 'Start \u2014 ' + selR.ceiling) + '</button>' +
      '<button class="rz-btn rz-btn-ghost rz-btn-wide" id="rz-lad-switch">Choose a different ceiling</button>' +
      '<div class="rz-card-h">What\u2019s included</div>' +
      '<ul class="rz-incl" role="list">' +
      '<li><b>' + pool.length + '</b> cards at ' + esc(selR.ceiling) +
      (due ? ', <b>' + due + '</b> due for review' : seen ? '' : ', none met yet') + '</li>' +
      '<li><b>' + ladderBoardPool(sel).length + '</b> board sims at this ceiling</li>' +
      '<li>Every card quotes the governing rule</li>' +
      '</ul></div></div>' +
      '<div class="rz-home">' +
      '<div class="rz-home-main">' +
      '<h2 class="rz-outline-head" id="rz-lad-outline">The Warrant Ladder</h2>' +
      '<section class="rz-sec"><div class="rz-sec-head">' +
      '<h3>Choose your ceiling</h3>' +
      '<span class="rz-sec-count">' + RUNGS.length + ' levels \u00b7 ' + nCards + ' cards \u00b7 ' + nBoards + ' board sims</span>' +
      '</div>' +
      // the cumulative note the strip carried — still true, still needed, now in the one
      // place a candidate reads before picking a level
      '<p class="rz-sec-note">Each level holds the material that ceiling adds \u2014 the levels below it still apply.</p>' +
      '<ol class="rz-lessons">' + rungRows + '</ol></section>' +
      '</div>' +
      '<aside class="rz-aside rz-aside-sub" aria-label="The rest of your prep">' +
      '<div class="rz-card-h rz-aside-h">The rest of your prep</div>' +
      '<button class="rz-extra-card" id="st-intro-open" aria-label="Board Introduction Builder \u2014 ' + introDoneChip() + '">' +
      '<b>Board Introduction Builder</b><span>Draft the opener and the closer every board asks for, in your own words. \u00b7 ' +
      esc(introDoneChip()) + '</span></button>' +
      '<button class="rz-extra-card" id="st-sprint-open" aria-label="Threshold Sprint \u2014 ' +
      (S.sprint.best ? 'best streak ' + S.sprint.best : 'not started') + '">' +
      '<b>Threshold Sprint</b><span>Rapid-fire on the dollar figures a panel can rattle you with. \u00b7 ' +
      nThresh + ' thresholds' + (S.sprint.best ? ', best streak ' + S.sprint.best : '') + '</span></button>' +
      '<button class="rz-extra-card" id="st-my-open" aria-label="My Cards \u2014 ' +
      (nMy ? nMy + ' card' + (nMy === 1 ? '' : 's') : 'none yet') + '">' +
      '<b>My Cards</b><span>Write the local policy the rulebook cannot know \u2014 approval chains, squadron procedure. \u00b7 ' +
      (nMy ? nMy + ' card' + (nMy === 1 ? '' : 's') : 'none yet') + '</span></button>' +
      '</aside></div>' + footToolsHtml());

    wireFootTools();
    el('rz-lad-start').onclick = function () { depth1View = viewLadder; goDepth(1, viewLadder); };
    el('rz-lad-switch').onclick = function () {
      var h = app.querySelector('#rz-lad-outline');
      if (h) h.scrollIntoView({ block: 'start' });
      var first = app.querySelector('.rz-lesson');
      if (first) first.focus();   // the ghost button promises a choice; land on it
    };
    Array.prototype.forEach.call(app.querySelectorAll('.rz-lesson'), function (b) {
      b.onclick = function () {
        S.ladderRung = b.getAttribute('data-rung'); save();
        depth1View = viewLadder; goDepth(1, viewLadder);
      };
    });
    el('st-intro-open').onclick = function () { depth1View = viewIntro; goDepth(1, viewIntro); };
    el('st-sprint-open').onclick = function () { depth1View = viewSprint; goDepth(1, viewSprint); };
    el('st-my-open').onclick = function () { myErr = ''; myEditId = null; depth1View = viewMyCards; goDepth(1, viewMyCards); };
  }

  /* ---- Board Introduction Builder -------------------------------------------------------
     Robert Maughan's idea: the ladder drills the rules but never the opening question every
     board actually asks first. This assembles the candidate's OWN words into a spoken opener
     and closer — a template fill, never generated prose, and it touches no corpus content,
     so there is nothing here to verify and nothing that can drift. */
  var INTRO_FIELDS = [
    { k: 'years', lab: 'Total years of contracting experience',
      ph: 'e.g. six years, the last four at 48 CONS', ml: 140 },
    { k: 'breadth', lab: 'Breadth of experience — the work you have actually run or signed',
      ph: 'e.g. commercial services, construction, A-E, IDIQ task orders', ml: 260 },
    { k: 'creds', lab: 'Degrees and certifications',
      ph: 'e.g. DAWIA Contracting Practitioner, MBA', ml: 200 },
    { k: 'why', lab: 'Why you are seeking this warrant',
      ph: 'e.g. the squadron needs a second signature at this ceiling to hold award timelines', ml: 320 }
  ];
  function introState() {
    if (!S.intro) S.intro = { years: '', breadth: '', creds: '', why: '' };
    return S.intro;
  }
  function introFilled() {
    var I = introState();
    return INTRO_FIELDS.filter(function (f) { return String(I[f.k] || '').trim(); }).length;
  }
  function introDoneChip() {
    var n = introFilled();
    return n === 0 ? 'Not started' : n === INTRO_FIELDS.length ? 'Draft ready' : n + ' of ' + INTRO_FIELDS.length + ' answered';
  }
  function viewIntro() {
    var I = introState();
    var sel = ladderRung();
    var ceiling = (RUNGS.filter(function (r) { return r.k === sel; })[0] || RUNGS[0]).ceiling;
    render(
      // Same pinned chrome as the rest of /48cons: the way out was a link at the bottom
      // of a four-textarea form, which is the furthest possible place from where you
      // decide to leave. No progress meter — there is nothing here to be partway through
      // that a count would describe honestly.
      chromeHtml({ course: '48 CONS \u00b7 Warrant Prep', back: true, backLabel: 'Prep',
        backAria: 'Back to warrant board prep',
        now: 'Introduction Builder \u00b7 ' + ceiling + ' ceiling' }) +
      '<div class="rz-home"><div class="rz-home-main">' +
      '<h2 class="rz-outline-head">Board Introduction Builder</h2>' +
      '<div class="rz-card">' +
      '<p class="st-sub" style="margin-top:0">Answer in your own words — plain speech, not résumé ' +
      'bullets. The script below is assembled from exactly what you type; nothing is invented ' +
      'for you, and nothing leaves this browser.</p>' +
      INTRO_FIELDS.map(function (f) {
        return '<label class="st-bd-bluf-lab" for="in-' + f.k + '">' + esc(f.lab) + '</label>' +
          '<textarea class="st-bd-bluf st-intro-ta" id="in-' + f.k + '" rows="2" maxlength="' + f.ml +
          '" autocomplete="off" placeholder="' + esc(f.ph) + '">' + esc(I[f.k] || '') + '</textarea>';
      }).join('') +
      '<div class="st-intro-actions">' +
      // Bare .st-btn sets border:none and NO background, so this landed as the UA grey
      // buttonface — 1.15:1 against its own white card, reading as disabled. It is this
      // view's one primary action and gets the navy every other primary action uses.
      '<button class="rz-btn rz-btn-go" id="in-build">Build my script</button>' +
      '<button class="st-link" id="in-clear">Clear</button>' +
      '</div>' +
      '<div id="in-out" class="st-intro-out" role="status" aria-live="polite"></div>' +
      '</div></div></div>' +
      // Went to view48Cons (the tools view), not viewLadder — the label named a place it
      // never reached. Kept beneath the form as well as in the chrome: finishing the last
      // field and leaving is a real path, and it should not need a trip back to the top.
      '<div class="rz-sim-exits"><button class="st-link st-quit" id="st-quit">\u2190 Warrant board prep</button></div>');
    el('rz-bar-back').onclick = function () { depth1View = null; goDepth(0, view48Cons); };

    INTRO_FIELDS.forEach(function (f) {
      el('in-' + f.k).addEventListener('input', function () {
        introState()[f.k] = this.value; save();
      });
    });
    el('in-build').onclick = function () { paintIntroScript(); };
    el('in-clear').onclick = function () {
      S.intro = { years: '', breadth: '', creds: '', why: '' }; save(); viewIntro();
    };
    el('st-quit').onclick = function () { goDepth(0, view48Cons); };
    if (introFilled()) paintIntroScript();
  }
  function introSentences() {
    var I = introState();
    var sel = ladderRung();
    var r = RUNGS.filter(function (x) { return x.k === sel; })[0] || RUNGS[0];
    var open = ['Good morning, and thank you for your time.'], close = [];
    var years = introClean(I.years), breadth = introClean(I.breadth),
        creds = introClean(I.creds), why = introClean(I.why);
    // Frames adapt to the SHAPE of what was typed — a bare number, a phrase, or a full
    // sentence the candidate already wrote — so nothing gets double-framed into
    // "I have I've been in contracting..." The words are still entirely theirs.
    if (years) {
      if (/^i\b/i.test(years)) open.push(introCap(years) + '.');
      else if (/^\d+$/.test(years) || /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)$/i.test(years))
        open.push('I have ' + years.toLowerCase() + ' years of contracting experience.');
      else open.push('I have ' + introLow(years) + '.');
    }
    if (breadth) {
      if (/^i\b/i.test(breadth)) open.push(introCap(breadth) + '.');
      else open.push((years ? 'In that time my work has covered ' : 'My work has covered ') +
        introList(introLow(breadth)) + '.');
    }
    if (creds) {
      if (/^i\b/i.test(creds)) open.push(introCap(creds) + '.');
      else open.push('Along the way I have earned ' + introList(creds) + '.');
    }
    open.push('I am here today for the ' + r.ceiling + ' warrant.');
    if (why) {
      if (/^i\b/i.test(why)) close.push(introCap(why) + '.');
      else if (/^to\s/i.test(why)) close.push('I am asking for this warrant ' + introLow(why) + '.');
      else close.push('I am asking for this warrant because ' +
        introLow(why.replace(/^(because|since)\s+/i, '')) + '.');
    }
    close.push('I understand that a warrant at this level carries every rule beneath it, and ' +
      'I am prepared to be held to all of them. Thank you — I am glad to take your questions.');
    return { open: open, close: close };
  }
  /* Pure text helpers for the builder — deterministic cleanup, never invention. */
  function introClean(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').replace(/[.,;\s]+$/, '');
  }
  function introCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function introLow(s) { return /^[A-Z][a-z]/.test(s) && !/^[A-Z]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  /* "a, b, c, d" → "a, b, c, and d" — a bare comma list read aloud needs its "and".
     Lists that already carry one, or that use semicolons/clauses, pass through untouched. */
  function introList(s) {
    if (s.indexOf(';') !== -1 || /\band\b/i.test(s.substring(s.lastIndexOf(',')))) return s;
    var i = s.lastIndexOf(',');
    if (i === -1) return s;
    return s.slice(0, i) + (s.indexOf(',') === i ? ' and' : ', and') + s.slice(i + 1);
  }
  function paintIntroScript() {
    var s = introSentences();
    function block(title, lines) {
      return '<h3 class="st-intro-h">' + title + '</h3><p class="st-intro-script">' +
        lines.map(esc).join(' ') + '</p>';
    }
    el('in-out').innerHTML =
      '<div class="st-intro-paper">' +
      block('Introduction', s.open) + block('Closing', s.close) +
      '</div>' +
      '<div class="st-intro-actions"><button class="st-btn st-btn-hint" id="in-print">Print both</button>' +
      '<span class="st-intro-note">Read it out loud once before you print it — if a line is hard to say, rewrite it above.</span></div>';
    el('in-print').onclick = function () { window.print(); };
  }
  function viewLadder() {
    var sel = ladderRung();
    // Everything below — mastery, the count line, "what would sink you" and the cards the
    // start button hands to the session — reads the FILTERED pool, so a subject filter is
    // honest about what it is actually scoping.
    var pool = ladderTopicPool(sel);
    var label = (RUNGS.filter(function (r) { return r.k === sel; })[0] || RUNGS[0]).label;
    var m = mastery(pool);
    var byId = {};
    pool.forEach(function (c) { byId[c.id] = c; });
    var sink = (S.ladderMiss || []).map(function (id) { return byId[id]; }).filter(Boolean).slice(0, 5);
    /* The board self-grade used to be collected and shown nowhere — the most board-predictive
       signal in the tool, feeding nothing. It reads back here, on the rung it belongs to. */
    var boards = ladderBoardPool(sel), bmap = ladderBoardMap();
    var faced = boards.filter(function (b) { return bmap[b.id]; });
    var ready = faced.filter(function (b) { return bmap[b.id].g === 3; }).length;
    var rough = faced.filter(function (b) { return bmap[b.id].g === 1; }).length;
    // Notes are counted across every rung, not just this one — the export is one file.
    var nNotes = bdNoteCount();
    var boardHtml = !boards.length ? ''
      : '<div class="st-lad-boards"><span class="st-lad-boards-lab">Board sims</span>' +
        '<span class="st-lad-boards-n">' + faced.length + ' of ' + boards.length + ' faced</span>' +
        (faced.length ? '<span class="st-lad-boards-split">' + ready + ' board-ready · ' + rough + ' rough</span>' : '') +
        (nNotes ? '<button class="st-lad-notes" id="lad-notes">Export ' + nNotes + ' note' +
          (nNotes === 1 ? '' : 's') + ' (.txt)</button>' : '') +
        '</div>';
    /* Senior-authority rung only: the source-selection simulator lives on its own page
       (/source-selection). A full best-value tradeoff is too big for a card drill, so it's
       promoted here as a distinct launch rather than folded into the recall pool. */
    var simHtml = sel === 'unlimited'
      ? '<a class="st-lad-sim" href="/source-selection"><span class="st-lad-sim-kick">Simulator</span>' +
        '<b class="st-lad-sim-t">Run a full source selection</b>' +
        '<span class="st-lad-sim-d">Take the Source Selection Authority’s chair on a $250M best-value tradeoff — nine decisions, a live protest-risk score, every call cited to the DoD SSP.</span>' +
        '<span class="st-lad-sim-go" aria-hidden="true">→</span></a>'
      : '';
    var sinkHtml = sink.length
      ? '<div class="st-lad-sink"><div class="st-lad-head">What would sink you</div>' +
        sink.map(function (c) {
          var l = c.cite && c.cite.link;
          return '<div class="st-lad-sink-item">' + esc(c.q) +
            (l ? ' <a class="st-lad-quote-link" href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.t) + '</a>' : '') + '</div>';
        }).join('') + '</div>'
      : '';
    // A select rather than a chip row: SAT alone carries 18 subjects, which would wrap into a
    // wall of chips above the thing you came here to press.
    var topics = ladderTopics(sel), tsel = ladderTopicSel(sel);
    var topicHtml = topics.length < 2 ? ''
      : '<div class="st-lad-topic"><label class="st-lad-topic-lab" for="lad-topic">Subject</label>' +
        '<select class="st-lad-topic-sel" id="lad-topic">' +
        '<option value="">All subjects · ' + ladderPool(sel).length + ' cards</option>' +
        topics.map(function (x) {
          return '<option value="' + esc(x.t) + '"' + (x.t === tsel ? ' selected' : '') + '>' +
            esc(x.t) + ' · ' + x.n + '</option>';
        }).join('') + '</select>' +
        (tsel ? '<button class="st-lad-topic-clear" id="lad-topic-clear">Clear</button>' : '') +
        '</div>';
    var nHidden = hiddenIn(sel);
    var hiddenHtml = nHidden
      ? '<p class="st-lad-hidden">' + nHidden + ' card' + (nHidden === 1 ? '' : 's') +
        ' hidden at this level. <button class="st-lad-unhide" id="lad-unhide">Show them again</button></p>'
      : '';
    /* The footer has always promised "missed cards return sooner; mastered ones stretch out",
       and the ladder never delivered it: isDue() had three call sites, all in viewHome() on
       /study, and the session took a uniform random 25 out of the rung. The boxes were being
       written by grade() and read by mastery(), then thrown away at selection time. Now the
       schedule actually drives the session. Free-form review survives as a second button. */
    var due = pool.filter(function (c) { return isDue(c.id); });
    var nDue = Math.min(due.length, SESSION_CAP);
    /* At 0% the bar rendered as an empty track beside a "0%" — an empty state dressed as a
       failing grade, on a page for people already anxious about a panel. */
    var readyHtml = m
      ? '<div class="st-lad-ready"><span class="st-lad-ready-lab">Card mastery</span>' +
        '<span class="st-bar" aria-hidden="true"><span class="st-bar-fill" style="width:' + m + '%"></span></span>' +
        '<span class="st-topic-meta">' + m + '%</span></div>'
      : '<div class="st-lad-ready"><span class="st-lad-ready-lab">Card mastery</span>' +
        '<span class="st-topic-meta">Not started — grade a card and it fills in</span></div>';
    /* The Rise treatment, matching the cover and /study's lesson view: pinned chrome
       instead of a link at the bottom of the page, the working column beside a rail, and
       one card carrying the state rather than eight stacked strips. Every control keeps
       its id, so the handlers below are untouched — this is a markup change, not a
       behaviour change. .rz-home is in the st-rise regex, so the shell widens for the
       two columns and the marketing hero stays collapsed. */
    var metN = pool.filter(function (c) { return cardState(c.id).box > 0; }).length;
    var lprog = { done: metN, total: pool.length,
                  pct: pool.length ? Math.round(100 * metN / pool.length) : 0 };
    render(
      chromeHtml({ course: '48 CONS \u00b7 Warrant Prep', back: true, backLabel: 'Ladder',
        backAria: 'Back to the warrant ladder', now: label, prog: lprog }) +
      '<div class="rz-home">' +
      '<div class="rz-home-main">' +
      '<h2 class="rz-outline-head">' + esc(label) + '</h2>' +
      '<div class="rz-card">' +
      readyHtml +
      topicHtml +
      ladderCountLine(pool, due.length, !!tsel) +
      hiddenHtml +
      '<div class="st-actions">' +
      // No pool, no study button: "Review all 0" started a session with nothing in it, so the
      // control looked broken rather than inapplicable. The count line above says why.
      (!pool.length ? ''
        : due.length
        ? '<button class="rz-btn rz-btn-go" id="lad-start">Study ' + nDue +
          (nDue < due.length ? ' of ' + due.length + ' due' : ' due') + ' <kbd>space</kbd></button>'
        : '<button class="rz-btn rz-btn-go" id="lad-start">Review all ' + pool.length + ' <kbd>space</kbd></button>') +
      (boards.length ? '<button class="rz-btn rz-btn-ghost" id="lad-board">Face the board</button>' : '') +
      (due.length && due.length < pool.length
        ? '<button class="st-link" id="lad-all">Review all ' + pool.length + '</button>' : '') +
      '</div></div>' +
      sinkHtml +
      '</div>' +
      '<aside class="rz-aside rz-aside-sub" aria-label="This ceiling">' +
      boardHtml +
      simHtml +
      '<nav class="rz-rungnav" aria-label="Switch ceiling">' +
      '<div class="rz-card-h rz-aside-h">Ceilings</div>' +
      rungStripHtml(sel) +
      '</nav>' +
      '</aside></div>');
    el('rz-bar-back').onclick = backToTools;
    Array.prototype.forEach.call(app.querySelectorAll('.st-rung'), function (b) {
      b.onclick = function () {
        S.ladderRung = b.getAttribute('data-rung'); save(); viewLadder();
        // render() replaces innerHTML and focuses the container, so the button you just
        // pressed is gone and its state change is never announced. Put focus back on the
        // equivalent control in the repainted strip.
        var n = app.querySelector('.st-rung-on');
        if (n) { try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } }
      };
    });
    // Guarded: an emptied selection renders no start button at all (see above).
    if (el('lad-start')) {
      el('lad-start').onclick = function () {
        var cards = due.length ? due : pool;
        goDepth(2, function () { ladderSession(cards, label); });
      };
    }
    if (el('lad-all')) {
      el('lad-all').onclick = function () { goDepth(2, function () { ladderSession(pool, label); }); };
    }
    if (el('lad-board')) {
      el('lad-board').onclick = function () { goDepth(2, function () { ladderBoardSession(sel, label); }); };
    }
    if (el('lad-notes')) {
      el('lad-notes').onclick = function () { exportBoardNotes(); };
    }
    if (el('lad-topic')) {
      /* Re-focus the select after the repaint. render() destroys the node the change fired
         on, so focus landed on the container — and on Windows Firefox a closed <select>
         fires change on EVERY arrow key, which made a 19-option list keyboard-inoperable
         after the first press. */
      el('lad-topic').onchange = function () {
        S.ladderTopic = this.value; save(); viewLadder();
        var s = el('lad-topic');
        if (s) { try { s.focus({ preventScroll: true }); } catch (e) { s.focus(); } }
      };
    }
    if (el('lad-topic-clear')) {
      el('lad-topic-clear').onclick = function () { S.ladderTopic = ''; save(); viewLadder(); };
    }
    if (el('lad-unhide')) {
      el('lad-unhide').onclick = function () { unhideRung(sel); viewLadder(); };
    }
    // Space must not throw when there is nothing to start — see the emptied-selection case.
    keyHandler(function (k) {
      if (k !== ' ' && k !== 'Enter') return;
      var b = el('lad-start');
      if (b) { b.onclick(); return true; }
    });
  }
  /* Session position survives a reload. Without this, following a citation — the whole
     point of the ladder — dumped you back at the track picker with the drill gone, which
     punished the exact behaviour the feature exists to create. Stores card ids, not cards. */
  function saveResume(mode, rung, q, i, got, label, extra) {
    // Stamp the page the session belongs to. resumeSession() used to INFER this from whether
    // the mode was a ladder mode, which only held while the ladder was the org page's sole
    // activity — the moment a shared activity (Threshold Sprint) runs on both pages, the
    // inference is wrong in both directions.
    S.resume = { mode: mode, rung: rung, org: isOrg(), ids: q.map(function (c) { return c.id; }),
                 i: i, got: got, label: label, at: Date.now() };
    if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) S.resume[k] = extra[k];
    save();
  }
  /* Every mode stores ids, never card objects — a rebuilt deck must be able to invalidate a
     stale session rather than resurrect questions that no longer exist. */
  function cardsByIdFromPool(pool, ids) {
    var byId = {};
    pool.forEach(function (c) { byId[c.id] = c; });
    var out = ids.map(function (id) { return byId[id]; }).filter(Boolean);
    return out.length === ids.length ? out : null;   // deck moved under us
  }
  function clearResume() { if (S.resume) { delete S.resume; save(); } }
  function resumeLadder() {
    var r = S.resume;
    if (!r || r.mode !== 'ladder' || !r.ids || r.i >= r.ids.length) { clearResume(); return false; }
    var byId = {};
    (ladderPool(r.rung) || []).forEach(function (c) { byId[c.id] = c; });
    var q = r.ids.map(function (id) { return byId[id]; }).filter(Boolean);
    if (q.length !== r.ids.length) { clearResume(); return false; }   // deck moved under us
    S.ladderRung = r.rung; save();
    depth1View = viewLadder;
    goDepth(2, function () { ladderSession(q, r.label, r.i, r.got); });
    return true;
  }

  function ladderSession(cards, label, startAt, startGot) { // mirrors startSession's produce-then-reveal branch
    if (!cards.length) { viewLadder(); return; }
    var q = startAt == null ? interleave(shuffle(cards.slice()).slice(0, SESSION_CAP)) : cards;
    var i = startAt || 0, got = startGot || 0, shaky = [];
    function step() {
      if (i >= q.length) return summary();
      saveResume('ladder', ladderRung(), q, i, got, label);
      var c = q[i];
      render(
        '<div class="st-session-head"><span>' + esc(label) + '</span><span>' + (i + 1) + ' / ' + q.length + '</span></div>' +
        '<div class="st-prog" aria-hidden="true"><span style="width:' + Math.round(100 * i / q.length) + '%"></span></div>' +
        '<div class="st-card" aria-live="polite">' +
        '<div class="st-chip">' + esc(c.topic || 'General') + '</div>' +
        '<div class="st-q">' + esc(c.q) + '</div>' +
        '<div id="st-a" class="st-a" hidden>' + esc(c.a) + ladderCiteHtml(c) + explainHtml(c) + '</div>' +
        '<div class="st-actions" id="st-act">' +
        '<button class="st-btn st-btn-reveal" id="st-reveal">Reveal <kbd>space</kbd></button></div></div>' +
        '<div class="st-lad-foot"><button class="st-link st-quit" id="st-quit">End session</button>' +
        '<button class="st-link st-hide" id="st-hide">Hide this card</button></div>');
      el('st-quit').onclick = summary;
      // Hidden, not deleted — the card drops out of the drill and the ladder offers it back.
      el('st-hide').onclick = function () { hideCard(c.id); i++; step(); };
      el('st-reveal').onclick = reveal;
      keyHandler(function (k) { if (k === ' ' || k === 'Enter') { reveal(); return true; } });
      function reveal() {
        el('st-a').hidden = false;
        el('st-act').innerHTML =
          '<button class="st-btn st-g1" id="g1">Missed <kbd>1</kbd></button>' +
          '<button class="st-btn st-g2" id="g2">Shaky <kbd>2</kbd></button>' +
          '<button class="st-btn st-g3" id="g3">Got it <kbd>3</kbd></button>';
        el('g1').onclick = function () { doGrade(1); };
        el('g2').onclick = function () { doGrade(2); };
        el('g3').onclick = function () { doGrade(3); };
        keyHandler(function (k) {
          if (k === '1') { doGrade(1); return true; }
          if (k === '2') { doGrade(2); return true; }
          if (k === '3') { doGrade(3); return true; }
        });
      }
      function doGrade(g) {
        if (g === 1) { ladderNoteMiss(c.id); shaky.push(c); }
        else if (g === 2) shaky.push(c);
        grade(c.id, g);
        if (g === 3) got++;
        i++; step();
      }
    }
    /* The end of a session used to be a receipt — "3 of 25 solid" and one button. The
       casual word game debriefed better than the board prep did. Name what you dropped
       and offer to run it again; a miss list is an assignment, a percentage is a score. */
    function summary() {
      keyHandler(null);
      clearResume();
      var pct = i ? Math.round(100 * got / i) : 0;
      var missHtml = '';
      if (shaky.length) {
        missHtml = '<div class="st-sum-miss"><div class="st-sum-miss-head">Say these out loud before you close this tab</div>' +
          shaky.map(function (m) {
            var l = m.cite && m.cite.link;
            return '<div class="st-sum-miss-item">' + esc(m.q) +
              (l ? ' <a class="st-lad-quote-link" href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.t) + '</a>' : '') + '</div>';
          }).join('') +

          '</div>';
      }
      render('<div class="st-card st-summary"><div class="st-chip">' + esc(label) + '</div>' +
        '<div class="st-sum-num">' + got + '<span> of ' + i + ' solid</span></div>' +
        '<div class="st-prog st-prog-lg" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
        '<p class="st-sub">' + sumFlavor(pct, i) + '</p>' + missHtml +
        '<div class="st-actions">' +
        (shaky.length ? '<button class="st-btn st-btn-reveal" id="st-again">Go back over the ' + shaky.length + ' you dropped</button>' : '') +
        '<button class="st-btn' + (shaky.length ? ' st-btn-hint' : ' st-btn-reveal') + '" id="st-home">Back to the ladder</button>' +
        '</div></div>');
      if (shaky.length) el('st-again').onclick = function () { ladderSession(shaky.slice(), label); };
      el('st-home').onclick = backHome;
    }
    step();
  }

  /* ---- The Warrant Ladder — board sims ----
     The recall cards ask whether you know a rule; a board asks whether you can hold the
     floor and land on a decision. These 47 scenarios are the other half, scoped to the same
     rungs. They deliberately never reach grade()/INTERVALS — 47 narrative items would flood
     Daily Review with things nobody answers in twelve seconds. Their record lives in
     S.ladderBoard instead. */
  function ladderBoardPool(rung) { return (deck.ladder_boards && deck.ladder_boards[rung]) || []; }
  function ladderBoardMap() { if (!S.ladderBoard) S.ladderBoard = {}; return S.ladderBoard; }
  function ladderBoardNoteRough(id) {
    var r = (S.ladderBoardRough || []).filter(function (x) { return x !== id; });
    r.unshift(id);
    if (r.length > 50) r.length = 50;
    S.ladderBoardRough = r;
  }
  /* No clock here, by owner's call. A running timer on board prep is pressure for its own
     sake: the counter was measuring how long you held the floor, but a number ticking on
     screen changes how you answer, and rehearsal is where you should be free to take as
     long as the thought needs. The hint is likewise available the moment you want it. */
  /* Citations are staged across the exchange: ABSENT while you answer (they are the answer),
     TEXT-ONLY beside the model so the eye has something to check against, and LINKED only at
     the record — the one moment when leaving the page is the right move. */
  function boardCitesText(cites) {
    if (!cites || !cites.length) return '';
    return '<div class="st-bd-cites"><span class="st-bd-cites-head">Resting on</span>' +
      cites.map(function (c) { return '<span class="st-bd-cite">' + esc(c.t) + '</span>'; }).join('') + '</div>';
  }
  function boardCitesLinked(cites) {
    if (!cites || !cites.length) return '';
    return '<div class="st-bd-sources"><div class="st-bd-sources-head">Read the rules behind this</div>' +
      cites.map(function (c) {
        return '<div class="st-bd-source"><a class="st-lad-quote-link" href="' + esc(c.u) + '" target="_blank" rel="noopener">' + esc(c.t) + '</a>' +
          (c.quote ? '<div class="st-bd-source-q">“' + esc(c.quote) + '”</div>' : '') + '</div>';
      }).join('') + '</div>';
  }

  var BD_CHECKS = [
    'I named the rule and where it lives',
    'I called the trap in the scenario',
    'I landed on a decision and said where I’d verify it'
  ];
  var BD_VERDICT = { 1: 'Rough', 2: 'Getting there', 3: 'Board-ready' };

  /* ---- Board-sim answer recorder --------------------------------------------------------
     Robert Maughan's "record your response" idea. A board answer is a SPOKEN performance, so
     hearing your own run-through next to the model answer is the whole point of it.

     ⚠ IN MEMORY ONLY, BY DESIGN — the copy on screen promises this, so any change here has to
     keep the promise true. The blob and its object URL live in this closure and nowhere else:
     never in S, never in localStorage, never in saveResume(), never sent anywhere. There is
     no IndexedDB and no download. Leaving the page destroys the recording, which is the point
     on a government machine.

     The mic is opened per take and its tracks are stopped the instant recording ends, so the
     browser's recording indicator does not stay lit between takes.

     Only /48cons is granted the microphone (vercel.json scopes Permissions-Policy to that one
     path) and these rung-scoped sims only ever render there — but this still feature-detects
     rather than assuming, so a blocked policy, a managed browser or a missing MediaRecorder
     degrades to the sim exactly as it was. Recording is an aid here, never a gate. */
  var REC = { state: 'idle', blobUrl: '', mr: null, stream: null, chunks: null, t0: 0, tick: 0, err: '',
    gen: 0, hintTimer: 0, waitTimer: 0, after: null, afterTimer: 0 };

  /* How long a permission prompt may sit unanswered before the button stops claiming it is
     starting. HINT relabels ("Starting…" is a lie once a dialog is up and waiting on you);
     GIVE_UP hands the button back so the sim is never left with a dead control. */
  var REC_PROMPT_HINT_MS = 6000, REC_PROMPT_GIVE_UP_MS = 25000;

  function recSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      typeof MediaRecorder !== 'undefined' && window.isSecureContext !== false);
  }
  /* Map a getUserMedia failure to advice naming the layer that actually said no.
     The 48 CONS field report was "we enabled the microphone and it still fails" — on
     government desktops the refusal usually comes from BELOW the browser permission:
     Windows' privacy toggle (Chromium surfaces that as NotAllowedError with a
     "…by system" message), endpoint security holding the device (NotReadableError),
     or a desktop with no mic at all. The old message prescribed the mic-icon fix for
     all of them — the one layer that was already set. The raw error name rides along
     in parentheses so an IT ticket has something concrete to act on, and every branch
     ends the same way: the sim never needed the recorder to be worth running.
     Pure function — scripts/test_recfail.js extracts and exercises it. */
  /* One plain note for every failure. Recording needs an audio-capture stack the
     government Edge/VDI image does not provide, and no browser setting or IT ticket the
     user can act on changes that — so the honest, un-fussy message is simply that it is
     not available there. The one exception worth its own line is a plain browser-level
     block on a personal machine, which the user really can undo from the address bar.
     The board sim never needed the recorder, which the second sentence keeps saying. */
  function recFailText(name, detail) {
    if ((name === 'NotAllowedError' && !/system/i.test(detail || '')) || name === 'SecurityError') {
      return 'Microphone blocked — allow it from the mic icon in your browser’s address bar. ' +
        'The sim still works — answer out loud and self-grade as usual.';
    }
    return 'Recording is not available on government-issued computers. ' +
      'The sim still works — answer out loud and self-grade as usual.';
  }
  function recClearTick() { if (REC.tick) { clearInterval(REC.tick); REC.tick = 0; } }
  function recClearWait() {
    if (REC.hintTimer) { clearTimeout(REC.hintTimer); REC.hintTimer = 0; }
    if (REC.waitTimer) { clearTimeout(REC.waitTimer); REC.waitTimer = 0; }
  }
  // Drops the queued "run this once the take has ended" continuation AND its fallback timer.
  function recClearAfter() {
    if (REC.afterTimer) { clearTimeout(REC.afterTimer); REC.afterTimer = 0; }
    REC.after = null;
  }
  function recStopTracks() {
    if (REC.stream) {
      try { REC.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    }
    REC.stream = null;
  }
  function recDropAudio() {
    if (REC.blobUrl) { try { URL.revokeObjectURL(REC.blobUrl); } catch (e) {} }
    REC.blobUrl = '';
  }
  /* Full teardown: the recording ceases to exist. Idempotent, so every exit path can call it
     without coordinating. onstop is detached first or a stop() here would resurrect a blob. */
  function recRelease() {
    recClearTick();
    recClearWait();
    // Bump the generation so a getUserMedia still pending from the view we are leaving cannot
    // come back and start recording into a scenario the user has already walked away from.
    REC.gen++;
    try {
      // Both handlers come off before stop(): onstop would resurrect a blob we are discarding,
      // and ondataavailable would fire one last time into a take that no longer exists.
      if (REC.mr && REC.mr.state !== 'inactive') {
        REC.mr.onstop = null; REC.mr.ondataavailable = null; REC.mr.stop();
      }
    } catch (e) {}
    recStopTracks();
    recDropAudio();
    REC.mr = null; REC.chunks = null; REC.t0 = 0; REC.state = 'idle'; REC.err = ''; REC.busy = false;
    // onstop was detached above, so a queued continuation will never fire on its own — but its
    // fallback timer still would, and leaving a view is exactly when that must not happen.
    recClearAfter();
  }
  function recClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function recAudioHtml(id) {
    return '<audio class="st-rec-audio"' + (id ? ' id="' + id + '"' : '') +
      ' controls preload="metadata" src="' + REC.blobUrl + '"></audio>';
  }
  function recorderHtml() {
    if (!recSupported()) return '';
    var b = '<div class="st-rec" id="st-rec">';
    if (REC.state === 'recording') {
      b += '<button class="st-btn st-rec-stop" id="rec-stop">' +
        '<span class="st-rec-dot" aria-hidden="true"></span>Stop recording</button>' +
        // aria-hidden: .st-card is an aria-live region, so a ticking clock inside it would
        // interrupt a screen reader twice a second. State changes still announce.
        '<span class="st-rec-time" id="rec-time" aria-hidden="true">0:00</span>' +
        '<span class="st-rec-live">Recording&hellip;</span>';
    } else if (REC.state === 'have') {
      b += recAudioHtml('rec-audio') +
        '<button class="st-btn st-btn-hint" id="rec-again">Re-record</button>' +
        '<button class="st-link st-rec-del" id="rec-del">Discard</button>';
    } else {
      b += '<button class="st-btn st-btn-hint" id="rec-go">' +
        '<span class="st-rec-dot" aria-hidden="true"></span>Record your answer</button>' +
        (REC.err ? '<span class="st-rec-err">' + esc(REC.err) + '</span>' : '');
    }
    return b + '<p class="st-rec-priv">Stays in this tab &middot; never saved or uploaded</p></div>';
  }
  /* Repaint ONLY the recorder subtree. Re-running the view's step() would rescroll the page
     and pull focus back to the card container on every take, so the control is swapped in
     place and focus is handed to whatever the next action is. */
  function recRepaint(focusId) {
    var host = el('st-rec');
    if (!host) return;
    host.outerHTML = recorderHtml();
    wireRecorder();
    var f = focusId && el(focusId);
    if (f) { try { f.focus(); } catch (e) {} }
  }
  function wireRecorder() {
    if (!recSupported()) return;
    recClearTick();
    /* REC.busy guards the gap between the click and getUserMedia settling. Without it the
       button stayed live and undisabled through a permission prompt that can hang for seconds
       on a managed government browser — two clicks started two streams, the second overwrote
       REC.stream, and recStopTracks() could never reach the first, so the OS mic indicator
       stayed lit after Stop. Nothing was ever uploaded, but "gone the moment you leave the
       sim" was not true of the orphaned stream. */
    if (el('rec-go')) el('rec-go').onclick = function () { recArm(this); };
    if (el('rec-again')) el('rec-again').onclick = function () { recDiscard(); recArm(this); };
    if (el('rec-del')) el('rec-del').onclick = function () { recDiscard(); recRepaint('rec-go'); };
    if (el('rec-stop')) {
      el('rec-stop').onclick = function () { recStop(); };
      REC.tick = setInterval(function () {
        var t = el('rec-time');
        if (!t) { recClearTick(); return; }   // view swapped out from under us
        t.textContent = recClock(Date.now() - REC.t0);
      }, 500);
    }
  }
  /* One entry point for both Record and Re-record: mark busy, disable, and say so, then start.
     The label change is the only feedback the user gets while the permission prompt is up. */
  function recArm(btn) {
    if (REC.busy || REC.state === 'recording') return;
    REC.busy = true;
    if (btn) {
      btn.disabled = true;
      var last = btn.lastChild;
      if (last && last.nodeType === 3) last.nodeValue = ' Starting…'; else btn.textContent = 'Starting…';
    }
    recStart();
  }
  function recStart() {
    REC.err = '';
    /* getUserMedia settles when the PROMPT is answered — and a prompt nobody answers never
       settles at all. Neither branch below ran, so the button sat disabled reading "Starting…"
       with no way back: clicking Record looked like it did nothing, because from the user's
       side nothing is what it did. A permission dialog the user never noticed (or a managed
       browser that stalls one) is the ordinary case, not the exotic one, so waiting is now
       bounded and the control is always handed back. */
    var gen = ++REC.gen, abandoned = false;
    recClearWait();
    REC.hintTimer = setTimeout(function () {
      REC.hintTimer = 0;
      var b = el('rec-go');
      if (REC.gen !== gen || !REC.busy || !b) return;
      var last = b.lastChild;
      if (last && last.nodeType === 3) last.nodeValue = ' Waiting for permission…';
    }, REC_PROMPT_HINT_MS);
    REC.waitTimer = setTimeout(function () {
      REC.waitTimer = 0;
      if (REC.gen !== gen || REC.state === 'recording') return;
      abandoned = true;
      REC.busy = false;
      REC.err = 'The microphone permission prompt was never answered. Allow it from the mic ' +
        'icon in your browser’s address bar, then press Record again.';
      recRepaint('rec-go');
    }, REC_PROMPT_GIVE_UP_MS);

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recClearWait();
      // A grant that arrives too late must not open a mic behind the user's back — not when
      // this scenario is gone (gen moved), not when a racing grant already started recording,
      // and not minutes after we gave up waiting. Stop the tracks; ask, don't surprise.
      if (REC.gen !== gen || abandoned || REC.state === 'recording') {
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        if (abandoned && REC.gen === gen && REC.state === 'idle' && el('st-rec')) {
          REC.err = 'Microphone allowed — press Record to start.';
          recRepaint('rec-go');
        }
        return;
      }
      REC.busy = false;
      REC.stream = stream;
      REC.chunks = [];
      var mr;
      // No mimeType is passed on purpose: Chrome records webm and Safari mp4, and letting
      // each pick its own default is the only thing that works in both.
      try { mr = new MediaRecorder(stream); }
      // "recorder:" prefix marks the constructor as the thrower — getUserMedia already
      // succeeded here, so a NotSupportedError on THIS line is a codec/recorder gap,
      // not the missing capture stack the recFailText branch describes.
      catch (e) { REC.err = recFailText('', ''); recStopTracks(); recRepaint('rec-go'); return; }
      REC.mr = mr;
      /* Bound to THIS take. stop() always flushes one final chunk asynchronously, and that
         flush can land after the recorder was torn down — where REC.chunks is null and the
         push threw — or after a NEW take has allocated its own array, where it would quietly
         append a stranger's audio to it. Identity, not just a null check, is what rules the
         second case out. */
      mr.ondataavailable = function (e) {
        if (REC.mr !== mr || !REC.chunks) return;
        if (e.data && e.data.size) REC.chunks.push(e.data);
      };
      mr.onstop = function () {
        var blob = new Blob(REC.chunks || [], { type: mr.mimeType || 'audio/webm' });
        REC.chunks = null;
        recStopTracks();          // drop the mic immediately; do not hold the indicator lit
        recDropAudio();
        REC.blobUrl = URL.createObjectURL(blob);
        REC.state = 'have';
        /* stop() finishes the blob asynchronously, so anything that must SEE the finished take
           has to run from here. "I'm done — show the model answer" used to stop the recorder and
           render the next stage in the same tick: that stage read REC.state while it was still
           'recording', so the player was never built, and the repaint below then found no
           recorder on screen to fix it. The take survived in memory and vanished from the UI —
           on the one screen the whole feature exists for. */
        var after = REC.after;
        recClearAfter();
        if (after) after(); else recRepaint('rec-again');
      };
      REC.t0 = Date.now();
      REC.state = 'recording';
      mr.start();
      recRepaint('rec-stop');
    }).catch(function (e) {
      recClearWait();
      if (REC.gen !== gen || abandoned) return;   // the message on screen already fits
      REC.busy = false;
      REC.state = 'idle';
      recStopTracks();
      REC.err = recFailText((e && e.name) || '', (e && e.message) || '');
      recRepaint('rec-go');
    });
  }
  /* End the current take and run `after` once it has actually ended. Callers that just want the
     mic to stop pass nothing. A take that is still waiting on the permission prompt counts as
     ended too: without cancelling it, a grant landing after the user pressed "I'm done" opened
     the microphone on the model-answer screen, where there is no recorder rendered to show it
     and no Stop button to end it. */
  function recStop(after) {
    recClearTick();
    if (REC.busy) { recClearWait(); REC.gen++; REC.busy = false; }
    var live = false;
    try { live = !!(REC.mr && REC.mr.state !== 'inactive'); } catch (e) {}
    if (!live) { if (after) after(); return; }
    /* Only hand onstop a continuation when there IS one. Parking a do-nothing wrapper in
       REC.after instead made onstop take the continuation branch every time, so the plain
       Stop button stopped repainting and the player never appeared. */
    var once = null;
    if (after) {
      var ran = false;
      once = function () {
        if (ran) return;
        ran = true;
        recClearAfter();
        after();
      };
      REC.after = once;
      /* onstop is the browser's to fire. If it never does, the sim must not strand the user on
         a screen whose only forward button has already been pressed. The id is kept because an
         UNCANCELLED fallback is worse than the hang it covers: press "I'm done", then Back
         before onstop lands, and this timer fired advance() 2.5s later — repainting the sim's
         model answer on top of the ladder, at a history depth that no longer matched it. */
      REC.afterTimer = setTimeout(once, 2500);
    }
    try { REC.mr.stop(); } catch (e) { if (once) once(); }
  }
  function recDiscard() { recRelease(); }

  // A recording belongs to ONE scenario and must not outlive the page.
  window.addEventListener('pagehide', recRelease);

  /* ---- Board-sim notes ------------------------------------------------------------------
     The other half of Robert Maughan's idea: "record then play back AND ASSESS THROUGH
     NOTES". The recording is the performance; this is what you decide to change about it.

     Unlike the audio, notes are text the candidate wants to keep, so these DO persist — the
     same treatment the Introduction Builder's answers already get. Capped per note, and they
     leave this device only into a file the user asks for. */
  var NOTE_MAX = 600;
  function bdNotes() { if (!S.bdNotes) S.bdNotes = {}; return S.bdNotes; }
  function bdNote(id) { return bdNotes()[id] || ''; }
  function bdNoteSet(id, v) {
    var N = bdNotes();
    v = String(v || '').slice(0, NOTE_MAX);
    if (v.trim()) N[id] = v; else delete N[id];   // an emptied note is removed, not stored blank
    save();
  }
  function bdNoteCount() { var N = bdNotes(), n = 0; for (var k in N) if (N.hasOwnProperty(k)) n++; return n; }
  /* Robert's downloadAllNotes(), scoped to what we actually hold: the panel's question and
     what the candidate wrote about their own answer. Built by walking the corpus deck, so a
     note whose scenario has left the deck is skipped rather than exported against a dead id. */
  function exportBoardNotes() {
    var N = bdNotes(), out = [], total = 0;
    RUNGS.forEach(function (r) {
      var hits = ladderBoardPool(r.k).filter(function (sc) { return N[sc.id]; });
      if (!hits.length) return;
      out.push(r.label.toUpperCase(), new Array(r.label.length + 1).join('='), '');
      hits.forEach(function (sc) {
        total++;
        out.push('Topic: ' + sc.topic, 'The panel asked: ' + sc.ask, '', 'Your note:', N[sc.id], '',
          '--------------------------------------------------', '');
      });
    });
    if (!total) return false;
    var head = ['48 CONS — Warrant board sim notes',
      'AcqVault · ' + total + ' note' + (total === 1 ? '' : 's'),
      'Unofficial research aid — verify against the signed DoD class deviations.', '',
      '==================================================', ''];
    var blob = new Blob([head.concat(out).join('\n')], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'board-sim-notes.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 0);
    return true;
  }

  function ladderBoardSession(rung, label, pickId, startStage, hintWasUsed) {
    recRelease();   // a new scenario never inherits the last one's take
    var pool = ladderBoardPool(rung);
    if (!pool.length) { viewLadder(); return; }
    var done = ladderBoardMap();
    var sc = null;
    if (pickId) { sc = pool.filter(function (s) { return s.id === pickId; })[0]; }
    if (!sc) {
      var fresh = pool.filter(function (s) { return !done[s.id]; });
      sc = (fresh.length ? shuffle(fresh.slice()) : shuffle(pool.slice()))[0];
    }
    var fus = sc.follow_ups || [];
    var CHECK_STAGE = 2 + fus.length, RECORD_STAGE = CHECK_STAGE + 1;
    var stage = Math.min(startStage || 0, RECORD_STAGE);
    var fuRevealed = false, hintUsed = !!hintWasUsed;   // survives a reload; see saveResume below
    var bluf = '';
    var checks = [false, false, false];

    function derive() {
      var n = 0;
      checks.forEach(function (c) { if (c) n++; });
      var g = n >= 3 ? 3 : (n >= 2 ? 2 : 1);
      if (hintUsed && g > 2) g = 2; // a hint you needed is a hint the panel would have heard you need
      return g;
    }
    function bridgePool() {
      return ladderPool(rung).filter(function (c) { return c.topic === sc.topic; });
    }
    function advance() { stage++; fuRevealed = false; step(); }

    function step() {
      /* Every render owns its key state. Without this reset, the previous view's handler
         survived into stages that set none: space on the scenario screen fired the ladder
         view's start button (gone from the DOM — TypeError), and space on the checklist
         fired the last follow-up's advance — skipping the grade and showing a verdict
         that was never saved. */
      keyHandler(null);
      // hintUsed must ride along: without it a reload before self-grading silently lifted
      // the documented hint cap and let a hinted answer score "Board-ready".
      saveResume('ladderBoard', rung, [sc], stage, 0, label, { hintUsed: hintUsed });
      var body = '<div class="st-chip">Board sim · ' + esc(sc.topic) + '</div>';
      if (stage === 0) {
        body += '<div class="st-scenario"><div class="st-scen-eyebrow">The scenario</div>' + esc(sc.scenario) + '</div>' +
          '<div class="st-panel-ask"><span class="st-ask-kicker">The panel asks</span>' + esc(sc.ask) + '</div>' +
          '<p class="st-outloud">Answer <b>out loud</b>, all the way through, as if the panel were in front of you. ' +
          'Take as long as you need — nothing here is timed.</p>' +
          recorderHtml() +
          '<label class="st-bd-bluf-lab" for="bd-bluf">Bottom line up front — one line, the way you opened</label>' +
          '<input class="st-bd-bluf" id="bd-bluf" type="text" maxlength="140" autocomplete="off" ' +
          'placeholder="e.g. I’d stop the award and run a set-aside check first.">' +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">I’m done — show the model answer</button></div>';
      } else if (stage === 1) {
        body += '<div class="st-scenario st-scenario-sm">' + esc(sc.scenario) + '</div>' +
          (bluf
            ? '<div class="st-bd-echo"><div class="st-bd-echo-head">What you said you’d do</div>' + esc(bluf) + '</div>'
            : '<div class="st-bd-echo st-bd-echo-none">No opening line — the model answer is below.</div>') +
          // Play your own run-through immediately above the model answer — hearing the two
          // back to back is the whole reason for recording.
          (REC.state === 'have'
            ? '<div class="st-bd-echo st-bd-echo-audio"><div class="st-bd-echo-head">Your recorded answer</div>' +
              recAudioHtml('') + '</div>'
            : '') +
          '<div class="st-script"><div class="st-script-head">Say it like this</div><p>' + esc(sc.script) + '</p></div>' +
          boardCitesText(sc.cites) +
          // The assess step: you have just heard yourself and read the model answer, so this
          // is the moment the difference between them is obvious.
          '<label class="st-bd-note-lab" for="bd-note">What you would fix next time</label>' +
          '<textarea class="st-bd-bluf st-bd-note" id="bd-note" rows="3" maxlength="' + NOTE_MAX +
          '" autocomplete="off" placeholder="e.g. I never named the section — lead with R-DFARS 215.306 next time.">' +
          esc(bdNote(sc.id)) + '</textarea>' +
          '<p class="st-bd-note-meta" id="bd-note-meta">Kept on this device · export from the ladder</p>' +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">' +
          (fus.length ? 'The panel follows up… <kbd>space</kbd>' : 'Grade yourself') + '</button></div>';
      } else if (stage < CHECK_STAGE) {
        var k = stage - 2, fu = fus[k] || {};
        body += '<div class="st-followup"><span>Panel follow-up ' + (k + 1) + ' of ' + fus.length + '</span>' +
          '<div class="st-q">' + esc(fu.q) + '</div></div>';
        if (fuRevealed && fu.d) {
          body += '<div class="st-fu-debrief"><div class="st-fu-debrief-head">Debrief</div><p>' + esc(fu.d) + '</p></div>' +
            '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">' +
            (k + 1 < fus.length ? 'Next follow-up <kbd>space</kbd>' : 'Grade yourself') + '</button></div>';
        } else {
          body += '<p class="st-outloud">Answer <b>out loud</b>, then reveal the debrief.</p>' +
            '<div id="fu-hint-box"></div>' +
            '<div class="st-actions" id="fu-acts">' +
            (fu.h ? '<button class="st-btn st-btn-hint" id="fu-hint">Hint</button>' : '') +
            '<button class="st-btn st-btn-reveal" id="fu-reveal">Reveal the debrief <kbd>space</kbd></button></div>';
        }
      } else if (stage === CHECK_STAGE) {
        // Grading by checklist rather than by feel: the three items ARE the shape of a board
        // answer, so scoring yourself teaches the shape even when the verdict is Rough.
        body += '<div class="st-q">How did that go? Check what you actually did.</div>' +
          '<div class="st-bd-check">' + BD_CHECKS.map(function (t, ci) {
            return '<button class="st-bd-chk' + (checks[ci] ? ' st-bd-chk-on' : '') + '" data-chk="' + ci +
              '" aria-pressed="' + checks[ci] + '"><span class="st-bd-chk-box" aria-hidden="true"></span>' +
              esc(t) + '</button>';
          }).join('') + '</div>' +
          (hintUsed ? '<p class="st-bd-capped">You took a hint, so this one caps at “getting there”.</p>' : '') +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="bd-score">Score it</button></div>';
      } else {
        var rec = done[sc.id] || { g: derive() };
        var bp = bridgePool();
        body += '<div class="st-bd-verdict st-bd-v' + rec.g + '">' + BD_VERDICT[rec.g] + '</div>' +
          '<p class="st-sub">' + esc(sc.topic) + ' · ' + esc(label) + '</p>' +
          boardCitesLinked(sc.cites) +
          '<div class="st-actions">' +
          (bp.length ? '<button class="st-btn st-btn-reveal" id="bd-drill">Study the ' + bp.length +
            (bp.length === 1 ? ' card' : ' cards') + ' behind this</button>' : '') +
          '<button class="st-btn' + (bp.length ? ' st-btn-hint' : ' st-btn-reveal') + '" id="bd-next">Next scenario</button>' +
          '<button class="st-btn st-btn-hint" id="bd-home">Back to the ladder</button></div>';
      }
      var headNote = stage === 0 ? 'the ask'
        : stage === 1 ? 'the model answer'
        : stage < CHECK_STAGE ? 'follow-up ' + (stage - 1) + ' of ' + fus.length
        : stage === CHECK_STAGE ? 'your call' : 'the record';
      /* The same shape round 4 gave the /study Board Sim, for the same reasons: the stage
         sequence was invisible, and from the debrief on the scenario and the panel's
         question scrolled away — so you answered follow-ups about a scenario you could no
         longer read. Rendering .rz-sim also pins the chrome and widens the shell.
         The recorder and the bottom-line-up-front field stay exactly as they are: both are
         owner decisions, and the BLUF is captured BEFORE the reveal, which is the point. */
      var facedN = pool.filter(function (x) { return done[x.id]; }).length;
      var railBody = stage > 0
        ? '<div class="rz-rail-h">The scenario</div>' +
          '<p class="rz-sim-scen">' + esc(sc.scenario) + '</p>' +
          (sc.ask ? '<div class="rz-rail-h">The panel asks</div><p class="rz-sim-ask">' + esc(sc.ask) + '</p>' : '')
        : '<div class="rz-rail-h">What you are in for</div>' +
          '<p class="rz-sim-meta">' + (fus.length ? 'The model answer, then <b>' + fus.length +
            '</b> panel follow-up' + (fus.length !== 1 ? 's' : '') + ', then you grade yourself.'
            : 'The model answer, then you grade yourself.') + '</p>' +
          '<p class="rz-sim-meta">Answer out loud before you reveal anything. Nobody sees the grade \u2014 it only decides what comes back.</p>';
      render(
        chromeHtml({ course: '48 CONS \u00b7 Warrant Prep', back: true, backLabel: 'Exit',
          backAria: 'End this sim and go back to the ladder',
          now: label + ' \u00b7 ' + sc.topic,
          prog: { done: facedN, total: pool.length,
                  pct: pool.length ? Math.round(100 * facedN / pool.length) : 0 } }) +
        '<div class="rz-sim">' +
        '<div class="rz-sim-main">' + boardSteps(Math.min(stage, CHECK_STAGE + 1), fus.length, 'Record') +
        '<div class="st-card" aria-live="polite">' + body + '</div>' +
        '<div class="rz-sim-exits">' +
        '<button class="st-link" id="st-quit">End this sim</button></div></div>' +
        '<aside class="rz-sim-rail" aria-label="Scenario reference">' + railBody +
        '<div class="rz-sim-tally">' + facedN + ' of ' + pool.length + ' faced at ' + esc(label) + '</div>' +
        '</aside></div>');
      el('st-quit').onclick = function () { recRelease(); clearResume(); viewLadder(); };
      el('rz-bar-back').onclick = function () { recRelease(); clearResume(); viewLadder(); };

      // Notes autosave silently, like the Introduction Builder's fields. No per-keystroke
      // "Saved" flash: .st-card is an aria-live region, so that would interrupt a screen
      // reader on every character. The static line under the box carries the reassurance.
      if (el('bd-note')) {
        var ta = el('bd-note');
        ta.addEventListener('input', function () { bdNoteSet(sc.id, ta.value); });
      }

      if (stage === 0) {
        wireRecorder();
        var leaving = false;
        el('next').onclick = function () {
          if (leaving) return;              // stopping is async; a second press must not double-advance
          leaving = true;
          var f = el('bd-bluf');
          bluf = f ? f.value.trim() : '';   // read, echoed once, never persisted
          recStop(advance);                 // "I'm done" ends the take, and the model answer waits for it
        };
        // Enter in the one-line box submits it — a single-line input that swallows Enter
        // reads as broken, and there is nowhere else for Enter to go on this screen.
        el('bd-bluf').addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); el('next').onclick(); }
        });
      } else if (stage < CHECK_STAGE && stage >= 2 && !(fuRevealed && fus[stage - 2] && fus[stage - 2].d)) {
        if (el('fu-hint')) el('fu-hint').onclick = showHint;
        el('fu-reveal').onclick = function () { fuRevealed = true; step(); };
        keyHandler(function (k) {
          if (k === ' ' || k === 'Enter') { fuRevealed = true; step(); return true; }
        });
      } else if (stage === CHECK_STAGE) {
        Array.prototype.forEach.call(app.querySelectorAll('.st-bd-chk'), function (b) {
          b.onclick = function () {
            var ci = +b.getAttribute('data-chk');
            checks[ci] = !checks[ci];
            b.classList.toggle('st-bd-chk-on', checks[ci]);
            b.setAttribute('aria-pressed', checks[ci]);
          };
        });
        el('bd-score').onclick = function () {
          var g = derive();
          done[sc.id] = { g: g, hint: hintUsed };
          if (g === 1) ladderBoardNoteRough(sc.id);
          bumpStreak(); save();
          stage++; step();
        };
      } else if (stage >= RECORD_STAGE) {
        keyHandler(null); clearResume();
        if (el('bd-drill')) {
          el('bd-drill').onclick = function () {
            var bp2 = bridgePool();
            recRelease();
            goDepth(2, function () { ladderSession(bp2, label); });
          };
        }
        el('bd-next').onclick = function () { ladderBoardSession(rung, label); };  // releases on entry
        el('bd-home').onclick = function () { recRelease(); clearResume(); viewLadder(); };
      } else if (el('next')) {
        el('next').onclick = advance;
        keyHandler(function (k) { if (k === ' ' || k === 'Enter') { advance(); return true; } });
      }

      function showHint() {
        var f = fus[stage - 2] || {};
        var box = el('fu-hint-box');
        if (box && f.h) {
          var div = document.createElement('div');
          div.className = 'st-hint';
          div.innerHTML = '<b>Hint:</b> ' + esc(f.h);
          box.appendChild(div);
        }
        hintUsed = true;
        /* Persist it NOW. saveResume only runs at the top of step(), and revealing a hint
           appends the node in place without re-stepping — so a reload between taking the hint
           and self-grading came back with hintUsed false and let a hinted answer score
           "Board-ready", the exact cap the resume payload was added to protect. */
        saveResume('ladderBoard', rung, [sc], stage, 0, label, { hintUsed: hintUsed });
        if (el('fu-hint')) el('fu-hint').disabled = true;
      }
    }
    step();
  }
  function resumeLadderBoard() {
    var r = S.resume;
    if (!r || r.mode !== 'ladderBoard' || !r.ids || !r.ids.length) { clearResume(); return false; }
    if (!ladderBoardPool(r.rung).some(function (s) { return s.id === r.ids[0]; })) { clearResume(); return false; }
    S.ladderRung = r.rung; save();
    depth1View = viewLadder;
    goDepth(2, function () { ladderBoardSession(r.rung, r.label, r.ids[0], r.i, r.hintUsed); });
    return true;
  }
  /* render() deliberately skips its anchor-scroll on the very first paint so a cold arrival
     rests on the hero instead of being yanked past it. A resume is not an arrival — you were
     already mid-drill and only left to read a citation — so that reasoning inverts here.
     Left alone, a cold resume put the card 578px down a 720px viewport with the reveal
     button below the fold, which is a fold bug this feature would itself have created. */
  /* The other three modes lost their place for the same reason the ladder did: nothing
     recorded where you were. They restore into viewHome's depth so Back still walks out
     through the dashboard rather than off the page. */
  function resumeRecall() {
    var r = S.resume;
    var q = r.ids ? cardsByIdFromPool(recallPool(), r.ids) : null;
    if (!q || r.i >= q.length) { clearResume(); return false; }
    depth1View = homeFn();
    var dropped = (Object.prototype.toString.call(r.shaky) === '[object Array]')
      ? cardsByIdFromPool(recallPool(), r.shaky) : [];
    goDepth(2, function () { startSession(q, r.label, r.i, r.got, dropped); });
    return true;
  }
  function resumeDeep() {
    var r = S.resume;
    var q = r.ids ? cardsByIdFromPool(recallPool(), r.ids) : null;
    if (!q || !q.length) { clearResume(); return false; }
    depth1View = homeFn();
    goDepth(2, function () { viewDeep(q[0], r.seen || 0, r.got || 0); });
    return true;
  }
  function resumeSprint() {
    var r = S.resume;
    var q = r.ids ? cardsByIdFromPool(deck.thresholds, r.ids) : null;
    if (!q || r.i >= q.length) { clearResume(); return false; }
    // The sprint sits at depth 1 on the org page (a tool off the front page) and depth 2 on
    // /study (an activity off the dashboard) — resume into the depth it was launched from, or
    // Back walks out to the wrong place.
    depth1View = isOrg() ? viewSprint : homeFn();
    goDepth(isOrg() ? 1 : 2, function () { viewSprint(q, r.i, r.streak || 0); });
    return true;
  }
  function resumeSession() {
    var r = S.resume;
    if (!r) return false;
    // Sessions don't cross pages. A ladder session saved on /48cons must not repaint the
    // ladder onto public /study (progress is one shared key), and the org page has no track
    // views to resume into. Leave the other page's session parked rather than clearing it —
    // clearing would cost someone their place just for opening the other page.
    // Sessions saved before this stamp existed fall back to the old inference, so nobody
    // loses their place on the upgrade.
    var homeOrg = (typeof r.org === 'boolean') ? r.org
      : (r.mode === 'ladder' || r.mode === 'ladderBoard');
    if (homeOrg !== isOrg()) return false;
    // ladder, board sims, the games and the threshold sprint need no track selected; the
    // track-bound modes do. (Sprint runs on the org page, which has no track picker at all.)
    if (r.mode !== 'ladder' && r.mode !== 'ladderBoard' && r.mode !== 'governs' &&
        r.mode !== 'sprint' && !S.track) { clearResume(); return false; }
    rendered = true;
    var ok = r.mode === 'ladderBoard' ? resumeLadderBoard()
      : r.mode === 'recall' ? resumeRecall()
      : r.mode === 'deep' ? resumeDeep()
      : r.mode === 'sprint' ? resumeSprint()
      : r.mode === 'governs' ? resumeGoverns()
      : r.mode === 'board' ? resumeBoard()
      : r.mode === 'lesson' ? resumeLesson()
      : resumeLadder();
    if (!ok) rendered = false;   // nothing resumed — the next paint really is a cold arrival
    return ok;
  }

  /* A knowledge check resumes to its lesson and reopens the check at the question you
     were on. The reading above it re-renders from the deck, so only the position and the
     running score have to survive; ids are re-derived, and a lesson whose key no longer
     exists after a deck refresh simply drops back to the outline. */
  function resumeLesson() {
    if (!S.track) return false;
    var r = S.resume, key = r.label;
    var exists = courseLessons().filter(function (l) { return l.key === key; }).length;
    if (!exists) { clearResume(); return false; }
    depth1View = viewCourse;
    goDepth(2, function () { viewLesson(key, { i: r.i || 0, got: r.got || 0, ids: r.ids || [] }); });
    return true;
  }

  /* ---- The Combination — the daily vault word ---- */
  var NUMWORD = { 5: 'five', 6: 'six', 7: 'seven', 8: 'eight' };
  var KB_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'];
  function viewCombo() {
    var G = gamesState().combo;
    var day = comboToday();
    if (G.day !== day) { G.day = day; G.rows = []; G.done = false; G.win = false; G.hints = 0; save(); }
    var entry = comboWordFor(day), target = entry.w;
    var LEN = target.length;              // 5-8; the board, keyboard and accept list all follow it
    var guess = '';
    var HINTS = comboHintList(entry, target);
    // A hint costs a row, so the budget shrinks as hints are taken.
    function hintsUsed() { return G.hints || 0; }
    function rowBudget() { return 6 - hintsUsed(); }
    function triesLeft() { return rowBudget() - G.rows.length; }
    var motion = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    function evalRow(g) { // standard two-pass: correct first, then presents against remaining letters
      var res = [], left = {};
      for (var i = 0; i < LEN; i++) {
        if (g[i] === target[i]) res[i] = 'c';
        else { res[i] = 'a'; left[target[i]] = (left[target[i]] || 0) + 1; }
      }
      for (i = 0; i < LEN; i++) {
        if (res[i] === 'a' && left[g[i]]) { res[i] = 'p'; left[g[i]]--; }
      }
      return res;
    }
    function keyStates() {
      var ks = {};
      G.rows.forEach(function (g) {
        var r = evalRow(g);
        for (var i = 0; i < LEN; i++) {
          var cur = ks[g[i]];
          if (r[i] === 'c' || (r[i] === 'p' && cur !== 'c') || (r[i] === 'a' && !cur)) ks[g[i]] = r[i];
        }
      });
      return ks;
    }
    function boardHtml() {
      var html = '';
      for (var r = 0; r < 6; r++) {
        // Rows past the budget are the ones the hints bought. Showing them struck through
        // rather than deleting them is the point: the cost stays on screen next to the board.
        var spent = r >= rowBudget();
        html += '<div class="st-cb-row' + (spent ? ' st-cb-row-spent' : '') + '" data-r="' + r + '"' +
          (spent ? ' aria-label="Row traded for a hint"' : '') + '>';
        for (var c = 0; c < LEN; c++) {
          var ch = '', cls = '';
          if (r < G.rows.length) {
            ch = G.rows[r][c];
            cls = ' st-cb-' + evalRow(G.rows[r])[c];
          } else if (r === G.rows.length && !G.done) {
            ch = guess[c] || '';
            if (ch) cls = ' st-cb-fill';
          }
          // Right-spot / wrong-spot / not-in-word was conveyed by colour alone. Give each
          // SCORED tile a text equivalent so it is usable without colour perception.
          var st = (r < G.rows.length) ? evalRow(G.rows[r])[c] : '';
          var lbl = st === 'c' ? 'right spot' : st === 'p' ? 'in the word, wrong spot' : st === 'a' ? 'not in the word' : '';
          html += '<span class="st-cb-tile' + cls + '"' +
                  (lbl ? ' role="img" aria-label="' + ch + ', ' + lbl + '"' : '') +
                  '>' + ch + '</span>';
        }
        html += '</div>';
      }
      return html;
    }
    function kbHtml() {
      var ks = keyStates();
      return KB_ROWS.map(function (row) {
        return '<div class="st-cb-kbrow">' + row.split('').map(function (k) {
          if (k === '⏎') return '<button class="st-cb-key st-cb-key-wide st-cb-key-enter" data-k="ENTER">Enter</button>';
          if (k === '⌫') return '<button class="st-cb-key st-cb-key-wide st-cb-key-back" data-k="BACK" aria-label="Delete letter"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9L3 12l6-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 9.5l5 5M17 9.5l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>';
          return '<button class="st-cb-key' + (ks[k] ? ' st-cb-key-' + ks[k] : '') + '" data-k="' + k + '">' + k + '</button>';
        }).join('') + '</div>';
      }).join('');
    }
    function hintsHtml() {
      var used = hintsUsed(), out = '', i;
      for (i = 0; i < used && i < HINTS.length; i++) {
        out += '<div class="st-cb-hint"><span class="st-cb-hint-k">' + esc(HINTS[i].k) + '</span>' +
          '<span class="st-cb-hint-v">' + esc(HINTS[i].v) + '</span></div>';
      }
      if (used < HINTS.length) {
        /* Never let a hint end the round on the spot. With one try left the trade is not a
           trade — you would spend the row you needed to use the hint on. */
        var ok = triesLeft() >= 2;
        out += '<div class="st-cb-hintbar">' +
          '<button class="st-btn st-btn-hint st-cb-hintbtn" id="cb-hint"' + (ok ? '' : ' disabled') + '>' +
          'Take a hint <span class="st-cb-hint-cost">costs a try</span></button>' +
          '<span class="st-cb-hint-left">' + (HINTS.length - used) + ' of ' + HINTS.length +
          (ok ? ' left' : ' left · not on your last try') + '</span></div>';
      }
      return out ? '<div class="st-cb-hints">' + out + '</div>' : '';
    }
    function exTile(ch, state) { return '<span class="st-cb-tile st-cb-tile-ex' + (state ? ' st-cb-' + state : '') + '">' + ch + '</span>'; }
    function helpHtml(first) {
      return '<div class="st-cb-help">' +
        '<div class="st-cb-help-head">How to crack it</div>' +
        '<p>Guess the day&rsquo;s <b>acquisition term</b> — a five-letter word — in six tries. Type on your keyboard or tap the keys below. <b>Enter</b> submits a row; the <b>⌫ key removes a letter</b> (tapping the row does too).</p>' +
        '<p>After each guess, the tiles tell you how close you are:</p>' +
        '<div class="st-cb-help-row">' + exTile('S', 'c') + exTile('C', '') + exTile('O', '') + exTile('P', '') + exTile('E', '') + '<span><b>S</b> is in the word, in the right spot</span></div>' +
        '<div class="st-cb-help-row">' + exTile('A', '') + exTile('U', 'p') + exTile('D', '') + exTile('I', '') + exTile('T', '') + '<span><b>U</b> is in the word, in a different spot</span></div>' +
        '<div class="st-cb-help-row">' + exTile('C', '') + exTile('L', '') + exTile('A', '') + exTile('I', '') + exTile('M', 'a') + '<span><b>M</b> isn&rsquo;t in the word at all</span></div>' +
        '<p><b>Stuck?</b> Take up to <b>two hints</b> — where the term lives, then what it means. ' +
        'Each one <b>spends a try</b>, so it is a trade rather than a freebie and your score counts it. ' +
        'Neither one spells the word out.</p>' +
        '<p>Same word for everyone, everywhere — a new one every day. Crack it and the vault teaches you the term.</p>' +
        '<div class="st-actions" style="justify-content:center"><button class="st-btn st-btn-reveal" id="cb-help-go">' + (first ? 'Got it — open the board' : 'Back to the board') + '</button></div></div>';
    }
    function zuluCountdown() {   // time left in this round — the 5 a.m. Central roll
      var ms = Math.max(0, comboResetAt(day) - Date.now());
      var h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
      return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    }
    function shareText() {
      var no = comboNo(day);
      var grid = G.rows.map(function (g) {
        // 🟦/🟨 mirrors the board's navy/brass — the colorblind-safe pair — not Wordle's green
        return evalRow(g).map(function (s) { return s === 'c' ? '🟦' : s === 'p' ? '🟨' : '⬛'; }).join('');
      }).join('\n');
      var run = G.streak.run, hn = hintsUsed();
      // A hint row is a spent row, so it shows in the grid as one. Sharing a 3/6 that quietly
      // cost two hints alongside someone else's clean 3/6 would make the number meaningless.
      if (hn) grid += (grid ? '\n' : '') + new Array(hn + 1).join('🔑');
      return 'AcqVault — The Combination No. ' + no + ' · ' + (G.win ? comboScore(G) : 'X') + '/6\n' + grid +
        (hn ? '\n' + hn + ' hint' + (hn === 1 ? '' : 's') : '') +
        (run > 1 ? '\n' + run + '-duty-day streak' : '') + '\nacqvault.com/study';
    }
    function resultHtml() {
      var hist = G.hist, mx = 1, k;
      for (k = 1; k <= 6; k++) mx = Math.max(mx, hist[k]);
      var bars = '';
      for (k = 1; k <= 6; k++) {
        bars += '<div class="st-cb-hrow"><span>' + k + '</span><div class="st-cb-hbar"><span style="width:' + Math.round(100 * hist[k] / mx) + '%"' + (G.win && G.rows.length === k ? ' class="st-cb-hbar-me"' : '') + '>' + (hist[k] || '') + '</span></div></div>';
      }
      return '<div class="st-cb-result">' +
        '<div class="st-cb-dial' + (G.win && motion ? ' st-cb-dial-spin' : '') + '">' + DIAL_SVG + '</div>' +
        '<div class="st-cb-verdict">' + (G.win ? 'Cracked in ' + comboScore(G) : 'Sealed — the combination was') + '</div>' +
        (hintsUsed() ? '<div class="st-cb-hintused">' + hintsUsed() + ' hint' + (hintsUsed() === 1 ? '' : 's') +
          ' taken — ' + hintsUsed() + ' of the six tries went to it</div>' : '') +
        '<div class="st-cb-word">' + target + '</div>' +
        '<p class="st-cb-def">' + esc(entry.def) + '</p>' +
        (entry.cite ? '<div class="st-explain-ref">Where it lives: <b>' + esc(entry.cite) + '</b></div>' : '') +
        citesHtml(entry.links) +
        (G.streak.run > 1 ? '<div class="st-cb-streakline">' + G.streak.run + '-duty-day streak — weekends don&rsquo;t break it</div>' : '') +
        '<div class="st-cb-hist">' + bars + '</div>' +
        '<div class="st-actions" style="justify-content:center"><button class="st-btn st-btn-reveal" id="cb-share">Copy result</button></div>' +
        '<div class="st-cb-board-mod" id="cb-lb"></div>' +
        '<p class="st-sub" style="text-align:center">Next combination in ' + zuluCountdown() + ' · same word for everyone</p></div>';
    }
    var helping = false;
    function paint(msg) {
      var firstTime = !gamesState().combo.helpSeen;
      if (firstTime && !G.done) helping = true;
      render('<div class="st-session-head"><span>The Combination · No. ' + comboNo(day) + '</span><span>' +
        (G.done ? '' : (helping ? '' : triesLeft() + (triesLeft() === 1 ? ' try left · ' : ' tries left · ')) + '<button class="st-link st-cb-helpbtn" id="cb-help">how to play</button>') + '</span></div>' +
        '<div class="st-card st-cb-card">' +
        (helping && !G.done ? helpHtml(firstTime) :
         G.done ? resultHtml() :
          (entry.cat ? '<div class="st-cb-cat"><span>Category</span>' + esc(entry.cat) + '</div>' : '') +
          '<p class="st-cb-prompt">Guess the ' + NUMWORD[LEN] + '-letter acquisition term — type or tap, then press <b>Enter</b>.</p>' +
          '<div class="st-cb-board" id="cb-board" style="--cb-len:' + LEN + (LEN > 6 ? ';--cb-gap:4px' : '') + '">' + boardHtml() + '</div>' +
          '<div class="st-cb-legend" aria-label="What the colors mean">' +
          '<span><i class="st-cb-tile st-cb-c"></i>right spot</span>' +
          '<span><i class="st-cb-tile st-cb-p"></i>in the word, wrong spot</span>' +
          '<span><i class="st-cb-tile st-cb-a"></i>not in the word</span></div>' +
          '<div class="st-cb-msg" id="cb-msg">' + (msg || '') + '</div>' +
          hintsHtml() +
          '<div class="st-cb-kb" id="cb-kb">' + kbHtml() + '</div>') +
        '</div>' +
        '<button class="st-link st-quit" id="st-quit">\u2190 Study menu</button>');
      el('st-quit').onclick = backToTools;
      if (el('cb-help')) el('cb-help').onclick = function () { helping = true; paint(); };
      if (el('cb-help-go')) el('cb-help-go').onclick = function () {
        helping = false;
        gamesState().combo.helpSeen = true; save();
        paint();
      };
      if (G.done) { wireShare(); wireBoard(); keyHandler(null); return; }
      if (helping) { keyHandler(function (key) { if (key === 'Enter' || key === ' ') { el('cb-help-go').onclick(); return true; } }); return; }
      if (el('cb-hint')) {
        el('cb-hint').onclick = function () {
          if (hintsUsed() >= HINTS.length || triesLeft() < 2) return;
          G.hints = hintsUsed() + 1; save();
          paint();
          // .st-cb-card is aria-live=polite, so the new hint announces itself; put focus back
          // on the control the user was operating rather than the repainted container.
          var b = el('cb-hint') || el('cb-msg');
          if (b) { try { b.focus({ preventScroll: true }); } catch (e) {} }
        };
      }
      Array.prototype.forEach.call(app.querySelectorAll('.st-cb-key'), function (b) {
        b.onclick = function () { input(b.getAttribute('data-k')); };
      });
      // tapping the active row also erases — the board itself is a control
      var active = app.querySelector('.st-cb-row[data-r="' + G.rows.length + '"]');
      if (active) active.onclick = function () { input('BACK'); };
      keyHandler(function (key) {
        if (key === 'Enter') { input('ENTER'); return true; }
        if (key === 'Backspace') { input('BACK'); return true; }
        if (/^[a-zA-Z]$/.test(key)) { input(key.toUpperCase()); return true; }
      });
    }
    function wireShare() {
      var b = el('cb-share'); if (!b) return;
      b.onclick = function () {
        var t = shareText();
        function ok() { b.textContent = 'Copied — paste it anywhere'; setTimeout(function () { var bb = el('cb-share'); if (bb) bb.textContent = 'Copy result'; }, 2200); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { fallbackShare(t, ok); });
        else fallbackShare(t, ok);
      };
    }
    function fallbackShare(t, ok) {
      var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { if (document.execCommand('copy')) ok(); } catch (e) {}
      document.body.removeChild(ta);
    }
    // Matching on display name alone highlighted EVERY entry called "Anonymous" as the
    // current user. The server hands back the poster's rank, so require the position to
    // match too; if the rank has since shifted we simply highlight nothing, which is far
    // better than pointing at a stranger.
    function boardListHtml(top, mine, myRank) {
      if (!top.length) return '<p class="st-sub" style="text-align:center;margin:6px 0 0">No one on the board yet — be first.</p>';
      return '<ol class="st-lb-list">' + top.slice(0, 10).map(function (e, i) {
        var isMe = !!mine && e.n === mine && (myRank ? (i + 1) === Number(myRank) : true);
        return '<li' + (isMe ? ' class="st-lb-me"' : '') + '><span class="st-lb-rank">' + (i + 1) + '</span><span class="st-lb-name">' + esc(e.n) + '</span><span class="st-lb-g">' + (e.g === 'X' ? '—' : e.g + '/6') + '</span></li>';
      }).join('') + '</ol>';
    }
    function wireBoard() {
      var box = el('cb-lb'); if (!box) return;
      var posted = G.postedDay === day;
      fetch('/api/feedback?board=1').then(function (r) { return r.json(); }).then(function (b) {
        if (!b.configured) { box.innerHTML = ''; return; }
        var head = '<div class="st-lb-head">Today&rsquo;s board · ' + b.count + ' on it</div>';
        if (posted) {
          box.innerHTML = head + boardListHtml(b.top, G.postedName, G.postedRank) +
            (G.postedRank ? '<p class="st-sub" style="text-align:center;margin-top:6px">You&rsquo;re #' + G.postedRank + ' today.</p>' : '');
          return;
        }
        box.innerHTML = head + boardListHtml(b.top) +
          '<div class="st-lb-post"><input id="lb-name" maxlength="18" placeholder="Anonymous — or add a name" aria-label="Display name">' +
          '<button class="st-btn st-btn-hint" id="lb-go">Post to the board</button></div>' +
          '<p class="st-sub" style="text-align:center;margin:5px 0 0">Just your result and the name you type — nothing else leaves this browser.</p>';
        var go = el('lb-go');
        if (go) go.onclick = function () {
          go.disabled = true; go.textContent = 'Posting…';
          fetch('/api/feedback', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            // Hints included — the board ranks by what the round cost, not by rows typed.
            body: JSON.stringify({ kind: 'board', day: comboNo(day), guesses: G.win ? comboScore(G) : 'X', name: (el('lb-name') || {}).value || '' })
          }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (o) {
            if (o.ok && o.j.ok) {
              G.postedDay = day; G.postedRank = o.j.rank; G.postedName = o.j.name; save();
              wireBoard();
            } else {
              go.disabled = false; go.textContent = 'Post to the board';
              var msg = el('cb-msg'); if (msg) msg.textContent = (o.j && o.j.error) || 'Couldn’t reach the board.';
              else { var p = document.createElement('p'); p.className = 'st-sub'; p.style.textAlign = 'center'; p.textContent = (o.j && o.j.error) || 'Couldn’t reach the board.'; box.appendChild(p); }
            }
          }).catch(function () { go.disabled = false; go.textContent = 'Post to the board'; });
        };
      }).catch(function () { box.innerHTML = ''; });
    }
    function updateRow() {
      var row = app.querySelector('.st-cb-row[data-r="' + G.rows.length + '"]');
      if (!row) return;
      Array.prototype.forEach.call(row.children, function (tile, c) {
        tile.textContent = guess[c] || '';
        tile.className = 'st-cb-tile' + (guess[c] ? ' st-cb-fill' : '');
      });
    }
    function input(k) {
      if (G.done) return;
      if (k === 'BACK') { guess = guess.slice(0, -1); updateRow(); return; }
      if (k === 'ENTER') { submit(); return; }
      if (guess.length < LEN) { guess += k; updateRow(); }
    }
    function submit() {
      var m = el('cb-msg');
      if (guess.length < LEN) {
        if (m) m.textContent = NUMWORD[LEN].charAt(0).toUpperCase() + NUMWORD[LEN].slice(1) + ' letters.';
        var row = app.querySelector('.st-cb-row[data-r="' + G.rows.length + '"]');
        if (row && motion) { row.classList.add('st-cb-row-shake'); setTimeout(function () { row.classList.remove('st-cb-row-shake'); }, 350); }
        return;
      }
      if (!comboDictHas(guess)) {
        // at 6-8 the accept list IS the corpus, so say so — a rejected guess is a word
        // the regulations never use, which is the point of drawing the list from them
        if (m) m.textContent = LEN > 5 ? 'Not in the rulebook.' : 'Not in the word list.';
        var row2 = app.querySelector('.st-cb-row[data-r="' + G.rows.length + '"]');
        if (row2 && motion) { row2.classList.add('st-cb-row-shake'); setTimeout(function () { row2.classList.remove('st-cb-row-shake'); }, 350); }
        return;
      }
      if (m) m.textContent = '';
      var g = guess; guess = '';
      var res = evalRow(g);
      var row = app.querySelector('.st-cb-row[data-r="' + G.rows.length + '"]');
      G.rows.push(g);
      var won = g === target;
      // The budget, not a bare 6 — a hint already took one of the rows.
      if (won || G.rows.length >= rowBudget()) {
        G.done = true; G.win = won;
        if (won) G.hist[comboScore(G)]++; else G.hist.X++;
        comboBumpStreak(won);
        gamesMarkToday();
        if (won) bumpStreak();
      }
      save();
      if (row && motion) {
        Array.prototype.forEach.call(row.children, function (tile, i) {
          tile.textContent = g[i];
          setTimeout(function () { tile.classList.add('st-cb-flip'); }, i * 130);
          setTimeout(function () { tile.classList.add('st-cb-' + res[i]); }, i * 130 + 160);
        });
        // repaint only after the LAST tile has flipped — a fixed 5-tile wait would cut
        // the reveal short on longer words (8 tiles finish at 8*130+160)
        setTimeout(function () { paint(); }, LEN * 130 + 420);
      } else paint();
    }
    paint();
  }

  /* ---- Which Part Governs? — 90 seconds of issue-spotting ---- */
  var GV_SECONDS = 90, GV_RING_C = 2 * Math.PI * 34;
  function gvTier(score) {
    if (score >= 3600) return 'Unlimited Warrant';
    if (score >= 2400) return 'Contracting Officer';
    if (score >= 1200) return 'Contract Specialist';
    return 'Buyer';
  }
  function viewGoverns() {
    var pool = shuffle(deck.games.governs.slice());
    var PN = deck.games.part_names;
    var i = 0, score = 0, combo = 0, bestCombo = 0, misses = [], answered = false, caseNo = 0;
    var endAt = 0, tick = null, qShownAt = 0, started = false, pend = null, ended = false;
    function mult() { return 1 + Math.min(4, Math.floor(combo / 2)); }
    function remaining() { return Math.max(0, (endAt - Date.now()) / 1000); }
    function ringHtml() {
      return '<span class="st-gv-ring" id="gv-ring"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" fill="none" stroke="rgba(23,58,96,.14)" stroke-width="6"/><circle id="gv-arc" cx="40" cy="40" r="34" fill="none" stroke="#173a60" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + GV_RING_C.toFixed(1) + '" stroke-dashoffset="0" transform="rotate(-90 40 40)"/></svg><b id="gv-secs">' + GV_SECONDS + '</b></span>';
    }
    function pipsHtml() {
      var m = mult(), out = '';
      for (var p = 1; p <= 5; p++) out += '<span class="st-gv-pip' + (p <= m ? ' st-gv-pip-on' : '') + '"></span>';
      return '<span class="st-gv-pips' + (m >= 3 ? ' st-gv-pips-hot' : '') + '" id="gv-pips" title="Combo multiplier ×' + m + '">' + out + '<b id="gv-mult">×' + m + '</b></span>';
    }
    function intro() {
      var G = gamesState().governs;
      var pb = G.best_advanced || G.best || 0;
      var pc = G.bestCombo_advanced || G.bestCombo || 0;
      render('<div class="st-card st-gv-intro">' +
        '<div class="st-gv-intro-ring">' + ringHtml() + '</div>' +
        '<div class="st-chip">Which Part Governs?</div>' +
        '<div class="st-q" style="text-align:center;margin-top:6px">Ninety seconds. A situation flashes — call the part of the rulebook that governs it.</div>' +
        '<div class="st-gv-rules">' +
        '<span><b>Chain</b> right answers — the multiplier climbs to ×5</span>' +
        '<span><b>Fast calls</b> under 4 seconds earn a bonus</span>' +
        '<span><b>Misses teach</b> — every one is reviewed with its cite</span></div>' +
        (pb ? '<p class="st-sub" style="text-align:center">Personal best ' + pb.toLocaleString() + ' · top combo ×' + pc + '</p>' : '') +
        '<div class="st-actions" style="justify-content:center"><button class="st-btn st-btn-reveal st-gv-start" id="gv-start">Start the clock <kbd>space</kbd></button></div></div>' +
        '<button class="st-link st-quit" id="st-quit">\u2190 Study menu</button>');
      el('st-quit').onclick = backToTools;
      el('gv-start').onclick = begin;
      keyHandler(function (k) { if (k === ' ' || k === 'Enter') { begin(); return true; } });
    }
    function begin() {
      keyHandler(null);
      started = true;
      endAt = Date.now() + GV_SECONDS * 1000;
      tick = setInterval(function () {
        var arc = el('gv-arc'), secs = el('gv-secs'), ring = el('gv-ring');
        if (!arc) { clearInterval(tick); return; }
        var rem = remaining(), frac = rem / GV_SECONDS;
        arc.style.strokeDashoffset = (GV_RING_C * (1 - frac)).toFixed(1);
        if (secs) secs.textContent = Math.ceil(rem);
        if (ring) {
          ring.classList.toggle('st-gv-ring-low', rem <= 15);
          ring.classList.toggle('st-gv-ring-crit', rem <= 6);
        }
        if (rem <= 0) { clearInterval(tick); finish(); }
      }, 100);
      next(true);   // first case: the intro is still on screen, so skip the stale-view guard
    }
    function next(first) {
      if (ended) return;   // a pending reveal-delay must not paint a question over the end screen
      // The guard below protects a DEFERRED next() (setTimeout after an answer) from
      // painting over a view the user has since navigated to. It must not run on the
      // first call, when #gv-card cannot exist yet because the intro is still up —
      // that made begin() return immediately and the round play out empty: the clock
      // ran 90 -> 0 on the intro screen and not one case was ever presented.
      if (!first && !el('gv-card')) return;
      if (i >= pool.length) { shuffle(pool); i = 0; }
      var q = pool[i]; answered = false; caseNo++;
      var opts = shuffle([q.p].concat(q.d));
      render('<div class="st-gv-head"><span class="st-gv-score"><b id="gv-score">' + score.toLocaleString() + '</b>' + pipsHtml() + '</span>' + ringHtml() + '</div>' +
        '<div class="st-card st-gv-card st-gv-card-in" id="gv-card">' +
        '<div class="st-gv-docket"><span class="st-gv-kicker">Case ' + (caseNo < 10 ? '0' : '') + caseNo + '</span><span class="st-gv-stampline">What governs?</span></div>' +
        '<div class="st-gv-q">' + esc(q.s) + '</div>' +
        '<div class="st-gv-opts">' + opts.map(function (o, k) {
          return '<button class="st-gv-opt" data-p="' + esc(o) + '"><b>' + esc(o) + '</b><span>' + esc(PN[o] || '') + '</span></button>';
        }).join('') + '</div></div>' +
        '<button class="st-link st-quit" id="st-quit">End round</button>');
      el('st-quit').onclick = finish;
      // re-drive the clock instruments the render just rebuilt
      var arc = el('gv-arc'), secs = el('gv-secs');
      if (arc) { var frac = remaining() / GV_SECONDS; arc.style.strokeDashoffset = (GV_RING_C * (1 - frac)).toFixed(1); }
      if (secs) secs.textContent = Math.ceil(remaining());
      qShownAt = Date.now();
      Array.prototype.forEach.call(app.querySelectorAll('.st-gv-opt'), function (b) {
        b.onclick = function () { call(b, q); };
      });
      keyHandler(null);
    }
    function floatPoints(btn, pts) {
      var f = document.createElement('span');
      f.className = 'st-gv-float';
      f.textContent = '+' + pts;
      var r = btn.getBoundingClientRect();
      f.style.left = (r.left + r.width / 2) + 'px';
      f.style.top = r.top + 'px';
      document.body.appendChild(f);
      setTimeout(function () { f.remove(); }, 900);
    }
    function call(btn, q) {
      if (answered || ended) return; answered = true;
      var right = btn.getAttribute('data-p') === q.p;
      var fast = (Date.now() - qShownAt) < 4000;
      Array.prototype.forEach.call(app.querySelectorAll('.st-gv-opt'), function (b) {
        b.disabled = true;
        if (b.getAttribute('data-p') === q.p) { b.classList.add('st-gv-opt-right'); b.insertAdjacentHTML('beforeend', '<span class="st-gv-mark" aria-hidden="true">✓</span>'); }
      });
      if (right) {
        combo++; bestCombo = Math.max(bestCombo, combo);
        var pts = 100 * mult() + (fast ? 50 : 0);
        score += pts;
        var sc = el('gv-score'); if (sc) sc.textContent = score.toLocaleString();
        var pips = el('gv-pips'); if (pips) pips.outerHTML = pipsHtml();
        if (!document.hidden) floatPoints(btn, pts);
        var card = el('gv-card'); if (card) card.classList.add('st-gv-card-hit');
        i++;
        pend = setTimeout(next, 340);
      } else {
        btn.classList.add('st-gv-opt-wrong');
        btn.insertAdjacentHTML('beforeend', '<span class="st-gv-mark st-gv-mark-x" aria-hidden="true">✗</span>');
        combo = 0;
        var pips2 = el('gv-pips'); if (pips2) pips2.outerHTML = pipsHtml();
        misses.push(q);
        i++;
        pend = setTimeout(next, 1350);
      }
    }
    function finish() {
      if (ended) return;   // End round can be reached twice (buzzer + button); score once
      ended = true;
      clearTimeout(pend); clearInterval(tick); keyHandler(null);
      var G = gamesState().governs;
      var bk = 'best_advanced', ck = 'bestCombo_advanced'; // flat again — level split removed
      if (!G[bk] && G.best) { G[bk] = G.best; G[ck] = G.bestCombo; }
      var gd = gamesState();
      if (!gd.gov_day || gd.gov_day.day !== comboToday()) gd.gov_day = { day: comboToday(), plays: 0, best: 0 };
      gd.gov_day.plays++; if (score > gd.gov_day.best) gd.gov_day.best = score;
      if (score > 0) gamesMarkToday();
      var isBest = score > (G[bk] || 0);
      if (isBest) G[bk] = score;
      if (bestCombo > (G[ck] || 0)) G[ck] = bestCombo;
      bumpStreak();
      // Persist the finished round. This is what lets the miss-list citations be same-tab
      // like everywhere else: follow one, and coming back to /study restores this screen
      // instead of dropping you at the intro with the misses gone. The state mutations
      // above run ONCE, here; the restore path only re-renders from this saved result.
      S.resume = { mode: 'governs', at: Date.now(), res: {
        score: score, bestCombo: bestCombo, isBest: isBest, bestScore: G[bk] || 0,
        misses: misses.slice(0, 8).map(function (q) { return { s: q.s, p: q.p, u: q.link.u }; })
      } };
      save();
      renderGovernsEnd(S.resume.res);
    }
    intro();
  }
  // Pure render of a finished round — driven from a saved result, so it serves both the
  // live finish and the restore-after-citation path with no state change.
  function renderGovernsEnd(res) {
    var missHtml = res.misses.length
      ? '<div class="st-gv-misslist"><div class="st-walk-head">The ones that got away</div>' +
        res.misses.map(function (m) {
          return '<div class="st-gv-miss"><span>' + esc(m.s) + '</span>' +
            '<a class="st-cite" href="' + esc(m.u) + '" target="_blank" rel="noopener">' + esc(m.p) + ' — ' + esc(deck.games.part_names[m.p] || '') + '</a></div>';
        }).join('') + '</div>'
      : '<p class="st-sub" style="text-align:center">Nothing got away. Clean round.</p>';
    var SEAL = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="gv-seal-g" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#f2d89a"/><stop offset="48%" stop-color="#cda857"/><stop offset="100%" stop-color="#876514"/></radialGradient></defs><circle cx="50" cy="50" r="47" fill="url(#gv-seal-g)" stroke="#6f521a" stroke-width="1.5"/><circle cx="50" cy="50" r="41" fill="none" stroke="#6f521a" stroke-width="1" stroke-dasharray="1.2 2.6" opacity=".55"/><circle cx="50" cy="50" r="21" fill="none" stroke="#16263f" stroke-width="2.4" opacity=".9"/><g stroke="#16263f" stroke-width="3" stroke-linecap="round" opacity=".9"><line x1="50" y1="34" x2="50" y2="42"/><line x1="50" y1="66" x2="50" y2="58"/><line x1="34" y1="50" x2="42" y2="50"/><line x1="66" y1="50" x2="58" y2="50"/></g><circle cx="50" cy="50" r="5" fill="#16263f" opacity=".9"/></svg>';
    render('<div class="st-card st-summary st-gv-end">' +
      '<div class="st-chip">Which Part Governs?</div>' +
      '<div class="st-gv-seal' + (document.hidden ? '' : ' st-gv-seal-stamp') + '">' + SEAL + '</div>' +
      '<div class="st-sum-num" id="gv-final">0</div>' +
      '<div class="st-gv-tier">' + gvTier(res.score) + (res.isBest && res.score > 0 ? ' · new personal best' : (res.bestScore ? ' · best ' + res.bestScore.toLocaleString() : '')) + '</div>' +
      '<p class="st-sub">Top combo ×' + (1 + Math.min(4, Math.floor(res.bestCombo / 2))) + (res.bestCombo >= 2 ? '' : ' — chain answers to multiply') + '. Fast calls (under 4s) earn the bonus.</p>' +
      missHtml +
      '<div class="st-actions" style="justify-content:center"><button class="st-btn st-btn-reveal" id="gv-again">Run it again</button>' +
      '<button class="st-btn st-btn-hint" id="st-home">Study menu</button></div></div>');
    el('gv-again').onclick = function () { clearResume(); viewGoverns(); };
    el('st-home').onclick = function () { clearResume(); backToTools(); };
    // score counts up — the end-screen moment (rAF is paused in hidden tabs: set the
    // value directly there so a backgrounded tab never shows 0)
    var fin = el('gv-final'), t0 = Date.now(), dur = Math.min(900, 200 + res.score / 8);
    if (document.hidden || !window.requestAnimationFrame) { if (fin) fin.textContent = res.score.toLocaleString(); }
    else (function up() {
      var f = Math.min(1, (Date.now() - t0) / dur);
      if (fin) fin.textContent = Math.round(res.score * (1 - Math.pow(1 - f, 3))).toLocaleString();
      if (f < 1) requestAnimationFrame(up); else if (fin) fin.textContent = res.score.toLocaleString();
    })();
  }
  function resumeGoverns() {
    var r = S.resume;
    if (!r || !r.res) { clearResume(); return false; }
    depth1View = viewGoverns;
    goDepth(1, function () { renderGovernsEnd(r.res); });
    return true;
  }
  function resumeBoard() {
    var r = S.resume;
    var sc = (r && r.ids && r.ids.length) ? deck.scenarios.filter(function (s) { return s.id === r.ids[0]; })[0] : null;
    if (!sc) { clearResume(); return false; }
    depth1View = homeFn();
    goDepth(2, function () { viewBoard(r.ids[0], r.i, r.fu, r.hs); });
    return true;
  }

  /* ---- board sim (out loud, with hints + a methodical model answer) ---- */
  function boardHints(sc) { // a ladder built on the coaching spine: each hint gives away a little more
    var h = [];
    var co = sc.coach || {};
    var opener = sc.style === 'opener';
    if (co.qtype) h.push('Name the question type first. This is ' + co.qtype);
    if (co.smes) h.push(opener ? 'On help: ' + co.smes : 'Name your help before your answer. Your phone-a-friends here: ' + co.smes);
    if (co.rule) h.push(opener ? co.rule : 'State the default rule before any exception: ' + co.rule);
    if (sc.facts) {
      var baitFacts = sc.facts.filter(function (f) { return f.verdict === 'bait'; });
      h.push('There are ' + sc.facts.length + ' load-bearing facts here — ' + baitFacts.length + ' of them ' + (baitFacts.length === 1 ? 'is' : 'are') + ' bait. Ask of each fact: why is it in the scenario?');
      if (baitFacts.length) h.push('One of the baits: “' + baitFacts[0].fact + '” — don\'t let it pick your framework for you.');
      var gov = sc.facts.filter(function (f) { return f.verdict !== 'bait'; });
      if (gov.length) h.push('The fact that actually governs: “' + gov[0].fact + '”. Build your answer on that one.');
    } else {
      if (sc.baits && sc.baits.length) h.push('Watch for the bait: ' + sc.baits[0]);
      if (sc.baits && sc.baits.length > 1) h.push('There\'s a second bait too: ' + sc.baits[1]);
      if (sc.key_moves && sc.key_moves.length) h.push('Opening move: ' + sc.key_moves[0]);
    }
    /* Scenarios with neither facts nor baits got a three-rung ladder where everyone else
       gets six. Their frameworks carry the same material — several are titled "… — bait" —
       so the back half of the ladder is built from those instead of being absent. */
    if (h.length < 4 && sc.frameworks && sc.frameworks.length) {
      sc.frameworks.forEach(function (f) {
        if (h.length >= 6 || typeof f === 'string') return;
        h.push('Framework in play: ' + f.framework + (f.why ? ' — ' + String(f.why).split(/(?<=[.!?])\s+/)[0] : ''));
      });
    }
    return h;
  }
  // The model answer, assembled methodically: name it → frameworks → help → default rule →
  // walk the facts → land the decision → close the loop. "That's the way you learn."
  /* One source for two surfaces. The steps ARE the standard a candidate should grade
     themselves against, so they render twice: as the model answer here, and as a
     tickable checklist beside the self-grade. The recall path already carries the
     reasoning — a self-grade made seconds after the answer appears, at peak fluency, is
     essentially uncorrelated with later performance, and an explicit standard to grade
     against measurably improves calibration. The Board Sim needed it more than the cards
     did: its grade is made after reading a perfect seven-step answer AND a verbatim
     script, which is the worst possible condition for judging your own performance. */
  function boardStepList(sc) {
    var co = sc.coach || {};
    var opener = sc.style === 'opener';
    var steps = [];
    steps.push({ k: 'Named the question', b: 'Name the question.',
      body: 'Out loud, first sentence: this is ' + esc(co.qtype || 'a frameworks question — name it, then walk it.') });
    if (sc.frameworks && sc.frameworks.length) {
      steps.push({ k: 'Named the framework in play', b: 'Name the framework(s) in play.',
        body: sc.frameworks.map(function (f) {
          return esc(typeof f === 'string' ? f : (f.framework + (f.why ? ' — ' + f.why : '')));
        }).join('<br>') });
    }
    if (opener) {
      steps.push({ k: 'Anchored it in your own experience', b: 'Own it.',
        body: esc(co.smes || 'This one is yours — anchor on your own experience and what you actually control.') });
      steps.push({ k: 'Gave it a spine — definition, plan, example', b: 'Give it a spine.',
        body: esc(co.rule || 'A definition, a concrete plan, and one example — in that order.') });
    } else {
      steps.push({ k: 'Named who you would call', b: 'Name your help.',
        body: 'Boards reward knowing who to call: ' + esc(co.smes || 'your CO/chief, Legal (JA), and FM.') });
      /* co.applies is the per-scenario half of the coach. co.rule is authored per
         canonical topic and shared by every scenario on it, so on some cards it is a
         true statement of the subject that is not the rule the card turns on. When
         the deck carries an applies line, it says how the subject bites here — and
         it renders after the default rule, because at a board you still state the
         default first. */
      steps.push({ k: 'Stated the default rule before any exception', b: 'State the default rule before any exception.',
        body: esc(co.rule || 'Default first, exception second, facts third.') +
          (co.applies ? '<span class="bs-applies"><b>On these facts.</b> ' + esc(co.applies) + '</span>' : '') });
    }
    if (sc.facts) {
      var baits = sc.facts.filter(function (f) { return f.verdict === 'bait'; }).map(function (f) { return f.fact; });
      var govs = sc.facts.filter(function (f) { return f.verdict !== 'bait'; }).map(function (f) { return f.fact; });
      var walk = 'Take each planted fact and say whether it governs or baits (debrief above).';
      if (baits.length) walk += ' Call the bait by name: ' + baits.map(esc).join(' · ') + '.';
      if (govs.length) walk += ' Then anchor on what governs: “' + esc(govs[0]) + '”.';
      steps.push({ k: 'Called the bait, and anchored on what governs', b: 'Walk the facts — bait vs. governs.', body: walk });
    } else if (sc.baits && sc.baits.length) {
      steps.push({ k: 'Called the bait by name', b: 'Walk the facts — call the bait.',
        body: 'Say why each of these is in the scenario, and why it doesn\'t control: ' + sc.baits.map(esc).join(' · ') });
    }
    if (sc.key_moves && sc.key_moves.length) {
      steps.push({ k: 'Landed a decision, with your moves in order', b: 'Land the decision — your moves, in order.',
        body: '<ul>' + sc.key_moves.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' });
    } else if (sc.board_answer) {
      steps.push({ k: 'Landed a decision', b: 'Land the decision.', body: esc(sc.board_answer) });
    } else {
      /* Guard, not a feature. scripts/deck_health.py fails the build if a scenario has
         neither key_moves nor board_answer, so this should never fire — but a model answer
         that never lands a decision is the one failure a board punishes hardest, and it
         shipped on eight scenarios. Fall back to the closing sentences of the script, where
         the decision is already authored. */
      var tail = String(sc.script || '').split(/(?<=[.!?])\s+/).slice(-3).join(' ');
      if (tail) steps.push({ k: 'Landed a decision', b: 'Land the decision.', body: esc(tail) });
    }
    steps.push({ k: opener ? 'Closed with one concrete thing you would change' : 'Said where you would verify before acting',
      b: 'Close the loop.', body: opener
        ? 'End in your own voice — one concrete thing you would change on Monday. Perspective questions are scored on judgment and specifics, not recitation.'
        : 'Say where you\'d verify before acting — the live RFO/R-DFARS text, your Legal office — and what goes in the file. Never quote a threshold from memory.' });
    return steps;
  }
  function boardWalkthrough(sc) {
    var co = sc.coach || {};
    /* "How you should have answered" was past tense and scolding, and it lands before the
       follow-ups rather than after everything. It is a model, so it says so. */
    return '<div class="st-walk"><div class="st-walk-head">What a strong answer covers</div><ol>' +
      boardStepList(sc).map(function (x) { return '<li><b>' + x.b + '</b> ' + x.body + '</li>'; }).join('') + '</ol>' +
      (co.cite ? '<div class="st-explain-ref">Where it lives: <b>' + esc(co.cite) + '</b></div>' : '') +
      citesHtml(co.links) + '</div>';
  }
  function boardChecklist(sc) {
    var steps = boardStepList(sc);
    return '<div class="st-check" id="st-check"><div class="st-check-h">Tick what you actually said — ' +
      'grade against this, not against how obvious it looks now</div><ul class="st-check-list">' +
      steps.map(function (x) {
        var core = /^Landed a decision/.test(x.k);
        return '<li><button type="button" class="st-check-item' + (core ? ' st-check-core' : '') +
          '" aria-pressed="false"><span class="st-check-box" aria-hidden="true"></span><span>' +
          esc(x.k) + (core ? ' <i class="st-check-tag">the answer</i>' : '') + '</span></button></li>';
      }).join('') + '</ul></div>';
  }
  function topicLabel(topics) {
    return (topics || []).map(function (t) {
      t = String(t).replace(/\s*\.\s*$/, '').trim();
      return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
    }).filter(Boolean).join(' \u00b7 ');
  }
  function boardSteps(stage, nFus, tail) {
    var labels = ['Scenario', 'Debrief'];
    for (var i = 0; i < nFus; i++) labels.push('Follow-up ' + (i + 1));
    labels.push('Self-grade');
    if (tail) labels.push(tail);   // the ladder's sim ends on a saved record
    return '<ol class="rz-steps" tabindex="0" aria-label="Where you are in this scenario">' +
      labels.map(function (t, i) {
        var st = i < stage ? ' rz-step-done' : i === stage ? ' rz-step-now' : '';
        return '<li class="rz-step' + st + '"' + (i === stage ? ' aria-current="step"' : '') + '>' +
          '<span class="rz-step-m" aria-hidden="true">' + (i < stage ? '\u2713' : (i + 1)) + '</span>' +
          '<span class="rz-step-t">' + t + '</span></li>';
      }).join('') + '</ol>';
  }
  /* Which scenarios the Board Sim draws from. 'rough' is every scenario the candidate
     self-graded 1; 'unseen' is every one never faced. Counts drive the chip labels and
     disable a chip that would draw from nothing. */
  function boardPool(filter) {
    return deck.scenarios.filter(function (s) {
      if (filter === 'rough') return S.scen[s.id] === 1;
      if (filter === 'unseen') return !S.scen[s.id];
      return true;
    });
  }
  var BOARD_PICKS = [['any', 'Any'], ['rough', 'Rough'], ['unseen', 'Unseen']];
  function boardPickHtml() {
    return '<div class="st-pick" role="radiogroup" aria-label="Which scenarios to draw from">' +
      BOARD_PICKS.map(function (p) {
        var n = boardPool(p[0]).length, on = S.boardPick === p[0];
        return '<button type="button" class="st-pick-b' + (on ? ' st-pick-on' : '') +
          '" role="radio" aria-checked="' + (on ? 'true' : 'false') +
          '" tabindex="' + (on ? '0' : '-1') + '" data-f="' + p[0] + '"' +
          (n ? '' : ' disabled') + '>' + p[1] + ' <i>' + n + '</i></button>';
      }).join('') + '</div>';
  }
  function wireBoardPick() {
    var host = document.querySelector('.st-pick');
    if (!host) return;
    var bs = Array.prototype.slice.call(host.querySelectorAll('.st-pick-b'));
    /* Choosing re-renders the whole sim, which destroys the button that had focus.
       Round 3 treated exactly that as a regression elsewhere in this layer, so the
       chip is re-focused after the render when the choice came from the keyboard. */
    function choose(b, viaKey) {
      if (!b || b.disabled) return;
      S.boardPick = b.getAttribute('data-f'); save();
      clearResume(); keyHandler(null); viewBoard();
      if (viaKey) {
        var again = document.querySelector('.st-pick-b[data-f="' + S.boardPick + '"]');
        if (again) again.focus();
      }
    }
    bs.forEach(function (b, k) {
      b.onclick = function () { choose(b, false); };
      b.onkeydown = function (e) {
        var d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        // step over disabled chips rather than landing focus on a dead control
        for (var i = 1; i <= bs.length; i++) {
          var nb = bs[((k + d * i) % bs.length + bs.length) % bs.length];
          if (!nb.disabled) { choose(nb, true); return; }
        }
      };
    });
  }
  function viewBoard(pickId, startStage, startFu, startHints) {
    var pool = deck.scenarios.slice();
    var sc = pickId ? pool.filter(function (s) { return s.id === pickId; })[0] : null;
    if (!sc) {
      /* Draw order: the chosen filter first, then unseen, then anything. 'rough' is the
         one worth replaying — a self-grade of 1 is the candidate's own note that the
         answer did not come out — and the data for it was already being written by
         logScenario; there was just no way to ask for it back. Each fallback is
         deliberate: an empty filtered pool must still hand you a scenario, never a
         dead screen. */
      var want = boardPool(S.boardPick);
      var fresh = want.length ? want : pool.filter(function (s) { return !S.scen[s.id]; });
      sc = (fresh.length ? shuffle(fresh) : shuffle(pool))[0];
    }
    var stage = startStage || 0; // 0 scenario, 1 debrief, 2+ follow-ups
    var fuRevealed = !!startFu; // within a follow-up: question shown → debrief shown
    var fus = sc.follow_ups || [];
    var hints = boardHints(sc), hintsShown = startHints || 0;
    var askHtml = sc.ask ? '<div class="st-panel-ask"><span class="st-ask-kicker">The panel asks</span>' + esc(sc.ask) + '</div>' : '';
    function step() {
      // Persist the place, like every other mode. Board Sim's debrief citations are same-tab;
      // without this, following one to read a rule dumped you back at the track picker with
      // the sim gone — the exact regression the resume system exists to prevent.
      saveResume('board', S.track, [sc], stage, 0, 'Board Sim', { fu: fuRevealed, hs: hintsShown });
      var body = '';
      if (stage === 0) {
        body = '<div class="st-scenario">' + esc(sc.scenario) + '</div>' +
          askHtml +
          '<p class="st-outloud">Answer <b>out loud</b> — ' + (sc.style === 'opener'
            ? 'in your own voice: a definition, a plan, one example. Stuck? Take a hint.'
            : 'name the framework, name your help, walk it. Stuck? Take a hint.') + '</p>' +
          '<div id="st-hints"></div>' +
          '<div class="st-actions"><button class="st-btn st-btn-hint" id="st-hint">Hint <span class="st-hint-n">' + (hints.length - hintsShown) + '</span></button>' +
          '<button class="st-btn st-btn-reveal" id="next">Reveal the debrief <kbd>space</kbd></button></div>';
      } else if (stage === 1) {
        // Debrief = the guide's bait/governs teaching (facts scenarios) + the methodical model
        // answer. Frameworks/baits/key-moves content now lives INSIDE the walkthrough steps.
        var d = '';
        if (sc.facts) {
          d = sc.facts.map(function (f) {
            var v = f.verdict === 'bait' ? '<span class="st-bait">bait</span>' : '<span class="st-gov">governs</span>';
            return '<div class="st-fact"><b>' + esc(f.fact) + '</b> ' + v + '<div>' + esc(f.why) + '</div></div>';
          }).join('');
        }
        body += d +
          boardWalkthrough(sc) +
          (sc.script ? '<details class="st-script"><summary class="st-script-head">One way to say it out loud</summary><p>' + esc(sc.script) + '</p></details>' : '') +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">' + (fus.length ? 'The panel follows up… <kbd>space</kbd>' : 'Grade yourself') + '</button></div>';
      } else if (stage - 2 < fus.length) {
        var k = stage - 2;
        var fu = fus[k] || {};
        var fq = fu.q || fu; // deck v4 uses {q,h,d}; tolerate legacy plain strings
        body += '<div class="st-followup"><span>Panel follow-up ' + (k + 1) + ' of ' + fus.length + '</span><div class="st-q">' + esc(fq) + '</div></div>';
        if (fu.d && fuRevealed) {
          body += '<div class="st-fu-debrief"><div class="st-fu-debrief-head">Debrief</div><p>' + esc(fu.d) + '</p>' +
            (function () {
              var cite = fu.cite || (sc.coach && sc.coach.cite);
              var links = fu.links || (sc.coach && sc.coach.links);
              return (cite ? '<div class="st-explain-ref">Where it lives: <b>' + esc(cite) + '</b></div>' : '') +
                citesHtml(links);
            })() + '</div>' +
            '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">' + (k + 1 < fus.length ? 'Next follow-up <kbd>space</kbd>' : 'Grade yourself') + '</button></div>';
        } else {
          body += '<p class="st-outloud">Answer <b>out loud</b>' + (fu.d ? ', then reveal the debrief.' : ', then continue.') + '</p>' +
            '<div id="fu-hint-box"></div>' +
            '<div class="st-actions">' +
            (fu.h ? '<button class="st-btn st-btn-hint" id="fu-hint">Hint</button>' : '') +
            (fu.d ? '<button class="st-btn st-btn-reveal" id="fu-reveal">Reveal the debrief <kbd>space</kbd></button>'
                  : '<button class="st-btn st-btn-reveal" id="next">' + (k + 1 < fus.length ? 'Next follow-up <kbd>space</kbd>' : 'Grade yourself') + '</button>') +
            '</div>';
        }
      } else {
        /* It asked "how did the whole exchange go?" — one judgment covering a scenario, a
           debrief and two follow-ups, made straight after reading a perfect answer. It now
           grades one thing against the standard the debrief just set, and it says how many
           hints were taken, because taking three and calling it board-ready was free. */
        body += '<div class="st-q">Against that standard, how was <i>your</i> answer?</div>' +
          '<p class="st-outloud">Not how obvious it looks now \u2014 what you actually said before you revealed it.</p>' +
          boardChecklist(sc) +
          (hintsShown ? '<p class="rz-sim-hintnote">You took <b>' + hintsShown + '</b> hint' +
            (hintsShown !== 1 ? 's' : '') + ' on this one. A board gives none.</p>' : '') +
          '<div class="st-actions">' +
          '<button class="st-btn st-g1" id="g1">Rough <kbd>1</kbd></button>' +
          '<button class="st-btn st-g2" id="g2">Getting there <kbd>2</kbd></button>' +
          '<button class="st-btn st-g3" id="g3">Board-ready <kbd>3</kbd></button></div>';
      }
      /* The sim is an activity you are inside, laid out the way the course is: pinned
         chrome, a stepper, the work in the middle, and the scenario kept in view on the
         right from the debrief onwards — it used to vanish the moment you left stage 0,
         so you answered follow-ups about a scenario you could no longer read. */
      var faced = Object.keys(S.scen).length, tot = deck.scenarios.length;
      var ready = deck.scenarios.filter(function (x) { return S.scen[x.id] === 3; }).length;
      var railBody = stage > 0
        ? '<div class="rz-rail-h">The scenario</div>' +
          '<p class="rz-sim-scen">' + esc(sc.scenario) + '</p>' +
          (sc.ask ? '<div class="rz-rail-h">The panel asks</div><p class="rz-sim-ask">' + esc(sc.ask) + '</p>' : '')
        : '<div class="rz-rail-h">What you are in for</div>' +
          '<p class="rz-sim-meta">' + (fus.length ? 'The debrief, then <b>' + fus.length + '</b> panel follow-up' +
            (fus.length !== 1 ? 's' : '') + ', then you grade yourself.' : 'A debrief, then you grade yourself.') + '</p>' +
          '<p class="rz-sim-meta">Answer out loud before you reveal anything. Nobody sees the grade \u2014 it only decides what comes back.</p>';
      render(
        chromeHtml({ course: 'Board Sim', back: true, backLabel: 'Exit',
          backAria: 'Leave the board simulator',
          now: topicLabel(sc.topics),
          prog: { done: faced, total: tot, pct: tot ? Math.round(100 * faced / tot) : 0 } }) +
        '<div class="rz-sim">' +
        '<div class="rz-sim-main">' + boardSteps(stage, fus.length) +
        '<div class="st-card" aria-live="polite">' + body + '</div>' +
        '<div class="rz-sim-exits">' + boardPickHtml() +
        '<button class="st-link" id="st-skip">Skip to a different scenario</button></div></div>' +
        '<aside class="rz-sim-rail" aria-label="Scenario reference">' + railBody +
        '<div class="rz-sim-tally">' + faced + ' of ' + tot + ' faced \u00b7 <b>' + ready + '</b> board-ready</div>' +
        '</aside></div>');
      el('rz-bar-back').onclick = function () { clearResume(); backHome(); };
      // there was no way past a scenario you did not want short of walking it or leaving
      el('st-skip').onclick = function () { clearResume(); keyHandler(null); viewBoard(); };
      wireBoardPick();
      if (stage === 0 && el('st-hint')) {
        // re-show any hints already taken (render() wipes them)
        for (var hi = 0; hi < hintsShown; hi++) addHint(hints[hi]);
        refreshHintBtn();
        el('st-hint').onclick = function () {
          if (el('st-hint').disabled || hintsShown >= hints.length) return;
          addHint(hints[hintsShown]); hintsShown++;
          cooldownHintBtn(); // hammering slows down — sit with the hint before the next one
        };
      }
      function addHint(text) {
        var div = document.createElement('div'); div.className = 'st-hint';
        div.innerHTML = '<b>Hint:</b> ' + esc(text);
        el('st-hints').appendChild(div);
      }
      function refreshHintBtn() {
        var b = el('st-hint'); if (!b) return;
        var left = hints.length - hintsShown;
        if (left <= 0) { b.disabled = true; b.innerHTML = 'No more hints'; }
        else { b.disabled = false; b.innerHTML = 'Hint <span class="st-hint-n">' + left + '</span>'; }
      }
      function cooldownHintBtn() {
        var b = el('st-hint'); if (!b) return;
        if (hintsShown >= hints.length) { refreshHintBtn(); return; }
        var wait = Math.ceil(HINT_COOLDOWN_MS / 1000);
        b.disabled = true;
        var tick = setInterval(function () {
          wait--;
          var btn = el('st-hint');
          if (!btn || stage !== 0) { clearInterval(tick); return; } // view moved on
          if (wait <= 0) { clearInterval(tick); refreshHintBtn(); }
          else btn.innerHTML = 'Next hint in ' + wait + '…';
        }, 1000);
        b.innerHTML = 'Next hint in ' + wait + '…';
      }
      if (el('fu-hint')) {
        el('fu-hint').onclick = function () {
          var f = fus[stage - 2] || {};
          var box = el('fu-hint-box');
          if (box && f.h) {
            var div = document.createElement('div'); div.className = 'st-hint';
            div.innerHTML = '<b>Hint:</b> ' + esc(f.h);
            box.appendChild(div);
          }
          el('fu-hint').disabled = true;
        };
      }
      if (el('fu-reveal')) {
        el('fu-reveal').onclick = function () { fuRevealed = true; step(); };
        keyHandler(function (k) { if (k === ' ' || k === 'Enter') { fuRevealed = true; step(); return true; } });
      } else if (el('next')) {
        el('next').onclick = function () { stage++; fuRevealed = false; step(); };
        keyHandler(function (k) { if (k === ' ' || k === 'Enter') { stage++; fuRevealed = false; step(); return true; } });
      } else {
        wireChecklist();
        ['g1', 'g2', 'g3'].forEach(function (id, gi) {
          el(id).onclick = function () { logScenario(gi + 1); };
        });
        keyHandler(function (k) { if (k === '1' || k === '2' || k === '3') { logScenario(+k); return true; } });
      }
    }
    /* Logging a grade used to drop you straight into a new scenario mid-thought. Name what
       was recorded, show where it puts you across the 96, and let leaving be a choice. */
    function logScenario(g) {
      /* A hint you needed is a hint the panel would have heard you need — the ladder board
         has capped a hinted grade all along, while this one offered six hints and merely
         printed a note. Three or more walks you through the whole coaching spine. */
      var capped = hintsShown >= 3 && g > 2;
      if (capped) g = 2;
      S.scen[sc.id] = g; bumpStreak(); save(); keyHandler(null); clearResume();
      var faced = Object.keys(S.scen).length, tot = deck.scenarios.length;
      var ready = deck.scenarios.filter(function (x) { return S.scen[x.id] === 3; }).length;
      var word = g === 3 ? 'Board-ready' : g === 2 ? 'Getting there' : 'Rough';
      render(
        chromeHtml({ course: 'Board Sim', back: true, backLabel: 'Exit',
          backAria: 'Leave the board simulator',
          prog: { done: faced, total: tot, pct: tot ? Math.round(100 * faced / tot) : 0 } }) +
        '<div class="rz-sim"><div class="rz-sim-main">' +
        '<div class="st-card"><div class="rz-done">' +
        '<div class="rz-done-tick" aria-hidden="true">\u2713</div>' +
        '<h3>Logged \u2014 ' + word + '</h3>' +
        (capped ? '<p class="rz-sim-hintnote">Held at <b>Getting there</b>: you took ' + hintsShown +
          ' hints. A board gives none.</p>' : '') +
        '<p class="rz-done-score">' + (g === 3
          ? 'Board-ready scenarios stop coming back first. The ones you marked rough are the pile worth returning to.'
          : 'Marked for another pass. A scenario you graded honestly is worth more than one you graded kindly.') + '</p>' +
        '<div class="rz-prog rz-prog-lg" aria-hidden="true"><span style="width:' +
          (tot ? Math.round(100 * faced / tot) : 0) + '%"></span></div>' +
        '<p class="rz-done-prog">' + faced + ' of ' + tot + ' scenarios faced \u00b7 ' + ready + ' board-ready</p>' +
        '<div class="rz-done-actions">' +
        '<button class="rz-btn rz-btn-go" id="bd-next">Next scenario \u2192</button>' +
        '<button class="rz-btn rz-btn-ghost" id="bd-stop">That\u2019s enough for now</button>' +
        '</div></div></div></div></div>');
      el('rz-bar-back').onclick = backHome;
      el('bd-next').onclick = function () { viewBoard(); };
      el('bd-stop').onclick = backHome;
      keyHandler(function (k) { if (k === ' ' || k === 'Enter') { viewBoard(); return true; } });
    }
    step();
  }

  /* ---- keyboard, export/import ---- */
  var keyFn = null;
  function keyHandler(fn) { keyFn = fn; }
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    // Also bail on focused interactive elements: Space/Enter on a focused <button> must
    // activate that button, not run a study shortcut. preventDefault() here swallowed the
    // click a keyboard user was trying to make.
    if (e.target.closest && e.target.closest('button,a,select,[role="button"],[contenteditable="true"]')) return;
    if (keyFn && keyFn(e.key)) e.preventDefault();
  });

  function doExport() {
    var blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'acqvault-study-progress.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function doImport(e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      // Normalise before adopting. A file carrying `cards` but no scen/sprint/games used to be
      // saved raw, and every later read of the missing branch threw — permanently bricking the
      // dashboard with no route back short of clearing storage.
      try {
        var s = JSON.parse(r.result);
        if (s && s.cards && typeof s.cards === 'object') {
          S = normalize(s);
          save(); homeFn()();
        } else alert('Not a study-progress file.');
      }
      catch (err) { alert('Could not read that file.'); }
    };
    r.readAsText(f);
  }

  /* ---- boot: always land on the track selector (progress remembered underneath) ---- */
  document.addEventListener('DOMContentLoaded', function () {
    app = el('study-app');
    if (!app) return;
    MODE = app.getAttribute('data-mode') || 'study';
    // render() replaces the whole view, destroying the focused control — so after each swap
    // focus fell to <body> and a screen reader announced nothing. Make the view container a
    // programmatic focus target (never in the tab order) so render() can move focus into the
    // new card; outline suppressed because it's a -1 target, not a keyboard-tabbable control.
    app.setAttribute('tabindex', '-1');
    app.style.outline = 'none';
    fetch(ELEMENTS_URL).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { ELEMENTS = j; }).catch(function () { ELEMENTS = null; });
    fetch(DECK_URL).then(function (r) { return r.json(); }).then(function (d) {
      deck = d;
      canonTopics();
      history.replaceState({ st: 0 }, '');
      navDepth = 0;
      var qs = new URLSearchParams(location.search);
      // The old ?ladder=1 beta unlock is gone with the ladder — it now lives at /48cons and
      // needs no unlock. Strip the param if an old link still carries it so nobody is left
      // staring at a /study URL that looks like it should have done something.
      if (qs.get('ladder') === '1') {
        qs.delete('ladder');
        try { history.replaceState({ st: 0 }, '', location.pathname + (qs.toString() ? '?' + qs.toString() : '')); } catch (e) {}
      }
      if (isOrg()) {
        // The org page is the ladder's only home now. No track picker, no games hub.
        if (resumeSession()) return;
        view48Cons(); return;
      }
      if (qs.get('play') === 'daily') {
        if (qs.get('fresh') === '1') { // replay today's word (streak & history untouched)
          var gc = gamesState().combo;
          gc.day = 0; gc.rows = []; gc.done = false; gc.win = false; save();
          try { history.replaceState({ st: 0 }, '', '/study?play=daily'); } catch (e) {}
        }
        depth1View = viewCombo; goDepth(1, viewCombo); return;
      }
      if (resumeSession()) return;  // a reload or a citation click shouldn't cost the session
      viewTrack();
    }).catch(function () {
      app.innerHTML = '<p class="st-sub">Couldn’t load the question deck — check your connection and refresh. (Once loaded once, it works offline.)</p>';
    });
  });
})();
