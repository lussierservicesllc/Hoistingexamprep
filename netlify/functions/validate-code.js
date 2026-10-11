// ================================================================
// validate-code.js - Netlify Function
// Called by the landing page when a user enters an access code.
//
// A code is valid if EITHER:
//   1. It is listed in the EXTRA_CODES environment variable
//      (comma-separated, set in the Netlify dashboard), OR
//   2. It is a purchase code (HOIST-XXXX-XXXX-XXXX) whose signature
//      matches. stripe-webhook.js generates these and signs them with
//      CODE_SIGNING_SECRET (falls back to STRIPE_WEBHOOK_SECRET).
//
// No access codes are stored in this file.
// ================================================================

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars (0,O,1,I)

// Must stay identical to signCode() in stripe-webhook.js
function signCode(rand, secret) {
  const h = crypto.createHmac('sha256', secret).update(rand).digest();
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[h[i] % 32];
  return s;
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

exports.handler = async function (event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Bad request' };
  }

  const { code } = body || {};
  if (!code || typeof code !== 'string') {
    return {
      statusCode: 400,
      body: JSON.stringify({ valid: false, error: 'No code provided' }),
    };
  }

  const input = code.trim().toUpperCase();

  // 1. Manually issued codes (EXTRA_CODES env var)
  const extraCodes = (process.env.EXTRA_CODES || '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  let isValid = extraCodes.includes(input);

  // 2. Signed purchase codes: HOIST-RRRR-SSSS-SSSS
  if (!isValid) {
    const m = /^HOIST-([A-HJ-NP-Z2-9]{4})-([A-HJ-NP-Z2-9]{4})-([A-HJ-NP-Z2-9]{4})$/.exec(input);
    const secret = process.env.CODE_SIGNING_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
    if (m && secret) {
      isValid = safeEqual(m[2] + m[3], signCode(m[1], secret));
    }
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ valid: isValid }),
  };
};
