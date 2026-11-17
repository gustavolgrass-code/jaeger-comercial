-- =====================================================================
-- Jaeger's Comercial · estrutura do banco de dados (Supabase / Postgres)
-- Rodar uma vez no SQL Editor do Supabase.
-- =====================================================================

-- ---------- tipos ----------
create type etapa_pdv as enum (
  'mapeado', 'visitado', 'negociacao', 'avaliacao',
  'revisao', 'ativo', 'risco', 'inativo'
);
create type papel_usuario as enum ('comercial', 'operacao', 'admin');
create type tipo_visita as enum ('prospeccao', 'abertura', 'reposicao');
create type tipo_pedido as enum ('abertura', 'reposicao', 'reposicao_consignado');

-- ---------- usuários ----------
create table perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  papel papel_usuario not null default 'comercial',
  criado_em timestamptz not null default now()
);

-- ---------- regras gerais (editáveis na aba Regras) ----------
create table regras (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- ---------- regiões ----------
create table regioes (
  codigo text primary key,              -- C1, C2, P1...
  nome text not null,
  cor text not null default '#8C6B55',
  dia_rota smallint check (dia_rota between 0 and 6),  -- 0 = domingo
  limites jsonb                          -- polígono [[lng,lat],...] ou caixa
);

-- ---------- produtos e expositores ----------
create table produtos (
  id serial primary key,
  linha text not null,                   -- Brownie do Monkey, Palha italiana Baccaro, Cookie Baccaro
  sabor text not null,
  marca text not null,                   -- Monkey ou Baccaro
  custo numeric(10,2) not null,
  preco numeric(10,2) not null,
  bling_produto_id text,
  ordem smallint not null default 0,
  ativo boolean not null default true,
  unique (linha, sabor)
);

create table expositores (
  id serial primary key,
  nome text not null,                    -- 1 andar, 2 andares, 3 andares
  capacidade smallint not null,
  custo numeric(10,2)
);

-- quantidade alvo de cada sabor em cada tipo de expositor (base da sugestão de reposição)
create table expositor_alvo (
  expositor_id int references expositores(id) on delete cascade,
  produto_id int references produtos(id) on delete cascade,
  quantidade smallint not null,
  primary key (expositor_id, produto_id)
);

-- ---------- pontos de venda ----------
create table pdvs (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  razao_social text,
  cnpj text,
  telefone text,
  contato text,                          -- quem decide
  endereco text,
  bairro text,
  cidade text,
  lat double precision,
  lng double precision,
  regiao text references regioes(codigo),
  canal text,                            -- Minimercado, Padaria, Fruteira...
  etapa etapa_pdv not null default 'mapeado',
  potencial smallint check (potencial between 1 and 5),
  classe text check (classe in ('A','B','C')),
  origem text not null default 'manual', -- manual, sugestao, link_maps, carteira_atual
  link_maps text,
  place_id text,                         -- id do lugar no OpenStreetMap ou Google
  expositor_id int references expositores(id),
  condicao text,                         -- À vista · Pix, A prazo · 14 dias, Consignado...
  pedido_minimo numeric(10,2) default 150,
  cadencia_dias smallint,                -- nulo = usa o padrão da etapa
  avaliacao_inicio date,
  observacao text,
  bling_contato_id text,
  criado_por uuid references perfis(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on pdvs (etapa);
create index on pdvs (regiao);

-- histórico de etapas (quem moveu, quando e por quê)
create table pdv_etapas (
  id bigserial primary key,
  pdv_id uuid not null references pdvs(id) on delete cascade,
  de etapa_pdv,
  para etapa_pdv not null,
  motivo text,
  usuario_id uuid references perfis(id),
  em timestamptz not null default now()
);

-- ---------- visitas e contagens ----------
create table visitas (
  id uuid primary key default gen_random_uuid(),
  pdv_id uuid not null references pdvs(id) on delete cascade,
  usuario_id uuid references perfis(id),
  tipo tipo_visita not null,
  em timestamptz not null default now(),
  resultado text,
  observacao text,
  foto_path text                         -- arquivo no Storage do Supabase
);
create index on visitas (pdv_id, em desc);

create table contagens (
  visita_id uuid not null references visitas(id) on delete cascade,
  produto_id int not null references produtos(id),
  deixado_anterior smallint not null default 0,  -- o que ficou no expositor na visita anterior
  encontrado smallint not null default 0,        -- o que tinha agora
  troca smallint not null default 0,
  reposto smallint not null default 0,
  sellout smallint generated always as (greatest(deixado_anterior - encontrado, 0)) stored,
  deixado_agora smallint generated always as (greatest(encontrado - troca, 0) + reposto) stored,
  primary key (visita_id, produto_id)
);

-- ---------- pedidos ----------
create table pedidos (
  id uuid primary key default gen_random_uuid(),
  numero bigserial unique,
  pdv_id uuid not null references pdvs(id),
  visita_id uuid references visitas(id),
  tipo tipo_pedido not null,
  condicao text not null,
  unidades int not null default 0,
  valor numeric(10,2) not null default 0,
  pago_na_hora boolean not null default false,
  vencimento date,
  bling_pedido_id text,
  bling_status text default 'pendente',  -- pendente, enviado, erro
  bling_erro text,
  criado_por uuid references perfis(id),
  criado_em timestamptz not null default now()
);
create index on pedidos (criado_em desc);

create table pedido_itens (
  pedido_id uuid references pedidos(id) on delete cascade,
  produto_id int references produtos(id),
  quantidade int not null,
  bonificado int not null default 0,
  preco_unit numeric(10,2) not null,
  primary key (pedido_id, produto_id)
);

-- ---------- visões para as telas ----------
-- sell-out de cada reposição (uma linha por visita)
create view v_sellout_visita as
select v.pdv_id, v.id as visita_id, v.em,
       sum(c.sellout)::int as sellout,
       sum(c.troca)::int as trocas,
       sum(c.reposto)::int as reposto,
       sum(c.sellout * p.preco)::numeric(10,2) as valor_sellout
from visitas v
join contagens c on c.visita_id = v.id
join produtos p on p.id = c.produto_id
where v.tipo = 'reposicao'
group by v.pdv_id, v.id, v.em;

-- resumo por PDV: última visita, próxima reposição e avaliação
create view v_pdv_resumo as
with ultima as (
  select pdv_id, max(em) as ultima_visita
  from visitas where tipo in ('reposicao','abertura') group by pdv_id
), aval as (
  select s.pdv_id, count(*)::int as reposicoes, avg(s.sellout)::numeric(6,1) as media_sellout
  from v_sellout_visita s join pdvs p on p.id = s.pdv_id
  where p.avaliacao_inicio is not null and s.em >= p.avaliacao_inicio
  group by s.pdv_id
)
select p.*,
       u.ultima_visita,
       coalesce(p.cadencia_dias, (r.valor ->> p.etapa::text)::int) as cadencia_efetiva,
       u.ultima_visita + make_interval(days => coalesce(p.cadencia_dias, (r.valor ->> p.etapa::text)::int)) as proxima_reposicao,
       a.reposicoes as aval_reposicoes,
       a.media_sellout as aval_media
from pdvs p
left join ultima u on u.pdv_id = p.id
left join aval a on a.pdv_id = p.id
left join regras r on r.chave = 'cadencia_padrao';

-- ---------- atualizado_em automático ----------
create or replace function tocar_atualizado() returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;
create trigger pdvs_atualizado before update on pdvs
  for each row execute function tocar_atualizado();

-- ---------- histórico de etapa automático ----------
create or replace function registrar_etapa() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then
    insert into pdv_etapas (pdv_id, de, para, usuario_id)
    values (new.id, case when tg_op = 'UPDATE' then old.etapa end, new.etapa, auth.uid());
  end if;
  return new;
end $$;
create trigger pdvs_etapa after insert or update of etapa on pdvs
  for each row execute function registrar_etapa();

-- ---------- segurança: só usuários logados acessam ----------
do $$
declare t text;
begin
  foreach t in array array['perfis','regras','regioes','produtos','expositores','expositor_alvo',
                           'pdvs','pdv_etapas','visitas','contagens','pedidos','pedido_itens']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "logados leem" on %I for select to authenticated using (true)', t);
    execute format('create policy "logados gravam" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
alter view v_sellout_visita set (security_invoker = on);
alter view v_pdv_resumo set (security_invoker = on);
