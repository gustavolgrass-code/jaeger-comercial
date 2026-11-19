-- Jaeger's Comercial · 016 · pedido excluído no Bling some do app também
-- recebe os ids de todos os pedidos que existem no Bling desde uma data e apaga do app os que não estão mais lá
create or replace function bling_remover_ausentes(ids bigint[], desde date) returns int language plpgsql as $$
declare n int;
begin
  if coalesce(array_length(ids, 1), 0) = 0 then return 0; end if; -- lista vazia: não apaga nada por segurança
  delete from pedidos
   where bling_id is not null
     and criado_em >= (desde::timestamp at time zone 'America/Sao_Paulo')
     and not (bling_id = any(ids));
  get diagnostics n = row_count;
  perform atualizar_status_carteira();
  return n;
end $$;
revoke execute on function bling_remover_ausentes(bigint[], date) from public, anon, authenticated;
