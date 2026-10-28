/* /changes: opening the change log counts as having seen it, so the home page's
   "since your last visit" marker (polish.js, key acq-seen-v1) clears even when the
   reader arrives here directly. Records the newest run; deviations stay as they were. */
(function () {
  var el = document.getElementById('chg-latest');
  if (!el) return;
  var t = Date.parse(el.getAttribute('data-run') || '');
  if (!isFinite(t)) return;
  try {
    var seen = JSON.parse(localStorage.getItem('acq-seen-v1') || 'null') || {};
    if (!seen.run || Date.parse(seen.run) < t) {
      seen.run = new Date(t).toISOString().replace('.000Z', 'Z');   // same form polish.js writes
      localStorage.setItem('acq-seen-v1', JSON.stringify(seen));
    }
  } catch (e) { /* storage blocked: nothing to remember */ }
})();
