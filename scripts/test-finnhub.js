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

const apiKey = (process.env.FINNHUB_API_KEY || '').trim();
if (!apiKey) {
  console.error('Set FINNHUB_API_KEY in .env. Free key: https://finnhub.io/register');
  process.exit(1);
}

const base = 'https://finnhub.io/api/v1';

console.log('Finnhub test for', ticker);
console.log('Usage: node scripts/test-finnhub.js [TICKER]  (default: AAPL)');
console.log('Free tier: 60 calls/min, no daily limit.');
console.log('---');

try {
  const [quoteRes, profileRes, metricRes] = await Promise.all([
    fetch(`${base}/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()),
    fetch(`${base}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()),
    fetch(`${base}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()).catch(() => null),
  ]);

  let price = parseNum(quoteRes?.c);
  if (price === 0) price = null;
  const name = profileRes?.name || ticker;
  const marketCap = profileRes?.marketCapitalization != null ? Number(profileRes.marketCapitalization) * 1e6 : null;

  console.log('Quote (c=current):', quoteRes?.c ?? 'n/a');
  console.log('Profile2: name=%s marketCap(m)=%s', profileRes?.name ?? '—', profileRes?.marketCapitalization ?? '—');
  if (metricRes && !metricRes.error) {
    const m = metricRes.metric || metricRes;
    console.log('Metric sample: pe=%s eps=%s roe=%s', m.pe ?? '—', m.eps ?? m.epsTTM ?? '—', m.roe ?? m.returnOnEquity ?? '—');
  } else {
    console.log('Metric: not available or error');
  }

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

  const metricsLine = [
    price != null ? '$' + fmtNum(price) : '—',
    eps != null ? '$' + fmtNum(eps) : '—',
    pe != null ? fmtNum(pe) + 'x' : '—',
    '—',
    roeForLine,
    '—',
  ].join(' | ');

  console.log('---');
  console.log('Extracted: price=%s eps=%s pe=%s name=%s', price ?? 'n/a', eps ?? 'n/a', pe ?? 'n/a', name ?? '—');
  console.log('Metrics line:');
  console.log('  Current Price | EPS TTM | P/E TTM | P/FCF TTM | ROE TTM | ROIC TTM');
  console.log('  ' + metricsLine);
  console.log('---');
  console.log('OK.');
} catch (err) {
  console.error('Error:', err.message || err);
  process.exit(1);
}
