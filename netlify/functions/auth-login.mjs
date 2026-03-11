import { connectLambda } from '@netlify/blobs';
import { findUserByEmail, verifyPassword, createToken, setAuthCookie, jsonResponse } from '../../lib/auth-utils.mjs';
import { sendLoginNotification } from '../../lib/chat-notify.mjs';

export async function handler(event) {
  if (event?.blobs) {
    try {
      connectLambda(event);
    } catch (_) {}
  }
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
      return jsonResponse({ error: 'Invalid email or password' }, 401);
    }

    // If user signed up via OAuth, they can't login with password
    if (!user.passwordHash) {
      return jsonResponse({ error: `This account uses ${user.provider} sign-in. Please use the "${user.provider}" button to log in.` }, 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
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

    return jsonResponse(
      {
        success: true,
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      },
      200,
      { 'Set-Cookie': setAuthCookie(token) }
    );
  } catch (err) {
    console.error('[AUTH-LOGIN] Error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
