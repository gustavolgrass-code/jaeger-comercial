-- Jaeger's Comercial · 033 · endereço em campos separados (rua, número, bairro, cidade, UF, CEP), como no Google Maps
alter table pdvs add column if not exists numero text;
alter table pdvs add column if not exists uf text;
alter table pdvs add column if not exists cep text;

-- a view lista as colunas de pdvs, então é recriada para incluir a nova coluna
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
), prosp as (
  select distinct on (pdv_id) pdv_id, em as ultima_prospeccao, resultado as ultimo_resultado
  from visitas where tipo = 'prospeccao' order by pdv_id, em desc
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
       t.hora as acao_hora,
       pr.ultima_prospeccao,
       pr.ultimo_resultado
from pdvs p
left join ultima u on u.pdv_id = p.id
left join aval a on a.pdv_id = p.id
left join contatos c on c.id = p.contato_id
left join desde d on d.pdv_id = p.id
left join prosp pr on pr.pdv_id = p.id
left join regras r on r.chave = 'cadencia_padrao'
left join lateral (
  select titulo, data, hora from tarefas
  where pdv_id = p.id and not concluida
  order by data, hora nulls last limit 1
) t on true;
alter view v_pdv_resumo set (security_invoker = on);
