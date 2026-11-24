-- 034: controle de estoque. Cada linha é um movimento (entra +, sai -) num local:
--   'deposito' (estoque central) ou 'carro:<id do perfil>' (o carro de cada um).
-- O saldo de um produto num local é a soma dos movimentos.
create table if not exists estoque_mov (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  produto_id int not null references produtos(id),
  local text not null,
  qtd numeric not null,
  tipo text not null check (tipo in ('compra','carga','retorno','venda','bonificacao','troca','perda','ajuste')),
  custo_unit numeric,
  lote text,
  validade date,
  ref text,            -- 'visita:<id>' ou 'pedido:<id>' quando veio de uma reposição/venda
  obs text,
  usuario_id uuid references perfis(id)
);
create index if not exists estoque_mov_prod_local on estoque_mov (produto_id, local);
create index if not exists estoque_mov_ref on estoque_mov (ref);
create index if not exists estoque_mov_em on estoque_mov (em);
alter table estoque_mov enable row level security;
drop policy if exists "logados leem" on estoque_mov;
drop policy if exists "logados gravam" on estoque_mov;
create policy "logados leem" on estoque_mov for select to authenticated using (true);
create policy "logados gravam" on estoque_mov for all to authenticated using (true) with check (true);
