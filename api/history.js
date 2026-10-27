// Vercel serverless function: GET /api/history
// ~5 years of daily gold (USD/oz) and USD/EGP for the AI Model tab. Tries several free sources in parallel and uses the best one that works.
const UA = 'Mozilla/5.0 (compatible; AndysGold/1.0)';
async function get(url, ms = 6500) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, Accept: '*/*' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
const rnd = v => Math.round(v * 10000) / 10000;
async function yahoo(sym) {
  let err;
  for (const host of ['query1', 'query2']) {
    try {
      const q = JSON.parse(await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5y&interval=1d`)).chart.result[0];
      const cl = q.indicators.quote[0].close, out = [];
      q.timestamp.forEach((t, i) => { if (cl[i] > 0) out.push([t * 1000, rnd(cl[i])]); });
      return out;
    } catch (e) { err = e; }
  }
  throw err;
}
async function stooq(sym) {
  const txt = await get(`https://stooq.com/q/d/l/?s=${sym}&i=d`);
  if (!/^Date,/i.test(txt)) throw new Error('not CSV');
  const out = [];
  for (const line of txt.trim().split('\n').slice(1)) { const p = line.split(','), v = Number(p[4]), t = Date.parse(p[0]); if (v > 0 && t) out.push([t, rnd(v)]); }
  return out.slice(-1300);
}
async function kraken() { // PAXG token tracks 1 oz of gold closely
  const j = JSON.parse(await get('https://api.kraken.com/0/public/OHLC?pair=PAXGUSD&interval=1440'));
  const key = Object.keys(j.result || {}).find(k => k !== 'last');
  return j.result[key].map(r => [r[0] * 1000, rnd(Number(r[4]))]).filter(r => r[1] > 0);
}
async function first(list, min, errs) {
  const res = await Promise.allSettled(list.map(([, fn]) => fn()));
  for (let i = 0; i < list.length; i++) {
    const r = res[i];
    if (r.status === 'fulfilled' && r.value.length >= min) return { d: r.value, name: list[i][0] };
    errs.push(list[i][0] + ': ' + (r.status === 'rejected' ? r.reason.message : 'too little data'));
  }
  return null;
}
module.exports = async (req, res) => {
  const errs = [];
  const [g, f] = await Promise.all([
    first([['Yahoo gold futures', () => yahoo('GC=F')], ['Yahoo gold spot', () => yahoo('XAUUSD=X')], ['Stooq gold', () => stooq('xauusd')], ['Kraken PAXG', kraken]], 400, errs),
    first([['Yahoo USD/EGP', () => yahoo('EGP=X')], ['Stooq USD/EGP', () => stooq('usdegp')]], 400, errs)
  ]);
  if (!g) return res.status(502).json({ error: 'history unavailable', detail: errs.join('; ') });
  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.status(200).json({ gold: g.d, fx: f ? f.d : [], source: g.name + (f ? ' + ' + f.name : ' (dollar history unavailable, current rate used)'), errors: errs });
};
