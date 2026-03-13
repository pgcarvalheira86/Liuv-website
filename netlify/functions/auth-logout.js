import { clearAuthCookie, getCookieDomain, jsonResponse, redirectResponse } from '../../lib/auth-utils.js';

export async function handler(event) {
  const host = event.headers?.host || event.headers?.Host;
  const domain = getCookieDomain(host);
  const clearOpts = domain ? { domain } : {};
  if (event.httpMethod === 'GET') {
    return redirectResponse('/', {
      'Set-Cookie': clearAuthCookie(clearOpts),
    });
  }

  return jsonResponse(
    { success: true, message: 'Logged out' },
    200,
    { 'Set-Cookie': clearAuthCookie(clearOpts) }
  );
}
