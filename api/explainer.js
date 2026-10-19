const { renderExplainerPage } = require('./_seo.js');

module.exports = function handler(req, res) {
  const html = renderExplainerPage();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!html) {
    res.status(404);
    return res.send('<!doctype html><meta charset="utf-8"><title>Not found — AcqVault</title><p>Page not found. <a href="/">Go to AcqVault</a>.</p>');
  }
  res.setHeader('Vercel-CDN-Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
  return res.send(html);
};
