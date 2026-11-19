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
  const resultado = { ...res, lidos: lista.length };
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
  const { acao, inicio } = await req.json().catch(() => ({}));
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
    return json({ erro: 'ação desconhecida' }, 400);
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    await db.from('bling_conexao').update({ ultimo_erro: msg.slice(0, 500) }).eq('id', 1);
    return json({ erro: msg }, 500);
  }
});
