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
export async function carregarPdvs() { return ok(await sb.from('v_pdv_resumo').select('*').order('nome')); }
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
// o que ficou no expositor na última visita com contagem (abertura ou reposição)
export async function ultimoDeixado(pdvId) {
  const v = ok(await sb.from('visitas').select('id').eq('pdv_id', pdvId).in('tipo', ['abertura', 'reposicao'])
    .order('em', { ascending: false }).limit(1));
  if (!v.length) return {};
  const c = ok(await sb.from('contagens').select('produto_id, deixado_agora').eq('visita_id', v[0].id));
  return Object.fromEntries(c.map(x => [x.produto_id, x.deixado_agora]));
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
    const its = itens.filter(i => i.quantidade > 0);
    if (its.length) ok(await sb.from('pedido_itens').insert(its.map(i => ({ ...i, pedido_id: ped.id }))));
  }
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
export async function atualizarContato(id, patch) { return ok(await sb.from('contatos').update(patch).eq('id', id).select().single()); }
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
  const ped = ok(await sb.from('pedidos').insert({ ...pedido, pdv_id: pdvId, criado_por: usuarioId }).select().single());
  const its = itens.filter(i => i.quantidade > 0);
  if (its.length) ok(await sb.from('pedido_itens').insert(its.map(i => ({ ...i, pedido_id: ped.id }))));
  if (patch) await atualizarPdv(pdvId, patch);
  return { pedido: ped };
}
// preços combinados com o cliente: { produto_id: preço }
export async function precosCliente(pdvId) { const r = await sb.from('pdvs').select('precos').eq('id', pdvId).maybeSingle(); if (r.error) return {}; return r.data?.precos || {}; }
export async function salvarPrecos(pdvId, precos) { return ok(await sb.from('pdvs').update({ precos }).eq('id', pdvId)); }
