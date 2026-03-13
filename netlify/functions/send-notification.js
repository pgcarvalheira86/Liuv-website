import { sendConversionEmail } from '../../lib/email-utils.js';
import { getTokenFromCookie, verifyToken, jsonResponse } from '../../lib/auth-utils.js';

// Public notification endpoint for triggering conversion emails
// Called from the client on specific conversion events (e.g., thank-you page visit, onboarding completion)

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse({}, 200);
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const { eventType, userEmail, userName, plan, details } = JSON.parse(event.body);

    if (!eventType) {
      return jsonResponse({ error: 'eventType is required' }, 400);
    }

    // Try to get user info from auth cookie if available
    let authenticatedEmail = null;
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const token = getTokenFromCookie(cookieHeader);
    if (token) {
      const payload = verifyToken(token);
      if (payload) authenticatedEmail = payload.email;
    }

    const result = await sendConversionEmail({
      eventType,
      userEmail: userEmail || authenticatedEmail || 'unknown',
      userName: userName || '',
      plan: plan || '',
      details: details || '',
    });

    return jsonResponse({ success: true, result });
  } catch (err) {
    console.error('[SEND-NOTIFICATION] Error:', err);
    return jsonResponse({ error: 'Failed to send notification' }, 500);
  }
}
