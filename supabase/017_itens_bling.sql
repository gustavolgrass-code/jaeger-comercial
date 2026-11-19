-- Jaeger's Comercial · 017 · itens de cada pedido do Bling (para análise por produto e sabor)
create table if not exists bling_itens (
  pedido_id uuid not null references pedidos(id) on delete cascade,
  ordem smallint not null,
  codigo text,
  descricao text,
  quantidade numeric(10,2) not null default 0,
  valor numeric(10,2) not null default 0,      -- preço unitário no pedido
  desconto numeric(6,2) not null default 0,    -- % de desconto no item
  primary key (pedido_id, ordem)
);
create index if not exists bling_itens_codigo on bling_itens (codigo);
alter table bling_itens enable row level security;
drop policy if exists "logados leem" on bling_itens;
create policy "logados leem" on bling_itens for select to authenticated using (true);

-- grava os itens lidos do Bling: [{pedido_id, desconto_pedido, itens:[{codigo, descricao, quantidade, valor, desconto}]}]
create or replace function bling_gravar_itens(lista jsonb) returns int language plpgsql as $$
declare x jsonb; i jsonb; n int := 0; k int;
begin
  for x in select * from jsonb_array_elements(lista) loop
    delete from bling_itens where pedido_id = (x->>'pedido_id')::uuid;
    k := 0;
    for i in select * from jsonb_array_elements(x->'itens') loop
      k := k + 1;
      insert into bling_itens (pedido_id, ordem, codigo, descricao, quantidade, valor, desconto)
      values ((x->>'pedido_id')::uuid, k, i->>'codigo', i->>'descricao', coalesce((i->>'quantidade')::numeric, 0), coalesce((i->>'valor')::numeric, 0), coalesce((i->>'desconto')::numeric, 0));
    end loop;
    update pedidos set unidades = (select coalesce(sum(quantidade), 0)::int from bling_itens where pedido_id = (x->>'pedido_id')::uuid)
     where id = (x->>'pedido_id')::uuid and coalesce(unidades, 0) = 0;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function bling_gravar_itens(jsonb) from public, anon, authenticated;
