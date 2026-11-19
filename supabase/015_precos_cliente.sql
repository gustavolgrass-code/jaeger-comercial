-- Jaeger's Comercial · 015 · preço combinado por cliente (por produto)
alter table pdvs add column if not exists precos jsonb not null default '{}'::jsonb;
