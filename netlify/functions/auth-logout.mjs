import { clearAuthCookie, jsonResponse, redirectResponse } from '../../lib/auth-utils.mjs';

export async function handler(event) {
  // Support both GET (redirect) and POST (API)
  if (event.httpMethod === 'GET') {
    return redirectResponse('/', {
      'Set-Cookie': clearAuthCookie(),
    });
  }

  return jsonResponse(
    { success: true, message: 'Logged out' },
    200,
    { 'Set-Cookie': clearAuthCookie() }
  );
}
