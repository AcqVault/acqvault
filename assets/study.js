/* AcqVault Study — client-side drill engine. No accounts, no server state, no AI.
   Progress lives in localStorage ('acq-study-v1'); Export/Import moves it between browsers. */
(function () {
  'use strict';
  var DECK_URL = '/assets/study-deck.json?v=1';
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
  window.addEventListener('popstate', function (e) {
    var d = (e.state && typeof e.state.st === 'number') ? e.state.st : 0;
    navDepth = d; popping = true; keyHandler(null);
    if (!deck) { popping = false; return; }
    if (d <= 0) viewTrack(); else viewHome();
    popping = false;
  });

  /* ---- deck accessors ---- */
  function recallPool() {
    if (S.track === 'basic') return deck.recall_basic;
    return deck.recall_basic.concat(deck.recall_advanced, deck.thresholds.map(function (t) {
      return { id: t.id, type: 'recall', topic: 'Thresholds & Numbers', q: t.q, a: t.a };
    }));
  }
  function cardState(id) { return S.cards[id] || { box: 0, due: 0, lapses: 0 }; }
  function isDue(id) { var c = cardState(id); return c.box === 0 || c.due <= today(); }
  function grade(id, g) { // g: 1 missed, 2 shaky, 3 got it
    var c = cardState(id);
    if (g === 1) { c.box = 1; c.lapses++; }
    else if (g === 2) { c.box = Math.max(1, c.box); }
    else { c.box = Math.min(5, Math.max(1, c.box) + 1); }
    c.due = today() + INTERVALS[c.box - 1];
    S.cards[id] = c; save();
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
  function mcqOptions(card, pool) { // 3 distractors: same topic + similar length first, then anywhere
    var seen = {}; seen[card.a] = true;
    var same = [], other = [];
    pool.forEach(function (c) {
      if (c.id === card.id || seen[c.a]) return;
      seen[c.a] = true;
      ((c.topic === card.topic) ? same : other).push(c.a);
    });
    var byLen = function (x, y) { return Math.abs(x.length - card.a.length) - Math.abs(y.length - card.a.length); };
    // prefer same-topic; among candidates, prefer answers of comparable length so the odd one out isn't obvious
    var opts = shuffle(same).sort(byLen).slice(0, 3);
    if (opts.length < 3) opts = opts.concat(shuffle(other).sort(byLen).slice(0, 3 - opts.length));
    if (opts.length < 3) return null; // not enough material — fall back to reveal style
    opts.push(card.a);
    return shuffle(opts);
  }

  /* ---- views ---- */
  var app;
  function render(html) { app.innerHTML = html; window.scrollTo({ top: app.offsetTop - 80, behavior: 'instant' }); }

  function viewTrack() {
    var last = S.track;
    function cardHtml(id, kicker, name, blurb, active) {
      return '<button class="st-trackcard' + (active ? ' st-trackcard-active' : '') + '" id="' + id + '">' +
        (active ? '<span class="st-tc-continue">Continue — you were here</span>' : '') +
        '<span class="st-tc-kicker">' + kicker + '</span><b>' + name + '</b><p>' + blurb + '</p></button>';
    }
    render(
      '<h2 class="st-h2" style="margin-top:0">Pick your track</h2>' +
      '<p class="st-sub">Your progress is saved per card either way — switch tracks any time without losing it.</p>' +
      '<div class="st-tracks">' +
      cardHtml('t-basic', 'New to contracting', 'Basic — Foundations',
        'Knowledge checks from Field Guide Vol. 1: the players, the money, the methods. Build the base before the board.', last === 'basic') +
      cardHtml('t-adv', 'Warrant board prep', 'Advanced — The Board',
        'Everything in Basic plus Vol. 2: board-probe questions, threshold drills, and full scenario simulations with follow-ups.', last === 'advanced') +
      '</div>');
    el('t-basic').onclick = function () { S.track = 'basic'; save(); goDepth(1, viewHome); };
    el('t-adv').onclick = function () { S.track = 'advanced'; save(); goDepth(1, viewHome); };
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
      return '<button class="st-topic" data-topic="' + esc(t) + '" aria-label="Drill ' + esc(t) + ', mastery ' + m + ' percent">' +
        '<span class="st-topic-name">' + esc(t) + '</span>' +
        '<span class="st-bar" aria-hidden="true"><span class="st-bar-fill" style="width:' + m + '%"></span></span>' +
        '<span class="st-topic-meta">' + m + '%' + (d ? ' · ' + d + ' due' : '') + '</span></button>';
    }).join('');
    var scen = deck.scenarios;
    var scenDone = scen.filter(function (s) { return S.scen[s.id]; }).length;
    render(
      '<div class="st-head"><div class="st-track-chip">' + (S.track === 'basic' ? 'Basic · Foundations' : 'Advanced · Board Prep') +
      ' <button class="st-link" id="st-switch">switch</button></div></div>' +
      '<div class="st-modes">' +
      '<button class="st-mode st-mode-primary" id="m-daily"><b>Daily Review</b><span>' + due.length + ' card' + (due.length !== 1 ? 's' : '') + ' due — spaced repetition does the scheduling</span></button>' +
      '<button class="st-mode" id="m-deep"><b>Deep Study</b><span>Endless random cards, every topic in the mix — go as long as you want</span></button>' +
      '<button class="st-mode" id="m-sprint"><b>Threshold Sprint</b><span>Rapid-fire numbers · best streak ' + (S.sprint.best || 0) + '</span></button>' +
      (S.track === 'advanced' ?
        '<button class="st-mode" id="m-board"><b>Board Sim</b><span>' + scenDone + ' of ' + scen.length + ' scenarios faced — answer out loud, then the follow-ups</span></button>' : '') +
      '</div>' +
      '<h2 class="st-h2">Readiness by topic</h2>' +
      '<p class="st-sub">Tap a topic to drill it directly, due or not.</p>' +
      '<div class="st-topics">' + rows + '</div>' +
      '<div class="st-foot-tools"><button class="st-link" id="st-export">Export progress</button> · ' +
      '<button class="st-link" id="st-import">Import</button> · ' +
      '<button class="st-link" id="st-reset">Reset</button><input type="file" id="st-file" accept="application/json" hidden></div>'
    );
    el('m-daily').onclick = function () { goDepth(2, function () { startSession(due, 'Daily Review'); }); };
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

  /* ---- recall session (mixed reveal + multiple-choice) ---- */
  function startSession(cards, label) {
    if (!cards.length) { viewHome(); return; }
    var pool = recallPool();
    var q = interleave(shuffle(cards.slice()).slice(0, SESSION_CAP));
    var i = 0, got = 0;
    function step() {
      if (i >= q.length) return summary();
      var c = q[i];
      var opts = mcqOptions(c, pool); // knowledge checks are multiple choice; reveal-style is the rare fallback
      var head = '<div class="st-session-head"><span>' + esc(label) + '</span><span>' + (i + 1) + ' / ' + q.length + '</span></div>';
      if (opts) {
        render(head +
          '<div class="st-card" aria-live="polite">' +
          '<div class="st-chip">' + esc(c.topic || 'General') + '</div>' +
          '<div class="st-q">' + esc(c.q) + '</div>' +
          '<div class="st-opts">' + opts.map(function (o, k) {
            return '<button class="st-opt" data-k="' + k + '"><kbd>' + (k + 1) + '</kbd><span>' + esc(o) + '</span></button>';
          }).join('') + '</div></div>' +
          '<button class="st-link st-quit" id="st-quit">End session</button>');
        el('st-quit').onclick = summary;
        var answered = false;
        function pick(k) {
          if (answered) return; answered = true;
          var right = opts[k] === c.a;
          Array.prototype.forEach.call(app.querySelectorAll('.st-opt'), function (b) {
            var bk = +b.getAttribute('data-k');
            if (opts[bk] === c.a) b.classList.add('st-opt-right');
            else if (bk === k) b.classList.add('st-opt-wrong');
            b.disabled = true;
          });
          grade(c.id, right ? 3 : 1);
          if (right) got++;
          var act = document.createElement('div'); act.className = 'st-actions';
          act.innerHTML = '<button class="st-btn st-btn-reveal" id="st-next">' + (right ? 'Next' : 'Got it — next') + ' <kbd>space</kbd></button>';
          app.querySelector('.st-card').appendChild(act);
          el('st-next').onclick = function () { i++; step(); };
          keyHandler(function (key) { if (key === ' ' || key === 'Enter') { i++; step(); return true; } });
        }
        Array.prototype.forEach.call(app.querySelectorAll('.st-opt'), function (b) {
          b.onclick = function () { pick(+b.getAttribute('data-k')); };
        });
        keyHandler(function (key) {
          var n = parseInt(key, 10);
          if (n >= 1 && n <= opts.length) { pick(n - 1); return true; }
        });
      } else {
        render(head +
          '<div class="st-card" aria-live="polite">' +
          '<div class="st-chip">' + esc(c.topic || 'General') + '</div>' +
          '<div class="st-q">' + esc(c.q) + '</div>' +
          '<div id="st-a" class="st-a" hidden>' + esc(c.a) + '</div>' +
          '<div class="st-actions" id="st-act">' +
          '<button class="st-btn st-btn-reveal" id="st-reveal">Reveal <kbd>space</kbd></button></div></div>' +
          '<button class="st-link st-quit" id="st-quit">End session</button>');
        el('st-quit').onclick = summary;
        el('st-reveal').onclick = reveal;
        keyHandler(function (k) { if (k === ' ' || k === 'Enter') { reveal(); return true; } });
      }
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
      function doGrade(g) { grade(c.id, g); if (g === 3) got++; i++; step(); }
    }
    function summary() {
      keyHandler(null);
      render('<div class="st-card st-summary"><div class="st-chip">' + esc(label) + '</div>' +
        '<div class="st-q">' + got + ' of ' + i + ' solid.</div>' +
        '<p class="st-sub">Missed cards come back tomorrow; solid ones stretch out. Come back daily — short and often beats long and rare.</p>' +
        '<div class="st-actions"><button class="st-btn st-btn-reveal" id="st-home">Back to dashboard</button></div></div>');
      el('st-home').onclick = backHome;
    }
    step();
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
  function viewDeep() {
    var pool = recallPool();
    var order = shuffle(pool.slice());
    var i = 0, seen = 0, got = 0;
    function nextCard() {
      if (i >= order.length) { order = shuffle(pool.slice()); i = 0; } // deck exhausted → reshuffle, keep going
      return order[i++];
    }
    function step() {
      var c = nextCard();
      var opts = mcqOptions(c, pool);
      var head = '<div class="st-session-head"><span>Deep Study · endless</span><span>' + got + ' / ' + seen + ' solid</span></div>';
      if (opts) {
        render(head +
          '<div class="st-card" aria-live="polite">' +
          '<div class="st-chip">' + esc(c.topic || 'General') + '</div>' +
          '<div class="st-q">' + esc(c.q) + '</div>' +
          '<div class="st-opts">' + opts.map(function (o, k) {
            return '<button class="st-opt" data-k="' + k + '"><kbd>' + (k + 1) + '</kbd><span>' + esc(o) + '</span></button>';
          }).join('') + '</div></div>' +
          '<button class="st-link st-quit" id="st-quit">That&rsquo;s enough for now</button>');
        el('st-quit').onclick = summary;
        var answered = false;
        function pick(k) {
          if (answered) return; answered = true;
          var right = opts[k] === c.a;
          Array.prototype.forEach.call(app.querySelectorAll('.st-opt'), function (b) {
            var bk = +b.getAttribute('data-k');
            if (opts[bk] === c.a) b.classList.add('st-opt-right');
            else if (bk === k) b.classList.add('st-opt-wrong');
            b.disabled = true;
          });
          grade(c.id, right ? 3 : 1); // deep-study answers still teach the daily scheduler
          seen++; if (right) got++;
          var act = document.createElement('div'); act.className = 'st-actions';
          act.innerHTML = '<button class="st-btn st-btn-reveal" id="st-next">Next <kbd>space</kbd></button>';
          app.querySelector('.st-card').appendChild(act);
          el('st-next').onclick = step;
          keyHandler(function (key) { if (key === ' ' || key === 'Enter') { step(); return true; } });
        }
        Array.prototype.forEach.call(app.querySelectorAll('.st-opt'), function (b) {
          b.onclick = function () { pick(+b.getAttribute('data-k')); };
        });
        keyHandler(function (k) {
          var n = parseInt(k, 10);
          if (n >= 1 && n <= opts.length) { pick(n - 1); return true; }
        });
      } else { // rare fallback: produce-then-reveal
        render(head +
          '<div class="st-card" aria-live="polite">' +
          '<div class="st-chip">' + esc(c.topic || 'General') + '</div>' +
          '<div class="st-q">' + esc(c.q) + '</div>' +
          '<div id="st-a" class="st-a" hidden>' + esc(c.a) + '</div>' +
          '<div class="st-actions" id="st-act"><button class="st-btn st-btn-reveal" id="st-reveal">Reveal <kbd>space</kbd></button></div></div>' +
          '<button class="st-link st-quit" id="st-quit">That&rsquo;s enough for now</button>');
        el('st-quit').onclick = summary;
        el('st-reveal').onclick = function () {
          el('st-a').hidden = false;
          el('st-act').innerHTML =
            '<button class="st-btn st-g1" id="g1">Missed <kbd>1</kbd></button>' +
            '<button class="st-btn st-g3" id="g3">Got it <kbd>3</kbd></button>';
          el('g1').onclick = function () { grade(c.id, 1); seen++; step(); };
          el('g3').onclick = function () { grade(c.id, 3); seen++; got++; step(); };
          keyHandler(function (k) {
            if (k === '1') { el('g1').onclick(); return true; }
            if (k === '3' || k === ' ') { el('g3').onclick(); return true; }
          });
        };
        keyHandler(function (k) { if (k === ' ' || k === 'Enter') { el('st-reveal').onclick(); return true; } });
      }
    }
    function summary() {
      keyHandler(null);
      render('<div class="st-card st-summary"><div class="st-chip">Deep Study</div>' +
        '<div class="st-q">' + got + ' of ' + seen + ' solid.</div>' +
        '<p class="st-sub">Every answer here also updated your spaced schedule — what you nailed stretches out, what you missed shows up in tomorrow’s Daily Review.</p>' +
        '<div class="st-actions"><button class="st-btn st-btn-reveal" id="st-home">Back to dashboard</button></div></div>');
      el('st-home').onclick = backHome;
    }
    step();
  }

  /* ---- threshold sprint (multiple choice, streak on correct) ---- */
  function viewSprint() {
    var q = shuffle(deck.thresholds.slice());
    var i = 0, streak = 0;
    function step() {
      if (i >= q.length) return done();
      var c = q[i];
      var opts = mcqOptions(c, deck.thresholds) || [c.a];
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
          var bk = +b.getAttribute('data-k');
          if (opts[bk] === c.a) b.classList.add('st-opt-right');
          else if (bk === k) b.classList.add('st-opt-wrong');
          b.disabled = true;
        });
        if (right) { streak++; if (streak > (S.sprint.best || 0)) { S.sprint.best = streak; save(); } }
        else streak = 0;
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
      render('<div class="st-card st-summary"><div class="st-chip">Threshold Sprint</div>' +
        '<div class="st-q">Best streak: ' + (S.sprint.best || 0) + '</div>' +
        '<p class="st-sub">Numbers rot fastest — sprint a few times a week and the board can’t rattle you with a dollar figure.</p>' +
        '<div class="st-actions"><button class="st-btn st-btn-reveal" id="st-home">Back to dashboard</button></div></div>');
      el('st-home').onclick = backHome;
    }
    step();
  }

  /* ---- board sim (out loud, with hints) ---- */
  function boardHints(sc) { // a ladder: each hint gives away a little more
    var h = [];
    h.push('Open the way you would at the board: name the framework, name who you\'d call, state the default rule before any exception.');
    var tops = sc.topics && sc.topics.length ? sc.topics.join(' · ') : null;
    if (tops) h.push('Framework(s) in play: ' + tops + '.');
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
      if (sc.key_moves && sc.key_moves.length > 1) h.push('And then: ' + sc.key_moves[1]);
    }
    return h;
  }
  function viewBoard() {
    var pool = deck.scenarios.slice();
    var fresh = pool.filter(function (s) { return !S.scen[s.id]; });
    var sc = (fresh.length ? shuffle(fresh) : shuffle(pool))[0];
    var stage = 0; // 0 scenario, 1 debrief, 2+ follow-ups
    var fus = sc.follow_ups || [];
    var hints = boardHints(sc), hintsShown = 0;
    function step() {
      var body = '<div class="st-chip">Board Sim' + (sc.topics && sc.topics.length && stage > 0 ? ' · ' + esc(sc.topics.join(' · ')) : '') + '</div>';
      if (stage === 0) {
        body = '<div class="st-chip">Board Sim</div>' +
          '<div class="st-scenario">' + esc(sc.scenario) + '</div>' +
          '<p class="st-outloud">Answer <b>out loud</b> — name the framework, name your help, walk it. Stuck? Take a hint.</p>' +
          '<div id="st-hints"></div>' +
          '<div class="st-actions"><button class="st-btn st-btn-hint" id="st-hint">Hint <span class="st-hint-n">' + (hints.length - hintsShown) + '</span></button>' +
          '<button class="st-btn st-btn-reveal" id="next">Reveal the debrief <kbd>space</kbd></button></div>';
      } else if (stage === 1) {
        var d = '';
        if (sc.facts) {
          d = sc.facts.map(function (f) {
            var v = f.verdict === 'bait' ? '<span class="st-bait">bait</span>' : '<span class="st-gov">governs</span>';
            return '<div class="st-fact"><b>' + esc(f.fact) + '</b> ' + v + '<div>' + esc(f.why) + '</div></div>';
          }).join('');
          if (sc.board_answer) d += '<div class="st-boardans"><b>Board-ready answer:</b> ' + esc(sc.board_answer) + '</div>';
        } else if (sc.frameworks) {
          d = '<div class="st-fact"><b>Frameworks in play</b><div>' + sc.frameworks.map(function (f) { return esc(typeof f === 'string' ? f : f.framework + ' — ' + f.why); }).join('<br>') + '</div></div>';
          if (sc.baits) d += '<div class="st-fact"><b>The bait</b> <span class="st-bait">bait</span><div>' + sc.baits.map(esc).join('<br>') + '</div></div>';
          if (sc.key_moves) d += '<div class="st-fact"><b>Key moves</b> <span class="st-gov">governs</span><div>' + sc.key_moves.map(esc).join('<br>') + '</div></div>';
        }
        body += '<div class="st-scenario st-scenario-sm">' + esc(sc.scenario) + '</div>' + d +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">' + (fus.length ? 'The panel follows up… <kbd>space</kbd>' : 'Grade yourself') + '</button></div>';
      } else if (stage - 2 < fus.length) {
        var k = stage - 2;
        body += '<div class="st-followup"><span>Panel follow-up ' + (k + 1) + ' of ' + fus.length + '</span><div class="st-q">' + esc(fus[k]) + '</div></div>' +
          '<p class="st-outloud">Answer out loud, then continue.</p>' +
          '<div class="st-actions"><button class="st-btn st-btn-reveal" id="next">' + (k + 1 < fus.length ? 'Next follow-up <kbd>space</kbd>' : 'Grade yourself') + '</button></div>';
      } else {
        body += '<div class="st-q">How did the whole exchange go?</div>' +
          '<div class="st-actions">' +
          '<button class="st-btn st-g1" id="g1">Rough <kbd>1</kbd></button>' +
          '<button class="st-btn st-g2" id="g2">Getting there <kbd>2</kbd></button>' +
          '<button class="st-btn st-g3" id="g3">Board-ready <kbd>3</kbd></button></div>';
      }
      render('<div class="st-session-head"><span>Board Sim</span><span>&nbsp;</span></div><div class="st-card" aria-live="polite">' + body + '</div>' +
        '<button class="st-link st-quit" id="st-quit">Back to dashboard</button>');
      el('st-quit').onclick = backHome;
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
      if (el('next')) {
        el('next').onclick = function () { stage++; step(); };
        keyHandler(function (k) { if (k === ' ' || k === 'Enter') { stage++; step(); return true; } });
      } else {
        ['g1', 'g2', 'g3'].forEach(function (id, gi) {
          el(id).onclick = function () { S.scen[sc.id] = gi + 1; save(); keyHandler(null); viewBoard(); };
        });
        keyHandler(function (k) { if (k === '1' || k === '2' || k === '3') { S.scen[sc.id] = +k; save(); keyHandler(null); viewBoard(); return true; } });
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
      viewTrack();
    }).catch(function () {
      app.innerHTML = '<p class="st-sub">Couldn’t load the question deck — check your connection and refresh. (Once loaded once, it works offline.)</p>';
    });
  });
})();
