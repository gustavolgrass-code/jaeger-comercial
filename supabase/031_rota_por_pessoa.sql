-- Jaeger's Comercial · 031 · uma rota por pessoa no mesmo dia (Gustavo e Moisés podem rodar no mesmo dia)
update rotas set motorista = (select id from perfis order by (nome ilike 'gustavo%') desc limit 1) where motorista is null;
alter table rotas alter column motorista set not null;
alter table rotas drop constraint if exists rotas_pkey;
alter table rotas add primary key (data, motorista);
