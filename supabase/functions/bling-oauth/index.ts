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

// mão dupla dos contatos: traz do Bling a pessoa de contato e o cargo dos clientes alterados lá desde a última leitura.
// vale a edição mais recente: se o contato foi editado no app depois da última leitura, o app ganha (e já mandou para o Bling ao salvar)
const cargoDe = (t: string) => /dono|propriet|s[óo]ci/i.test(t) ? 'Dono' : /gerente|gestor|encarregad|respons/i.test(t) ? 'Gerente' : /funcion|atendente|caixa|balconista|colaborador/i.test(t) ? 'Funcionário' : null;
async function contatosDoBling(token: string, ultimaSync: string | null) {
  const { data: pdvs } = await db.from('pdvs').select('id, nome, contato_id, bling_contato_id').not('bling_contato_id', 'is', null);
  const porBling = new Map((pdvs ?? []).map((p: any) => [String(p.bling_contato_id), p]));
  if (!porBling.size) return { contatos_lidos: 0, contatos_atualizados: 0 };
  let ids: string[] = [];
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  if (ultimaSync) {
    try {
      const de = dia(new Date(new Date(ultimaSync).getTime() - 864e5)), ate = dia(new Date(Date.now() + 864e5));
      for (let pagina = 1; pagina <= 20; pagina++) {
        const r = await chamar(`/contatos?pagina=${pagina}&limite=100&dataAlteracaoInicial=${de}&dataAlteracaoFinal=${ate}`, token);
        const itens = r?.data ?? []; itens.forEach((c: any) => { if (porBling.has(String(c.id))) ids.push(String(c.id)); });
        if (itens.length < 100) break;
      }
    } catch { ids = [...porBling.keys()]; } // se o filtro por data falhar, confere todos os clientes ligados
  } else ids = [...porBling.keys()];
  let atualizados = 0; const novos: unknown[] = [];
  for (const bid of [...new Set(ids)]) {
    const p: any = porBling.get(bid); let c: any;
    try { c = (await chamar(`/contatos/${bid}`, token))?.data; } catch { continue; }
    const pessoa = String(c?.pessoasContato?.[0]?.descricao ?? '').trim(), info = String(c?.informacoesContato ?? '').trim();
    if (!pessoa && !info) continue;
    if (!p.contato_id) { novos.push({ pdv_id: p.id, bling_id: bid, pessoa: pessoa || null, info, telefone: c.telefone ?? null, celular: c.celular ?? null, email: c.email ?? null }); continue; }
    const { data: ct } = await db.from('contatos').select('id, nome, cargo, observacao, atualizado_em').eq('id', p.contato_id).maybeSingle();
    if (!ct) continue;
    if (ultimaSync && new Date(ct.atualizado_em) > new Date(ultimaSync)) continue; // editado no app depois da última leitura: app ganha
    const cargo = cargoDe(info), patch: Record<string, unknown> = {};
    if (pessoa && pessoa !== ct.nome) patch.nome = pessoa;
    if (cargo && cargo !== ct.cargo) patch.cargo = cargo;
    if (patch.nome && /sem pessoa de contato/.test(ct.observacao ?? '')) patch.observacao = String(ct.observacao).replace(/ ?· ?sem pessoa de contato/, '').trim() || null;
    if (Object.keys(patch).length) { await db.from('contatos').update({ ...patch, atualizado_em: new Date().toISOString() }).eq('id', ct.id); atualizados++; }
  }
  if (novos.length) { const { data: r } = await db.rpc('bling_contatos', { lista: novos }); atualizados += (r as any)?.criados ?? 0; }
  return { contatos_lidos: ids.length, contatos_atualizados: atualizados };
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
  let ctt: Record<string, unknown> = {}; try { ctt = await contatosDoBling(token, cx?.ultima_sync ?? null); } catch (e) { ctt = { contatos_erro: (e as Error).message }; }
  const resultado = { ...res, lidos: lista.length, removidos, ...ctt };
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
const LEITURA_OK = /^\/(pedidos\/vendas(\/\d+)?|produtos(\/\d+)?|formas-pagamentos(\/\d+)?|naturezas-operacoes|vendedores(\/\d+)?|contatos\/\d+|situacoes\/modulos(\/\d+)?|situacoes\/\d+|categorias\/receitas-despesas(\/\d+)?|lojas?|canais-venda|depositos|empresas\/me\/dados-basicos|contas\/(receber|pagar)(\/\d+)?|contas-contabeis(\/\d+)?|caixas(\/\d+)?|nfe(\/\d+)?|produtos\/fornecedores(\/\d+)?|borderos(\/\d+)?|contatos|estoques\/saldos)(\?.*)?$/;
async function ler(caminho: string) {
  if (!LEITURA_OK.test(caminho)) throw new Error('caminho de leitura não permitido');
  return chamar(caminho, await tokenValido());
}

// financeiro: lista paginada (contas a receber/pagar, caixas) e escritas permitidas (criar conta, baixa total, lançamento no caixa)
async function listarTudo(caminho: string, maxPaginas = 20) {
  if (!LEITURA_OK.test(caminho)) throw new Error('caminho de leitura não permitido');
  const token = await tokenValido(), out: unknown[] = [], sep = caminho.includes('?') ? '&' : '?';
  for (let p = 1; p <= maxPaginas; p++) { const r = await chamar(`${caminho}${sep}pagina=${p}&limite=100`, token); const d = (r as { data?: unknown[] }).data ?? []; out.push(...d); if (d.length < 100) break; }
  return { data: out };
}
const ESCRITA_OK: [string, RegExp][] = [['POST', /^\/contas\/(receber|pagar)$/], ['POST', /^\/contas\/(receber|pagar)\/\d+\/baixar$/], ['DELETE', /^\/contas\/(receber|pagar)\/\d+$/], ['POST', /^\/caixas$/]];
async function escreverFin(metodo: string, caminho: string, corpo: unknown) {
  if (!ESCRITA_OK.some(([m, re]) => m === metodo && re.test(caminho))) throw new Error('escrita não permitida');
  const token = await tokenValido();
  const r = await fetch(`${API}${caminho}`, { method: metodo, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'enable-jwt': '1' }, ...(metodo === 'DELETE' ? {} : { body: JSON.stringify(corpo ?? {}) }) });
  const txt = await r.text(); let j: unknown = {}; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { texto: txt }; }
  if (!r.ok) throw new Error(`Bling ${caminho} (${r.status}): ${JSON.stringify(j).slice(0, 600)}`);
  return j;
}

// custo dos produtos: grava o preço de custo de cada produto e confere lendo de volta.
// O Bling guarda o custo no vínculo produto-fornecedor; tenta, nesta ordem: PATCH do produto, PUT do vínculo /produtos/fornecedores, PUT do produto inteiro (só produto simples)
async function enviarBling(metodo: string, caminho: string, corpo: unknown, token: string) {
  const r = await fetch(`${API}${caminho}`, { method: metodo, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'enable-jwt': '1' }, body: JSON.stringify(corpo) });
  let txt = await r.text(); try { const j = JSON.parse(txt); const e = j?.error; txt = e ? [e.message, e.description, ...(e.fields || []).map((f: any) => f.msg)].filter(Boolean).join(' · ') : JSON.stringify(j); } catch { /* texto puro */ } return { ok: r.ok, status: r.status, txt: txt.slice(0, 900) };
}
async function atualizarCustos(itens: { id: string | number; custo: number }[]) {
  const token = await tokenValido(), out: unknown[] = [];
  const lerCusto = async (id: string) => Number(((await chamar(`/produtos/${id}`, token) as any)?.data?.fornecedor?.precoCusto) ?? NaN);
  for (const it of (itens || []).slice(0, 50)) {
    const id = String(it.id || '').replace(/\D/g, ''), custo = Math.round(Number(it.custo) * 100) / 100, tent: unknown[] = [];
    if (!id || !(custo >= 0)) { out.push({ id, ok: false, erro: 'dados inválidos' }); continue; }
    try {
      const atual = (await chamar(`/produtos/${id}`, token) as any)?.data ?? {}, f = atual.fornecedor ?? {}, antes = Number(f.precoCusto ?? 0);
      let depois = NaN, via = '';
      // 1) PATCH parcial do produto
      let r = await enviarBling('PATCH', `/produtos/${id}`, { fornecedor: { ...(f.id ? { id: f.id } : {}), ...(f.contato?.id ? { contato: { id: f.contato.id } } : {}), precoCusto: custo } }, token); tent.push({ via: 'patch', ...r });
      if (r.ok) { depois = await lerCusto(id); if (Math.abs(depois - custo) < 0.005) via = 'patch'; }
      // 2) vínculo produto-fornecedor
      if (!via && f.id) {
        let v: any = {}; try { v = (await chamar(`/produtos/fornecedores/${f.id}`, token) as any)?.data ?? {}; } catch { /* segue */ }
        const corpo = { descricao: v.descricao ?? '', codigo: v.codigo ?? f.codigo ?? '', precoCusto: custo, precoCompra: Number(v.precoCompra ?? f.precoCompra ?? 0), padrao: v.padrao ?? true, garantia: v.garantia ?? 0,
          produto: { id: Number(id) }, fornecedor: { id: Number(v.fornecedor?.id ?? f.contato?.id ?? 0) } };
        r = await enviarBling('PUT', `/produtos/fornecedores/${f.id}`, corpo, token); tent.push({ via: 'fornecedor', ...r });
        if (r.ok) { depois = await lerCusto(id); if (Math.abs(depois - custo) < 0.005) via = 'fornecedor'; }
      }
      // 3) produto inteiro (só simples, sem variações nem estrutura)
      if (!via && atual.formato === 'S' && !(atual.variacoes?.length)) {
        const corpo = { ...atual, fornecedor: { ...f, precoCusto: custo } }; delete corpo.id; delete corpo.actionEstoque; delete corpo.variacoes; if (corpo.estoque) delete corpo.estoque.saldoVirtualTotal;
        r = await enviarBling('PUT', `/produtos/${id}`, corpo, token); tent.push({ via: 'produto', ...r });
        if (r.ok) { depois = await lerCusto(id); if (Math.abs(depois - custo) < 0.005) via = 'produto'; }
      }
      out.push({ id, nome: atual.nome, codigo: atual.codigo, antes, depois, ok: !!via, via, ...(via ? {} : { erro: 'o Bling não gravou o custo', tentativas: tent }) });
    } catch (e) { out.push({ id, ok: false, erro: String((e as Error).message || e), tentativas: tent }); }
  }
  return { itens: out };
}

// preço de venda (tabela) dos produtos: PATCH do produto e confere lendo de volta
async function atualizarPrecos(itens: { id: string | number; preco: number }[]) {
  const token = await tokenValido(), out: unknown[] = [];
  for (const it of (itens || []).slice(0, 50)) {
    const id = String(it.id || '').replace(/\D/g, ''), preco = Math.round(Number(it.preco) * 100) / 100;
    if (!id || !(preco > 0)) { out.push({ id, ok: false, erro: 'dados inválidos' }); continue; }
    try {
      const atual = (await chamar(`/produtos/${id}`, token) as any)?.data ?? {}, antes = Number(atual.preco ?? 0);
      const r = await enviarBling('PATCH', `/produtos/${id}`, { preco }, token);
      const depois = Number(((await chamar(`/produtos/${id}`, token) as any)?.data?.preco) ?? NaN);
      out.push({ id, nome: atual.nome, antes, depois, ok: Math.abs(depois - preco) < 0.005, ...(r.ok ? {} : { erro: `Bling (${r.status}): ${r.txt}` }) });
    } catch (e) { out.push({ id, ok: false, erro: String((e as Error).message || e) }); }
  }
  return { itens: out };
}

// ---------- financeiro do pedido: contas a receber, baixa e nota fiscal ----------
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
async function pedidoBling(pedidoId: string) {
  const { data: ped } = await db.from('pedidos').select('id, numero, bling_id, condicao, valor, criado_em').eq('id', pedidoId).maybeSingle();
  if (!ped) throw new Error('Pedido não encontrado'); if (!ped.bling_id) throw new Error('Este pedido ainda não foi enviado ao Bling'); return ped;
}
// contas a receber geradas pelo pedido (com link do boleto e do Pix)
async function contasDoPedido(bid: string, token: string, dataPed?: string, nfId?: string | number) {
  let ids: number[] = []; const origens = [String(bid), ...(nfId ? [String(nfId)] : [])];
  try { const r: any = await chamar(`/contas/receber/boletos?idOrigem=${bid}`, token); const d = r?.data ?? r; ids = (d?.contas ?? (Array.isArray(d) ? d.flatMap((x: any) => x.contas ?? []) : [])).map((c: any) => Number(c.id)).filter(Boolean); } catch { /* segue */ }
  if (!ids.length) { const base = dataPed ? new Date(dataPed).getTime() : Date.now(), de = new Date(base - 15 * 864e5).toISOString().slice(0, 10), ate = new Date(base + 340 * 864e5).toISOString().slice(0, 10); // o Bling aceita no máximo 366 dias
    for (let pg = 1; pg <= 10; pg++) { const r: any = await chamar(`/contas/receber?dataInicial=${de}&dataFinal=${ate}&pagina=${pg}&limite=100`, token); const d = r?.data ?? [];
      d.filter((c: any) => origens.includes(String(c.origem?.id ?? ''))).forEach((c: any) => ids.push(Number(c.id))); if (d.length < 100) break; } }
  const out: any[] = [];
  for (const id of [...new Set(ids)]) { try { const c: any = (await chamar(`/contas/receber/${id}`, token))?.data ?? {};
    out.push({ id: c.id, situacao: c.situacao, valor: c.valor, saldo: c.saldo, vencimento: c.vencimento, forma: c.formaPagamento?.id, conta: c.contaContabil?.descricao ?? null, linkBoleto: c.linkBoleto || null, linkPix: c.linkQRCodePix || null }); } catch { /* ignora */ } }
  return out;
}
// lança as contas do pedido no Bling (se ainda não tiver) e devolve as contas
async function contasPedido(pedidoId: string) {
  const token = await tokenValido(), ped = await pedidoBling(pedidoId);
  // pedido com nota fiscal: as contas são lançadas pela nota (e ficam com a nota como origem)
  const pv: any = (await chamar(`/pedidos/vendas/${ped.bling_id}`, token) as any)?.data ?? {}, nfId = pv.notaFiscal?.id ? String(pv.notaFiscal.id) : '';
  let contas = await contasDoPedido(String(ped.bling_id), token, ped.criado_em, nfId), lancou = false;
  if (!contas.length) {
    let nf: any = null; if (nfId) { try { nf = (await chamar(`/nfe/${nfId}`, token) as any)?.data ?? null; } catch { nf = null; } } // nota excluída no Bling: segue pelo pedido
    if (nf) {
      if (![5, 6, 7].includes(Number(nf.situacao))) throw new Error(`Este pedido está ligado à nota fiscal ${nf.numero || ''}, que ainda não foi autorizada (situação ${nf.situacao}). Emita a nota pelo botão "Gerar nota fiscal" (ou exclua a nota no Bling) e depois lance a conta.`);
      const r = await enviarBling('POST', `/nfe/${nfId}/lancar-contas`, {}, token);
      if (!r.ok && !/j[aá] existem contas|lan[cç]ad/i.test(r.txt)) throw new Error(`O Bling não lançou as contas da nota: ${r.txt}`);
    } else {
      const r = await enviarBling('POST', `/pedidos/vendas/${ped.bling_id}/lancar-contas`, {}, token);
      if (!r.ok && !/j[aá] existem contas|lan[cç]ad/i.test(r.txt)) throw new Error(`O Bling não lançou as contas: ${r.txt}`);
    }
    lancou = true; await new Promise(res => setTimeout(res, 1200)); contas = await contasDoPedido(String(ped.bling_id), token, ped.criado_em, nfId);
  }
  return { pedido: ped.numero, lancou, contas };
}
// baixa (recebimento) das contas do pedido: só as que não são boleto; conta financeira pela forma (Regras e metas)
async function baixarPedido(pedidoId: string) {
  const token = await tokenValido(), { contas, lancou } = await contasPedido(pedidoId);
  const { data: rb } = await db.from('regras').select('valor').eq('chave', 'bling').maybeSingle(), { data: rp } = await db.from('regras').select('valor').eq('chave', 'fin_portadores').maybeSingle();
  const formas: Record<string, any> = rb?.valor?.formas ?? {}, port: Record<string, any> = rp?.valor ?? {}, nomeForma: Record<string, string> = {};
  Object.entries(formas).forEach(([n, id]) => nomeForma[String(id)] = n);
  let fp: any[] = []; try { fp = ((await chamar('/formas-pagamentos?limite=100', token)) as any)?.data ?? []; } catch { /* segue */ }
  const ehBoleto = (id: any) => /boleto/i.test(nomeForma[String(id)] ?? '') || fp.some((f: any) => String(f.id) === String(id) && (f.tipoPagamento === 15 || /boleto/i.test(f.descricao)));
  const nomeDe = (id: any) => nomeForma[String(id)] ?? (fp.find((f: any) => String(f.id) === String(id))?.descricao ?? '');
  let blingConta: number | null = null;
  const portadorDe = async (id: any) => { const n = nomeDe(id), k = Object.keys(port).find(x => semAc(n).startsWith(semAc(x))); if (k && port[k]) return Number(port[k]);
    if (/pix/i.test(n)) { if (blingConta == null) { try { const cs = ((await chamar('/contas-contabeis', token)) as any)?.data ?? []; blingConta = Number(cs.find((c: any) => /bling conta/i.test(c.descricao))?.id) || 0; } catch { blingConta = 0; } } return blingConta || null; }
    return null; };
  const out: any[] = [];
  for (const c of contas) {
    if (![1, 3].includes(Number(c.situacao))) { out.push({ id: c.id, ok: true, ja: true }); continue; }
    if (ehBoleto(c.forma)) { out.push({ id: c.id, ok: true, boleto: true }); continue; }
    const pid = await portadorDe(c.forma);
    // Bling Conta: o Bling recusa a baixa informando a conta financeira; sem informar, a baixa cai na própria conta (como a "Baixa total" da tela)
    const naBlingConta = /bling conta/i.test(String(c.conta || '')) || (!!pid && pid === blingConta);
    const corpo: any = { data: hojeBR(), valorRecebido: Number(c.saldo || c.valor), historico: 'Recebido na entrega (app Jaeger)', ...(pid && !naBlingConta ? { portador: { id: pid } } : {}) };
    const r = await enviarBling('POST', `/contas/receber/${c.id}/baixar`, corpo, token);
    out.push({ id: c.id, valor: corpo.valorRecebido, forma: nomeDe(c.forma), ok: r.ok, ...(r.ok ? {} : { erro: `Bling (${r.status}): ${r.txt}` }) });
  }
  return { lancou, contas: out };
}
// nota fiscal: gera a NF-e do pedido, transmite para a SEFAZ e devolve número e links
async function lerNfe(id: number | string, token: string) { const n: any = (await chamar(`/nfe/${id}`, token))?.data ?? {}; return { id: n.id, numero: n.numero, serie: n.serie, situacao: n.situacao, chave: n.chaveAcesso || null, linkDanfe: n.linkDanfe || null, linkPDF: n.linkPDF || null, valor: n.valorNota }; }
// próximo número de NF-e: o maior número já usado (autorizada, emitida, cancelada ou denegada) + 1, na mesma série
async function proximoNumeroNfe(token: string, serie?: number | string) {
  // a listagem do Bling não traz a série: considera todas as notas de saída e, se vier série, só as da mesma série
  let max = 0; const ser = serie != null && serie !== '' ? Number(serie) : null;
  for (let pg = 1; pg <= 20; pg++) {
    const r: any = await chamar(`/nfe?tipo=1&limite=100&pagina=${pg}`, token), d = r?.data ?? [];
    d.forEach((n: any) => { const num = parseInt(String(n.numero || '0'), 10) || 0, sit = Number(n.situacao), sn = n.serie === '' || n.serie == null ? null : Number(n.serie);
      if ([2, 5, 6, 7, 9].includes(sit) && (ser == null || sn == null || sn === ser) && num > max) max = num; });
    if (d.length < 100) break;
  }
  return { numero: max + 1, serie: ser, ultimo: max };
}
async function gerarNfe(pedidoId: string, nfeId?: string, numero?: number) {
  const token = await tokenValido(); let id = nfeId ? Number(nfeId) : 0;
  if (id) { try { await chamar(`/nfe/${id}`, token); } catch { id = 0; } } // a nota rejeitada foi excluída no Bling: gera outra
  if (!id) { const ped = await pedidoBling(pedidoId);
    const r = await fetch(`${API}/pedidos/vendas/${ped.bling_id}/gerar-nfe`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'enable-jwt': '1' } });
    const j: any = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`O Bling não gerou a nota (${r.status}): ${JSON.stringify(j?.error ?? j).slice(0, 600)}`);
    id = Number(j?.data?.idNotaFiscal ?? j?.idNotaFiscal); if (!id) throw new Error('O Bling não devolveu o número da nota'); }
  // numeração: usa o número informado (ou o próximo da série) antes de transmitir
  const nota: any = (await chamar(`/nfe/${id}`, token))?.data ?? {};
  const alvo = Number(numero) || (await proximoNumeroNfe(token, nota.serie)).numero, atual = parseInt(String(nota.numero || '0'), 10) || 0;
  if (alvo && alvo !== atual) {
    const corpo: any = { ...nota, numero: String(alvo).padStart(6, '0') }; ['id', 'situacao', 'chaveAcesso', 'xml', 'linkDanfe', 'linkPDF'].forEach(k => delete corpo[k]);
    const u = await enviarBling('PUT', `/nfe/${id}`, corpo, token);
    if (!u.ok) throw new Error(`O Bling não aceitou o número ${alvo} na nota (${u.status}): ${u.txt}`);
  }
  const env = await enviarBling('POST', `/nfe/${id}/enviar`, {}, token);
  await new Promise(res => setTimeout(res, 1500));
  const n = await lerNfe(id, token);
  return { ...n, enviada: env.ok, ...(env.ok && ![4].includes(Number(n.situacao)) ? {} : { erro: `A nota ${n.numero || ''} não foi autorizada: ${env.ok ? 'rejeitada pela SEFAZ, veja o motivo no Bling' : env.txt}` }) };
}

// cliente novo: procura pelo nome exato e, se não existir, cria o cadastro no Bling com os dados do app
async function criarContatoBling(p: any, doc: string, token: string): Promise<number | null> {
  if (!p?.nome) return null;
  const nome = String(p.razao_social || p.nome).trim();
  try { const r = await chamar(`/contatos?limite=5&pesquisa=${encodeURIComponent(nome)}`, token); const igual = (r?.data ?? []).find((c: any) => String(c.nome || '').trim().toLowerCase() === nome.toLowerCase()); if (igual?.id) return Number(igual.id); } catch { /* segue para criar */ }
  const tel = String(p.contatos?.whatsapp || p.contatos?.telefone || p.telefone || '').replace(/\D/g, '');
  const rua = String(p.endereco || '').replace(/,\s*\d+.*$/, '').trim();
  const corpo: Record<string, unknown> = {
    nome, fantasia: p.nome, situacao: 'A', tipo: doc.length === 11 ? 'F' : doc.length === 14 ? 'J' : 'J', indicadorIe: 9,
    ...(doc ? { numeroDocumento: doc } : {}), ...(tel ? { celular: tel } : {}), ...(p.contatos?.email ? { email: p.contatos.email } : {}),
    endereco: { geral: { endereco: rua || undefined, numero: p.numero || (String(p.endereco || '').match(/,\s*(\d+)/)?.[1]) || 'S/N', bairro: p.bairro || undefined, municipio: p.cidade || undefined, uf: p.uf || 'RS', cep: String(p.cep || '').replace(/\D/g, '') || undefined } },
  };
  const r = await fetch(`${API}/contatos`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'enable-jwt': '1' }, body: JSON.stringify(corpo) });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Cliente novo: o Bling recusou criar o cadastro (${r.status}): ${JSON.stringify(res?.error ?? res).slice(0, 500)}`);
  const id = res?.data?.id ? Number(res.data.id) : null;
  if (id) await db.from('pdvs').update({ bling_contato_id: String(id) }).eq('id', p.id);
  return id;
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

async function enviarPedido(pedidoId: string, atualizar = false) { // atualizar: reescreve no Bling o pedido já enviado (mesmo número), sem excluir
  const token = await tokenValido();
  const { data: ped, error } = await db.from('pedidos').select('*, pdvs(*, contatos!pdvs_contato_id_fkey(nome, telefone, whatsapp, email)), pedido_itens(quantidade, bonificado, preco_unit, produtos(id, linha, sabor, preco, bling_produto_id, bling_codigo))').eq('id', pedidoId).single();
  if (error || !ped) { const msg = 'Não consegui ler o pedido no banco: ' + (error?.message || 'pedido não encontrado'); await db.from('pedidos').update({ bling_status: 'erro', bling_erro: msg }).eq('id', pedidoId); throw new Error(msg); }
  if (ped.bling_id && !atualizar) return { ja_enviado: true, bling_id: ped.bling_id, numero: ped.bling_pedido_id };
  if (atualizar && !ped.bling_id) atualizar = false;
  const { data: rg } = await db.from('regras').select('valor').eq('chave', 'bling').maybeSingle();
  const cfg = (rg?.valor ?? {}) as Record<string, any>;
  // contato no Bling: id guardado ou busca pelo CNPJ/CPF
  let contatoId = ped.pdvs?.bling_contato_id ? Number(ped.pdvs.bling_contato_id) : null;
  const doc = String(ped.pdvs?.cnpj ?? '').replace(/\D/g, '');
  if (!contatoId && doc) { const r = await chamar(`/contatos?limite=1&numeroDocumento=${doc}`, token); contatoId = r?.data?.[0]?.id ?? null; }
  if (!contatoId) contatoId = await criarContatoBling(ped.pdvs, doc, token);
  if (!contatoId) throw new Error('Não consegui achar nem criar o cliente no Bling.');
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
    if (atualizar) { const dOrig = new Date(new Date(ped.criado_em).getTime() - 3 * 3600e3).toISOString().slice(0, 10); corpo.data = dOrig; corpo.dataSaida = dOrig; corpo.dataPrevista = dOrig; if (ped.bling_pedido_id) corpo.numero = Number(ped.bling_pedido_id) || undefined;
      corpo.observacoesInternas = String(corpo.observacoesInternas) + ' · editado no app';
      const r = await fetch(`${API}/pedidos/vendas/${ped.bling_id}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'enable-jwt': '1' }, body: JSON.stringify(corpo) });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Bling recusou a edição (${r.status}): ${JSON.stringify(res?.error ?? res).slice(0, 600)}`);
      await db.from('pedidos').update({ bling_status: 'enviado', bling_erro: null }).eq('id', pedidoId);
      return { ok: true, atualizado: true, bling_id: ped.bling_id, numero: ped.bling_pedido_id };
    }
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
    if (!atualizar) await db.from('pedidos').update({ bling_status: 'erro', bling_erro: String((e as Error).message).slice(0, 900) }).eq('id', pedidoId);
    else await db.from('pedidos').update({ bling_erro: 'Edição não foi para o Bling: ' + String((e as Error).message).slice(0, 860) }).eq('id', pedidoId);
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
  const { acao, inicio, caminho, pedido_id, contato_id, metodo, corpo, paginas, itens, nfe_id, numero, serie } = await req.json().catch(() => ({}));
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
    if (acao === 'fin_listar') return json(await listarTudo(String(caminho || ''), Math.min(50, Number(paginas) || 20)));
    if (acao === 'fin_escrever') return json(await escreverFin(String(metodo || ''), String(caminho || ''), corpo));
    if (acao === 'itens') return json(await puxarItens());
    if (acao === 'atualizar_custos') return json(await atualizarCustos(itens));
    if (acao === 'atualizar_precos') return json(await atualizarPrecos(itens));
    if (acao === 'contas_pedido') return json(await contasPedido(String(pedido_id || '')));
    if (acao === 'baixar_pedido') return json(await baixarPedido(String(pedido_id || '')));
    if (acao === 'gerar_nfe') return json(await gerarNfe(String(pedido_id || ''), nfe_id ? String(nfe_id) : undefined, Number(numero) || undefined));
    if (acao === 'nfe_proximo') return json(await proximoNumeroNfe(await tokenValido(), serie ?? undefined));
    if (acao === 'nfe') return json(await lerNfe(String(nfe_id || ''), await tokenValido()));
    if (acao === 'enviar_pedido') return json(await enviarPedido(String(pedido_id || '')));
    if (acao === 'atualizar_pedido') return json(await enviarPedido(String(pedido_id || ''), true));
    if (acao === 'excluir_pedido') return json(await excluirPedido(String(pedido_id || '')));
    if (acao === 'atualizar_contato') return json(await atualizarContatoBling(String(contato_id || '')));
    return json({ erro: 'ação desconhecida' }, 400);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await db.from('bling_conexao').update({ ultimo_erro: msg.slice(0, 500) }).eq('id', 1);
    return json({ erro: msg }, 500);
  }
});
