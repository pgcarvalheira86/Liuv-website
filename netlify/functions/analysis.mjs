import { getTokenFromCookie, verifyToken, findUserByEmail, jsonResponse } from '../../lib/auth-utils.mjs';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

async function runAnalysis(ticker, apiKey) {
  const systemPrompt = `You are an expert value investing analyst in the style of Warren Buffett and Benjamin Graham. Provide concise, practical analysis. Focus on: business quality, margin of safety, valuation context, and key risks. Use plain language and avoid hype.`;
  const userPrompt = `Provide a brief value-investing style analysis for the stock ticker: ${ticker.toUpperCase()}. Cover: (1) what the company does, (2) key strengths and risks from a value perspective, (3) what to look for in the financials (e.g. margin of safety, earnings quality). Keep it to about 200–300 words. If the ticker is not a real company, say so briefly.`;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Anthropic API error: ${res.status}`);
  }

  const data = await res.json();
  const block = data.content?.find((b) => b.type === 'text');
  const content = block?.text?.trim();
  if (!content) throw new Error('Empty response from AI');
  return content;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse({}, 200);
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
  const token = getTokenFromCookie(cookieHeader);
  if (!token) {
    return jsonResponse({ error: 'Unauthorized', code: 'no_token' }, 401);
  }

  const payload = verifyToken(token);
  if (!payload) {
    return jsonResponse({ error: 'Invalid or expired session', code: 'invalid_token' }, 401);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[ANALYSIS] ANTHROPIC_API_KEY not set');
    return jsonResponse({ error: 'Analysis service not configured' }, 503);
  }

  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const ticker = (body.ticker || '').toString().trim().toUpperCase();
  if (!ticker || ticker.length > 10) {
    return jsonResponse({ error: 'Valid ticker required (1–10 characters)' }, 400);
  }

  const user = await findUserByEmail(payload.email);
  if (user?.plan === null && process.env.ANALYSIS_REQUIRES_PLAN === 'true') {
    return jsonResponse({ error: 'Active plan required to run analysis' }, 403);
  }

  try {
    const analysis = await runAnalysis(ticker, apiKey);
    return jsonResponse({ ticker, analysis });
  } catch (err) {
    console.error('[ANALYSIS] Error:', err.message);
    return jsonResponse(
      { error: err.message?.includes('API') ? 'Analysis service temporarily unavailable' : 'Analysis failed' },
      502
    );
  }
}
