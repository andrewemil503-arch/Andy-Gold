// Vercel serverless function: GET /api/news
// Reads free Google News RSS feeds, scores headlines from the last 48 hours for their likely effect on Egyptian gold prices.
const UA = 'Mozilla/5.0 (compatible; AndysGold/1.0)';
const FEEDS = [
  ['gold', 'gold price', 'en-US', 'US', 'US:en'],
  ['gold', 'gold dollar safe haven', 'en-US', 'US', 'US:en'],
  ['rates', 'Federal Reserve interest rates', 'en-US', 'US', 'US:en'],
  ['egp', 'Egyptian pound dollar', 'en-US', 'US', 'US:en'],
  ['tension', 'Middle East war ceasefire', 'en-US', 'US', 'US:en'],
  ['gold', 'أسعار الذهب اليوم', 'ar', 'EG', 'EG:ar'],
  ['egp', 'سعر الدولار الجنيه المصري', 'ar', 'EG', 'EG:ar']
];
const LEX = {
  gold: { pos: /gold[^.]{0,40}\b(rise|rises|rose|gain|gains|gained|jump|jumps|surge|surges|climb|climbs|rally|rallies|record|higher)\b|safe[- ]haven (demand|buying)|ذهب[^.]{0,25}(يرتفع|ارتفاع|ترتفع|صعود|يقفز)|ارتفاع[^.]{0,15}الذهب/i,
          neg: /gold[^.]{0,40}\b(fall|falls|fell|drop|drops|dropped|slip|slips|slide|slides|slump|decline|declines|lower|retreat|retreats)\b|stronger dollar|weekly loss|ذهب[^.]{0,25}(ينخفض|انخفاض|تنخفض|هبوط|تراجع|يتراجع)|تراجع[^.]{0,15}الذهب|انخفاض[^.]{0,15}الذهب/i },
  rates: { pos: /rate[- ]cut|cuts? (interest )?rates|easing|dovish|lower rates|خفض (أسعار )?الفائدة/i,
           neg: /rate[- ]hike|hike rates|raise rates|hawkish|higher for longer|رفع (أسعار )?الفائدة/i },
  egp: { pos: /pound[^.]{0,40}(fall|falls|weak|weakens|record low|slide|slides|depreciat|devalu)|dollar[^.]{0,30}(rises|climbs|gains|jumps)|الجنيه[^.]{0,25}(تراجع|يتراجع|ينخفض|هبوط)|الدولار[^.]{0,25}(يرتفع|ارتفاع|يقفز)/i,
         neg: /pound[^.]{0,40}(gain|gains|strengthen|strengthens|rise|rises|rally|appreciat)|dollar[^.]{0,30}(falls|drops|slips|declines)|الجنيه[^.]{0,25}(يرتفع|ارتفاع|يتحسن)|الدولار[^.]{0,25}(ينخفض|تراجع|يتراجع|هبوط)/i },
  tension: { pos: /\b(war|attack|attacks|strike|strikes|missile|conflict|tension|tensions|escalat\w*|sanctions|invasion)\b|حرب|هجوم|تصعيد|توتر/i,
             neg: /ceasefire|peace deal|truce|de-escalat\w*|هدنة|وقف إطلاق|تهدئة/i }
};
const dec = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
function parse(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const b = m[1], g = t => { const x = b.match(new RegExp('<' + t + '[^>]*>([\\s\\S]*?)</' + t + '>')); return x ? dec(x[1]) : ''; };
    let title = g('title'), src = g('source');
    if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
    return { title, link: g('link'), date: new Date(g('pubDate')).getTime(), src };
  }).filter(i => i.title && /^https?:\/\//.test(i.link) && i.date);
}
async function feed([topic, q, hl, gl, ceid]) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 7000);
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:2d')}&hl=${hl}&gl=${gl}&ceid=${ceid}`, { signal: c.signal, headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(String(r.status));
    return parse(await r.text()).map(i => ({ ...i, topic }));
  } finally { clearTimeout(t); }
}
module.exports = async (req, res) => {
  const now = Date.now(), seen = new Set(), items = [];
  for (const r of await Promise.allSettled(FEEDS.map(feed))) if (r.status === 'fulfilled') for (const i of r.value) {
    const key = i.title.toLowerCase().slice(0, 60);
    if (seen.has(key) || now - i.date > 48 * 36e5 || i.date > now + 36e5) continue;
    seen.add(key);
    const L = LEX[i.topic]; i.score = L.pos.test(i.title) ? 1 : L.neg.test(i.title) ? -1 : 0;
    items.push(i);
  }
  if (!items.length) return res.status(502).json({ error: 'news unavailable' });
  const scores = {};
  for (const tp of Object.keys(LEX)) {
    let sum = 0, w = 0;
    for (const i of items) if (i.topic === tp) { const k = now - i.date < 12 * 36e5 ? 1.5 : 1; sum += k * i.score; w += k; }
    scores[tp] = Math.max(-1, Math.min(1, sum / (w + 3)));
  }
  const composite = .35 * scores.gold + .30 * scores.egp + .20 * scores.rates + .15 * scores.tension;
  items.sort((a, b) => (Math.abs(b.score) - Math.abs(a.score)) || (b.date - a.date));
  const top = items.slice(0, 8).sort((a, b) => b.date - a.date).map(({ title, link, src, date, topic, score }) => ({ title, link, src, date, topic, score }));
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
  res.status(200).json({ at: new Date().toISOString(), count: items.length, scores, composite, items: top });
};
module.exports.parse = parse;
