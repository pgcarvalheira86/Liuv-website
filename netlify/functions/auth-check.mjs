import { getTokenFromCookie, verifyToken, findUserByEmail, createUser, jsonResponse } from '../../lib/auth-utils.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse({}, 200);
  }

  try {
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const token = getTokenFromCookie(cookieHeader);

    if (!token) {
      return jsonResponse({ authenticated: false, error: 'No session cookie', code: 'no_token' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ authenticated: false, error: 'Invalid or expired token', code: 'invalid_token' }, 401);
    }

    let user = await findUserByEmail(payload.email);
    if (!user) {
      try {
        user = await createUser({
          email: payload.email,
          name: payload.name || '',
          provider: 'email',
          providerId: null,
        });
      } catch (e) {
        console.error('[AUTH-CHECK] Create user recovery failed:', e.message);
        user = {
          id: payload.userId || payload.sub || `usr_${payload.email}`,
          email: payload.email,
          name: payload.name || '',
          plan: null,
          provider: 'email',
          createdAt: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
        };
      }
    }

    return jsonResponse({
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        provider: user.provider,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error('[AUTH-CHECK] Error:', err);
    return jsonResponse({ authenticated: false, error: 'Internal server error' }, 500);
  }
}
