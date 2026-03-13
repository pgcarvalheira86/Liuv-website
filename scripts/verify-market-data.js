import { readFile } from 'fs/promises';
import { resolve } from 'path';

const defaultTickers = ['AAPL', 'INTU', 'MSFT'];
const tickers = process.argv.slice(2).length ? process.argv.slice(2) : defaultTickers;

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

function fmtNum(v) {
  return v != null && v !== '' && !Number.isNaN(Number(v)) ? (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(3)) : '—';
}

function parseNum(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (s === '' || s === 'None' || s === 'N/A' || s.toLowerCase() === 'none' || s.toLowerCase() === 'n/a') return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

async function fetchFinnhub(ticker, apiKey) {
  const base = 'https://finnhub.io/api/v1';
  try {
    const [quoteRes, profileRes, metricRes] = await Promise.all([
      fetch(`${base}/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()),
      fetch(`${base}/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()),
      fetch(`${base}/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all&token=${encodeURIComponent(apiKey)}`).then((r) => r.json()).catch(() => null),
    ]);
    let price = parseNum(quoteRes?.c);
    if (price === 0) price = null;
    const name = profileRes?.name || ticker;
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
    return { name, price, eps, pe, roe: roeNum, marketCap: profileRes?.marketCapitalization != null ? profileRes.marketCapitalization * 1e6 : null, metricsLine };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

async function fetchAlphaVantage(ticker, apiKey) {
  const base = 'https://www.alphavantage.co/query';
  const [quoteRes, overviewRes] = await Promise.all([
    fetch(`${base}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`).then((r) => r.json()),
    fetch(`${base}?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`).then((r) => r.json()),
  ]);
  if (quoteRes?.Note || overviewRes?.Note) return { error: quoteRes?.Note || overviewRes?.Note };
  const quote = quoteRes?.['Global Quote'];
  const ov = overviewRes;
  const parseNumAV = (v) => (v != null && v !== '' && String(v).trim() !== 'None' && !Number.isNaN(Number(String(v).trim())) ? Number(String(v).trim()) : null);
  let price = parseNumAV(quote?.['05. price']);
  if (price == null && ov?.Symbol) {
    const dailyRes = await fetch(`${base}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=compact&apikey=${apiKey}`).then((r) => r.json());
    if (!dailyRes?.Note && dailyRes?.['Time Series (Daily)']) {
      const dates = Object.keys(dailyRes['Time Series (Daily)']).sort().reverse();
      const latest = dates[0] && dailyRes['Time Series (Daily)'][dates[0]];
        if (latest?.['4. close']) price = parseNumAV(latest['4. close']);
    }
  }
  const peRaw = parseNumAV(ov?.PERatio ?? ov?.['PE Ratio']);
  const eps = parseNumAV(ov?.EPS ?? ov?.['EarningsShare'] ?? ov?.['Earnings Per Share']);
  let pe = peRaw;
  if (pe == null && price != null && eps != null && eps > 0) pe = Math.round((price / eps) * 100) / 100;
  const roeRaw = ov?.ReturnOnEquityTTM ?? ov?.ReturnOnEquity ?? ov?.['Return on Equity'];
  const roeNum = parseNumAV(roeRaw);
  const roeForLine = roeNum != null && roeNum >= 5 ? (roeNum >= 1 ? roeNum.toFixed(1) + '%' : (roeNum * 100).toFixed(1) + '%') : '—';
  const metricsLine = [
    price != null ? '$' + fmtNum(price) : '—',
    eps != null ? '$' + fmtNum(eps) : '—',
    pe != null ? fmtNum(pe) + 'x' : '—',
    '—',
    roeForLine,
    '—',
  ].join(' | ');
  return {
    name: ov?.Name ?? quote?.['01. symbol'] ?? ticker,
    price,
    eps,
    pe,
    roe: roeNum,
    marketCap: ov?.MarketCapitalization,
    metricsLine,
  };
}

async function fetchYahoo(ticker) {
  try {
    const YahooFinance = (await import('yahoo-finance2')).default;
    const quote = await new YahooFinance().quote(ticker).catch(() => null);
    if (!quote) return { error: 'No quote' };
    const price = quote.regularMarketPrice ?? quote.regularMarketOpen ?? quote.regularMarketPreviousClose;
    const eps = quote.trailingEps;
    const pe = quote.trailingPE;
    const metricsLine = [
      price != null ? '$' + fmtNum(price) : '—',
      eps != null ? '$' + fmtNum(eps) : '—',
      pe != null ? fmtNum(pe) + 'x' : '—',
      '—',
      '—',
      '—',
    ].join(' | ');
    return {
      name: quote.shortName ?? quote.longName ?? ticker,
      price,
      eps,
      pe,
      marketCap: quote.marketCap,
      metricsLine,
    };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

await loadEnv();

const finnhubKey = (process.env.FINNHUB_API_KEY || '').trim();
const avKey = (process.env.ALPHA_VANTAGE_API_KEY || '').trim();
const header = 'Current Price | EPS TTM | P/E TTM | P/FCF TTM | ROE TTM | ROIC TTM';

console.log('Verify market data (no Anthropic calls)\n');
console.log('Expected metrics line format:', header);
console.log('(Finnhub: 60/min | Alpha Vantage: 25 req/day)\n');

for (let i = 0; i < tickers.length; i++) {
  const ticker = tickers[i];
  if (i > 0) await new Promise((r) => setTimeout(r, 800));
  const sym = ticker.toUpperCase();
  console.log('---', sym, '---');

  if (finnhubKey) {
    const fh = await fetchFinnhub(sym, finnhubKey);
    if (fh.error) {
      console.log('  Finnhub: ERROR', fh.error);
    } else {
      console.log('  Finnhub:');
      console.log('    Name:', fh.name ?? '—');
      console.log('    Price:', fh.price != null ? '$' + fh.price : '—', '| EPS:', fh.eps ?? '—', '| P/E:', fh.pe ?? '—', '| ROE:', fh.roe != null ? fh.roe + '%' : '—');
      console.log('    Line:', fh.metricsLine);
    }
  } else {
    console.log('  Finnhub: (set FINNHUB_API_KEY in .env to test)');
  }

  if (avKey) {
    const av = await fetchAlphaVantage(sym, avKey);
    if (av.error) {
      console.log('  Alpha Vantage: ERROR', av.error);
    } else {
      console.log('  Alpha Vantage:');
      console.log('    Name:', av.name ?? '—');
      console.log('    Price:', av.price != null ? '$' + av.price : '—', '| EPS:', av.eps ?? '—', '| P/E:', av.pe ?? '—', '| ROE:', av.roe != null ? av.roe + '%' : '—');
      console.log('    Line:', av.metricsLine);
    }
  } else {
    console.log('  Alpha Vantage: (set ALPHA_VANTAGE_API_KEY in .env to test)');
  }

  const yahoo = await fetchYahoo(sym);
  if (yahoo.error) {
    console.log('  Yahoo: ERROR', yahoo.error);
  } else {
    console.log('  Yahoo:');
    console.log('    Name:', yahoo.name ?? '—');
    console.log('    Price:', yahoo.price != null ? '$' + yahoo.price : '—', '| EPS:', yahoo.eps ?? '—', '| P/E:', yahoo.pe ?? '—');
    console.log('    Line:', yahoo.metricsLine);
  }

  console.log('');
}

console.log('Done.');
console.log('Usage: node scripts/verify-market-data.js [TICKER ...]  (default: AAPL INTU MSFT)');
