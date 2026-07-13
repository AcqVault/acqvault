const { renderHubPage, renderNotFoundPage } = require('./_seo.js');

module.exports = function handler(req, res) {
  const { source } = req.query || {};
  const html = renderHubPage(source);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!html) {
    res.status(404);
    return res.send(renderNotFoundPage());
  }
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.send(html);
};
