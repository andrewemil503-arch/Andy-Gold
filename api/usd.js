// Vercel serverless function: GET /api/usd
// Exchange rates in EGP for USD, EUR, GBP, AUD, SAR, QAR. Top-level fields = USD (kept for the gold/AI code), plus `cur` with every currency.
const UA = 'Mozilla/5.0 (compatible; AndysGold/1.0)';
const CODES = ['USD', 'EUR', 'GBP', 'AUD', 'SAR', 'QAR'];
async function get(url, ms = 7000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(String(r.status)); return await r.json(); }
  finally { clearTimeout(t); }
}
async function yahoo(code) {
  const sym = code === 'USD' ? 'EGP=X' : code + 'EGP=X';
  let err;
  for (const host of ['query1', 'query2']) {
    try {
      const q = (await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?range=3mo&interval=1d`)).chart.result[0];
      const cl = q.indicators.quote[0].close, series = [];
      q.timestamp.forEach((t, i) => { if (cl[i] > 0) series.push([t * 1000, Math.round(cl[i] * 10000) / 10000]); });
      const rate = Number(q.meta.regularMarketPrice) || series[series.length - 1][1];
      return { rate, prev: series.length > 1 ? series[series.length - 2][1] : null, at: (q.meta.regularMarketTime || 0) * 1000, series };
    } catch (e) { err = e; }
  }
  throw err;
}
module.exports = async (req, res) => {
  const [e, ...ys] = await Promise.allSettled([get('https://open.er-api.com/v6/latest/USD'), ...CODES.map(yahoo)]);
  const er = e.status === 'fulfilled' ? e.value : null, rates = er && er.rates, cur = {};
  CODES.forEach((c, i) => {
    const cross = rates && rates.EGP > 0 && rates[c] > 0 ? rates.EGP / rates[c] : null;
    const y = ys[i], ok = y.status === 'fulfilled' && y.value.rate > 0 && (!cross || Math.abs(y.value.rate / cross - 1) < 0.1);
    if (ok) cur[c] = { ...y.value, src: 'Yahoo Finance' };
    else if (cross) cur[c] = { rate: cross, prev: null, at: (er.time_last_update_unix || 0) * 1000, series: [], src: 'open.er-api.com (daily)' };
  });
  if (!cur.USD || !(cur.USD.rate > 5 && cur.USD.rate < 500)) return res.status(502).json({ error: 'exchange rates unavailable' });
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  res.status(200).json({ ...cur.USD, source: cur.USD.src, cur });
};
