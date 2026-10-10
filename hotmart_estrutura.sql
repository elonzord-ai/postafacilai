-- =====================================================================
-- Posta Fácil AI · estrutura da face HOTMART (face = 1)
-- Face 0 = Shopee / Mercado Livre (já existe). Face 1 = Hotmart.
-- Rode no SQL Editor do Supabase. Só adiciona coisas, não apaga nada:
-- tudo que já existe continua na face 0 (default 0).
--
-- ATENÇÃO: eu não vi o esquema do seu banco, só as chamadas que o site faz.
-- Os trechos marcados com "CONFIRA" dependem de como a sua tabela/função foi criada.
-- =====================================================================

-- 1) Coluna "face" nas tabelas que o mural lê
alter table public.anunciantes    add column if not exists face smallint not null default 0;
alter table public.patrocinadores add column if not exists face smallint not null default 0;

create index if not exists anunciantes_face_idx    on public.anunciantes (face);
create index if not exists patrocinadores_face_idx on public.patrocinadores (face);

-- 2) CONFIRA: tabela dos pedidos pendentes de Pix (o nome pode ser outro)
-- alter table public.pedidos add column if not exists face smallint not null default 0;

-- 3) CONFIRA: placas de patrocinador. Se existir uma regra "slot único",
--    ela precisa passar a valer por face (a Hotmart também tem as placas 1 a 12).
--    Descubra o nome da regra com:
--      select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'public.patrocinadores'::regclass;
--    e troque, por exemplo:
--      alter table public.patrocinadores drop constraint <nome_da_regra_antiga>;
--      alter table public.patrocinadores add constraint patrocinadores_face_slot_key unique (face, slot);

-- 4) CONFIRA: função que cria o pedido (o site chama /api/criar-pedido, que chama uma função do banco).
--    Três mudanças, sem as quais um bloco da Hotmart pode colidir com um da Shopee/ML
--    que esteja nas mesmas coordenadas:
--      a) receber o parâmetro novo:         p_face smallint default 0
--      b) conferir sobreposição só na face: ... where face = p_face and (retângulos se cruzam)
--      c) gravar a face no insert:          insert into ... (..., face) values (..., p_face)
--    A confirmação do pagamento (webhook) deve copiar a face do pedido para
--    public.anunciantes ao criar o anúncio.
--    O site já envia "p_face": 1 nas compras feitas na Hotmart (na Shopee/ML não envia nada).

-- 5) Conferência: quantos anúncios por face
-- select face, count(*) from public.anunciantes group by face order by face;
