-- Jaeger's Comercial · 006 · apaga os 25 negócios e contatos fictícios do 005
begin;
delete from pedido_itens where pedido_id in (select p.id from pedidos p join pdvs d on d.id = p.pdv_id where d.origem = 'teste');
delete from pedidos where pdv_id in (select id from pdvs where origem = 'teste');
delete from pdvs where origem = 'teste';          -- visitas, contagens e histórico saem junto
delete from contatos where observacao = '[TESTE] contato fictício';
commit;
