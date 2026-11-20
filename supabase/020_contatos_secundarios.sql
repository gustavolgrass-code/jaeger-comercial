-- Jaeger's Comercial · 020 · contatos secundários (ex.: dono e gerente no mesmo negócio)
-- o contato principal continua em pdvs.contato_id; os demais ficam aqui
create table if not exists pdv_contatos (
  pdv_id uuid not null references pdvs(id) on delete cascade,
  contato_id uuid not null references contatos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (pdv_id, contato_id)
);
alter table pdv_contatos enable row level security;
drop policy if exists "logados leem" on pdv_contatos;
drop policy if exists "logados gravam" on pdv_contatos;
create policy "logados leem" on pdv_contatos for select to authenticated using (true);
create policy "logados gravam" on pdv_contatos for all to authenticated using (true) with check (true);

-- limpa a marca "sem pessoa de contato" dos contatos que já ganharam nome de pessoa
update contatos
   set observacao = nullif(trim(replace(observacao, ' · sem pessoa de contato', '')), '')
 where observacao like '%sem pessoa de contato%'
   and lower(trim(nome)) <> lower(trim(coalesce(empresa, '')));
