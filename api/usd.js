// Vercel serverless function: GET /api/usd -> { rate, prev, at, series, source } (EGP per 1 USD)
const UA = 'Mozilla/5.0 (compatible; AndysGold/1.0)';
async function get(url, ms = 8000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(String(r.status)); return await r.json(); }
  finally { clearTimeout(t); }
}
async function yahoo() {
  const q = (await get('https://query1.finance.yahoo.com/v8/finance/chart/EGP=X?range=3mo&interval=1d')).chart.result[0];
  const cl = q.indicators.quote[0].close, ts = q.timestamp, series = [];
  for (let i = 0; i < ts.length; i++) if (cl[i] > 0) series.push([ts[i] * 1000, Math.round(cl[i] * 10000) / 10000]);
  const rate = Number(q.meta.regularMarketPrice) || series[series.length - 1][1];
  return { rate, prev: series.length > 1 ? series[series.length - 2][1] : null, at: (q.meta.regularMarketTime || 0) * 1000, series, source: 'Yahoo Finance' };
}
async function er() {
  const j = await get('https://open.er-api.com/v6/latest/USD');
  return { rate: Number(j.rates.EGP), prev: null, at: (j.time_last_update_unix || 0) * 1000, series: [], source: 'open.er-api.com (daily)' };
}
module.exports = async (req, res) => {
  let d;
  try { d = await yahoo(); } catch (e) { try { d = await er(); } catch (e2) { d = null; } }
  if (!d || !(d.rate > 5 && d.rate < 500)) return res.status(502).json({ error: 'dollar rate unavailable' });
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
  res.status(200).json(d);
};
