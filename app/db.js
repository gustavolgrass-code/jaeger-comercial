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
export async function atualizarPdv(id, patch) { return ok(await sb.from('pdvs').update(patch).eq('id', id).select().single()); }
export async function registrarVisita(pdvId, tipo, observacao, usuarioId) {
  return ok(await sb.from('visitas').insert({ pdv_id: pdvId, tipo, observacao, usuario_id: usuarioId }).select().single());
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
export async function salvarRegiao(codigo, patch) { return ok(await sb.from('regioes').update(patch).eq('codigo', codigo)); }
