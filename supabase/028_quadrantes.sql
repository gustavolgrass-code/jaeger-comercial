-- Jaeger's Comercial · 028 · regiões de reposição refeitas pelos quadrantes da carteira
-- Canoas vira uma região só; Porto Alegre vira Leste, Norte e Centro (pelos grupos reais de clientes);
-- Minas do Leão vai para "Remoto" (entrega terceirizada); P4 e Gravataí, sem clientes, saem.
-- Cada região nova guarda o centro do grupo: ponto novo entra na região com o centro mais perto (até 8 km).

insert into regioes (codigo, nome, cor, dia_rota, limites) values
  ('CAN',    'Canoas',                         '#2a78d6', 2, '{"centro": [-51.17966, -29.92874], "raio": 8}'),
  ('POA-L',  'POA Leste',                      '#eb6834', 4, '{"centro": [-51.17585, -30.05759], "raio": 8}'),
  ('POA-N',  'POA Norte',                      '#7B4FC0', 4, '{"centro": [-51.17322, -30.01088], "raio": 8}'),
  ('POA-C',  'POA Centro',                     '#1baf7a', 4, '{"centro": [-51.21079, -30.02487], "raio": 8}'),
  ('REMOTO', 'Remoto · entrega terceirizada',  '#9A8F86', null, null)
on conflict (codigo) do update set nome = excluded.nome, cor = excluded.cor, dia_rota = excluded.dia_rota, limites = excluded.limites;

-- cada ponto com localização vai para o centro mais perto (distância aproximada em km)
with c(codigo, lat, lng) as (values ('CAN', -29.92874, -51.17966), ('POA-L', -30.05759, -51.17585), ('POA-N', -30.01088, -51.17322), ('POA-C', -30.02487, -51.21079)),
d as (
  select p.id, c.codigo, sqrt(power((p.lat - c.lat) * 111.2, 2) + power((p.lng - c.lng) * 96.3, 2)) km,
         row_number() over (partition by p.id order by power((p.lat - c.lat) * 111.2, 2) + power((p.lng - c.lng) * 96.3, 2)) n
  from pdvs p cross join c where p.lat is not null
)
update pdvs p set regiao = case when d.km <= 8 then d.codigo else 'REMOTO' end from d where d.id = p.id and d.n = 1;

-- sem localização: pela cidade
update pdvs set regiao = 'CAN' where lat is null and cidade ilike 'canoas';
update pdvs set regiao = null where lat is null and coalesce(regiao, '') in ('C1', 'C2', 'P1', 'P2', 'P3', 'P4', 'GRAVATAI', 'MINAS-DO-LEAO');

delete from regioes where codigo in ('C1', 'C2', 'P1', 'P2', 'P3', 'P4', 'GRAVATAI', 'MINAS-DO-LEAO')
  and not exists (select 1 from pdvs where regiao = regioes.codigo);

-- conferência: quantos pontos em cada região
select r.codigo, r.nome, r.dia_rota, count(p.id) pontos, count(p.id) filter (where p.etapa = 'ativo') ativos
from regioes r left join pdvs p on p.regiao = r.codigo group by 1, 2, 3 order by 1;
