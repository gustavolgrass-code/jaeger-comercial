-- =====================================================================
-- Jaeger's Comercial · 007 · funil de prospecção/carteira e agenda
-- Rodar uma vez no SQL Editor do Supabase.
-- =====================================================================

-- nova etapa: Perdido
alter type etapa_pdv add value if not exists 'perdido' after 'negociacao';

-- motivo de perda, data para retomar e motivo da última mudança de etapa
alter table pdvs add column if not exists motivo_perda text;
alter table pdvs add column if not exists retomar_em date;
alter table pdvs add column if not exists etapa_motivo text;

-- histórico de etapa passa a gravar o motivo
create or replace function registrar_etapa() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.etapa is distinct from old.etapa then
    insert into pdv_etapas (pdv_id, de, para, motivo, usuario_id)
    values (new.id, case when tg_op = 'UPDATE' then old.etapa end, new.etapa, new.etapa_motivo, auth.uid());
  end if;
  return new;
end $$;

-- tarefas (agenda): podem ou não estar ligadas a um negócio ou contato
create table if not exists tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  tipo text not null default 'visita',          -- visita, ligacao, whatsapp, reuniao, outro
  data date not null,
  hora time,                                     -- nula = sem horário
  duracao_min smallint not null default 30,
  concluida boolean not null default false,
  concluida_em timestamptz,
  pdv_id uuid references pdvs(id) on delete cascade,
  contato_id uuid references contatos(id) on delete set null,
  dono uuid references perfis(id) default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists tarefas_dono_data on tarefas (dono, data);
create index if not exists tarefas_pdv on tarefas (pdv_id) where not concluida;

alter table tarefas enable row level security;
drop policy if exists "logados leem" on tarefas;
drop policy if exists "logados gravam" on tarefas;
create policy "logados leem" on tarefas for select to authenticated using (true);
create policy "logados gravam" on tarefas for all to authenticated using (true) with check (true);

-- visão de resumo com tempo na etapa e próxima ação
drop view if exists v_pdv_resumo;
create view v_pdv_resumo as
with ultima as (
  select pdv_id, max(em) as ultima_visita
  from visitas where tipo in ('reposicao','abertura') group by pdv_id
), aval as (
  select s.pdv_id, count(*)::int as reposicoes, avg(s.sellout)::numeric(6,1) as media_sellout
  from v_sellout_visita s join pdvs p on p.id = s.pdv_id
  where p.avaliacao_inicio is not null and s.em >= p.avaliacao_inicio
  group by s.pdv_id
), desde as (
  select pdv_id, max(em) as etapa_desde from pdv_etapas group by pdv_id
)
select p.*,
       u.ultima_visita,
       coalesce(p.cadencia_dias, (r.valor ->> p.etapa::text)::int) as cadencia_efetiva,
       u.ultima_visita + make_interval(days => coalesce(p.cadencia_dias, (r.valor ->> p.etapa::text)::int)) as proxima_reposicao,
       a.reposicoes as aval_reposicoes,
       a.media_sellout as aval_media,
       c.nome as contato_nome,
       c.telefone as contato_telefone,
       coalesce(d.etapa_desde, p.criado_em) as etapa_desde,
       t.titulo as acao_titulo,
       t.data as acao_data,
       t.hora as acao_hora
from pdvs p
left join ultima u on u.pdv_id = p.id
left join aval a on a.pdv_id = p.id
left join contatos c on c.id = p.contato_id
left join desde d on d.pdv_id = p.id
left join regras r on r.chave = 'cadencia_padrao'
left join lateral (
  select titulo, data, hora from tarefas
  where pdv_id = p.id and not concluida
  order by data, hora nulls last limit 1
) t on true;
alter view v_pdv_resumo set (security_invoker = on);
