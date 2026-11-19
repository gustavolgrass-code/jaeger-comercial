-- Jaeger's Comercial · 012 · puxa do Bling os dados de contato dos clientes
-- (pessoa de contato, cargo, telefone, e-mail). Pode rodar de novo sem problema.

-- recebe a lista de pedidos lida do Bling e grava no app
-- cada item: {id, numero, data, total, situacao, contato: {id, nome, numeroDocumento}}
create or replace function bling_importar(lista jsonb) returns jsonb language plpgsql as $$
declare
  x jsonb; novos int := 0; atual int := 0; canc int := 0; orf int := 0; st int;
  v_id bigint; v_num text; v_doc text; v_nome text; v_sit text; v_cancel boolean; v_pdv uuid; v_ped uuid;
begin
  for x in select * from jsonb_array_elements(lista) loop
    v_id := (x->>'id')::bigint; v_num := x->>'numero';
    v_doc := nullif(regexp_replace(coalesce(x->'contato'->>'numeroDocumento', ''), '\D', '', 'g'), '');
    v_nome := x->'contato'->>'nome'; v_sit := x->>'situacao';
    v_cancel := coalesce(v_sit, '') ~* 'cancel';

    -- já existe? (pelo id do Bling, ou pelo número para os importados pela planilha)
    select id into v_ped from pedidos where bling_id = v_id
      or (bling_id is null and bling_pedido_id = v_num and bling_status = 'importado') limit 1;
    if v_ped is not null then
      if v_cancel then
        delete from pedidos where id = v_ped and bling_status = 'importado';
        if found then canc := canc + 1; else update pedidos set bling_situacao = v_sit, bling_id = v_id where id = v_ped; end if;
      else
        update pedidos set bling_id = v_id, bling_situacao = v_sit, valor = coalesce((x->>'total')::numeric, valor) where id = v_ped;
        update pdvs set bling_contato_id = coalesce(bling_contato_id, x->'contato'->>'id') where id = (select pdv_id from pedidos where id = v_ped);
        atual := atual + 1;
      end if;
      delete from bling_orfaos where bling_id = v_id;
      continue;
    end if;
    if v_cancel then delete from bling_orfaos where bling_id = v_id; continue; end if;

    -- de qual cliente? CNPJ/CPF, depois id do contato no Bling, depois razão social ou nome
    v_pdv := null;
    if v_doc is not null then
      select id into v_pdv from pdvs where regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = v_doc order by criado_em limit 1;
    end if;
    if v_pdv is null then select id into v_pdv from pdvs where bling_contato_id = x->'contato'->>'id' limit 1; end if;
    if v_pdv is null and v_nome is not null then
      select id into v_pdv from pdvs where lower(trim(razao_social)) = lower(trim(v_nome)) or lower(trim(nome)) = lower(trim(v_nome)) order by criado_em limit 1;
    end if;

    if v_pdv is null then
      insert into bling_orfaos (bling_id, numero, data, contato_id, contato_nome, documento, total, situacao)
      values (v_id, v_num, (x->>'data')::date, (x->'contato'->>'id')::bigint, v_nome, v_doc, (x->>'total')::numeric, v_sit)
      on conflict (bling_id) do update set total = excluded.total, situacao = excluded.situacao, visto_em = now();
      orf := orf + 1; continue;
    end if;

    insert into pedidos (pdv_id, tipo, condicao, unidades, valor, pago_na_hora, bling_pedido_id, bling_id, bling_status, bling_situacao, criado_em)
    values (v_pdv, case when exists (select 1 from pedidos where pdv_id = v_pdv) then 'reposicao' else 'abertura' end::tipo_pedido,
      'Importado do Bling', 0, coalesce((x->>'total')::numeric, 0), false, v_num, v_id, 'importado', v_sit,
      ((x->>'data')::date + time '12:00') at time zone 'America/Sao_Paulo');
    update pdvs set bling_contato_id = coalesce(bling_contato_id, x->'contato'->>'id'),
      cnpj = coalesce(cnpj, v_doc) where id = v_pdv;
    delete from bling_orfaos where bling_id = v_id;
    novos := novos + 1;
  end loop;
  st := atualizar_status_carteira();
  return jsonb_build_object('novos', novos, 'atualizados', atual, 'cancelados', canc, 'sem_cliente', orf, 'status_mudou', st);
end $$;


-- recebe os contatos lidos do Bling e completa o que falta no app (nunca apaga o que já existe)
-- cada item: {pdv_id, bling_id, pessoa, info, telefone, celular, email}
create or replace function bling_contatos(lista jsonb) returns jsonb language plpgsql as $$
declare
  x jsonb; v_pdv pdvs%rowtype; v_c uuid; v_pessoa text; v_tel text; v_cel text; v_email text; v_cargo text;
  criados int := 0; completados int := 0; sem_dados int := 0;
begin
  for x in select * from jsonb_array_elements(lista) loop
    select * into v_pdv from pdvs where id = (x->>'pdv_id')::uuid; if not found then continue; end if;
    v_pessoa := nullif(trim(x->>'pessoa'), '');
    v_cel := nullif(trim(x->>'celular'), ''); v_tel := nullif(trim(x->>'telefone'), '');
    if regexp_replace(coalesce(v_cel, ''), '[^1-9]', '', 'g') = '' then v_cel := null; end if;
    if regexp_replace(coalesce(v_tel, ''), '[^1-9]', '', 'g') = '' then v_tel := null; end if;
    v_email := nullif(lower(trim(x->>'email')), '');
    v_cargo := case when x->>'info' ~* 'dono|propriet|s[óo]ci' then 'Dono'
                    when x->>'info' ~* 'gerente|gestor|encarregad|respons' then 'Gerente'
                    when x->>'info' ~* 'funcion|atendente|caixa|balconista|colaborador' then 'Funcionário' end;
    update pdvs set bling_contato_id = coalesce(bling_contato_id, x->>'bling_id'), telefone = coalesce(telefone, v_tel, v_cel) where id = v_pdv.id;
    if v_pessoa is null and v_email is null and v_tel is null and v_cel is null and v_cargo is null then sem_dados := sem_dados + 1; continue; end if;
    -- não repetir telefone ou e-mail que já é de outro contato
    if v_email is not null and exists (select 1 from contatos where lower(trim(email)) = v_email and id is distinct from v_pdv.contato_id) then
      if v_pdv.contato_id is null then select id into v_c from contatos where lower(trim(email)) = v_email and (v_pessoa is null or lower(trim(nome)) = lower(v_pessoa)) limit 1; end if; v_email := null; end if;
    v_c := coalesce(v_pdv.contato_id, v_c);
    v_tel := coalesce(v_cel, v_tel);
    if v_tel is not null and length(regexp_replace(v_tel, '\D', '', 'g')) >= 8 and exists (select 1 from contatos where length(regexp_replace(coalesce(telefone, ''), '\D', '', 'g')) >= 8
         and right(regexp_replace(telefone, '\D', '', 'g'), 8) = right(regexp_replace(v_tel, '\D', '', 'g'), 8) and id is distinct from v_c) then
      if v_c is null then select id into v_c from contatos where right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 8) = right(regexp_replace(v_tel, '\D', '', 'g'), 8) and (v_pessoa is null or lower(trim(nome)) = lower(v_pessoa)) limit 1; end if; v_tel := null; v_cel := null; end if;
    if v_c is null then
      insert into contatos (nome, empresa, cargo, telefone, whatsapp, email, observacao)
      values (coalesce(v_pessoa, v_pdv.nome), v_pdv.nome, v_cargo, v_tel, v_cel, v_email,
              case when v_pessoa is null then 'Importado do Bling · sem pessoa de contato' else 'Importado do Bling' end)
      returning id into v_c;
      criados := criados + 1;
    else
      update contatos set
        nome = case when v_pessoa is not null and coalesce(observacao, '') ~ 'sem pessoa de contato' then v_pessoa else nome end,
        observacao = case when v_pessoa is not null then nullif(replace(coalesce(observacao, ''), ' · sem pessoa de contato', ''), '') else observacao end,
        cargo = coalesce(cargo, v_cargo), telefone = coalesce(telefone, v_tel), whatsapp = coalesce(whatsapp, case when v_tel is not null then v_cel end), email = coalesce(email, v_email)
      where id = v_c;
      completados := completados + 1;
    end if;
    update pdvs set contato_id = v_c where id = v_pdv.id and contato_id is null;
    v_c := null;
  end loop;
  return jsonb_build_object('criados', criados, 'completados', completados, 'sem_dados', sem_dados);
end $$;

revoke execute on function bling_importar(jsonb) from public, anon, authenticated;
revoke execute on function bling_contatos(jsonb) from public, anon, authenticated;
