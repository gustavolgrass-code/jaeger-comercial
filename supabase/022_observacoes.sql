-- Jaeger's Comercial · 022 · observações no histórico do cliente
create table if not exists pdv_notas (
  id uuid primary key default gen_random_uuid(),
  pdv_id uuid not null references pdvs(id) on delete cascade,
  texto text not null,
  autor uuid references perfis(id),
  em timestamptz not null default now()
);
create index if not exists pdv_notas_pdv on pdv_notas (pdv_id, em desc);
alter table pdv_notas enable row level security;
drop policy if exists "logados leem" on pdv_notas;
drop policy if exists "logados gravam" on pdv_notas;
create policy "logados leem" on pdv_notas for select to authenticated using (true);
create policy "logados gravam" on pdv_notas for all to authenticated using (true) with check (true);
