import { connectLambda, getStore } from '@netlify/blobs';
import { getTokenFromCookie, verifyToken, jsonResponse, setBlobsContextFromEvent } from '../../lib/auth-utils.js';

const USERS_STORE = 'users';
const ONBOARDING_STORE = 'onboarding';
const ANALYSIS_STORE = 'analysis-cache';
const EMAIL_PREFIX = 'email:';
const USER_PREFIX = 'user:';
const USER_STATS_PREFIX = 'user-stats:';

const ADMIN_EMAILS = [
  'puneet@liuv.io',
  'pedro@liuv.io',
];

function isAdmin(email) {
  if (!email || typeof email !== 'string') return false;
  const normalized = email.trim().toLowerCase();
  return ADMIN_EMAILS.some((a) => a.trim().toLowerCase() === normalized);
}

export async function handler(event) {
  try {
    connectLambda(event);
    setBlobsContextFromEvent(event);
  } catch (_) {}

  if (event.httpMethod === 'OPTIONS') return jsonResponse({}, 200);
  if (event.httpMethod !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const token = getTokenFromCookie(cookieHeader);
    if (!token) return jsonResponse({ error: 'Unauthorized' }, 401);

    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ error: 'Unauthorized' }, 401);

    if (!isAdmin(payload.email)) return jsonResponse({ error: 'Forbidden' }, 403);

    const usersStore = getStore(USERS_STORE);
    const onboardingStore = getStore(ONBOARDING_STORE);
    const analysisStore = getStore(ANALYSIS_STORE);
    const { blobs: userKeys } = await usersStore.list({ prefix: EMAIL_PREFIX });
    const users = [];
    for (const { key } of userKeys) {
      const email = key.slice(EMAIL_PREFIX.length);
      const userRaw = await usersStore.get(key, { type: 'json' });
      const user = userRaw && typeof userRaw === 'object' ? userRaw : { id: null, email, name: '' };
      let onboarding = null;
      if (user.id) {
        const ob = await onboardingStore.get(USER_PREFIX + user.id, { type: 'json' });
        if (ob && typeof ob === 'object') onboarding = ob;
      }
      const countsRaw = await analysisStore.get(USER_STATS_PREFIX + email, { type: 'json' });
      const counts = countsRaw && typeof countsRaw === 'object' ? countsRaw : {};
      users.push({
        email: user.email || email,
        name: user.name || '',
        id: user.id || null,
        onboarding,
        counts,
      });
    }
    users.sort((a, b) => (a.email || '').localeCompare(b.email || ''));

    return jsonResponse({ users });
  } catch (err) {
    console.error('[ADMIN-REPORT] Error:', err?.message || err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
