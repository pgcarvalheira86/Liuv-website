// Email notification utility
// Supports SendGrid, Resend, or Mailgun via environment variables
// Set EMAIL_PROVIDER ('sendgrid' | 'resend' | 'mailgun') and EMAIL_API_KEY

const NOTIFICATION_EMAIL = 'pedro@liuv.io';
const FROM_EMAIL = process.env.EMAIL_FROM || 'notifications@liuv.io';
const FROM_NAME = 'LIUV AI Platform';

export async function sendConversionEmail({ eventType, userEmail, userName, plan, details }) {
  const subject = `[LIUV] Conversion Event: ${eventType}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #060910; color: #E8ECF1;">
      <div style="border-bottom: 2px solid #14B89C; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="font-size: 24px; color: #14B89C; margin: 0;">LIUV Conversion Event</h1>
      </div>
      <div style="background: #0c1019; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <p style="color: #14B89C; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 8px 0;">${eventType}</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 8px 0; color: #6B7A8D; font-size: 14px;">User</td><td style="padding: 8px 0; color: #E8ECF1; font-size: 14px; text-align: right;">${userName || 'N/A'}</td></tr>
          <tr><td style="padding: 8px 0; color: #6B7A8D; font-size: 14px;">Email</td><td style="padding: 8px 0; color: #E8ECF1; font-size: 14px; text-align: right;">${userEmail}</td></tr>
          ${plan ? `<tr><td style="padding: 8px 0; color: #6B7A8D; font-size: 14px;">Plan</td><td style="padding: 8px 0; color: #14B89C; font-size: 14px; font-weight: 600; text-align: right;">${plan}</td></tr>` : ''}
          ${details ? `<tr><td style="padding: 8px 0; color: #6B7A8D; font-size: 14px;">Details</td><td style="padding: 8px 0; color: #E8ECF1; font-size: 14px; text-align: right;">${details}</td></tr>` : ''}
          <tr><td style="padding: 8px 0; color: #6B7A8D; font-size: 14px;">Timestamp</td><td style="padding: 8px 0; color: #E8ECF1; font-size: 14px; text-align: right;">${new Date().toISOString()}</td></tr>
        </table>
      </div>
      <p style="color: #3a4555; font-size: 12px; text-align: center;">LIUV AI Platform &mdash; Automated Notification</p>
    </div>
  `;

  const text = `LIUV Conversion Event: ${eventType}\n\nUser: ${userName || 'N/A'}\nEmail: ${userEmail}\n${plan ? `Plan: ${plan}\n` : ''}${details ? `Details: ${details}\n` : ''}Timestamp: ${new Date().toISOString()}`;

  const provider = (process.env.EMAIL_PROVIDER || 'sendgrid').toLowerCase();
  const apiKey = process.env.EMAIL_API_KEY;
  const hasMailgunDomain = !!process.env.MAILGUN_DOMAIN;
  if (!apiKey || (provider === 'mailgun' && !hasMailgunDomain)) {
    if (!apiKey) console.log('[EMAIL] Skipped (EMAIL_API_KEY not set)');
    return { success: false, message: 'Email not configured' };
  }

  try {
    switch (provider) {
      case 'sendgrid':
        return await sendViaSendGrid({ to: NOTIFICATION_EMAIL, subject, html, text });
      case 'resend':
        return await sendViaResend({ to: NOTIFICATION_EMAIL, subject, html, text });
      case 'mailgun':
        return await sendViaMailgun({ to: NOTIFICATION_EMAIL, subject, html, text });
      default:
        console.log('[EMAIL] No valid provider configured. Event logged:', { eventType, userEmail, plan });
        return { success: false, message: 'No email provider configured' };
    }
  } catch (err) {
    console.error('[EMAIL] Send failed:', err.message);
    return { success: false, message: err.message };
  }
}

async function sendViaSendGrid({ to, subject, html, text }) {
  const apiKey = process.env.EMAIL_API_KEY;
  if (!apiKey) throw new Error('EMAIL_API_KEY not set');

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });

  if (!res.ok) throw new Error(`SendGrid error: ${res.status}`);
  return { success: true, provider: 'sendgrid' };
}

async function sendViaResend({ to, subject, html, text }) {
  const apiKey = process.env.EMAIL_API_KEY;
  if (!apiKey) throw new Error('EMAIL_API_KEY not set');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) throw new Error(`Resend error: ${res.status}`);
  return { success: true, provider: 'resend' };
}

async function sendViaMailgun({ to, subject, html, text }) {
  const apiKey = process.env.EMAIL_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  if (!apiKey || !domain) throw new Error('EMAIL_API_KEY or MAILGUN_DOMAIN not set');

  const form = new URLSearchParams({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to,
    subject,
    html,
    text,
  });

  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
    },
    body: form,
  });

  if (!res.ok) throw new Error(`Mailgun error: ${res.status}`);
  return { success: true, provider: 'mailgun' };
}
