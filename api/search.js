module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const host = process.env.MEILI_HOST;
  const key = process.env.MEILI_SEARCH_KEY;
  const index = process.env.MEILI_INDEX || 'acqvault';

  if (!host || !key) {
    return res.status(500).json({ error: 'Search service is not configured.' });
  }

  try {
    const { action, body, id } = req.body || {};
    const base = host.replace(/\/$/, '');
    const headers = { Authorization: `Bearer ${key}` };
    let upstream;

    if (action === 'search') {
      upstream = await fetch(`${base}/indexes/${encodeURIComponent(index)}/search`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    } else if (action === 'document') {
      if (!id) return res.status(400).json({ error: 'Missing document id.' });
      upstream = await fetch(`${base}/indexes/${encodeURIComponent(index)}/documents/${encodeURIComponent(id)}`, {
        headers
      });
    } else {
      return res.status(400).json({ error: 'Unsupported search action.' });
    }

    const text = await upstream.text();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (error) {
    return res.status(500).json({ error: 'Search request failed.' });
  }
};
