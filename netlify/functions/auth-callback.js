import { connectLambda } from '@netlify/blobs';
import { exchangeCodeForToken, fetchUserInfo, getSiteUrl } from '../../lib/oauth-providers.js';
import { findUserByEmail, createUser, updateUser, createToken, setAuthCookie, redirectResponse, setBlobsContextFromEvent } from '../../lib/auth-utils.js';
import { sendConversionEmail } from '../../lib/email-utils.js';
import { sendLoginNotification } from '../../lib/chat-notify.js';

function getCallbackParams(event) {
  const q = event.queryStringParameters || {};
  if (event.httpMethod === 'POST' && event.body) {
    const contentType = (event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = new URLSearchParams(event.body);
      return {
        code: body.get('code') || q.code,
        state: body.get('state') || q.state,
        error: body.get('error') || q.error,
        error_description: body.get('error_description') || q.error_description,
      };
    }
    if (contentType.includes('application/json')) {
      try {
        const b = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        return { code: b.code || q.code, state: b.state || q.state, error: b.error || q.error, error_description: b.error_description || q.error_description };
      } catch (_) {}
    }
  }
  return { code: q.code, state: q.state, error: q.error, error_description: q.error_description };
}

export async function handler(event) {
  try {
    connectLambda(event);
    setBlobsContextFromEvent(event);
  } catch (_) {}
  try {
    const params = getCallbackParams(event);
    const code = params.code;
    const state = params.state;
    const error = params.error;
    const errorDescription = params.error_description;

    const siteUrl = getSiteUrl();
    if (error) {
      const detail = errorDescription ? `&error_detail=${encodeURIComponent(errorDescription.slice(0, 150))}` : '';
      return redirectResponse(`${siteUrl}/login.html?error=oauth_denied${detail}`);
    }

    if (!code || !state) {
      return redirectResponse(`${siteUrl}/login.html?error=missing_params`);
    }

    const providerName = state.split(':')[0];
    if (!providerName) {
      return redirectResponse(`${siteUrl}/login.html?error=invalid_state`);
    }

    const tokenData = await exchangeCodeForToken(providerName, code);
    const accessToken = tokenData.access_token;
    const userInfo = await fetchUserInfo(providerName, accessToken, tokenData);

    if (!userInfo.email) {
      return redirectResponse(`${siteUrl}/login.html?error=no_email`);
    }

    let user = await findUserByEmail(userInfo.email);
    let isNewUser = false;

    if (user) {
      user = await updateUser(userInfo.email, {
        name: userInfo.name || user.name,
        provider: providerName,
        providerId: userInfo.providerId,
      });
    } else {
      user = await createUser({
        email: userInfo.email,
        name: userInfo.name || '',
        provider: providerName,
        providerId: userInfo.providerId,
      });
      isNewUser = true;
    }

    const jwtToken = createToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    if (isNewUser) {
      sendConversionEmail({
        eventType: 'New Account Signup',
        userEmail: user.email,
        userName: user.name,
        details: `Signed up via ${providerName}`,
      }).catch(err => console.error('[NOTIFICATION] Error:', err.message));
    }

    await sendLoginNotification({
      email: user.email,
      name: user.name,
      provider: providerName,
    }).catch(err => console.error('[CHAT-NOTIFY]', err.message));

    return redirectResponse(`${siteUrl}/dashboard.html`, {
      'Set-Cookie': setAuthCookie(jwtToken),
    });
  } catch (err) {
    console.error('[AUTH-CALLBACK]', err.message);
    const detail = encodeURIComponent((err.message || String(err)).slice(0, 200));
    return redirectResponse(`${getSiteUrl()}/login.html?error=auth_failed&error_detail=${detail}`);
  }
}
