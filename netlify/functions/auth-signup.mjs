import { findUserByEmail, createUser, hashPassword, verifyPassword, createToken, setAuthCookie, jsonResponse } from '../../lib/auth-utils.mjs';
import { sendConversionEmail } from '../../lib/email-utils.mjs';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse({}, 200);
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const { email, password, name } = JSON.parse(event.body);

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required' }, 400);
    }

    if (password.length < 8) {
      return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
    }

    // Check if user already exists
    const existing = await findUserByEmail(email);
    if (existing) {
      return jsonResponse({ error: 'An account with this email already exists. Please sign in instead.' }, 409);
    }

    // Create user
    const user = await createUser({
      email,
      name: name || '',
      password,
      provider: 'email',
    });

    // Create JWT
    const token = createToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    // Send conversion notification
    sendConversionEmail({
      eventType: 'New Account Signup',
      userEmail: user.email,
      userName: user.name,
      details: 'Signed up via email/password',
    }).catch(err => console.error('[NOTIFICATION] Error:', err.message));

    return jsonResponse(
      {
        success: true,
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      },
      201,
      { 'Set-Cookie': setAuthCookie(token) }
    );
  } catch (err) {
    console.error('[AUTH-SIGNUP] Error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
