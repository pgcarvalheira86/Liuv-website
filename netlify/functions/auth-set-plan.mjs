import { connectLambda } from '@netlify/blobs';
import { getTokenFromCookie, verifyToken, findUserByEmail, updateUser, jsonResponse } from '../../lib/auth-utils.mjs';

const ALLOWED_PLANS = ['Explorer', 'Investor', 'Professional'];

export async function handler(event) {
  try {
    connectLambda(event);
  } catch (_) {}
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse({}, 200);
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const token = getTokenFromCookie(cookieHeader);
    if (!token) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ error: 'Invalid or expired session' }, 401);
    }

    let body = {};
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const raw = (body.plan || '').toString().trim().toLowerCase();
    const planMap = { explorer: 'Explorer', investor: 'Investor', professional: 'Professional' };
    const plan = planMap[raw];
    if (!plan) {
      return jsonResponse({ error: 'Invalid plan' }, 400);
    }

    const user = await findUserByEmail(payload.email);
    if (!user) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    await updateUser(payload.email, { plan });
    return jsonResponse({ ok: true, plan });
  } catch (err) {
    console.error('[AUTH-SET-PLAN] Error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
