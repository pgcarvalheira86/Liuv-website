import { exchangeCodeForToken, fetchUserInfo } from '../../lib/oauth-providers.mjs';
import { findUserByEmail, createUser, updateUser, createToken, setAuthCookie, redirectResponse, jsonResponse } from '../../lib/auth-utils.mjs';
import { sendConversionEmail } from '../../lib/email-utils.mjs';

export async function handler(event) {
  try {
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state;
    const error = event.queryStringParameters?.error;

    if (error) {
      return redirectResponse('/login.html?error=oauth_denied');
    }

    if (!code || !state) {
      return redirectResponse('/login.html?error=missing_params');
    }

    // Parse provider from state (format: "provider:randomString")
    const providerName = state.split(':')[0];
    if (!providerName) {
      return redirectResponse('/login.html?error=invalid_state');
    }

    // Exchange code for token
    const tokenData = await exchangeCodeForToken(providerName, code);
    const accessToken = tokenData.access_token;

    // Get user info
    const userInfo = await fetchUserInfo(providerName, accessToken, tokenData);

    if (!userInfo.email) {
      return redirectResponse('/login.html?error=no_email');
    }

    // Find or create user
    let user = await findUserByEmail(userInfo.email);
    let isNewUser = false;

    if (user) {
      // Update existing user with latest info from provider
      user = await updateUser(userInfo.email, {
        name: userInfo.name || user.name,
        provider: providerName,
        providerId: userInfo.providerId,
      });
    } else {
      // Create new user
      user = await createUser({
        email: userInfo.email,
        name: userInfo.name || '',
        provider: providerName,
        providerId: userInfo.providerId,
      });
      isNewUser = true;
    }

    // Create JWT
    const jwtToken = createToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    // Send conversion notification for new signups
    if (isNewUser) {
      sendConversionEmail({
        eventType: 'New Account Signup',
        userEmail: user.email,
        userName: user.name,
        details: `Signed up via ${providerName}`,
      }).catch(err => console.error('[NOTIFICATION] Error:', err.message));
    }

    return redirectResponse('/dashboard.html', {
      'Set-Cookie': setAuthCookie(jwtToken),
    });
  } catch (err) {
    console.error('[AUTH-CALLBACK] Error:', err);
    return redirectResponse('/login.html?error=auth_failed');
  }
}
