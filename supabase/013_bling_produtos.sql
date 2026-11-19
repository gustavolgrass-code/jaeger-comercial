-- Jaeger's Comercial · 013 · vínculo dos produtos do app com o Bling (código/SKU)
alter table produtos add column if not exists bling_codigo text;
