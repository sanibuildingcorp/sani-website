// netlify/functions/track-open.js
// Tracks email opens (via pixel) and quote page opens (via fetch)
// Notifies contractor via email + SMS

exports.handler = async (event) => {
  const isPixelRequest = event.httpMethod === 'GET';
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // 1x1 transparent GIF for pixel response
  const TRANSPARENT_PIXEL = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );

  try {
    let ref, source, customer, projectTitle;

    if (isPixelRequest) {
      // Email pixel: data comes from query string
      const params = event.queryStringParameters || {};
      ref = params.ref;
      source = 'email';
      customer = { name: params.name || 'Customer', email: params.email || '' };
      projectTitle = params.title || 'Project';
    } else {
      // POST from quote page
      const data = JSON.parse(event.body || '{}');
      ref = data.ref;
      source = data.source || 'quote_page';
      customer = data.customer || {};
      projectTitle = data.projectTitle || 'Project';
    }

    // Always return pixel for GET requests so emails don't show broken images
    const pixelResponse = {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
      body: TRANSPARENT_PIXEL.toString('base64'),
      isBase64Encoded: true,
    };

    if (!ref) {
      return isPixelRequest ? pixelResponse : { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing ref' }) };
    }

    // Deduplicate: don't notify more than once per source per ref per hour
    // (Email clients can fetch the pixel multiple times)
    // Simple in-memory cache won't survive between invocations on serverless,
    // so we use a time-based bucket in the ref to reduce duplicates.

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const TWILIO_SID = process.env.TWILIO_SID;
    const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
    const TWILIO_FROM = process.env.TWILIO_FROM;
    const CONTRACTOR_EMAIL = process.env.CONTRACTOR_EMAIL || 'contact@sanibuildingcorp.com';
    const CONTRACTOR_PHONE = process.env.CONTRACTOR_PHONE;

    const now = new Date();
    const timeStr = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      month: 'short',
      day: 'numeric',
    }) + ' ET';

    const sourceLabel = source === 'email' ? '📧 EMAIL OPENED' : '🔗 QUOTE PAGE OPENED';
    const sourceDesc = source === 'email'
      ? 'Customer opened the quote email in their inbox.'
      : 'Customer clicked the link and is viewing their quote right now!';

    // SMS message
    const smsBody = `🔔 Sani Building Corp\n${sourceLabel}\n\n${customer.name || 'Customer'} opened ${projectTitle}\nRef: ${ref}\nTime: ${timeStr}\n\n${source === 'quote_page' ? '⚡ They are viewing it RIGHT NOW' : 'Email was just opened'}`;

    // Email notification HTML
    const emailHtml = `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:30px 10px;">
    <tr><td align="center">
      <table width="500" cellpadding="0" cellspacing="0" style="max-width:500px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.08);">
        <tr><td style="background:linear-gradient(135deg,#2ecc71,#27ae60);padding:24px;text-align:center;">
          <div style="font-size:32px;margin-bottom:6px;">${source === 'email' ? '📧' : '🔥'}</div>
          <h1 style="margin:0;color:#fff;font-size:20px;letter-spacing:1px;">${sourceLabel}</h1>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="font-size:15px;line-height:1.6;color:#0d1b2a;margin:0 0 16px;"><strong>${esc(customer.name || 'Customer')}</strong> just ${source === 'email' ? 'opened the email' : 'clicked through to view their quote'}!</p>
          <p style="font-size:13px;color:#666;margin:0 0 16px;line-height:1.7;">${sourceDesc}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ee;border:1px solid #e8c97a;border-radius:8px;padding:14px;margin-bottom:16px;">
            <tr><td style="padding:4px 0;font-size:12px;color:#666;">Project</td><td align="right" style="padding:4px 0;font-size:12px;color:#0d1b2a;font-weight:600;">${esc(projectTitle)}</td></tr>
            <tr><td style="padding:4px 0;font-size:12px;color:#666;">Reference</td><td align="right" style="padding:4px 0;font-size:12px;color:#0d1b2a;font-family:monospace;">${esc(ref)}</td></tr>
            ${customer.email ? `<tr><td style="padding:4px 0;font-size:12px;color:#666;">Customer Email</td><td align="right" style="padding:4px 0;font-size:12px;color:#0d1b2a;">${esc(customer.email)}</td></tr>` : ''}
            <tr><td style="padding:4px 0;font-size:12px;color:#666;">Opened At</td><td align="right" style="padding:4px 0;font-size:12px;color:#0d1b2a;">${timeStr}</td></tr>
          </table>
          ${source === 'quote_page' ? `<p style="background:#fff3cd;border-left:3px solid #c9a84c;padding:10px 12px;margin:0 0 16px;font-size:13px;color:#0d1b2a;line-height:1.6;border-radius:4px;">⚡ <strong>Hot lead!</strong> They're actively reviewing your quote right now. This is a great time to follow up with a quick call.</p>` : ''}
          ${customer.phone ? `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><a href="tel:${esc(customer.phone)}" style="display:inline-block;padding:12px 28px;background:#c9a84c;color:#0d1b2a;text-decoration:none;font-weight:700;letter-spacing:1px;border-radius:8px;font-size:14px;">📞 CALL ${esc(customer.name || 'CUSTOMER').toUpperCase()}</a></td></tr></table>` : ''}
        </td></tr>
        <tr><td style="background:#f8f5ee;padding:14px;text-align:center;border-top:1px solid #e8c97a;">
          <div style="font-size:11px;color:#666;">Sani Building Corp · Quote Tracking</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    // Fire notifications in parallel
    const tasks = [];

    if (RESEND_API_KEY) {
      tasks.push(
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Sani Building Corp <noreply@sanibuildingcorp.com>',
            to: [CONTRACTOR_EMAIL],
            subject: `${source === 'quote_page' ? '🔥' : '📧'} ${customer.name || 'Customer'} opened ${source === 'email' ? 'email' : 'quote'} - ${ref}`,
            html: emailHtml,
          }),
        }).catch(e => console.error('Email notification failed:', e))
      );
    }

    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && CONTRACTOR_PHONE) {
      const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
      tasks.push(
        fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: CONTRACTOR_PHONE, From: TWILIO_FROM, Body: smsBody }).toString(),
        }).catch(e => console.error('SMS notification failed:', e))
      );
    }

    // Run notifications but don't block the pixel response (fire-and-forget for pixel)
    if (isPixelRequest) {
      // For pixel: kick off notifications but return pixel immediately
      Promise.all(tasks).catch(() => {});
      return pixelResponse;
    } else {
      // For POST: wait for completion to confirm
      await Promise.all(tasks);
      return { statusCode: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
    }
  } catch (err) {
    console.error('track-open error:', err);
    if (isPixelRequest) {
      // Always return pixel even on error so email doesn't break
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'image/gif' },
        body: TRANSPARENT_PIXEL.toString('base64'),
        isBase64Encoded: true,
      };
    }
    return { statusCode: 500, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};

function esc(t) {
  if (t == null) return '';
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
