/* Blank Slip - client for /slip.
   External file because the site CSP is script-src 'self': no inline script,
   no inline handlers. Cache-busted via ?v= (assets are immutable for 30 days).

   This file never learns your own number. The server redacts it until you
   reveal, so there is nothing here to inspect, and nothing in the URL. */
(function () {
  'use strict';

  /* ============================================================
     THE TOPIC DECK
     Party material only. Nothing to do with work, and nothing that
     needs explaining to a friend at 9pm.
     ============================================================ */
  var TOPICS = [
    'how likely you are to survive a zombie apocalypse',
    'how good your music taste actually is',
    'how much of a morning person you are',
    'how likely you are to text back within an hour',
    'how well you would do on a survival show',
    'how competitive you get over board games',
    'how likely you are to cry at a Pixar movie',
    'how good you would be in a real crisis',
    'how much you would overpack for one weekend',
    'how likely you are to start a podcast',
    'how likely you are to get away with a crime',
    'how well you would do in a bar fight',
    'how likely you are to fall for a scam text',
    'how good you are at keeping a secret',
    'how likely you are to be late to your own wedding',
    'how well you would handle being famous',
    'how likely you are to survive one week alone in the woods',
    'how convincing you would be as a cult leader',
    'how well you would do on a dating show',
    'how likely you are to eat something off the floor',
    'how good your handwriting is',
    'how likely you are to win a staring contest',
    'how well you would do in a spelling bee',
    'how likely you are to adopt a third pet',
    'how dangerous you are with a karaoke microphone',
    'how likely you are to read the terms and conditions',
    'how well you would do as a getaway driver',
    'how likely you are to befriend a stranger on a plane',
    'how good you are at giving directions',
    'how likely you are to survive a horror movie',
    'how well you would do hosting a talk show',
    'how likely you are to still be up at 3am',
    'how good you would be at haggling in a market',
    'how likely you are to name a pet something ridiculous',
    'how well you would do in a cooking competition',
    'how likely you are to trust a fortune teller',
    'how good you are at pretending to like a gift',
    'how likely you are to win an argument you are wrong about',
    'how well you would do as a substitute teacher',
    'how likely you are to bring up astrology',
    'how good you would be at a heist',
    'how likely you are to laugh at the wrong moment',
    'how well you would do in a silent retreat',
    'how likely you are to go viral by accident',
    'how good you are at parallel parking',
    'how likely you are to have a conspiracy theory',
    'how well you would do stranded at an airport overnight',
    'how likely you are to give a stranger life advice',
    'how good you would be at hiding a body in a board game sense',
    'how likely you are to buy something you saw in an ad',
    'how well you would do as a wedding DJ',
    'how likely you are to hold a grudge for a decade',
    'how good you are at telling a story at a party',
    'how likely you are to survive a group project',
    'how well you would do on a jury',
    'how likely you are to break a world record for something stupid',
    'how good you would be at running a small country',
    'how likely you are to answer a phone call from an unknown number',
    'how well you would do in a dance-off',
    'how likely you are to become the fun aunt or uncle'
  ];

  var $ = function (id) { return document.getElementById(id); };
  var screens = {};
  Array.prototype.forEach.call(document.querySelectorAll('[data-screen]'), function (el) {
    screens[el.getAttribute('data-screen')] = el;
  });
  function show(name) {
    // Only scroll when the screen actually CHANGES. Re-rendering the screen
    // you are already on must never move the page under your thumb - a poll
    // lands every few seconds and someone else revealing would yank you away.
    var changing = screens[name] && screens[name].hidden;
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    var mast = document.querySelector('.masthead');
    if (mast) mast.classList.toggle('compact', name !== 'home');
    if (changing) window.scrollTo(0, 0);
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------- identity: random, local, not a login ---------- */
  var PID = lsGet('slip.pid');
  if (!PID || !/^p_[a-f0-9]{16}$/.test(PID)) {
    var buf = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    PID = 'p_' + Array.prototype.map.call(buf, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
    lsSet('slip.pid', PID);
  }

  var S = { code: null, view: null, timer: null, quietSince: 0, boardSig: null };

  /* ---------- api ---------- */
  function api(action, payload, method) {
    var url = '/api/feedback?slip=' + encodeURIComponent(action);
    var opts = { method: method || 'POST', cache: 'no-store' };
    if (opts.method === 'GET') {
      Object.keys(payload).forEach(function (k) {
        url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]);
      });
    } else {
      opts.headers = { 'Content-Type': 'application/json' };
      var body = { pid: PID };
      Object.keys(payload).forEach(function (k) { body[k] = payload[k]; });
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!j || j.ok !== true) {
          var e = new Error((j && j.msg) || 'Something went wrong.');
          e.code = j && j.err;
          throw e;
        }
        return j;
      }, function () { throw new Error('The server sent something unreadable.'); });
    }, function () {
      throw new Error('No connection. Check your signal and try again.');
    });
  }

  function fail(id, e) { var el = $(id); if (el) el.textContent = e && e.message ? e.message : String(e); }
  function clearErr(id) { var el = $(id); if (el) el.textContent = ''; }
  function busy(btn, on, label) {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working...'; }
    else if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
  }

  /* ---------- blur-bridged text swap (two strings never visibly overlap) ---------- */
  function swapText(el, text) {
    clearTimeout(el._swap);
    el.classList.add('swapping');
    el._swap = setTimeout(function () { el.textContent = text; el.classList.remove('swapping'); }, 160);
  }

  /* ============================================================
     HOME
     ============================================================ */
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  var currentTopic = pick(TOPICS);
  var customMode = false;
  $('topicText').textContent = '1-100, ' + currentTopic;

  $('shuffleTopic').addEventListener('click', function () {
    var next = currentTopic;
    while (next === currentTopic && TOPICS.length > 1) next = pick(TOPICS);
    currentTopic = next;
    customMode = false;
    $('customWrap').hidden = true;
    swapText($('topicText'), '1-100, ' + currentTopic);
  });

  $('ownTopic').addEventListener('click', function () {
    customMode = true;
    $('customWrap').hidden = false;
    $('customTheme').focus();
  });

  $('customTheme').addEventListener('input', function () {
    var v = this.value.trim();
    $('topicText').textContent = '1-100, ' + (v || '...');
  });

  function chosenTheme() {
    if (customMode) return ($('customTheme').value || '').trim();
    return currentTopic;
  }

  $('doCreate').addEventListener('click', function () {
    clearErr('createErr');
    var name = ($('hostName').value || '').trim();
    var theme = chosenTheme();
    if (!name) { fail('createErr', new Error('Put your name in first.')); $('hostName').focus(); return; }
    if (!theme) { fail('createErr', new Error('Give the number something to mean.')); $('customTheme').focus(); return; }
    var btn = this;
    busy(btn, true, 'Starting...');
    api('create', { name: name, theme: theme }).then(function (v) {
      enterRoom(v.code, v);
    }).catch(function (e) { fail('createErr', e); })
      .then(function () { busy(btn, false); });
  });

  // Codes are read aloud, so normalise hard.
  var CODE_CHARS = /[ABCDEFGHJKLMNPQRTUVWXY]/g;
  function normCode(v) {
    var m = String(v || '').toUpperCase().match(CODE_CHARS);
    return m ? m.join('').slice(0, 4) : '';
  }
  $('joinCode').addEventListener('input', function () { this.value = normCode(this.value); });

  $('doJoin').addEventListener('click', function () {
    clearErr('joinErr');
    var code = normCode($('joinCode').value);
    var name = ($('joinName').value || '').trim();
    if (code.length !== 4) { fail('joinErr', new Error('A room code is 4 letters.')); $('joinCode').focus(); return; }
    if (!name) { fail('joinErr', new Error('Put your name in first.')); $('joinName').focus(); return; }
    var btn = this;
    busy(btn, true, 'Joining...');
    api('join', { code: code, name: name }).then(function (v) {
      enterRoom(code, v);
    }).catch(function (e) { fail('joinErr', e); })
      .then(function () { busy(btn, false); });
  });

  function enterRoom(code, view) {
    S.code = code;
    lsSet('slip.room', code);
    try { history.replaceState(null, '', location.pathname + '#' + code); } catch (e) {}
    apply(view);
    startPolling();
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function apply(view) {
    if (!view) return;
    S.view = view;
    if (view.phase === 'lobby') renderLobby(view);
    else renderBoard(view);
  }

  function everyone(view) {
    // Slot order is stable and identical on every phone, so the play order
    // shown on one screen matches the play order on all the others.
    return view.players.concat([{ slot: view.you.slot, name: view.you.name, you: true }])
      .sort(function (a, b) { return a.slot - b.slot; });
  }

  function renderLobby(view) {
    $('lobbyCode').textContent = view.code;
    $('lobbyTheme').textContent = '1-100, ' + view.theme;

    var all = everyone(view);
    $('lobbyCount').textContent = all.length === 1
      ? 'Just you so far'
      : all.length + ' in the room';

    var ul = $('lobbyRoster');
    ul.textContent = '';
    all.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'hue-' + (p.slot % 8) + (p.you ? ' self' : '');
      var dot = document.createElement('span'); dot.className = 'dot';
      var who = document.createElement('span'); who.className = 'who';
      who.textContent = p.name + (p.you ? ' (you)' : '');
      li.appendChild(dot); li.appendChild(who);
      if (p.you && view.isHost) {
        var t = document.createElement('span'); t.className = 'tag'; t.textContent = 'host';
        li.appendChild(t);
      }
      ul.appendChild(li);
    });

    var enough = all.length >= 2;
    $('doDeal').hidden = !view.isHost;
    $('doDeal').disabled = !enough;
    $('doDeal').textContent = enough ? 'Deal the slips' : 'Waiting for one more';
    $('waitNote').textContent = view.isHost
      ? (enough ? "Everyone in? Deal." : 'You need at least one other player - somebody has to hold a number you can see.')
      : 'The host deals when everyone is in.';

    show('lobby');
  }

  // 100 is three digits wide and would overflow a card at the base size.
  function wide(num) { return (num != null && String(num).length >= 3) ? ' d3' : ''; }

  function renderBoard(view) {
    $('roundLabel').textContent = 'Round ' + view.round + ' · the number means';
    $('boardTheme').textContent = '1-100, ' + view.theme;
    $('roomFoot').textContent = 'Room ' + view.code;
    $('pendingBanner').hidden = !view.you.pending;

    // Jackbox keeps the code up all game so a latecomer can still join.
    var chip = $('boardCode');
    chip.hidden = false;
    chip.querySelector('b').textContent = view.code;

    var box = $('slips');
    // The deal animation should fire on a NEW ROUND, not on every poll tick -
    // otherwise the whole board re-animates each time anyone joins or reveals.
    var signature = view.round + ':' + view.players.length;
    var isNewDeal = signature !== S.boardSig;
    var roundChanged = S.boardSig && signature.split(':')[0] !== S.boardSig.split(':')[0];
    S.boardSig = signature;
    if (roundChanged) resetQuestions();
    box.className = 'slips' + (isNewDeal ? ' fresh' : '');
    box.textContent = '';

    var mine = document.createElement('div');
    mine.className = 'slip is-you hue-' + (view.you.slot % 8);
    mine.id = 'yourSlip';
    var head = document.createElement('div');
    if (view.you.num != null) { head.className = 'slip-num' + wide(view.you.num); head.textContent = view.you.num; }
    else { head.className = 'slip-blank'; head.textContent = '?'; }
    var nm = document.createElement('div');
    nm.className = 'slip-name';
    nm.textContent = view.you.name + ' - you';
    mine.appendChild(head); mine.appendChild(nm);
    box.appendChild(mine);

    view.players.slice().sort(function (a, b) {
      var an = a.num == null ? -1 : a.num, bn = b.num == null ? -1 : b.num;
      return bn - an || a.slot - b.slot;
    }).forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'slip hue-' + (p.slot % 8) + (p.num == null ? ' waiting' : '');
      var n = document.createElement('div');
      n.className = 'slip-num' + wide(p.num);
      n.textContent = (p.num == null ? '—' : p.num);
      var who = document.createElement('div');
      who.className = 'slip-name';
      who.textContent = p.name;
      el.appendChild(n); el.appendChild(who);
      if (p.revealed) {
        var tag = document.createElement('div');
        tag.className = 'slip-tag';
        tag.textContent = 'called it';
        el.appendChild(tag);
      }
      box.appendChild(el);
    });

    var order = everyone(view).map(function (p) { return p.name; });
    $('playOrder').innerHTML = '';
    var lead = document.createElement('span');
    lead.textContent = 'Play goes around in this order: ';
    $('playOrder').appendChild(lead);
    order.forEach(function (n, i) {
      if (i) $('playOrder').appendChild(document.createTextNode(' → '));
      var b = document.createElement('b'); b.textContent = n;
      $('playOrder').appendChild(b);
    });

    var canReveal = !view.you.pending && !view.you.revealed;
    $('doReveal').hidden = !canReveal;
    // The restart only appears once you have flipped your own slip - otherwise
    // the button that reshuffles EVERYONE sits right under the one you want.
    $('doAgain').hidden = $('againNote').hidden = canReveal || view.you.pending;
    renderAsk(view);
    var t = view.you.pending
      ? ['You are out this round', 'You get a number on the next deal.']
      : view.you.revealed
        ? ['You called it', 'Deal again when everyone has turned their slip.']
        : ['Ready to call it?', 'Say your guess out loud first. Then turn your slip over.'];
    $('revealHead').textContent = t[0];
    $('revealNote').textContent = t[1];

    show('board');
  }

  /* ============================================================
     ACTIONS
     ============================================================ */
  $('copyCode').addEventListener('click', function () {
    var btn = this;
    var url = location.origin + location.pathname + '#' + S.code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy the link'; }, 1600);
      }, function () { btn.textContent = url; });
    } else { btn.textContent = url; }
  });

  $('doDeal').addEventListener('click', function () {
    clearErr('lobbyErr');
    var btn = this;
    busy(btn, true, 'Dealing...');
    api('deal', { code: S.code }).then(apply)
      .catch(function (e) { fail('lobbyErr', e); })
      .then(function () { busy(btn, false); resetPolling(); });
  });

  /* ============================================================
     QUESTIONS
     A question is put to the ROOM. It appears on everyone else's phone,
     they answer yes or no, and the tally comes back. The app never states
     your number - it only tracks what the room told you, so it can hand
     you a question worth asking next.
     ============================================================ */
  var Q = { lo: 1, hi: 100, parity: null, suggested: null, resolvedFor: null, answered: 0, movedPast: null };

  function resetQuestions() {
    Q = { lo: 1, hi: 100, parity: null, suggested: null, resolvedFor: null, answered: 0, movedPast: null };
    $('qRange').hidden = true;
    $('qCard').className = 'q-card';
  }

  // Numbers you can SEE are provably not yours, so they come out of the count.
  function candidates() {
    var taken = {};
    if (S.view) S.view.players.forEach(function (p) { if (p.num != null) taken[p.num] = 1; });
    var out = [];
    for (var n = Q.lo; n <= Q.hi; n++) {
      if (taken[n]) continue;
      if (Q.parity === 'even' && n % 2) continue;
      if (Q.parity === 'odd' && n % 2 === 0) continue;
      out.push(n);
    }
    return out;
  }

  function showNarrow() {
    var c = candidates(), el = $('qRange');
    if (!Q.answered) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'narrow' + (c.length === 1 ? ' solved' : '');
    el.textContent = '';
    if (!c.length) { el.textContent = 'That rules everything out - somebody answered wrong.'; return; }
    if (c.length === 1) {
      // Deliberately does NOT print the number. Working it out is the game.
      el.textContent = 'One number left. You know what it is - say it out loud.';
      return;
    }
    el.appendChild(document.createTextNode('Narrowed to '));
    var b = document.createElement('b');
    b.textContent = c[0] + '-' + c[c.length - 1];
    el.appendChild(b);
    el.appendChild(document.createTextNode(' - ' + c.length + ' still possible'));
  }

  // None of these presume the room CHOSE your number - the deal is random.
  var WILD = [
    'Would you trade numbers with me?',
    'Am I the number you would want?',
    'Is my number funnier than yours?',
    'Would you be happy with my number?',
    'Am I closer to the top or the bottom?',
    'If you had to bet on me right now, would you bet high?',
    'Is anyone here about to lie to me?'
  ];

  function suggest() {
    var view = S.view;
    if (!view) return null;
    var c = candidates();
    if (c.length <= 1) return { text: 'I think I have it - here goes.', effect: null };

    if (c.length > 6 && Q.answered > 0 && Math.random() < 0.2) {
      return { text: pick(WILD), effect: null };
    }

    // Always a number, never a person. "Am I higher than Capri?" is ambiguous
    // - higher what? - and pointless when Capri's number is on screen anyway.
    // A plain threshold is unmistakable, and the median of what is left is the
    // most informative question available.
    if (Q.parity === null && c.length <= 16 && c.length > 2) {
      return { text: 'Am I an even number?', effect: { type: 'even' } };
    }

    var mid = c[Math.floor((c.length - 1) / 2)];
    return { text: 'Is my number higher than ' + mid + '?', effect: { type: 'gt', v: mid } };
  }

  function applyAnswer(effect, yes) {
    if (!effect) return;
    if (effect.type === 'gt') {
      if (yes) Q.lo = Math.max(Q.lo, effect.v + 1);
      else Q.hi = Math.min(Q.hi, effect.v);
    } else if (effect.type === 'even') {
      Q.parity = yes ? 'even' : 'odd';
    }
    Q.answered++;
  }

  function tallyLine(ask) {
    var wrap = document.createElement('span');
    wrap.className = 'tally';
    function part(cls, text) {
      var e = document.createElement('span'); e.className = cls; e.textContent = text; wrap.appendChild(e);
    }
    part('y', ask.yes + ' yes');
    part('n', ask.no + ' no');
    if (ask.waiting) part('w', ask.waiting + ' still deciding');
    return wrap;
  }

  /* ---------- the q-card, driven by the room's open question ---------- */
  function renderAsk(view) {
    var card = $('qCard'), ask = view.ask;
    // A finished question stays on the server until someone puts up a new one.
    // Once you have moved on from it - yours resolved, or theirs answered -
    // stop showing it back to you and offer your own turn instead.
    if (ask && Q.movedPast === ask.text &&
        (ask.mine ? ask.waiting === 0 : ask.answered)) ask = null;
    card.hidden = !!view.you.pending;
    if (view.you.pending) return;

    if (!ask) {
      card.className = 'q-card';
      $('qKind').textContent = 'Your turn to ask';
      $('qAnswers').hidden = true;
      if (!Q.suggested) Q.suggested = suggest();
      $('qText').textContent = Q.suggested ? Q.suggested.text : 'Tap below for something to ask.';
      $('doPut').hidden = !Q.suggested;
      $('doAsk').hidden = false;
      $('doAsk').textContent = Q.suggested ? 'Different question' : 'Give me a question';
      showNarrow();
      return;
    }

    if (ask.mine) {
      card.className = 'q-card waiting';
      $('qText').textContent = ask.text;
      $('qAnswers').hidden = true;
      $('doPut').hidden = true;
      if (ask.waiting > 0) {
        $('qKind').textContent = 'Waiting on the room';
        $('doAsk').hidden = true;
      } else {
        $('qKind').textContent = 'The room answered';
        // Resolve once per question.
        if (Q.resolvedFor !== ask.text) {
          Q.resolvedFor = ask.text;
          if (Q.suggested && Q.suggested.effect && ask.yes !== ask.no) {
            applyAnswer(Q.suggested.effect, ask.yes > ask.no);
          } else if (ask.yes !== ask.no) {
            Q.answered++;
          }
          Q.suggested = null;
        }
        $('doAsk').hidden = false;
        $('doAsk').textContent = 'Next question';
      }
      var line = $('qRange');
      line.hidden = false;
      line.className = 'narrow';
      line.textContent = '';
      line.appendChild(tallyLine(ask));
      if (ask.waiting === 0 && ask.yes === ask.no) {
        line.appendChild(document.createTextNode(' - the room is split, that tells you nothing.'));
      }
      return;
    }

    // Somebody else is asking. This is the moment their phone is waiting on.
    card.className = 'q-card' + (ask.answered ? '' : ' incoming');
    $('qKind').textContent = ask.byName + ' is asking';
    $('qText').textContent = ask.text;
    $('qAnswers').hidden = !!ask.answered;
    $('doPut').hidden = true;
    $('doAsk').hidden = !ask.answered;
    $('doAsk').textContent = 'Ask something of my own';
    if (ask.answered) {
      var l = $('qRange');
      l.hidden = false; l.className = 'narrow'; l.textContent = '';
      l.appendChild(document.createTextNode('You answered. '));
      l.appendChild(tallyLine(ask));
    } else {
      showNarrow();
    }
  }

  $('doAsk').addEventListener('click', function () {
    if (!S.view) return;
    var ask = S.view.ask;
    if (ask && ask.mine && ask.waiting === 0) Q.movedPast = ask.text;
    if (ask && !ask.mine && ask.answered) Q.movedPast = ask.text;
    Q.suggested = suggest();
    renderAsk(S.view);
  });

  $('doPut').addEventListener('click', function () {
    if (!S.view || !Q.suggested) return;
    var btn = this;
    busy(btn, true, 'Asking...');
    api('ask', { code: S.code, text: Q.suggested.text }).then(function (v) {
      apply(v);
      resetPolling();
    }).catch(function (e) { fail('boardErr', e); })
      .then(function () { busy(btn, false); });
  });

  function sendAnswer(yes) {
    var y = $('ansYes'), n = $('ansNo');
    y.disabled = n.disabled = true;
    api('answer', { code: S.code, yes: yes }).then(function (v) {
      apply(v);
      resetPolling();
    }).catch(function (e) { fail('boardErr', e); })
      .then(function () { y.disabled = n.disabled = false; });
  }
  $('ansYes').addEventListener('click', function () { sendAnswer(true); });
  $('ansNo').addEventListener('click', function () { sendAnswer(false); });

  $('doReveal').addEventListener('click', function () {
    clearErr('boardErr');
    var btn = this;
    busy(btn, true, 'Turning...');
    api('reveal', { code: S.code }).then(function (v) {
      S.view = v;
      var slip = $('yourSlip');
      if (slip && v.you.num != null) {
        slip.classList.add('flipping');
        // Swap the face at the midpoint, while the paper is edge-on.
        setTimeout(function () {
          var blank = slip.querySelector('.slip-blank');
          if (blank) {
            var d = document.createElement('div');
            d.className = 'slip-num';
            d.textContent = v.you.num;
            slip.replaceChild(d, blank);
          }
        }, 210);
        // Re-render once the flip has finished, so the panel picks up its
        // "You called it" state now rather than waiting for the next poll.
        // boardSig is unchanged, so the cards do not re-animate.
        setTimeout(function () {
          slip.classList.remove('flipping');
          apply(S.view);
        }, 500);
      } else {
        apply(S.view);
      }
      btn.hidden = true;
      resetPolling();
    }).catch(function (e) { fail('boardErr', e); })
      .then(function () { busy(btn, false); });
  });

  $('doAgain').addEventListener('click', function () {
    clearErr('boardErr');
    var btn = this;
    busy(btn, true, 'Dealing...');
    var cur = S.view && S.view.theme, next = pick(TOPICS);
    while (next === cur && TOPICS.length > 1) next = pick(TOPICS);
    api('deal', { code: S.code, theme: next }).then(function (v) {
      apply(v);
      resetQuestions();
    }).catch(function (e) { fail('boardErr', e); })
      .then(function () { busy(btn, false); resetPolling(); });
  });

  function leave() {
    var code = S.code;
    stopPolling();
    lsDel('slip.room');
    S.code = null; S.view = null;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    show('home');
    if (code) api('leave', { code: code }).catch(function () {});
  }
  $('doLeave').addEventListener('click', leave);
  $('doLeaveLobby').addEventListener('click', leave);

  /* ============================================================
     POLLING
     One GET per tick. The server answers {same:true} in ~30 bytes when
     nothing has changed, so an idle room is nearly free.
     ============================================================ */
  var BASE = { lobby: 3000, play: 6000, done: 10000 };
  var HARD_STOP = 30 * 60 * 1000;

  function baseInterval() {
    // A question on the table is the one thing everyone is actively waiting
    // on, so poll hard while one is open and relax again once it resolves.
    var a = S.view && S.view.ask;
    if (a && (a.waiting > 0 || !a.mine)) return 2000;
    return BASE[(S.view && S.view.phase) || 'lobby'] || 10000;
  }
  function jitter(ms) { return Math.round(ms * (0.85 + Math.random() * 0.3)); }

  // Re-arms the timer. It previously only mutated state, so an already-armed
  // tick kept the stale delay and deals landed late on other phones.
  function resetPolling() { S.quietSince = Date.now(); schedule(); }

  function schedule() {
    if (S.timer) clearTimeout(S.timer);
    // A long-abandoned but still-visible tab drops to a slow beat rather than
    // dying outright, so there is always a way back without a reload.
    var quiet = Date.now() - S.quietSince > HARD_STOP;
    S.timer = setTimeout(tick, jitter(quiet ? 60000 : baseInterval()));
  }

  function tick() {
    if (!S.code) return;
    if (document.visibilityState !== 'visible') { schedule(); return; }

    var v = S.view ? S.view.v : -1;
    api('state', { code: S.code, pid: PID, v: v }, 'GET').then(function (res) {
      if (!res.same) { resetPolling(); apply(res); }
      schedule();
    }).catch(function (e) {
      if (e.code === 'ROOM_GONE' || e.code === 'NOT_SEATED') {
        stopPolling();
        lsDel('slip.room');
        S.code = null; S.view = null;
        try { history.replaceState(null, '', location.pathname); } catch (_e) {}
        show('home');
        fail('joinErr', e);
        return;
      }
      // A dropped poll is not worth shouting about; keep the current cadence.
      schedule();
    });
  }

  function startPolling() { resetPolling(); schedule(); }
  function stopPolling() { if (S.timer) { clearTimeout(S.timer); S.timer = null; } }

  document.addEventListener('visibilitychange', function () {
    // Phones lock constantly during a call. When someone looks back at their
    // screen the board must be current immediately, not after the next tick.
    if (document.visibilityState === 'visible' && S.code) { resetPolling(); tick(); }
  });

  /* ============================================================
     BOOT
     ============================================================ */
  (function boot() {
    var fromHash = normCode((location.hash || '').slice(1));
    var code = fromHash || normCode(lsGet('slip.room') || '');
    if (!code) { show('home'); return; }

    api('state', { code: code, pid: PID, v: -1 }, 'GET').then(function (v) {
      S.code = code;
      apply(v);
      startPolling();
    }).catch(function (e) {
      if (e.code === 'ROOM_GONE' || e.code === 'NOT_SEATED') lsDel('slip.room');
      else fail('joinErr', e);
      show('home');
      $('joinCode').value = code;
      if (fromHash) {
        // They tapped someone's link. Joining is the whole reason they are here.
        $('doJoin').textContent = 'Join room ' + code;
        $('doJoin').classList.add('btn-primary');
        $('doCreate').classList.remove('btn-primary');
        $('joinCode').scrollIntoView({ block: 'center' });
      }
      $('joinName').focus();
    });
  })();
})();
