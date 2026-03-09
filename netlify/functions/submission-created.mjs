// Auto-triggered by Netlify when a form submission is created
// Handles: email notification to pedro@liuv.io + Google Drive folder creation
// Only processes career application forms (name starts with "application-")

const NOTIFICATION_EMAIL = 'pedro@liuv.io';
const FROM_EMAIL = process.env.EMAIL_FROM || 'careers@liuv.io';
const FROM_NAME = 'LIUV Careers';
const GOOGLE_DRIVE_PARENT_FOLDER = '1jkSnn0l5J6a43_8WC5tcg5TgjmMgRO-D';

export async function handler(event) {
  let payload;
  try {
    payload = JSON.parse(event.body).payload;
  } catch {
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const formName = payload.form_name || '';
  if (!formName.startsWith('application-')) {
    return { statusCode: 200, body: 'Not a career application form' };
  }

  const data = payload.data || payload.ordered_human_fields?.reduce((acc, f) => {
    acc[f.name] = f.value;
    return acc;
  }, {}) || {};

  const roleName = formatRoleName(formName.replace('application-', ''));
  const candidateName = data['full-name'] || data['name'] || 'Unknown';
  const candidateEmail = data['email'] || 'Not provided';
  const timestamp = new Date().toISOString();

  // Send email notification
  try {
    await sendApplicationEmail({ data, roleName, candidateName, candidateEmail, timestamp });
    console.log(`[CAREERS] Email sent for ${candidateName} - ${roleName}`);
  } catch (err) {
    console.error('[CAREERS] Email failed:', err.message);
  }

  // Create Google Drive folder
  try {
    await createDriveFolder({ data, roleName, candidateName, candidateEmail, timestamp });
    console.log(`[CAREERS] Drive folder created for ${candidateName} - ${roleName}`);
  } catch (err) {
    console.error('[CAREERS] Drive folder creation failed:', err.message);
  }

  return { statusCode: 200, body: 'OK' };
}

function formatRoleName(slug) {
  const names = {
    'cto': 'CTO / Technical Co-Founder',
    'ai-ml-engineer': 'Senior AI/ML Engineer',
    'full-stack-engineer': 'Full-Stack Product Engineer',
    'head-of-compliance': 'Head of Compliance & Regulatory Affairs',
    'head-of-growth': 'Head of Growth / Marketing',
    'data-engineer': 'Data Engineer',
    'backend-engineer': 'Senior Backend Engineer',
    'product-designer': 'Product Designer (UX/UI)',
    'community-manager': 'Community Manager & Content Creator',
    'business-development': 'Business Development Manager (B2B/Partnerships)',
  };
  return names[slug] || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ========================================
// EMAIL NOTIFICATION
// ========================================
async function sendApplicationEmail({ data, roleName, candidateName, candidateEmail, timestamp }) {
  const fieldRows = Object.entries(data)
    .filter(([key]) => key !== 'bot-field' && key !== 'form-name')
    .map(([key, value]) => {
      const label = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const displayValue = value || 'Not provided';
      return `<tr><td style="padding: 10px 16px; color: #6B7A8D; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.05); white-space: nowrap; vertical-align: top;">${label}</td><td style="padding: 10px 16px; color: #E8ECF1; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.05); word-break: break-word;">${displayValue}</td></tr>`;
    })
    .join('');

  const textFields = Object.entries(data)
    .filter(([key]) => key !== 'bot-field' && key !== 'form-name')
    .map(([key, value]) => `${key.replace(/-/g, ' ')}: ${value || 'Not provided'}`)
    .join('\n');

  const subject = `[LIUV Careers] New Application: ${roleName} — ${candidateName}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 32px; background: #060910; color: #E8ECF1;">
      <div style="border-bottom: 2px solid #14B89C; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="font-size: 22px; color: #14B89C; margin: 0;">New Career Application</h1>
        <p style="color: #6B7A8D; font-size: 14px; margin: 8px 0 0 0;">${roleName}</p>
      </div>
      <div style="background: #0c1019; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 4px 0; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 14px 16px; color: #14B89C; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid rgba(255,255,255,0.05); font-weight: 600;" colspan="2">CANDIDATE INFORMATION</td>
          </tr>
          ${fieldRows}
          <tr>
            <td style="padding: 10px 16px; color: #6B7A8D; font-size: 14px; white-space: nowrap; vertical-align: top;">Submitted At</td>
            <td style="padding: 10px 16px; color: #E8ECF1; font-size: 14px;">${timestamp}</td>
          </tr>
        </table>
      </div>
      <p style="color: #3a4555; font-size: 12px; text-align: center;">LIUV Careers — Automated Notification</p>
    </div>
  `;

  const text = `New Career Application: ${roleName}\n\nCandidate: ${candidateName}\nEmail: ${candidateEmail}\nSubmitted: ${timestamp}\n\n${textFields}`;

  const provider = (process.env.EMAIL_PROVIDER || 'sendgrid').toLowerCase();
  const apiKey = process.env.EMAIL_API_KEY;

  if (!apiKey) {
    console.log('[CAREERS-EMAIL] No EMAIL_API_KEY configured. Logging application:', { roleName, candidateName, candidateEmail });
    return { success: false, message: 'No email provider configured' };
  }

  switch (provider) {
    case 'sendgrid': {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: NOTIFICATION_EMAIL }] }],
          from: { email: FROM_EMAIL, name: FROM_NAME },
          subject,
          content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
        }),
      });
      if (!res.ok) throw new Error(`SendGrid error: ${res.status}`);
      return { success: true, provider: 'sendgrid' };
    }
    case 'resend': {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [NOTIFICATION_EMAIL],
          subject,
          html,
          text,
        }),
      });
      if (!res.ok) throw new Error(`Resend error: ${res.status}`);
      return { success: true, provider: 'resend' };
    }
    case 'mailgun': {
      const domain = process.env.MAILGUN_DOMAIN;
      if (!domain) throw new Error('MAILGUN_DOMAIN not set');
      const form = new URLSearchParams({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: NOTIFICATION_EMAIL, subject, html, text });
      const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Mailgun error: ${res.status}`);
      return { success: true, provider: 'mailgun' };
    }
    default:
      console.log('[CAREERS-EMAIL] Unknown provider:', provider);
      return { success: false, message: 'Unknown email provider' };
  }
}

// ========================================
// GOOGLE DRIVE FOLDER CREATION
// ========================================
async function createDriveFolder({ data, roleName, candidateName, candidateEmail, timestamp }) {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    console.log('[CAREERS-DRIVE] No GOOGLE_SERVICE_ACCOUNT_JSON configured. Skipping Drive folder creation.');
    return { success: false, message: 'Google Drive not configured' };
  }

  const serviceAccount = JSON.parse(serviceAccountJson);
  const accessToken = await getGoogleAccessToken(serviceAccount);

  // Create candidate folder: "CandidateName - RoleName - Date"
  const dateStr = new Date().toISOString().split('T')[0];
  const folderName = `${candidateName} — ${roleName} — ${dateStr}`;

  const folderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [GOOGLE_DRIVE_PARENT_FOLDER],
    }),
  });

  if (!folderRes.ok) {
    const err = await folderRes.text();
    throw new Error(`Drive folder creation failed: ${folderRes.status} - ${err}`);
  }

  const folder = await folderRes.json();
  const folderId = folder.id;

  // Create application summary document
  const summaryContent = buildApplicationSummary({ data, roleName, candidateName, candidateEmail, timestamp });

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = JSON.stringify({
    name: `Application Summary — ${candidateName}.txt`,
    parents: [folderId],
    mimeType: 'text/plain',
  });

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadata +
    delimiter +
    'Content-Type: text/plain; charset=UTF-8\r\n\r\n' +
    summaryContent +
    closeDelimiter;

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Drive file upload failed: ${uploadRes.status} - ${err}`);
  }

  console.log(`[CAREERS-DRIVE] Created folder "${folderName}" (${folderId})`);
  return { success: true, folderId };
}

function buildApplicationSummary({ data, roleName, candidateName, candidateEmail, timestamp }) {
  const divider = '='.repeat(60);
  const fields = Object.entries(data)
    .filter(([key]) => key !== 'bot-field' && key !== 'form-name')
    .map(([key, value]) => {
      const label = key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `${label}:\n${value || 'Not provided'}\n`;
    })
    .join('\n');

  return `LIUV — Career Application Summary
${divider}

Position: ${roleName}
Candidate: ${candidateName}
Email: ${candidateEmail}
Submitted: ${timestamp}

${divider}
APPLICATION DETAILS
${divider}

${fields}
${divider}
End of Application
`;
}

// ========================================
// GOOGLE AUTH (Service Account JWT)
// ========================================
async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaimSet = base64url(JSON.stringify(claimSet));
  const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

  const privateKey = serviceAccount.private_key;
  const signature = await signRS256(signatureInput, privateKey);
  const jwt = `${signatureInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google auth failed: ${tokenRes.status} - ${err}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

async function signRS256(input, privateKeyPem) {
  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(input);
  sign.end();
  const signature = sign.sign(privateKeyPem);
  return signature.toString('base64url');
}
