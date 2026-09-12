const m = require(process.argv[2]);
const calls = [
  ['renderStudyPage', []], ['render48ConsPage', []], ['renderSourceSelectionPage', []],
  ['renderLibraryPage', []], ['renderDeviationsPage', []], ['renderChangesPage', []],
  ['renderExplainerPage', []], ['renderSlipPage', []], ['renderNotFoundPage', []],
  ['renderHubPage', ['rfo']], ['renderPartPage', ['rfo', '1']], ['renderSitemap', []],
];
const bad = [];
for (const [fn, args] of calls) {
  if (typeof m[fn] !== 'function') { bad.push(`${fn}: not exported`); continue; }
  try {
    const out = m[fn](...args);
    if (typeof out !== 'string' || out.length < 200) bad.push(`${fn}: returned ${typeof out} len ${out && out.length}`);
  } catch (e) { bad.push(`${fn}: ${e.message}`); }
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log('ok');
