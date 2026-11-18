-- Jaeger's Comercial · 010 · integração com o Bling (fase 1: o app lê os pedidos do Bling)
-- Pode rodar de novo sem problema.

-- conexão (tokens do Bling). Sem políticas de acesso: só a função do servidor lê e grava.
create table if not exists bling_conexao (
  id int primary key default 1 check (id = 1),
  access_token text,
  refresh_token text,
  expira_em timestamptz,
  conectado_em timestamptz,
  ultima_sync timestamptz,
  ultimo_resultado jsonb,
  ultimo_erro text
);
alter table bling_conexao enable row level security;

-- códigos temporários do login no Bling (proteção contra autorização forjada)
create table if not exists bling_estados (state text primary key, criado_em timestamptz not null default now());
alter table bling_estados enable row level security;

-- pedidos do Bling de clientes que não foram achados no app
create table if not exists bling_orfaos (
  bling_id bigint primary key,
  numero text,
  data date,
  contato_id bigint,
  contato_nome text,
  documento text,
  total numeric(10,2),
  situacao text,
  visto_em timestamptz not null default now()
);
alter table bling_orfaos enable row level security;
drop policy if exists "logados leem" on bling_orfaos;
drop policy if exists "logados gravam" on bling_orfaos;
create policy "logados leem" on bling_orfaos for select to authenticated using (true);
create policy "logados gravam" on bling_orfaos for all to authenticated using (true) with check (true);

alter table pedidos add column if not exists bling_id bigint;
alter table pedidos add column if not exists bling_situacao text;
create unique index if not exists pedidos_bling_id on pedidos (bling_id) where bling_id is not null;

-- ativo <-> inativo pela regra dos 90 dias (só mexe em quem está Ativo ou Inativo)
create or replace function atualizar_status_carteira() returns int language plpgsql as $$
declare n int := 0; m int;
begin
  with ult as (select pdv_id, max(criado_em) u from pedidos where coalesce(bling_situacao, '') !~* 'cancel' group by pdv_id)
  update pdvs p set etapa = 'ativo', etapa_motivo = 'Voltou a comprar (pedido no Bling)'
    from ult where ult.pdv_id = p.id and p.etapa = 'inativo' and ult.u >= now() - interval '90 days';
  get diagnostics m = row_count; n := n + m;
  with ult as (select pdv_id, max(criado_em) u from pedidos where coalesce(bling_situacao, '') !~* 'cancel' group by pdv_id)
  update pdvs p set etapa = 'inativo', etapa_motivo = 'Sem pedido há mais de 90 dias'
    from ult where ult.pdv_id = p.id and p.etapa = 'ativo' and ult.u < now() - interval '90 days';
  get diagnostics m = row_count; n := n + m;
  return n;
end $$;

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

-- só o servidor (função do Bling) pode chamar estas funções
revoke execute on function bling_importar(jsonb) from public, anon, authenticated;
revoke execute on function atualizar_status_carteira() from public, anon, authenticated;
