export async function sendLoginNotification({ email, name, provider }) {
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.startsWith('https://')) {
    return;
  }
  const displayName = (name || email || 'Unknown').trim() || 'Unknown';
  const text = `LIUV login\n${displayName}\n${email}\nvia ${provider}\n${new Date().toISOString()}`;
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
