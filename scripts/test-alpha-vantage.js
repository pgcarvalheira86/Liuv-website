import { readFile } from 'fs/promises';
import { resolve } from 'path';

const ticker = (process.argv[2] || 'AAPL').toUpperCase();

async function loadEnv() {
  try {
    const path = resolve(process.cwd(), '.env');
    const raw = await readFile(path, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch {}
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (s === '' || s === 'None' || s === 'N/A' || s.toLowerCase() === 'none' || s.toLowerCase() === 'n/a') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function fmtNum(v) {
  return v != null && v !== '' && !Number.isNaN(Number(v)) ? (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(3)) : '—';
}

await loadEnv();

const apiKey = (process.env.ALPHA_VANTAGE_API_KEY || '').trim();
if (!apiKey) {
  console.error('Set ALPHA_VANTAGE_API_KEY in .env. Get a free key: https://www.alphavantage.co/support/#api-key');
  process.exit(1);
}

const base = 'https://www.alphavantage.co/query';

console.log('Alpha Vantage test for', ticker);
console.log('Usage: node scripts/test-alpha-vantage.js [TICKER]  (default: AAPL)');
console.log('---');

try {
  const [quoteRes, overviewRes] = await Promise.all([
    fetch(`${base}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`).then((r) => r.json()),
    fetch(`${base}?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`).then((r) => r.json()),
  ]);

  const quote = quoteRes?.['Global Quote'];
  const ov = overviewRes && typeof overviewRes === 'object' ? overviewRes : null;
  const rateLimit = quoteRes?.Note || overviewRes?.Note;
  const errMsg = quoteRes?.['Error Message'] || overviewRes?.['Error Message'] || overviewRes?.['Information'];

  if (rateLimit || errMsg) {
    console.log('API response (error/limit):', rateLimit ? 'Note' : 'Error/Info');
    if (errMsg) console.log('  Message:', errMsg);
    if (rateLimit) console.log('  Note:', rateLimit);
    process.exit(1);
  }

  console.log('GLOBAL_QUOTE keys:', quote ? Object.keys(quote) : '(empty or missing Global Quote)');
  if (quote) console.log('  05. price:', quote['05. price'], '-> parseNum:', parseNum(quote['05. price']));

  console.log('OVERVIEW sample: Symbol=%s Name=%s PERatio=%s EPS=%s', ov?.Symbol ?? '—', ov?.Name ?? '—', ov?.PERatio ?? '—', ov?.EPS ?? '—');
  if (ov && Object.keys(ov).length > 0 && Object.keys(ov).length <= 20) console.log('  All keys:', Object.keys(ov).join(', '));

  let price = parseNum(quote?.['05. price']);
  if (price == null) {
    console.log('Quote had no price; trying TIME_SERIES_DAILY...');
    const dailyRes = await fetch(`${base}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=compact&apikey=${apiKey}`).then((r) => r.json());
    if (dailyRes?.Note || dailyRes?.['Error Message']) {
      console.log('  Daily error:', dailyRes?.Note || dailyRes?.['Error Message']);
    } else if (dailyRes?.['Time Series (Daily)']) {
      const dates = Object.keys(dailyRes['Time Series (Daily)']).sort().reverse();
      const latest = dates[0] && dailyRes['Time Series (Daily)'][dates[0]];
      price = parseNum(latest?.['4. close']);
      console.log('  Latest date:', dates[0], '| 4. close:', latest?.['4. close'], '-> price:', price);
    } else {
      console.log('  No Time Series (Daily) in response. Top-level keys:', Object.keys(dailyRes || {}).join(', '));
    }
  }

  const peRaw = parseNum(ov?.PERatio ?? ov?.['PE Ratio']);
  const eps = parseNum(ov?.EPS ?? ov?.['EarningsShare'] ?? ov?.['Earnings Per Share']);
  let pe = peRaw;
  if (pe == null && price != null && eps != null && eps > 0) pe = Math.round((price / eps) * 100) / 100;
  const roeRaw = ov?.ReturnOnEquityTTM ?? ov?.ReturnOnEquity ?? ov?.['Return on Equity'];
  const roeNum = parseNum(roeRaw);
  const roeForLine = roeNum != null && roeNum >= 5 ? (roeNum >= 1 ? roeNum.toFixed(1) + '%' : (roeNum * 100).toFixed(1) + '%') : '—';

  const hasOverview = ov && (ov.Symbol || ov.Name || ov.MarketCapitalization);
  if (price == null && !hasOverview) {
    console.log('Result: NO DATA (price=null, no overview). Context would not be returned.');
    process.exit(1);
  }

  const metricsLine = [
    price != null ? '$' + fmtNum(price) : '—',
    eps != null ? '$' + fmtNum(eps) : '—',
    pe != null ? fmtNum(pe) + 'x' : '—',
    '—',
    roeForLine,
    '—',
  ].join(' | ');

  console.log('---');
  console.log('Extracted:');
  console.log('  price:', price ?? 'n/a');
  console.log('  eps:', eps ?? 'n/a');
  console.log('  pe:', pe ?? 'n/a');
  console.log('  roeNum:', roeNum ?? 'n/a');
  console.log('  name:', ov?.Name ?? quote?.['01. symbol'] ?? ticker);
  console.log('Metrics line (as used in analysis):');
  console.log('  Current Price | EPS TTM | P/E TTM | P/FCF TTM | ROE TTM | ROIC TTM');
  console.log('  ' + metricsLine);
  console.log('---');
  console.log('OK. Context would be returned.');
} catch (err) {
  console.error('Error:', err.message || err);
  process.exit(1);
}
