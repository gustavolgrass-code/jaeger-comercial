-- Jaeger's Comercial · 029 · horário de atendimento com mais de um período (ex.: manhã e noite)
-- o campo passa a guardar os períodos separados por vírgula: 'manha,tarde', 'manha,noite'…
alter table pdvs drop constraint if exists pdvs_janela_periodo_check;
alter table pdvs add constraint pdvs_janela_periodo_check
  check (janela_periodo is null or janela_periodo ~ '^(manha|tarde|noite|dia_todo)(,(manha|tarde|noite))*$');
