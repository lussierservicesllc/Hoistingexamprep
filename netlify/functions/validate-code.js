// ================================================================
// validate-code.js — Netlify Function
// Called by the landing page when a user enters an access code.
// Checks against the master list of valid codes.
//
// For now this uses a hardcoded list + env var override.
// Later you can swap this for a database (Supabase, etc.)
// ================================================================

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

  const { code } = body;
  if (!code) {
    return {
      statusCode: 400,
      body: JSON.stringify({ valid: false, error: 'No code provided' }),
    };
  }

  // ── Master code list ──
  // Add new codes here as you generate them, or use the
  // EXTRA_CODES env variable (comma-separated) in Netlify dashboard
  // to add codes without redeploying.
  const baseCodes = [
    'HOIST2025',
    'DEMO-ACCESS',
    'MA2A1C',
  ];

  // Pull any additional codes from environment variable
  const envCodes = process.env.EXTRA_CODES
    ? process.env.EXTRA_CODES.split(',').map(c => c.trim().toUpperCase())
    : [];

  // Also accept codes matching the auto-generated pattern HOIST-XXXX-XXXX
  // These are validated by pattern so you never need to add them manually
  const autoPattern = /^HOIST-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  const allCodes = [...baseCodes, ...envCodes];
  const inputCode = code.trim().toUpperCase();

  const isValid =
    allCodes.includes(inputCode) || autoPattern.test(inputCode);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ valid: isValid }),
  };
};
