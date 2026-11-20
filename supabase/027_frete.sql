-- Jaeger's Comercial · 027 · entrega terceirizada: custo do frete no pedido
alter table pedidos add column if not exists frete numeric(10,2);           -- custo da entrega terceirizada
alter table pedidos add column if not exists frete_cobrado boolean not null default true; -- true: soma no pedido (cliente paga) · false: por nossa conta
