// netlify/functions/send-quote.js
// Sends quote email to customer with tracking pixel + notifies contractor

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const data = JSON.parse(event.body);
    const { ref, customer, project, estimate } = data;

    if (!customer?.email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing customer email' }) };
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const CONTRACTOR_EMAIL = process.env.CONTRACTOR_EMAIL || 'contact@sanibuildingcorp.com';
    const SITE_URL = process.env.URL || 'https://sanibuildingcorp.com';

    if (!RESEND_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email service not configured (RESEND_API_KEY missing)' }) };
    }

    // Build quote URL
    const quotePayload = { ref, customer, project, estimate };
    const encoded = encodeURIComponent(Buffer.from(JSON.stringify(quotePayload), 'utf8').toString('base64'));
    const quoteUrl = `${SITE_URL}/quote.html?q=${encoded}`;

    // Build tracking pixel URL
    const pixelParams = new URLSearchParams({
      ref: ref || '',
      name: customer.name || '',
      email: customer.email || '',
      title: estimate?.projectTitle || project?.type || 'Project',
    });
    const pixelUrl = `${SITE_URL}/.netlify/functions/track-open?${pixelParams.toString()}`;

    const fmt = n => '$' + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const firstName = (customer.name || '').split(' ')[0] || 'there';
    const projectTitle = estimate?.projectTitle || project?.type || 'Your Project';
    const grandTotal = estimate?.grandTotal || 0;
    const display = estimate?.display || { showLabor: true, showMaterials: true };
    const photoCount = (estimate?.photos || []).length;

    // Customer email with tracking pixel
    const customerHtml = `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Your Quote</title></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:30px 10px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.08);">
        <tr><td style="background:linear-gradient(135deg,#c9a84c,#9a6f2a);padding:30px 28px;text-align:center;">
          <div style="font-size:11px;letter-spacing:3px;color:rgba(13,27,42,.7);text-transform:uppercase;margin-bottom:6px;font-weight:600;">YOUR PERSONALIZED QUOTE</div>
          <h1 style="margin:0;color:#0d1b2a;font-size:26px;letter-spacing:1px;">${esc(projectTitle)}</h1>
        </td></tr>
        <tr><td style="padding:30px;">
          <p style="font-size:16px;line-height:1.6;color:#0d1b2a;margin:0 0 14px;">Hi ${esc(firstName)},</p>
          <p style="font-size:14px;line-height:1.7;color:#444;margin:0 0 20px;">Thank you for considering Sani Building Corp! We've prepared a detailed quote for your project. Click below to review it and accept when you're ready.</p>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f5ee;border:1px solid #e8c97a;border-radius:10px;padding:18px;margin-bottom:20px;">
            <tr><td align="center" style="padding:8px;">
              <div style="font-size:11px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:6px;">Estimated Total</div>
              <div style="font-size:36px;color:#9a6f2a;font-weight:700;letter-spacing:1px;">${fmt(grandTotal)}</div>
              <div style="font-size:12px;color:#666;margin-top:4px;">All inclusive · No hidden fees</div>
            </td></tr>
          </table>

          ${photoCount > 0 ? `<p style="font-size:13px;color:#666;margin:0 0 16px;text-align:center;">📷 Includes ${photoCount} photo${photoCount > 1 ? 's' : ''} for your reference</p>` : ''}

          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:12px 0 24px;">
            <a href="${quoteUrl}" style="display:inline-block;padding:18px 44px;background:#c9a84c;color:#0d1b2a;text-decoration:none;font-size:16px;font-weight:700;letter-spacing:2px;border-radius:10px;">VIEW YOUR QUOTE →</a>
          </td></tr></table>

          <p style="font-size:13px;line-height:1.7;color:#666;margin:0 0 8px;text-align:center;">On the quote page you can:</p>
          <ul style="font-size:13px;line-height:1.8;color:#666;margin:0 0 20px;padding-left:20px;">
            <li>Review project details &amp; timeline</li>
            ${display.showLabor || display.showMaterials ? '<li>See full breakdown of work</li>' : ''}
            ${photoCount > 0 ? '<li>View project photos</li>' : ''}
            <li>Accept the quote with one click</li>
            <li>Send us a message to discuss</li>
          </ul>

          <p style="font-size:13px;line-height:1.7;color:#666;margin:24px 0 0;">This quote is valid for 30 days. Questions? Reply to this email or call us anytime.</p>

          <p style="margin:24px 0 0;font-size:14px;color:#0d1b2a;">Thank you,<br><strong style="color:#c9a84c;">Sani Building Corp</strong></p>
        </td></tr>
        <tr><td style="background:#f8f5ee;padding:20px 30px;text-align:center;border-top:1px solid #e8c97a;">
          <div style="font-size:12px;color:#666;line-height:1.7;">
            <strong style="color:#0d1b2a;">Sani Building Corp</strong> · Insured &amp; Trusted NYC Contractors<br>
            <a href="tel:3322770990" style="color:#c9a84c;text-decoration:none;">📞 332-277-0990</a> · 
            <a href="mailto:contact@sanibuildingcorp.com" style="color:#c9a84c;text-decoration:none;">✉ contact@sanibuildingcorp.com</a><br>
            <span style="font-size:11px;color:#999;">Ref: ${esc(ref)}</span>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <!-- TRACKING PIXEL: fires when email is opened -->
  <img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />
</body></html>`;

    // Send to customer
    const customerRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Sani Building Corp <quotes@sanibuildingcorp.com>',
        to: [customer.email],
        reply_to: CONTRACTOR_EMAIL,
        subject: `📋 Your Quote: ${projectTitle} - ${fmt(grandTotal)} (Ref ${ref})`,
        html: customerHtml,
      }),
    });

    if (!customerRes.ok) {
      const errBody = await customerRes.text();
      console.error('Resend customer error:', errBody);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Email send failed', details: errBody }) };
    }

    // Notify contractor
    const contractorHtml = `<p style="font-family:Arial,sans-serif;font-size:14px;color:#0d1b2a;line-height:1.7">
      <strong>📤 Quote sent to ${esc(customer.name)} (${esc(customer.email)})</strong><br>
      Ref: ${esc(ref)}<br>Project: ${esc(projectTitle)}<br>Total: ${fmt(grandTotal)}<br>
      Photos attached: ${photoCount}<br><br>
      Customer link: <a href="${quoteUrl}">${quoteUrl}</a><br><br>
      🔔 You'll be notified when they open the email or click through to the quote.
    </p>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Sani Building Corp <noreply@sanibuildingcorp.com>',
        to: [CONTRACTOR_EMAIL],
        subject: `📤 Quote Sent: ${fmt(grandTotal)} to ${customer.name} - Ref ${ref}`,
        html: contractorHtml,
      }),
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, quoteUrl }) };
  } catch (err) {
    console.error('send-quote error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error', message: err.message }) };
  }
};

function esc(t) {
  if (t == null) return '';
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
