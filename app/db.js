// Camada de dados: tudo o que o app lê e grava no Supabase passa por aqui.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

/* ---------- login ---------- */
export async function sessao() { return ok(await sb.auth.getSession()).session; }
export async function entrar(email, senha) { return ok(await sb.auth.signInWithPassword({ email, password: senha })); }
export async function sair() { await sb.auth.signOut(); }
export async function perfil(uid) { return ok(await sb.from('perfis').select('*').eq('id', uid).maybeSingle()); }
export async function criarPerfil(uid, nome, papel) { return ok(await sb.from('perfis').insert({ id: uid, nome, papel }).select().single()); }

/* ---------- leituras ---------- */
export async function carregarBase() {
  const [regras, regioes, produtos, expositores, alvo] = await Promise.all([
    sb.from('regras').select('*').then(ok),
    sb.from('regioes').select('*').order('codigo').then(ok),
    sb.from('produtos').select('*').eq('ativo', true).order('ordem').then(ok),
    sb.from('expositores').select('*').order('capacidade').then(ok),
    sb.from('expositor_alvo').select('*').then(ok),
  ]);
  const r = Object.fromEntries(regras.map(x => [x.chave, x.valor]));
  return { regras: r, regioes, produtos, expositores, alvo };
}
// o Supabase devolve no máximo 1000 linhas por consulta: busca em páginas até trazer todos
export async function carregarPdvs() { const tudo = []; for (let de = 0; ; de += 1000) { const pg = ok(await sb.from('v_pdv_resumo').select('*').order('nome').order('id').range(de, de + 999)); tudo.push(...pg); if (pg.length < 1000) break; } return tudo; }
export async function carregarPdv(id) { return ok(await sb.from('v_pdv_resumo').select('*').eq('id', id).single()); }
export async function carregarSellouts(dias = 180) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  return ok(await sb.from('v_sellout_visita').select('*').gte('em', desde).order('em'));
}
export async function carregarTrocas(dias = 28) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  return ok(await sb.from('contagens')
    .select('produto_id, troca, reposto, visitas!inner(pdv_id, em)')
    .gt('troca', 0).gte('visitas.em', desde));
}
export async function carregarPedidosDesde(iso) {
  return ok(await sb.from('pedidos').select('*, pdvs(nome)').gte('criado_em', iso).order('criado_em', { ascending: false }));
}
// o que ficou no cliente: a última contagem; se depois dela houve um pedido (Bling ou venda), vale o que foi entregue nesse pedido
export async function ultimoDeixado(pdvId) {
  const [v, o] = await Promise.all([
    sb.from('visitas').select('id, em').eq('pdv_id', pdvId).in('tipo', ['abertura', 'reposicao']).order('em', { ascending: false }).limit(1).then(ok),
    sb.from('pedidos').select('id, criado_em, visita_id').eq('pdv_id', pdvId).order('criado_em', { ascending: false }).limit(1).then(ok),
  ]);
  const ped = o[0], vis = v[0];
  if (vis && (!ped || ped.visita_id === vis.id || new Date(ped.criado_em) <= new Date(new Date(vis.em).getTime() + 10 * 6e4))) {
    const c = ok(await sb.from('contagens').select('produto_id, deixado_agora').eq('visita_id', vis.id));
    if (c.length) return { por: Object.fromEntries(c.map(x => [x.produto_id, x.deixado_agora])), fonte: 'contagem', em: vis.em };
  }
  if (!ped) return { por: {}, fonte: null, em: null };
  let its = ok(await sb.from('pedido_itens').select('produto_id, quantidade').eq('pedido_id', ped.id));
  if (!its.length) {
    const [bi, prods] = await Promise.all([sb.from('bling_itens').select('codigo, quantidade').eq('pedido_id', ped.id).then(ok).catch(() => []), sb.from('produtos').select('id, bling_codigo').then(ok)]);
    const porCod = Object.fromEntries(prods.filter(p => p.bling_codigo).map(p => [p.bling_codigo, p.id]));
    its = bi.filter(i => porCod[i.codigo]).map(i => ({ produto_id: porCod[i.codigo], quantidade: i.quantidade }));
  }
  const por = {}; its.forEach(i => por[i.produto_id] = (por[i.produto_id] || 0) + Math.round(+i.quantidade));
  return { por, fonte: 'pedido', em: ped.criado_em };
}

/* ---------- gravações ---------- */
export async function criarPdv(obj) { return ok(await sb.from('pdvs').insert(obj).select().single()); }
export async function atualizarPdv(id, patch) { if ('etapa' in patch && !('etapa_motivo' in patch)) patch = { ...patch, etapa_motivo: null }; return ok(await sb.from('pdvs').update(patch).eq('id', id).select().single()); }
export async function registrarVisita(pdvId, tipo, observacao, usuarioId, resultado = null) {
  return ok(await sb.from('visitas').insert({ pdv_id: pdvId, tipo, observacao, usuario_id: usuarioId, resultado }).select().single());
}
async function gravarContagemEPedido({ pdvId, tipoVisita, usuarioId, contagens, pedido, itens, observacao }) {
  const visita = await registrarVisita(pdvId, tipoVisita, observacao, usuarioId);
  if (contagens.length) ok(await sb.from('contagens').insert(contagens.map(c => ({ ...c, visita_id: visita.id }))));
  let ped = null;
  if (pedido) {
    ped = ok(await sb.from('pedidos').insert({ ...pedido, pdv_id: pdvId, visita_id: visita.id, criado_por: usuarioId }).select().single());
    const its = itens.filter(i => i.quantidade > 0 || i.bonificado > 0); // bonificação entra no pedido com quantidade 0 (não é cobrada)
    if (its.length) ok(await sb.from('pedido_itens').insert(its.map(i => ({ ...i, pedido_id: ped.id }))));
  }
  await baixarEstoque(usuarioId, 'visita:' + visita.id, itens || [], contagens);
  return { visita, pedido: ped };
}
export async function registrarAbertura({ pdvId, patch, ...resto }) {
  const r = await gravarContagemEPedido({ pdvId, tipoVisita: 'abertura', ...resto });
  await atualizarPdv(pdvId, patch);
  return r;
}
export async function registrarReposicao(dados) { return gravarContagemEPedido({ tipoVisita: 'reposicao', ...dados }); }
export async function salvarRegra(chave, valor) { return ok(await sb.from('regras').upsert({ chave, valor, atualizado_em: new Date().toISOString() })); }
export async function criarRegiao(obj) { return ok(await sb.from('regioes').upsert(obj, { onConflict: 'codigo', ignoreDuplicates: true }).select()); }
export async function salvarRegiao(codigo, patch) { return ok(await sb.from('regioes').update(patch).eq('codigo', codigo)); }

/* ---------- contatos ---------- */
export async function listarContatos() { return ok(await sb.from('contatos').select('*').order('nome')); }
export async function criarContato(obj) { return ok(await sb.from('contatos').insert(obj).select().single()); }
export async function atualizarContato(id, patch) { return ok(await sb.from('contatos').update({ ...patch, atualizado_em: new Date().toISOString() }).eq('id', id).select().single()); } // a data da edição decide quem vale na mão dupla com o Bling
export async function excluirPdv(id) { ok(await sb.from('pedidos').delete().eq('pdv_id', id)); return ok(await sb.from('pdvs').delete().eq('id', id)); }
export async function excluirContato(id) { return ok(await sb.from('contatos').delete().eq('id', id)); }

/* ---------- histórico do negócio ---------- */
export async function historico(pdvId) {
  const [etapas, visitas, pedidos, sellouts] = await Promise.all([
    sb.from('pdv_etapas').select('de, para, motivo, em, perfis(nome)').eq('pdv_id', pdvId).order('em').then(ok),
    sb.from('visitas').select('id, tipo, em, observacao, perfis(nome)').eq('pdv_id', pdvId).order('em').then(ok),
    sb.from('pedidos').select('id, numero, tipo, condicao, unidades, valor, pago_na_hora, visita_id, criado_em, bling_status, bling_erro, bling_pedido_id').eq('pdv_id', pdvId).order('criado_em').then(ok),
    sb.from('v_sellout_visita').select('*').eq('pdv_id', pdvId).then(ok),
  ]);
  return { etapas, visitas, pedidos, sellouts };
}
export async function atualizarVisita(id, patch) { return ok(await sb.from('visitas').update(patch).eq('id', id).select().single()); }

/* ---------- tarefas (agenda) ---------- */
export async function listarTarefas(dono, de, ate) { return ok(await sb.from('tarefas').select('*').eq('dono', dono).gte('data', de).lte('data', ate).order('data').order('hora', { nullsFirst: true })); }
export async function tarefasAbertasAte(dono, ate) { return ok(await sb.from('tarefas').select('*').eq('dono', dono).eq('concluida', false).lte('data', ate).order('data')); }
export async function tarefasDoPdv(pdvId) { return ok(await sb.from('tarefas').select('*').eq('pdv_id', pdvId).order('data')); }
export async function tarefasDoContato(id) { return ok(await sb.from('tarefas').select('*').eq('contato_id', id).order('data')); }
export async function criarTarefa(obj) { return ok(await sb.from('tarefas').insert(obj).select().single()); }
export async function atualizarTarefa(id, patch) { return ok(await sb.from('tarefas').update(patch).eq('id', id).select().single()); }
export async function excluirTarefa(id) { return ok(await sb.from('tarefas').delete().eq('id', id)); }
export async function carregarEtapasTodas() { return ok(await sb.from('pdv_etapas').select('pdv_id, para, em')); }
const dia0 = d => new Date(d + 'T00:00:00').toISOString(), diaFim = d => new Date(new Date(d + 'T00:00:00').getTime() + 864e5).toISOString();
export async function visitasEntre(de, ate, tipo) { return ok(await sb.from('visitas').select('pdv_id, em').eq('tipo', tipo).gte('em', dia0(de)).lt('em', diaFim(ate))); }
export async function pedidosEntre(de, ate, tipo) { return ok(await sb.from('pedidos').select('pdv_id, valor, criado_em').eq('tipo', tipo).gte('criado_em', dia0(de)).lt('criado_em', diaFim(ate))); }

/* ---------- plano do dia (modo prospecção) ---------- */
export async function obterPlano(dono, data) { return ok(await sb.from('planos').select('*').eq('dono', dono).eq('data', data).maybeSingle()); }
export async function salvarPlano(dono, data, paradas) { return ok(await sb.from('planos').upsert({ dono, data, paradas, atualizado_em: new Date().toISOString() }).select().single()); }
// o que saiu do carro em cada reposição (reposto = vendido + trocas + bonificação)
export async function contagensDasVisitas(ids) { if (!ids.length) return []; return ok(await sb.from('contagens').select('visita_id, produto_id, reposto').in('visita_id', ids)); }
export async function visitasDoDia(dia) { const de = new Date(dia + 'T00:00:00'); return ok(await sb.from('visitas').select('id, pdv_id, em, resultado, tipo').gte('em', de.toISOString()).lt('em', new Date(+de + 864e5).toISOString())); }
export async function criarPdvs(lista) { const out = []; for (let i = 0; i < lista.length; i += 300) out.push(...ok(await sb.from('pdvs').insert(lista.slice(i, i + 300)).select('id'))); return out; }
export async function ultimosPedidos(pdvId, n = 5) { return ok(await sb.from('pedidos').select('numero, bling_pedido_id, tipo, valor, unidades, criado_em').eq('pdv_id', pdvId).order('criado_em', { ascending: false }).limit(n)); }
// integração Bling (a função do servidor guarda as chaves; o app só pede ações)
export async function bling(acao, extra = {}) {
  const { data, error } = await sb.functions.invoke('bling-oauth', { body: { acao, ...extra } });
  if (error) { let m = error.message; try { m = (await error.context.json()).erro || m; } catch { } throw new Error(m); }
  return data;
}
export async function blingOrfaos() { return ok(await sb.from('bling_orfaos').select('*').order('data', { ascending: false })); }
export async function blingIgnorar(blingId) { return ok(await sb.from('bling_orfaos').delete().eq('bling_id', blingId)); }
// venda para quem já é cliente: só o pedido (não conta como visita de reposição nem mexe na etapa)
export async function registrarVenda({ pdvId, usuarioId, pedido, itens, patch }) {
  // venda para quem já é cliente também é uma reposição: gera a visita, para contar no Dia de rota e recalcular a próxima reposição
  const vis = pedido.tipo === 'reposicao' ? await registrarVisita(pdvId, 'reposicao', 'Venda registrada sem contagem do expositor', usuarioId) : null;
  const ped = ok(await sb.from('pedidos').insert({ ...pedido, pdv_id: pdvId, criado_por: usuarioId, ...(vis ? { visita_id: vis.id } : {}) }).select().single());
  const its = itens.filter(i => i.quantidade > 0);
  if (its.length) ok(await sb.from('pedido_itens').insert(its.map(i => ({ ...i, pedido_id: ped.id }))));
  if (patch) await atualizarPdv(pdvId, patch);
  await baixarEstoque(usuarioId, vis ? 'visita:' + vis.id : 'pedido:' + ped.id, itens, []);
  return { pedido: ped };
}
// preços combinados com o cliente: { produto_id: preço }
export async function precosCliente(pdvId) { const r = await sb.from('pdvs').select('precos').eq('id', pdvId).maybeSingle(); if (r.error) return {}; return r.data?.precos || {}; }
export async function salvarPrecos(pdvId, precos) { return ok(await sb.from('pdvs').update({ precos }).eq('id', pdvId)); }
export async function datasPedidos() { return tudo(() => sb.from('pedidos').select('pdv_id, criado_em').order('criado_em')); }
export async function resumoPedidos() { return ok(await sb.from('pedidos').select('pdv_id, criado_em, valor, unidades').limit(10000)); }

/* ---------- painel: busca tudo, em páginas de 1000 (limite do Supabase) ---------- */
async function tudo(montar) { const out = []; for (let i = 0; i < 50; i++) { const r = ok(await montar().range(i * 1000, i * 1000 + 999)); out.push(...r); if (r.length < 1000) break; } return out; }
export async function painelDados() {
  const [pedidos, bitens, pitens, contagens, visitas, perfis, produtos] = await Promise.all([
    tudo(() => sb.from('pedidos').select('id, pdv_id, criado_em, valor, unidades, criado_por, tipo, bling_id').order('criado_em')),
    tudo(() => sb.from('bling_itens').select('pedido_id, codigo, descricao, quantidade, valor, desconto')).catch(() => []),
    tudo(() => sb.from('pedido_itens').select('pedido_id, produto_id, quantidade, preco_unit')),
    tudo(() => sb.from('contagens').select('produto_id, troca, encontrado, deixado_anterior, sellout, reposto, visita_id, visitas(em, pdv_id, usuario_id)')).catch(() => []),
    tudo(() => sb.from('visitas').select('id, pdv_id, em, tipo, usuario_id, resultado')),
    sb.from('perfis').select('id, nome, papel').then(ok),
    sb.from('produtos').select('*').order('ordem').then(ok),
  ]);
  // para as métricas de carteira e campo: mudanças de etapa, rotas planejadas e motivos registrados
  const [etapas, rotas, notas] = await Promise.all([
    tudo(() => sb.from('pdv_etapas').select('pdv_id, de, para, em, usuario_id').order('em')).catch(() => []),
    tudo(() => sb.from('rotas').select('data, motorista, paradas')).catch(() => []),
    tudo(() => sb.from('pdv_notas').select('pdv_id, texto, em, autor')).catch(() => []),
  ]);
  return { pedidos, bitens, pitens, contagens, visitas, perfis, produtos, etapas, rotas, notas };
}
// apaga uma reposição/venda de vez: o pedido (itens saem junto) e a visita com as contagens dela
export async function excluirPedido(id, visitaId) {
  await sb.from('estoque_mov').delete().in('ref', ['pedido:' + id, ...(visitaId ? ['visita:' + visitaId] : [])]).then(() => { }, () => { });
  ok(await sb.from('pedidos').delete().eq('id', id));
  if (visitaId) ok(await sb.from('visitas').delete().eq('id', visitaId));
}

/* ---------- dia de rota ---------- */
export async function perfisTodos() { return ok(await sb.from('perfis').select('id, nome, papel').order('nome')); }
// uma rota por pessoa por dia (SQL 031): traz todas as rotas do dia
export async function rotasDoDia(data) { return ok(await sb.from('rotas').select('*').eq('data', data)); }
export async function obterRota(data, motorista) { return ok(await sb.from('rotas').select('*').eq('data', data).eq('motorista', motorista).maybeSingle()); }
export async function salvarRota(obj) { return ok(await sb.from('rotas').upsert({ ...obj, atualizado_em: new Date().toISOString() }, { onConflict: 'data,motorista' }).select().single()); }
// o que a rota precisa para prever a ruptura e montar a carga: pedidos com itens e a última contagem de cada ponto
export async function dadosRota() {
  const desde = new Date(Date.now() - 365 * 864e5).toISOString(), desdeC = new Date(Date.now() - 180 * 864e5).toISOString();
  const [pedidos, pitens, bitens, contagens] = await Promise.all([
    tudo(() => sb.from('pedidos').select('id, pdv_id, criado_em, unidades, valor').gte('criado_em', desde).order('criado_em')),
    tudo(() => sb.from('pedido_itens').select('pedido_id, produto_id, quantidade')),
    tudo(() => sb.from('bling_itens').select('pedido_id, codigo, quantidade')).catch(() => []),
    tudo(() => sb.from('contagens').select('produto_id, deixado_agora, visitas!inner(id, pdv_id, em, tipo)').in('visitas.tipo', ['abertura', 'reposicao']).gte('visitas.em', desdeC)).catch(() => []),
  ]);
  return { pedidos, pitens, bitens, contagens };
}
// reabrir uma reposição: a contagem e o pedido daquela visita
export async function dadosReabrir(visitaId) {
  const [contagens, peds] = await Promise.all([
    sb.from('contagens').select('produto_id, deixado_anterior, encontrado, troca, reposto').eq('visita_id', visitaId).then(ok),
    sb.from('pedidos').select('id, condicao, vencimento, bling_id, bling_pedido_id').eq('visita_id', visitaId).then(ok),
  ]);
  const itens = peds[0] ? ok(await sb.from('pedido_itens').select('produto_id, bonificado').eq('pedido_id', peds[0].id)) : [];
  return { contagens, pedido: peds[0] || null, itens };
}
// tudo de um pedido: itens (app ou Bling) e, se veio de uma reposição, a contagem do expositor
export async function detalhePedido(id) {
  const o = ok(await sb.from('pedidos').select('*').eq('id', id).single());
  const [itens, bitens, contagens] = await Promise.all([
    sb.from('pedido_itens').select('produto_id, quantidade, preco_unit, bonificado').eq('pedido_id', id).then(ok),
    sb.from('bling_itens').select('codigo, descricao, quantidade, valor, desconto').eq('pedido_id', id).then(ok).catch(() => []),
    o.visita_id ? sb.from('contagens').select('produto_id, deixado_anterior, encontrado, troca, reposto, sellout, deixado_agora').eq('visita_id', o.visita_id).then(ok) : [],
  ]);
  const vis = o.visita_id ? ok(await sb.from('visitas').select('id, tipo, em, observacao, perfis(nome)').eq('id', o.visita_id).maybeSingle()) : null;
  return { pedido: o, itens, bitens, contagens, visita: vis };
}
// itens de todos os pedidos de um cliente (do app e do Bling), para ver o que mais sai
export async function itensDoCliente(pdvId) {
  const peds = ok(await sb.from('pedidos').select('id').eq('pdv_id', pdvId)); const ids = peds.map(o => o.id); if (!ids.length) return { pitens: [], bitens: [] };
  const [pitens, bitens] = await Promise.all([sb.from('pedido_itens').select('pedido_id, produto_id, quantidade, preco_unit').in('pedido_id', ids).then(ok),
    sb.from('bling_itens').select('pedido_id, codigo, quantidade, valor, desconto').in('pedido_id', ids).then(ok).catch(() => [])]);
  return { pitens, bitens };
}
// contatos secundários de um negócio (o principal fica em pdvs.contato_id)
export async function vinculosDoPdv(pdvId) { return ok(await sb.from('pdv_contatos').select('contato_id').eq('pdv_id', pdvId)).map(x => x.contato_id); }
export async function vinculosDoContato(contatoId) { return ok(await sb.from('pdv_contatos').select('pdv_id').eq('contato_id', contatoId)).map(x => x.pdv_id); }
export async function vincularContato(pdvId, contatoId) { return ok(await sb.from('pdv_contatos').upsert({ pdv_id: pdvId, contato_id: contatoId })); }
export async function desvincularContato(pdvId, contatoId) { return ok(await sb.from('pdv_contatos').delete().eq('pdv_id', pdvId).eq('contato_id', contatoId)); }
// observações livres no histórico do cliente
export async function notasDoPdv(pdvId) { return ok(await sb.from('pdv_notas').select('id, texto, em, autor, perfis(nome)').eq('pdv_id', pdvId).order('em', { ascending: false })); }
export async function criarNota(pdvId, texto, autor) { return ok(await sb.from('pdv_notas').insert({ pdv_id: pdvId, texto, autor }).select().single()); }
export async function excluirNota(id) { return ok(await sb.from('pdv_notas').delete().eq('id', id)); }
// todos os pedidos de um cliente, para a tela de detalhes de consumo
export async function pedidosDoCliente(pdvId) { return ok(await sb.from('pedidos').select('*').eq('pdv_id', pdvId).order('criado_em')); }
// itens do último pedido do cliente (app; se não tiver, os do Bling), para repetir na nova venda
export async function ultimoPedidoItens(pdvId) {
  const o = ok(await sb.from('pedidos').select('id, criado_em, condicao, unidades, valor').eq('pdv_id', pdvId).order('criado_em', { ascending: false }).limit(1))[0];
  if (!o) return null;
  let its = ok(await sb.from('pedido_itens').select('produto_id, quantidade').eq('pedido_id', o.id));
  if (!its.length) {
    const [bi, prods] = await Promise.all([sb.from('bling_itens').select('codigo, quantidade').eq('pedido_id', o.id).then(ok).catch(() => []), sb.from('produtos').select('id, bling_codigo').then(ok)]);
    const porCod = Object.fromEntries(prods.filter(p => p.bling_codigo).map(p => [p.bling_codigo, p.id]));
    its = bi.filter(i => porCod[i.codigo]).map(i => ({ produto_id: porCod[i.codigo], quantidade: i.quantidade }));
  }
  return { ...o, itens: its };
}
// junta pedidos do mesmo cliente (ainda fora do Bling) em um só; devolve o id do pedido que ficou
export async function agruparPedidos(ids) { const { data, error } = await sb.rpc('agrupar_pedidos', { ids }); if (error) throw new Error(error.message); return data; }

// vendas lançadas antes da correção (sem visita): cria a visita de reposição na data do pedido
export async function corrigirVendasSemVisita(dias = 30) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const r = await sb.from('pedidos').select('id, pdv_id, criado_em, criado_por').eq('tipo', 'reposicao').is('visita_id', null).not('criado_por', 'is', null).gte('criado_em', desde);
  if (r.error || !r.data?.length) return 0; let n = 0;
  for (const o of r.data) { const v = await sb.from('visitas').insert({ pdv_id: o.pdv_id, tipo: 'reposicao', em: o.criado_em, usuario_id: o.criado_por, observacao: 'Venda registrada sem contagem do expositor' }).select('id').single();
    if (v.error) continue; await sb.from('pedidos').update({ visita_id: v.data.id }).eq('id', o.id); n++; }
  return n;
}

// ruptura por cliente: nas 3 últimas contagens, quantos sabores que tinham sido deixados estavam zerados
export async function rupturaPorPdv() {
  const cs = await tudo(() => sb.from('contagens').select('visita_id, deixado_anterior, encontrado, visitas(em, pdv_id)'));
  const pv = {}; cs.forEach(c => { if (!c.visitas) return; const v = ((pv[c.visitas.pdv_id] = pv[c.visitas.pdv_id] || {})[c.visita_id] = pv[c.visitas.pdv_id][c.visita_id] || { em: c.visitas.em, n: 0, z: 0 }); if (+c.deixado_anterior > 0) { v.n++; if (+c.encontrado === 0) v.z++; } });
  const out = {}; Object.entries(pv).forEach(([id, o]) => { const u = Object.values(o).sort((a, b) => a.em < b.em ? -1 : 1).slice(-3), n = u.reduce((a, v) => a + v.n, 0); if (n) out[id] = { r: u.reduce((a, v) => a + v.z, 0) / n, z: u.reduce((a, v) => a + v.z, 0), n, vis: u.length }; });
  return out;
}

/* ---------- estoque ---------- */
// saída automática do carro de quem fez a reposição/venda: vendido, bonificado e trocado (se a tabela ainda não existe, segue sem erro)
async function baixarEstoque(usuarioId, ref, itens, contagens) {
  try {
    const local = 'carro:' + usuarioId, rows = [], add = (produto_id, q, tipo) => { if (q > 0) rows.push({ produto_id, local, qtd: -q, tipo, ref, usuario_id: usuarioId }); };
    (itens || []).forEach(i => { add(i.produto_id, +i.quantidade || 0, 'venda'); add(i.produto_id, +i.bonificado || 0, 'bonificacao'); });
    (contagens || []).forEach(c => add(c.produto_id, +c.troca || 0, 'troca'));
    if (rows.length) await sb.from('estoque_mov').insert(rows);
  } catch (e) { }
}
export async function estoqueMovs() { return tudo(() => sb.from('estoque_mov').select('id, em, produto_id, local, qtd, tipo, custo_unit, lote, validade, ref, obs, usuario_id, perfis(nome)').order('em', { ascending: false })); }
export async function lancarEstoque(rows) { return ok(await sb.from('estoque_mov').insert(rows).select('id')); }
export async function apagarMovEstoque(id) { return ok(await sb.from('estoque_mov').delete().eq('id', id)); }
export async function perfisLista() { return ok(await sb.from('perfis').select('id, nome, papel').order('nome')); }
// aba Pedidos: todos os pedidos (do app e do Bling) de um período, com o nome do cliente
export async function listarPedidos(de, ate) {
  return tudo(() => sb.from('pedidos').select('id, numero, criado_em, valor, unidades, tipo, condicao, vencimento, bling_id, bling_pedido_id, bling_status, bling_situacao, bling_erro, criado_por, pdv_id, visita_id, pdvs(nome, bairro, regiao)').gte('criado_em', de).lt('criado_em', ate).order('criado_em', { ascending: false }));
}
