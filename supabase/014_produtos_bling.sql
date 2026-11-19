-- Jaeger's Comercial · 014 · catálogo igual ao do Bling + configuração do envio de pedidos
-- Pode rodar de novo sem problema.
alter table produtos add column if not exists bling_codigo text;

-- Brownie do Monkey (Bling: B1 a B4, R$ 4,50)
update produtos set sabor = 'Tradicional', preco = 4.50, bling_codigo = 'B1', bling_produto_id = '16728491266', ordem = 1, ativo = true where id = 1;
update produtos set sabor = 'M&M''s',      preco = 4.50, bling_codigo = 'B2', bling_produto_id = '16728491267', ordem = 2, ativo = true where id = 2;
update produtos set sabor = 'Beijinho',    preco = 4.50, bling_codigo = 'B3', bling_produto_id = '16728491269', ordem = 3, ativo = true where id = 3;
update produtos set sabor = 'Stikadinho',  preco = 4.50, bling_codigo = 'B4', bling_produto_id = '16728491270', ordem = 4, ativo = true where id = 4;
-- sabores que não existem no Bling saem da lista
update produtos set ativo = false where id in (5, 6, 7);
delete from expositor_alvo where produto_id in (5, 6, 7);
-- Cookies (Bling: C1 a C4, R$ 4,75)
update produtos set preco = 4.75, bling_codigo = 'C1', bling_produto_id = '16728491271', ordem = 5  where id = 13; -- Gotas de Chocolate
update produtos set preco = 4.75, bling_codigo = 'C2', bling_produto_id = '16728491272', ordem = 6  where id = 11; -- Brigadeiro de Panela
update produtos set preco = 4.75, bling_codigo = 'C3', bling_produto_id = '16728491273', ordem = 7  where id = 14; -- Red Velvet
update produtos set preco = 4.75, bling_codigo = 'C4', bling_produto_id = '16728491274', ordem = 8  where id = 12; -- Choc. c/ Brigadeiro Branco
-- Palha italiana (Bling: P1 a P3, R$ 4,90)
update produtos set preco = 4.90, bling_codigo = 'P1', bling_produto_id = '16728491275', ordem = 9  where id = 8;  -- Clássica
update produtos set preco = 4.90, bling_codigo = 'P2', bling_produto_id = '16728491276', ordem = 10 where id = 9;  -- Ninho
update produtos set preco = 4.90, bling_codigo = 'P3', bling_produto_id = '16728491277', ordem = 11 where id = 10; -- Black

-- como o pedido entra no Bling (igual aos pedidos que vocês já lançam lá)
insert into regras (chave, valor) values ('bling', '{
  "formas": {"Boleto": "11531207", "Pix": "11531208", "Dinheiro": "9713037"},
  "vendedor_id": "15596994370",
  "categoria_id": "14749581471",
  "frete": 9
}'::jsonb)
on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
