-- Jaeger's Comercial · 019 · dia de rota (um carro por dia)
-- guarda quem roda, o tipo do dia, o horário e as paradas com o status de cada uma
create table if not exists rotas (
  data date primary key,
  motorista uuid references perfis(id),
  tipo text not null default 'reposicao' check (tipo in ('reposicao', 'prospeccao', 'misto')),
  inicio text not null default '08:00',
  fim text not null default '18:00',
  incluir jsonb not null default '[]',   -- ids que você colocou na mão
  tirar jsonb not null default '[]',     -- ids que você tirou na mão
  paradas jsonb not null default '[]',   -- [{id, tipo: rep|prosp, status: null|feito|ausente}] na ordem da rota
  atualizado_em timestamptz not null default now()
);
alter table rotas enable row level security;
drop policy if exists "logados leem" on rotas;
drop policy if exists "logados gravam" on rotas;
create policy "logados leem" on rotas for select to authenticated using (true);
create policy "logados gravam" on rotas for all to authenticated using (true) with check (true);
