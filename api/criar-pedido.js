const sb = require('./_sb');
const KEY = () => process.env.SUPABASE_SERVICE_KEY;
const IMG_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

// Análise automática: reprova nudez/conteúdo sexual, violência explícita/mutilação, ódio, autolesão etc.
async function moderar(img) {
  if (!process.env.OPENAI_API_KEY) throw new Error('moderacao_indisponivel');
  const r = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url: img } }] })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.results) throw new Error('moderacao_indisponivel');
  if (j.results[0].flagged) throw new Error('imagem_reprovada');
}

async function subir(id, img) {
  const tipo = img.slice(5, img.indexOf(';'));
  const ext = tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg';
  const path = `pedido-${id}-${Date.now()}.${ext}`;
  const r = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/anuncios/${path}`, {
    method: 'POST',
    headers: { apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': tipo },
    body: Buffer.from(img.split(',')[1], 'base64')
  });
  if (!r.ok) throw new Error('falha_upload');
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/anuncios/${path}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    const img = b.imagem || '';
    if (img) {
      if (!IMG_OK.test(img) || img.length > 700000) throw new Error('imagem_invalida');
      await moderar(img); // antes de reservar a área
    }
    const ped = await sb('reservar_pedido', {
      p_x: b.p_x, p_y: b.p_y, p_w: b.p_w, p_h: b.p_h,
      p_nome: b.p_nome, p_link: b.p_link, p_cor: b.p_cor, p_nicho: b.p_nicho,
      p_preco: Number(process.env.PRECO_BLOCO || 5)
    });
    if (img) await sb('anexar_imagem', { p_pedido: ped.pedido, p_url: await subir(ped.pedido, img) });
    const mp = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `pedido-${ped.pedido}`
      },
      body: JSON.stringify({
        transaction_amount: Number(ped.valor),
        description: `Posta Fácil AI - ${ped.blocos} bloco(s)`,
        payment_method_id: 'pix',
        external_reference: String(ped.pedido),
        notification_url: `https://${req.headers.host}/api/webhook`,
        payer: { email: process.env.MP_PAYER_EMAIL || 'cliente@postafacil.ai' }
      })
    });
    const p = await mp.json();
    if (!mp.ok) throw new Error('falha_pix');
    await sb('anexar_pagamento', { p_pedido: ped.pedido, p_mp: String(p.id) });
    res.status(200).json({ pix: p.point_of_interaction.transaction_data.qr_code, codigo: ped.codigo });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
};
