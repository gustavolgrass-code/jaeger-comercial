-- Jaeger's Comercial · 026 · juntar pedidos mantendo cada parcela (ex.: 2 boletos com datas diferentes)
create or replace function agrupar_pedidos(ids uuid[]) returns uuid language plpgsql as $$
declare v_princ uuid; v_pdv int; v_env int;
begin
  if coalesce(array_length(ids, 1), 0) < 2 then raise exception 'Escolha pelo menos 2 pedidos'; end if;
  select count(distinct pdv_id), count(*) filter (where bling_id is not null or bling_status = 'importado') into v_pdv, v_env from pedidos where id = any(ids);
  if v_pdv <> 1 then raise exception 'Os pedidos precisam ser do mesmo cliente'; end if;
  if v_env > 0 then raise exception 'Algum pedido já está no Bling'; end if;
  select id into v_princ from pedidos where id = any(ids) order by criado_em limit 1;

  create temp table _it on commit drop as
    select produto_id, sum(quantidade)::int q, sum(bonificado)::int b, round(sum(quantidade * preco_unit) / nullif(sum(quantidade), 0), 2) p
    from pedido_itens where pedido_id = any(ids) group by produto_id;
  create temp table _pg on commit drop as
    select forma, sum(valor) valor, venc vencimento from (
      select coalesce(x->>'forma', o.condicao) forma, (x->>'valor')::numeric valor, (x->>'vencimento')::date venc
        from pedidos o cross join lateral jsonb_array_elements(o.pagamentos) x where o.id = any(ids) and o.pagamentos is not null
      union all
      select o.condicao, o.valor, o.vencimento from pedidos o where o.id = any(ids) and o.pagamentos is null
    ) t group by forma, venc;

  update pedidos o set
    unidades = (select sum(unidades) from pedidos where id = any(ids)),
    valor = (select sum(valor) from pedidos where id = any(ids)),
    vencimento = (select max(vencimento) from pedidos where id = any(ids)),
    pagamentos = case when (select count(*) from _pg) > 1 then (select jsonb_agg(jsonb_build_object('forma', forma, 'valor', valor, 'vencimento', vencimento)) from _pg) else null end,
    condicao = (select string_agg(f, ' + ' order by f) from (select distinct forma f from _pg) d),
    pago_na_hora = false, bling_status = 'pendente', bling_erro = null
  where o.id = v_princ;

  delete from pedido_itens where pedido_id = any(ids);
  insert into pedido_itens (pedido_id, produto_id, quantidade, bonificado, preco_unit) select v_princ, produto_id, q, b, p from _it;
  delete from pedidos where id = any(ids) and id <> v_princ;
  return v_princ;
end $$;
