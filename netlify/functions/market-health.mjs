import { getStore } from '@netlify/blobs';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const CACHE_KEY = 'market-health-latest';
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

/* ── Zone helpers ── */

// Indicator 1: Modern Buffett (S&P 500 Price / S&P 500 Revenue per Share → P/S ratio)
function getModernBuffettZone(ps) {
  if (ps < 1.5) return { zone: 'Significantly Undervalued', color: '#22C55E', severity: 1 };
  if (ps < 2.0) return { zone: 'Modestly Undervalued', color: '#14B89C', severity: 2 };
  if (ps < 2.8) return { zone: 'Fair Valued', color: '#F59E0B', severity: 3 };
  if (ps < 3.5) return { zone: 'Modestly Overvalued', color: '#F97316', severity: 4 };
  return { zone: 'Significantly Overvalued', color: '#EF4444', severity: 5 };
}

// Indicator 2: Equity Risk Premium (Earnings Yield − 10-Year Treasury Yield)
function getErpZone(erp) {
  if (erp > 5) return { zone: 'Stocks Very Attractive', color: '#22C55E', severity: 1 };
  if (erp > 3) return { zone: 'Stocks Attractive', color: '#14B89C', severity: 2 };
  if (erp > 1) return { zone: 'Neutral', color: '#F59E0B', severity: 3 };
  if (erp > -1) return { zone: 'Bonds Competitive', color: '#F97316', severity: 4 };
  return { zone: 'Bonds Preferred', color: '#EF4444', severity: 5 };
}

// Indicator 3: Classic Buffett (Market Cap / GDP)
function getClassicBuffettZone(ratio) {
  if (ratio < 75) return { zone: 'Significantly Undervalued', color: '#22C55E', severity: 1 };
  if (ratio < 90) return { zone: 'Modestly Undervalued', color: '#14B89C', severity: 2 };
  if (ratio < 115) return { zone: 'Fair Valued', color: '#F59E0B', severity: 3 };
  if (ratio < 140) return { zone: 'Modestly Overvalued', color: '#F97316', severity: 4 };
  return { zone: 'Significantly Overvalued', color: '#EF4444', severity: 5 };
}

// Composite signal
function getCompositeSignal(modernSeverity, erpSeverity, classicSeverity) {
  const avg = (modernSeverity + erpSeverity + classicSeverity) / 3;
  if (avg <= 1.5) return { signal: 'Strong Buy', color: '#22C55E' };
  if (avg <= 2.5) return { signal: 'Buy', color: '#14B89C' };
  if (avg <= 3.5) return { signal: 'Neutral', color: '#F59E0B' };
  if (avg <= 4.5) return { signal: 'Caution', color: '#F97316' };
  return { signal: 'Risk Off', color: '#EF4444' };
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
    const store = getStore('market-health');
    const cached = await store.get(CACHE_KEY, { type: 'json' });
    if (cached && cached.timestamp && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return jsonResponse(cached.data);
    }
  } catch (e) {
    console.warn('[MARKET-HEALTH] Cache read error:', e.message);
  }

  try {
    // Fetch all required FRED series in parallel
    const [wilshire, gdp, sp500, earnings, treasury10y] = await Promise.all([
      fetchFredSeries('WILL5000PRFC', apiKey, 60),   // Wilshire 5000 Total Market Index
      fetchFredSeries('GDP', apiKey, 60),              // U.S. GDP
      fetchFredSeries('SP500', apiKey, 60),            // S&P 500 price
      fetchFredSeries('MULTI1FSPSE', apiKey, 60)       // S&P 500 P/E ratio (used to derive earnings yield)
        .catch(() => null),
      fetchFredSeries('DGS10', apiKey, 60),            // 10-Year Treasury Yield
    ]);

    // ── Indicator 3: Classic Buffett (Market Cap / GDP) ──
    const latestMarketCap = wilshire[0].value;
    const latestGdp = gdp[0].value;
    const classicRatio = (latestMarketCap / latestGdp) * 100;
    const classicZone = getClassicBuffettZone(classicRatio);

    // Build historical for classic
    const gdpMap = {};
    gdp.forEach((g) => { gdpMap[g.date.substring(0, 7)] = g.value; });
    let lastGdpVal = latestGdp;
    const classicHistorical = wilshire.slice(0, 48).reverse().map((w) => {
      const q = w.date.substring(0, 7);
      if (gdpMap[q]) lastGdpVal = gdpMap[q];
      return { date: w.date, ratio: parseFloat(((w.value / lastGdpVal) * 100).toFixed(1)) };
    });

    // ── Indicator 1: Modern Buffett P/S approximation ──
    // Use S&P 500 price and approximate revenue via P/E → E/P → estimate
    // Approximate P/S as (SP500 price) / (SP500 earnings * revenue-to-earnings multiplier)
    // Simplified: use P/E ratio and historical P/S ≈ P/E × net margin (~10%)
    let modernPs = null;
    let modernZone = null;
    let modernHistorical = [];
    const latestSp500 = sp500[0].value;

    if (earnings && earnings.length > 0) {
      const latestPe = earnings[0].value;
      modernPs = parseFloat((latestPe * 0.10).toFixed(2)); // approximate P/S from P/E × avg net margin
      modernZone = getModernBuffettZone(modernPs);

      // Historical P/S from P/E series
      modernHistorical = earnings.slice(0, 48).reverse().map((e) => ({
        date: e.date,
        value: parseFloat((e.value * 0.10).toFixed(2)),
      }));
    } else {
      // Fallback: estimate P/S from S&P 500 price level
      modernPs = parseFloat((latestSp500 / 2000).toFixed(2));
      modernZone = getModernBuffettZone(modernPs);
      modernHistorical = sp500.slice(0, 48).reverse().map((s) => ({
        date: s.date,
        value: parseFloat((s.value / 2000).toFixed(2)),
      }));
    }

    // ── Indicator 2: Equity Risk Premium ──
    const latestTreasury = treasury10y[0].value;
    // Earnings yield from P/E: E/P × 100
    let earningsYield;
    if (earnings && earnings.length > 0) {
      earningsYield = parseFloat(((1 / earnings[0].value) * 100).toFixed(2));
    } else {
      earningsYield = 4.5; // fallback estimate
    }
    const erp = parseFloat((earningsYield - latestTreasury).toFixed(2));
    const erpZone = getErpZone(erp);

    // Historical ERP
    const treasuryMap = {};
    treasury10y.forEach((t) => { treasuryMap[t.date.substring(0, 7)] = t.value; });
    let lastTreasury = latestTreasury;
    let erpHistorical;
    if (earnings && earnings.length > 0) {
      erpHistorical = earnings.slice(0, 48).reverse().map((e) => {
        const q = e.date.substring(0, 7);
        if (treasuryMap[q]) lastTreasury = treasuryMap[q];
        const ey = (1 / e.value) * 100;
        return { date: e.date, value: parseFloat((ey - lastTreasury).toFixed(2)) };
      });
    } else {
      erpHistorical = treasury10y.slice(0, 48).reverse().map((t) => ({
        date: t.date,
        value: parseFloat((4.5 - t.value).toFixed(2)),
      }));
    }

    // ── Composite Signal ──
    const composite = getCompositeSignal(
      modernZone.severity,
      erpZone.severity,
      classicZone.severity
    );

    const result = {
      timestamp: new Date().toISOString(),
      composite,
      modernBuffett: {
        value: modernPs,
        zone: modernZone.zone,
        zoneColor: modernZone.color,
        severity: modernZone.severity,
        sp500Price: latestSp500,
        date: sp500[0].date,
        historical: modernHistorical,
      },
      erp: {
        value: erp,
        earningsYield,
        treasuryYield: latestTreasury,
        zone: erpZone.zone,
        zoneColor: erpZone.color,
        severity: erpZone.severity,
        date: treasury10y[0].date,
        historical: erpHistorical,
      },
      classicBuffett: {
        value: parseFloat(classicRatio.toFixed(1)),
        marketCap: latestMarketCap,
        gdp: latestGdp,
        zone: classicZone.zone,
        zoneColor: classicZone.color,
        severity: classicZone.severity,
        marketCapDate: wilshire[0].date,
        gdpDate: gdp[0].date,
        historical: classicHistorical,
      },
    };

    // Cache result
    try {
      const store = getStore('market-health');
      await store.setJSON(CACHE_KEY, { timestamp: Date.now(), data: result });
    } catch (e) {
      console.warn('[MARKET-HEALTH] Cache write error:', e.message);
    }

    return jsonResponse(result);
  } catch (err) {
    console.error('[MARKET-HEALTH] Error:', err.message);
    return jsonResponse({ error: 'Failed to fetch market data' }, 502);
  }
}
