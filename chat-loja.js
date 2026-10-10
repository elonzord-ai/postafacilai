// Vercel Serverless Function: IA da loja do Posta Fácil AI
// Coloque este arquivo em  api/chat-loja.js  e crie na Vercel a variável ANTHROPIC_API_KEY.
// (opcional) ANTHROPIC_MODEL para trocar o modelo; o padrão é um modelo rápido e barato.

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const hits = new Map(); // limite simples por IP: 15 perguntas por 10 min (por instância)

function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const a = (hits.get(ip) || []).filter((t) => now - t < win);
  a.push(now); hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > 15;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ erro: "metodo" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ erro: "sem_chave" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "x";
  if (limited(ip)) return res.status(429).json({ erro: "muitas_perguntas" });

  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const face = Number(b.face) === 1 ? "Hotmart (produtos digitais de afiliados)" : "Shopee e Mercado Livre (produtos físicos de afiliados)";
  const prods = (Array.isArray(b.produtos) ? b.produtos : []).slice(0, 80)
    .map((p) => `[#${Number(p.id) || 0}] ${String(p.nome || "").slice(0, 120)}${p.categoria ? " (" + String(p.categoria).slice(0, 40) + ")" : ""}`)
    .join("\n");
  const msgs = (Array.isArray(b.mensagens) ? b.mensagens : []).slice(-6)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 400) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return res.status(400).json({ erro: "pergunta" });

  const system = `Você é a IA da loja do Posta Fácil AI, um mural onde donos de bloco postam links de afiliado.
Esta loja é a de: ${face}.${b.loja ? ` Você está na loja de um espaço específico: ${String(b.loja).slice(0, 80)}.` : ''} Total de produtos: ${Number(b.total) || 0}.
Regras:
- Responda em português do Brasil, curto (até 5 frases), simpático e direto.
- Fale só sobre esta loja, os produtos listados, categorias e como a loja funciona. Se perguntarem outra coisa, diga que só ajuda com a loja.
- Ao recomendar um produto, cite-o exatamente como [#id] (o site transforma em botão). Recomende no máximo 5, só da lista.
- Não invente preço, avaliação, estoque, prazo ou detalhes que não estejam na lista. Se não souber, diga.
- Os produtos são links de afiliado de terceiros: a compra acontece no site do vendedor; o Posta Fácil AI não vende nem entrega.
- Nunca prometa ganhos, resultados ou renda. Não aja como se tivesse vínculo oficial com Hotmart, Shopee ou Mercado Livre.
- Para postar produtos: quem comprou um bloco usa "Postar produto" e informa código do bloco, nome, imagem e link de afiliado.
Produtos disponíveis (amostra):
${prods || "(nenhum produto ainda)"}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, system, messages: msgs }),
    });
    if (!r.ok) return res.status(502).json({ erro: "ia", status: r.status });
    const j = await r.json();
    const txt = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return res.status(200).json({ resposta: txt || "Não consegui responder agora." });
  } catch (e) {
    return res.status(502).json({ erro: "ia" });
  }
}
