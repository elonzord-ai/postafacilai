-- =====================================================================
-- Posta Fácil AI · SPACE (sala de voz ao vivo estilo X) dentro da janela Raid
-- Rode DEPOIS do raid_estrutura.sql. Só cria coisas novas.
-- O áudio vai direto entre os aparelhos (WebRTC). O banco só guarda quem está
-- na sala e troca as "mensagens de conexão" entre as pessoas.
-- =====================================================================

create table if not exists public.space_sala (
  id smallint primary key default 1 check (id = 1),
  ativa boolean not null default false,
  host text, titulo text, iniciada_em timestamptz
);
insert into public.space_sala (id) values (1) on conflict do nothing;

create table if not exists public.space_part (
  quem text primary key,
  nome text,
  papel text not null default 'ouvinte' check (papel in ('host','falante','ouvinte')),
  mao boolean not null default false,
  mudo boolean not null default true,
  reacao text, reacao_em timestamptz,
  visto_em timestamptz not null default now()
);

create table if not exists public.space_sinal (
  id bigserial primary key,
  de text not null, para text not null,
  tipo text not null check (tipo in ('offer','answer','ice')),
  dados jsonb not null,
  em timestamptz not null default now()
);
create index if not exists space_sinal_para_idx on public.space_sinal (para, id);

alter table public.space_sala  enable row level security;
alter table public.space_part  enable row level security;
alter table public.space_sinal enable row level security;
revoke all on public.space_sala, public.space_part, public.space_sinal from anon, authenticated;

-- limpeza: quem sumiu por 20 s sai; se o host sumiu, a sala fecha; sinais velhos somem
create or replace function public.space__limpar() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.space_part where visto_em < now() - interval '20 seconds';
  delete from public.space_sinal where em < now() - interval '2 minutes';
  update public.space_sala s set ativa = false
   where s.id = 1 and s.ativa and not exists (select 1 from public.space_part p where p.quem = s.host and p.papel = 'host');
  if not (select ativa from public.space_sala where id = 1) then
    delete from public.space_part; delete from public.space_sinal;
  end if;
end $$;
revoke all on function public.space__limpar() from public, anon, authenticated;

-- uma chamada: (se estiver dentro) marca presença e devolve sala, pessoas e sinais novos para mim
create or replace function public.space_sync(p_codigo text, p_dentro boolean default false, p_ultimo bigint default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q record; res jsonb;
begin
  select * into q from public.raid__quem(p_codigo);
  if p_dentro then update public.space_part set visto_em = now(), nome = q.o_nome where quem = q.o_id; end if;
  perform public.space__limpar();
  select jsonb_build_object(
    'eu', q.o_id,
    'sala', (select to_jsonb(s) - 'id' from public.space_sala s where s.id = 1),
    'partes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.quem, 'nome', p.nome, 'papel', p.papel, 'mao', p.mao, 'mudo', p.mudo,
        'v', coalesce(rp.pfp_v, 0),
        'r', case when p.reacao_em > now() - interval '7 seconds' then p.reacao end,
        'rt', case when p.reacao_em > now() - interval '7 seconds' then extract(epoch from p.reacao_em) end)
        order by (p.papel = 'host') desc, (p.papel = 'falante') desc, p.mao desc, p.nome)
        from public.space_part p left join public.raid_presenca rp on rp.quem = p.quem), '[]'::jsonb),
    'sinais', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'de', x.de, 'tipo', x.tipo, 'dados', x.dados) order by x.id)
        from (select * from public.space_sinal where para = q.o_id and id > p_ultimo order by id limit 100) x), '[]'::jsonb)
  ) into res;
  return res;
end $$;

create or replace function public.space_iniciar(p_codigo text, p_titulo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  if q.o_papel <> 'admin' then raise exception 'so_admin'; end if;
  delete from public.space_part; delete from public.space_sinal;
  update public.space_sala set ativa = true, host = q.o_id, titulo = left(nullif(btrim(coalesce(p_titulo,'')),''), 80), iniciada_em = now() where id = 1;
  insert into public.space_part (quem, nome, papel, mudo) values (q.o_id, q.o_nome, 'host', false);
  return 'ok';
end $$;

create or replace function public.space_encerrar(p_codigo text)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  if q.o_papel <> 'admin' then raise exception 'so_admin'; end if;
  update public.space_sala set ativa = false where id = 1;
  delete from public.space_part; delete from public.space_sinal;
  return 'ok';
end $$;

create or replace function public.space_entrar(p_codigo text)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  perform public.space__limpar();
  if not (select ativa from public.space_sala where id = 1) then raise exception 'sem_space'; end if;
  if (select count(*) from public.space_part) >= 30 and not exists (select 1 from public.space_part where quem = q.o_id) then raise exception 'lotado'; end if;
  delete from public.space_sinal where para = q.o_id or de = q.o_id;
  insert into public.space_part (quem, nome, papel, mudo, visto_em)
    values (q.o_id, q.o_nome, case when q.o_papel = 'admin' and (select host from public.space_sala where id = 1) = q.o_id then 'host' else 'ouvinte' end, true, now())
    on conflict (quem) do update set visto_em = now(), nome = excluded.nome;
  return 'ok';
end $$;

create or replace function public.space_sair(p_codigo text)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  delete from public.space_part where quem = q.o_id and papel <> 'host';
  delete from public.space_sinal where para = q.o_id or de = q.o_id;
  if q.o_papel = 'admin' then update public.space_sala set ativa = false where id = 1 and host = q.o_id; perform public.space__limpar(); end if;
  return 'ok';
end $$;

create or replace function public.space_mao(p_codigo text, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  update public.space_part set mao = coalesce(p_on,false) where quem = q.o_id and papel = 'ouvinte';
  return 'ok';
end $$;

-- só o admin chama alguém para falar ou tira do palco
create or replace function public.space_papel(p_codigo text, p_alvo text, p_papel text)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  if q.o_papel <> 'admin' then raise exception 'so_admin'; end if;
  if p_papel not in ('falante','ouvinte') then raise exception 'papel_invalido'; end if;
  if (select count(*) from public.space_part where papel in ('host','falante')) >= 8 and p_papel = 'falante' then raise exception 'palco_cheio'; end if;
  update public.space_part set papel = p_papel, mao = false, mudo = true where quem = p_alvo and papel <> 'host';
  return 'ok';
end $$;

create or replace function public.space_mudo(p_codigo text, p_mudo boolean)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  update public.space_part set mudo = coalesce(p_mudo,true) where quem = q.o_id and papel in ('host','falante');
  return 'ok';
end $$;

create or replace function public.space_reagir(p_codigo text, p_emoji text)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  if p_emoji not in ('❤️','🔥','👏','😂','🚀','💎','✊','👀') then raise exception 'emoji_invalido'; end if;
  update public.space_part set reacao = p_emoji, reacao_em = now() where quem = q.o_id;
  return 'ok';
end $$;

create or replace function public.space_sinal(p_codigo text, p_para text, p_tipo text, p_dados jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare q record;
begin
  select * into q from public.raid__quem(p_codigo);
  if not exists (select 1 from public.space_part where quem = q.o_id) then raise exception 'fora_do_space'; end if;
  if p_tipo not in ('offer','answer','ice') or length(p_dados::text) > 12000 then raise exception 'sinal_invalido'; end if;
  insert into public.space_sinal (de, para, tipo, dados) values (q.o_id, p_para, p_tipo, p_dados);
  return 'ok';
end $$;

grant execute on function public.space_sync(text,boolean,bigint)  to anon, authenticated;
grant execute on function public.space_iniciar(text,text)         to anon, authenticated;
grant execute on function public.space_encerrar(text)             to anon, authenticated;
grant execute on function public.space_entrar(text)               to anon, authenticated;
grant execute on function public.space_sair(text)                 to anon, authenticated;
grant execute on function public.space_mao(text,boolean)          to anon, authenticated;
grant execute on function public.space_papel(text,text,text)      to anon, authenticated;
grant execute on function public.space_mudo(text,boolean)         to anon, authenticated;
grant execute on function public.space_reagir(text,text)          to anon, authenticated;
grant execute on function public.space_sinal(text,text,text,jsonb) to anon, authenticated;
