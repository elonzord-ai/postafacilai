// Vercel serverless · /api/capa
//   GET /api/capa?u=<link>   -> { titulo, legenda, imagem, fonte }  (capa oficial do link, como o X faz;
//                               se a página não tiver capa, tira um print dela)
//   GET /api/capa?img=<url>  -> devolve a imagem (https) para o site reduzir e guardar no banco
// Não precisa de chave. Se quiser mais prints por dia, crie MICROLINK_KEY nas variáveis do Vercel.
const dns = require("dns").promises;
const net = require("net");

const hits = new Map();
function limite(ip) {
  const agora = Date.now(), h = (hits.get(ip) || []).filter(t => agora - t < 60000);
  h.push(agora); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > 30;
}
function privado(ip) {
  if (net.isIPv6(ip)) return /^(::1|fc|fd|fe80)/i.test(ip) || ip === "::";
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}
async function seguro(u) {
  let x; try { x = new URL(u); } catch { throw new Error("link_invalido"); }
  if (x.protocol !== "https:") throw new Error("link_invalido");
  if (/^(localhost|.*\.(local|internal))$/i.test(x.hostname)) throw new Error("link_invalido");
  const ips = net.isIP(x.hostname) ? [x.hostname] : (await dns.lookup(x.hostname, { all: true })).map(r => r.address);
  if (!ips.length || ips.some(privado)) throw new Error("link_invalido");
  return x;
}
async function get(u, opt = {}, max = 1500000) {
  await seguro(u);
  const c = new AbortController(), t = setTimeout(() => c.abort(), 9000);
  try {
    const r = await fetch(u, { redirect: "follow", signal: c.signal, headers: { "user-agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", accept: opt.accept || "text/html,*/*", "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" } });
    await seguro(r.url);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new Error("grande");
    return { r, buf };
  } finally { clearTimeout(t); }
}
const dec = s => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).trim();
function meta(html, nomes) {
  for (const n of nomes) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    if (m && m[1]) return dec(m[1]);
  }
  return "";
}
function abs(base, u) { try { return new URL(u, base).toString(); } catch { return ""; } }

async function viaX(x) {
  const m = x.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
  if (!m) return null;
  const r = await get(`https://api.fxtwitter.com/${m[1]}/status/${m[2]}`, { accept: "application/json" });
  const t = JSON.parse(r.buf.toString("utf8")).tweet;
  if (!t) return null;
  const foto = t.media && ((t.media.photos && t.media.photos[0] && t.media.photos[0].url) || (t.media.videos && t.media.videos[0] && t.media.videos[0].thumbnail_url));
  return { titulo: `${t.author && t.author.name || m[1]} (@${m[1]})`, legenda: t.text || "", imagem: foto || (t.author && t.author.avatar_url) || "", fonte: "x" };
}
async function print(u) {
  const k = process.env.MICROLINK_KEY ? { "x-api-key": process.env.MICROLINK_KEY } : {};
  const q = `https://api.microlink.io/?url=${encodeURIComponent(u)}&screenshot=true&meta=false&viewport.width=900&viewport.height=1200&waitUntil=networkidle2`;
  const c = new AbortController(), t = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(q, { signal: c.signal, headers: k });
    const j = await r.json();
    return j && j.data && j.data.screenshot && j.data.screenshot.url || "";
  } catch { return ""; } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=300");
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "x";
  if (limite(ip)) return res.status(429).json({ erro: "devagar" });
  try {
    const q = req.query || {};
    if (q.img) {
      const { r, buf } = await get(String(q.img), { accept: "image/*" }, 6000000);
      const tipo = (r.headers.get("content-type") || "").split(";")[0];
      if (!/^image\/(jpeg|png|webp|gif|avif)$/i.test(tipo)) return res.status(415).json({ erro: "nao_imagem" });
      res.setHeader("Content-Type", tipo);
      return res.status(200).send(buf);
    }
    const u = String(q.u || "");
    const x = await seguro(u);
    let o = null;
    if (/(^|\.)(x|twitter)\.com$/i.test(x.hostname)) { try { o = await viaX(x); } catch {} }
    if (!o || !o.imagem) {
      let titulo = "", legenda = "", imagem = "";
      try {
        const { r, buf } = await get(u);
        const html = buf.toString("utf8");
        titulo = meta(html, ["og:title", "twitter:title"]) || dec((html.match(/<title[^>]*>([^<]*)/i) || [])[1]);
        legenda = meta(html, ["og:description", "twitter:description", "description"]);
        const im = meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);
        imagem = im ? abs(r.url, im) : "";
      } catch {}
      o = { titulo: titulo || (o && o.titulo) || x.hostname, legenda: legenda || (o && o.legenda) || "", imagem, fonte: "pagina" };
    }
    if (!o.imagem) { o.imagem = await print(u); o.fonte = o.imagem ? "print" : "nenhuma"; }
    return res.status(200).json({ titulo: o.titulo.slice(0, 140), legenda: o.legenda.slice(0, 600), imagem: o.imagem, fonte: o.fonte });
  } catch (e) {
    return res.status(400).json({ erro: String(e.message || "falha").slice(0, 40) });
  }
};
