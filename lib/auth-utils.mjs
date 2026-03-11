import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getStore } from '@netlify/blobs';
import { parse, serialize } from 'cookie';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'liuv-dev-secret-change-in-production';
const COOKIE_NAME = 'liuv_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const IS_DEV = process.env.NODE_ENV !== 'production' || (process.env.URL && /localhost|127\.0\.0\.1/.test(process.env.URL));

// --- JWT ---
export function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// --- Cookies ---
export function setAuthCookie(token) {
  return serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearAuthCookie() {
  return serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  });
}

export function getTokenFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = parse(cookieHeader);
  return cookies[COOKIE_NAME] || null;
}

// --- Password ---
export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// --- User Store (Netlify Blobs with file fallback when Blobs unavailable) ---
const isServerless = process.cwd() === '/var/task' || process.env.NETLIFY;
const LOCAL_STORE_DIR = isServerless ? '/tmp/liuv-store' : join(process.cwd(), '.netlify', 'local-store');

async function fileStore(filename) {
  const filepath = join(LOCAL_STORE_DIR, filename);
  return {
    get: async (key, opts) => {
      try {
        const raw = await readFile(filepath, 'utf8');
        const data = JSON.parse(raw);
        const val = data[key];
        return opts?.type === 'json' ? val : val;
      } catch {
        return undefined;
      }
    },
    setJSON: async (key, val) => {
      await mkdir(LOCAL_STORE_DIR, { recursive: true });
      let data = {};
      try {
        const raw = await readFile(filepath, 'utf8');
        data = JSON.parse(raw);
      } catch {}
      data[key] = val;
      await writeFile(filepath, JSON.stringify(data, null, 0));
    },
  };
}

function isBlobsConfigured() {
  return !!(process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_BLOBS_SITE_ID);
}

async function storeWithBlobFallback(blobName, fileName) {
  let blob = null;
  if (isBlobsConfigured()) {
    try {
      blob = getStore({ name: blobName, consistency: 'strong' });
    } catch (_) {
      blob = null;
    }
  }
  const fallback = await fileStore(fileName);
  if (!blob) return fallback;
  return {
    get: async (key, opts) => {
      try {
        return await blob.get(key, opts);
      } catch {
        return fallback.get(key, opts);
      }
    },
    setJSON: async (key, val) => {
      try {
        await blob.setJSON(key, val);
      } catch {
        await fallback.setJSON(key, val);
      }
    },
  };
}

async function getUserStore() {
  return storeWithBlobFallback('users', 'users.json');
}

async function getPlanStore() {
  return storeWithBlobFallback('user-plans', 'user-plans.json');
}

export async function findUserByEmail(email) {
  const store = await getUserStore();
  const key = `email:${email.toLowerCase().trim()}`;
  try {
    const data = await store.get(key, { type: 'json' });
    return data;
  } catch {
    return null;
  }
}

export async function createUser({ email, name, password, provider, providerId }) {
  const store = await getUserStore();
  const normalizedEmail = email.toLowerCase().trim();
  const key = `email:${normalizedEmail}`;

  const user = {
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: normalizedEmail,
    name: name || '',
    provider: provider || 'email',
    providerId: providerId || null,
    passwordHash: password ? await hashPassword(password) : null,
    plan: null,
    stripeCustomerId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await store.setJSON(key, user);
  return user;
}

export async function updateUser(email, updates) {
  const store = await getUserStore();
  const key = `email:${email.toLowerCase().trim()}`;
  const existing = await findUserByEmail(email);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await store.setJSON(key, updated);
  return updated;
}

export async function linkStripeCustomer(email, stripeCustomerId, plan, name = '') {
  const planStore = await getPlanStore();
  await planStore.setJSON(`stripe:${stripeCustomerId}`, { email, plan });
  let user = await findUserByEmail(email);
  if (!user) {
    user = await createUser({ email, name: name || '', provider: 'email', providerId: null });
  }
  if (user) {
    return updateUser(email, { stripeCustomerId, plan });
  }
  return null;
}

// --- Response helpers ---
export function jsonResponse(body, statusCode = 200, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function redirectResponse(url, headers = {}) {
  return {
    statusCode: 302,
    headers: { Location: url, ...headers },
    body: '',
  };
}
