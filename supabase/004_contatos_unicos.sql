-- =====================================================================
-- Jaeger's Comercial · 004 · impede contato duplicado no banco
-- (o app já bloqueia; isto é a trava final). Rodar uma vez.
-- Se der erro "could not create unique index", é porque já existem
-- contatos repetidos: mande o print que eu ajudo a juntar.
-- =====================================================================

-- mesmo telefone (últimos 8 dígitos)
create unique index contatos_telefone_unico
  on contatos (right(regexp_replace(telefone, '\D', '', 'g'), 8))
  where length(regexp_replace(coalesce(telefone, ''), '\D', '', 'g')) >= 8;

-- mesmo e-mail
create unique index contatos_email_unico
  on contatos (lower(trim(email)))
  where coalesce(trim(email), '') <> '';
