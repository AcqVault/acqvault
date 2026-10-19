const { renderPartPage, renderNotFoundPage } = require('./_seo.js');

module.exports = function handler(req, res) {
  const { source, part } = req.query || {};
  const html = renderPartPage(source, part);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!html) {
    // Cache the miss too, or every bad/stale URL re-invokes the function on each hit.
    res.setHeader('Vercel-CDN-Cache-Control', 's-maxage=3600');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate, no-transform');
    res.status(404);
    return res.send(renderNotFoundPage());
  }
  res.setHeader('Vercel-CDN-Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  res.setHeader('Cache-Control', 'public, max-age=600, no-transform');
  return res.send(html);
};
