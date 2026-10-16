// Lets a signed-in user turn an access code into account access.
const crypto = require('crypto');

const SUPABASE_URL = 'https://hpysmmtjucxkdeupnlfr.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_pmB4juBLT_D0aqv8eT3ylw_vclFiTtS';
const PRODUCT = '2a1c';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function signCode(rand, secret) {
  const h = crypto.createHmac('sha256', secret).update(rand).digest();
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[h[i] % 32];
  return s;
}
function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// returns 'static' (reusable code), 'signed' (single-use code) or null
function codeType(input) {
  const extra = (process.env.EXTRA_CODES || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (extra.indexOf(input) !== -1) return 'static';
  const m = input.match(/^HOIST-([A-HJ-NP-Z2-9]{4})-([A-HJ-NP-Z2-9]{4})-([A-HJ-NP-Z2-9]{4})$/);
  const secret = process.env.CODE_SIGNING_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  if (m && secret && safeEqual(m[2] + m[3], signCode(m[1], secret))) return 'signed';
  return null;
}
function json(status, obj) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { ok: false });
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { ok: false, error: 'signin' });
  try {
    const ur = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
    });
    if (!ur.ok) return json(401, { ok: false, error: 'signin' });
    const user = await ur.json();
    if (!user.email || !user.email_confirmed_at) return json(401, { ok: false, error: 'signin' });

    let code = '';
    try { code = String(JSON.parse(event.body || '{}').code || '').trim().toUpperCase(); } catch (e) {}
    const type = codeType(code);
    if (!type) return json(200, { ok: false, error: 'invalid' });

    const key = (process.env.SUPABASE_SECRET_KEY || '').trim();
    const H = { apikey: key, 'Content-Type': 'application/json' };
    const source = 'code:' + code;

    if (type === 'signed') {
      const used = await fetch(SUPABASE_URL + '/rest/v1/entitlements?select=email&source=eq.' + encodeURIComponent(source) + '&limit=1', { headers: H });
      const rows = await used.json();
      if (rows.length && rows[0].email !== user.email.toLowerCase()) return json(200, { ok: false, error: 'used' });
    }
    const ins = await fetch(SUPABASE_URL + '/rest/v1/entitlements?on_conflict=email,product', {
      method: 'POST',
      headers: Object.assign({ Prefer: 'resolution=ignore-duplicates,return=minimal' }, H),
      body: JSON.stringify({ email: user.email.toLowerCase(), user_id: user.id, product: PRODUCT, source: source })
    });
    if (!ins.ok) throw new Error('insert failed ' + ins.status + ' ' + await ins.text());
    return json(200, { ok: true });
  } catch (err) {
    console.error('redeem-code error:', err);
    return json(500, { ok: false, error: 'server' });
  }
};
