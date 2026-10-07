const sb = require('./_sb');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    const ped = await sb('reservar_pedido', {
      p_x: b.p_x, p_y: b.p_y, p_w: b.p_w, p_h: b.p_h,
      p_nome: b.p_nome, p_link: b.p_link, p_cor: b.p_cor, p_nicho: b.p_nicho,
      p_preco: Number(process.env.PRECO_BLOCO || 5)
    });
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
