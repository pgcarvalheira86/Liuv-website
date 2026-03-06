import { getTokenFromCookie, verifyToken, findUserByEmail, jsonResponse } from '../../lib/auth-utils.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse({}, 200);
  }

  try {
    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const token = getTokenFromCookie(cookieHeader);

    if (!token) {
      return jsonResponse({ authenticated: false }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ authenticated: false, error: 'Invalid or expired token' }, 401);
    }

    // Get fresh user data
    const user = await findUserByEmail(payload.email);
    if (!user) {
      return jsonResponse({ authenticated: false, error: 'User not found' }, 401);
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
