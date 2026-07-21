/* AcqVault — Source Selection Simulator engine.
   Ported from a colleague's warrant-prep exercise, rebuilt on the live DoD SSP.
   Self-paced (no timers), same-tab citations, and session persistence so that
   clicking a citation — the whole point — never destroys the run.
   Data + every citation are gated by scripts/check_sim_citations.py before ship. */
(function () {
  'use strict';

  var KEY = 'acqvault_ssim', VER = 1;
  var scen = null, S = null, modalOpen = false;
  var app = document.getElementById('ssim-app');
  if (!app) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }

  function fresh() { return { ver: VER, started: false, done: false, i: 0, risk: 0, strategy: '', locked: false, picks: {} }; }
  function load() { try { var r = JSON.parse(localStorage.getItem(KEY)); if (r && r.ver === VER) return r; } catch (e) {} return null; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function reset() { S = fresh(); save(); render(); }

  var IC_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/></svg>';
  var IC_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function meter(r) {
    if (r < 3) return { c: 'ss-m-low', t: 'Protest risk · low' };
    if (r < 6) return { c: 'ss-m-mod', t: 'Protest risk · moderate' };
    return { c: 'ss-m-high', t: 'Protest risk · high' };
  }

  /* ---- grading ---- */
  function grade(phase, v) {
    if (phase.grading === 'ssdd') {
      var key = v + '_' + (S.strategy || 'tradeoff');
      var map = {
        aerodyne_tradeoff: { risk: 0, tone: 'good' },
        aerodyne_lpta: { risk: 6, tone: 'bad' },
        globaltech_tradeoff: { risk: 2, tone: 'warn' },
        globaltech_lpta: { risk: 0, tone: 'good' }
      };
      var g = map[key] || { risk: 0, tone: 'good' };
      g.msg = phase.feedback[key]; g.key = key; return g;
    }
    var opt = phase.options.filter(function (o) { return o.v === v; })[0] || {};
    if (opt.correct) return { risk: 0, tone: 'good', msg: phase.feedback[v] };
    return { risk: opt.risk || 0, tone: 'bad', msg: phase.feedback[v] };
  }

  /* ---- brief / start screen ---- */
  function pill(rating) {
    // Colors track the DoD SSP Table 2A key: Outstanding=blue, Acceptable=green,
    // Marginal=yellow, Unacceptable=red. Red is reserved for Unacceptable, never Marginal.
    var map = { Outstanding: 'ss-pill-o', Good: 'ss-pill-o', Acceptable: 'ss-pill-g', Marginal: 'ss-pill-y', Unacceptable: 'ss-pill-m' };
    return '<span class="ss-pill ' + (map[rating] || 'ss-pill-g') + '">' + esc(rating) + '</span>';
  }
  function renderStart() {
    var rows = scen.offerors.map(function (o) {
      return '<tr><td><span class="ss-off-name">' + esc(o.name) + '</span><small>' + esc(o.note) + '</small></td>' +
        '<td>' + pill(o.tech) + '</td><td>' + esc(o.risk) + '</td><td>' + esc(o.pp) + '</td>' +
        '<td><b>' + esc(o.priceFinal !== '—' ? o.priceFinal : o.priceInitial) + '</b>' +
        (o.priceFinal !== '—' ? '<small>from ' + esc(o.priceInitial) + '</small>' : '<small>eliminated</small>') + '</td></tr>';
    }).join('');
    var train = scen.trainingNote ? '<div class="ss-startnote"><span class="ss-startnote-ic" aria-hidden="true">i</span><span>' + esc(scen.trainingNote) + '</span></div>' : '';
    app.innerHTML =
      '<div class="ss-card"><div class="ss-eyebrow">The requirement</div>' +
      '<h2 class="ss-h2">' + esc(scen.title) + '</h2>' +
      train +
      '<p class="ss-hat">' + esc(scen.role) + '</p>' +
      '<div class="ss-meta"><span class="ss-tag">' + esc(scen.value) + '</span><span class="ss-tag">' + esc(scen.type) + '</span><span class="ss-tag">9 decisions · untimed</span></div>' +
      '<div class="ss-off-wrap"><table class="ss-off"><thead><tr><th>Offeror</th><th>Technical</th><th>Risk</th><th>Past perf.</th><th>Evaluated price</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="ss-note">' + esc(scen.ratingNote) + ' <a class="ss-cite-src" href="' + esc(scen.ratingCite.u) + '">' + IC_ARROW + esc(scen.ratingCite.t) + '</a></p>' +
      '<p class="ss-note" style="border-top:none;padding-top:2px">' + esc(scen.sourceNote) + '</p>' +
      '<div class="ss-actions"><button class="ss-btn ss-btn-primary" id="ss-begin">Begin the source selection ' + IC_ARROW + '</button></div></div>';
    el('ss-begin').onclick = begin;
    el('ss-begin').focus();
  }

  /* ---- a phase ---- */
  function renderPhase() {
    var phase = scen.phases[S.i], m = meter(S.risk);
    var locked = S.locked, pick = S.picks[S.i];

    var docChips = '<div class="ss-docs"><span class="ss-doc-lab">Read the record</span>' +
      phase.docs.map(function (k) {
        var d = scen.documents[k]; if (!d) return '';
        return '<button class="ss-doc-chip" data-doc="' + esc(k) + '" type="button">' + IC_DOC + d.title + '</button>';
      }).join('') + '</div>';

    var opts = '<div class="ss-opts" role="radiogroup" aria-label="' + esc(phase.prompt) + '">' +
      phase.options.map(function (o) {
        var cls = 'ss-opt', mark = '';
        var checked = pick && pick.v === o.v;
        if (locked) {
          cls += ' locked';
          if (checked) {
            var t = pick.tone; // good | warn | bad
            cls += t === 'good' ? ' picked-right' : (t === 'warn' ? ' picked-warn' : ' picked-wrong');
            var mk = t === 'good' ? { c: 'ok', x: '✓', l: 'Your call — sound' }
                   : (t === 'warn' ? { c: 'warn', x: '!', l: 'Your call — risky' }
                   : { c: 'no', x: '✗', l: 'Your call — adds risk' });
            mark = '<span class="ss-opt-mark ' + mk.c + '">' + mk.x + ' ' + mk.l + '</span>';
          }
        }
        return '<label class="' + cls + (checked ? ' sel' : '') + '">' +
          '<input type="radio" name="ss-opt" value="' + esc(o.v) + '"' + (checked ? ' checked' : '') + (locked ? ' disabled' : '') + '>' +
          '<span class="ss-opt-txt">' + esc(o.label) + '</span>' + mark + '</label>';
      }).join('') + '</div>';

    var tail;
    if (!locked) {
      tail = '<div class="ss-actions"><button class="ss-btn ss-btn-primary" id="ss-lock">Lock decision</button></div>';
    } else {
      var g = grade(phase, pick.v);
      var toneCls = g.tone === 'good' ? 'ss-fb-good' : (g.tone === 'warn' ? 'ss-fb-warn' : 'ss-fb-bad');
      var head = g.tone === 'good' ? 'Sound call' : (g.tone === 'warn' ? 'Defensible — but risky' : 'That adds protest risk');
      var riskLine = pick.risk > 0 ? ' <b>+' + pick.risk + ' risk</b>' : '';
      var cites = '<div class="ss-cite">' +
        phase.cites.map(function (c) { return '<p class="ss-cite-q">“' + esc(c.quote) + '”</p>'; }).join('') +
        uniqLinks(phase.cites).map(function (c) {
          return '<a class="ss-cite-src" href="' + esc(c.u) + '">' + IC_ARROW + esc(c.t) + '</a>';
        }).join(' ') + '</div>';
      var last = S.i === scen.phases.length - 1;
      tail = '<div class="ss-fb ' + toneCls + '"><div class="ss-fb-head">' + esc(head) + riskLine + '</div>' + esc(g.msg) + cites + '</div>' +
        '<div class="ss-actions"><button class="ss-btn ss-btn-primary" id="ss-next">' + (last ? 'See the outcome' : 'Next phase') + ' ' + IC_ARROW + '</button></div>';
    }

    app.innerHTML =
      '<div class="ss-rail"><div class="ss-rail-top"><span>Phase ' + phase.n + ' of ' + scen.phases.length + ' · ' + esc(phase.title) + '</span>' +
      '<span class="ss-meter ' + m.c + '"><span class="ss-meter-dot"></span>' + m.t + ' (' + S.risk + ')</span></div>' +
      '<div class="ss-prog"><span style="width:' + Math.round((S.i + (locked ? 1 : 0)) / scen.phases.length * 100) + '%"></span></div></div>' +
      '<div class="ss-card"><div class="ss-eyebrow">' + esc(phase.hat) + '</div><h2 class="ss-prog-title" tabindex="-1" id="ss-ptitle">' + esc(phase.title) + '</h2>' +
      docChips +
      '<p class="ss-prompt">' + esc(phase.prompt) + '</p>' + opts + tail + '</div>' +
      '<div class="ss-actions" style="margin-top:14px"><button class="ss-btn ss-btn-ghost" id="ss-reset" type="button" style="font-size:13px;padding:8px 14px;min-height:38px">Start over</button></div>';

    var chips = app.querySelectorAll('.ss-doc-chip');
    for (var i = 0; i < chips.length; i++) chips[i].onclick = function () { openDoc(this.getAttribute('data-doc'), this); };
    var radios = app.querySelectorAll('input[name="ss-opt"]');
    for (var j = 0; j < radios.length; j++) radios[j].addEventListener('change', function () {
      var labels = app.querySelectorAll('.ss-opt');
      for (var k = 0; k < labels.length; k++) labels[k].classList.remove('sel');
      if (this.checked) this.closest('.ss-opt').classList.add('sel');
    });
    if (el('ss-lock')) el('ss-lock').onclick = lock;
    if (el('ss-next')) el('ss-next').onclick = next;
    el('ss-reset').onclick = function () { if (confirm('Start the source selection over from the beginning?')) reset(); };
    // Move focus into the new phase on every render (not just the locked state) so
    // keyboard/SR users aren't dumped back to the document top after each transition.
    if (el('ss-ptitle')) el('ss-ptitle').focus();
  }

  function uniqLinks(cites) {
    var seen = {}, out = [];
    cites.forEach(function (c) { if (!seen[c.u]) { seen[c.u] = 1; out.push(c); } });
    return out;
  }

  /* ---- verdict ---- */
  function renderVerdict() {
    var v = scen.verdicts.filter(function (x) {
      return (x.max != null && S.risk <= x.max) || (x.min != null && S.risk >= x.min);
    })[0] || scen.verdicts[scen.verdicts.length - 1];
    var toneCls = v.tone === 'good' ? 'ss-verdict-good' : (v.tone === 'warn' ? 'ss-verdict-warn' : 'ss-verdict-bad');

    var log = scen.phases.map(function (ph, idx) {
      var p = S.picks[idx]; if (!p) return '';
      var chosen = ph.options.filter(function (o) { return o.v === p.v; })[0] || { label: p.v };
      var rowCls = p.tone === 'good' ? 'ss-log-ok' : (p.tone === 'warn' ? 'ss-log-warn' : 'ss-log-bad');
      var glyph = p.tone === 'good' ? '✓' : (p.tone === 'warn' ? '!' : '✗');
      return '<div class="ss-log-row ' + rowCls + '"><span class="ss-log-mark">' + glyph + '</span>' +
        '<span class="ss-log-txt"><b>Phase ' + ph.n + ' · ' + esc(ph.title) + '</b> — ' + esc(chosen.label) + '</span>' +
        '<span class="ss-log-risk' + (p.risk > 0 ? '' : ' zero') + '">' + (p.risk > 0 ? '+' + p.risk : 'clean') + '</span></div>';
    }).join('');

    app.innerHTML =
      '<div class="ss-verdict ' + toneCls + '"><h2 tabindex="-1" id="ss-vhead">' + esc(v.headline) + '</h2><p>' + esc(v.body) + '</p>' +
      '<div class="ss-score">Total accumulated protest risk <b>' + S.risk + '</b></div></div>' +
      '<div class="ss-log"><div class="ss-log-cap">Your decision log</div>' + log + '</div>' +
      '<div class="ss-actions"><button class="ss-btn ss-btn-primary" id="ss-again">Run it again ' + IC_ARROW + '</button>' +
      '<a class="ss-btn ss-btn-ghost" href="/ssp" style="text-decoration:none;display:inline-flex;align-items:center">Read the DoD SSP</a>' +
      '<a class="ss-btn ss-btn-ghost" href="/study" style="text-decoration:none;display:inline-flex;align-items:center">Back to Study</a></div>';
    el('ss-again').onclick = reset;
    if (el('ss-vhead')) el('ss-vhead').focus();
  }

  /* ---- document modal ---- */
  var lastTrigger = null;
  function openDoc(k, trigger) {
    if (modalOpen) return;                 // never stack a second modal
    var d = scen.documents[k]; if (!d) return;
    modalOpen = true;
    lastTrigger = trigger || document.activeElement;
    // Give any wide record table its own horizontal scroll so it can't blow out
    // the modal on a phone.
    var htmlBody = d.html
      .replace(/<table class='dod-table'>/g, "<div class='ss-tscroll'><table class='dod-table'>")
      .replace(/<\/table>/g, '</table></div>');
    var m = document.createElement('div');
    m.className = 'ss-modal'; m.id = 'ss-modal';
    m.innerHTML = '<div class="ss-modal-card" role="dialog" aria-modal="true" aria-label="Source selection document (training scenario)">' +
      '<div class="ss-modal-head"><h3>' + d.title + '</h3><button class="ss-modal-close" id="ss-mclose" type="button" aria-label="Close document">✕</button></div>' +
      '<div class="ss-doc"><div class="ss-train">Training · fictional record</div>' + htmlBody + '</div></div>';
    document.body.appendChild(m);
    document.body.style.overflow = 'hidden';
    m.addEventListener('click', function (e) { if (e.target === m) closeDoc(); });
    el('ss-mclose').addEventListener('click', closeDoc);
    // Focus trap: keep Tab inside the dialog (aria-modal must mean what it says).
    m.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = m.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])');
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    el('ss-mclose').focus();
  }
  function closeDoc() {
    var m = el('ss-modal'); if (m) m.parentNode.removeChild(m);
    document.body.style.overflow = ''; modalOpen = false;
    if (lastTrigger && lastTrigger.focus) { try { lastTrigger.focus(); } catch (e) {} }
    lastTrigger = null;
  }

  /* ---- transitions ---- */
  function begin() { S.started = true; S.i = 0; S.locked = false; save(); render(); }
  function lock() {
    var phase = scen.phases[S.i];
    var sel = document.querySelector('input[name="ss-opt"]:checked');
    if (!sel) { var b = el('ss-lock'); if (b) { b.textContent = 'Pick a decision first'; setTimeout(function () { if (el('ss-lock')) el('ss-lock').textContent = 'Lock decision'; }, 1400); } return; }
    var v = sel.value;
    if (S.i === 0) S.strategy = (v === 'tradeoff') ? 'tradeoff' : 'lpta';
    var g = grade(phase, v);
    S.risk += g.risk;
    S.picks[S.i] = { v: v, risk: g.risk, tone: g.tone };
    S.locked = true; save(); render();
  }
  function next() {
    S.i++; S.locked = false;
    if (S.i >= scen.phases.length) S.done = true;
    save(); render();
  }

  function render() {
    if (S.done) return renderVerdict();
    if (S.started) return renderPhase();
    return renderStart();
  }

  /* single persistent key handler — reads live state, so no stale handlers */
  document.addEventListener('keydown', function (e) {
    if (modalOpen) { if (e.key === 'Escape') closeDoc(); return; }
    if (!scen || !S || S.done) return;
    if (S.started && S.locked && e.key === 'Enter' && document.activeElement && document.activeElement.tagName !== 'BUTTON' && document.activeElement.tagName !== 'A') {
      e.preventDefault(); next();
    }
  });

  fetch('/assets/source-selection.json?v=2')
    .then(function (r) { if (!r.ok) throw new Error('load'); return r.json(); })
    .then(function (data) {
      scen = data; S = load() || fresh();
      // Guard: if the scenario changed shape under a saved session, or the saved state is
      // malformed, start clean rather than render a missing phase. A DONE session legitimately
      // has i === phases.length, so the range check only applies mid-run (!done).
      if (S.started && (!scen.phases || typeof S.picks !== 'object' ||
          (!S.done && (typeof S.i !== 'number' || S.i >= scen.phases.length)))) S = fresh();
      render();
    })
    .catch(function () {
      app.innerHTML = '<div class="ss-fail"><h2>Couldn’t load the simulator</h2><p class="ss-sub">Refresh to try again, or explore the procedures directly in the <a href="/ssp">DoD Source Selection Procedures</a>.</p></div>';
    });
})();
