import { connectLambda } from '@netlify/blobs';
import { getTokenFromCookie, verifyToken, findUserByEmail, jsonResponse, setBlobsContextFromEvent, getOnboarding, setOnboarding } from '../../lib/auth-utils.js';

export async function handler(event) {
  try {
    connectLambda(event);
    setBlobsContextFromEvent(event);
  } catch (_) {}
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse({}, 200);
  }

  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const token = getTokenFromCookie(cookieHeader);
  if (!token) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const payload = verifyToken(token);
  if (!payload) {
    return jsonResponse({ error: 'Invalid or expired session' }, 401);
  }

  let user = await findUserByEmail(payload.email);
  if (!user) {
    user = { id: payload.userId || `usr_${payload.email.replace(/[^a-z0-9]/gi, '_')}` };
  }
  const userId = user.id;

  if (event.httpMethod === 'GET') {
    const data = await getOnboarding(userId);
    return jsonResponse({ onboarding: data });
  }

  if (event.httpMethod === 'POST') {
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }
    const { plan, preferences, completedStep } = body;
    const data = await setOnboarding(userId, { plan: plan || undefined, preferences: preferences || undefined, completedStep });
    return jsonResponse({ success: true, onboarding: data });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}
