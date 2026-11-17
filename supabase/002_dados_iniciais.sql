-- =====================================================================
-- Jaeger's Comercial · dados iniciais
-- Rodar depois do 001_estrutura.sql.
-- =====================================================================

-- regras da esteira e da reposição
insert into regras (chave, valor) values
  ('avaliacao', '{"reposicoes": 13, "meta_minima_sellout": 6}'),
  ('cadencia_padrao', '{"negociacao": 7, "avaliacao": 7, "revisao": 7, "ativo": 14, "risco": 14}'),
  ('meta_troca_pct', '3');

-- regiões (limites em caixa: [lng_oeste, lat_norte, lng_leste, lat_sul]); dia_rota: 2 = terça
insert into regioes (codigo, nome, cor, dia_rota, limites) values
  ('C1', 'Canoas Oeste', '#3F6FA8', 2, '[-51.30, -29.86, -51.18, -29.975]'),
  ('C2', 'Canoas Leste', '#2F7D4E', 2, '[-51.18, -29.86, -51.05, -29.975]'),
  ('P1', 'POA Norte',    '#C27A2C', 3, '[-51.30, -29.975, -51.05, -30.018]'),
  ('P2', 'POA Centro',   '#B8402A', 3, '[-51.30, -30.018, -51.195, -30.046]'),
  ('P3', 'POA Leste',    '#6B4FA0', 4, '[-51.195, -30.018, -51.05, -30.12]'),
  ('P4', 'POA Sul',      '#8A4E17', 4, '[-51.30, -30.046, -51.195, -30.12]');

-- produtos (preço de palha e cookie provisório: R$4,90)
insert into produtos (linha, sabor, marca, custo, preco, ordem) values
  ('Brownie do Monkey', 'Tradicional',   'Monkey', 2.59, 4.90, 1),
  ('Brownie do Monkey', 'Meio Amargo',   'Monkey', 2.59, 4.90, 2),
  ('Brownie do Monkey', 'Leitinho',      'Monkey', 2.59, 4.90, 3),
  ('Brownie do Monkey', 'Doce de Leite', 'Monkey', 2.59, 4.90, 4),
  ('Brownie do Monkey', 'Confete',       'Monkey', 2.59, 4.90, 5),
  ('Brownie do Monkey', 'Ferraro',       'Monkey', 2.59, 4.90, 6),
  ('Brownie do Monkey', 'Buena',         'Monkey', 2.59, 4.90, 7),
  ('Palha italiana Baccaro', 'Clássica', 'Baccaro', 2.39, 4.90, 8),
  ('Palha italiana Baccaro', 'Ninho',    'Baccaro', 2.39, 4.90, 9),
  ('Palha italiana Baccaro', 'Black',    'Baccaro', 2.39, 4.90, 10),
  ('Cookie Baccaro', 'Brigadeiro de Panela',        'Baccaro', 2.39, 4.90, 11),
  ('Cookie Baccaro', 'Choc. c/ Brigadeiro Branco',  'Baccaro', 2.39, 4.90, 12),
  ('Cookie Baccaro', 'Gotas de Chocolate',          'Baccaro', 2.39, 4.90, 13),
  ('Cookie Baccaro', 'Red Velvet',                  'Baccaro', 2.39, 4.90, 14);

-- expositores (capacidade do de 2 andares a confirmar)
insert into expositores (nome, capacidade, custo) values
  ('1 andar', 32, 30.00),
  ('2 andares', 40, 32.50),
  ('3 andares', 49, 35.00);

-- quantidade alvo por sabor em cada expositor
insert into expositor_alvo (expositor_id, produto_id, quantidade)
select e.id, p.id,
  case
    when p.linha like 'Brownie%' then case e.nome when '1 andar' then 3 when '2 andares' then 4 else 5 end
    when p.linha like 'Palha%'   then case e.nome when '1 andar' then 2 else 3 end
    else 1
  end
from expositores e cross join produtos p;
