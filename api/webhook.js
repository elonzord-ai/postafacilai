const sb = require('./_sb');

module.exports = async (req, res) => {
  try {
    const id = (req.body && req.body.data && req.body.data.id) || req.query['data.id'] || req.query.id;
    if (!id) return res.status(200).end();
    // confirma o pagamento direto na API do Mercado Pago (não confia no corpo da requisição)
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const p = await r.json();
    if (p.status === 'approved') {
      await sb('aprovar_pedido', { p_pedido: Number(p.external_reference), p_valor: Number(p.transaction_amount) });
    }
    res.status(200).end();
  } catch (e) {
    res.status(500).end();
  }
};
