-- Jaeger's Comercial · 011 · tira o "Pedidook cód. N" das observações (Pedidook foi descontinuado)
update pdvs
set observacao = nullif(trim(both ' ·' from regexp_replace(observacao, 'Pedidook cód\. \S+( · )?', '', 'g')), '')
where observacao ~ 'Pedidook cód\.';
