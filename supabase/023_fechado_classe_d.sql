-- Jaeger's Comercial · 023 · etapa "Estabelecimento fechado" e classe D
alter type etapa_pdv add value if not exists 'fechado';
alter table pdvs drop constraint if exists pdvs_classe_check;
alter table pdvs add constraint pdvs_classe_check check (classe in ('A', 'B', 'C', 'D'));
