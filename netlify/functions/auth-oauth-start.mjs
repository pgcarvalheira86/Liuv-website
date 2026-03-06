import { buildAuthUrl, providers } from '../../lib/oauth-providers.mjs';
import { jsonResponse, redirectResponse } from '../../lib/auth-utils.mjs';

export async function handler(event) {
  // Extract provider from path: /api/auth/oauth/:provider -> /.netlify/functions/auth-oauth-start
  const path = event.path || '';
  const providerName = event.queryStringParameters?.provider ||
    path.split('/').filter(Boolean).pop() ||
    'google';

  // Check provider exists
  const provider = providers[providerName.toLowerCase()];
  if (!provider) {
    return jsonResponse({ error: `Unknown provider: ${providerName}` }, 400);
  }

  // Check credentials are configured
  const clientId = process.env[provider.clientIdEnv];
  if (!clientId) {
    return jsonResponse({
      error: `${provider.name} login is not yet configured. Please contact support.`,
    }, 503);
  }

  const authUrl = buildAuthUrl(providerName);
  if (!authUrl) {
    return jsonResponse({ error: 'Failed to build authorization URL' }, 500);
  }

  return redirectResponse(authUrl);
}
