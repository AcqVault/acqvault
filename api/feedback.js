const { enforce } = require('./_ratelimit');

// Same-origin feedback relay. The browser only ever talks to acqvault.com (CAC-safe —
// locked-down .mil networks that block third-party form endpoints still work); this
// function forwards the message to Web3Forms server-side, where the access key lives.
//
// SETUP (one-time, owner): create a free form at https://web3forms.com (enter the email
// you want feedback delivered to), copy the Access Key, and set it as the env var
// WEB3FORMS_ACCESS_KEY in Vercel. Until that's set, submissions fail HONESTLY (503) —
// the UI never claims a message was delivered when it wasn't.

const WEB3FORMS_URL = 'https://api.web3forms.com/submit';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Feedback is infrequent — keep the limit tight to deter abuse.
  if (await enforce(req, res, { max: 5 })) return;

  const body = req.body || {};
  const message = clean(body.message, 5000);
  const name = clean(body.name, 120) || 'Anonymous';
  const email = clean(body.email, 200);

  if (!message) return res.status(400).json({ error: 'A message is required.' });
  if (email && !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'That email looks off — fix it or leave it blank.' });
  }

  const accessKey = process.env.WEB3FORMS_ACCESS_KEY;
  if (!accessKey) {
    // Never pretend it was delivered. (Owner: set WEB3FORMS_ACCESS_KEY in Vercel.)
    return res.status(503).json({
      configured: false,
      error: 'Feedback isn’t switched on yet — please try again soon.'
    });
  }

  try {
    const upstream = await fetch(WEB3FORMS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.assign(
        {
          access_key: accessKey,
          subject: 'AcqVault feedback',
          from_name: 'AcqVault feedback',
          name: name,
          message: message,
          page: clean(req.headers && req.headers.referer, 300)
        },
        email ? { email: email } : {} // Web3Forms uses this as reply-to when present
      ))
    });
    const data = await upstream.json().catch(function () { return {}; });
    if (!upstream.ok || data.success === false) {
      const msg = (data && (data.message || data.error)) || ('delivery service HTTP ' + upstream.status);
      return res.status(502).json({ error: 'Could not deliver right now (' + msg + ').' });
    }
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the feedback service — please try again.' });
  }
};
