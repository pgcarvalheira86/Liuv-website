import { buildAuthUrl, providers, getClientCredentials } from '../../lib/oauth-providers.js';
import { jsonResponse, redirectResponse } from '../../lib/auth-utils.js';

export async function handler(event) {
  try {
    const path = event.path || '';
    const providerName = event.queryStringParameters?.provider ||
      path.split('/').filter(Boolean).pop() ||
      'google';

    const provider = providers[providerName.toLowerCase()];
    if (!provider) {
      return jsonResponse({ error: `Unknown provider: ${providerName}` }, 400);
    }

    const { clientId } = getClientCredentials(provider);
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
  } catch (err) {
    console.error('[OAUTH-START]', err.message);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}
