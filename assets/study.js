/* AcqVault Study — client-side drill engine. No accounts, no server state, no AI.
   Progress lives in localStorage ('acq-study-v1'); Export/Import moves it between browsers. */
(function () {
  'use strict';
  var DECK_URL = '/assets/study-deck.json?v=31';
  var LS_KEY = 'acq-study-v1';
  var INTERVALS = [0, 1, 3, 7, 21]; // days until due, by box (box 1..5 → idx 0..4)
  var SESSION_CAP = 25;
  var HINT_COOLDOWN_MS = 4000; // hammering the hint button slows down — think between hints

  var deck = null;
  var S = load();

  function load() {
    try { var s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.cards) return s; } catch (e) {}
    return { track: null, cards: {}, scen: {}, sprint: { best: 0 }, created: Date.now() };
  }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }
  function today() { return Math.floor(Date.now() / 86400000); }
  function esc(x) { return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function el(id) { return document.getElementById(id); }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ---- history: back inside the tool steps back through the tool, not off the page ----
     depth 0 = track select · depth 1 = dashboard · depth 2 = an activity */
  var navDepth = 0, popping = false;
  function goDepth(depth, renderFn) {
    if (!popping) {
      while (navDepth >= depth) navDepth--; // never push same depth twice in a row
      for (var d = navDepth + 1; d <= depth; d++) history.pushState({ st: d }, '');
      navDepth = depth;
    }
    renderFn();
  }
  // Games and track-dashboards both live at history depth 1 now (games moved up from the
  // old hub level so they sit right on the main page). depth1View remembers which one to
  // re-render on a back/forward pop.
  var depth1View = null;
  window.addEventListener('popstate', function (e) {
    var d = (e.state && typeof e.state.st === 'number') ? e.state.st : 0;
    navDepth = d; popping = true; keyHandler(null);
    if (!deck) { popping = false; return; }
    if (d <= 0) viewTrack(); else (depth1View || viewHome)();
    popping = false;
  });

  /* ---- deck accessors ---- */
  function recallPool() {
    if (S.track === 'basic') return deck.recall_basic;
    return deck.recall_basic.concat(deck.recall_advanced, deck.thresholds.map(function (t) {
      // keep d/x/ref so threshold cards stay MCQ with their debriefs outside the Sprint
      return { id: t.id, type: 'recall', topic: 'Thresholds & Numbers', q: t.q, a: t.a, d: t.d, x: t.x, ref: t.ref };
    }));
  }
  function cardState(id) { return S.cards[id] || { box: 0, due: 0, lapses: 0 }; }
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
      el('st-act').innerHTML =
        '<button class="st-btn st-g1" id="g1">Missed <kbd>1</kbd></button>' +
        (o.showShaky ? '<button class="st-btn st-g2" id="g2">Shaky <kbd>2</kbd></button>' : '') +
        '<button class="st-btn st-g3" id="g3">Got it <kbd>3</kbd></button>';
      el('g1').onclick = function () { o.onGrade(1); };
      if (o.showShaky) el('g2').onclick = function () { o.onGrade(2); };
      el('g3').onclick = function () { o.onGrade(3); };
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
        return '<a class="st-cite" href="' + esc(l.u) + '">' + esc(l.t) + '</a>';
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
    // Anchor each new view just below the top of the drill container so every card
    // lands in the same readable spot. NB: app.offsetTop is relative to the
    // position:relative .st-wrap (~its padding), NOT the page — using it scrolled
    // to y≈0 (the hero) on every question advance. Use the document-absolute top.
    // Skip the very first paint so a cold page load stays on the hero instead of
    // auto-scrolling past it.
    if (!rendered) { rendered = true; return; }
    var y = Math.max(0, app.getBoundingClientRect().top + window.scrollY - 20);
    if (Math.abs(y - window.scrollY) > 2) window.scrollTo({ top: y, behavior: 'instant' });
  }

  var VAULT_GLYPH = '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#cdb277" stroke-width="2"><circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="10"/></g><g stroke="#cdb277" stroke-width="3.4" stroke-linecap="round"><line x1="50" y1="27" x2="50" y2="38"/><line x1="50" y1="73" x2="50" y2="62"/><line x1="27" y1="50" x2="38" y2="50"/><line x1="73" y1="50" x2="62" y2="50"/></g><circle cx="50" cy="50" r="3.6" fill="#cdb277"/></svg>';
  function stepKicker(n, label) {
    return '<div class="st-step"><span class="st-step-n">' + n + '</span>' + label + '</div>';
  }
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
      '<p class="st-intro"><b>Learn</b> the whole domain, then <b>prove</b> you can hold a warrant at your ceiling — with interactive tools to sharpen any time.</p>' +
      stepKicker(1, 'Learn the domain') +
      '<h2 class="st-h2" style="margin-top:2px">Pick your depth</h2>' +
      '<p class="st-sub">Start shallow or go deep — progress saves per card, and you can switch any time without losing it.</p>' +
      '<div class="st-tracks">' +
      cardHtml('t-basic', 'Start here if contracting is new', 'Foundations',
        'Field Guide Vol. 1 — the players, the money, the methods. Build the base before the board.', last === 'basic', 'VOL I') +
      cardHtml('t-adv', 'The full board-prep deck', 'The Board',
        'Everything in Foundations plus Vol. 2 — board-probe questions, threshold sprints, and full scenario simulations with follow-ups.', last === 'advanced', 'VOL I·II') +
      '</div>' +
      ladderSectionHtml() +
      gamesSectionHtml());
    el('t-basic').onclick = function () { S.track = 'basic'; depth1View = viewHome; save(); goDepth(1, viewHome); };
    el('t-adv').onclick = function () { S.track = 'advanced'; depth1View = viewHome; save(); goDepth(1, viewHome); };
    wireLadderSection();
    wireGamesSection();
  }

  function viewHome() {
    if (!S.track) return viewTrack();
    var pool = recallPool();
    var due = pool.filter(function (c) { return isDue(c.id); });
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
    var scen = deck.scenarios;
    var scenDone = scen.filter(function (s) { return S.scen[s.id]; }).length;
    // The self-grade (1 rough / 2 getting there / 3 board-ready) was collected on every
    // scenario and displayed nowhere — the most board-predictive signal in the tool,
    // feeding nothing. It reads back here on the mode it belongs to.
    var scenReady = scen.filter(function (s) { return S.scen[s.id] === 3; }).length;
    var scenLine = scenDone
      ? scenDone + ' of ' + scen.length + ' faced · ' + scenReady + ' board-ready — answer out loud, then the follow-ups'
      : scenDone + ' of ' + scen.length + ' scenarios faced — answer out loud, then the follow-ups';
    var overall = mastery(pool);
    /* The headline used to be the whole backlog — 337 — while a session hands you 25, and
       finishing those 25 moved it to 333 because a missed card is due again immediately.
       A number that only ever goes down by the cards you already knew reads as punishment.
       So: the big number is the session you're about to run, the backlog is context, and
       finishing one is an end state rather than a slightly smaller pile. */
    var dstate = dailyState();
    var sessionSize = Math.min(due.length, SESSION_CAP);
    var dailyInner;
    if (!due.length) {
      dailyInner = '<div class="st-daily-row"><span class="st-daily-what" style="font-size:19px">All caught up — nothing due today.</span></div>' +
        '<span class="st-daily-sub">The scheduler has nothing urgent. Run a Deep Study shuffle or face a Board Sim scenario to stay sharp.</span>';
    } else if (dstate.sessions) {
      dailyInner = '<div class="st-daily-row"><span class="st-daily-what" style="font-size:19px">Done for today — ' +
        dstate.done + ' card' + (dstate.done !== 1 ? 's' : '') + ' answered.</span></div>' +
        '<span class="st-daily-sub">Cards you missed stay in the pile until they stick, so the count doesn’t drop to zero — that’s the schedule working, not a backlog. Another round of ' +
        sessionSize + ' whenever you want it.</span>';
    } else {
      dailyInner = '<div class="st-daily-row"><span class="st-daily-num">' + sessionSize + '</span><span class="st-daily-what">card' + (sessionSize !== 1 ? 's' : '') + ' in today’s session</span></div>' +
        '<span class="st-daily-sub">Spaced repetition picked these — the ones you’re about to forget, right before you forget them.' +
        (due.length > sessionSize ? ' Drawn from ' + due.length + ' due; a session caps at ' + SESSION_CAP + ' on purpose, because short and often beats long and rare.' : '') +
        '</span>';
    }
    var run = streakRun();
    render(
      '<div class="st-head">' +
      (run >= 2 ? '<div class="st-streak" title="Days in a row with at least one card answered">' +
        '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l1.4 3.1L10.8 5 8.4 7.2l.7 3.3L6 8.8l-3.1 1.7.7-3.3L1.2 5l3.4-.9z"/></svg>' +
        run + '-day streak</div>' : '') +
      '<div class="st-track-chip">' + (S.track === 'basic' ? 'Foundations' : 'The Board') +
      ' <button class="st-link" id="st-switch">switch</button></div></div>' +
      '<button class="st-daily' + (due.length ? '' : ' st-daily-dead') + '" id="m-daily"' + (due.length ? '' : ' disabled') + '><div class="st-daily-eyebrow">Today’s session · Daily Review</div>' + dailyInner + (due.length ? '<span class="st-daily-go" aria-hidden="true">→</span>' : '') + '</button>' +
      '<div class="st-modes">' +
      '<button class="st-mode" id="m-deep"><b><span class="st-mode-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></span>Deep Study</b><span>Endless random cards, every topic in the mix — go as long as you want</span></button>' +
      '<button class="st-mode" id="m-sprint"><b><span class="st-mode-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span>Threshold Sprint</b><span>Rapid-fire numbers · best streak ' + (S.sprint.best || 0) + '</span></button>' +
      (S.track === 'advanced' ?
        '<button class="st-mode" id="m-board"><b><span class="st-mode-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>Board Sim</b><span>' + scenLine + '</span></button>' : '') +
      '</div>' +
      '<div class="st-ready-head"><h2 class="st-h2">Readiness by topic</h2><span class="st-overall">' + overall + '% overall</span></div>' +
      '<p class="st-sub">Tap a topic to study it directly, due or not.</p>' +
      '<div class="st-topics">' + rows + '</div>' +
      '<div class="st-foot-tools"><button class="st-link" id="st-export">Export progress</button> · ' +
      '<button class="st-link" id="st-import">Import</button> · ' +
      '<button class="st-link" id="st-reset">Reset</button><input type="file" id="st-file" accept="application/json" hidden></div>'
    );
    if (due.length) el('m-daily').onclick = function () { goDepth(2, function () { startSession(due, 'Daily Review'); }); };
    el('m-deep').onclick = function () { goDepth(2, viewDeep); };
    el('m-sprint').onclick = function () { goDepth(2, viewSprint); };
    if (el('m-board')) el('m-board').onclick = function () { goDepth(2, viewBoard); };
    el('st-switch').onclick = function () { goDepth(0, viewTrack); };
    el('st-export').onclick = doExport;
    el('st-import').onclick = function () { el('st-file').click(); };
    el('st-file').onchange = doImport;
    el('st-reset').onclick = function () { if (confirm('Erase all study progress on this device?')) { S = { track: S.track, cards: {}, scen: {}, sprint: { best: 0 }, created: Date.now() }; save(); viewHome(); } };
    Array.prototype.forEach.call(app.querySelectorAll('.st-topic'), function (b) {
      b.onclick = function () {
        var t = b.getAttribute('data-topic');
        goDepth(2, function () { startSession(shuffle(byTopic[t].slice()), t); });
      };
    });
  }

  function backHome() { keyHandler(null); if (navDepth >= 2) history.back(); else viewHome(); }
  // Games sit at depth 1 (on the main page), so their "back" returns to the tool select.
  function backToTools() { keyHandler(null); if (navDepth >= 1) history.back(); else viewTrack(); }

  /* ---- recall session (mixed reveal + multiple-choice) ---- */
  function startSession(cards, label, startAt, startGot) {
    if (!cards.length) { viewHome(); return; }
    var q = startAt == null ? interleave(shuffle(cards.slice()).slice(0, SESSION_CAP)) : cards;
    var i = startAt || 0, got = startGot || 0, shaky = [];
    function step() {
      if (i >= q.length) return summary();
      saveResume('recall', S.track, q, i, got, label);
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
          shaky.slice(0, 5).map(function (m) {
            var l = m.links && m.links[0];
            return '<div class="st-sum-miss-item">' + esc(m.q) +
              (l ? ' <a class="st-lad-quote-link" href="' + esc(l.u) + '">' + esc(l.t) + '</a>' : '') + '</div>';
          }).join('') +
          (shaky.length > 5 ? '<div class="st-sum-miss-more">+ ' + (shaky.length - 5) + ' more</div>' : '') +
          '</div>';
      }
      render('<div class="st-card st-summary"><div class="st-chip">' + esc(label) + '</div>' +
        '<div class="st-sum-num">' + got + '<span> of ' + i + ' solid</span></div>' +
        '<div class="st-prog st-prog-lg" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
        '<p class="st-sub">' + sumFlavor(pct, i) + '</p>' + missHtml +
        '<div class="st-actions">' +
        (shaky.length ? '<button class="st-btn st-btn-reveal" id="st-again">Go back over the ' + shaky.length + ' you dropped</button>' : '') +
        '<button class="st-btn' + (shaky.length ? ' st-btn-hint' : ' st-btn-reveal') + '" id="st-home">Back to dashboard</button>' +
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
        '<div class="st-actions"><button class="st-btn st-btn-reveal" id="st-home">Back to dashboard</button></div></div>');
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
      render(
        '<div class="st-session-head"><span>Threshold Sprint</span><span>streak ' + streak + ' · best ' + (S.sprint.best || 0) + '</span></div>' +
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
        '<div class="st-actions"><button class="st-btn st-btn-reveal" id="st-home">Back to dashboard</button></div></div>');
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
    S.games.combo = S.games.combo || { streak: { last: 0, run: 0 }, hist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, X: 0 }, day: 0, rows: [], done: false, win: false };
    S.games.governs = S.games.governs || { best: 0, bestCombo: 0 };
    S.games.log = S.games.log || {}; // dayNum → true when any game was completed that day
    return S.games;
  }
  var _comboDict = null;
  function comboDictHas(w) { // Wordle-style accept list, shipped in the deck as one string
    if (!_comboDict) {
      _comboDict = new Set();
      var d = (deck.games && deck.games.dict) || '';
      for (var i = 0; i + 5 <= d.length; i += 5) _comboDict.add(d.slice(i, i + 5));
    }
    return _comboDict.has(w);
  }
  function gamesMarkToday() { gamesState().log[comboToday()] = true; }
  function gamesHubStreak() { // consecutive active days, weekends never break it
    var log = gamesState().log, day = comboToday(), run = 0, d = day;
    if (!log[d]) { d--; while (d > day - 4 && isWeekend(d)) d--; if (!log[d]) return 0; }
    while (log[d] || isWeekend(d)) { if (log[d]) run++; d--; if (run > 400) break; }
    return run;
  }
  var COMBO_EPOCH = Math.floor(Date.UTC(2026, 6, 12) / 86400000); // No. 1 = 12 Jul 2026 (Zulu)
  function comboToday() { return Math.floor(Date.now() / 86400000); }
  function comboNo(day) { return day - COMBO_EPOCH + 1; }
  function comboWordFor(day) {
    var pool = deck.games.combination;
    return pool[((day - COMBO_EPOCH) % pool.length + pool.length) % pool.length];
  }
  function isWeekend(day) { var dow = new Date(day * 86400000).getUTCDay(); return dow === 0 || dow === 6; }
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
    var ms = 86400000 - (Date.now() % 86400000);
    var h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
    var at = new Date(Date.now() + ms);
    var local = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return 'New round in ' + h + 'h ' + (m < 10 ? '0' : '') + m + 'm — ' + local + ' your time';
  }
  function comboGridMini(G) { // tiny result grid for the status card
    var entry = comboWordFor(G.day), target = entry.w;
    return G.rows.map(function (g) {
      var res = [], left = {}, i;
      for (i = 0; i < 5; i++) { if (g[i] === target[i]) res[i] = 'c'; else { res[i] = 'a'; left[target[i]] = (left[target[i]] || 0) + 1; } }
      for (i = 0; i < 5; i++) if (res[i] === 'a' && left[g[i]]) { res[i] = 'p'; left[g[i]]--; }
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
        '<span>' + (G.combo.win ? 'Combination cracked in ' + G.combo.rows.length : 'The combination held') + ' \u00b7 tempo best today ' + govToday.best.toLocaleString() + '. ' + esc(nextRoundLine()) + '.</span></div></div>'
      : '';
    var comboCard = comboDone
      ? '<button class="st-plate st-plate-done" id="g-combo">' +
        '<span class="st-plate-eyebrow">Daily \u00b7 No. ' + no + ' \u00b7 ' + (G.combo.win ? 'Solved in ' + G.combo.rows.length : 'Sealed') + '</span>' +
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
        '<span class="st-plate-sub">Guess today\u2019s five-letter term of the trade in six tries \u2014 Wordle, for the acquisition world. Same word for everyone.</span>' +
        '<span class="st-plate-meta">Play today\u2019s word \u2192</span></button>';
    var govMeta = govToday
      ? 'Today\u2019s best ' + govToday.best.toLocaleString() + (gvBest > govToday.best ? ' \u00b7 record ' + gvBest.toLocaleString() : ' \u00b7 that\u2019s your record') + ' \u00b7 run it again \u2192'
      : (gvBest ? 'Personal best ' + gvBest.toLocaleString() + ' \u00b7 play \u2192' : 'No score on the board yet \u00b7 play \u2192');
    return '<div class="st-tools-label">Interactive practice · jump in any time</div>' +
      '<div class="st-games-head"><h2 class="st-h2" style="margin:2px 0 0">Practice Range</h2>' +
      (run >= 2 ? '<span class="st-streak" title="Days in a row with at least one round played \u2014 weekends don\u2019t break it"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l1.4 3.1L10.8 5 8.4 7.2l.7 3.3L6 8.8l-3.1 1.7.7-3.3L1.2 5l3.4-.9z"/></svg>' + run + '-day streak</span>' : '') +
      '</div>' +
      '<p class="st-sub">Practice by deciding, not reviewing \u2014 from the daily word to a 90-second reflex round to a full source selection you sit down with.</p>' +
      '<a class="st-sim-feature" href="/source-selection">' +
      '<span class="st-sim-kick">Flagship \u00b7 Simulator</span>' +
      '<b class="st-sim-title">Source Selection Simulator</b>' +
      '<span class="st-sim-desc">Take the Source Selection Authority\u2019s chair on a $250M best-value tradeoff \u2014 nine decisions, a live protest-risk score, and every call cited to the DoD Source Selection Procedures.</span>' +
      '<span class="st-sim-chips"><span class="st-sim-chip">\u2248 18 min</span><span class="st-sim-meta">$250M best-value \u00b7 9 decisions \u00b7 untimed</span></span>' +
      '<span class="st-sim-go" aria-hidden="true">\u2192</span></a>' +
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
  }

  /* ---- The Warrant Ladder — rung-scoped recall, every answer backed by the regulation's
     own words (deck.ladder, built + verified by build_deck_v2.py). UNLISTED beta: renders
     only once ?ladder=1 has set S.ladderBeta. The four rungs are legal authority levels —
     all always available, never gated. Ladder ids are globally unique and share the same
     per-card scheduler (grade/cardState) but the pools stay out of recallPool() entirely. */
  /* KILL SWITCH. Set to false and the ladder disappears for everyone, including people
     holding the ?ladder=1 link — no other edit required, no deck rebuild, nothing else on
     /study affected. Flip it, bump the study.js ?v in api/_seo.js and the sw.js cache, push.
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
  function ladderPool(rung) { return (deck.ladder && deck.ladder[rung]) || []; }
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
    var out = '<div class="st-lad-quote">“' + esc(c.cite.quote) + '”' +
      (l ? ' — <a class="st-lad-quote-link" href="' + esc(l.u) + '">' + esc(l.t) + '</a>' : '') + '</div>';
    // Where DoD deviates, the deviation is the operative rule for this audience — so it
    // gets the same treatment as the baseline, not a footnote.
    var d = c.dod;
    if (d && d.quote && d.link) {
      out += '<div class="st-lad-quote st-lad-dod"><span class="st-lad-dod-tag">DoD</span> “' +
        esc(d.quote) + '” — <a class="st-lad-quote-link" href="' + esc(d.link.u) + '">' +
        esc(d.link.t) + '</a></div>';
    }
    return out;
  }
  function rungStripHtml(sel) {
    return '<div class="st-rungs">' + RUNGS.map(function (r) {
      var n = ladderPool(r.k).length;
      return '<button class="st-rung' + (r.k === sel ? ' st-rung-on' : '') + '" data-rung="' + r.k +
        '" aria-pressed="' + (r.k === sel) + '" aria-label="' + esc(r.label) + ', ' + n + ' cards">' +
        '<b class="st-rung-ceiling">' + r.ceiling + '</b>' +
        '<span class="st-rung-what">' + r.what + '</span>' +
        '<span class="st-rung-n">' + n + ' cards</span></button>';
    }).join('') + '</div>';
  }
  function ladderCountLine(pool) { return '<p class="st-lad-count">' + pool.length + ' cards, every one cited to the rulebook.</p>'; }
  function ladderSectionHtml() {
    // Public as of the beta launch — S.ladderBeta is no longer a gate, only a record that
    // someone arrived through the original unlisted link. LADDER_ENABLED still kills it.
    if (!LADDER_ENABLED || !deck.ladder) return '';
    var sel = ladderRung();
    return stepKicker(2, 'Prove your readiness') +
      '<h2 class="st-h2" style="margin-top:2px">The Warrant Ladder <span class="st-beta">Beta</span></h2>' +
      '<p class="st-sub">A warrant lets you sign up to a ceiling — and holds you to every rule below it. ' +
      'Scope your prep to the warrant you’re testing for; each card quotes the regulation in its own words, ' +
      'and flags where DoD deviates. <span class="st-lad-cum">Each ceiling includes everything under it.</span></p>' +
      rungStripHtml(sel) +
      ladderCountLine(ladderPool(sel));
  }
  function wireLadderSection() {
    Array.prototype.forEach.call(app.querySelectorAll('.st-rung'), function (b) {
      b.onclick = function () {
        S.ladderRung = b.getAttribute('data-rung'); save();
        depth1View = viewLadder; goDepth(1, viewLadder);
      };
    });
  }
  function viewLadder() {
    var sel = ladderRung();
    var pool = ladderPool(sel);
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
    var boardHtml = !boards.length ? ''
      : '<div class="st-lad-boards"><span class="st-lad-boards-lab">Board sims</span>' +
        '<span class="st-lad-boards-n">' + faced.length + ' of ' + boards.length + ' faced</span>' +
        (faced.length ? '<span class="st-lad-boards-split">' + ready + ' board-ready · ' + rough + ' rough</span>' : '') +
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
            (l ? ' <a class="st-lad-quote-link" href="' + esc(l.u) + '">' + esc(l.t) + '</a>' : '') + '</div>';
        }).join('') + '</div>'
      : '';
    render(
      '<h2 class="st-h2" style="margin-top:0">The Warrant Ladder</h2>' +
      '<p class="st-sub">Pick the ceiling you’re testing for.</p>' +
      rungStripHtml(sel) +
      ladderCountLine(pool) +
      '<div class="st-lad-ready"><span class="st-lad-ready-lab">Card mastery</span>' +
      '<span class="st-bar" aria-hidden="true"><span class="st-bar-fill" style="width:' + m + '%"></span></span>' +
      '<span class="st-topic-meta">' + m + '%</span></div>' +
      boardHtml +
      simHtml +
      '<div class="st-actions"><button class="st-btn st-btn-reveal" id="lad-start">Study these cards <kbd>space</kbd></button>' +
      (boards.length ? '<button class="st-btn st-btn-hint" id="lad-board">Face the board</button>' : '') +
      '</div>' +
      sinkHtml +
      '<button class="st-link st-quit" id="st-quit">← Study menu</button>');
    el('st-quit').onclick = backToTools;
    Array.prototype.forEach.call(app.querySelectorAll('.st-rung'), function (b) {
      b.onclick = function () { S.ladderRung = b.getAttribute('data-rung'); save(); viewLadder(); };
    });
    el('lad-start').onclick = function () { goDepth(2, function () { ladderSession(pool, label); }); };
    if (el('lad-board')) {
      el('lad-board').onclick = function () { goDepth(2, function () { ladderBoardSession(sel, label); }); };
    }
    keyHandler(function (k) { if (k === ' ' || k === 'Enter') { el('lad-start').onclick(); return true; } });
  }
  /* Session position survives a reload. Without this, following a citation — the whole
     point of the ladder — dumped you back at the track picker with the drill gone, which
     punished the exact behaviour the feature exists to create. Stores card ids, not cards. */
  function saveResume(mode, rung, q, i, got, label, extra) {
    S.resume = { mode: mode, rung: rung, ids: q.map(function (c) { return c.id; }),
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
        '<button class="st-link st-quit" id="st-quit">End session</button>');
      el('st-quit').onclick = summary;
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
          shaky.slice(0, 5).map(function (m) {
            var l = m.cite && m.cite.link;
            return '<div class="st-sum-miss-item">' + esc(m.q) +
              (l ? ' <a class="st-lad-quote-link" href="' + esc(l.u) + '">' + esc(l.t) + '</a>' : '') + '</div>';
          }).join('') +
          (shaky.length > 5 ? '<div class="st-sum-miss-more">+ ' + (shaky.length - 5) + ' more</div>' : '') +
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
        return '<div class="st-bd-source"><a class="st-lad-quote-link" href="' + esc(c.u) + '">' + esc(c.t) + '</a>' +
          (c.quote ? '<div class="st-bd-source-q">“' + esc(c.quote) + '”</div>' : '') + '</div>';
      }).join('') + '</div>';
  }

  var BD_CHECKS = [
    'I named the rule and where it lives',
    'I called the trap in the scenario',
    'I landed on a decision and said where I’d verify it'
  ];
  var BD_VERDICT = { 1: 'Rough', 2: 'Getting there', 3: 'Board-ready' };

  function ladderBoardSession(rung, label, pickId, startStage) {
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
    var fuRevealed = false, hintUsed = false;
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
      saveResume('ladderBoard', rung, [sc], stage, 0, label);
      var body = '<div class="st-chip">Board sim · ' + esc(sc.topic) + '</div>';
      if (stage === 0) {
        body += '<div class="st-scenario"><div class="st-scen-eyebrow">The scenario</div>' + esc(sc.scenario) + '</div>' +
          '<div class="st-panel-ask"><span class="st-ask-kicker">The panel asks</span>' + esc(sc.ask) + '</div>' +
          '<p class="st-outloud">Answer <b>out loud</b>, all the way through, as if the panel were in front of you. ' +
          'Take as long as you need — nothing here is timed.</p>' +
          '<label class="st-bd-bluf-lab" for="bd-bluf">Bottom line up front — one line, the way you opened</label>' +
          '<input class="st-bd-bluf" id="bd-bluf" type="text" maxlength="140" autocomplete="off" ' +
          'placeholder="e.g. I’d stop the award and run a set-aside check first.">' +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">I’m done — show the model answer</button></div>';
      } else if (stage === 1) {
        body += '<div class="st-scenario st-scenario-sm">' + esc(sc.scenario) + '</div>' +
          (bluf
            ? '<div class="st-bd-echo"><div class="st-bd-echo-head">What you said you’d do</div>' + esc(bluf) + '</div>'
            : '<div class="st-bd-echo st-bd-echo-none">No opening line — the model answer is below.</div>') +
          '<div class="st-script"><div class="st-script-head">Say it like this</div><p>' + esc(sc.script) + '</p></div>' +
          boardCitesText(sc.cites) +
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
            ' cards behind this</button>' : '') +
          '<button class="st-btn' + (bp.length ? ' st-btn-hint' : ' st-btn-reveal') + '" id="bd-next">Next scenario</button>' +
          '<button class="st-btn st-btn-hint" id="bd-home">Back to the ladder</button></div>';
      }
      var headNote = stage === 0 ? 'the ask'
        : stage === 1 ? 'the model answer'
        : stage < CHECK_STAGE ? 'follow-up ' + (stage - 1) + ' of ' + fus.length
        : stage === CHECK_STAGE ? 'your call' : 'the record';
      render('<div class="st-session-head"><span>' + esc(label) + ' · board sim</span><span>' + headNote +
        '</span></div><div class="st-card" aria-live="polite">' + body + '</div>' +
        '<button class="st-link st-quit" id="st-quit">End this sim</button>');
      el('st-quit').onclick = function () { clearResume(); viewLadder(); };

      if (stage === 0) {
        el('next').onclick = function () {
          var f = el('bd-bluf');
          bluf = f ? f.value.trim() : '';   // read, echoed once, never persisted
          advance();
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
            goDepth(2, function () { ladderSession(bp2, label); });
          };
        }
        el('bd-next').onclick = function () { ladderBoardSession(rung, label); };
        el('bd-home').onclick = function () { clearResume(); viewLadder(); };
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
    goDepth(2, function () { ladderBoardSession(r.rung, r.label, r.ids[0], r.i); });
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
    depth1View = viewHome;
    goDepth(2, function () { startSession(q, r.label, r.i, r.got); });
    return true;
  }
  function resumeDeep() {
    var r = S.resume;
    var q = r.ids ? cardsByIdFromPool(recallPool(), r.ids) : null;
    if (!q || !q.length) { clearResume(); return false; }
    depth1View = viewHome;
    goDepth(2, function () { viewDeep(q[0], r.seen || 0, r.got || 0); });
    return true;
  }
  function resumeSprint() {
    var r = S.resume;
    var q = r.ids ? cardsByIdFromPool(deck.thresholds, r.ids) : null;
    if (!q || r.i >= q.length) { clearResume(); return false; }
    depth1View = viewHome;
    goDepth(2, function () { viewSprint(q, r.i, r.streak || 0); });
    return true;
  }
  function resumeSession() {
    var r = S.resume;
    if (!r) return false;
    // ladder, board sims and the games need no track selected; the track-bound modes do.
    if (r.mode !== 'ladder' && r.mode !== 'ladderBoard' && r.mode !== 'governs' && !S.track) { clearResume(); return false; }
    rendered = true;
    var ok = r.mode === 'ladderBoard' ? resumeLadderBoard()
      : r.mode === 'recall' ? resumeRecall()
      : r.mode === 'deep' ? resumeDeep()
      : r.mode === 'sprint' ? resumeSprint()
      : r.mode === 'governs' ? resumeGoverns()
      : r.mode === 'board' ? resumeBoard()
      : resumeLadder();
    if (!ok) rendered = false;   // nothing resumed — the next paint really is a cold arrival
    return ok;
  }

  /* ---- The Combination — the daily vault word ---- */
  var KB_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', '⏎ZXCVBNM⌫'];
  function viewCombo() {
    var G = gamesState().combo;
    var day = comboToday();
    if (G.day !== day) { G.day = day; G.rows = []; G.done = false; G.win = false; save(); }
    var entry = comboWordFor(day), target = entry.w;
    var guess = '';
    var motion = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    function evalRow(g) { // standard two-pass: correct first, then presents against remaining letters
      var res = [], left = {};
      for (var i = 0; i < 5; i++) {
        if (g[i] === target[i]) res[i] = 'c';
        else { res[i] = 'a'; left[target[i]] = (left[target[i]] || 0) + 1; }
      }
      for (i = 0; i < 5; i++) {
        if (res[i] === 'a' && left[g[i]]) { res[i] = 'p'; left[g[i]]--; }
      }
      return res;
    }
    function keyStates() {
      var ks = {};
      G.rows.forEach(function (g) {
        var r = evalRow(g);
        for (var i = 0; i < 5; i++) {
          var cur = ks[g[i]];
          if (r[i] === 'c' || (r[i] === 'p' && cur !== 'c') || (r[i] === 'a' && !cur)) ks[g[i]] = r[i];
        }
      });
      return ks;
    }
    function boardHtml() {
      var html = '';
      for (var r = 0; r < 6; r++) {
        html += '<div class="st-cb-row" data-r="' + r + '">';
        for (var c = 0; c < 5; c++) {
          var ch = '', cls = '';
          if (r < G.rows.length) {
            ch = G.rows[r][c];
            cls = ' st-cb-' + evalRow(G.rows[r])[c];
          } else if (r === G.rows.length && !G.done) {
            ch = guess[c] || '';
            if (ch) cls = ' st-cb-fill';
          }
          html += '<span class="st-cb-tile' + cls + '">' + ch + '</span>';
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
    function exTile(ch, state) { return '<span class="st-cb-tile st-cb-tile-ex' + (state ? ' st-cb-' + state : '') + '">' + ch + '</span>'; }
    function helpHtml(first) {
      return '<div class="st-cb-help">' +
        '<div class="st-cb-help-head">How to crack it</div>' +
        '<p>Guess the day&rsquo;s <b>five-letter acquisition term</b> in six tries. Type on your keyboard or tap the keys below. <b>Enter</b> submits a row; the <b>⌫ key removes a letter</b> (tapping the row does too).</p>' +
        '<p>After each guess, the tiles tell you how close you are:</p>' +
        '<div class="st-cb-help-row">' + exTile('S', 'c') + exTile('C', '') + exTile('O', '') + exTile('P', '') + exTile('E', '') + '<span><b>S</b> is in the word, in the right spot</span></div>' +
        '<div class="st-cb-help-row">' + exTile('A', '') + exTile('U', 'p') + exTile('D', '') + exTile('I', '') + exTile('T', '') + '<span><b>U</b> is in the word, in a different spot</span></div>' +
        '<div class="st-cb-help-row">' + exTile('C', '') + exTile('L', '') + exTile('A', '') + exTile('I', '') + exTile('M', 'a') + '<span><b>M</b> isn&rsquo;t in the word at all</span></div>' +
        '<p>Same word for everyone, everywhere — a new one every day. Crack it and the vault teaches you the term.</p>' +
        '<div class="st-actions" style="justify-content:center"><button class="st-btn st-btn-reveal" id="cb-help-go">' + (first ? 'Got it — open the board' : 'Back to the board') + '</button></div></div>';
    }
    function zuluCountdown() {
      var ms = 86400000 - (Date.now() % 86400000);
      var h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000);
      return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
    }
    function shareText() {
      var no = comboNo(day);
      var grid = G.rows.map(function (g) {
        // 🟦/🟨 mirrors the board's navy/brass — the colorblind-safe pair — not Wordle's green
        return evalRow(g).map(function (s) { return s === 'c' ? '🟦' : s === 'p' ? '🟨' : '⬛'; }).join('');
      }).join('\n');
      var run = G.streak.run;
      return 'AcqVault — The Combination No. ' + no + ' · ' + (G.win ? G.rows.length : 'X') + '/6\n' + grid +
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
        '<div class="st-cb-verdict">' + (G.win ? 'Cracked in ' + G.rows.length : 'Sealed — the combination was') + '</div>' +
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
        (G.done ? '' : (helping ? '' : (6 - G.rows.length) + ' tries left · ') + '<button class="st-link st-cb-helpbtn" id="cb-help">how to play</button>') + '</span></div>' +
        '<div class="st-card st-cb-card">' +
        (helping && !G.done ? helpHtml(firstTime) :
         G.done ? resultHtml() :
          (entry.cat ? '<div class="st-cb-cat"><span>Category</span>' + esc(entry.cat) + '</div>' : '') +
          '<p class="st-cb-prompt">Guess the five-letter acquisition term — type or tap, then press <b>Enter</b>.</p>' +
          '<div class="st-cb-board" id="cb-board">' + boardHtml() + '</div>' +
          '<div class="st-cb-legend" aria-label="What the colors mean">' +
          '<span><i class="st-cb-tile st-cb-c"></i>right spot</span>' +
          '<span><i class="st-cb-tile st-cb-p"></i>in the word, wrong spot</span>' +
          '<span><i class="st-cb-tile st-cb-a"></i>not in the word</span></div>' +
          '<div class="st-cb-msg" id="cb-msg">' + (msg || '') + '</div>' +
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
    function boardListHtml(top, mine) {
      if (!top.length) return '<p class="st-sub" style="text-align:center;margin:6px 0 0">No one on the board yet — be first.</p>';
      return '<ol class="st-lb-list">' + top.slice(0, 10).map(function (e, i) {
        return '<li' + (mine && e.n === mine ? ' class="st-lb-me"' : '') + '><span class="st-lb-rank">' + (i + 1) + '</span><span class="st-lb-name">' + esc(e.n) + '</span><span class="st-lb-g">' + (e.g === 'X' ? '—' : e.g + '/6') + '</span></li>';
      }).join('') + '</ol>';
    }
    function wireBoard() {
      var box = el('cb-lb'); if (!box) return;
      var posted = G.postedDay === day;
      fetch('/api/feedback?board=1').then(function (r) { return r.json(); }).then(function (b) {
        if (!b.configured) { box.innerHTML = ''; return; }
        var head = '<div class="st-lb-head">Today&rsquo;s board · ' + b.count + ' on it</div>';
        if (posted) {
          box.innerHTML = head + boardListHtml(b.top, G.postedName) +
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
            body: JSON.stringify({ kind: 'board', day: comboNo(day), guesses: G.win ? G.rows.length : 'X', name: (el('lb-name') || {}).value || '' })
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
      if (guess.length < 5) { guess += k; updateRow(); }
    }
    function submit() {
      var m = el('cb-msg');
      if (guess.length < 5) {
        if (m) m.textContent = 'Five letters.';
        var row = app.querySelector('.st-cb-row[data-r="' + G.rows.length + '"]');
        if (row && motion) { row.classList.add('st-cb-row-shake'); setTimeout(function () { row.classList.remove('st-cb-row-shake'); }, 350); }
        return;
      }
      if (!comboDictHas(guess)) {
        if (m) m.textContent = 'Not in the word list.';
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
      if (won || G.rows.length >= 6) {
        G.done = true; G.win = won;
        if (won) G.hist[G.rows.length]++; else G.hist.X++;
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
        setTimeout(function () { paint(); }, 5 * 130 + 420);
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
      next();
    }
    function next() {
      if (ended) return;   // a pending reveal-delay must not paint a question over the end screen
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
        if (b.getAttribute('data-p') === q.p) b.classList.add('st-gv-opt-right');
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
            '<a class="st-cite" href="' + esc(m.u) + '">' + esc(m.p) + ' — ' + esc(deck.games.part_names[m.p] || '') + '</a></div>';
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
    depth1View = viewHome;
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
    return h;
  }
  // The model answer, assembled methodically: name it → frameworks → help → default rule →
  // walk the facts → land the decision → close the loop. "That's the way you learn."
  function boardWalkthrough(sc) {
    var co = sc.coach || {};
    var opener = sc.style === 'opener';
    var steps = [];
    steps.push('<li><b>Name the question.</b> Out loud, first sentence: this is ' + esc(co.qtype || 'a frameworks question — name it, then walk it.') + '</li>');
    if (sc.frameworks && sc.frameworks.length) {
      steps.push('<li><b>Name the framework(s) in play.</b> ' + sc.frameworks.map(function (f) {
        return esc(typeof f === 'string' ? f : (f.framework + (f.why ? ' — ' + f.why : '')));
      }).join('<br>') + '</li>');
    }
    if (opener) {
      steps.push('<li><b>Own it.</b> ' + esc(co.smes || 'This one is yours — anchor on your own experience and what you actually control.') + '</li>');
      steps.push('<li><b>Give it a spine.</b> ' + esc(co.rule || 'A definition, a concrete plan, and one example — in that order.') + '</li>');
    } else {
      steps.push('<li><b>Name your help.</b> Boards reward knowing who to call: ' + esc(co.smes || 'your CO/chief, Legal (JA), and FM.') + '</li>');
      steps.push('<li><b>State the default rule before any exception.</b> ' + esc(co.rule || 'Default first, exception second, facts third.') + '</li>');
    }
    if (sc.facts) {
      var baits = sc.facts.filter(function (f) { return f.verdict === 'bait'; }).map(function (f) { return f.fact; });
      var govs = sc.facts.filter(function (f) { return f.verdict !== 'bait'; }).map(function (f) { return f.fact; });
      var walk = 'Take each planted fact and say whether it governs or baits (debrief above).';
      if (baits.length) walk += ' Call the bait by name: ' + baits.map(esc).join(' · ') + '.';
      if (govs.length) walk += ' Then anchor on what governs: “' + esc(govs[0]) + '”.';
      steps.push('<li><b>Walk the facts — bait vs. governs.</b> ' + walk + '</li>');
    } else if (sc.baits && sc.baits.length) {
      steps.push('<li><b>Walk the facts — call the bait.</b> Say why each of these is in the scenario, and why it doesn\'t control: ' + sc.baits.map(esc).join(' · ') + '</li>');
    }
    if (sc.key_moves && sc.key_moves.length) {
      steps.push('<li><b>Land the decision — your moves, in order.</b><ul>' + sc.key_moves.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></li>');
    } else if (sc.board_answer) {
      steps.push('<li><b>Land the decision.</b> ' + esc(sc.board_answer) + '</li>');
    }
    steps.push('<li><b>Close the loop.</b> ' + (opener
      ? 'End in your own voice — one concrete thing you would change on Monday. Perspective questions are scored on judgment and specifics, not recitation.'
      : 'Say where you\'d verify before acting — the live RFO/R-DFARS text, your Legal office — and what goes in the file. Never quote a threshold from memory.') + '</li>');
    return '<div class="st-walk"><div class="st-walk-head">How you should have answered — step by step</div><ol>' + steps.join('') + '</ol>' +
      (co.cite ? '<div class="st-explain-ref">Where it lives: <b>' + esc(co.cite) + '</b></div>' : '') +
      citesHtml(co.links) + '</div>';
  }
  function viewBoard(pickId, startStage, startFu, startHints) {
    var pool = deck.scenarios.slice();
    var sc = pickId ? pool.filter(function (s) { return s.id === pickId; })[0] : null;
    if (!sc) {
      var fresh = pool.filter(function (s) { return !S.scen[s.id]; });
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
      var body = '<div class="st-chip">Board Sim' + (sc.topics && sc.topics.length && stage > 0 ? ' · ' + esc(sc.topics.join(' · ')) : '') + '</div>';
      if (stage === 0) {
        body = '<div class="st-chip">Board Sim</div>' +
          '<div class="st-scenario"><div class="st-scen-eyebrow">The scenario</div>' + esc(sc.scenario) + '</div>' +
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
        body += '<div class="st-scenario st-scenario-sm">' + esc(sc.scenario) + '</div>' + askHtml + d +
          boardWalkthrough(sc) +
          (sc.script ? '<div class="st-script"><div class="st-script-head">Say it like this</div><p>' + esc(sc.script) + '</p></div>' : '') +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">' + (fus.length ? 'The panel follows up… <kbd>space</kbd>' : 'Grade yourself') + '</button></div>';
      } else if (stage - 2 < fus.length) {
        var k = stage - 2;
        var fu = fus[k] || {};
        var fq = fu.q || fu; // deck v4 uses {q,h,d}; tolerate legacy plain strings
        body += '<div class="st-followup"><span>Panel follow-up ' + (k + 1) + ' of ' + fus.length + '</span><div class="st-q">' + esc(fq) + '</div></div>';
        if (fu.d && fuRevealed) {
          body += '<div class="st-fu-debrief"><div class="st-fu-debrief-head">Debrief</div><p>' + esc(fu.d) + '</p>' +
            (sc.coach && sc.coach.cite ? '<div class="st-explain-ref">Where it lives: <b>' + esc(sc.coach.cite) + '</b></div>' : '') +
            citesHtml(sc.coach && sc.coach.links) + '</div>' +
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
        body += '<div class="st-q">How did the whole exchange go?</div>' +
          '<div class="st-actions">' +
          '<button class="st-btn st-g1" id="g1">Rough <kbd>1</kbd></button>' +
          '<button class="st-btn st-g2" id="g2">Getting there <kbd>2</kbd></button>' +
          '<button class="st-btn st-g3" id="g3">Board-ready <kbd>3</kbd></button></div>';
      }
      render('<div class="st-session-head"><span>Board Sim</span><span>&nbsp;</span></div><div class="st-card" aria-live="polite">' + body + '</div>' +
        '<button class="st-link st-quit" id="st-quit">Back to dashboard</button>');
      el('st-quit').onclick = function () { clearResume(); backHome(); };
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
        ['g1', 'g2', 'g3'].forEach(function (id, gi) {
          el(id).onclick = function () { S.scen[sc.id] = gi + 1; bumpStreak(); save(); keyHandler(null); viewBoard(); };
        });
        keyHandler(function (k) { if (k === '1' || k === '2' || k === '3') { S.scen[sc.id] = +k; bumpStreak(); save(); keyHandler(null); viewBoard(); return true; } });
      }
    }
    step();
  }

  /* ---- keyboard, export/import ---- */
  var keyFn = null;
  function keyHandler(fn) { keyFn = fn; }
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
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
      try { var s = JSON.parse(r.result); if (s && s.cards) { S = s; save(); viewHome(); } else alert('Not a study-progress file.'); }
      catch (err) { alert('Could not read that file.'); }
    };
    r.readAsText(f);
  }

  /* ---- boot: always land on the track selector (progress remembered underneath) ---- */
  document.addEventListener('DOMContentLoaded', function () {
    app = el('study-app');
    if (!app) return;
    fetch(DECK_URL).then(function (r) { return r.json(); }).then(function (d) {
      deck = d;
      history.replaceState({ st: 0 }, '');
      navDepth = 0;
      var qs = new URLSearchParams(location.search);
      if (qs.get('ladder') === '1') { // unlisted beta unlock — persists, then the param goes away
        S.ladderBeta = true; save();
        qs.delete('ladder');
        try { history.replaceState({ st: 0 }, '', location.pathname + (qs.toString() ? '?' + qs.toString() : '')); } catch (e) {}
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
