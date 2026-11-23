-- Jaeger's Comercial · 032 · carga do carro ajustada à mão em cada rota
alter table rotas add column if not exists carga jsonb;   -- {produto_id: quantidade}; vazio = usa a sugestão
