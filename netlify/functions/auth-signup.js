import { connectLambda } from '@netlify/blobs';
import { findUserByEmail, createUser, hashPassword, verifyPassword, createToken, setAuthCookie, jsonResponse, setBlobsContextFromEvent } from '../../lib/auth-utils.js';
import { sendConversionEmail } from '../../lib/email-utils.js';
import { sendSignupNotification } from '../../lib/chat-notify.js';

export async function handler(event) {
  console.log('[AUTH-SIGNUP] invoked', process.env.NETLIFY ? 'production' : 'local');
  try {
    connectLambda(event);
    setBlobsContextFromEvent(event);
  } catch (_) {}
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

    const user = await createUser({
      email,
      name: name || '',
      password,
      provider: 'email',
    });

    const readBack = await findUserByEmail(user.email);
    console.log('[AUTH-SIGNUP] verify read-back:', readBack ? 'ok' : 'missing');

    // Create JWT
    const token = createToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    sendConversionEmail({
      eventType: 'New Account Signup',
      userEmail: user.email,
      userName: user.name,
      details: 'Signed up via email/password',
    }).catch(err => console.error('[NOTIFICATION] Error:', err.message));

    sendSignupNotification({
      email: user.email,
      name: user.name,
      provider: 'email',
    }).catch(err => console.error('[CHAT-NOTIFY]', err.message));

    console.log('[AUTH-SIGNUP] success', user.email);
    return jsonResponse(
      {
        success: true,
        user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      },
      201,
      { 'Set-Cookie': setAuthCookie(token) }
    );
  } catch (err) {
    console.error('[AUTH-SIGNUP] Error:', err.message || err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
