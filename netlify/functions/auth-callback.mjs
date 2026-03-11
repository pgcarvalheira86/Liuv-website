import { exchangeCodeForToken, fetchUserInfo, getSiteUrl } from '../../lib/oauth-providers.mjs';
import { findUserByEmail, createUser, updateUser, createToken, setAuthCookie, redirectResponse } from '../../lib/auth-utils.mjs';
import { sendConversionEmail } from '../../lib/email-utils.mjs';

export async function handler(event) {
  try {
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state;
    const error = event.queryStringParameters?.error;
    const errorDescription = event.queryStringParameters?.error_description;

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

    return redirectResponse(`${siteUrl}/dashboard.html`, {
      'Set-Cookie': setAuthCookie(jwtToken),
    });
  } catch (err) {
    console.error('[AUTH-CALLBACK]', err.message);
    const detail = encodeURIComponent((err.message || String(err)).slice(0, 200));
    return redirectResponse(`${getSiteUrl()}/login.html?error=auth_failed&error_detail=${detail}`);
  }
}
