-- Jaeger's Comercial · 024 · marca o contato que é o comprador
alter table contatos add column if not exists comprador boolean not null default false;
