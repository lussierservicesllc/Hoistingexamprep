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
//     OWNER_EMAIL             = chrislussier34@gmail.com
// ================================================================

const https = require('https');
const crypto = require('crypto');

// ── Generate a unique access code ──
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars (0,O,1,I)
  let code = 'HOIST-';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3) code += '-';
  }
  return code; // format: HOIST-XXXX-XXXX
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
      res.on('end', () => resolve({ status: res.statusCode, body }));
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
        support_email: OWNER_EMAIL || 'chrislussier34@gmail.com',
      }
    );

    // ── Email 2: Notify Chris of the sale ──
    await sendEmail(
      EMAILJS_SERVICE_ID,
      EMAILJS_TEMPLATE_ID,
      EMAILJS_USER_ID,
      {
        to_email: OWNER_EMAIL || 'chrislussier34@gmail.com',
        to_name: 'Chris',
        access_code: accessCode,
        product_name: 'SALE NOTIFICATION — 2A-1C Study Tool',
        site_url: buyerEmail + ' paid $' + amountPaid,
        support_email: 'Buyer: ' + buyerEmail,
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
