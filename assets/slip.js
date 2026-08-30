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
    $('doDeal').hidden = false;
    $('doDeal').disabled = !enough;
    $('doDeal').textContent = enough ? 'Deal the slips' : 'Waiting for one more';
    $('waitNote').textContent = enough
      ? 'Everyone in? Anyone can deal.'
      : 'You need at least one other player - somebody has to hold a number you can see.';

    show('lobby');
  }

  function guessLine(guess, num) {
    var off = Math.abs(guess - num);
    var d = document.createElement('div');
    d.className = 'slip-guess' + (off <= 10 ? ' close' : '');
    d.textContent = off === 0 ? 'said ' + guess + ' - exact' : 'said ' + guess + ' - ' + off + ' off';
    return d;
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

    $('playOrder').hidden = over;
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
    if (view.phase === 'done' && view.you.guess != null && view.you.num != null) {
      mine.appendChild(guessLine(view.you.guess, view.you.num));
    }
    box.appendChild(mine);

    // Seat order, not number order. Sorting by number turns the board into a
    // standing, and contradicts the play-order line printed right beneath it.
    view.players.slice().sort(function (a, b) { return a.slot - b.slot; }).forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'slip hue-' + (p.slot % 8) + (p.num == null ? ' waiting' : '');
      var n = document.createElement('div');
      n.className = 'slip-num' + wide(p.num);
      n.textContent = (p.num == null ? '—' : p.num);
      var who = document.createElement('div');
      who.className = 'slip-name';
      who.textContent = p.name;
      el.appendChild(n); el.appendChild(who);
      if (view.phase === 'done' && p.guess != null && p.num != null) {
        el.appendChild(guessLine(p.guess, p.num));
      } else if (p.revealed) {
        var tag = document.createElement('div');
        tag.className = 'slip-tag';
        tag.textContent = 'locked in';
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

    var over = view.phase === 'done';
    var canGuess = !view.you.pending && !view.you.revealed;
    $('doReveal').hidden = !canGuess;
    $('guessRow').hidden = !canGuess;
    // Anyone can start the next round - but only once you have committed, so
    // the button that reshuffles EVERYONE never sits under the one you want.
    var mayDeal = canGuess || view.you.pending;
    if (over) {
      if (!S.doneSince) S.doneSince = Date.now();
      var stale = Date.now() - S.doneSince > 30000;
      mayDeal = !(S.worstIsMe || stale);
      $('doAgain').textContent = S.worstIsMe
        ? 'Deal - you were furthest off, so it is on you'
        : 'Deal anyway';
      $('againNote').textContent = S.worstIsMe || stale || !S.worstName
        ? 'Everyone gets a new number and a new topic.'
        : S.worstName + ' deals.';
    } else {
      S.doneSince = 0;
      $('doAgain').textContent = 'New round, new topic';
      $('againNote').textContent = "Everyone's slip goes blank and the numbers are reshuffled.";
    }
    $('doAgain').hidden = $('againNote').hidden = mayDeal;
    renderAsk(view);

    var waitingOn = view.players.filter(function (p) {
      return p.seated && p.num != null && !p.revealed;
    }).length;

    var t;
    if (view.you.pending) {
      t = ['You are out this round', 'You get a number on the next deal.'];
    } else if (over) {
      t = ['Round over', 'Every slip is face up. Deal again when you are ready.'];
    } else if (view.you.revealed) {
      t = ['You said ' + view.you.guess,
           waitingOn === 1 ? 'Waiting on one more to commit.'
                           : 'Waiting on ' + waitingOn + ' more to commit.'];
    } else {
      t = ['Ready to call it?', 'Everyone locks a guess, then every slip turns over at once.'];
    }
    $('revealHead').textContent = t[0];
    $('revealNote').textContent = t[1];

    // The result headline: who got closest. Proximity, never exact - an exact
    // win would make a 1-in-100 shot the only way to feel good.
    var rc = $('resultCard');
    rc.hidden = !over;
    if (over) {
      var all = view.players.filter(function (p) { return p.num != null && p.guess != null; })
        .map(function (p) { return { name: p.name, off: Math.abs(p.guess - p.num) }; });
      if (view.you.num != null && view.you.guess != null) {
        all.push({ name: view.you.name, off: Math.abs(view.you.guess - view.you.num), you: true });
      }
      all.sort(function (a, b) { return a.off - b.off; });
      var best = all[0], worst = all[all.length - 1];
      rc.className = 'result' + (best && best.off === 0 ? ' exact' : '');
      if (!best) {
        $('resultLine').textContent = 'Nobody committed.';
        $('resultSub').textContent = '';
      } else if (best.off === 0) {
        // A 1-in-100 has earned the headline back.
        $('resultLine').textContent = best.you ? 'You nailed it exactly.' : best.name + ' nailed it exactly.';
        $('resultSub').textContent = '';
      } else if (worst === best) {
        $('resultLine').textContent = best.you ? 'You were ' + best.off + ' off.' : best.name + ' was ' + best.off + ' off.';
        $('resultSub').textContent = '';
      } else {
        // The miss is the funny part. Lead with it.
        $('resultLine').textContent = worst.you ? 'You missed by ' + worst.off + '.'
                                                : worst.name + ' missed by ' + worst.off + '.';
        $('resultSub').textContent = (best.you ? 'You got closest' : best.name + ' got closest') + ' - ' + best.off + ' off.';
      }
      S.worstName = worst && !best ? null : (worst ? worst.name : null);
      S.worstIsMe = !!(worst && worst.you);
    }

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
     You are offered three to pick from, not handed one: the sharpest split
     the app can compute, a different angle on the same range, and something
     that is just fun to ask. Or type your own.

     A question is put to the ROOM - it lands on everyone else's phone, they
     answer yes or no, and the tally comes back. The app never states your
     number; it only tracks which candidates the room's answers have ruled
     out, so it can offer a question worth asking next.
     ============================================================ */
  var TOP = 100;

  // SHARP - threshold templates. {n} is the median of the remaining
  // candidates. Every one means exactly "greater than n" (n itself is a NO),
  // so they are interchangeable and one is picked at random for flavour.
  var SHARP = [
    'Is my number bigger than {n}?',
    'Is my number higher than {n}?',
    'Is my number greater than {n}?',
    'Is my number over {n}?',
    'Is my number above {n}?',
    'Is my number more than {n}?',
    'Does my number land above {n}?',
    'Is my number north of {n}?',
    'On a number line, is my number to the right of {n}?'
  ];

  // PROBE - fixed narrowing questions needing no computed number.
  // f(n, seen) is true when candidate n is consistent with a YES; `seen` is
  // the numbers on the other players' foreheads. Pure, total over 1..100.
  var PROBE = [
    { t: 'Is my number an even number?', f: function (n) { return n % 2 === 0; } },
    { t: 'Is my number a multiple of 5?', f: function (n) { return n % 5 === 0; } },
    { t: 'Is my number a multiple of 10?', f: function (n) { return n % 10 === 0; } },
    { t: 'Can you cut my number in half twice and still land on a whole number?', f: function (n) { return n % 4 === 0; } },
    { t: 'Does my number have a 7 in it anywhere?', f: function (n) { return String(n).indexOf('7') !== -1; } },
    { t: 'Does my number have a 3 in it anywhere?', f: function (n) { return String(n).indexOf('3') !== -1; } },
    { t: 'Is my number one of the doubles - 11, 22, 33, all the way up to 99?', f: function (n) { return n % 11 === 0; } },
    { t: 'Is my number a perfect square - 1, 4, 9, 16, 25 and so on?', f: function (n) { var r = Math.round(Math.sqrt(n)); return r * r === n; } },
    { t: 'Is my number a single digit?', f: function (n) { return n < 10; } },
    { t: 'Is my number small enough to fit on a clock face - 12 or lower?', f: function (n) { return n <= 12; } },
    { t: 'Is my number closer to 100 than to 1?', f: function (n) { return n >= 51; } },
    { t: 'If my number were an age, would I be old enough to drink - 21 or over?', f: function (n) { return n >= 21; } },
    { t: 'If my number were a test score out of 100, did I pass - 70 or higher?', f: function (n) { return n >= 70; } },
    { t: 'Am I the highest number at this table?', f: function (n, seen) { return seen.length ? n > Math.max.apply(null, seen) : false; } },
    { t: 'Am I the lowest number at this table?', f: function (n, seen) { return seen.length ? n < Math.min.apply(null, seen) : false; } }
  ];

  // SPARK - narrows nothing the app can use. These exist to make the room
  // laugh or argue, and are still strictly answerable about the number alone.
  var SPARK = [
    'If my number were the temperature outside in Fahrenheit, would you wear shorts?',
    'If my number were the percent tip I left, would you say I overtipped?',
    'If my number were the price of a sandwich in dollars, would you buy it?',
    'If my number were my phone battery percentage, would you leave the house without a charger?',
    'If my number were how many push-ups I did in a row, would you be impressed?',
    'If my number were the speed I was driving in miles per hour, would you tell me to slow down?',
    'If my number were how many minutes late I was, would you have left already?',
    'If my number were the volume on the car stereo, would you turn it down?',
    'If my number were how many people came to my party, would you call that a good turnout?',
    'If my number were the unread texts sitting on my phone, would that stress you out?',
    'If my number were an age, is it a good age to be?',
    'Would you call my number a lucky number?',
    'Does my number look like a jersey number a good player would wear?'
  ];

  var Q = { filters: [], options: null, movedPast: null, resolvedFor: null, answered: 0, own: false };

  function resetQuestions() {
    Q = { filters: [], options: null, movedPast: null, resolvedFor: null, answered: 0, own: false };
    $('qRange').hidden = true;
    $('qOwn').hidden = true;
    $('qCard').className = 'q-card';
  }

  // Numbers you can SEE are provably not yours, so they never enter the pool.
  // The numbers on the other foreheads. Provably not yours, and some questions
  // are about them ("am I the highest here?").
  function seenNumbers() {
    var out = [];
    if (S.view) S.view.players.forEach(function (p) { if (p.num != null) out.push(p.num); });
    return out;
  }

  function candidates() {
    var seen = seenNumbers(), taken = {};
    seen.forEach(function (n) { taken[n] = 1; });
    var out = [];
    for (var n = 1; n <= TOP; n++) {
      if (taken[n]) continue;
      var ok = true;
      for (var i = 0; i < Q.filters.length; i++) {
        if (Q.filters[i].test(n, seen) !== Q.filters[i].yes) { ok = false; break; }
      }
      if (ok) out.push(n);
    }
    return out;
  }

  // There is deliberately NO running "narrowed to 51-100" readout. It would be
  // a binary-search aid: it makes a solved problem pleasant to execute, which
  // is the opposite of what this game needs. The app still uses the candidate
  // set to OFFER good questions - the player does the remembering.
  function showNarrow() { $('qRange').hidden = true; }

  // How evenly a predicate splits what is left. 0 is a perfect halving.
  function imbalance(c, f, seen) {
    var yes = 0;
    for (var i = 0; i < c.length; i++) if (f(c[i], seen)) yes++;
    if (yes === 0 || yes === c.length) return 1e9;   // tells you nothing
    return Math.abs(yes - (c.length - yes));
  }

  // Three options: the sharpest split, a different angle, and something fun.
  function buildOptions() {
    var c = candidates(), seen = seenNumbers();
    var opts = [];

    if (c.length > 1) {
      var mid = c[Math.floor((c.length - 1) / 2)];
      opts.push({
        sharp: true,
        text: pick(SHARP).replace('{n}', mid),
        test: function (n) { return n > mid; }
      });

      // The probe that splits what is left most evenly, among those not asked
      // yet and that still tell you something. A little randomness across the
      // top few so the same card does not come up every round.
      var fresh = PROBE.filter(function (p) {
        return imbalance(c, p.f, seen) < 1e9 &&
               Q.filters.every(function (f) { return f.label !== p.t; });
      });
      fresh.sort(function (a, b) { return imbalance(c, a.f, seen) - imbalance(c, b.f, seen); });
      if (fresh.length) {
        var probe = fresh[Math.floor(Math.random() * Math.min(3, fresh.length))];
        opts.push({ text: probe.t, test: probe.f, label: probe.t });
      }
    }

    opts.push({ text: pick(SPARK), test: null });
    // Shuffle, or position becomes the label we just deleted.
    for (var i = opts.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    return opts;
  }

  function renderOptions() {
    var box = $('qOptions');
    box.textContent = '';
    // No eyebrow labels: "Sharpest" / "Just for fun" told the room which card
    // was the real move and which was the forfeit, before anyone chose.
    (Q.options || []).forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'q-opt';
      b.textContent = o.text;
      b.addEventListener('click', function () { putQuestion(o); });
      box.appendChild(b);
    });
  }

  function applyAnswer(opt, yes) {
    if (opt && opt.test) Q.filters.push({ test: opt.test, yes: yes, label: opt.label || opt.text });
    Q.answered++;
  }

  // A lone holdout phrased as a lone holdout is an invitation the call cannot
  // resist. A bare "5 yes 1 no" is a scoreboard nobody argues with.
  function tallyLine(ask) {
    var wrap = document.createElement('span');
    wrap.className = 'tally';
    function part(cls, text) {
      var e = document.createElement('span'); e.className = cls; e.textContent = text; wrap.appendChild(e);
    }
    if (ask.waiting) {
      if (ask.yes + ask.no) part('y', ask.yes + ' yes, ' + ask.no + ' no');
      part('w', ask.waiting + ' still deciding');
      return wrap;
    }
    if (ask.no === 0 && ask.yes > 0) part('y', ask.yes > 1 ? 'Everyone said yes.' : 'Yes.');
    else if (ask.yes === 0 && ask.no > 0) part('n', ask.no > 1 ? 'Everyone said no.' : 'No.');
    else if (ask.oddName) {
      // Naming the one holdout is the whole point - it starts the argument.
      var many = ask.oddSaid === 'no' ? ask.yes : ask.no;
      part(ask.oddSaid === 'no' ? 'y' : 'n', many + (ask.oddSaid === 'no' ? ' yes.' : ' no.'));
      part(ask.oddSaid === 'no' ? 'n' : 'y', ask.oddName + ' said ' + ask.oddSaid + '.');
    }
    else { part('y', ask.yes + ' yes'); part('n', ask.no + ' no'); }
    if (ask.sharp) part('w', 'Somebody did some maths.');
    return wrap;
  }

  function setMenu(on) {
    $('qOptions').hidden = !on;
    $('qTools').hidden = !on;
    $('qText').hidden = on;
    if (!on) $('qOwn').hidden = true;
  }

  /* ---------- the q-card, driven by the room's open question ---------- */
  function renderAsk(view) {
    var card = $('qCard'), ask = view.ask;
    card.hidden = !!view.you.pending || view.phase === 'done';
    if (card.hidden) return;

    // A finished question sits on the server until someone replaces it. Once
    // you have moved on, stop showing it back to you.
    // Keyed on id, not text: the same question can legitimately come round
    // twice, and text-keying would silently skip the second one.
    if (ask && Q.movedPast === ask.id && (ask.mine || ask.answered)) ask = null;

    if (!ask) {
      card.className = 'q-card';
      var left = view.asksLeft == null ? 4 : view.asksLeft;
      var ae = $('asksLeft');
      ae.hidden = false;
      ae.className = 'asks' + (left === 0 ? ' out' : '');
      ae.textContent = '';
      if (left === 0) {
        ae.appendChild(document.createTextNode('The room is out of questions. Everybody guess.'));
      } else {
        var bn = document.createElement('b'); bn.textContent = left;
        ae.appendChild(bn);
        ae.appendChild(document.createTextNode(left === 1 ? ' question left in the room' : ' questions left in the room'));
      }
      $('qOptions').hidden = left === 0;
      $('qTools').hidden = left === 0;
      $('qKind').textContent = left === 0 ? 'Out of questions' : 'Your turn to ask';
      $('qAnswers').hidden = true;
      if (!Q.options) Q.options = buildOptions();
      renderOptions();
      setMenu(true);
      if (Q.own) { $('qOwn').hidden = false; }
      showNarrow();
      return;
    }

    setMenu(false);

    if (ask.mine) {
      card.className = 'q-card waiting';
      $('qText').textContent = ask.text;
      $('qAnswers').hidden = true;
      // Resolve as soon as the outcome is mathematically locked - one straggler
      // who has put their phone down can no longer flip a 3-0.
      var decided = ask.waiting === 0 || Math.abs(ask.yes - ask.no) > ask.waiting;
      if (!decided) {
        $('qKind').textContent = 'Waiting on the room';
        // Always leave a way out. A phone that locked mid-question would
        // otherwise strand the asker with no control at all.
        $('qTools').hidden = false;
        $('doAsk').textContent = 'Ask something else';
      } else {
        $('qKind').textContent = 'The room answered';
        if (Q.resolvedFor !== ask.id) {
          Q.resolvedFor = ask.id;
          if (ask.yes !== ask.no) applyAnswer(Q.asked, ask.yes > ask.no);
          Q.asked = null;
          Q.options = null;
        }
        $('qTools').hidden = false;
        $('doAsk').textContent = 'Next question';
      }
      var line = $('qRange');
      line.hidden = false;
      line.className = 'narrow';
      line.textContent = '';
      line.appendChild(tallyLine(ask));
      if (decided && ask.yes === ask.no) {
        line.appendChild(document.createTextNode(' - the room is split, so that tells you nothing.'));
      }
      return;
    }

    // Somebody else is asking. This is the moment their phone waits on.
    card.className = 'q-card' + (ask.answered ? '' : ' incoming');
    $('qKind').textContent = ask.byName + ' is asking';
    $('qText').textContent = ask.text;
    $('qAnswers').hidden = !!ask.answered;
    $('qTools').hidden = !ask.answered;
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

  function putQuestion(opt) {
    if (!S.view || !opt || !opt.text) return;
    Q.asked = opt;
    api('ask', { code: S.code, text: opt.text, sharp: opt.sharp === true }).then(function (v) {
      Q.own = false;
      $('qOwn').hidden = true;
      apply(v);
      resetPolling();
    }).catch(function (e) { fail('boardErr', e); });
  }

  $('doAsk').addEventListener('click', function () {
    if (!S.view) return;
    var ask = S.view.ask;
    if (ask && (ask.mine || ask.answered)) Q.movedPast = ask.id;
    // One wrong answer can rule out every number. Without this the menu offers
    // nothing but a joke card for the rest of the round, with no way back.
    if (!candidates().length) { Q.filters = []; Q.answered = 0; }
    Q.options = buildOptions();
    Q.own = false;
    $('qOwn').hidden = true;
    renderAsk(S.view);
  });

  $('doSay').addEventListener('click', function () {
    // The call is right there. Sometimes the question does not need typing.
    putQuestion({ text: 'Look up.', test: null });
  });

  $('doOwn').addEventListener('click', function () {
    Q.own = !Q.own;
    $('qOwn').hidden = !Q.own;
    if (Q.own) $('ownQ').focus();
  });

  $('doPutOwn').addEventListener('click', function () {
    var t = ($('ownQ').value || '').trim();
    if (!t) { $('ownQ').focus(); return; }
    // A question you wrote narrows nothing automatically - the app has no idea
    // what it means, and guessing would be worse than not trying.
    putQuestion({ text: t, test: null });
    $('ownQ').value = '';
  });

  function sendAnswer(yes) {
    var y = $('ansYes'), n = $('ansNo');
    y.disabled = n.disabled = true;
    var id = S.view && S.view.ask ? S.view.ask.id : null;
    api('answer', { code: S.code, yes: yes, id: id }).then(function (v) {
      apply(v);
      resetPolling();
    }).catch(function (e) { fail('boardErr', e); })
      .then(function () { y.disabled = n.disabled = false; });
  }
  $('ansYes').addEventListener('click', function () { sendAnswer(true); });
  $('ansNo').addEventListener('click', function () { sendAnswer(false); });

  $('doReveal').addEventListener('click', function () {
    clearErr('boardErr');
    var raw = ($('guessN').value || '').trim();
    var g = Math.round(Number(raw));
    if (!raw || !isFinite(g) || g < 1 || g > 100) {
      fail('boardErr', new Error('Pick a number between 1 and 100.'));
      $('guessN').focus();
      return;
    }
    var btn = this;
    busy(btn, true, 'Locking in...');
    api('reveal', { code: S.code, guess: g }).then(function (v) {
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
