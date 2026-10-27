// Vercel serverless function: GET /api/gold
// Returns live Egyptian dealer prices (scraped server-side from iSagha) plus the world gold price as a fallback.
const UA = 'Mozilla/5.0 (compatible; AndysGold/1.0; +https://vercel.com)';
const num = s => Number(String(s).replace(/,/g, ''));
const N = '([0-9][0-9,]*(?:\\.[0-9]+)?)';

async function get(url, ms = 6000, extra = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, ...extra } });
    if (!r.ok) throw new Error(String(r.status));
    return r;
  } finally { clearTimeout(t); }
}

// "pay" = what a customer pays the dealer (iSagha "بيع"); "get" = what the dealer pays a customer ("شراء")
function parseLocal(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const out = {};
  for (const k of [14, 18, 21, 22, 24]) {
    // table row: label, sell(pay), gap, buy(get)
    let m = text.match(new RegExp('عيار\\s*' + k + '\\s+' + N + '\\s*ج\\.م\\s+' + N + '\\s*ج\\.م\\s+' + N + '\\s*ج\\.م'));
    if (m) { out[k] = { pay: num(m[1]), get: num(m[3]) }; continue; }
    // "now" strip: label, شراء X, بيع Y
    m = text.match(new RegExp('عيار\\s*' + k + '\\s*[▲▼]?\\s*شراء\\s*' + N + '\\s*ج\\.م\\s*بيع\\s*' + N));
    if (m) out[k] = { pay: num(m[2]), get: num(m[1]) };
  }
  const pm = text.match(new RegExp('جنيه ذهب\\s+' + N + '\\s*ج\\.م\\s+' + N + '\\s*ج\\.م\\s+' + N + '\\s*ج\\.م'));
  if (pm) out.pound = { pay: num(pm[1]), get: num(pm[3]) };
  const up = text.match(/آخر تحديث:\s*(\d{1,2}\s+\S+\s+\d{4}\s*-\s*\d{1,2}:\d{2}\s*\S{0,2})/);
  const k21 = out[21];
  if (!k21 || !(k21.pay > 1000 && k21.pay < 100000 && k21.get > 0 && k21.get <= k21.pay * 1.02)) return null;
  return { prices: out, updated: up ? up[1] : null };
}

module.exports = async (req, res) => {
  const result = { at: new Date().toISOString(), local: null, localUpdated: null, source: null };
  const [loc, gold, fx] = await Promise.allSettled([
    get('https://market.isagha.com/prices', 6000, { 'Accept-Language': 'ar,en;q=0.8' }).then(r => r.text()).then(parseLocal),
    get('https://api.gold-api.com/price/XAU').then(r => r.json()),
    get('https://open.er-api.com/v6/latest/USD').then(r => r.json())
  ]);
  if (loc.status === 'fulfilled' && loc.value) {
    result.local = loc.value.prices; result.localUpdated = loc.value.updated; result.source = 'isagha';
  }
  const oz = gold.status === 'fulfilled' ? Number(gold.value.price) : NaN;
  const rate = fx.status === 'fulfilled' ? Number(fx.value.rates && fx.value.rates.EGP) : NaN;
  if (oz > 0 && rate > 0) {
    result.oz = oz; result.fx = rate; result.raw21 = oz * rate / 31.1035 * 21 / 24;
    result.adj = Number(process.env.LOCAL_PREMIUM) || null;
    if (!result.source) result.source = 'world';
  }
  if (!result.local && !result.oz) return res.status(502).json({ error: 'no data source available' });
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  res.status(200).json(result);
};
module.exports.parseLocal = parseLocal;
