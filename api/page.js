const { renderPartPage, renderNotFoundPage } = require('./_seo.js');

module.exports = function handler(req, res) {
  const { source, part } = req.query || {};
  const html = renderPartPage(source, part);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!html) {
    // Cache the miss too, or every bad/stale URL re-invokes the function on each hit.
    res.setHeader('Cache-Control', 's-maxage=3600');
    res.status(404);
    return res.send(renderNotFoundPage());
  }
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.send(html);
};
