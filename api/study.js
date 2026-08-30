const { renderStudyPage, renderSourceSelectionPage, render48ConsPage, renderSlipPage } = require('./_seo.js');

module.exports = function handler(req, res) {
  // /source-selection and the unlisted /48cons both ride this function (Hobby 12-function
  // cap — no new api/ file).
  const view = req.query && req.query.view;
  const html = view === 'srcsel' ? renderSourceSelectionPage()
    : view === '48cons' ? render48ConsPage()
    : view === 'slip' ? renderSlipPage()
    : renderStudyPage();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!html) {
    res.status(404);
    return res.send('<!doctype html><meta charset="utf-8"><title>Not found — AcqVault</title><p>Page not found. <a href="/">Go to AcqVault</a>.</p>');
  }
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.send(html);
};
