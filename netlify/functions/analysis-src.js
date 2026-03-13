import { getTokenFromCookie, verifyToken, findUserByEmail, jsonResponse } from '../../lib/auth-utils.js';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

let envLoaded = false;
async function loadEnvIfNeeded() {
  if (envLoaded || process.env.FINNHUB_API_KEY) return;
  envLoaded = true;
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const envPath = existsSync(resolve(dir, '../../.env')) ? resolve(dir, '../../.env') : resolve(dir, '../../../.env');
    const raw = await readFile(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) {}
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = (process.env.ANALYSIS_MODEL || 'claude-haiku-4-5').trim() || 'claude-haiku-4-5';
const YAHOO_CACHE_TTL_MS = 5 * 60 * 1000;
const STEP_CACHE_TTL_MS = 30 * 60 * 1000;

const analysisCache = new Map();

function getCached(key, ttlMs = STEP_CACHE_TTL_MS) {
  const entry = analysisCache.get(key);
  const maxAge = entry?.ttlMs ?? ttlMs;
  if (!entry || Date.now() - entry.ts > maxAge) {
    if (entry) analysisCache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached(key, value, ttlMs = STEP_CACHE_TTL_MS) {
  analysisCache.set(key, { value, ts: Date.now(), ttlMs });
}

function fmtNum(v) {
  return v != null && v !== '' && !Number.isNaN(Number(v)) ? (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(3)) : '—';
}

async function getFinnhubContext(ticker, skipCache = false) {
  await loadEnvIfNeeded();
  const apiKey = (process.env.FINNHUB_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[ANALYSIS] Finnhub skipped: FINNHUB_API_KEY not set (set in Netlify env or .env for local)');
    return null;
  }
  const cacheKey = 'finnhub:' + ticker.toUpperCase();
  if (!skipCache) {
    const cached = getCached(cacheKey, YAHOO_CACHE_TTL_MS);
    if (cached !== undefined) {
      console.log('[ANALYSIS] Finnhub: using cache for', ticker);
      return cached;
    }
  }
  const base = 'https://finnhub.io/api/v1';
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    const s = String(v).trim();
    if (s === '' || s === 'None' || s === 'N/A' || s.toLowerCase() === 'none' || s.toLowerCase() === 'n/a') return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  };
  try {
    const [quoteRes, profileRes, metricRes] = await Promise.all([
      fetch(`${base}/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()),
      fetch(`${base}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()),
      fetch(`${base}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()).catch(() => null),
    ]);
    if (quoteRes?.error || profileRes?.error) {
      console.warn('[ANALYSIS] Finnhub API error for', ticker, quoteRes?.error || profileRes?.error);
      return null;
    }
    let price = parseNum(quoteRes?.c);
    if (price === 0) price = null;
    const name = profileRes?.name || quoteRes?.symbol || ticker;
    const marketCap = profileRes?.marketCapitalization != null ? Number(profileRes.marketCapitalization) * 1e6 : null;
    let pe = null;
    let eps = null;
    let roeNum = null;
    if (metricRes && typeof metricRes === 'object' && !metricRes.error) {
      const m = metricRes.metric || metricRes;
      pe = parseNum(m.pe ?? m.peRatio);
      eps = parseNum(m.eps ?? m.epsTTM);
      roeNum = parseNum(m.roe ?? m.returnOnEquity);
    }
    if (pe == null && price != null && eps != null && eps > 0) pe = Math.round((price / eps) * 100) / 100;
    const roeForLine = roeNum != null && roeNum >= 5 ? (roeNum >= 1 ? roeNum.toFixed(1) + '%' : (roeNum * 100).toFixed(1) + '%') : '—';
    const parts = [];
    if (price != null) parts.push(`Current price: ${price} USD`);
    if (name) parts.push(`Name: ${name}`);
    if (marketCap != null) parts.push(`Market cap: ${marketCap}`);
    if (pe != null) parts.push(`P/E (TTM): ${pe}`);
    if (eps != null) parts.push(`EPS (TTM): ${eps}`);
    if (roeNum != null) parts.push(`ROE: ${roeNum >= 1 ? roeNum + '%' : (roeNum * 100) + '%'}`);
    const metricsLine = [
      price != null ? '$' + fmtNum(price) : '—',
      eps != null ? '$' + fmtNum(eps) : '—',
      pe != null ? fmtNum(pe) + 'x' : '—',
      '—',
      roeForLine,
      '—',
    ].join(' | ');
    const header = 'Current Price | EPS TTM | P/E TTM | P/FCF TTM | ROE TTM | ROIC TTM';
    const context = `Market data from Finnhub. Use the metrics line below exactly in your output. Values shown as — mean unavailable; keep — in the line and use reasonable estimates in your narrative. Do not ask the user for data.

${header}
${metricsLine}

Other data:
${parts.join('\n')}`;
    setCached(cacheKey, context, YAHOO_CACHE_TTL_MS);
    console.log('[ANALYSIS] Finnhub: fetched', ticker, 'price=', price ?? 'n/a', 'eps=', eps ?? 'n/a', 'pe=', pe ?? 'n/a');
    return context;
  } catch (err) {
    console.warn('[ANALYSIS] Finnhub error for', ticker, err?.message || err);
    return null;
  }
}

const NEVER_ASK = 'Never ask the user for data or say you lack access. Use the context below or reasonable estimates. Output only valid JSON.';

const STEP_PROMPTS = {
  1: {
    system: `You are the LIUV Portfolio Advisor Agent. ${NEVER_ASK} If the ticker is not a real listed company, return: {"error":"Not a real listed company","message":"one short sentence"}.
Otherwise return exactly this shape. For metricsLine use the exact line from the user message: the line immediately after "Current Price | EPS TTM | P/E TTM | P/FCF TTM | ROE TTM | ROIC TTM" (or after "Copy this EXACT line into metricsLine"). Paste that line as-is into metricsLine; if it contains — for some fields, keep them. Never ask the user to provide or confirm the metrics line.
{"companyName":"","exchange":"","ticker":"","tagline":"","metricsLine":"Current Price | EPS TTM | P/E TTM | P/FCF TTM | ROE TTM | ROIC TTM\\n...","overallScore":7.5,"overallVerdict":"STRONG VALUE CANDIDATE","oneLineSummary":"","overview":"2-4 sentences","thesis":"2-4 sentences"}`,
    user: (t, ctx) => (ctx ? ctx + '\n\n' : '') + `Return JSON only for ${t}. Use the metrics line from above (paste it exactly into metricsLine).`,
    max_tokens: 900,
  },
  2: {
    system: `You are the LIUV Portfolio Advisor Agent. ${NEVER_ASK} Use exactly these 10 pillar names in order: Earnings Stability, Financial Strength, Revenue Growth, Earnings Growth, ROIC, ROE, Price-to-Earnings, Price-to-Free-Cash-Flow, Debt-to-Equity, Dividend & Shareholder Returns.
Return: {"pillars":[{"name":"Earnings Stability","score":8,"verdict":"Strong","line":"one line key metric"}]}
verdict must be one of: Strong, Good, Exceptional, Weak.`,
    user: (t, ctx) => (ctx ? ctx + '\n\n' : '') + `Return JSON with pillars array (10 items) for ${t}. Use context above for metrics when available.`,
    max_tokens: 1200,
  },
  3: {
    system: `You are the LIUV Portfolio Advisor Agent. ${NEVER_ASK}
{"bullCase":["bullet1","bullet2"],"bearCase":["bullet1","bullet2"],"dcf":{"fcfBase":"","growth5yr":"","terminalGrowth":"","discountRate":"","shares":"","intrinsicRange":"$X — $Y","marginOfSafety":"","grahamLine":""},"verdict":{"score":7.5,"verdict":"STRONG VALUE CANDIDATE","paragraph":"2-3 sentences"}}`,
    user: (t, ctx) => (ctx ? ctx + '\n\n' : '') + `Return JSON for bull case, bear case, DCF, and verdict for ${t}. Use context for price/FCF when available; otherwise use estimates.`,
    max_tokens: 1000,
  },
  4: {
    system: `You are the LIUV Portfolio Advisor Agent. ${NEVER_ASK} Always produce the three scenarios. Use context for starting price/EPS/FCF/revenue when available; otherwise use reasonable estimates from public knowledge.
{"startingPoint":{"price":"","eps":"","fcf":"","revenue":"","etfBaseline":"8-10%/yr"},"scenarios":[{"name":"Low","driver":"","description":"","year1":"","year5":"","year10":"","invested10k":"","annualizedReturn":"","verdict":""}],"readingTheScenarios":""}
Include 3 scenarios: Low, Medium, High.`,
    user: (t, ctx) => (ctx ? ctx + '\n\n' : '') + `Return JSON for three scenarios and reading for ${t}. Use the market data above for starting point when provided; otherwise use reasonable estimates.`,
    max_tokens: 1200,
  },
  5: {
    system: `You are the LIUV Portfolio Advisor Agent. ${NEVER_ASK} Same 10 pillar names as step 2: Earnings Stability, Financial Strength, Revenue Growth, Earnings Growth, ROIC, ROE, Price-to-Earnings, Price-to-Free-Cash-Flow, Debt-to-Equity, Dividend & Shareholder Returns.
{"pillars":[{"name":"","score":8,"verdict":"Strong"}],"overallScore":7.5,"overallVerdict":"","disclaimer":"LIUV disclaimer text"}`,
    user: (t, ctx) => (ctx ? ctx + '\n\n' : '') + `Return JSON score summary and disclaimer for ${t}. Use same pillar scores as step 2.`,
    max_tokens: 800,
  },
};

function parseJsonFromContent(content) {
  const raw = (content || '').trim();
  const codeMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const toParse = codeMatch ? codeMatch[1].trim() : raw;
  try {
    return JSON.parse(toParse);
  } catch {
    return null;
  }
}

async function runStep(ticker, step, apiKey, yahooContext) {
  const config = STEP_PROMPTS[step];
  if (!config) throw new Error('Invalid step');

  const userContent = typeof config.user === 'function' ? config.user(ticker, yahooContext || null) : config.user;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': (apiKey || '').trim(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: config.max_tokens,
      system: config.system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    let errBody;
    try {
      errBody = JSON.parse(raw);
    } catch {
      errBody = { error: raw };
    }
    const msg =
      errBody.error?.message
      || errBody.error?.type
      || (typeof errBody.error === 'string' ? errBody.error : null)
      || (raw && raw.length < 300 ? raw : null)
      || `API error ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();
  const block = data.content?.find((b) => b.type === 'text');
  const content = block?.text?.trim();
  if (!content) throw new Error('Empty response from AI');
  const parsed = parseJsonFromContent(content);
  return { raw: content, data: parsed };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse({}, 200);
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    await loadEnvIfNeeded();

    const cookieHeader = event.headers.cookie || event.headers.Cookie || '';
    const token = getTokenFromCookie(cookieHeader);
    if (!token) {
      return jsonResponse({ error: 'Unauthorized', code: 'no_token' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ error: 'Invalid or expired session', code: 'invalid_token' }, 401);
    }

    const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
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

    const step = Math.max(1, Math.min(5, parseInt(body.step, 10) || 1));
    const refresh = !!body.refresh;

    const user = await findUserByEmail(payload.email);
    if (!user?.plan) {
      return jsonResponse({ error: 'Active subscription required to run analysis' }, 403);
    }

    const stepCacheKey = 'step:' + ticker + ':' + step;
    if (!refresh) {
      const cached = getCached(stepCacheKey);
      if (cached !== undefined) {
        return jsonResponse({
          ticker,
          step,
          analysis: cached.raw ?? cached,
          data: cached.data ?? null,
          done: step === 5,
        });
      }
    }

    let marketContext = null;
    try {
      marketContext = await getFinnhubContext(ticker, refresh);
      if (marketContext == null) {
        console.warn('[ANALYSIS] Using placeholder market data (Finnhub returned no data for', ticker + ')');
        const header = 'Current Price | EPS TTM | P/E TTM | P/FCF TTM | ROE TTM | ROIC TTM';
        const placeholderLine = '— | — | — | — | — | —';
        marketContext = `No live market data available. Use reasonable estimates in your narrative. Do not ask the user for data or for the exact line.

${header}
Copy this EXACT line into metricsLine (use as-is):
${placeholderLine}`;
      }
    } catch (e) {
      console.warn('[ANALYSIS] Market data fetch failed:', e.message);
    }

    try {
      const result = await runStep(ticker, step, apiKey, marketContext);
      const payload = { raw: result.raw, data: result.data };
      setCached(stepCacheKey, payload);
      return jsonResponse({
        ticker,
        step,
        analysis: result.raw,
        data: result.data ?? null,
        done: step === 5,
      });
    } catch (err) {
      const msg = (err && err.message) ? String(err.message).trim() : String(err || 'Unknown error');
      console.error('[ANALYSIS] Error:', msg);
      let userError = 'Analysis failed. Try again.';
      if (msg.includes('invalid') && msg.toLowerCase().includes('key')) userError = 'Invalid API key. Set ANTHROPIC_API_KEY in Netlify site env vars.';
      else if (msg.includes('model') || msg.includes('not found')) userError = 'Model unavailable. Try again later.';
      else if (msg.includes('rate') || msg.includes('quota') || msg.includes('429')) userError = 'Rate limit reached. Try again in a few minutes.';
      else if (msg.includes('Empty response')) userError = 'AI returned no content. Try again.';
      else if (msg.includes('fetch failed') || msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('network')) userError = 'Network error talking to AI. Try again.';
      else if (msg.length > 0) userError = msg.length <= 220 ? msg : msg.slice(0, 217) + '…';
      const payload = { error: userError };
      if (body.debug) payload.errorDetail = msg.slice(0, 500);
      return jsonResponse(payload, 502);
    }
  } catch (outerErr) {
    const msg = (outerErr?.message && String(outerErr.message).trim())
      || (outerErr?.code && String(outerErr.code))
      || String(outerErr || 'Unknown error').trim();
    console.error('[ANALYSIS] Unhandled error:', msg, outerErr);
    let userError = 'Analysis failed. Try again.';
    if (msg.includes('invalid') && msg.toLowerCase().includes('key')) userError = 'Invalid API key. Set ANTHROPIC_API_KEY in Netlify site env vars.';
    else if (msg.includes('model') || msg.includes('not found')) userError = 'Model unavailable. Try again later.';
    else if (msg.includes('rate') || msg.includes('quota') || msg.includes('429')) userError = 'Rate limit reached. Try again in a few minutes.';
    else if (msg.includes('fetch failed') || msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('network') || msg.includes('ECONNREFUSED')) userError = 'Network error. Try again.';
    else if (msg.length > 0 && msg.length <= 220) userError = msg;
    else if (msg.length > 220) userError = msg.slice(0, 217) + '…';
    const payload = { error: userError };
    try {
      const reqBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
      if (reqBody.debug) payload.errorDetail = msg.slice(0, 500);
    } catch (_) {}
    return jsonResponse(payload, 502);
  }
}
