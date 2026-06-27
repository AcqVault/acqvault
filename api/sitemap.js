const { renderSitemap } = require('./_seo.js');

module.exports = function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  return res.send(renderSitemap());
};
