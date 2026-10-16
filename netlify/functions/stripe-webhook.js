// ================================================================
// stripe-webhook.js — Netlify Function
// Triggered by Stripe when a payment completes.
// Generates a unique access code and emails it to the buyer.
// Also sends you (Chris) a notification email.
//
// SETUP STEPS (do these once in Netlify dashboard):
//   Environment Variables → Add:
//     STRIPE_WEBHOOK_SECRET   = whsec_... (from Stripe webhook settings)
//     STRIPE_SECRET_KEY       = sk_live_... (from Stripe API keys)
//     EMAILJS_SERVICE_ID      = your EmailJS service ID
//     EMAILJS_TEMPLATE_ID     = your EmailJS template ID
//     EMAILJS_USER_ID         = your EmailJS public key
//     EMAILJS_PRIVATE_KEY     = your EmailJS private key (Account > General)
//     OWNER_EMAIL             = chrislussier34@gmail.com
// ================================================================

const https = require('https');
const crypto = require('crypto');

// ── Generate a unique access code ──
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars (0,O,1,I)

function signCode(rand, secret) {
  const h = crypto.createHmac('sha256', secret).update(rand).digest();
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[h[i] % 32];
  return s;
}

function generateCode() {
  const secret = process.env.CODE_SIGNING_SECRET || process.env.STRIPE_WEBHOOK_SECRET;
  let rand = '';
  for (let i = 0; i < 4; i++) rand += ALPHABET[crypto.randomInt(32)];
  const sig = signCode(rand, secret);
  return 'HOIST-' + rand + '-' + sig.slice(0, 4) + '-' + sig.slice(4, 8); // format: HOIST-XXXX-XXXX-XXXX
}

// ── Verify Stripe webhook signature ──
function verifyStripeSignature(payload, sigHeader, secret) {
  const parts = sigHeader.split(',');
  let timestamp = '';
  let signature = '';
  for (const part of parts) {
    if (part.startsWith('t=')) timestamp = part.slice(2);
    if (part.startsWith('v1=')) signature = part.slice(3);
  }
  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

// ── Send email via EmailJS REST API ──
function sendEmail(serviceId, templateId, userId, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: userId,
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: params,
    });
    const options = {
      hostname: 'api.emailjs.com',
      path: '/api/v1.0/email/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ status: res.statusCode, body });
        } else {
          reject(new Error('EmailJS responded ' + res.statusCode + ': ' + body));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Main handler ──
exports.handler = async function (event, context) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const {
    STRIPE_WEBHOOK_SECRET,
    STRIPE_SECRET_KEY,
    EMAILJS_SERVICE_ID,
    EMAILJS_TEMPLATE_ID,
    EMAILJS_USER_ID,
    OWNER_EMAIL,
  } = process.env;

  // ── Verify the webhook came from Stripe ──
  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    if (!verifyStripeSignature(event.body, sig, STRIPE_WEBHOOK_SECRET)) {
      return { statusCode: 400, body: 'Invalid signature' };
    }
    stripeEvent = JSON.parse(event.body);
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return { statusCode: 400, body: 'Webhook error: ' + err.message };
  }

  // ── Only process completed checkout sessions ──
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Event type ignored' };
  }

  const session = stripeEvent.data.object;
  const buyerEmail = session.customer_details?.email || session.customer_email;
  const buyerName = session.customer_details?.name || 'Student';
  const amountPaid = ((session.amount_total || 2900) / 100).toFixed(2);

  if (!buyerEmail) {
    console.error('No buyer email found in session');
    return { statusCode: 200, body: 'No email — skipping' };
  }

  // ── Generate unique access code ──
  const accessCode = generateCode();
  console.log(`New purchase: ${buyerEmail} → code: ${accessCode}`);

  // ── Grant account access in Supabase (matched by buyer email) ──
  try {
    const sbKey = (process.env.SUPABASE_SECRET_KEY || '').replace(/\s+/g, '');
    const gr = await fetch('https://hpysmmtjucxkdeupnlfr.supabase.co/rest/v1/entitlements?on_conflict=email,product', {
      method: 'POST',
      headers: { apikey: sbKey, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ email: buyerEmail.toLowerCase(), product: '2a1c', source: 'stripe' }),
    });
    if (!gr.ok) console.error('Entitlement grant failed:', gr.status, await gr.text());
  } catch (e) {
    console.error('Entitlement grant error:', e);
  }

  try {
    // ── Email 1: Send access code to buyer ──
    await sendEmail(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      EMAILJS_USER_ID,
      {
        to_email: buyerEmail,
        to_name: buyerName,
        access_code: accessCode,
        product_name: '2A-1C Hoisting License Study Tool',
        site_url: 'https://hoistingexamprep.com',
        support_email: 'lussierservicesllc@gmail.com',
      }
    );

    // ── Email 2: Notify Chris of the sale ──
    await sendEmail(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      EMAILJS_USER_ID,
      {
        to_email: OWNER_EMAIL || 'chrislussier34@gmail.com',
        to_name: 'Chris (NEW SALE: ' + buyerEmail + ', $' + amountPaid + ')',
        access_code: accessCode,
        product_name: 'SALE NOTIFICATION — 2A-1C Study Tool',
        site_url: 'https://hoistingexamprep.com',
        support_email: 'lussierservicesllc@gmail.com',
      }
    );

    console.log('Emails sent successfully');
    return { statusCode: 200, body: JSON.stringify({ success: true, code: accessCode }) };

  } catch (err) {
    console.error('Email send failed:', err);
    // Still return 200 to Stripe so it doesn't retry endlessly
    return { statusCode: 200, body: 'Email failed but payment recorded' };
  }
};
