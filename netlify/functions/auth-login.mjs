import { connectLambda } from '@netlify/blobs';
import { findUserByEmail, verifyPassword, createToken, setAuthCookie, jsonResponse } from '../../lib/auth-utils.mjs';
import { sendLoginNotification } from '../../lib/chat-notify.mjs';

export async function handler(event) {
  console.log('[AUTH-LOGIN] invoked', process.env.NETLIFY ? 'production' : 'local');
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
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required' }, 400);
    }

    const user = await findUserByEmail(email);
    if (!user) {
      console.log('[AUTH-LOGIN] user not found:', email.trim().toLowerCase());
      return jsonResponse({ error: 'Invalid email or password' }, 401);
    }

    if (!user.passwordHash) {
      return jsonResponse({ error: `This account uses ${user.provider} sign-in. Please use the "${user.provider}" button to log in.` }, 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      console.log('[AUTH-LOGIN] password mismatch:', user.email);
      return jsonResponse({ error: 'Invalid email or password' }, 401);
    }

    const token = createToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    await sendLoginNotification({
      email: user.email,
      name: user.name,
      provider: 'email',
    }).catch(err => console.error('[CHAT-NOTIFY]', err.message));

    console.log('[AUTH-LOGIN] success', user.email);
    return jsonResponse(
      {
        success: true,
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      },
      200,
      { 'Set-Cookie': setAuthCookie(token) }
    );
  } catch (err) {
    console.error('[AUTH-LOGIN] Error:', err.message || err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
