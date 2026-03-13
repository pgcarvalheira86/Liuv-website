function getWebhookUrl() {
  const url = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  return url && url.startsWith('https://') ? url : null;
}

async function sendToGoogleChat(eventType, { email, name, provider }) {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) return;
  const displayName = (name || email || 'Unknown').trim() || 'Unknown';
  const text = `LIUV ${eventType}\n${displayName}\n${email}\nvia ${provider}\n${new Date().toISOString()}`;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[CHAT-NOTIFY] Webhook failed:', res.status, errText.slice(0, 100));
    }
  } catch (err) {
    console.error('[CHAT-NOTIFY]', err.message);
  }
}

export async function sendLoginNotification({ email, name, provider }) {
  return sendToGoogleChat('login', { email, name, provider });
}

export async function sendSignupNotification({ email, name, provider }) {
  return sendToGoogleChat('signup', { email, name, provider });
}
