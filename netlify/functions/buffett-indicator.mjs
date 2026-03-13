import { getStore } from '@netlify/blobs';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const CACHE_KEY = 'buffett-indicator-latest';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function jsonResponse(body, status = 200) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=900',
    },
    body: JSON.stringify(body),
  };
}

async function fetchFredSeries(seriesId, apiKey, limit = 60) {
  const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FRED API error for ${seriesId}: ${res.status}`);
  const data = await res.json();
  return (data.observations || [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }));
}

function getZone(ratio) {
  if (ratio < 75) return { zone: 'Significantly Undervalued', color: '#22C55E', severity: 1 };
  if (ratio < 90) return { zone: 'Modestly Undervalued', color: '#14B89C', severity: 2 };
  if (ratio < 115) return { zone: 'Fair Valued', color: '#F59E0B', severity: 3 };
  if (ratio < 140) return { zone: 'Modestly Overvalued', color: '#F97316', severity: 4 };
  return { zone: 'Significantly Overvalued', color: '#EF4444', severity: 5 };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse({}, 200);
  if (event.httpMethod !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405);

  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'FRED API key not configured', code: 'no_api_key' }, 503);
  }

  // Check cache
  try {
    const store = getStore('buffett-indicator');
    const cached = await store.get(CACHE_KEY, { type: 'json' });
    if (cached && cached.timestamp && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return jsonResponse(cached.data);
    }
  } catch (e) {
    console.warn('[BUFFETT] Cache read error:', e.message);
  }

  try {
    // Fetch Wilshire 5000 Total Market Index and GDP
    const [wilshire, gdp] = await Promise.all([
      fetchFredSeries('WILL5000PRFC', apiKey, 60),
      fetchFredSeries('GDP', apiKey, 60),
    ]);

    if (!wilshire.length || !gdp.length) {
      return jsonResponse({ error: 'Insufficient data from FRED' }, 502);
    }

    // Latest values: Wilshire 5000 is in billions, GDP is in billions
    const latestMarketCap = wilshire[0].value;
    const latestGdp = gdp[0].value;

    // Wilshire 5000 total market index value roughly represents market cap in billions
    // GDP is reported in billions of dollars
    const ratio = (latestMarketCap / latestGdp) * 100;
    const zoneInfo = getZone(ratio);

    // Build historical series: align quarterly GDP with market data
    const gdpMap = {};
    gdp.forEach((g) => {
      const q = g.date.substring(0, 7);
      gdpMap[q] = g.value;
    });

    let lastGdpVal = latestGdp;
    const historical = wilshire
      .slice(0, 48)
      .reverse()
      .map((w) => {
        const q = w.date.substring(0, 7);
        if (gdpMap[q]) lastGdpVal = gdpMap[q];
        return {
          date: w.date,
          ratio: parseFloat(((w.value / lastGdpVal) * 100).toFixed(1)),
        };
      });

    const result = {
      current: {
        ratio: parseFloat(ratio.toFixed(1)),
        marketCap: latestMarketCap,
        gdp: latestGdp,
        zone: zoneInfo.zone,
        zoneColor: zoneInfo.color,
        severity: zoneInfo.severity,
        marketCapDate: wilshire[0].date,
        gdpDate: gdp[0].date,
      },
      historical,
    };

    // Cache result
    try {
      const store = getStore('buffett-indicator');
      await store.setJSON(CACHE_KEY, { timestamp: Date.now(), data: result });
    } catch (e) {
      console.warn('[BUFFETT] Cache write error:', e.message);
    }

    return jsonResponse(result);
  } catch (err) {
    console.error('[BUFFETT] Error:', err.message);
    return jsonResponse({ error: 'Failed to fetch market data' }, 502);
  }
}
