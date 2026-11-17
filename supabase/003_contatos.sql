-- =====================================================================
-- Jaeger's Comercial · 003 · contatos separados dos negócios
-- Rodar uma vez no SQL Editor do Supabase (depois do 001 e do 002).
-- =====================================================================

-- contato = a pessoa (e a empresa dela); negócio = o ponto de venda no funil (tabela pdvs)
create table contatos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  empresa text,
  cargo text,
  telefone text,
  whatsapp text,
  email text,
  cnpj text,
  observacao text,
  criado_por uuid references perfis(id),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on contatos (lower(nome));

alter table pdvs add column contato_id uuid references contatos(id) on delete set null;
alter table pdvs add column geo_precisao text;   -- exata, rua, cidade, manual
create index on pdvs (contato_id);

create trigger contatos_atualizado before update on contatos
  for each row execute function tocar_atualizado();

alter table contatos enable row level security;
create policy "logados leem" on contatos for select to authenticated using (true);
create policy "logados gravam" on contatos for all to authenticated using (true) with check (true);

-- a visão de resumo precisa ser recriada para incluir as colunas novas
drop view v_pdv_resumo;
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
       a.media_sellout as aval_media,
       c.nome as contato_nome,
       c.telefone as contato_telefone
from pdvs p
left join ultima u on u.pdv_id = p.id
left join aval a on a.pdv_id = p.id
left join contatos c on c.id = p.contato_id
left join regras r on r.chave = 'cadencia_padrao';
alter view v_pdv_resumo set (security_invoker = on);
