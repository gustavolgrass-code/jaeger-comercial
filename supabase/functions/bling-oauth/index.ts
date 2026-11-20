// Jaeger's Comercial · função de integração com o Bling (API v3)
// Segredos (Edge Functions → Secrets): BLING_CLIENT_ID, BLING_CLIENT_SECRET, APP_URL
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em toda função do Supabase.
// Deixe "Verify JWT" DESLIGADO nesta função: o retorno do Bling chega sem login,
// e as ações do app conferem o login aqui dentro.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BLING = 'https://www.bling.com.br/Api/v3';
const API = 'https://api.bling.com.br/Api/v3';
const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const redirectUri = () => `${env('SUPABASE_URL')}/functions/v1/bling-oauth`;
const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

async function pedirToken(corpo: Record<string, string>) {
  const r = await fetch(`${BLING}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Accept: '1.0', 'enable-jwt': '1',
      Authorization: 'Basic ' + btoa(`${env('BLING_CLIENT_ID')}:${env('BLING_CLIENT_SECRET')}`),
    },
    body: new URLSearchParams(corpo),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.access_token) throw new Error(`Bling recusou o token (${r.status}): ${JSON.stringify(t).slice(0, 300)}`);
  const linha = {
    id: 1, access_token: t.access_token, refresh_token: t.refresh_token,
    expira_em: new Date(Date.now() + (Number(t.expires_in) || 21600) * 1000).toISOString(), ultimo_erro: null,
  };
  const { error } = await db.from('bling_conexao').upsert(linha);
  if (error) throw error;
  return linha.access_token;
}

async function tokenValido() {
  const { data } = await db.from('bling_conexao').select('*').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) throw new Error('Bling não conectado');
  if (data.access_token && new Date(data.expira_em).getTime() - Date.now() > 120000) return data.access_token as string;
  return pedirToken({ grant_type: 'refresh_token', refresh_token: data.refresh_token });
}

async function chamar(caminho: string, token: string) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const r = await fetch(`${API}${caminho}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'enable-jwt': '1' } });
    if (r.status === 429) { await esperar(1500 * (tentativa + 1)); continue; }
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Bling ${caminho} (${r.status}): ${JSON.stringify(corpo).slice(0, 300)}`);
    await esperar(350); // limite do Bling: ~3 chamadas por segundo
    return corpo;
  }
  throw new Error('Bling ocupado (limite de chamadas). Tente de novo em alguns minutos.');
}

async function sincronizar() {
  const token = await tokenValido();
  const { data: cx } = await db.from('bling_conexao').select('ultima_sync').eq('id', 1).maybeSingle();
  // o Bling aceita no máximo 366 dias por filtro: na primeira leitura vamos em janelas de 180 dias
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const amanha = new Date(Date.now() + 864e5);
  const filtros: string[] = [];
  if (cx?.ultima_sync) {
    filtros.push(`dataAlteracaoInicial=${dia(new Date(new Date(cx.ultima_sync).getTime() - 2 * 864e5))}&dataAlteracaoFinal=${dia(amanha)}`);
  } else {
    for (let ini = new Date('2025-11-01T00:00:00Z'); ini <= amanha; ini = new Date(ini.getTime() + 180 * 864e5)) {
      const fim = new Date(Math.min(ini.getTime() + 179 * 864e5, amanha.getTime()));
      filtros.push(`dataInicial=${dia(ini)}&dataFinal=${dia(fim)}`);
    }
  }
  const situacoes = new Map<number, string>();
  const nomeSituacao = async (id?: number) => {
    if (!id) return null;
    if (!situacoes.has(id)) {
      try { const s = await chamar(`/situacoes/${id}`, token); situacoes.set(id, s?.data?.nome ?? String(id)); }
      catch { situacoes.set(id, ({ 6: 'Em aberto', 9: 'Atendido', 12: 'Cancelado' } as Record<number, string>)[id] ?? String(id)); }
    }
    return situacoes.get(id)!;
  };
  const lista: unknown[] = [];
  const vistos = new Set<number>();
  for (const filtro of filtros) for (let pagina = 1; pagina <= 50; pagina++) {
    const r = await chamar(`/pedidos/vendas?pagina=${pagina}&limite=100&${filtro}`, token);
    const itens = r?.data ?? [];
    for (const p of itens) {
      if (vistos.has(p.id)) continue; vistos.add(p.id);
      lista.push({ id: p.id, numero: String(p.numero ?? ''), data: p.data, total: p.total ?? p.totalProdutos ?? 0,
        situacao: await nomeSituacao(p.situacao?.id), contato: p.contato ?? {} });
    }
    if (itens.length < 100) break;
  }
  const { data: res, error } = await db.rpc('bling_importar', { lista });
  if (error) throw error;
  // pedidos excluídos no Bling: confere a lista completa dos últimos 180 dias (ou tudo, na primeira leitura)
  let desde = '2025-11-01', idsBling: number[] = [...vistos];
  if (cx?.ultima_sync) {
    desde = dia(new Date(Date.now() - 180 * 864e5)); idsBling = [];
    for (let pagina = 1; pagina <= 30; pagina++) {
      const r = await chamar(`/pedidos/vendas?pagina=${pagina}&limite=100&dataInicial=${desde}&dataFinal=${dia(amanha)}`, token);
      const itens = r?.data ?? []; itens.forEach((x: { id: number }) => idsBling.push(x.id));
      if (itens.length < 100) break;
    }
  }
  let removidos = 0;
  if (idsBling.length) { const { data: rm, error: e3 } = await db.rpc('bling_remover_ausentes', { ids: idsBling, desde }); if (e3) throw e3; removidos = rm ?? 0; }
  const resultado = { ...res, lidos: lista.length, removidos };
  await db.from('bling_conexao').update({ ultima_sync: new Date().toISOString(), ultimo_resultado: resultado, ultimo_erro: null }).eq('id', 1);
  return resultado;
}

// completa o contato dos clientes com o cadastro do Bling, de 20 em 20 (para caber no tempo da função)
async function puxarContatos(inicio: number) {
  const token = await tokenValido();
  const { data: pdvs, count, error } = await db.from('pdvs').select('id, nome, razao_social, cnpj, bling_contato_id', { count: 'exact' })
    .in('etapa', ['avaliacao', 'ativo', 'risco', 'revisao', 'inativo']).order('nome').range(inicio, inicio + 19);
  if (error) throw error;
  const lista: unknown[] = []; let nao_achados = 0;
  for (const p of pdvs ?? []) {
    let id = p.bling_contato_id ? Number(p.bling_contato_id) : null;
    const doc = String(p.cnpj ?? '').replace(/\D/g, '');
    if (!id && doc) { const r = await chamar(`/contatos?limite=1&numeroDocumento=${doc}`, token); id = r?.data?.[0]?.id ?? null; }
    if (!id && p.razao_social) {
      const r = await chamar(`/contatos?limite=5&pesquisa=${encodeURIComponent(p.razao_social)}`, token);
      id = (r?.data ?? []).find((c: { nome?: string }) => (c.nome ?? '').trim().toLowerCase() === p.razao_social.trim().toLowerCase())?.id ?? null;
    }
    if (!id) { nao_achados++; continue; }
    const c = (await chamar(`/contatos/${id}`, token))?.data ?? {};
    lista.push({ pdv_id: p.id, bling_id: String(id), pessoa: c.pessoasContato?.[0]?.descricao ?? null, info: c.informacoesContato ?? null,
      telefone: c.telefone ?? null, celular: c.celular ?? null, email: c.email ?? null });
  }
  const { data: res, error: e2 } = await db.rpc('bling_contatos', { lista });
  if (e2) throw e2;
  const proximo = inicio + (pdvs?.length ?? 0);
  return { ...res, nao_achados, feitos: proximo, total: count ?? 0, fim: proximo >= (count ?? 0) || !(pdvs?.length) };
}

// leitura de consulta (só GET, só estes caminhos) para analisar os cadastros do Bling
const LEITURA_OK = /^\/(pedidos\/vendas(\/\d+)?|produtos(\/\d+)?|formas-pagamentos(\/\d+)?|naturezas-operacoes|vendedores(\/\d+)?|contatos\/\d+|situacoes\/modulos(\/\d+)?|situacoes\/\d+|categorias\/receitas-despesas|lojas?|canais-venda|depositos|empresas\/me\/dados-basicos)(\?.*)?$/;
async function ler(caminho: string) {
  if (!LEITURA_OK.test(caminho)) throw new Error('caminho de leitura não permitido');
  return chamar(caminho, await tokenValido());
}

// envia um pedido do app para o Bling (configuração em regras.chave = 'bling')
// id da forma de pagamento no Bling: primeiro o que está nas regras; senão procura pelo nome (ex.: "Cartão" acha "Cartão de crédito")
const semAc = (t: string) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
async function idForma(nome: string, cfg: Record<string, any>, token: string): Promise<number | null> {
  const f = (cfg.formas ?? {})[nome]; if (f) return Number(f);
  const r = await chamar('/formas-pagamentos?limite=100', token), alvo = semAc(nome).split(' ')[0];
  const ativas = (r?.data ?? []).filter((x: any) => x.situacao === 1);
  const achou = ativas.find((x: any) => semAc(x.descricao).includes(alvo));
  return achou ? Number(achou.id) : null;
}

async function enviarPedido(pedidoId: string) {
  const token = await tokenValido();
  const { data: ped, error } = await db.from('pedidos').select('*, pdvs(id, nome, razao_social, cnpj, bling_contato_id), pedido_itens(quantidade, bonificado, preco_unit, produtos(id, linha, sabor, preco, bling_produto_id, bling_codigo))').eq('id', pedidoId).single();
  if (error || !ped) throw new Error('pedido não encontrado');
  if (ped.bling_id) return { ja_enviado: true, bling_id: ped.bling_id, numero: ped.bling_pedido_id };
  const { data: rg } = await db.from('regras').select('valor').eq('chave', 'bling').maybeSingle();
  const cfg = (rg?.valor ?? {}) as Record<string, any>;
  // contato no Bling: id guardado ou busca pelo CNPJ/CPF
  let contatoId = ped.pdvs?.bling_contato_id ? Number(ped.pdvs.bling_contato_id) : null;
  const doc = String(ped.pdvs?.cnpj ?? '').replace(/\D/g, '');
  if (!contatoId && doc) { const r = await chamar(`/contatos?limite=1&numeroDocumento=${doc}`, token); contatoId = r?.data?.[0]?.id ?? null; }
  if (!contatoId) throw new Error('Cliente sem cadastro no Bling (sem CNPJ/CPF que bata). Cadastre no Bling primeiro.');
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  // preço abaixo da tabela vai como preço de tabela + desconto no pedido (o Bling mostra o desconto)
  let descontoReais = 0;
  const itens = (ped.pedido_itens ?? []).filter((i: any) => i.quantidade > 0).map((i: any) => {
    const pr = i.produtos ?? {};
    const tabela = Number(pr.preco) || 0, cobrado = Number(i.preco_unit) || 0;
    const valorItem = tabela && cobrado < tabela ? tabela : cobrado;
    if (valorItem > cobrado) descontoReais += (valorItem - cobrado) * i.quantidade;
    if (!pr.bling_produto_id && !pr.bling_codigo) throw new Error(`Produto sem vínculo com o Bling: ${pr.linha} ${pr.sabor}`);
    return { ...(pr.bling_produto_id ? { produto: { id: Number(pr.bling_produto_id) } } : {}), ...(pr.bling_codigo ? { codigo: pr.bling_codigo } : {}),
      descricao: `${pr.linha} - ${pr.sabor}`.trim(), quantidade: i.quantidade, valor: valorItem, ...(cfg.unidade ? { unidade: cfg.unidade } : {}), ...(cfg.natureza_id ? { naturezaOperacao: { id: Number(cfg.natureza_id) } } : {}) };
  });
  if (!itens.length) throw new Error('Pedido sem itens');
  descontoReais = Math.round(descontoReais * 100) / 100;
  // entrega terceirizada: cobrada do cliente soma no total (frete por conta do destinatário); por nossa conta só fica registrada
  const frete = Number(ped.frete) || 0, freteCobrado = frete > 0 && ped.frete_cobrado !== false;
  const total = itens.reduce((a: number, i: any) => a + i.quantidade * i.valor, 0) - descontoReais + (freteCobrado ? frete : 0);
  // parcelas: pagamento dividido (ex.: Pix + Cartão) ou uma forma só; a soma acompanha o total do pedido
  let parcelas: any[] = [];
  const lista = Array.isArray(ped.pagamentos) && ped.pagamentos.length ? ped.pagamentos : null;
  if (lista) {
    const soma = lista.reduce((a: number, x: any) => a + Number(x.valor || 0), 0) || 1, fator = total / soma;
    for (const x of lista) {
      const id = await idForma(x.forma, cfg, token);
      if (!id) throw new Error(`Não existe a forma de pagamento "${x.forma}" no Bling. Crie em Cadastros → Formas de pagamento e tente de novo.`);
      parcelas.push({ dataVencimento: x.vencimento ?? ped.vencimento ?? hoje, valor: Math.round(Number(x.valor) * fator * 100) / 100, formaPagamento: { id } });
    }
    const dif = Math.round((total - parcelas.reduce((a, x) => a + x.valor, 0)) * 100) / 100; parcelas[parcelas.length - 1].valor = Math.round((parcelas[parcelas.length - 1].valor + dif) * 100) / 100;
  } else {
    const forma = (await idForma(ped.condicao, cfg, token).catch(() => null)) ?? (cfg.forma_padrao ? Number(cfg.forma_padrao) : null);
    if (forma) parcelas = [{ dataVencimento: ped.vencimento ?? hoje, valor: Math.round(total * 100) / 100, formaPagamento: { id: forma } }];
  }
  const corpo: Record<string, unknown> = {
    data: hoje, dataSaida: hoje, dataPrevista: hoje,
    contato: { id: contatoId },
    itens,
    ...(descontoReais > 0 ? { desconto: { valor: descontoReais, unidade: 'REAL' } } : {}),
    ...(parcelas.length ? { parcelas } : {}),
    ...(cfg.loja_id ? { loja: { id: Number(cfg.loja_id) } } : {}),
    ...(cfg.vendedor_id ? { vendedor: { id: Number(cfg.vendedor_id) } } : {}),
    ...(cfg.situacao_id ? { situacao: { id: Number(cfg.situacao_id) } } : {}),
    ...(cfg.categoria_id ? { categoria: { id: Number(cfg.categoria_id) } } : {}),
    transporte: frete > 0 ? (freteCobrado ? { fretePorConta: 1, frete } : { fretePorConta: 0 }) : { fretePorConta: Number(cfg.frete ?? 9) },
    observacoes: cfg.observacoes ?? undefined,
    observacoesInternas: `Lançado pelo app Jaeger Comercial · pedido ${ped.numero} · ${ped.condicao}${frete > 0 ? ` · entrega terceirizada R$ ${frete.toFixed(2).replace('.', ',')} ${freteCobrado ? 'cobrada do cliente' : 'por nossa conta'}` : ''}`,
  };
  try {
    const r = await fetch(`${API}/pedidos/vendas`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'enable-jwt': '1' }, body: JSON.stringify(corpo) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Bling recusou o pedido (${r.status}): ${JSON.stringify(res?.error ?? res).slice(0, 600)}`);
    const id = res?.data?.id;
    let numero: string | null = null;
    try { numero = String((await chamar(`/pedidos/vendas/${id}`, token))?.data?.numero ?? ''); } catch { /* sem número */ }
    await db.from('pedidos').update({ bling_id: id, bling_pedido_id: numero, bling_status: 'enviado', bling_erro: null, bling_situacao: 'Em aberto' }).eq('id', pedidoId);
    await db.from('pdvs').update({ bling_contato_id: String(contatoId) }).eq('id', ped.pdvs.id).is('bling_contato_id', null);
    return { ok: true, bling_id: id, numero, alertas: res?.data?.alertas ?? [], enviado: corpo };
  } catch (e) {
    await db.from('pedidos').update({ bling_status: 'erro', bling_erro: String((e as Error).message).slice(0, 900) }).eq('id', pedidoId);
    throw e;
  }
}

// atualiza no Bling o contato dos negócios em que esta pessoa é o contato principal:
// nome no app → "Pessoa de contato" no Bling · cargo no app → "Informações do contato"
async function atualizarContatoBling(contatoId: string) {
  const { data: c } = await db.from('contatos').select('id, nome, cargo').eq('id', contatoId).maybeSingle();
  if (!c) throw new Error('Contato não encontrado');
  const { data: pdvs } = await db.from('pdvs').select('nome, bling_contato_id').eq('contato_id', contatoId).not('bling_contato_id', 'is', null);
  if (!pdvs?.length) return { ok: true, atualizados: 0 };
  const token = await tokenValido(), feitos: string[] = [], erros: string[] = [];
  for (const p of pdvs) {
    try {
      const atual = (await chamar(`/contatos/${p.bling_contato_id}`, token))?.data;
      if (!atual) throw new Error('não achei o contato no Bling');
      const corpo: Record<string, any> = { ...atual }; delete corpo.id;
      // campos que o Bling devolve vazios mas recusa de volta
      if (!corpo.dadosAdicionais?.dataNascimento || /^0000/.test(corpo.dadosAdicionais.dataNascimento)) delete corpo.dadosAdicionais;
      if (corpo.financeiro?.categoria && !corpo.financeiro.categoria.id) delete corpo.financeiro.categoria;
      if (corpo.pais && !corpo.pais.nome) delete corpo.pais;
      if (!corpo.orgaoPublico) delete corpo.orgaoPublico;
      const pessoas = Array.isArray(atual.pessoasContato) ? atual.pessoasContato : [];
      corpo.pessoasContato = [{ ...(pessoas[0]?.id ? { id: pessoas[0].id } : {}), descricao: c.nome }, ...pessoas.slice(1)];
      if (c.cargo) corpo.informacoesContato = c.cargo;
      const r = await fetch(`${API}/contatos/${p.bling_contato_id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'enable-jwt': '1' }, body: JSON.stringify(corpo) });
      if (!r.ok) { const res = await r.json().catch(() => ({})); throw new Error(`(${r.status}) ${JSON.stringify(res?.error ?? res).slice(0, 300)}`); }
      feitos.push(p.nome); await esperar(350);
    } catch (e) { erros.push(`${p.nome}: ${(e as Error).message}`); }
  }
  return { ok: !erros.length, atualizados: feitos.length, feitos, erros };
}

// exclui no Bling o pedido de venda gerado pelo app (usado ao reabrir uma reposição para corrigir)
async function excluirPedido(pedidoId: string) {
  const { data: ped } = await db.from('pedidos').select('id, bling_id').eq('id', pedidoId).maybeSingle();
  if (!ped?.bling_id) return { ok: true, sem_bling: true };
  const token = await tokenValido();
  const r = await fetch(`${API}/pedidos/vendas/${ped.bling_id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'enable-jwt': '1' } });
  if (!r.ok && r.status !== 404) { const res = await r.json().catch(() => ({})); throw new Error(`O Bling não excluiu o pedido (${r.status}): ${JSON.stringify(res?.error ?? res).slice(0, 400)}`); }
  await db.from('pedidos').update({ bling_id: null, bling_pedido_id: null, bling_status: 'pendente', bling_situacao: null }).eq('id', pedidoId);
  return { ok: true, excluido: ped.bling_id };
}

// itens dos pedidos do Bling que ainda não têm itens no app (de 25 em 25)
async function puxarItens() {
  const token = await tokenValido();
  const { data: peds, error } = await db.from('pedidos').select('id, bling_id, bling_itens(ordem)').not('bling_id', 'is', null).order('criado_em', { ascending: false }).limit(2000);
  if (error) throw error;
  const falta = (peds ?? []).filter((p: any) => !(p.bling_itens ?? []).length);
  const lote = falta.slice(0, 25), lista: unknown[] = []; let erros = 0;
  for (const p of lote) {
    try { const d = (await chamar(`/pedidos/vendas/${p.bling_id}`, token))?.data ?? {};
      lista.push({ pedido_id: p.id, itens: (d.itens ?? []).map((i: any) => ({ codigo: i.codigo, descricao: i.descricao, quantidade: i.quantidade, valor: i.valor, desconto: i.desconto ?? 0 })) });
    } catch { erros++; }
  }
  if (lista.length) { const { error: e2 } = await db.rpc('bling_gravar_itens', { lista }); if (e2) throw e2; }
  return { feitos: lista.length, erros, faltam: Math.max(0, falta.length - lote.length), fim: falta.length <= lote.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);

  // volta do Bling depois que você autoriza
  if (req.method === 'GET') {
    const app = env('APP_URL') || 'https://jaeger-comercial-app.vercel.app';
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    try {
      if (!code || !state) throw new Error('retorno sem código');
      const { data: st } = await db.from('bling_estados').delete().eq('state', state).select().maybeSingle();
      if (!st || Date.now() - new Date(st.criado_em).getTime() > 15 * 60000) throw new Error('autorização expirada, tente de novo');
      await pedirToken({ grant_type: 'authorization_code', code });
      await db.from('bling_conexao').update({ conectado_em: new Date().toISOString() }).eq('id', 1);
      return Response.redirect(`${app}/#bling=ok`, 302);
    } catch (e) {
      return Response.redirect(`${app}/#bling=erro&msg=${encodeURIComponent(String((e as Error).message).slice(0, 200))}`, 302);
    }
  }

  // ações do app: só para quem está logado
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return json({ erro: 'não autorizado' }, 401);
  const { acao, inicio, caminho, pedido_id, contato_id } = await req.json().catch(() => ({}));
  try {
    if (acao === 'status') {
      const { data } = await db.from('bling_conexao').select('conectado_em, ultima_sync, ultimo_resultado, ultimo_erro, refresh_token').eq('id', 1).maybeSingle();
      return json({ conectado: !!data?.refresh_token, conectado_em: data?.conectado_em, ultima_sync: data?.ultima_sync, ultimo_resultado: data?.ultimo_resultado, ultimo_erro: data?.ultimo_erro, configurado: !!(env('BLING_CLIENT_ID') && env('BLING_CLIENT_SECRET')) });
    }
    if (acao === 'conectar') {
      if (!env('BLING_CLIENT_ID') || !env('BLING_CLIENT_SECRET')) return json({ erro: 'Falta cadastrar BLING_CLIENT_ID e BLING_CLIENT_SECRET nos segredos do Supabase' }, 400);
      const state = crypto.randomUUID();
      await db.from('bling_estados').delete().lt('criado_em', new Date(Date.now() - 3600000).toISOString());
      await db.from('bling_estados').insert({ state });
      const q = new URLSearchParams({ response_type: 'code', client_id: env('BLING_CLIENT_ID'), state, redirect_uri: redirectUri() });
      return json({ url: `${BLING}/oauth/authorize?${q}` });
    }
    if (acao === 'sincronizar') return json(await sincronizar());
    if (acao === 'contatos') return json(await puxarContatos(Number(inicio) || 0));
    if (acao === 'ler') return json(await ler(String(caminho || '')));
    if (acao === 'itens') return json(await puxarItens());
    if (acao === 'enviar_pedido') return json(await enviarPedido(String(pedido_id || '')));
    if (acao === 'excluir_pedido') return json(await excluirPedido(String(pedido_id || '')));
    if (acao === 'atualizar_contato') return json(await atualizarContatoBling(String(contato_id || '')));
    return json({ erro: 'ação desconhecida' }, 400);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await db.from('bling_conexao').update({ ultimo_erro: msg.slice(0, 500) }).eq('id', 1);
    return json({ erro: msg }, 500);
  }
});
