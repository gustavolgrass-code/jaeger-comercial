-- 035: etapa "Consignado" (abertura em consignação: produto deixado no cliente, cobra só o vendido na 1ª reposição)
alter type etapa_pdv add value if not exists 'consignado' after 'negociacao';
-- reposição do consignado a cada 7 dias, se não houver outra regra
update regras set valor = valor || '{"consignado": 7}'::jsonb where chave = 'cadencia_padrao' and not (valor ? 'consignado');
