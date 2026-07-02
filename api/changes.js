const { renderChangesPage } = require('./_seo.js');

module.exports = function handler(req, res) {
  const html = renderChangesPage();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!html) {
    res.status(404);
    return res.send('<!doctype html><meta charset="utf-8"><title>Not found — AcqVault</title><p>Page not found. <a href="/">Go to AcqVault</a>.</p>');
  }
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.send(html);
};
