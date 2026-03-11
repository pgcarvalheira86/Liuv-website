// OAuth 2.0 provider configurations
// Google uses hardcoded credentials below; other providers use env vars

const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://liuv.io';
const CALLBACK_PATH = '/api/auth/callback';

const GOOGLE_CLIENT_ID = '105577862428-7aill0f30hg5a6vnhd9gd8tvtrn9lelm.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = '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';

export function getClientCredentials(provider) {
  if (provider.clientIdEnv === 'GOOGLE_CLIENT_ID') {
    return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET };
  }
  return {
    clientId: process.env[provider.clientIdEnv],
    clientSecret: process.env[provider.clientSecretEnv],
  };
}

export const providers = {
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: 'openid email profile',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    parseUser: (data) => ({ email: data.email, name: data.name, providerId: data.id }),
  },
  microsoft: {
    name: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: 'openid email profile User.Read',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
    parseUser: (data) => ({ email: data.mail || data.userPrincipalName, name: data.displayName, providerId: data.id }),
  },
  apple: {
    name: 'Apple',
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    userInfoUrl: null, // Apple returns user info in the ID token
    scopes: 'name email',
    clientIdEnv: 'APPLE_CLIENT_ID',
    clientSecretEnv: 'APPLE_CLIENT_SECRET',
    responseMode: 'form_post',
    parseUser: (data) => ({ email: data.email, name: data.name ? `${data.name.firstName} ${data.name.lastName}` : '', providerId: data.sub }),
  },
  facebook: {
    name: 'Facebook',
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me?fields=id,name,email',
    scopes: 'email',
    clientIdEnv: 'FACEBOOK_CLIENT_ID',
    clientSecretEnv: 'FACEBOOK_CLIENT_SECRET',
    parseUser: (data) => ({ email: data.email, name: data.name, providerId: data.id }),
  },
  linkedin: {
    name: 'LinkedIn',
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
    scopes: 'openid email profile',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
    parseUser: (data) => ({ email: data.email, name: data.name, providerId: data.sub }),
  },
  amazon: {
    name: 'Amazon',
    authUrl: 'https://www.amazon.com/ap/oa',
    tokenUrl: 'https://api.amazon.com/auth/o2/token',
    userInfoUrl: 'https://api.amazon.com/user/profile',
    scopes: 'profile',
    clientIdEnv: 'AMAZON_CLIENT_ID',
    clientSecretEnv: 'AMAZON_CLIENT_SECRET',
    parseUser: (data) => ({ email: data.email, name: data.name, providerId: data.user_id }),
  },
};

export function getProvider(name) {
  return providers[name.toLowerCase()] || null;
}

export function getCallbackUrl() {
  return `${SITE_URL}${CALLBACK_PATH}`;
}

export function buildAuthUrl(providerName) {
  const provider = getProvider(providerName);
  if (!provider) return null;

  const { clientId } = getClientCredentials(provider);
  if (!clientId) return null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getCallbackUrl(),
    response_type: 'code',
    scope: provider.scopes,
    state: `${providerName}:${generateState()}`,
  });

  // Apple requires response_mode=form_post
  if (provider.responseMode) {
    params.set('response_mode', provider.responseMode);
  }

  return `${provider.authUrl}?${params.toString()}`;
}

export async function exchangeCodeForToken(providerName, code) {
  const provider = getProvider(providerName);
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);

  const { clientId, clientSecret } = getClientCredentials(provider);

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getCallbackUrl(),
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${errText}`);
  }

  return res.json();
}

export async function fetchUserInfo(providerName, accessToken, tokenData) {
  const provider = getProvider(providerName);
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);

  // Apple returns user info in ID token — decode JWT payload
  if (!provider.userInfoUrl && tokenData?.id_token) {
    const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString());
    return provider.parseUser(payload);
  }

  const res = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`User info fetch failed: ${res.status}`);
  }

  const data = await res.json();
  return provider.parseUser(data);
}

function generateState() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
