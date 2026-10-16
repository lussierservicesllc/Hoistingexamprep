// Serves the paid 2A-1C study tool only to signed-in users who own it.
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://hpysmmtjucxkdeupnlfr.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_pmB4juBLT_D0aqv8eT3ylw_vclFiTtS';
const PRODUCT = '2a1c';

async function getUser(token) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
  });
  if (!r.ok) return null;
  return r.json();
}

async function hasAccess(email) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY not set');
  const url = SUPABASE_URL + '/rest/v1/entitlements?select=id&product=eq.' + PRODUCT +
    '&email=eq.' + encodeURIComponent(email) + '&limit=1';
  const r = await fetch(url, { headers: { apikey: key } });
  if (!r.ok) { let b=''; try{ b=(await r.text()).slice(0,200);}catch(e){} throw new Error('entitlement lookup failed: ' + r.status + ' keylen=' + key.length + ' pre=' + key.slice(0,10) + ' ws=' + /\s/.test(key) + ' body=' + b); }
  const rows = await r.json();
  return rows.length > 0;
}

function loadTool() {
  const rel = 'netlify/private/2A1C_Study_Tool.html';
  const candidates = [
    path.join(process.env.LAMBDA_TASK_ROOT || '', rel),
    path.join(__dirname, '..', 'private', '2A1C_Study_Tool.html'),
    path.join(__dirname, rel),
    path.join(process.cwd(), rel)
  ];
  for (const p of candidates) {
    try { return fs.readFileSync(p, 'utf8'); } catch (e) { /* try next */ }
  }
  throw new Error('tool file not found');
}

exports.handler = async function (event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { statusCode: 401, body: 'Sign in required' };
  try {
    const user = await getUser(token);
    if (!user || !user.email || !user.email_confirmed_at) return { statusCode: 401, body: 'Sign in required' };
    if (!(await hasAccess(user.email.toLowerCase()))) return { statusCode: 403, body: 'No access' };
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
      body: loadTool()
    };
  } catch (err) {
    console.error('get-tool error:', err);
    return { statusCode: 500, body: 'Server error: ' + (err && err.message ? err.message : String(err)) };
  }
};
