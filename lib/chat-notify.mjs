const WEBHOOK_URL = process.env.GOOGLE_CHAT_WEBHOOK_URL;

export async function sendLoginNotification({ email, name, provider }) {
  if (!WEBHOOK_URL || !WEBHOOK_URL.startsWith('https://')) {
    return;
  }
  const displayName = (name || email || 'Unknown').trim() || 'Unknown';
  const text = `🔐 *LIUV login*\n${displayName}\n${email}\nvia ${provider}\n_${new Date().toISOString()}_`;
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error('[CHAT-NOTIFY] Webhook failed:', res.status);
    }
  } catch (err) {
    console.error('[CHAT-NOTIFY]', err.message);
  }
}
