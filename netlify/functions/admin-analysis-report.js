import { connectLambda, getStore } from '@netlify/blobs';
import { getTokenFromCookie, verifyToken, jsonResponse, setBlobsContextFromEvent } from '../../lib/auth-utils.js';

const CACHE_STORE_NAME = 'analysis-cache';
const USER_STATS_PREFIX = 'user-stats:';

const ADMIN_EMAILS = [
  'admin@liuv.io',
  'contact@liuv.io',
  'puneet@liuv.io',
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

    const store = getStore(CACHE_STORE_NAME);
    const { blobs } = await store.list({ prefix: USER_STATS_PREFIX });
    const users = [];
    for (const { key } of blobs) {
      const email = key.slice(USER_STATS_PREFIX.length);
      const raw = await store.get(key, { type: 'json' });
      const counts = raw && typeof raw === 'object' ? raw : {};
      users.push({ email, counts });
    }
    users.sort((a, b) => (a.email || '').localeCompare(b.email || ''));

    return jsonResponse({ users });
  } catch (err) {
    console.error('[ADMIN-REPORT] Error:', err?.message || err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
