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
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    window.scrollTo(0, 0);
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

  var S = { code: null, view: null, timer: null, sames: 0, interval: 0, quietSince: 0 };

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
    el.classList.add('swapping');
    setTimeout(function () { el.textContent = text; el.classList.remove('swapping'); }, 160);
  }

  /* ============================================================
     HOME
     ============================================================ */
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  var currentTopic = pick(TOPICS);
  var customMode = false;
  $('topicText').textContent = '1-10, ' + currentTopic;

  $('shuffleTopic').addEventListener('click', function () {
    var next = currentTopic;
    while (next === currentTopic && TOPICS.length > 1) next = pick(TOPICS);
    currentTopic = next;
    customMode = false;
    $('customWrap').hidden = true;
    swapText($('topicText'), '1-10, ' + currentTopic);
  });

  $('ownTopic').addEventListener('click', function () {
    customMode = true;
    $('customWrap').hidden = false;
    $('customTheme').focus();
  });

  $('customTheme').addEventListener('input', function () {
    var v = this.value.trim();
    $('topicText').textContent = '1-10, ' + (v || '...');
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
    $('lobbyTheme').textContent = '1-10, ' + view.theme;

    var all = everyone(view);
    $('lobbyCount').textContent = all.length === 1
      ? 'Just you so far'
      : all.length + ' in the room';

    var ul = $('lobbyRoster');
    ul.textContent = '';
    all.forEach(function (p) {
      var li = document.createElement('li');
      if (p.you) li.className = 'self';
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

    var enough = all.length >= 3;
    $('doDeal').hidden = !view.isHost;
    $('doDeal').disabled = !enough;
    $('doDeal').textContent = enough ? 'Deal the slips' : 'Need 3 players';
    $('waitNote').textContent = view.isHost
      ? (enough ? "Everyone in? Deal." : 'The game needs 3 people minimum - you need numbers you can see.')
      : 'The host deals when everyone is in.';

    show('lobby');
  }

  function renderBoard(view) {
    $('roundLabel').textContent = 'Round ' + view.round + ' · the number means';
    $('boardTheme').textContent = '1-10, ' + view.theme;
    $('roomFoot').textContent = 'Room ' + view.code;
    $('pendingBanner').hidden = !view.you.pending;

    var box = $('slips');
    box.textContent = '';

    var mine = document.createElement('div');
    mine.className = 'slip is-you';
    mine.id = 'yourSlip';
    var head = document.createElement('div');
    if (view.you.num != null) { head.className = 'slip-num'; head.textContent = view.you.num; }
    else { head.className = 'slip-blank'; head.textContent = '?'; }
    var nm = document.createElement('div');
    nm.className = 'slip-name';
    nm.textContent = view.you.name + ' - you';
    mine.appendChild(head); mine.appendChild(nm);
    box.appendChild(mine);

    view.players.slice().sort(function (a, b) { return a.slot - b.slot; }).forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'slip' + (p.num == null ? ' waiting' : '');
      var n = document.createElement('div');
      n.className = 'slip-num';
      n.textContent = (p.num == null ? '·' : p.num);
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
    $('doAgain').hidden = !view.isHost;
    $('againNote').hidden = !view.isHost;

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

  $('doAsk').addEventListener('click', function () {
    if (!S.view) return;
    var others = S.view.players.map(function (p) { return p.name; });
    if (!others.length) others = ['someone else'];
    var o = function () { return pick(others); };
    var pools = [
      { k: 'Split the range', q: [
        'Am I above a 5?', 'Am I below a 4?', 'Am I in the top half?',
        'Am I above a 7?', 'Am I a 3 or lower?', 'Am I somewhere in the middle, 4 to 7?'
      ] },
      { k: 'Compare to a person', q: [
        'Am I higher than ' + o() + '?', 'Am I lower than ' + o() + '?',
        'Am I the highest number in the room?', 'Am I the lowest number in the room?',
        'Is ' + o() + ' the closest number to mine?'
      ] },
      { k: 'Closing in', q: ['Am I even?', 'Am I odd?', 'Am I exactly one away from ' + o() + '?'] },
      { k: 'Just for the drama', q: [
        'Would you swap your number for mine?',
        'Did anyone argue about my number?',
        'Am I higher than ' + o() + ' - and should I be?',
        'Would a stranger guess my number higher than you did?',
        'If we did this again in a year, would my number go up?',
        'Am I the number you would have given yourself?'
      ] }
    ];
    var chosen = pick(pools);
    $('qKind').textContent = chosen.k;
    swapText($('qText'), pick(chosen.q));
    this.textContent = 'Another question';
  });

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
        setTimeout(function () { slip.classList.remove('flipping'); }, 480);
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
    api('deal', { code: S.code }).then(function (v) {
      apply(v);
      $('qKind').textContent = 'Ask the room';
      $('qText').textContent = "Tap below and I'll hand you something to ask.";
      $('doAsk').textContent = 'Give me a question';
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
  var BASE = { lobby: 3000, play: 10000, done: 15000 };
  var CAP = 30000;
  var HARD_STOP = 30 * 60 * 1000;

  function baseInterval() {
    return BASE[(S.view && S.view.phase) || 'lobby'] || 10000;
  }
  function jitter(ms) { return Math.round(ms * (0.85 + Math.random() * 0.3)); }

  function resetPolling() { S.sames = 0; S.interval = baseInterval(); S.quietSince = Date.now(); }

  function schedule() {
    if (S.timer) clearTimeout(S.timer);
    S.timer = setTimeout(tick, jitter(S.interval || baseInterval()));
  }

  function tick() {
    if (!S.code) return;
    if (document.visibilityState !== 'visible') { schedule(); return; }
    if (Date.now() - S.quietSince > HARD_STOP) { stopPolling(); return; }

    var v = S.view ? S.view.v : -1;
    api('state', { code: S.code, pid: PID, v: v }, 'GET').then(function (res) {
      if (res.same) {
        S.sames++;
        // Nothing is happening; back off rather than hammer a shared key.
        if (S.sames > 10) S.interval = Math.min(CAP, Math.round(S.interval * 1.5));
      } else {
        resetPolling();
        apply(res);
      }
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
    if (document.visibilityState === 'visible' && S.code) { resetPolling(); schedule(); }
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
    }).catch(function () {
      // Not seated (or the room is gone): fall back to the join form, prefilled.
      lsDel('slip.room');
      show('home');
      $('joinCode').value = code;
      $('joinName').focus();
    });
  })();
})();
