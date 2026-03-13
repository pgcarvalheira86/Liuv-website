const ticker = process.argv[2] || 'AAPL';
console.log('Testing Yahoo Finance for', ticker, '...');
try {
  const mod = await import('yahoo-finance2');
  const YahooFinance = mod.default;
  const instance = new YahooFinance();
  const quote = await instance.quote(ticker);
  if (!quote) {
    console.log('No quote returned.');
    process.exit(1);
  }
  const price = quote.regularMarketPrice ?? quote.regularMarketOpen ?? quote.regularMarketPreviousClose;
  console.log('OK. Price:', price, '| Name:', quote.shortName ?? quote.longName ?? '—');
  console.log('P/E:', quote.trailingPE ?? '—', '| EPS:', quote.trailingEps ?? '—');
} catch (err) {
  console.error('Error:', err.message || err);
  process.exit(1);
}
