// Jaeger's Comercial · app web
import * as db from './db.js';

/* =================== utilidades =================== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('pt-BR');
const brl = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dstr = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—';
const dec = n => Number(n || 0).toFixed(1).replace('.', ',');
const DIA = 864e5;
function toast(t) { const e = $('#toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => e.style.display = 'none', 4200); }
function erro(e) { console.error(e); const m = String(e.message || e); toast(/janela_periodo_check/.test(m) ? 'Para marcar mais de um período, rode o 029_periodos_multiplos.sql no Supabase' : /'(numero|uf|cep)' column|column pdvs\.(numero|uf|cep)|(numero|uf|cep)" of relation/.test(m) ? 'Para salvar número, UF e CEP separados, rode o 033_endereco_campos.sql no Supabase' : /consumidor_final/.test(m) ? 'Para usar consumidor final, rode o 030_consumidor_final.sql no Supabase' : 'Erro: ' + m); }
function modal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.add('on'); }
function fecharModal() { $('#modal').classList.remove('on'); }
window.fecharModal = fecharModal;

/* =================== catálogos =================== */
const ETAPAS = [
  { k: 'mapeado', n: 'Mapeado', c: '#8C7E74' }, { k: 'visitado', n: 'Visitado', c: '#3F6FA8' },
  { k: 'negociacao', n: 'Em negociação', c: '#D08A3C' }, { k: 'perdido', n: 'Perdido', c: '#9A8F86' }, { k: 'avaliacao', n: 'Em avaliação', c: '#6B4FA0' },
  { k: 'revisao', n: 'Revisão comercial', c: '#A23B72' }, { k: 'ativo', n: 'Ativo', c: '#2F7D4E' },
  { k: 'risco', n: 'Em risco', c: '#B8402A' }, { k: 'inativo', n: 'Inativo', c: '#4A3A31' },
  { k: 'fechado', n: 'Estabelecimento fechado', c: '#6E6E6E' }];
const NO_MAPA = e => e.k !== 'fechado'; // estabelecimento fechado não aparece no mapa
const etapa = k => ETAPAS.find(e => e.k === k) || ETAPAS[0];
const CANAIS = ['Minimercado', 'Minimercado de autoatendimento', 'Padaria', 'Fruteira', 'Cantina', 'Conveniência', 'Cafeteria', 'Restaurante', 'Lancheria', 'Outro'];
const CONDICOES = ['À vista · dinheiro', 'À vista · Pix', 'A prazo · 7 dias', 'A prazo · 14 dias', 'A prazo · 28 dias', 'Consignado', 'Bonificação na abertura'];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ROTA_ETAPAS = ['ativo', 'avaliacao', 'risco', 'revisao'];
// consumidor final: cliente que compra, mas não entra na reposição automática
const repoe = p => !!p && ROTA_ETAPAS.includes(p.etapa) && !p.consumidor_final;
const FORMAS = ['Boleto', 'Pix', 'Cartão', 'Dinheiro'];
// prazo padrão: só boleto tem prazo (7 dias, com atalho para 14); Pix, cartão e dinheiro vencem hoje
const prazoDe = f => f === 'Boleto' ? 7 : 0, vencPadrao = (f, dias) => isoDe(new Date(Date.now() + (dias ?? prazoDe(f)) * DIA));
const atalhoPrazo = cls => `<span class="przb ${cls}"><button type="button" class="mini" data-prz="7">7 dias</button><button type="button" class="mini" data-prz="14">14 dias</button></span>`;
// kits mais pedidos (pelos pedidos do Bling): código do produto no Bling → quantidade
// também são as caixas da carga do carro: 1 cx de brownie = 32, de cookie = 36, de palha = 45
const KITS = [{ n: 'Brownie 32', q: { B1: 8, B2: 8, B3: 8, B4: 8 } }, { n: 'Cookies 36', q: { C1: 9, C2: 9, C3: 9, C4: 9 } }, { n: 'Palha 45', q: { P1: 18, P2: 18, P3: 9 } }];
const prazoDias = c => { const m = /(\d+) dias/.exec(c || ''); return m ? +m[1] : 0; };

/* =================== estado =================== */
const S = { contatos: [], eu: null, base: null, pdvs: [], sellouts: {}, aba: null, sel: null, rotaReg: null, contando: null, abPdv: null, sugestoes: [], legOculta: true, etapasMapa: new Set(['ativo']) }; // legenda do mapa começa minimizada
const regraAval = () => S.base.regras.avaliacao || { reposicoes: 13, meta_minima_sellout: 6 };
const cadPadrao = () => S.base.regras.cadencia_padrao || {};
// região de um ponto: caixa [lngMin, latMax, lngMax, latMin] ou centro do quadrante (o mais perto, até o raio)
const regiaoDe = (lng, lat) => {
  for (const r of S.base.regioes) { const b = r.limites; if (Array.isArray(b) && lng >= b[0] && lng < b[2] && lat <= b[1] && lat > b[3]) return r.codigo; }
  let best = null, bd = 1e9;
  S.base.regioes.forEach(r => { const c = r.limites?.centro; if (!c) return; const dk = Math.hypot((lat - c[1]) * 111.2, (lng - c[0]) * 96.3); if (dk <= (r.limites.raio || 8) && dk < bd) { bd = dk; best = r.codigo; } });
  return best;
};
const semAcento = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const CORES = ['#3F6FA8', '#2F7D4E', '#C27A2C', '#B8402A', '#6B4FA0', '#8A4E17', '#2C7F8C', '#9A3B6E', '#5E6B2E'];
// endereço no padrão do Google: "Av. Benjamin Constant, 76 - São João, Porto Alegre - RS, 90550-003"
const ABREV_RUA = [[/^avenida\s/i, 'Av. '], [/^rua\s/i, 'R. '], [/^travessa\s/i, 'Tv. '], [/^estrada\s/i, 'Estr. '], [/^rodovia\s/i, 'Rod. '], [/^alameda\s/i, 'Al. '], [/^praça\s/i, 'Pç. ']];
const abreviarRua = r => { let t = String(r || '').trim(); ABREV_RUA.forEach(([re, a]) => t = t.replace(re, a)); return t; };
const linhaEndereco = a => { const l1 = [a.rua, a.num].filter(Boolean).join(', '), l2 = [a.cidade, a.uf].filter(Boolean).join(' - ');
  return [[l1, a.bairro].filter(Boolean).join(' - '), [l2, a.cep].filter(Boolean).join(', ')].filter(Boolean).join(', '); };
// separa "Av. Benjamin Constant, 76" em rua e número (para quem foi cadastrado com tudo junto)
const separarRua = p => { if (p.numero) return { rua: String(p.endereco || '').replace(new RegExp(',\\s*' + String(p.numero).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), ''), num: p.numero };
  const m = String(p.endereco || '').match(/^(.*?),\s*(\d+[A-Za-z]?)\s*$/); return m ? { rua: m[1], num: m[2] } : { rua: p.endereco || '', num: '' }; };
// endereço completo de um ponto do mapa (rua, número, bairro, cidade, UF, CEP)
async function enderecoDoPonto(lat, lng) {
  try { const a = (await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=pt-BR&lat=${lat}&lon=${lng}`)).json()).address || {};
    const UFS = { 'Rio Grande do Sul': 'RS', 'Santa Catarina': 'SC', 'Paraná': 'PR', 'São Paulo': 'SP' }, uf = (a['ISO3166-2-lvl4'] || '').replace('BR-', '') || UFS[a.state] || '';
    return { rua: abreviarRua(a.road || ''), num: a.house_number || '', bairro: a.suburb || a.neighbourhood || a.quarter || a.city_district || '', cidade: a.city || a.town || a.village || a.municipality || '', uf, cep: a.postcode || '' };
  } catch { return null; } }
async function geoReverso(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=pt-BR&lat=${lat}&lon=${lng}`);
    const a = (await r.json()).address || {};
    return { cidade: a.city || a.town || a.village || a.municipality || '', bairro: a.suburb || a.neighbourhood || a.quarter || a.city_district || '', rua: [a.road, a.house_number].filter(Boolean).join(', ') };
  } catch { return { cidade: '', bairro: '', rua: '' }; }
}
// região: as 6 zonas de POA e Canoas; fora delas, uma região por cidade (criada na hora)
async function garantirRegiao(lng, lat, cidade) {
  const z = regiaoDe(lng, lat); if (z) return z;
  if (!cidade) return null;
  const codigo = semAcento(cidade).toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24);
  if (!S.base.regioes.some(g => g.codigo === codigo)) {
    const nova = { codigo, nome: cidade, cor: CORES[S.base.regioes.length % CORES.length], dia_rota: null, limites: null };
    await db.criarRegiao(nova); S.base.regioes.push(nova); S.base.regioes.sort((a, b) => a.codigo.localeCompare(b.codigo));
  }
  return codigo;
}
const regNome = c => (S.base.regioes.find(r => r.codigo === c) || {}).nome || 'sem região';
const atraso = p => p.proxima_reposicao ? Math.floor((Date.now() - new Date(p.proxima_reposicao)) / DIA) : null;
// entrega postergada até uma data (ex.: escola que só volta em março): guardado em regras.adiados = { pdvId: 'AAAA-MM-DD' }
const adiadoAte = (p, d = hoje()) => { const a = (S.base?.regras?.adiados || {})[p?.id]; return a && a > d ? a : null; };
// meses para postergar (a partir do próximo) e o dia da semana em que mais se atende a região do cliente
const mesesAdiar = d0 => { const a = new Date(d0 + 'T12:00'), out = []; for (let i = 1; i <= 8; i++) { const m = new Date(a.getFullYear(), a.getMonth() + i, 1); out.push({ v: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, n: m.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) }); } return out; };
function diaDaRegiao(p, mes, sem, min) {
  const cont = [0, 0, 0, 0, 0, 0, 0]; let n = 0;
  S.pdvs.filter(x => x.regiao && x.regiao === p.regiao && x.ultima_visita).forEach(x => { const d = new Date(x.ultima_visita).getDay(); if (d > 0 && d < 6) { cont[d]++; n++; } });
  let dow, por;
  if (n >= 3) { dow = cont.indexOf(Math.max(...cont)); por = `dia em que mais se atende ${p.regiao} (${Math.round(cont[dow] / n * 100)}% das visitas)`; }
  else { const r = S.base.regioes.find(g => g.codigo === p.regiao); if (r?.dia_rota != null && r.dia_rota > 0 && r.dia_rota < 6) { dow = r.dia_rota; por = `dia de rota de ${p.regiao}`; } else { dow = 1; por = 'sem histórico da região: segunda'; } }
  const [y, m] = mes.split('-').map(Number), ini = new Date(y, m - 1, 1, 12), ultimo = new Date(y, m, 0, 12).getDate();
  // semana k = dias (k-1)*7+1 … k*7; "última" = os 7 últimos dias do mês
  const d1 = sem === 5 ? ultimo - 6 : (sem - 1) * 7 + 1; let d = new Date(y, m - 1, d1, 12);
  while (d.getDay() !== dow) d = new Date(d.getTime() + DIA);
  let iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (iso <= min) iso = min;
  return { data: iso, dow: new Date(iso + 'T12:00').getDay(), por };
}
const prazoTxt = p => { const a = atraso(p); if (p.consumidor_final) return 'consumidor final'; if (adiadoAte(p)) return 'postergada até ' + dstr(adiadoAte(p) + 'T12:00'); if (a === null) return repoe(p) ? '1ª reposição' : '—'; return a > 0 ? `atrasada ${a} dia${a > 1 ? 's' : ''}` : a === 0 ? 'vence hoje' : `em ${-a} dia${a < -1 ? 's' : ''}`; };
const expo = id => S.base.expositores.find(e => e.id === id) || S.base.expositores[0];
const alvo = (expoId, prodId) => (S.base.alvo.find(a => a.expositor_id === expoId && a.produto_id === prodId) || {}).quantidade || 0;

// quem comprou pelo Bling (sem visita de reposição no app) não tinha próxima reposição e aparecia como "1ª reposição" pendente.
// Agora a próxima reposição também conta a última compra: última compra + o ritmo de compra do cliente (7 a 45 dias; sem histórico, 14)
async function estimarProximas() {
  let ds; try { ds = await db.datasPedidos(); } catch (e) { return; }
  const por = {}; ds.forEach(o => (por[o.pdv_id] = por[o.pdv_id] || []).push(new Date(o.criado_em).getTime()));
  S.pdvs.forEach(p => { const ts = (por[p.id] || []).sort((a, b) => a - b); if (!ts.length) return;
    const dias = []; for (let i = 1; i < ts.length; i++) { const d = (ts[i] - ts[i - 1]) / DIA; if (d >= 3) dias.push(d); }
    dias.sort((a, b) => a - b); const med = dias.length ? dias[Math.floor(dias.length / 2)] : 14, inter = Math.max(7, Math.min(45, Math.round(med)));
    const est = new Date(ts[ts.length - 1] + inter * DIA), atual = p.proxima_reposicao ? new Date(p.proxima_reposicao) : null;
    p.ultima_compra_em = new Date(ts[ts.length - 1]).toISOString();
    if (!atual || est > atual) { p.proxima_reposicao = isoDe(est); p.prox_por_compra = true; } });
}
async function recarregar() {
  const [pdvs, so, cts] = await Promise.all([db.carregarPdvs(), db.carregarSellouts(), db.listarContatos().catch(() => [])]);
  S.pdvs = pdvs; S.contatos = cts;
  await estimarProximas();
  S.sellouts = {};
  so.forEach(s => (S.sellouts[s.pdv_id] = S.sellouts[s.pdv_id] || []).push(s));
}

/* =================== login =================== */
async function iniciar() {
  try {
    const s = await db.sessao();
    if (!s) return telaLogin();
    let p = await db.perfil(s.user.id);
    if (!p) return telaPrimeiroAcesso(s.user);
    S.eu = p;
    S.base = await db.carregarBase();
    await recarregar();
    montar();
    avaliarRisco();
    limparPedidook();
    if (location.hash.startsWith('#bling=')) { const h = new URLSearchParams(location.hash.slice(1)); history.replaceState(null, '', location.pathname); if (h.get('bling') === 'ok') { toast('Bling conectado! Lendo os pedidos…'); irPara('regras'); try { const r = await db.bling('sincronizar'); S.blingSync = Date.now(); await recarregar(); toast('Bling: ' + resumoSync(r)); irPara('regras'); } catch (e) { erro(e); } } else { irPara('regras'); toast('Não conectou ao Bling: ' + (h.get('msg') || 'erro')); } }
    else setTimeout(syncBlingAuto, 3000);
  } catch (e) { $('#raiz').innerHTML = `<div class="loading">Não foi possível carregar: ${esc(e.message)}</div>`; }
}
function telaLogin() {
  $('#raiz').innerHTML = `<div class="login"><form class="box" id="fLogin"><h3>Jaeger’s Administração</h3>
  <label>E-mail</label><input id="lEmail" type="email" autocomplete="username" required>
  <label>Senha</label><input id="lSenha" type="password" autocomplete="current-password" required>
  <div class="err" id="lErr"></div>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn pri">Entrar</button></div></form></div>`;
  $('#fLogin').onsubmit = async e => {
    e.preventDefault();
    try { await db.entrar($('#lEmail').value.trim(), $('#lSenha').value); iniciar(); }
    catch (er) { const x = $('#lErr'); x.style.display = 'block'; x.textContent = 'E-mail ou senha incorretos.'; }
  };
}
function telaPrimeiroAcesso(user) {
  $('#raiz').innerHTML = `<div class="login"><form class="box" id="fPerfil"><h3>Primeiro acesso</h3>
  <p style="color:var(--soft);margin:0">Conectado como ${esc(user.email)}.</p>
  <label>Seu nome</label><input id="pNome" required>
  <label>Sua área</label><select id="pPapel"><option value="comercial">Comercial (prospecção e clientes)</option><option value="operacao">Operação (reposição e entregas)</option></select>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn pri">Continuar</button></div></form></div>`;
  $('#fPerfil').onsubmit = async e => { e.preventDefault(); try { await db.criarPerfil(user.id, $('#pNome').value.trim(), $('#pPapel').value); iniciar(); } catch (er) { erro(er); } };
}

/* =================== estrutura =================== */
const ABAS = {
  comercial: [['mapa', 'Mapa'], ['funil', 'Funil'], ['agenda', 'Agenda'], ['carteira', 'Negócios'], ['contatos', 'Contatos'], ['abertura', 'Cadastrar venda'], ['painel', 'Painel'], ['uploads', 'Uploads'], ['regras', 'Regras e metas'], ['pedidos', 'Pedidos']],
  operacao: [['rota', 'Dia de rota'], ['reposicao', 'Reposição'], ['resumo', 'Resumo do dia'], ['estoque', 'Estoque']],
  financeiro: [['freceber', 'Contas a receber'], ['fpagar', 'Contas a pagar'], ['fcaixa', 'Caixas e bancos']] };
let lado = 'comercial';
// menu lateral: grupos (CRM, Reposição, Ajustes) com ícones; recolhe para só os ícones e lembra a escolha
const ICO = {
  mapa: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  funil: '<path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z"/>',
  agenda: '<rect x="3" y="5" width="18" height="16"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  carteira: '<rect x="3" y="7" width="18" height="13"/><path d="M8 7V4h8v3M3 13h18"/>',
  contatos: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  abertura: '<rect x="3" y="3" width="18" height="18"/><path d="M12 8v8M8 12h8"/>',
  painel: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-6"/>',
  uploads: '<path d="M12 15V3M7 8l5-5 5 5M4 15v6h16v-6"/>',
  regras: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  rota: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H17a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.5"/>',
  reposicao: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  resumo: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', lua: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  recolher: '<rect x="3" y="3" width="18" height="18"/><path d="M9 3v18M15 9l-3 3 3 3"/>', abrir: '<rect x="3" y="3" width="18" height="18"/><path d="M9 3v18M13 9l3 3-3 3"/>',
  seta: '<path d="m6 9 6 6 6-6"/>', pedidos: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>', estoque: '<path d="M3 21V9l9-6 9 6v12"/><path d="M7 21v-8h10v8M7 17h10"/>', freceber: '<path d="M12 3v14M6 11l6 6 6-6M4 21h16"/>', fpagar: '<path d="M12 17V3M6 9l6-6 6 6M4 21h16"/>', fcaixa: '<rect x="3" y="6" width="18" height="13"/><path d="M3 10h18M7 15h4"/>', lupa: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', filtro: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  pino: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>' };
const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter">${ICO[k] || ''}</svg>`;
const MENU = [{ g: 'CRM', lado: 'comercial', it: ['funil', 'mapa', 'agenda', 'carteira', 'contatos', 'abertura', 'pedidos', 'painel', 'uploads'] },
  { g: 'Reposição', lado: 'operacao', it: ['rota', 'reposicao', 'resumo'] }, { g: 'Estoque', lado: 'operacao', it: ['estoque'] }, { g: 'Financeiro', lado: 'comercial', it: ['freceber', 'fpagar', 'fcaixa'] }, { g: 'Ajustes', lado: 'comercial', it: ['regras'] }];
const nomeAba = k => (Object.values(ABAS).flat().find(([x]) => x === k) || [, k])[1];
const grupoDe = k => MENU.find(m => m.it.includes(k));
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
const lerG = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
function aplicarTema(t) { document.documentElement.dataset.tema = t; guardar('jg-tema', t); const b = $('#bTema'); if (b) { b.innerHTML = ico(t === 'escuro' ? 'sol' : 'lua'); b.title = t === 'escuro' ? 'Modo claro' : 'Modo escuro'; } }
function aplicarSb(v) { document.documentElement.dataset.sb = v; guardar('jg-sb', v); const b = $('#sbTog'); if (b) { b.innerHTML = ico(v === 'fechada' ? 'abrir' : 'recolher'); b.title = v === 'fechada' ? 'Expandir menu' : 'Recolher menu'; } }
function montar() {
  lado = 'comercial'; // todos abrem no CRM; a Reposição fica no mesmo menu
  const ini = (S.eu.nome || '?').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
  $('#raiz').innerHTML = `<div class="shell">
   <div class="sb" id="sb"><div class="sb-top"><button class="sb-ic" id="sbTog"></button><span class="sb-brand">Jaeger’s<small>Administração</small></span></div>
    <div class="sb-nav" id="nav"></div>
    <div class="sb-bot"><div class="sb-user" title="${esc(S.eu.nome)}"><span class="sb-av">${esc(ini)}</span><b>${esc(S.eu.nome)}</b><button id="bSair">Sair</button></div></div></div>
   <div class="sb-veu" id="sbVeu"></div>
   <div class="corpo"><div class="topo"><button class="sb-ic mob" id="sbMob" title="Menu">${ico('menu')}</button><span class="trilha" id="tTri"></span><h1 id="tTit"></h1><div class="tacoes" id="tAcoes"></div>
    <div class="dir"><button class="sb-ic" id="bTema"></button></div></div><main id="main"></main></div></div>`;
  aplicarTema(document.documentElement.dataset.tema || 'claro'); aplicarSb(document.documentElement.dataset.sb || 'aberta');
  $('#bTema').onclick = () => aplicarTema(document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro');
  $('#sbTog').onclick = () => aplicarSb(document.documentElement.dataset.sb === 'fechada' ? 'aberta' : 'fechada');
  const fechaMob = () => { $('#sb').classList.remove('aberta'); $('#sbVeu').classList.remove('on'); };
  $('#sbMob').onclick = () => { $('#sb').classList.add('aberta'); $('#sbVeu').classList.add('on'); };
  $('#sbVeu').onclick = fechaMob;
  $('#nav').onclick = e => { const g = e.target.closest('.sb-g'); if (g) { const f = JSON.parse(lerG('jg-grupos') || '{}'); f[g.dataset.g] = !f[g.dataset.g]; guardar('jg-grupos', JSON.stringify(f)); return pintarMenu(); }
    const b = e.target.closest('.sb-it'); if (!b) return; fechaMob(); S.vendaVolta = null; S.repVolta = null; S.hist = []; irPara(b.dataset.a, true); };
  $('#bSair').onclick = async () => { await db.sair(); location.reload(); };
  irPara(ABAS.comercial[0][0]);
}
function pintarMenu() {
  const a = S.aba, ativo = grupoDe(a)?.g, fech = JSON.parse(lerG('jg-grupos') || '{}');
  $('#nav').innerHTML = MENU.map(m => `<button class="sb-g ${fech[m.g] && m.g !== ativo ? 'fech' : ''}" data-g="${m.g}"><span>${m.g}</span><span class="sb-car">${ico('seta')}</span></button>
    <div class="sb-grp" ${fech[m.g] && m.g !== ativo ? 'style="display:none"' : ''}>${m.it.map(k => `<button class="sb-it ${k === a ? 'on' : ''}" data-a="${k}" title="${esc(nomeAba(k))}">${ico(k)}<span class="sb-lbl">${esc(nomeAba(k))}</span></button>`).join('')}</div>`).join('');
  const g = grupoDe(a); if (g) lado = g.lado; $('#tAcoes').innerHTML = '';
  $('#tTri').textContent = g ? g.g : (lado === 'operacao' ? 'Reposição' : 'CRM');
  $('#tTit').textContent = a === 'carteiramet' ? 'Detalhes da carteira' : a === 'perfil' ? 'Perfil do negócio' : a === 'contato' ? 'Contato' : a === 'pedcli' ? 'Detalhes dos pedidos' : nomeAba(a);
}
// navegação com "voltar" de verdade: cada tela guarda de onde veio (aba + cliente/contato aberto)
S.hist = []; S.fil = {};
function irPara(a, semHist) {
  const ctx = { perfilId: S.perfilId, contatoId: S.contatoId }, mesmo = S.aba === a && S.histEnt && S.histEnt.perfilId === ctx.perfilId && S.histEnt.contatoId === ctx.contatoId;
  const topo = S.hist[S.hist.length - 1], ehTopo = topo && topo.aba === a && (!['perfil', 'contato', 'pedcli'].includes(a) || (topo.perfilId === ctx.perfilId && topo.contatoId === ctx.contatoId));
  if (!semHist && ehTopo) S.hist.pop(); // voltando para a tela anterior (ex.: depois de salvar uma venda): não empilha de novo
  else if (!semHist && S.aba && !mesmo) { S.hist.push({ aba: S.aba, ...(S.histEnt || {}) }); if (S.hist.length > 40) S.hist.shift(); }
  S.aba = a; S.histEnt = ctx;
  pintarMenu();
  ({ agenda: telaAgenda, perfil: telaPerfil, contato: telaContato, contatos: telaContatos, uploads: telaUploads, mapa: telaMapa, funil: telaFunil, carteira: telaCarteira, abertura: telaAbertura, painel: telaPainel, regras: telaRegras, rota: telaRota, reposicao: telaReposicao, pedcli: telaPedidosCliente, resumo: telaResumo, carteiramet: telaCarteiraMet, estoque: telaEstoque, pedidos: telaPedidos, freceber: () => telaContas('receber'), fpagar: () => telaContas('pagar'), fcaixa: telaCaixas })[a]();
}
window.irPara = irPara;
// texto do botão Voltar: diz para onde vai (ex.: "← Almeida 68" quando veio do perfil do negócio)
function rotuloVoltar(padrao) { const t = S.hist[S.hist.length - 1];
  if (!t) return padrao;
  if (t.aba === 'perfil') return S.pdvs.find(x => x.id === t.perfilId)?.nome || 'Perfil do negócio';
  if (t.aba === 'contato') return S.contatos.find(x => x.id === t.contatoId)?.nome || 'Contato';
  if (t.aba === 'pedcli') return 'Detalhes dos pedidos';
  return (Object.values(ABAS).flat().find(([k]) => k === t.aba) || [, padrao])[1]; }
function voltar(padrao) { const h = S.hist.pop(); if (!h) return irPara(padrao, true); S.perfilId = h.perfilId; S.contatoId = h.contatoId; if (h.aba === 'perfil') S.sel = h.perfilId; irPara(h.aba, true); }
// mantém os filtros de uma tela quando você sai e volta: restaura os valores e guarda a cada mudança
function manter(tela, ids) { const f = S.fil[tela] = S.fil[tela] || {};
  ids.forEach(id => { const el = document.getElementById(id); if (!el) return; if (f[id] != null) el.type === 'checkbox' ? (el.checked = f[id]) : (el.value = f[id]);
    const salva = () => { f[id] = el.type === 'checkbox' ? el.checked : el.value; }; el.addEventListener('input', salva); el.addEventListener('change', salva); }); }

/* =================== mapa =================== */
// desenho livre no mapa: círculo, quadrado e pincel; fica salvo para todos (regra 'desenhos_mapa')
const CORES_DES = ['#d03b3b', '#2a78d6', '#1baf7a', '#fab219', '#18181B'];
function ligarDesenho(m) {
  const D = S.desenho = S.desenho || { modo: null, cor: CORES_DES[0], formas: null };
  if (!D.formas) D.formas = (S.base.regras.desenhos_mapa || []).slice();
  const camadaD = L.layerGroup().addTo(m);
  const fmtRaio = r => r < 1000 ? `${Math.round(r)} m` : `${(r / 1000).toFixed(r < 10000 ? 2 : 1).replace('.', ',')} km`;
  const rotulo = f => L.tooltip({ permanent: true, direction: 'top', className: 'dsrot', interactive: false }).setLatLng([f.lat + f.r / 111320, f.lng]).setContent('raio ' + fmtRaio(f.r));
  const forma = f => f.t === 'c' ? L.circle([f.lat, f.lng], { radius: f.r, color: f.cor, weight: 3, fillOpacity: .12, interactive: false })
    : f.t === 'r' ? L.rectangle(f.b, { color: f.cor, weight: 3, fillOpacity: .12, interactive: false })
    : L.polyline(f.pts, { color: f.cor, weight: 5, opacity: .8, lineCap: 'round', lineJoin: 'round', interactive: false });
  // círculos e quadrados viram áreas clicáveis: tocar abre as buscas do Outscraper para aquela área
  const redesenhar = () => { camadaD.clearLayers(); D.formas.forEach((f, i) => { const l = forma(f);
    if (f.t !== 'p') { l.options.interactive = true; l.on('click', e => { if (D.modo) return; L.DomEvent.stop(e); S.sel = null; painelArea(f, i); }); l.bindTooltip('Toque para extrair esta área no Outscraper', { sticky: true }); }
    l.addTo(camadaD); if (f.t === 'c') rotulo(f).addTo(camadaD); }); };
  const mostraRaio = t => { const e = m.getContainer().querySelector('.dsraio'); if (e) { e.textContent = t || ''; e.hidden = !t; } };
  const salvar = async () => { try { await db.salvarRegra('desenhos_mapa', D.formas); S.base.regras.desenhos_mapa = D.formas.slice(); } catch (e) { erro(e); } };
  redesenhar();
  const Ctrl = L.Control.extend({ options: { position: 'bottomright' }, onAdd() {
    const d = L.DomUtil.create('div', 'leaflet-bar desenho');
    d.innerHTML = `<div class="dsbarra" hidden>
      <a href="#" data-m="c" title="Círculo">◯</a><a href="#" data-m="r" title="Quadrado">▢</a><a href="#" data-m="p" title="Pincel">✎</a>
      <span class="dscores">${CORES_DES.map(c => `<a href="#" data-cor="${c}" title="Cor" style="--c:${c}"><i></i></a>`).join('')}</span>
      <a href="#" data-a="desfazer" title="Desfazer o último">↶</a><a href="#" data-a="limpar" title="Apagar todos os desenhos">🗑</a></div>
      <a href="#" class="bt-cheia dsabre" title="Desenhar no mapa">🖌</a>`;
    const raio = L.DomUtil.create('div', 'dsraio'); raio.hidden = true; setTimeout(() => d.parentNode && d.parentNode.insertBefore(raio, d), 0);
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
    const barra = d.querySelector('.dsbarra');
    const marcar = () => { d.querySelectorAll('[data-m]').forEach(a => a.classList.toggle('on', a.dataset.m === D.modo)); d.querySelectorAll('[data-cor]').forEach(a => a.classList.toggle('on', a.dataset.cor === D.cor));
      d.querySelector('.dsabre').classList.toggle('on', !barra.hidden); m.getContainer().classList.toggle('desenhando', !!D.modo); D.modo ? m.dragging.disable() : m.dragging.enable(); };
    d.querySelector('.dsabre').onclick = e => { e.preventDefault(); barra.hidden = !barra.hidden; if (barra.hidden) D.modo = null; marcar(); };
    d.querySelectorAll('[data-m]').forEach(a => a.onclick = e => { e.preventDefault(); D.modo = D.modo === a.dataset.m ? null : a.dataset.m; marcar(); });
    d.querySelectorAll('[data-cor]').forEach(a => a.onclick = e => { e.preventDefault(); D.cor = a.dataset.cor; marcar(); });
    d.querySelector('[data-a=desfazer]').onclick = e => { e.preventDefault(); if (!D.formas.length) return; D.formas.pop(); redesenhar(); mostraRaio(''); salvar(); };
    d.querySelector('[data-a=limpar]').onclick = e => { e.preventDefault(); if (!D.formas.length) return; modal(`<h3>Apagar todos os desenhos do mapa?</h3><p style="color:var(--soft)">São ${D.formas.length} desenho(s). Some para todos que usam o app.</p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="dsOk">Apagar</button></div>`); $('#dsOk').onclick = () => { D.formas = []; redesenhar(); mostraRaio(''); salvar(); fecharModal(); }; };
    marcar(); return d; } });
  new Ctrl().addTo(m);
  // traço com o dedo ou o mouse (pointer events servem para os dois)
  const el = m.getContainer(); let atual = null, ini = null, temp = null;
  const ll = e => m.mouseEventToLatLng(e);
  el.addEventListener('pointerdown', e => { if (!D.modo || e.target.closest('.leaflet-control')) return; e.preventDefault(); el.setPointerCapture(e.pointerId); ini = ll(e);
    atual = D.modo === 'p' ? { t: 'p', cor: D.cor, pts: [[ini.lat, ini.lng]] } : D.modo === 'c' ? { t: 'c', cor: D.cor, lat: ini.lat, lng: ini.lng, r: 1 } : { t: 'r', cor: D.cor, b: [[ini.lat, ini.lng], [ini.lat, ini.lng]] };
    temp = forma(atual).addTo(m); });
  el.addEventListener('pointermove', e => { if (!atual) return; const p = ll(e);
    if (atual.t === 'p') { atual.pts.push([p.lat, p.lng]); temp.addLatLng(p); }
    else if (atual.t === 'c') { atual.r = ini.distanceTo(p); temp.setRadius(atual.r); mostraRaio('Raio ' + fmtRaio(atual.r)); }
    else { atual.b = [[ini.lat, ini.lng], [p.lat, p.lng]]; temp.setBounds(atual.b); } });
  const fim = () => { if (!atual) return; m.removeLayer(temp);
    const ok = atual.t === 'p' ? atual.pts.length > 2 : atual.t === 'c' ? atual.r > 5 : Math.abs(atual.b[0][0] - atual.b[1][0]) + Math.abs(atual.b[0][1] - atual.b[1][1]) > 1e-5;
    if (ok) { if (atual.t === 'p') atual.pts = atual.pts.filter((q, i) => i % 2 === 0 || i === atual.pts.length - 1).map(q => [+q[0].toFixed(6), +q[1].toFixed(6)]); D.formas.push(atual); redesenhar(); salvar(); }
    if (atual.t === 'c' && ok) mostraRaio('Raio ' + fmtRaio(atual.r)); atual = null; };
  el.addEventListener('pointerup', fim); el.addEventListener('pointercancel', fim);
  // enquanto desenha, o clique não seleciona nem marca ponto no mapa
  el.addEventListener('click', e => { if (D.modo && !e.target.closest('.leaflet-control')) e.stopPropagation(); }, true);
}
let camadaTraco = null, aoMarcar = null, mapa = null, camada = null, camadaSug = null, marcando = false, mostrarReg = true;
function telaMapa() {
  if (S.prosp) return telaProspeccao();
  $('#main').innerHTML = `<section class="view on" style="display:flex;height:100%"><div id="mapa"><div id="lmap"></div>
   <div class="hint" id="hint">Toque no mapa onde fica o ponto</div>
   <div class="rotabox" id="rotaBox" hidden></div>
   <div class="legend ${S.legOculta ? 'oculta' : ''}" id="legend"></div><button class="legdot" id="legDot" title="${S.legOculta ? 'Mostrar legenda' : 'Esconder legenda'}"></button></div><aside id="side"></aside></section>`;
  // controles na faixa de cima: lupa que abre a busca, ações e um botão de filtros com o resto
  $('#tAcoes').innerHTML = `<div class="tmbar">
   <div class="mbusca" id="mBusca"><button class="ticon" id="bBuscaIc" title="Buscar cliente">${ico('lupa')}</button><input id="bBusca" autocomplete="off" placeholder="Buscar cliente…"><div id="bSug" class="sugs"></div></div>
   <button class="tbtn pri" id="bAdd" title="Cadastrar ponto">${ico('abertura')}<span>Cadastrar ponto</span></button>
   <button class="tbtn" id="bPend" title="Reposições pendentes">${ico('reposicao')}<span>Pendentes</span> <b id="nPend"></b></button>
   <button class="ticon" id="bLoc" title="Minha localização">${ico('pino')}</button>
   <div class="mfiltro"><button class="tbtn" id="bFiltro" title="Filtros e camadas">${ico('filtro')}<span>Filtros</span> <b id="nFil"></b></button>
    <div class="mfpanel" id="fPanel" hidden>
     <small>Status</small><div class="msel" id="fEt"><button type="button" class="msbtn" id="fEtBtn"></button><div class="msmenu" id="fEtMenu" hidden>
      <div class="msatalhos"><button type="button" data-ms="todas">Todas</button><button type="button" data-ms="nenhuma">Nenhuma</button><button type="button" data-ms="carteira">Carteira</button><button type="button" data-ms="prosp">Prospecção</button></div>
      ${ETAPAS.filter(NO_MAPA).map(e => `<label><input type="checkbox" value="${e.k}" ${S.etapasMapa.has(e.k) ? 'checked' : ''}><i class="dot" style="background:${e.c}"></i>${e.n}</label>`).join('')}</div></div>
     <small>Região</small><select id="fReg"><option value="">Todas as regiões</option>${S.base.regioes.map(r => `<option value="${r.codigo}">${r.codigo} · ${esc(r.nome)}</option>`).join('')}</select>
     <small>Camadas</small><label class="regchk"><input type="checkbox" id="tReg" ${mostrarReg ? 'checked' : ''}> Contorno das regiões</label>
     <button class="btn ${S.nuvens ? 'car' : ''}" id="bNuvem">☁️ Nuvens de potencial</button><button class="btn ${S.quad ? 'car' : ''}" id="bQuad">▦ Quadrantes</button><button class="btn ${S.areasOn ? 'car' : ''}" id="bAreas">🗺 Áreas mapeadas</button>
    </div></div></div>`;
  { const mb = $('#mBusca'), inp = $('#bBusca');
    $('#bBuscaIc').onclick = () => { mb.classList.toggle('aberta'); if (mb.classList.contains('aberta')) inp.focus(); };
    inp.addEventListener('blur', () => setTimeout(() => { if (!inp.value) mb.classList.remove('aberta'); }, 200));
    inp.addEventListener('keydown', e => { if (e.key === 'Escape') { inp.value = ''; inp.blur(); mb.classList.remove('aberta'); } });
    const contaFil = () => { const n = ($('#fReg').value ? 1 : 0) + (S.nuvens ? 1 : 0) + (S.quad ? 1 : 0) + (S.areasOn ? 1 : 0); $('#nFil').textContent = n ? n : ''; };
    $('#bFiltro').onclick = e => { e.stopPropagation(); $('#fPanel').hidden = !$('#fPanel').hidden; contaFil(); };
    $('#fPanel').addEventListener('click', e => { e.stopPropagation(); const m = $('#fEtMenu'); if (m && !e.target.closest('#fEt')) m.hidden = true; setTimeout(contaFil, 50); }); $('#fPanel').addEventListener('change', () => setTimeout(contaFil, 50));
    if (!S.fechaFp) { S.fechaFp = true; document.addEventListener('click', () => { const p = $('#fPanel'); if (p) p.hidden = true; }); }
    setTimeout(contaFil, 0); }
  if (mapa) { mapa.remove(); mapa = null; }
  mapa = L.map('lmap', { zoomControl: false }).setView([-29.98, -51.18], 12);
  const Cheia = L.Control.extend({ options: { position: 'bottomright' }, onAdd() { const d = L.DomUtil.create('div', 'leaflet-bar'); d.innerHTML = '<a href="#" class="bt-cheia" title="Tela cheia" role="button">⛶</a>'; L.DomEvent.disableClickPropagation(d); d.firstChild.onclick = e => { e.preventDefault(); const sec = $('#mapa').parentElement; if (document.fullscreenElement) document.exitFullscreen(); else (sec.requestFullscreen || sec.webkitRequestFullscreen)?.call(sec); }; return d; } });
  new Cheia().addTo(mapa);
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  ligarDesenho(mapa);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  camada = L.layerGroup().addTo(mapa); camadaSug = L.layerGroup().addTo(mapa); camadaTraco = L.layerGroup().addTo(mapa); S.rotaDe = null; S.rotaPar = null;
  mapa.on('click', e => { if (!marcando) return; marcando = false; $('#hint').style.display = 'none'; const f = aoMarcar || (ll => abrirCadastro(ll)); aoMarcar = null; f([e.latlng.lng, e.latlng.lat]); });
  { const bu = $('#bBusca'), sug = $('#bSug');
    const listar = () => { const q = norm(bu.value).trim(); if (!q) { sug.style.display = 'none'; return; }
      const ls = S.pdvs.filter(x => x.etapa !== 'fechado' && norm([x.nome, x.razao_social, x.bairro, x.cidade].filter(Boolean).join(' ')).includes(q)).slice(0, 12);
      sug.innerHTML = ls.map(x => `<div data-pick="${x.id}"><b>${esc(x.nome)}</b> <small style="color:${etapa(x.etapa).c};font-weight:700">${etapa(x.etapa).n}</small><br><small style="color:var(--mute)">${esc([x.bairro, x.cidade].filter(Boolean).join(' · '))}${x.lat ? '' : ' · sem localização'}</small></div>`).join('') || '<div style="color:var(--mute)">Nenhum cliente encontrado</div>';
      sug.style.display = 'block';
      sug.querySelectorAll('[data-pick]').forEach(d => d.onmousedown = e => { e.preventDefault(); const x = S.pdvs.find(y => y.id === d.dataset.pick); bu.value = ''; sug.style.display = 'none'; bu.blur(); if (!S.etapasMapa.has(x.etapa)) { S.etapasMapa.add(x.etapa); document.querySelectorAll('#fEtMenu input').forEach(i => i.checked = S.etapasMapa.has(i.value)); rotEt(); } // mostra a etapa do cliente buscado
        S.sel = x.id; if (x.lat) mapa.setView([x.lat, x.lng], Math.max(mapa.getZoom(), 16)); else toast('Esse cliente ainda não tem localização no mapa'); desenhar(); painel(); }); };
    bu.oninput = listar; bu.onfocus = listar; bu.onblur = () => setTimeout(() => { sug.style.display = 'none'; }, 150);
    bu.onkeydown = e => { if (e.key === 'Enter') sug.querySelector('[data-pick]')?.dispatchEvent(new MouseEvent('mousedown')); if (e.key === 'Escape') { bu.value = ''; listar(); } }; }
  $('#bAdd').onclick = () => abrirCadastro(null);
  $('#bPend').onclick = () => { S.modoPend = !S.modoPend; S.pendMin = false; S.sel = null; desenhar(); painel(); };
  $('#bLoc').onclick = () => alternarLocalizacao();
  if (S.rastreando) { mostrarEu(false); $('#bLoc').classList.add('pri'); }
  manter('mapa', ['fReg']);
  $('#fReg').onchange = desenhar;
  // etapas no mapa: várias de uma vez (começa só com Ativo)
  const rotEt = () => { const n = S.etapasMapa.size, tot = ETAPAS.filter(NO_MAPA).length; $('#fEtBtn').textContent = n === 0 ? 'Nenhuma etapa' : n === tot ? 'Todas as etapas' : n === 1 ? etapa([...S.etapasMapa][0]).n : `${n} etapas`; };
  const marcaEt = ks => { S.etapasMapa = new Set(ks); document.querySelectorAll('#fEtMenu input').forEach(i => i.checked = S.etapasMapa.has(i.value)); rotEt(); desenhar(); };
  $('#fEtBtn').onclick = e => { e.stopPropagation(); $('#fEtMenu').hidden = !$('#fEtMenu').hidden; };
  $('#fEtMenu').onclick = e => e.stopPropagation();
  document.querySelectorAll('#fEtMenu input').forEach(i => i.onchange = () => { i.checked ? S.etapasMapa.add(i.value) : S.etapasMapa.delete(i.value); rotEt(); desenhar(); });
  document.querySelectorAll('[data-ms]').forEach(b => b.onclick = () => marcaEt({ todas: ETAPAS.filter(NO_MAPA).map(e => e.k), nenhuma: [], carteira: CART, prosp: PROSP }[b.dataset.ms]));
  if (!S.fechaMs) { S.fechaMs = true; document.addEventListener('click', () => { const m = $('#fEtMenu'); if (m) m.hidden = true; }); }
  rotEt();
  $('#tReg').onchange = e => { mostrarReg = e.target.checked; desenhar(); };
  $('#legDot').onclick = () => { S.legOculta = !S.legOculta; $('#legend').classList.toggle('oculta', S.legOculta); $('#legDot').title = S.legOculta ? 'Mostrar legenda' : 'Esconder legenda'; };
  if (!S.cheiaLigado) { S.cheiaLigado = true; document.addEventListener('fullscreenchange', () => { const b = document.querySelector('.bt-cheia'); if (b) { b.innerHTML = document.fullscreenElement ? '✕' : '⛶'; b.title = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia'; } setTimeout(() => mapa && mapa.invalidateSize(), 150); }); }
  $('#bNuvem').onclick = () => { S.nuvens = !S.nuvens; $('#bNuvem').classList.toggle('car', S.nuvens); if (S.nuvens) { S.sel = null; desenharNuvens(true); } else { camadaNuvem?.clearLayers(); painel(); } };
  camadaNuvem = null; if (S.nuvens) setTimeout(() => desenharNuvens(false), 0);
  camadaQuad = null; if (S.quad) setTimeout(() => desenharQuad(), 0);
  camadaAreas = null; if (S.areasOn) setTimeout(() => desenharAreas(), 0);
  $('#bAreas').onclick = () => { S.areasOn = !S.areasOn; $('#bAreas').classList.toggle('car', S.areasOn); S.areaSel = null; if (S.areasOn) { S.sel = null; desenharAreas(true); } else { camadaAreas?.clearLayers(); painel(); } };
  $('#bQuad').onclick = () => { S.quad = !S.quad; $('#bQuad').classList.toggle('car', S.quad); if (S.quad) { S.sel = null; desenharQuad(); } else { camadaQuad?.clearLayers(); painel(); } };
  desenhar(); painel();
}
function pino(cor, k = 1, tracejado = false) {
  const w = Math.round(30 * k), h = Math.round(40 * k);
  return L.divIcon({ className: '', iconSize: [w, h], iconAnchor: [w / 2, h], tooltipAnchor: [0, -h * .8], popupAnchor: [0, -h * .85],
    html: `<svg width="${w}" height="${h}" viewBox="0 0 30 40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 39 15 39s14-13.7 14-24.1C29 7.2 22.7 1 15 1z" fill="${tracejado ? 'var(--card)' : cor}" stroke="${tracejado ? cor : 'rgba(0,0,0,.25)'}" stroke-width="${tracejado ? 2.5 : 1}" ${tracejado ? 'stroke-dasharray="4 3"' : ''}/><circle cx="15" cy="14.5" r="6" fill="var(--card)" ${tracejado ? `stroke="${cor}" stroke-width="2"` : ''}/></svg>` });
}
function desenhar() {
  camada.clearLayers();
  if (mostrarReg) S.base.regioes.forEach(r => { const b = r.limites; if (b?.centro) { const g = S.pdvs.filter(p => p.regiao === r.codigo && p.lat && p.etapa !== 'fechado'), h = casca(g); if (h.length >= 3) L.polygon(h.map(x => [x.lat, x.lng]), { color: r.cor, weight: 2, dashArray: '8 6', fillOpacity: .05, interactive: false }).addTo(camada); return; } if (!Array.isArray(b)) return; L.rectangle([[b[1], b[0]], [b[3], b[2]]], { color: r.cor, weight: 2, dashArray: '8 6', fillOpacity: .04, interactive: false }).addTo(camada).bindTooltip(`${r.codigo} · ${r.nome}`, { permanent: false }); });
  const fr = $('#fReg').value;
  const pend = repPendentes();
  $('#nPend').textContent = pend.length ? `(${pend.length})` : '';
  $('#bPend').classList.toggle('car', !!S.modoPend);
  // Pendentes: quem precisa de reposição fica roxo e maior; o resto segue o filtro de status e região, nas cores de sempre
  const pendIds = new Set(pend.map(p => p.id)), ROXO = '#7E22CE';
  S.pdvs.filter(p => p.lat && p.etapa !== 'fechado' && (S.etapasMapa.has(p.etapa) || (S.modoPend && pendIds.has(p.id))) && (!fr || p.regiao === fr)).forEach(p => {
    const ehP = S.modoPend && pendIds.has(p.id), cor = ehP ? ROXO : etapa(p.etapa).c;
    const m = L.marker([p.lat, p.lng], { icon: pino(cor, S.sel === p.id ? 1.35 : ehP ? 1.2 : S.modoPend ? 0.85 : p.classe === 'A' ? 1.15 : 1), zIndexOffset: S.sel === p.id ? 1000 : ehP ? 500 : 0 });
    m.on('click', () => { if (S.rotaDe && S.rotaDe !== p.id) return tracarRota(S.rotaDe, p.id); S.sel = p.id; desenhar(); painel(); });
    const dias = p.proxima_reposicao ? Math.round((new Date(p.proxima_reposicao) - new Date(hojeISO() + 'T00:00')) / DIA) : null;
    m.bindTooltip(esc(p.nome) + (S.modoPend ? (ehP ? ' · reposição pendente' : dias != null ? ` · próxima reposição ${dias <= 0 ? 'hoje' : 'em ' + dias + ' dia' + (dias === 1 ? '' : 's')}` : '') : '')); m.addTo(camada);
  });
  $('#legend').innerHTML = (S.modoPend ? `<span><i class="dot" style="background:${ROXO}"></i><b>Reposição pendente (${pend.length})</b></span>` : '') + ETAPAS.filter(NO_MAPA).map(e => `<span><i class="dot" style="background:${e.c}"></i>${e.n} (${S.pdvs.filter(p => p.etapa === e.k).length})</span>`).join('');
}
function ultimos6(p) {
  const so = (S.sellouts[p.id] || []).slice(-6);
  if (!so.length) return '';
  const mx = Math.max(1, ...so.map(s => s.sellout)), media = so.reduce((a, s) => a + s.sellout, 0) / so.length, vm = so.reduce((a, s) => a + Number(s.valor_sellout), 0) / so.length;
  return `<div class="sect"><h3>Últimos ${so.length} sell-outs</h3><div style="display:flex;gap:6px;align-items:flex-end;height:150px;background:var(--sand);border-radius:10px;padding:10px 8px 6px">${so.map((s, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:3px"><b style="font-size:13px">${s.sellout}</b><div style="width:100%;max-width:34px;height:${Math.max(3, s.sellout / mx * 80)}px;border-radius:5px 5px 2px 2px;background:${i === so.length - 1 ? '#D08A3C' : '#8C6B55'}"></div><small style="font-size:10.5px;color:var(--soft);white-space:nowrap">${brl(s.valor_sellout).replace('R$ ', 'R$')}</small><small style="font-size:10px;color:var(--mute)">${dstr(s.em)}</small></div>`).join('')}</div>
  <p style="margin:6px 0 0;color:var(--soft)">Média por reposição: <b>${dec(media)} un.</b> · ticket médio por sell-out <b>${brl(vm)}</b></p></div>`;
}
function caixaEsteira(p) {
  const r = regraAval();
  if (p.etapa === 'avaliacao') {
    const n = p.aval_reposicoes || 0, m = Number(p.aval_media || 0);
    return `<div class="esteira"><h3 style="margin:0;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6B4FA0">Em avaliação</h3><p><b>${n} de ${r.reposicoes}</b> reposições</p><div class="prog"><i style="width:${Math.min(100, n / r.reposicoes * 100)}%"></i></div><p>Sell-out médio: <b>${dec(m)} un.</b> por reposição · meta ${r.meta_minima_sellout} un.</p><p>${n ? (m >= r.meta_minima_sellout ? 'No ritmo atual, <b>passa</b>.' : 'No ritmo atual, <b>não passa</b>.') : 'Aguardando a primeira reposição.'}</p></div>`;
  }
  if (p.etapa === 'revisao') return `<div class="esteira rev"><h3 style="margin:0;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#A23B72">Revisão comercial</h3><p>Fechou a avaliação com sell-out médio de <b>${dec(p.aval_media)} un.</b>, abaixo da meta. O que fazer?</p><div class="actions" style="margin-top:8px"><button class="btn" data-rev="preco">Negociar preço e reavaliar</button><button class="btn" data-rev="minimo">Subir pedido mínimo e reavaliar</button><button class="btn" data-rev="retirar">Recolher expositor</button></div></div>`;
  return '';
}
/* ---------- reposições pendentes ---------- */
function repPendentes() {
  return S.pdvs.filter(p => repoe(p) && !adiadoAte(p) && (!p.proxima_reposicao || atraso(p) >= 0))
    .sort((a, b) => (atraso(b) ?? 999) - (atraso(a) ?? 999));
}
function listaPendentes(s) {
  const l = repPendentes();
  document.getElementById('pendPill')?.remove();
  // minimizada: some a lista e fica só uma etiqueta no mapa para abrir de novo
  if (S.pendMin) { s.classList.remove('open'); s.innerHTML = ''; setTimeout(() => mapa && mapa.invalidateSize(), 0);
    $('#mapa').insertAdjacentHTML('beforeend', `<button class="pendpill" id="pendPill" title="Abrir a lista"><i style="background:#7E22CE"></i>${l.length} pendente${l.length === 1 ? '' : 's'} <b>▸ lista</b></button>`);
    $('#pendPill').onclick = () => { S.pendMin = false; painel(); }; return; }
  s.classList.add('open');
  s.innerHTML = `<div style="float:right;display:flex;gap:6px"><button class="btn" style="padding:4px 10px" id="mPend" title="Minimizar a lista e ver o mapa inteiro">—</button><button class="btn" style="padding:4px 10px" id="xPend" title="Sair das pendentes">✕</button></div><h2>Reposições pendentes</h2>
  <p style="color:var(--soft);margin-top:0">${l.length} cliente${l.length === 1 ? '' : 's'} com reposição para hoje ou atrasada (roxos e maiores no mapa). Os outros pinos seguem o filtro de status, para ver quem dá para antecipar na mesma rota.</p>
  ${l.map(p => { const a = atraso(p); return `<div class="stop" style="padding:10px;align-items:flex-start"><div class="info"><b>${esc(p.nome)}</b><br><small style="color:var(--mute)">${p.regiao || '—'} · ${esc(p.bairro || p.cidade || '')} · ${etapa(p.etapa).n}</small><br><span class="badge" style="background:${(a ?? 1) > 0 ? 'var(--bg-bad)' : 'var(--bg-warn)'};margin-top:4px;display:inline-block">${prazoTxt(p)}${p.proxima_reposicao ? ' · era ' + dstr(p.proxima_reposicao) : ''}</span></div>
   <div style="display:flex;flex-direction:column;gap:4px"><button class="btn" data-ver="${p.id}" style="padding:5px 10px">Ver</button><button class="btn pri" data-repor="${p.id}" style="padding:5px 10px">Repor</button></div></div>`; }).join('') || '<p class="empty">Nada pendente. 🎉</p>'}`;
  $('#xPend').onclick = () => { S.modoPend = false; S.pendMin = false; desenhar(); painel(); };
  $('#mPend').onclick = () => { S.pendMin = true; painel(); };
  s.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { const p = S.pdvs.find(x => x.id === b.dataset.ver); S.modoPend = false; S.sel = p.id; desenhar(); painel(); if (p.lat) mapa.setView([p.lat, p.lng], 16); });
  s.querySelectorAll('[data-repor]').forEach(b => b.onclick = () => { S.contando = b.dataset.repor; S.modoPend = false; lado = 'operacao'; irPara('reposicao'); });
}

/* ---------- minha localização em tempo real ---------- */
let euMarcador = null, euCirculo = null;
const iconeEu = () => L.icon({ iconUrl: 'img/boneco.png', iconSize: [37, 80], iconAnchor: [18, 78], tooltipAnchor: [0, -70] });
function mostrarEu(centralizar) {
  if (!S.minhaPos || !mapa) return;
  const ll = [S.minhaPos.lat, S.minhaPos.lng];
  if (!euMarcador || !mapa.hasLayer(euMarcador)) { euMarcador = L.marker(ll, { icon: iconeEu(), zIndexOffset: 2000, interactive: true }).bindTooltip('Você está aqui').addTo(mapa); euCirculo = L.circle(ll, { radius: S.minhaPos.prec, color: '#D08A3C', weight: 1, fillOpacity: .08, interactive: false }).addTo(mapa); }
  else { euMarcador.setLatLng(ll); euCirculo.setLatLng(ll).setRadius(S.minhaPos.prec); }
  if (centralizar) mapa.setView(ll, Math.max(mapa.getZoom(), 15));
}
function alternarLocalizacao() {
  if (S.rastreando) { navigator.geolocation.clearWatch(S.watchId); S.rastreando = false; if (euMarcador) { mapa.removeLayer(euMarcador); mapa.removeLayer(euCirculo); euMarcador = null; } $('#bLoc').classList.remove('pri'); toast('Localização desligada'); return; }
  if (!navigator.geolocation) return toast('Este aparelho não informa a localização.');
  let primeira = true; toast('Buscando sua localização…');
  S.rastreando = true;
  S.watchId = navigator.geolocation.watchPosition(g => { S.minhaPos = { lat: g.coords.latitude, lng: g.coords.longitude, prec: g.coords.accuracy }; if (S.aba === 'mapa') mostrarEu(primeira); primeira = false; },
    e => { toast(e.code === 1 ? 'Permita o acesso à localização no navegador para usar essa função.' : 'Não foi possível obter a localização.'); navigator.geolocation.clearWatch(S.watchId); S.rastreando = false; $('#bLoc')?.classList.remove('pri'); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  $('#bLoc').classList.add('pri');
}

/* ---------- nuvens de potencial: onde já vendemos bem, num raio de 2 km ---------- */
let camadaNuvem = null, camadaQuad = null;
/* ---- área desenhada → buscas para o Outscraper ---- */
// pontos de busca espalhados dentro da área (a cada ~1,2 km), cada um vira um link de busca do Google Maps por categoria
function pontosDaArea(f) {
  const passo = 1.2, dLa = passo / 111.2, dLo = passo / 96.3, pts = [];
  if (f.t === 'c') { const n = Math.ceil(f.r / 1000 / passo); for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) { const q = { lat: f.lat + i * dLa, lng: f.lng + j * dLo }; if (distM(q, f) <= f.r) pts.push(q); } if (!pts.length) pts.push({ lat: f.lat, lng: f.lng }); }
  else { const [a, b] = f.b, la0 = Math.min(a[0], b[0]), la1 = Math.max(a[0], b[0]), lo0 = Math.min(a[1], b[1]), lo1 = Math.max(a[1], b[1]);
    for (let la = la0 + dLa / 2; la < la1; la += dLa) for (let lo = lo0 + dLo / 2; lo < lo1; lo += dLo) pts.push({ lat: la, lng: lo }); if (!pts.length) pts.push({ lat: (la0 + la1) / 2, lng: (lo0 + lo1) / 2 }); }
  return pts;
}
const dentroDaArea = (f, p) => f.t === 'c' ? distM(p, f) <= f.r : (() => { const [a, b] = f.b; return p.lat >= Math.min(a[0], b[0]) && p.lat <= Math.max(a[0], b[0]) && p.lng >= Math.min(a[1], b[1]) && p.lng <= Math.max(a[1], b[1]); })();
// bairros da área: os dos pontos já cadastrados + consulta ao mapa (OpenStreetMap) nos pontos espalhados pela área
async function descobrirBairros(f, pts, dentro) {
  const m = new Map(); dentro.forEach(p => { if (p.bairro?.trim()) m.set(norm(p.bairro.trim()), [p.bairro.trim(), p.cidade || 'Porto Alegre']); });
  const amostra = pts.length <= 12 ? pts : pts.filter((_, k) => k % Math.ceil(pts.length / 12) === 0);
  const borda = f.t === 'c' ? [0, 90, 180, 270].map(a => ({ lat: f.lat + Math.cos(a * Math.PI / 180) * f.r * 0.85 / 111200, lng: f.lng + Math.sin(a * Math.PI / 180) * f.r * 0.85 / 96300 }))
    : [[f.b[0][0], f.b[0][1]], [f.b[0][0], f.b[1][1]], [f.b[1][0], f.b[0][1]], [f.b[1][0], f.b[1][1]]].map(([la, lo]) => ({ lat: la + (f.b[1][0] > f.b[0][0] ? 1 : -1) * 0.0015, lng: lo + (f.b[1][1] > f.b[0][1] ? 1 : -1) * 0.0015 }));
  for (const q of [...amostra, ...borda]) {
    try { const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=pt-BR&lat=${q.lat}&lon=${q.lng}`)).json(), a = r.address || {};
      const b = a.suburb || a.neighbourhood || a.quarter || a.city_district, c = a.city || a.town || a.municipality || 'Porto Alegre';
      if (b && !m.has(norm(b))) m.set(norm(b), [b, c]); } catch { }
    await new Promise(r => setTimeout(r, 1100)); // o mapa gratuito pede 1 consulta por segundo
  }
  return [...m.values()];
}
function painelArea(f, i) {
  const s = $('#side'); s.classList.add('open'); mapa.invalidateSize();
  const c = f.t === 'c' ? { lat: f.lat, lng: f.lng } : { lat: (f.b[0][0] + f.b[1][0]) / 2, lng: (f.b[0][1] + f.b[1][1]) / 2 };
  const larg = f.t === 'r' ? Math.abs(f.b[0][1] - f.b[1][1]) * 96.3 : 0, alt = f.t === 'r' ? Math.abs(f.b[0][0] - f.b[1][0]) * 111.2 : 0;
  const km2a = f.t === 'c' ? Math.PI * (f.r / 1000) ** 2 : larg * alt, raioKm = f.t === 'c' ? f.r / 1000 : Math.hypot(larg, alt) / 2;
  const zoom = raioKm <= 1 ? 15 : raioKm <= 2.5 ? 14 : raioKm <= 5 ? 13 : 12, fmtO = `@${c.lat.toFixed(5)},${c.lng.toFixed(5)},${zoom}z`;
  const pts = pontosDaArea(f), dentro = S.pdvs.filter(p => p.lat && dentroDaArea(f, p)), cli = dentro.filter(p => CART.includes(p.etapa)), pro = dentro.filter(p => PROSP.includes(p.etapa));
  const bairros = [...new Set(dentro.map(p => p.bairro?.trim()).filter(Boolean))], cidade = dentro.find(p => p.cidade)?.cidade || 'Porto Alegre';
  const cats = S.areaCats || BUSCAS_PDV.slice();
  // o Outscraper ignora a coordenada do link, então as buscas vão por bairro: "categoria, bairro, cidade, RS"
  const chaveA = JSON.stringify(f.t === 'c' ? [f.lat, f.lng, f.r] : f.b); S.areaBairros = S.areaBairros || {};
  const achados = S.areaBairros[chaveA], bairrosA = achados ? achados.filter(x => !(S.areaFora || []).includes(x[0])) : null, nLinks = bairrosA ? bairrosA.length * cats.length : 0;
  s.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">Área desenhada</h2><button class="btn" id="xArea" style="padding:4px 10px">✕</button></div>
   <p style="color:var(--soft);font-size:13px;margin-top:6px">${f.t === 'c' ? `Círculo de raio ${dec(raioKm)} km` : `Quadrado de ${dec(larg)} × ${dec(alt)} km`} · ${dec(km2a)} km²</p>
   <div class="zkv"><div><small>Clientes dentro</small><b>${cli.length}</b></div><div><small>Prospects dentro</small><b>${pro.length}</b></div><div><small>Bairros na área</small><b>${achados ? bairrosA.length : '…'}</b></div><div><small>Buscas no total</small><b>${achados ? nLinks : '…'}</b></div></div>
   <div class="zcoord"><div><small>Formato do Outscraper (centro e zoom)</small><b>${fmtO}</b></div>${bairros.length ? `<div><small>Bairros com pontos já cadastrados</small><b style="font-weight:600">${esc(bairros.join(', '))}</b></div>` : ''}</div>
   <h3 style="margin:14px 0 6px">Bairros dentro da área</h3><div class="acats" id="aBairros">${achados ? achados.map(([b, c]) => `<label><input type="checkbox" value="${esc(b)}" ${(S.areaFora || []).includes(b) ? '' : 'checked'}>${esc(b)} <small style="color:var(--mute)">${esc(c)}</small></label>`).join('') || '<span style="color:var(--mute)">Não achei bairros nesta área.</span>' : '<span style="color:var(--mute)">Descobrindo os bairros pelo mapa…</span>'}</div>
   <h3 style="margin:14px 0 6px">Categorias</h3><div class="acats">${BUSCAS_PDV.map(t => `<label><input type="checkbox" value="${esc(t)}" ${cats.includes(t) ? 'checked' : ''}>${esc(t)}</label>`).join('')}</div>
   <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:12px"><button class="btn pri" id="aLinks">Baixar buscas da área (.txt)</button><button class="btn" id="aCopia">Copiar ${fmtO}</button><a class="btn" style="text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/${fmtO}">Ver no Google Maps ↗</a></div>
   <p style="color:var(--mute);font-size:12px;margin-top:10px">Cada linha é uma busca "categoria, bairro, cidade, RS". No Outscraper (Raspador do Google Maps), cole em Consultas, coloque o limite máximo de resultados maior que o número de buscas × 20, exporte em CSV e suba em Uploads → Google Maps: os pontos entram como Mapeado.</p>
   <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn" id="aMapeada">✓ Marcar como área mapeada</button><button class="mini" id="aExcluir">apagar este desenho</button></div>`;
  $('#xArea').onclick = () => { s.classList.remove('open'); painel(); };
  s.querySelectorAll('.acats:not(#aBairros) input').forEach(x => x.onchange = () => { S.areaCats = [...s.querySelectorAll('.acats:not(#aBairros) input:checked')].map(i => i.value); painelArea(f, i); });
  s.querySelectorAll('#aBairros input').forEach(x => x.onchange = () => { const fora = new Set(S.areaFora || []); x.checked ? fora.delete(x.value) : fora.add(x.value); S.areaFora = [...fora]; painelArea(f, i); });
  if (!achados) descobrirBairros(f, pts, dentro).then(l => { S.areaBairros[chaveA] = l; if ($('#xArea')) painelArea(f, i); });
  $('#aCopia').onclick = async () => { try { await navigator.clipboard.writeText(fmtO); toast('Copiado: ' + fmtO); } catch { prompt('Copie:', fmtO); } };
  $('#aLinks').onclick = () => { if (!cats.length) return toast('Escolha pelo menos uma categoria');
    if (!bairrosA?.length) return toast(achados ? 'Marque pelo menos um bairro' : 'Espere terminar de descobrir os bairros');
    const ls = []; cats.forEach(t => bairrosA.forEach(([b, c]) => ls.push(`${t}, ${b}, ${c}, RS`)));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ls.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })); a.download = `buscas_area_${cidade.replace(/\s+/g, '_')}_${dec(raioKm).replace(',', '-')}km.txt`; document.body.appendChild(a); a.click(); a.remove();
    toast(`${ls.length} buscas (${bairrosA.length} bairros × ${cats.length} categorias)`); };
  $('#aMapeada').onclick = () => { modal(`<h3>Salvar como área mapeada</h3><p style="color:var(--soft)">O desenho sai dos rabiscos e passa a aparecer no botão <b>🗺 Áreas mapeadas</b>, com o avanço da prospecção dentro dele.</p><label>Nome da área<input id="amNome" value="${esc(bairros[0] || 'Área ' + (((S.base.regras.areas_mapeadas || []).length) + 1))}"></label><label>Como foi mapeada<input id="amMet" value="Google Maps (48 categorias)"></label><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="amOk">Salvar</button></div>`);
    $('#amOk').onclick = async () => { const nome = $('#amNome').value.trim() || 'Área'; const { cor, ...geo } = f; const nova = { id: Date.now().toString(36), nome, ...geo, em: new Date().toISOString().slice(0, 10), metodo: $('#amMet').value.trim(), base: dentro.length };
      try { const lista = [...(S.base.regras.areas_mapeadas || []), nova]; await db.salvarRegra('areas_mapeadas', lista); S.base.regras.areas_mapeadas = lista;
        const D = S.desenho; D.formas.splice(i, 1); await db.salvarRegra('desenhos_mapa', D.formas); S.base.regras.desenhos_mapa = D.formas.slice();
        fecharModal(); toast('Área mapeada salva'); S.areasOn = true; S.areaSel = nova.id; s.classList.remove('open'); irPara('mapa', true); } catch (e) { erro(e); } }; };
  $('#aExcluir').onclick = () => { const D = S.desenho; D.formas.splice(i, 1); db.salvarRegra('desenhos_mapa', D.formas).then(() => { S.base.regras.desenhos_mapa = D.formas.slice(); }).catch(erro); s.classList.remove('open'); irPara('mapa', true); };
}

/* ---- áreas mapeadas: regiões já varridas (ex.: extração do Google Maps) e o avanço da prospecção dentro delas ---- */
let camadaAreas = null;
function statsArea(a) {
  const ps = S.pdvs.filter(p => p.lat && dentroDaArea(a, p)), n = k => ps.filter(p => k.includes(p.etapa)).length;
  const mapeados = n(['mapeado']), contato = n(['visitado', 'negociacao']), clientes = n(CART), descartados = n(['perdido', 'fechado']);
  const total = ps.length, trabalhados = total - mapeados;
  const canais = {}; ps.filter(p => p.etapa === 'mapeado').forEach(p => { canais[p.canal || 'Outro'] = (canais[p.canal || 'Outro'] || 0) + 1; });
  return { ps, total, mapeados, contato, clientes, descartados, trabalhados, pct: total ? Math.round(trabalhados / total * 100) : 0, canais };
}
const limArea = a => a.t === 'c' ? L.latLngBounds([a.lat - a.r / 111200, a.lng - a.r / 96300], [a.lat + a.r / 111200, a.lng + a.r / 96300]) : L.latLngBounds(a.b);
function desenharAreas(ajustar) {
  if (camadaAreas) camadaAreas.clearLayers(); else camadaAreas = L.layerGroup().addTo(mapa);
  const As = S.base.regras.areas_mapeadas || [];
  As.forEach(a => { const st = statsArea(a), sel = S.areaSel === a.id, cor = '#1baf7a';
    const g = a.t === 'c' ? L.circle([a.lat, a.lng], { radius: a.r, color: cor, weight: sel ? 4 : 3, dashArray: '10 6', fillColor: cor, fillOpacity: .08 + st.pct / 100 * .25 })
      : L.rectangle(a.b, { color: cor, weight: sel ? 4 : 3, dashArray: '10 6', fillColor: cor, fillOpacity: .08 + st.pct / 100 * .25 });
    g.bindTooltip(`${esc(a.nome)} · ${st.total} pontos · ${st.pct}% trabalhado`, { sticky: true }).on('click', e => { L.DomEvent.stop(e); S.sel = null; S.areaSel = a.id; desenharAreas(); painel(); }).addTo(camadaAreas);
    const lb = limArea(a), c = lb.getNorth(), lng = lb.getCenter().lng;
    L.marker([c, lng], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="qrot" style="--c:${cor}">${esc(a.nome)}<small>${st.mapeados} a abordar · ${st.pct}%</small></div>`, iconSize: [130, 34], iconAnchor: [65, 40] }) }).addTo(camadaAreas); });
  if (ajustar && As.length) { const b = As.map(limArea).reduce((x, y) => x.extend(y)); if (b.isValid()) mapa.fitBounds(b, { padding: [40, 40], maxZoom: 15 }); }
  if (ajustar && !As.length) toast('Nenhuma área mapeada ainda: desenhe um quadrado ou círculo e use "Marcar como área mapeada"');
  painel();
}
function painelAreas(s) {
  s.classList.add('open'); const As = S.base.regras.areas_mapeadas || [];
  const barra = st => `<div class="ambar"><i style="width:${st.total ? st.clientes / st.total * 100 : 0}%;background:#2F7D4E"></i><i style="width:${st.total ? st.contato / st.total * 100 : 0}%;background:#3F6FA8"></i><i style="width:${st.total ? st.descartados / st.total * 100 : 0}%;background:#9A8F86"></i></div>`;
  const det = (a, st) => `<div class="zkv"><div><small>Pontos na área</small><b>${st.total}</b></div><div><small>Mapeados a abordar</small><b>${st.mapeados}</b></div><div><small>Em prospecção</small><b>${st.contato}</b></div><div><small>Viraram clientes</small><b>${st.clientes}</b></div><div><small>Perdidos ou fechados</small><b>${st.descartados}</b></div><div><small>Avanço</small><b>${st.pct}%</b></div></div>
    ${Object.keys(st.canais).length ? `<h3 style="margin:12px 0 4px;font-size:14px">A abordar por canal</h3><div style="font-size:13px">${Object.entries(st.canais).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="row" style="justify-content:space-between"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>` : ''}
    <p style="color:var(--mute);font-size:12px;margin:8px 0 0">Mapeada em ${new Date(a.em + 'T12:00').toLocaleDateString('pt-BR')}${a.metodo ? ' · ' + esc(a.metodo) : ''}</p>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn pri" data-amver="${a.id}">Ver os mapeados no mapa</button><button class="mini" data-amren="${a.id}">renomear</button><button class="mini" data-amdel="${a.id}">remover área</button></div>`;
  const tot = As.reduce((acc, a) => { const st = statsArea(a); acc.t += st.total; acc.m += st.mapeados; return acc; }, { t: 0, m: 0 });
  s.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">Áreas mapeadas</h2><button class="btn" id="xAreas" style="padding:4px 10px">✕</button></div>
   <p style="color:var(--soft);font-size:13px;margin-top:6px">${As.length ? `${As.length} área(s) · ${tot.t} pontos · ${tot.m} ainda a abordar. A cor fica mais forte conforme a área é trabalhada.` : 'Nenhuma área ainda. Desenhe um quadrado ou círculo, toque nele e use <b>Marcar como área mapeada</b>.'}</p>
   <div class="amleg"><span><i style="background:#2F7D4E"></i>clientes</span><span><i style="background:#3F6FA8"></i>em prospecção</span><span><i style="background:#9A8F86"></i>perdidos/fechados</span><span><i style="background:var(--sand2,var(--line))"></i>a abordar</span></div>
   ${As.map(a => { const st = statsArea(a); return `<div class="zona ${S.areaSel === a.id ? 'on' : ''}" data-am="${a.id}" style="border-left:4px solid #1baf7a"><div class="row" style="justify-content:space-between"><b>${esc(a.nome)}</b><b>${st.pct}%</b></div>${barra(st)}<small style="color:var(--soft)">${st.mapeados} a abordar · ${st.contato} em prospecção · ${st.clientes} clientes</small>${S.areaSel === a.id ? det(a, st) : ''}</div>`; }).join('')}`;
  $('#xAreas').onclick = () => { S.areasOn = false; $('#bAreas')?.classList.remove('car'); camadaAreas?.clearLayers(); painel(); };
  s.querySelectorAll('[data-am]').forEach(d => d.onclick = e => { if (e.target.closest('button')) return; const a = As.find(x => x.id === d.dataset.am); S.areaSel = S.areaSel === a.id ? null : a.id; if (S.areaSel) mapa.fitBounds(limArea(a), { padding: [40, 40] }); desenharAreas(); });
  s.querySelectorAll('[data-amver]').forEach(b => b.onclick = () => { const a = As.find(x => x.id === b.dataset.amver); S.etapasMapa = new Set(['mapeado', 'visitado', 'negociacao']); document.querySelectorAll('#fEtMenu input').forEach(i => i.checked = S.etapasMapa.has(i.value)); const fb = $('#fEtBtn'); if (fb) fb.textContent = '3 etapas';
    mapa.fitBounds(limArea(a), { padding: [30, 30] }); desenhar(); });
  const salvarA = async lista => { await db.salvarRegra('areas_mapeadas', lista); S.base.regras.areas_mapeadas = lista; desenharAreas(); };
  s.querySelectorAll('[data-amren]').forEach(b => b.onclick = () => { const a = As.find(x => x.id === b.dataset.amren), n = prompt('Nome da área', a.nome); if (!n?.trim()) return; salvarA(As.map(x => x.id === a.id ? { ...x, nome: n.trim() } : x)).catch(erro); });
  s.querySelectorAll('[data-amdel]').forEach(b => b.onclick = () => { const a = As.find(x => x.id === b.dataset.amdel); modal(`<h3>Remover a área "${esc(a.nome)}"?</h3><p style="color:var(--soft)">Só o contorno sai do mapa. Os pontos mapeados continuam cadastrados.</p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="amDelOk">Remover</button></div>`);
    $('#amDelOk').onclick = () => { fecharModal(); S.areaSel = null; salvarA(As.filter(x => x.id !== a.id)).catch(erro); }; });
}

/* ---- quadrantes da carteira: agrupa os clientes pela proximidade e mede quanto cada grupo compra ---- */
const COR_Q = ['#2a78d6', '#eb6834', '#1baf7a', '#7B4FC0', '#d03b3b', '#B8860B'];
function agruparQuad(pts, k) {
  // começa pelos pontos mais distantes entre si (resultado estável) e ajusta os centros (k-médias)
  let C = [pts.reduce((a, b) => (b.lat < a.lat ? b : a))];
  while (C.length < k) C.push(pts.reduce((a, b) => Math.min(...C.map(c => km2(b, c))) > Math.min(...C.map(c => km2(a, c))) ? b : a));
  C = C.map(c => ({ lat: c.lat, lng: c.lng })); let A = [];
  for (let it = 0; it < 60; it++) { A = pts.map(x => C.reduce((bi, c, i) => km2(x, c) < km2(x, C[bi]) ? i : bi, 0));
    C = C.map((c, i) => { const g = pts.filter((_, j) => A[j] === i); return g.length ? { lat: g.reduce((a, x) => a + x.lat, 0) / g.length, lng: g.reduce((a, x) => a + x.lng, 0) / g.length } : c; }); }
  return C.map((c, i) => ({ c, g: pts.filter((_, j) => A[j] === i) })).filter(q => q.g.length);
}
const casca = pts => { const p = [...pts].sort((a, b) => a.lng - b.lng || a.lat - b.lat); if (p.length < 3) return p; const cr = (o, a, b) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const lo = [], hi = []; p.forEach(x => { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], x) <= 0) lo.pop(); lo.push(x); });
  [...p].reverse().forEach(x => { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], x) <= 0) hi.pop(); hi.push(x); }); return lo.slice(0, -1).concat(hi.slice(0, -1)); };
async function desenharQuad() {
  if (!S.quadPed) { try { S.quadPed = await db.resumoPedidos(); } catch (e) { return erro(e); } }
  const k = S.quadK || 4, desde = Date.now() - 180 * DIA, ped = {}; S.quadPed.forEach(o => { if (new Date(o.criado_em) >= desde) (ped[o.pdv_id] = ped[o.pdv_id] || []).push(o); });
  const cart = S.pdvs.filter(p => p.lat && CART.includes(p.etapa));
  // quem fica muito longe do miolo da carteira (ex.: outra cidade) não entra nos quadrantes
  const med = { lat: [...cart].sort((a, b) => a.lat - b.lat)[cart.length >> 1]?.lat, lng: [...cart].sort((a, b) => a.lng - b.lng)[cart.length >> 1]?.lng };
  const dentro = cart.filter(p => km2(p, med) <= 30), fora = cart.filter(p => km2(p, med) > 30);
  if (dentro.length < k) return toast('Poucos clientes com localização para dividir');
  const est = g => { const os = g.flatMap(p => ped[p.id] || []), fat = os.reduce((a, o) => a + Number(o.valor || 0), 0), c = { lat: g.reduce((a, x) => a + x.lat, 0) / g.length, lng: g.reduce((a, x) => a + x.lng, 0) / g.length };
    return { n: g.length, ativos: g.filter(p => p.etapa === 'ativo').length, compradores: new Set(os.map(o => o.pdv_id)).size, fatMes: fat / 6, pedMes: os.length / 6, ticket: os.length ? fat / os.length : 0, porCliente: g.length ? fat / 6 / g.length : 0,
      raio: Math.max(...g.map(x => km2(x, c))), bairros: [...new Set(g.map(p => p.bairro).filter(Boolean))], cidades: [...new Set(g.map(p => p.cidade).filter(Boolean))], regs: [...new Set(g.map(p => p.regiao).filter(Boolean))], c }; };
  S.quads = agruparQuad(dentro, k).map(q => ({ ...est(q.g), g: q.g })).sort((a, b) => b.fatMes - a.fatMes).map((q, i) => ({ ...q, i, cor: COR_Q[i % COR_Q.length], nome: `Q${i + 1}` }));
  S.quadFora = fora.length ? { ...est(fora), g: fora } : null;
  if (camadaQuad) camadaQuad.clearLayers(); else camadaQuad = L.layerGroup().addTo(mapa);
  S.quads.forEach(q => { const h = casca(q.g);
    if (h.length >= 3) L.polygon(h.map(x => [x.lat, x.lng]), { color: q.cor, weight: 2, fillColor: q.cor, fillOpacity: .12 }).bindTooltip(`${q.nome} · ${q.n} clientes · ${brl(q.fatMes)}/mês`).on('click', () => { S.sel = null; S.quadSel = q.i; painel(); }).addTo(camadaQuad);
    else L.circle([q.c.lat, q.c.lng], { radius: 400, color: q.cor, weight: 2, fillOpacity: .12 }).addTo(camadaQuad);
    L.marker([q.c.lat, q.c.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="qrot" style="--c:${q.cor}">${q.nome}<small>${brl(q.fatMes)}/mês</small></div>`, iconSize: [90, 34], iconAnchor: [45, 17] }) }).addTo(camadaQuad); });
  S.sel = null; painel();
}
function painelQuad(s) {
  s.classList.add('open'); const Q = S.quads, tot = Q.reduce((a, q) => a + q.fatMes, 0) + (S.quadFora?.fatMes || 0);
  const linha = (q, fora) => `<div class="zona ${S.quadSel === q.i && !fora ? 'on' : ''}" ${fora ? '' : `data-q="${q.i}"`} style="border-left:4px solid ${fora ? '#9A8F86' : q.cor}">
    <div class="row" style="justify-content:space-between"><b>${fora ? 'Fora da área' : q.nome} · ${esc(q.cidades.join('/'))}</b><b>${brl(q.fatMes)}<small style="font-weight:400">/mês</small></b></div>
    <div class="qkv"><span><b>${q.n}</b> clientes · <b>${q.ativos}</b> ativos</span><span><b>${dec(q.pedMes)}</b> pedidos/mês</span><span>pedido médio <b>${brl(q.ticket)}</b></span><span><b>${brl(q.porCliente)}</b>/cliente/mês</span><span>raio ${dec(q.raio)} km</span><span>${Math.round(q.fatMes / (tot || 1) * 100)}% do faturamento</span></div>
    <small style="color:var(--mute)">${esc(q.bairros.slice(0, 7).join(', '))}${q.bairros.length > 7 ? '…' : ''}${q.regs.length ? ` · regiões hoje: ${esc(q.regs.join(', '))}` : ''}</small></div>`;
  s.innerHTML = `<button class="btn" style="float:right;padding:4px 10px" id="xQuad">✕</button><h2>Quadrantes da carteira</h2>
   <p style="color:var(--soft);margin-top:0">Clientes da carteira agrupados pela proximidade. Valores pela média dos pedidos dos últimos 6 meses.</p>
   <div class="row" style="gap:6px;margin-bottom:10px"><span style="color:var(--soft);font-size:13px">Quantos quadrantes:</span>${[3, 4, 5].map(n => `<button class="mini ${(S.quadK || 4) === n ? 'on' : ''}" data-qk="${n}">${n}</button>`).join('')}</div>
   ${Q.map(q => linha(q)).join('')}${S.quadFora ? linha(S.quadFora, true) : ''}
   <p style="color:var(--mute);font-size:12px">Toque num quadrante para ver no mapa. Os quadrantes são uma sugestão: as regiões de reposição de hoje não mudam.</p>`;
  $('#xQuad').onclick = () => { S.quad = false; $('#bQuad')?.classList.remove('car'); camadaQuad?.clearLayers(); painel(); };
  s.querySelectorAll('[data-qk]').forEach(b => b.onclick = () => { S.quadK = +b.dataset.qk; S.quadSel = null; desenharQuad(); });
  s.querySelectorAll('[data-q]').forEach(d => d.onclick = () => { const q = Q[+d.dataset.q]; S.quadSel = q.i; mapa.fitBounds(L.latLngBounds(q.g.map(x => [x.lat, x.lng])).pad(0.3)); painelQuad(s); });
}
async function valorMensalClientes() {
  if (!S.rpCache || Date.now() - S.rpCache.t > 5 * 60000) S.rpCache = { t: Date.now(), ls: await db.resumoPedidos() };
  const desde = Date.now() - 180 * DIA, v = {};
  S.rpCache.ls.forEach(o => { if (new Date(o.criado_em) >= desde) v[o.pdv_id] = (v[o.pdv_id] || 0) + (Number(o.valor) || 0) / 6; });
  return v;
}
async function desenharNuvens(enquadrar) {
  let vm; try { vm = await valorMensalClientes(); } catch (e) { return erro(e); }
  if (!S.nuvens || !mapa) return;
  const bons = S.pdvs.filter(p => p.lat && vm[p.id] > 0).map(p => ({ p, v: vm[p.id] }));
  if (!bons.length) { toast('Ainda não há vendas nos últimos 6 meses para calcular o potencial'); return; }
  const R = 2000, CEL = 300, mLat = 1 / 111320, lat0 = bons[0].p.lat, mLng = 1 / (111320 * Math.cos(lat0 * Math.PI / 180));
  const la = bons.map(b => b.p.lat), lo = bons.map(b => b.p.lng);
  const minLa = Math.min(...la) - R * mLat, maxLa = Math.max(...la) + R * mLat, minLo = Math.min(...lo) - R * mLng, maxLo = Math.max(...lo) + R * mLng;
  const cel = [];
  for (let y = minLa; y <= maxLa; y += CEL * mLat) for (let x = minLo; x <= maxLo; x += CEL * mLng) {
    const c = { lat: y + CEL * mLat / 2, lng: x + CEL * mLng / 2 }; let s = 0;
    for (const b of bons) { const d = distM(c, b.p); if (d < R) s += b.v * (1 - d / R); }
    if (s > 0) cel.push({ y, x, c, s });
  }
  const max = Math.max(...cel.map(c => c.s));
  if (!mapa.getPane('nuvens')) { mapa.createPane('nuvens'); mapa.getPane('nuvens').style.zIndex = 350; mapa.getPane('nuvens').style.filter = 'blur(10px)'; mapa.getPane('nuvens').style.pointerEvents = 'none'; }
  if (camadaNuvem) camadaNuvem.clearLayers(); else camadaNuvem = L.layerGroup().addTo(mapa);
  let rend; try { rend = L.canvas({ pane: 'nuvens' }); } catch { rend = L.svg({ pane: 'nuvens' }); }
  const cor = t => t > .66 ? '#C2410C' : t > .4 ? '#EA8A2E' : t > .2 ? '#F2B84B' : '#F7DC8C';
  cel.forEach(k => { const t = k.s / max; if (t < .12) return; L.rectangle([[k.y, k.x], [k.y + CEL * mLat, k.x + CEL * mLng]], { renderer: rend, stroke: false, fillColor: cor(t), fillOpacity: .18 + .55 * t, interactive: false }).addTo(camadaNuvem); });
  // zonas: picos de potencial a pelo menos 1,5 km um do outro
  const zonas = [];
  for (const k of cel.slice().sort((a, b) => b.s - a.s)) { if (zonas.length >= 8 || k.s / max < .25) break; if (zonas.some(z => distM(z.c, k.c) < 1500)) continue; zonas.push({ c: k.c, s: k.s }); }
  zonas.forEach((z, i) => {
    const perto = S.pdvs.filter(p => p.lat && distM(p, z.c) < R);
    z.clientes = perto.filter(p => vm[p.id] > 0).sort((a, b) => vm[b.id] - vm[a.id]); z.vm = vm; z.valor = z.clientes.reduce((a, p) => a + vm[p.id], 0);
    z.prospects = perto.filter(p => ['mapeado', 'visitado', 'negociacao'].includes(p.etapa)); z.inativos = perto.filter(p => p.etapa === 'inativo');
    const cnt = {}; perto.forEach(p => { const b = p.bairro || p.cidade; if (b) cnt[b] = (cnt[b] || 0) + 1; });
    z.nome = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(' / ') || 'Zona ' + (i + 1);
    z.nota = Math.round(z.s / max * 100);
    L.marker([z.c.lat, z.c.lng], { icon: L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17], html: `<div class="zona-pin">Z${i + 1}</div>` }), zIndexOffset: 800 })
      .bindTooltip(`Zona ${i + 1} · ${esc(z.nome)} · potencial ${z.nota}`).on('click', () => { S.sel = null; S.zonaSel = i; painel(); }).addTo(camadaNuvem);
  });
  S.zonas = zonas; S.zonaSel = null;
  zonas.forEach(z => { const cc = {}; S.pdvs.filter(p => p.lat && p.cidade && distM(p, z.c) < 2000).forEach(p => cc[p.cidade] = (cc[p.cidade] || 0) + 1); z.cidade = Object.keys(cc).sort((a, b) => cc[b] - cc[a])[0]; });
  if (!mapa._nuvemClick) { mapa._nuvemClick = true; mapa.on('click', e => { if (!S.nuvens || !S.zonas?.length || marcando) return; let best = -1, bd = 1e9; S.zonas.forEach((z, i) => { const d = distM(z.c, { lat: e.latlng.lat, lng: e.latlng.lng }); if (d < bd) { bd = d; best = i; } }); if (bd < 2000) { S.sel = null; S.zonaSel = best; painel(); } }); }
  if (enquadrar) mapa.fitBounds(L.latLngBounds(bons.map(b => [b.p.lat, b.p.lng])).pad(.1));
  if (!S.sel) painel();
}
// categorias de ponto de venda para extrair no Outscraper
const BUSCAS_PDV = [ // categorias escolhidas (21/11): comida rápida, varejo de bairro, universidade, farmácia, serviços de espera, noite e lojas
  'lanchonete', 'cafeteria', 'café', 'padaria', 'confeitaria', 'doceria', 'pastelaria', 'loja de açaí', 'sorveteria', 'casa de sucos', 'cachorro-quente', 'hamburgueria', 'pizzaria', 'restaurante self-service', 'restaurante', 'praça de alimentação',
  'loja de conveniência', 'minimercado', 'mercado', 'supermercado', 'mercearia', 'armazém', 'hortifruti', 'empório', 'loja de produtos naturais', 'distribuidora de bebidas', 'tabacaria', 'banca de jornal', 'posto de gasolina',
  'universidade', 'cantina', 'copiadora', 'papelaria', 'livraria', 'moradia estudantil', 'escola de idiomas', 'cursinho preparatório',
  'farmácia', 'drogaria', 'barbearia', 'salão de beleza',
  'bar', 'boteco', 'cervejaria', 'sinuca', 'loja de presentes', 'loja de chocolates', 'loja de produtos importados'];
function bairrosZona(z, comCidade) { const cnt = {}, cid = {}; S.pdvs.filter(p => p.lat && p.bairro && distM(p, z.c) < 2000).forEach(p => { const b = p.bairro.trim(); cnt[b] = (cnt[b] || 0) + 1; if (p.cidade) cid[b] = p.cidade; }); const ks = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]); return comCidade ? ks.map(b => [b, cid[b] || z.cidade || 'Porto Alegre']) : ks; }
function painelZonas(s) {
  s.classList.add('open');
  const zs = S.zonas;
  s.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">Nuvens de potencial</h2><button class="btn" id="xZon" style="padding:4px 10px">✕</button></div>
   <p style="color:var(--soft);font-size:13px;margin-top:6px">Calculado pelo que cada cliente comprou por mês nos últimos 6 meses, espalhado num raio de 2 km. Quanto mais forte a cor, mais venda já existe por perto: é onde abrir novos pontos tende a dar certo.</p>
   ${zs.map((z, i) => `<div class="zona ${S.zonaSel === i ? 'on' : ''}" data-z="${i}"><div class="row" style="justify-content:space-between"><b>Z${i + 1} · ${esc(z.nome)}</b><span class="badge" style="background:${z.nota > 66 ? '#C2410C' : z.nota > 40 ? '#EA8A2E' : '#F2B84B'};color:#fff">potencial ${z.nota}</span></div>
     <div class="zkv"><div><small>Vendas no raio</small><b>${brl(z.valor)}/mês</b></div><div><small>Clientes comprando</small><b>${z.clientes.length}</b></div><div><small>Prospects mapeados</small><b>${z.prospects.length}</b></div><div><small>Inativos p/ recuperar</small><b>${z.inativos.length}</b></div></div>
     ${S.zonaSel === i ? (() => { const ll = `${z.c.lat.toFixed(5)}, ${z.c.lng.toFixed(5)}`, bs = bairrosZona(z); return `<div class="zcoord"><div><small>Centro da zona (raio de 2 km)</small><b>${ll}</b></div>
       <div><small>Coordenadas no formato do Outscraper</small><b>@${z.c.lat.toFixed(5)},${z.c.lng.toFixed(5)},14z</b></div>
       <div><small>Bairros dentro da zona</small><b style="font-weight:600">${esc(bs.join(', ') || '—')}</b></div>
       <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><button class="mini" data-copia="${ll}">copiar coordenadas</button><button class="mini" data-copia="@${z.c.lat.toFixed(5)},${z.c.lng.toFixed(5)},14z">copiar formato Outscraper</button><button class="mini" data-buscas="${i}">baixar buscas da zona (.txt)</button><a class="mini" target="_blank" rel="noopener" href="https://www.google.com/maps/@${z.c.lat},${z.c.lng},14z">ver no Google Maps ↗</a></div></div>`; })() : ''}
     ${S.zonaSel === i ? `<div style="margin-top:8px;font-size:12.5px">${z.clientes.slice(0, 8).map(p => `<div class="row" style="justify-content:space-between"><span>• ${esc(p.nome)}</span><b>${brl(z.vm[p.id])}/mês</b></div>`).join('')}</div>` : ''}</div>`).join('')}
   <p style="color:var(--mute);font-size:12px">Próximo passo: extrair os pontos dessas zonas no Outscraper e montar o plano de prospecção por zona.</p>`;
  $('#xZon').onclick = () => { S.nuvens = false; $('#bNuvem')?.classList.remove('car'); camadaNuvem?.clearLayers(); painel(); };
  s.querySelectorAll('[data-z]').forEach(d => d.onclick = e => { if (e.target.closest('.zcoord')) return; const i = +d.dataset.z; S.zonaSel = i; mapa.setView([zs[i].c.lat, zs[i].c.lng], 14); painelZonas(s); });
  s.querySelectorAll('[data-copia]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copia); toast('Copiado: ' + b.dataset.copia); } catch { prompt('Copie:', b.dataset.copia); } });
  s.querySelectorAll('[data-buscas]').forEach(b => b.onclick = () => { const z = zs[+b.dataset.buscas], bs = bairrosZona(z), cid = z.cidade || 'Porto Alegre';
    const ls = []; BUSCAS_PDV.forEach(t => bs.length ? bairrosZona(z, true).forEach(([bb, cc]) => ls.push(`${t}, ${bb}, ${cc}, RS`)) : ls.push(`${t} perto de ${z.c.lat.toFixed(5)},${z.c.lng.toFixed(5)}`));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ls.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })); a.download = `buscas_zona_Z${+b.dataset.buscas + 1}.txt`; document.body.appendChild(a); a.click(); a.remove();
    toast(`${ls.length} buscas da zona Z${+b.dataset.buscas + 1} (${bs.length} bairros × ${BUSCAS_PDV.length} categorias)`); });
}
// prioridade para reativar clientes parados
const PRIOR = { alta: { n: 'Alta', c: '#d03b3b', v: 3 }, media: { n: 'Média', c: '#fab219', v: 2 }, baixa: { n: 'Baixa', c: '#9A8F86', v: 1 } };
const REATIVAR = ['inativo', 'perdido', 'risco', 'revisao'];
const seloPrior = p => REATIVAR.includes(p.etapa) && p.prioridade_reativacao && PRIOR[p.prioridade_reativacao] ? `<span class="badge prior" style="--c:${PRIOR[p.prioridade_reativacao].c}">Reativar · ${PRIOR[p.prioridade_reativacao].n}</span>` : '';
const campoPrior = p => REATIVAR.includes(p.etapa) ? /* só para quem está parado; cliente ativo não mostra */ `<div class="sect prisect"><h3>Prioridade para reativar</h3><div class="prichips">${Object.entries(PRIOR).reverse().map(([k, x]) => `<button type="button" data-prior="${k}" class="${p.prioridade_reativacao === k ? 'on' : ''}" style="--c:${x.c}">${x.n}</button>`).join('')}</div></div>` : '';
function ligarPrior(p, depois) { document.querySelectorAll('[data-prior]').forEach(b => b.onclick = async () => { const v = p.prioridade_reativacao === b.dataset.prior ? null : b.dataset.prior;
  try { await db.atualizarPdv(p.id, { prioridade_reativacao: v }); await atualizarUm(p.id); toast(v ? `Prioridade para reativar: ${PRIOR[v].n}` : 'Prioridade removida'); depois(); }
  catch (e) { erro(/prioridade_reativacao/.test(e.message) ? new Error('Rode o 021_prioridade_reativacao.sql no Supabase') : e); } }); }
// rota entre dois pontos do mapa, pelas ruas (mesmo cálculo do Dia de rota)
const fmtDist = k => k < 1 ? `${Math.round(k * 1000)} m` : `${k.toFixed(k < 10 ? 1 : 0).replace('.', ',')} km`;
function mostrarRotaBox(html, esperando) { const b = $('#rotaBox'); if (!b) return; b.hidden = false; b.classList.toggle('esp', !!esperando);
  b.innerHTML = `<div>${html}</div><button class="btn" id="rbFechar">${esperando ? 'Cancelar' : 'Fechar rota'}</button>`;
  $('#rbFechar').onclick = () => { S.rotaDe = null; S.rotaPar = null; camadaTraco?.clearLayers(); b.hidden = true; }; }
async function tracarRota(deId, paraId) {
  const a = S.pdvs.find(x => x.id === deId), b = S.pdvs.find(x => x.id === paraId); S.rotaDe = null; if (!a || !b) return;
  mostrarRotaBox(`<b>${esc(a.nome)}</b> → <b>${esc(b.nome)}</b> · calculando…`, false);
  const g = await caminhoRuas([[a.lat, a.lng], [b.lat, b.lng]]); camadaTraco.clearLayers();
  const linha = g ? g.coords : [[a.lat, a.lng], [b.lat, b.lng]], km = g ? g.km : km2(a, b) * 1.35;
  L.polyline(linha, { color: '#ffffff', weight: 8, opacity: .9 }).addTo(camadaTraco); L.polyline(linha, { color: '#2a78d6', weight: 5, opacity: .95 }).addTo(camadaTraco);
  [[a, 'A'], [b, 'B']].forEach(([p, t]) => L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="rpin" style="background:#2a78d6">${t}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 2000 }).addTo(camadaTraco));
  mapa.fitBounds(L.latLngBounds(linha).pad(0.2));
  mostrarRotaBox(`<b>${esc(a.nome)}</b> → <b>${esc(b.nome)}</b><br><span class="rbn">${fmtDist(km)}</span>${g ? ` · ~${Math.round(g.min)} min de carro` : ' · estimativa em linha reta (sem conexão com o mapa de ruas)'}`, false);
}
const km2 = (a, b) => { const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
function painel() {
  const s = $('#side'); if (!s) return;
  const antes = s.classList.contains('open'); setTimeout(() => { if (mapa && s.classList.contains('open') !== antes) mapa.invalidateSize(); }, 0);
  const p = S.pdvs.find(x => x.id === S.sel);
  if (!(S.modoPend && !p)) document.getElementById('pendPill')?.remove();
  if (!p && S.modoPend) return listaPendentes(s);
  if (!p && S.areasOn) return painelAreas(s);
  if (!p && S.quad && S.quads) return painelQuad(s);
  if (!p && S.nuvens && S.zonas) return painelZonas(s);
  if (!p) { s.classList.remove('open'); s.innerHTML = `<div class="empty"><b>Selecione um ponto no mapa.</b><br>A cor mostra a etapa do funil.<br><br><b>+ Cadastrar ponto</b>: pela sua localização, marcando no mapa ou colando o link do Google Maps.<br><b>Reposições pendentes</b>: mostra quem precisa de reposição hoje ou está atrasado.</div>`; return; }
  s.classList.add('open');
  const podeComprar = p.etapa !== 'perdido' && !repoe(p);
  // abre a ficha do lugar no Google (nome + endereço, buscando em volta da coordenada), não só o ponto
  const gm = /^https?:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)/.test(p.link_maps || '') ? p.link_maps
    : p.lat ? `https://www.google.com/maps/search/${encodeURIComponent([p.nome, p.endereco ? limparRua(p.endereco) : null, p.cidade].filter(Boolean).join(', '))}/@${p.lat},${p.lng},18z` : null;
  s.innerHTML = `<button class="btn" style="float:right;padding:4px 10px" id="xSide">✕</button>${p.lat ? `<button class="btn" style="float:right;padding:4px 10px;margin-right:6px" id="bTraco">🧭 Traçar rota</button>` : ''}
  <small style="color:var(--mute)">${esc(p.canal || '')} · ${esc(p.cidade || '')}</small><h2>${esc(p.nome)}</h2>${p.contato_nome ? `<div style="color:var(--soft)">Contato: <b>${esc(p.contato_nome)}</b>${p.contato_telefone ? ' · ' + esc(p.contato_telefone) : ''}</div>` : ''}
  <div class="badges"><span class="badge st" style="background:${etapa(p.etapa).c}">${etapa(p.etapa).n}</span>${p.classe ? `<span class="badge">Classe ${p.classe}</span>` : ''}<span class="badge">${p.regiao || '—'} · ${esc(regNome(p.regiao))}</span>${p.expositor_id ? `<span class="badge">Expositor ${esc(expo(p.expositor_id).nome)}</span>` : ''}${seloPrior(p)}</div>
  ${campoPrior(p)}
  ${janelaTxt(p) || p.melhor_horario ? `<div style="margin-top:8px;font-size:13px">🕘 <b>${esc(janelaTxt(p) || '')}</b>${p.melhor_horario ? `${janelaTxt(p) ? ' · ' : ''}${esc(p.melhor_horario)}` : ''}</div>` : ''}
  ${caixaComentario(p)}
  ${caixaEsteira(p)}
  <div class="sect"><h3>Potencial</h3><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-pot="${i}" class="${i <= (p.potencial || 0) ? 'on' : ''}">★</button>`).join('')}</div></div>
  <div class="sect" id="sPeds"><h3>Últimos pedidos</h3><small style="color:var(--mute)">carregando…</small></div>
  ${ultimos6(p)}
  ${p.cadencia_efetiva ? `<div class="sect"><h3>Reposição</h3><div class="kv" style="margin:0 0 8px"><div><small>Próxima</small><b>${dstr(p.proxima_reposicao)}</b><small>${prazoTxt(p)}</small></div><div><small>Rota</small><b>${p.regiao || '—'} · ${DIAS[(S.base.regioes.find(r => r.codigo === p.regiao) || {}).dia_rota] || '—'}</b><small>${esc(regNome(p.regiao))}</small></div></div>
   <div class="row"><span>Repor a cada</span><select id="sCad"><option value="">padrão da etapa (${cadPadrao()[p.etapa] || '—'} dias)</option>${[7, 10, 14, 21, 28, 30].map(d => `<option value="${d}" ${p.cadencia_dias === d ? 'selected' : ''}>${d} dias</option>`).join('')}</select></div>
   <p style="color:var(--soft);margin:8px 0 0">Condição: <b>${esc(p.condicao || '—')}</b> · pedido mínimo ${brl(p.pedido_minimo)}</p></div>` : ''}
  <div class="sect"><h3>Etapa do funil</h3><select id="sEt" style="width:100%">${ETAPAS.map(e => `<option value="${e.k}" ${e.k === p.etapa ? 'selected' : ''}>${e.n}</option>`).join('')}</select></div>
  ${p.observacao ? `<div class="sect"><h3>Observação</h3><div style="color:var(--soft)">${esc(p.observacao)}</div></div>` : ''}
  <div class="actions">
   ${botoesRota(p, 'b')}
   ${repoe(p) ? `<button class="btn pri" style="font-size:15px;padding:11px" id="bRepor">Repor (contar o expositor) →</button>` : ''}
   ${podeComprar ? `<button class="btn car" style="font-size:15px;padding:11px" id="bComprar">Registrar venda →</button>` : ''}
   <button class="btn ${podeComprar ? '' : 'pri'}" id="bVisita">Registrar visita de prospecção</button>
   <button class="btn" id="bPerfil">Abrir perfil do negócio</button>
   ${gm ? `<a class="btn" href="${gm}" target="_blank" rel="noopener">Abrir no Google Maps ↗</a>` : ''}
   ${p.etapa === 'mapeado' ? `<button class="btn" id="bExMapa" style="color:#B8402A">Excluir do mapa</button>` : ''}</div>`;
  $('#bPerfil').onclick = () => abrirPerfil(p.id);
  if ($('#bExMapa')) $('#bExMapa').onclick = () => excluirDoMapa(p, () => { S.sel = null; desenhar(); painel(); });
  if ($('#bTraco')) $('#bTraco').onclick = () => { S.rotaDe = p.id; camadaTraco?.clearLayers(); mostrarRotaBox(`<b>${esc(p.nome)}</b> → toque no ponto de destino`, true); };
  $('#xSide').onclick = () => { S.sel = null; desenhar(); painel(); };
  db.ultimosPedidos(p.id, 500).then(todos => { const el = $('#sPeds'); if (!el || S.sel !== p.id) return; const ls = todos.slice(0, 5);
    el.insertAdjacentHTML('beforebegin', fluxoPedidos(todos, true));
    el.innerHTML = `<h3>Últimos pedidos</h3>${ls.length ? `<table class="peds">${ls.map(o => `<tr><td>${new Date(o.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</td><td><small style="color:var(--mute)">nº ${esc(o.bling_pedido_id || o.numero)}${o.tipo === 'abertura' ? ' · abertura' : ''}</small></td><td style="text-align:right"><b>${brl(o.valor)}</b></td></tr>`).join('')}</table>` : '<small style="color:var(--mute)">Nenhum pedido ainda.</small>'}`; }).catch(() => { const el = $('#sPeds'); if (el) el.remove(); });
  s.querySelectorAll('[data-pot]').forEach(b => b.onclick = () => salvarPdv(p.id, { potencial: +b.dataset.pot }, 'Potencial atualizado'));
  $('#sEt').onchange = e => mudarEtapa(p.id, e.target.value, () => { desenhar(); painel(); });
  if ($('#sCad')) $('#sCad').onchange = e => salvarPdv(p.id, { cadencia_dias: e.target.value ? +e.target.value : null }, 'Frequência atualizada');
  if ($('#bRota')) $('#bRota').onclick = () => porNaRotaHoje(p.id, false);
  if ($('#bReat')) $('#bReat').onclick = async () => { await porNaRotaHoje(p.id, true); desenhar(); painel(); };
  if ($('#bRepor')) $('#bRepor').onclick = () => { S.contando = p.id; S.repVolta = { aba: 'mapa', id: p.id }; irPara('reposicao'); };
  if ($('#bComprar')) $('#bComprar').onclick = () => { S.abPdv = p.id; S.vendaVolta = { aba: 'mapa', id: p.id }; irPara('abertura'); };
  $('#bVisita').onclick = () => visitaRapida(p);
  ligarPrior(p, () => { desenhar(); painel(); });
  ligarComentario(() => painel());
  s.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => revisar(p, b.dataset.rev));
}
async function atualizarUm(id) { const n = await db.carregarPdv(id); const i = S.pdvs.findIndex(x => x.id === id); if (i >= 0) S.pdvs[i] = n; else S.pdvs.push(n); if (S.aba === 'mapa' && !S.prosp) { desenhar(); painel(); } }
async function salvarPdv(id, patch, msg) { try { await db.atualizarPdv(id, patch); await atualizarUm(id); toast(msg); if (S.aba !== 'mapa') irPara(S.aba); } catch (e) { erro(e); } }
async function revisar(p, acao) {
  if (acao === 'retirar') return salvarPdv(p.id, { etapa: 'inativo' }, 'Expositor recolhido: PDV foi para Inativo');
  const hoje = new Date().toISOString().slice(0, 10);
  salvarPdv(p.id, { etapa: 'avaliacao', avaliacao_inicio: hoje, observacao: [p.observacao, (acao === 'preco' ? 'Preço renegociado' : 'Pedido mínimo aumentado') + ' em ' + dstr(new Date())].filter(Boolean).join(' · ') }, 'Nova avaliação iniciada');
}

/* ---------- cadastro ---------- */
const ETAPAS_CAD = ['mapeado', 'visitado', 'negociacao', 'avaliacao', 'ativo'];
function abrirCadastro(loc, etapaIni) {
  let pos = loc; if (etapaIni !== undefined) S.cadEtapa = etapaIni; const et0 = ETAPAS_CAD.includes(S.cadEtapa) ? S.cadEtapa : 'mapeado';
  modal(`<h3>${et0 === 'mapeado' ? 'Novo ponto de venda' : 'Novo negócio'}</h3>
  <label>Status</label><select id="cEt">${ETAPAS_CAD.map(k => `<option value="${k}" ${k === et0 ? 'selected' : ''}>${esc(etapa(k).n)}</option>`).join('')}</select>
  <label>Link do Google Maps</label><input id="cLink" placeholder="Cole o link do lugar no Google Maps">
  <div class="linkmsg" id="cMsg"></div>
  <label>ou Endereço</label><div class="row" style="gap:6px"><input id="cEnd" placeholder="Rua, número" style="flex:1"><button class="btn" id="cBuscaEnd">📍 Localizar</button></div>
  <div class="row" style="margin-top:8px"><button class="btn" id="cGps" style="flex:1">Usar minha localização</button><button class="btn" id="cMarcar" style="flex:1">Marcar no mapa</button></div>
  <label>Nome fantasia</label><input id="cNome">
  ${campoEmpresa('c')}
  <label>Canal</label>${campoCanal('cCanal', 'Minimercado')}
  ${campoContato()}
  <div class="row"><div style="flex:1"><label>Bairro</label><input id="cBairro"></div><div style="flex:1"><label>Cidade</label><input id="cCidade"></div></div>
  <label>Potencial (1 a 5)</label>${campoPot('cPot')}
  <label>Melhor horário para visita</label>${campoJanela('cj', {})}<input id="cHor" placeholder="Observação do horário (opcional)" style="width:100%;margin-top:6px">
  <label>Observação</label><textarea id="cObs" rows="2" placeholder="Quem decide, espaço no caixa…"></textarea>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="cSalvar">Salvar no funil</button></div>`);
  ligarCanal('cCanal'); ligarEmpresa('c', 'cNome'); ligarJanela('cj');
  const msg = (t, okk) => { const m = $('#cMsg'); m.style.display = 'block'; m.style.background = okk ? 'var(--bg-ok)' : 'var(--bg-warn)'; m.style.color = okk ? '#1F5A37' : '#7A4A16'; m.innerHTML = t; };
  let rua = '', linkG = null;
  const marcarPos = async (lng, lat, origem) => { pos = [lng, lat]; msg(`Localização ${origem}: ${lat.toFixed(5)}, ${lng.toFixed(5)} · buscando endereço…`, true);
    const g = await geoReverso(lat, lng); rua = g.rua;
    if (g.cidade) $('#cCidade').value = g.cidade; if (g.bairro && !$('#cBairro').value) $('#cBairro').value = g.bairro;
    const z = regiaoDe(lng, lat);
    msg(`Localização ${origem}: ${g.rua ? esc(g.rua) + ', ' : ''}${esc(g.bairro ? g.bairro + ', ' : '')}${esc(g.cidade || '')} · região ${z ? z + ' · ' + esc(regNome(z)) : esc(g.cidade || '—')}`, true); };
  if (pos) marcarPos(pos[0], pos[1], 'marcada no mapa');
  $('#cLink').oninput = () => {
    const u = $('#cLink').value.trim(); if (!u) return;
    const m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || u.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
    const nm = u.match(/\/place\/([^\/@]+)/);
    if (m) { linkG = /google\.[a-z.]+\/maps/.test(u) ? u.split('?')[0] : null; marcarPos(+m[2], +m[1], 'encontrada no link'); if (nm && !$('#cNome').value) $('#cNome').value = decodeURIComponent(nm[1].replace(/\+/g, ' ')); return; }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(u)) { msg('Link curto do celular. Ainda não consigo ler esse tipo (vem na próxima versão). Por enquanto: abra o link no navegador, copie o endereço completo da barra e cole aqui, ou use "Usar minha localização".', false); return; }
    msg('Não encontrei a localização nesse link.', false);
  };
  $('#cGps').onclick = () => { if (!navigator.geolocation) return msg('Este aparelho não informa a localização.', false); msg('Buscando localização…', true); navigator.geolocation.getCurrentPosition(g => marcarPos(g.coords.longitude, g.coords.latitude, 'do aparelho'), () => msg('Não foi possível pegar a localização. Verifique a permissão do navegador.', false), { enableHighAccuracy: true, timeout: 15000 }); };
  $('#cMarcar').onclick = () => { fecharModal(); if (S.aba !== 'mapa') irPara('mapa'); marcando = true; $('#hint').style.display = 'block'; };
  // endereço digitado livremente: localiza no mapa e mantém o texto que a pessoa escreveu
  const buscaEnd = async () => { const end = $('#cEnd').value.trim(); if (!end) return msg('Escreva a rua e o número.', false);
    msg('Localizando o endereço…', true); const cid = $('#cCidade').value.trim(), bai = $('#cBairro').value.trim();
    const g = await geocodificar(`${end}${bai ? ' - ' + bai : ''} - ${cid || 'Porto Alegre'}/RS`).catch(() => null);
    if (!g) return msg('Não achei esse endereço. Confira a rua e a cidade, ou use "Marcar no mapa".', false);
    pos = [g.lng, g.lat]; rua = end; if (g.cidade && !cid) $('#cCidade').value = g.cidade; if (g.bairro && !bai) $('#cBairro').value = g.bairro;
    const z = regiaoDe(g.lng, g.lat);
    msg(`Endereço localizado${g.precisao === 'exata' ? '' : g.precisao === 'rua' ? ' (pela rua, confira o pino depois)' : ' (só pela cidade: use Marcar no mapa)'}: ${esc(end)}, ${esc(g.bairro || '')} ${esc(g.cidade || '')} · região ${z ? z + ' · ' + esc(regNome(z)) : '—'}`, g.precisao !== 'cidade'); };
  $('#cBuscaEnd').onclick = buscaEnd; $('#cEnd').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); buscaEnd(); } };
  $('#cSalvar').onclick = async () => {
    if (!pos && $('#cEnd').value.trim()) await buscaEnd();
    if (!pos) return msg('Informe a localização: link, endereço, localização do aparelho ou marcar no mapa.', false);
    const nome = $('#cNome').value.trim(); if (!nome) return msg('Coloque o nome do estabelecimento.', false);
    const dup = duplicado(nome, pos[1], pos[0]);
    if (dup && !$('#cSalvar').dataset.forca) { msg(`Já existe <b>${esc(dup.nome)}</b> (${etapa(dup.etapa).n}) nesse lugar ou com esse nome. <a href="#" id="cAbrirDup">Abrir o perfil dele</a> ou toque em Salvar de novo para cadastrar mesmo assim.`, false); $('#cAbrirDup').onclick = e => { e.preventDefault(); fecharModal(); abrirPerfil(dup.id); }; $('#cSalvar').dataset.forca = 1; return; }
    $('#cSalvar').disabled = true;
    try {
      const cidade = $('#cCidade').value.trim() || null;
      const contato_id = await contatoDoForm(nome);
      const etC = $('#cEt').value || 'mapeado'; S.cadEtapa = null;
      const n = await db.criarPdv({ contato_id, etapa: etC, ...(etC === 'avaliacao' ? { avaliacao_inicio: hojeISO() } : {}), geo_precisao: 'exata', nome, ...lerEmpresa('c'), canal: lerCanal('cCanal'), endereco: rua || $('#cEnd').value.trim() || null, bairro: $('#cBairro').value.trim() || null, cidade, lng: pos[0], lat: pos[1], ...(linkG ? { link_maps: linkG } : {}), regiao: await garantirRegiao(pos[0], pos[1], cidade), potencial: +$('#cPot').value, observacao: $('#cObs').value.trim() || null, melhor_horario: $('#cHor').value.trim() || null, ...lerJanela('cj'), origem: $('#cLink').value ? 'link_maps' : 'manual', link_maps: $('#cLink').value.trim() || null, criado_por: S.eu.id });
      fecharModal(); await atualizarUm(n.id); S.sel = n.id; if (S.aba === 'mapa') { desenhar(); painel(); } if (S.aba === 'abertura') { S.abPdv = n.id; telaAbertura(); } if (S.aba === 'carteira') telaCarteira(); toast(nome + ' entrou no funil como ' + etapa(etC).n);
    } catch (e) { erro(e); $('#cSalvar').disabled = false; }
  };
}

/* ---------- prospects (OpenStreetMap) ---------- */
const OSM_TAGS = {
  Padaria: ['shop=bakery', 'shop=pastry', 'shop=confectionery'], Minimercado: ['shop=supermarket', 'shop=general', 'shop=deli'],
  Fruteira: ['shop=greengrocer'], 'Conveniência': ['shop=convenience', 'amenity=fuel'], Cafeteria: ['amenity=cafe'],
  Cantina: ['amenity=school', 'amenity=university', 'amenity=college'], Lancheria: ['amenity=fast_food'] };
function buscarProspects() {
  modal(`<h3>Buscar prospects na área do mapa</h3><p style="color:var(--soft);margin:0">Procura no OpenStreetMap os estabelecimentos do canal na área que está aparecendo no mapa e mostra os que ainda não estão no funil.</p>
  <label>Canal</label><select id="sCanal">${Object.keys(OSM_TAGS).map(c => `<option>${c}</option>`).join('')}</select>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn car" id="sGo">Buscar</button></div>`);
  $('#sGo').onclick = async () => {
    const canal = $('#sCanal').value, b = mapa.getBounds();
    if ((b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest()) > 0.01) { toast('Aproxime mais o mapa (um ou dois bairros) para buscar.'); return; }
    const bb = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
    const q = `[out:json][timeout:25];(${OSM_TAGS[canal].map(t => { const [k, v] = t.split('='); return `nwr["${k}"="${v}"](${bb});`; }).join('')});out center 80;`;
    $('#sGo').disabled = true; $('#sGo').textContent = 'Buscando…';
    try {
      const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      const j = await r.json(); fecharModal();
      const perto = (la, lo) => S.pdvs.some(p => p.lat && Math.abs(p.lat - la) < 0.0004 && Math.abs(p.lng - lo) < 0.0004);
      S.sugestoes = j.elements.map(e => ({ nome: e.tags?.name, lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon, canal, rua: [e.tags?.['addr:street'], e.tags?.['addr:housenumber']].filter(Boolean).join(', '), bairro: e.tags?.['addr:suburb'] || '' }))
        .filter(s => s.nome && s.lat && !perto(s.lat, s.lng));
      camadaSug.clearLayers();
      S.sugestoes.forEach((s, i) => L.marker([s.lat, s.lng], { icon: pino('#D08A3C', .9, true) })
        .bindPopup(`<b>${esc(s.nome)}</b><br>${esc(s.canal)}${s.rua ? ' · ' + esc(s.rua) : ''}<br><button class="btn pri" style="margin-top:6px" onclick="addSug(${i})">Adicionar ao funil</button>`).addTo(camadaSug));
      toast(S.sugestoes.length ? `${S.sugestoes.length} prospects encontrados. Toque num ponto tracejado para adicionar.` : 'Nenhum prospect novo nessa área para esse canal.');
    } catch (e) { erro(e); $('#sGo').disabled = false; }
  };
}
window.addSug = async i => {
  const s = S.sugestoes[i]; if (!s) return;
  const dup = duplicado(s.nome, s.lat, s.lng); if (dup) { mapa.closePopup(); toast(`Já existe ${dup.nome} no funil (${etapa(dup.etapa).n}).`); return; }
  S.sugestoes[i] = null;
  try { const g = await geoReverso(s.lat, s.lng); const n = await db.criarPdv({ nome: s.nome, canal: s.canal, endereco: s.rua || g.rua || null, bairro: s.bairro || g.bairro || null, cidade: g.cidade || null, lat: s.lat, lng: s.lng, regiao: await garantirRegiao(s.lng, s.lat, g.cidade), potencial: 3, origem: 'sugestao', criado_por: S.eu.id });
    mapa.closePopup(); S.sugestoes[i] = null; await atualizarUm(n.id); S.sel = n.id; desenhar(); painel(); toast(s.nome + ' adicionado ao funil'); } catch (e) { erro(e); }
};

/* =================== funil =================== */
const PROSP = ['mapeado', 'visitado', 'negociacao', 'perdido'];
const CART = ['avaliacao', 'ativo', 'risco', 'revisao', 'inativo'];
// dados fundamentais do cliente: cargo do contato, nome da pessoa, telefone e e-mail
function faltaContato(p) {
  if (!CART.includes(p.etapa)) return [];
  const c = S.contatos.find(x => x.id === p.contato_id) || {};
  const semPessoa = !c.nome || (/sem pessoa de contato/.test(c.observacao || '') && [c.empresa, p.nome].some(e => e && norm(e) === norm(c.nome)));
  return [semPessoa && 'pessoa de contato', !c.cargo && 'cargo', !(c.telefone || c.whatsapp || p.telefone) && 'telefone', !c.email && 'e-mail'].filter(Boolean);
}
const avisoContato = (p, curto) => { const f = faltaContato(p); return f.length ? `<span class="aviso-ct" title="Faltam dados do contato: ${f.join(', ')}">⚠️ ${curto ? 'Falta ' : 'Faltam dados: '}${f.join(', ')}</span>` : ''; };
const MOTIVOS = ['Sem potencial', 'Preço', 'Sem espaço', 'Concorrente', 'Dono não decide', 'Sem interesse', 'Outro'];
const ymd = x => !x ? '' : typeof x === 'object' && x.toISOString ? x.toISOString().slice(0, 10) : String(x).slice(0, 10);
const hojeISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const isoDe = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const diasNaEtapa = p => p.etapa_desde ? Math.floor((Date.now() - new Date(p.etapa_desde)) / DIA) : null;
function chipAcao(p) {
  if (!p.acao_data) return PROSP.slice(0, 3).includes(p.etapa) ? '<span class="chip-acao sem">sem próxima ação</span>' : '';
  const h = hojeISO(), d = ymd(p.acao_data), cls = d < h ? 'atrasada' : d === h ? 'hoje' : '';
  return `<span class="chip-acao ${cls}" title="${esc(p.acao_titulo)}">${d < h ? 'atrasada · ' : d === h ? 'hoje · ' : ''}${dstr(d + 'T12:00')} · ${esc(p.acao_titulo)}</span>`;
}
// toda mudança de etapa passa por aqui (Perdido pede motivo; Ganho abre o lançamento de venda)
async function mudarEtapa(id, nova, depois) {
  const p = S.pdvs.find(x => x.id === id); if (!p || p.etapa === nova) return depois && depois();
  if (nova === 'ganho') { S.abPdv = id; return irPara('abertura'); }
  if (nova === 'perdido') {
    const ret = isoDe(new Date(Date.now() + 60 * DIA));
    modal(`<h3>${esc(p.nome)} · perdido</h3><label>Motivo</label><select id="mMot">${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select>
    <input id="mOutro" placeholder="Descreva o motivo" style="display:none;margin-top:6px;width:100%">
    <label class="chkcomp chkbox"><input type="checkbox" id="mNao"><span><b>Não retornar</b><small>Não cria tarefa de retomada na agenda</small></span></label>
    <div id="mRetBox"><label>Retomar o contato em</label><input id="mRet" type="date" value="${ret}">
    <p style="color:var(--soft);font-size:12px;margin:6px 0 0">Cria uma tarefa na sua agenda para essa data.</p></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="mOk">Marcar como perdido</button></div>`);
    const naoRet = v => { $('#mNao').checked = v; $('#mRetBox').style.display = v ? 'none' : 'block'; };
    $('#mNao').onchange = () => naoRet($('#mNao').checked); naoRet($('#mMot').value === 'Sem potencial');
    $('#mMot').onchange = () => { $('#mOutro').style.display = $('#mMot').value === 'Outro' ? 'block' : 'none'; if ($('#mMot').value === 'Sem potencial') naoRet(true); };
    $('#mOk').onclick = async () => {
      const mot = $('#mMot').value === 'Outro' ? ($('#mOutro').value.trim() || 'Outro') : $('#mMot').value, ret = $('#mNao').checked ? null : ($('#mRet').value || null);
      try { await db.atualizarPdv(id, { etapa: 'perdido', motivo_perda: mot, retomar_em: ret, etapa_motivo: 'Perdido: ' + mot });
        if (ret) await db.criarTarefa({ titulo: 'Retomar contato com ' + p.nome, tipo: 'visita', data: ret, pdv_id: id, contato_id: p.contato_id || null, descricao: 'Perdido por: ' + mot, dono: S.eu.id });
        fecharModal(); await atualizarUm(id); toast(`${p.nome} marcado como perdido (${mot})${ret ? '' : ' · sem retorno'}`); depois && depois(); } catch (e) { erro(e); } };
    return;
  }
  try { await db.atualizarPdv(id, { etapa: nova, ...(p.etapa === 'perdido' ? { motivo_perda: null, retomar_em: null } : {}) }); await atualizarUm(id); toast('Etapa: ' + etapa(nova).n + (nova === 'fechado' ? ' · saiu do mapa' : '')); if (nova === 'fechado' && S.sel === id) S.sel = null; depois && depois(); } catch (e) { erro(/fechado/.test(e.message) ? new Error('Rode o 023_fechado_classe_d.sql no Supabase') : e); }
}
window.mudarEtapa = mudarEtapa;
// põe qualquer cliente (até inativo ou perdido) na sua rota de hoje; "reativar" também volta a etapa para Ativo
async function porNaRotaHoje(id, reativar) {
  const p = S.pdvs.find(x => x.id === id); if (!p) return;
  try {
    if (reativar && !['ativo', 'avaliacao', 'revisao'].includes(p.etapa)) { await db.atualizarPdv(id, { etapa: 'ativo', etapa_motivo: 'Reativado: voltou para a rota', ...(p.etapa === 'perdido' ? { motivo_perda: null, retomar_em: null } : {}) }); await atualizarUm(id); }
    const d = hojeISO(), r = await db.obterRota(d, S.eu.id).catch(() => null) || { data: d, motorista: S.eu.id, tipo: 'reposicao', inicio: '08:00', fim: '18:00', incluir: [], tirar: [], paradas: [] };
    await db.salvarRota({ data: d, motorista: S.eu.id, tipo: r.tipo || 'reposicao', inicio: r.inicio || '08:00', fim: r.fim || '18:00', incluir: [...new Set([...(r.incluir || []), id])], tirar: (r.tirar || []).filter(x => x !== id), paradas: r.paradas || [] });
    if (reativar) { const ad = { ...(S.base.regras.adiados || {}) }; if (ad[id]) { delete ad[id]; await db.salvarRegra('adiados', ad).catch(() => { }); S.base.regras.adiados = ad; } }
    toast(`${p.nome} ${reativar ? 'reativado e ' : ''}entrou na sua rota de hoje`);
  } catch (e) { erro(/motorista|rotas_pkey|null value/.test(e.message || '') ? new Error('Rode o 031_rota_por_pessoa.sql no Supabase para salvar a rota') : e); }
}
const botoesRota = (p, px) => `<div class="row" style="gap:6px;flex-wrap:wrap">${!['ativo', 'avaliacao', 'revisao'].includes(p.etapa) && !['mapeado', 'visitado', 'negociacao'].includes(p.etapa) ? `<button class="btn car" id="${px}Reat" style="flex:1">♻ Reativar e pôr na rota de hoje</button>` : ''}<button class="btn" id="${px}Rota" style="flex:1">➕ Pôr na rota de hoje</button></div>`;

// "Em risco" automático e recuperação
async function avaliarRisco() {
  const meta = regraAval().meta_minima_sellout, mud = [];
  for (const p of S.pdvs.filter(x => x.etapa === 'ativo' || x.etapa === 'risco')) {
    const so = (S.sellouts[p.id] || []).map(s => s.sellout), ult2 = so.slice(-2), a = atraso(p) ?? 0;
    const media = so.length >= 5 ? so.slice(-7, -1).reduce((x, y) => x + y, 0) / so.slice(-7, -1).length : null;
    let motivo = null;
    if (ult2.length === 2 && ult2.every(v => v < meta)) motivo = `Risco automático: 2 sell-outs seguidos abaixo de ${meta} un.`;
    else if (a > 7) motivo = `Risco automático: reposição atrasada há ${a} dias`;
    else if (media && so[so.length - 1] < media * 0.5) motivo = `Risco automático: sell-out caiu para menos da metade da média (${dec(media)} un.)`;
    if (p.etapa === 'ativo' && motivo) mud.push([p, 'risco', motivo]);
    if (p.etapa === 'risco' && !motivo && ult2.length === 2 && ult2.every(v => v >= meta)) mud.push([p, 'ativo', 'Recuperou o giro']);
  }
  for (const [p, e, m] of mud) { try { await db.atualizarPdv(p.id, { etapa: e, etapa_motivo: m }); } catch (er) { console.warn(er); } }
  if (mud.length) { await recarregar(); toast(mud.map(([p, e]) => `${p.nome} → ${etapa(e).n}`).join(' · ')); }
}

let funilVisao = 'prospeccao', funilFiltro = { reg: '', canal: '', hoje: false }, etapasHist = null;
const metas = () => ({ visitas_dia: 15, vendas_dia: 2, valor_mes: 10000, cadastros_semana: 30, ...(S.base.regras.metas || {}) });
let periodo = { k: 'mes', de: '', ate: '' };
function intervalo() {
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0); const iso = isoDe;
  if (periodo.k === 'hoje') return { de: iso(hoje), ate: iso(hoje), n: 'Hoje' };
  if (periodo.k === 'semana') { const i = inicioSemana(hoje); return { de: iso(new Date(+i + 12 * 36e5)), ate: iso(new Date(+i + 6 * DIA + 12 * 36e5)), n: 'Esta semana' }; }
  if (periodo.k === 'mes') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1, 12)), ate: iso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 12)), n: 'Este mês' };
  if (periodo.k === 'mespassado') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1, 12)), ate: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0, 12)), n: 'Mês passado' };
  if (periodo.k === '3meses') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1, 12)), ate: iso(hoje), n: 'Últimos 3 meses' };
  return { de: periodo.de || iso(hoje), ate: periodo.ate || iso(hoje), n: 'Personalizado' };
}
// dias de trabalho no intervalo (segunda a sábado), até hoje
function diasPeriodo(de, ate) { let n = 0; for (let d = new Date(de + 'T12:00'); d <= new Date(ate + 'T12:00'); d = new Date(+d + DIA)) if (d.getDay() !== 0) n++; return Math.max(n, 1); }
function diasTrab(de, ate) { let n = 0; const fim = new Date(Math.min(new Date(ate + 'T12:00'), Date.now())); for (let d = new Date(de + 'T12:00'); d <= fim; d = new Date(+d + DIA)) if (d.getDay() !== 0) n++; return Math.max(n, 1); }
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const barra = (v, meta) => `<div class="mbar"><i style="width:${Math.min(100, pct(v, meta))}%;background:${v >= meta ? '#2F7D4E' : '#D08A3C'}"></i></div>`;

async function telaFunil() {
  $('#main').innerHTML = '<section class="view on"><div class="loading">Carregando o CRM…</div></section>';
  const per = intervalo(), h = hojeISO(), de = per.de < h ? per.de : h, ate = per.ate > h ? per.ate : h;
  let vis = [], aber = [];
  try { [vis, aber] = await Promise.all([db.visitasEntre(de, ate, 'prospeccao'), db.pedidosEntre(de, ate, 'abertura')]); } catch (e) { console.warn(e); }
  const noPer = x => { const d = ymd(isoDe(new Date(x))); return d >= per.de && d <= per.ate; }, ehHoje = x => isoDe(new Date(x)) === h;
  const cols = [...(funilVisao === 'prospeccao' ? PROSP : CART), 'fechado'], M = metas(); // fechado: coluna própria nos dois funis
  const filtra = p => p && (!funilFiltro.reg || p.regiao === funilFiltro.reg) && (!funilFiltro.canal || p.canal === funilFiltro.canal) && (!funilFiltro.hoje || (p.acao_data && ymd(p.acao_data) <= h));
  const pdv = id => S.pdvs.find(p => p.id === id);
  const visPer = vis.filter(v => noPer(v.em) && filtra(pdv(v.pdv_id))), visHoje = vis.filter(v => ehHoje(v.em)).length;
  const visitadosPer = [...new Set(visPer.map(v => v.pdv_id))];
  const jaGanhou = p => p && (CART.includes(p.etapa) || p.avaliacao_inicio);
  const conv = visitadosPer.length ? pct(visitadosPer.filter(id => jaGanhou(pdv(id))).length, visitadosPer.length) : null;
  const ganPer = aber.filter(o => noPer(o.criado_em) && filtra(pdv(o.pdv_id))), ganHoje = aber.filter(o => ehHoje(o.criado_em)).length;
  const valorPer = ganPer.reduce((s, o) => s + Number(o.valor), 0), dt = diasTrab(per.de, per.ate);
  const valorMes = aber.filter(o => isoDe(new Date(o.criado_em)).slice(0, 7) === h.slice(0, 7)).reduce((s, o) => s + Number(o.valor), 0);
  const iniSem = isoDe(new Date(+inicioSemana(new Date()) + 12 * 36e5));
  // metas do período: diárias em "Hoje", semanais em "Semana", mensais em "Mês"; nos outros, proporcionais aos dias de trabalho
  const dp = diasPeriodo(per.de, per.ate), rot = { hoje: 'do dia', semana: 'da semana', mes: 'do mês', mespassado: 'do mês' }[periodo.k] || `do período (${dp} dias)`;
  const mVis = Math.round(M.visitas_dia * dp), mVen = Math.round(M.vendas_dia * dp);
  const mCad = periodo.k === 'semana' ? M.cadastros_semana : Math.round(M.cadastros_semana / 6 * dp);
  const mVal = ['mes', 'mespassado'].includes(periodo.k) ? M.valor_mes : Math.round(M.valor_mes / 26 * dp);
  const cadPer = S.pdvs.filter(p => p.criado_em && noPer(p.criado_em) && filtra(p)).length, cadSem = S.pdvs.filter(p => p.criado_em && isoDe(new Date(p.criado_em)) >= iniSem).length;
  const canais = [...new Set(S.pdvs.map(p => p.canal).filter(Boolean))].sort();
  const per_ = ['hoje', 'Hoje', 'semana', 'Semana', 'mes', 'Mês', 'mespassado', 'Mês passado', '3meses', 'Últimos 3 meses', 'custom', 'Personalizado'];
  $('#main').innerHTML = `<section class="view on" style="flex-direction:column;height:100%">
  <div class="funilbar"><div class="seg"><button data-v="prospeccao" class="${funilVisao === 'prospeccao' ? 'on' : ''}">Prospecção</button><button data-v="carteira" class="${funilVisao === 'carteira' ? 'on' : ''}">Carteira</button></div>
   <div class="seg per">${[...Array(per_.length / 2)].map((_, i) => `<button data-p="${per_[i * 2]}" class="${periodo.k === per_[i * 2] ? 'on' : ''}">${per_[i * 2 + 1]}</button>`).join('')}</div>
   ${periodo.k === 'custom' ? `<input type="date" id="pDe" value="${per.de}"> até <input type="date" id="pAte" value="${per.ate}">` : ''}
   <select id="ffReg"><option value="">Todas as regiões</option>${S.base.regioes.map(r => `<option value="${r.codigo}" ${funilFiltro.reg === r.codigo ? 'selected' : ''}>${r.codigo} · ${esc(r.nome)}</option>`).join('')}</select>
   <select id="ffCanal"><option value="">Todos os canais</option>${canais.map(c => `<option ${funilFiltro.canal === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
   <label class="regchk"><input type="checkbox" id="ffHoje" ${funilFiltro.hoje ? 'checked' : ''}> Ações de hoje e atrasadas</label></div>
  ${funilVisao === 'prospeccao' ? `<div class="funilnum">
   <div><small>Visitas · ${per.n.toLowerCase()}</small><b>${visPer.length} <span class="meta">/ ${mVis}</span></b><small>meta ${rot}</small>${barra(visPer.length, mVis)}</div>
   <div><small>Conversão visitado → ganho</small><b>${conv === null ? '—' : conv + '%'}</b><small>${visitadosPer.length} negócios visitados no período</small></div>
   <div><small>Vendas (ganhos) · ${per.n.toLowerCase()}</small><b>${ganPer.length} <span class="meta">/ ${mVen}</span></b><small>meta ${rot}</small>${barra(ganPer.length, mVen)}</div>
   <div><small>Novos pontos cadastrados · ${per.n.toLowerCase()}</small><b>${cadPer} <span class="meta">/ ${mCad}</span></b><small>meta ${rot}</small>${barra(cadPer, mCad)}</div>
   <div><small>Valor em vendas · ${per.n.toLowerCase()}</small><b>${brl(valorPer)}</b><small>meta ${rot}: ${brl(mVal)}</small>${barra(valorPer, mVal)}</div></div>`
    : `<div class="funilnum"><div><small>Em avaliação</small><b>${S.pdvs.filter(p => p.etapa === 'avaliacao').length}</b></div><div><small>Ativos</small><b>${S.pdvs.filter(p => p.etapa === 'ativo').length}</b></div><div><small>Em risco</small><b>${S.pdvs.filter(p => p.etapa === 'risco').length}</b></div><div><small>Reposições pendentes</small><b>${repPendentes().length}</b></div><div style="flex:2"><small>Regra de risco automático</small><b style="font-size:13px;font-family:inherit">2 sell-outs abaixo de ${regraAval().meta_minima_sellout} un., reposição atrasada > 7 dias ou queda > 50% da média</b></div></div>`}
  <div class="kanban" id="kanban" style="flex:1;min-height:0"></div></section>`;
  const card = (p, e, extra = '') => { const dias = diasNaEtapa(p), parado = p.etapa === 'negociacao' && dias > 7;
    const so = (S.sellouts[p.id] || []).slice(-1)[0];
    return `<div class="card ${parado ? 'parado' : ''}" draggable="true" data-id="${p.id}" style="border-left-color:${e.c}"><div class="cardtop"><b>${esc(p.nome)}</b><button class="mini" data-tarefa="${p.id}" title="Criar tarefa">+ tarefa</button></div><small>${esc(p.canal || '')} · ${p.regiao || '—'} · ${'★'.repeat(p.potencial || 0)}</small>
    <div class="cardmeta"><span>${dias === null ? '' : `${dias === 0 ? 'hoje' : 'há ' + dias + (dias === 1 ? ' dia' : ' dias')} na etapa`}</span>${p.etapa === 'perdido' && p.motivo_perda ? `<span>· ${esc(p.motivo_perda)}${p.retomar_em ? ' · retomar ' + dstr(ymd(p.retomar_em) + 'T12:00') : ''}</span>` : ''}${CART.includes(p.etapa) && so ? `<span>· último sell-out ${so.sellout} un.</span>` : ''}${CART.includes(p.etapa) && p.proxima_reposicao ? `<span>· reposição ${prazoTxt(p)}</span>` : ''}</div>${avisoContato(p, true)}${extra}${chipAcao(p)}</div>`; };
  const ord = (a, b) => (ymd(a.acao_data) || '9').localeCompare(ymd(b.acao_data) || '9') || (b.potencial || 0) - (a.potencial || 0);
  let html = cols.map(k => { const e = etapa(k), its = S.pdvs.filter(p => p.etapa === k && filtra(p)).sort(ord);
    let corpo = its.slice(0, 100).map(p => card(p, e)).join(''), cab = `${its.length}`;
    if (k === 'visitado') {
      // cópia de quem foi visitado no período e já andou para outra etapa
      const ultima = {}; visPer.forEach(v => { if (!ultima[v.pdv_id] || v.em > ultima[v.pdv_id]) ultima[v.pdv_id] = v.em; });
      const copias = Object.keys(ultima).map(pdv).filter(p => p && p.etapa !== 'visitado');
      cab = `${its.length} · ${visPer.length} visita${visPer.length === 1 ? '' : 's'} no período`;
      if (copias.length) corpo += `<p class="dica" style="color:var(--mute)">Visitados no período que já avançaram</p>` + copias.map(p => `<div class="card copia" data-id="${p.id}" style="border-left-color:${etapa(p.etapa).c}"><b>${esc(p.nome)}</b><small>visitado ${dstr(ultima[p.id])} · agora: <span style="color:${etapa(p.etapa).c};font-weight:700">${etapa(p.etapa).n}</span></small></div>`).join('');
    }
    return `<div class="col" data-et="${k}"><h4><span><i class="dot" style="background:${e.c}"></i> ${e.n}</span><span>${cab}</span></h4><div class="list">${corpo}</div></div>`; }).join('');
  if (funilVisao === 'prospeccao') html = html.replace('<div class="col" data-et="perdido">', `<div class="col ganho" data-et="ganho"><h4><span><i class="dot" style="background:#2F7D4E"></i> Venda (ganho)</span><span>${ganPer.length} · ${brl(valorPer)}</span></h4><div class="list"><p class="dica">Arraste um negócio para cá para lançar a primeira venda.</p>${ganPer.map(o => { const p = pdv(o.pdv_id); return p ? `<div class="card" data-id="${p.id}" style="border-left-color:var(--t-ok)"><b>${esc(p.nome)}</b><small>venda em ${dstr(o.criado_em)} · ${brl(o.valor)} · agora: ${etapa(p.etapa).n}</small></div>` : ''; }).join('')}</div></div><div class="col" data-et="perdido">`);
  $('#kanban').innerHTML = html;
  let arr = null;
  document.querySelectorAll('.funilbar .seg:not(.per) button').forEach(b => b.onclick = () => { funilVisao = b.dataset.v; telaFunil(); });
  document.querySelectorAll('.funilbar .per button').forEach(b => b.onclick = () => { if (b.dataset.p === 'custom' && !periodo.de) { const x = intervalo(); periodo.de = x.de; periodo.ate = x.ate; } periodo.k = b.dataset.p; telaFunil(); });
  if ($('#pDe')) { $('#pDe').onchange = e => { periodo.de = e.target.value; telaFunil(); }; $('#pAte').onchange = e => { periodo.ate = e.target.value; telaFunil(); }; }
  $('#ffReg').onchange = e => { funilFiltro.reg = e.target.value; telaFunil(); };
  $('#ffCanal').onchange = e => { funilFiltro.canal = e.target.value; telaFunil(); };
  $('#ffHoje').onchange = e => { funilFiltro.hoje = e.target.checked; telaFunil(); };
  document.querySelectorAll('#kanban [data-tarefa]').forEach(b => b.onclick = e => { e.stopPropagation(); const p = pdv(b.dataset.tarefa); modalTarefa({ data: h, pdv_id: p.id, contato_id: p.contato_id }, telaFunil); });
  document.querySelectorAll('#kanban .card').forEach(c => { c.ondragstart = () => arr = c.dataset.id; c.onclick = () => abrirPerfil(c.dataset.id); });
  document.querySelectorAll('#kanban .col').forEach(c => { c.ondragover = e => { e.preventDefault(); c.classList.add('drop'); }; c.ondragleave = () => c.classList.remove('drop');
    c.ondrop = e => { e.preventDefault(); c.classList.remove('drop'); if (arr) mudarEtapa(arr, c.dataset.et, telaFunil); arr = null; }; });
}

/* =================== agenda =================== */
const TIPOS = { visita: { n: 'Visita', c: '#D08A3C' }, ligacao: { n: 'Ligação', c: '#3F6FA8' }, whatsapp: { n: 'WhatsApp', c: '#2F7D4E' }, reuniao: { n: 'Reunião', c: '#6B4FA0' }, outro: { n: 'Outro', c: '#8C7E74' } };
const H0 = 7, H1 = 21, HPX = 56;
let semanaIni = null;
function inicioSemana(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
async function telaAgenda() {
  if (!semanaIni) semanaIni = inicioSemana(new Date());
  const dias = [...Array(7)].map((_, i) => new Date(+semanaIni + i * DIA + 12 * 36e5)), de = isoDe(dias[0]), ate = isoDe(dias[6]), h = hojeISO();
  $('#main').innerHTML = '<section class="view on"><div class="loading">Carregando a agenda…</div></section>';
  let tar, atras; try { [tar, atras] = await Promise.all([db.listarTarefas(S.eu.id, de, ate), db.tarefasAbertasAte(S.eu.id, isoDe(new Date(Date.now() - DIA)))]); } catch (e) { return erro(e); }
  S.tarefas = Object.fromEntries([...tar, ...atras].map(t => [t.id, t]));
  const nomePdv = id => (S.pdvs.find(p => p.id === id) || {}).nome, nomeCt = id => (S.contatos.find(c => c.id === id) || {}).nome;
  const sub = t => [nomePdv(t.pdv_id), nomeCt(t.contato_id)].filter(Boolean).map(esc).join(' · ');
  const mesTxt = dias[0].toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) + ' – ' + dias[6].toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  const bloco = t => { const [hh, mm] = String(t.hora).split(':').map(Number), top = (hh - H0) * HPX + mm / 60 * HPX, alt = Math.max(26, (t.duracao_min || 30) / 60 * HPX - 3), c = TIPOS[t.tipo]?.c || '#8C7E74';
    return `<div class="tarefa ${t.concluida ? 'feita' : ''}" draggable="true" data-t="${t.id}" style="top:${Math.max(0, top)}px;height:${alt}px;border-left-color:${c};background:${c}22"><b>${String(t.hora).slice(0, 5)} ${esc(t.titulo)}</b>${alt > 34 && sub(t) ? `<small>${sub(t)}</small>` : ''}</div>`; };
  const agora = new Date(), linhaAgora = (agora.getHours() + agora.getMinutes() / 60 - H0) * HPX;
  $('#main').innerHTML = `<section class="view on"><div class="agenda">
  <div class="agtopo"><div class="row"><button class="btn" id="agAnt">‹</button><button class="btn" id="agHoje">Hoje</button><button class="btn" id="agProx">›</button><h2>${mesTxt}</h2></div>
   <div class="row"><span class="leg">${Object.values(TIPOS).map(t => `<i style="background:${t.c}"></i>${t.n}`).join('')}</span><button class="btn pri" id="agNova">+ Nova tarefa</button></div></div>
  ${atras.length ? `<div class="atrasadas"><b>Atrasadas (${atras.length})</b>${atras.map(t => `<span class="tchip" data-t="${t.id}" style="border-color:${TIPOS[t.tipo]?.c}">${dstr(ymd(t.data) + 'T12:00')} · ${esc(t.titulo)}</span>`).join('')}</div>` : ''}
  <div class="cal"><div class="calhead"><div></div>${dias.map(d => { const iso = isoDe(d); return `<div class="${iso === h ? 'hoje' : ''}"><small>${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</small><b>${d.getDate()}</b></div>`; }).join('')}</div>
   <div class="caldia"><div class="lbl">sem horário</div>${dias.map(d => { const iso = isoDe(d); return `<div class="slotdia" data-dia="${iso}">${tar.filter(t => ymd(t.data) === iso && !t.hora).map(t => `<span class="tchip ${t.concluida ? 'feita' : ''}" draggable="true" data-t="${t.id}" style="border-color:${TIPOS[t.tipo]?.c}">${esc(t.titulo)}</span>`).join('')}</div>`; }).join('')}</div>
   <div class="calcorpo"><div class="horas">${[...Array(H1 - H0)].map((_, i) => `<div style="height:${HPX}px">${String(H0 + i).padStart(2, '0')}:00</div>`).join('')}</div>
    ${dias.map(d => { const iso = isoDe(d); return `<div class="coldia ${iso === h ? 'hoje' : ''}" data-dia="${iso}" style="height:${(H1 - H0) * HPX}px">${[...Array(H1 - H0)].map(() => `<div class="hr" style="height:${HPX}px"></div>`).join('')}${iso === h && linhaAgora > 0 && linhaAgora < (H1 - H0) * HPX ? `<div class="agora" style="top:${linhaAgora}px"></div>` : ''}${tar.filter(t => ymd(t.data) === iso && t.hora).map(bloco).join('')}</div>`; }).join('')}</div></div></div></section>`;
  $('#agAnt').onclick = () => { semanaIni = new Date(+semanaIni - 7 * DIA); telaAgenda(); };
  $('#agProx').onclick = () => { semanaIni = new Date(+semanaIni + 7 * DIA); telaAgenda(); };
  $('#agHoje').onclick = () => { semanaIni = inicioSemana(new Date()); telaAgenda(); };
  $('#agNova').onclick = () => modalTarefa({ data: h });
  document.querySelectorAll('[data-t]').forEach(el => { el.onclick = e => { e.stopPropagation(); modalTarefa(S.tarefas[el.dataset.t]); }; el.ondragstart = e => { e.dataTransfer.setData('text', el.dataset.t); }; });
  const horaDoY = (col, y) => { const min = Math.max(0, Math.round((y / HPX * 60) / 15) * 15) + H0 * 60; return `${String(Math.min(H1 - 1, Math.floor(min / 60))).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; };
  document.querySelectorAll('.coldia').forEach(col => {
    col.onclick = e => { if (e.target.closest('[data-t]')) return; const r = col.getBoundingClientRect(); modalTarefa({ data: col.dataset.dia, hora: horaDoY(col, e.clientY - r.top) }); };
    col.ondragover = e => e.preventDefault();
    col.ondrop = async e => { e.preventDefault(); const id = e.dataTransfer.getData('text'), r = col.getBoundingClientRect(); try { await db.atualizarTarefa(id, { data: col.dataset.dia, hora: horaDoY(col, e.clientY - r.top) }); telaAgenda(); } catch (er) { erro(er); } };
  });
  document.querySelectorAll('.slotdia').forEach(s => { s.onclick = e => { if (!e.target.closest('[data-t]')) modalTarefa({ data: s.dataset.dia }); }; s.ondragover = e => e.preventDefault();
    s.ondrop = async e => { e.preventDefault(); try { await db.atualizarTarefa(e.dataTransfer.getData('text'), { data: s.dataset.dia, hora: null }); telaAgenda(); } catch (er) { erro(er); } }; });
}
function modalTarefa(t = {}, depois) {
  const novo = !t.id;
  modal(`<h3>${novo ? 'Nova tarefa' : 'Tarefa'}</h3>
  <label>O que fazer</label><input id="tTit" value="${esc(t.titulo || '')}" placeholder="Ex.: voltar com amostra, ligar para o dono">
  <label>Tipo</label><div class="pay" id="tTipo">${Object.entries(TIPOS).map(([k, v]) => `<label><input type="radio" name="tt" value="${k}" ${(t.tipo || 'visita') === k ? 'checked' : ''}> ${v.n}</label>`).join('')}</div>
  <div class="row"><div style="flex:1"><label>Data</label><input id="tData" type="date" value="${ymd(t.data) || hojeISO()}"></div><div style="flex:1"><label>Hora</label><input id="tHora" type="time" value="${t.hora ? String(t.hora).slice(0, 5) : ''}"></div><div style="flex:1"><label>Duração</label><select id="tDur">${[15, 30, 45, 60, 90, 120].map(m => `<option value="${m}" ${(t.duracao_min || 30) === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></div></div>
  <label>Negócio (opcional)</label><input id="tPdv" list="lPdv" value="${esc((S.pdvs.find(p => p.id === t.pdv_id) || {}).nome || '')}" placeholder="Digite para buscar"><datalist id="lPdv">${S.pdvs.map(p => `<option value="${esc(p.nome)}">`).join('')}</datalist>
  <label>Contato (opcional)</label><input id="tCt" list="lCt" value="${esc((S.contatos.find(c => c.id === t.contato_id) || {}).nome || '')}" placeholder="Digite para buscar"><datalist id="lCt">${S.contatos.map(c => `<option value="${esc(c.nome)}">`).join('')}</datalist>
  <label>Detalhes</label><textarea id="tDesc" rows="2">${esc(t.descricao || '')}</textarea>
  <div class="row" style="margin-top:14px;justify-content:space-between;flex-wrap:wrap">
   <div class="row">${novo ? '' : `<button class="btn" id="tDel" style="color:var(--t-bad)">Excluir</button><button class="btn" id="tFeita">${t.concluida ? 'Reabrir' : '✓ Concluir'}</button>`}</div>
   <div class="row"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="tOk">Salvar</button></div></div>`);
  const fim = () => { fecharModal(); if (depois) depois(); else if (S.aba === 'agenda') telaAgenda(); else if (S.aba === 'perfil') telaPerfil(); else if (S.aba === 'funil') telaFunil(); };
  const pegarIds = () => { const pn = norm($('#tPdv').value), cn = norm($('#tCt').value);
    const pdv = pn ? S.pdvs.find(p => norm(p.nome) === pn) : null, ct = cn ? S.contatos.find(c => norm(c.nome) === cn) : null;
    if (pn && !pdv) throw new Error('Negócio não encontrado: escolha um da lista ou deixe em branco');
    if (cn && !ct) throw new Error('Contato não encontrado: escolha um da lista ou deixe em branco');
    return { pdv_id: pdv?.id || null, contato_id: ct?.id || pdv?.contato_id || null }; };
  $('#tOk').onclick = async () => {
    const titulo = $('#tTit').value.trim(); if (!titulo) return toast('Escreva o que fazer');
    try { const o = { titulo, tipo: document.querySelector('input[name=tt]:checked').value, data: $('#tData').value, hora: $('#tHora').value || null, duracao_min: +$('#tDur').value, descricao: $('#tDesc').value.trim() || null, ...pegarIds() };
      if (novo) await db.criarTarefa({ ...o, dono: S.eu.id }); else await db.atualizarTarefa(t.id, o);
      if (o.pdv_id) await atualizarUm(o.pdv_id); if (t.pdv_id && t.pdv_id !== o.pdv_id) await atualizarUm(t.pdv_id);
      toast('Tarefa salva'); fim(); } catch (e) { toast(e.message); } };
  if (!novo) {
    $('#tFeita').onclick = async () => { try { await db.atualizarTarefa(t.id, { concluida: !t.concluida, concluida_em: t.concluida ? null : new Date().toISOString() }); if (t.pdv_id) await atualizarUm(t.pdv_id); toast(t.concluida ? 'Tarefa reaberta' : 'Tarefa concluída'); fim(); } catch (e) { erro(e); } };
    $('#tDel').onclick = async () => { try { await db.excluirTarefa(t.id); if (t.pdv_id) await atualizarUm(t.pdv_id); toast('Tarefa excluída'); fim(); } catch (e) { erro(e); } };
  }
}
window.modalTarefa = modalTarefa;
function listaTarefas(ts, vazio) {
  const h = hojeISO();
  return ts.length ? ts.map(t => `<div class="trow ${t.concluida ? 'feita' : ''}" data-tid="${t.id}"><i style="background:${TIPOS[t.tipo]?.c}"></i><div style="flex:1"><b>${esc(t.titulo)}</b><br><small style="color:${!t.concluida && ymd(t.data) < h ? '#B8402A' : 'var(--mute)'}">${dstr(ymd(t.data) + 'T12:00')}${t.hora ? ' · ' + String(t.hora).slice(0, 5) : ''} · ${TIPOS[t.tipo]?.n || ''}${t.concluida ? ' · concluída' : !t.concluida && ymd(t.data) < h ? ' · atrasada' : ''}</small></div></div>`).join('') : `<p class="empty" style="padding:6px 0">${vazio}</p>`;
}

/* =================== carteira =================== */
let ord = { k: 'nome', d: 1 };
function telaCarteira() {
  const RP = {}; let RU = S.rupCache || {};
  $('#main').innerHTML = `<section class="view on"><div class="tablewrap"><div class="toolbar"><input id="q" placeholder="Buscar PDV…" style="width:240px"><select id="tEt"><option value="">Todas as etapas</option>${ETAPAS.map(e => `<option value="${e.k}">${e.n}</option>`).join('')}</select><select id="tPr"><option value="">Toda prioridade de reativação</option>${Object.entries(PRIOR).map(([k, x]) => `<option value="${k}">Reativar · ${x.n}</option>`).join('')}<option value="-">Sem prioridade definida</option></select><span id="tN" style="color:var(--mute)"></span><button class="btn pri" id="tNovo" style="margin-left:auto">+ Novo negócio</button></div><table id="tbl"></table></div></section>`;
  const cols = [['nome', 'PDV'], ['regiao', 'Região'], ['canal', 'Canal'], ['etapa', 'Etapa'], ['classe', 'Classe'], ['potencial', 'Potencial'], ['so', 'Sell-out médio'], ['rup', 'Ruptura'], ['ultima_compra', 'Última compra'], ['proxima_reposicao', 'Próx. reposição'], ['pr', 'Reativar']];
  const desenhaT = () => {
    const q = $('#q').value.toLowerCase(), et = $('#tEt').value, pr = $('#tPr').value;
    let ds = S.pdvs.filter(p => (!et || p.etapa === et) && (!pr || (pr === '-' ? !(REATIVAR.includes(p.etapa) && p.prioridade_reativacao) : REATIVAR.includes(p.etapa) && p.prioridade_reativacao === pr)) && (!q || p.nome.toLowerCase().includes(q))).map(p => { const s = (S.sellouts[p.id] || []).slice(-6), rp = RP[p.id]; return { ...p, so: s.length ? s.reduce((a, x) => a + x.sellout, 0) / s.length : rp ? rp.un / rp.n : null, soPed: !s.length && !!rp, ultima_compra: rp?.ult || null, rup: RU[p.id] ? RU[p.id].r : null, rupI: RU[p.id], pr: REATIVAR.includes(p.etapa) ? PRIOR[p.prioridade_reativacao]?.v || 0 : 0 }; });
    ds.sort((a, b) => { const nul = ord.k === 'rup' ? -1 : '', x = a[ord.k] ?? nul, y = b[ord.k] ?? nul; return (x > y ? 1 : x < y ? -1 : 0) * ord.d; });
    $('#tN').textContent = ds.length + ' pontos';
    $('#tbl').innerHTML = `<tr>${cols.map(([k, n]) => `<th data-k="${k}">${n}${ord.k === k ? (ord.d > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr>` + ds.map(p => `<tr data-id="${p.id}" style="cursor:pointer"><td><b>${esc(p.nome)}</b></td><td>${p.regiao || '—'}</td><td>${esc(p.canal || '')}</td><td><i class="dot" style="background:${etapa(p.etapa).c}"></i> ${etapa(p.etapa).n}</td><td>${p.classe || '—'}</td><td>${'★'.repeat(p.potencial || 0)}</td><td ${p.soPed ? 'title="Média de unidades por pedido (Bling)"' : ''}>${p.so === null ? '—' : Math.round(p.so) + ' un.' + (p.soPed ? '<small style="color:var(--mute)"> /pedido</small>' : '')}</td><td title="${p.rupI ? `${p.rupI.z} de ${p.rupI.n} sabores zerados nas ${p.rupI.vis} últimas contagens` : 'sem contagens'}">${p.rup == null ? '—' : `<span style="color:${p.rup === 0 ? 'var(--t-ok)' : p.rup <= 0.2 ? 'var(--car-d)' : 'var(--t-bad)'};font-weight:600">${Math.round(p.rup * 100)}%</span>`}</td><td>${p.ultima_compra ? dataLonga(p.ultima_compra) + `<br><small style="color:var(--mute)">há ${Math.floor((Date.now() - new Date(p.ultima_compra)) / DIA)} dias</small>` : '—'}</td><td>${p.proxima_reposicao ? dstr(p.proxima_reposicao) + ' · ' + prazoTxt(p) : '—'}</td><td>${seloPrior(p).replace('Reativar · ', '') || '—'}</td></tr>`).join('');
    $('#tbl').querySelectorAll('th').forEach(th => th.onclick = () => { ord = { k: th.dataset.k, d: ord.k === th.dataset.k ? -ord.d : 1 }; desenhaT(); });
    $('#tbl').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => abrirPerfil(tr.dataset.id));
  };
  manter('carteira', ['q', 'tEt', 'tPr']);
  $('#tNovo').onclick = () => abrirCadastro(null, ETAPAS_CAD.includes($('#tEt').value) ? $('#tEt').value : 'visitado');
  $('#q').oninput = $('#tEt').onchange = $('#tPr').onchange = desenhaT; desenhaT();
  db.rupturaPorPdv().then(r => { RU = S.rupCache = r; if ($('#tbl')) desenhaT(); }).catch(() => { });
  db.resumoPedidos().then(ls => { ls.forEach(o => { const x = RP[o.pdv_id] = RP[o.pdv_id] || { n: 0, un: 0, ult: null }; x.n++; x.un += Number(o.unidades) > 0 ? Number(o.unidades) : Math.round((Number(o.valor) || 0) / 4.6); if (!x.ult || o.criado_em > x.ult) x.ult = o.criado_em; }); if ($('#tbl')) desenhaT(); }).catch(() => { });
}

/* =================== abertura de cliente =================== */
const encVenda = id => { const e = (S.base.regras.encomendas || {})[id]; return e?.tipo === 'venda' ? e : null; };
function telaAbertura() {
  const elig = S.pdvs.filter(p => p.etapa !== 'perdido' && p.etapa !== 'fechado').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const ehCli = x => ['avaliacao', 'ativo', 'risco', 'revisao'].includes(x.etapa);
  if (!S.abPdv || !elig.some(p => p.id === S.abPdv)) S.abPdv = (elig.find(p => p.id === S.sel && !ehCli(p)) || elig.find(p => p.etapa === 'negociacao') || elig.find(p => !ehCli(p)) || {}).id;
  const p = S.pdvs.find(x => x.id === S.abPdv);
  const jaCliente = p && ehCli(p);
  // cliente que já compra: a venda é feita no mesmo checkout da reposição (conta o expositor, registra a saída do produto)
  if (jaCliente && !encVenda(p.id)) { const v = S.vendaVolta; S.vendaVolta = null; S.abPdv = null; S.contando = p.id; S.repVolta = v?.aba ? { aba: v.aba, id: p.id } : { aba: 'abertura' }; return irPara('reposicao'); }
  const ex = S.base.expositores;
  $('#main').innerHTML = `<section class="view on"><div class="dash"><div class="panel">
  <div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 style="font-family:var(--fh);font-size:22px;font-weight:600;margin:0">${jaCliente ? 'Nova venda' : 'Cadastrar venda'}</h3><button class="btn" id="oCad">+ Cadastrar ponto</button></div>
  ${p ? `<div class="atalhos"><b>Atalhos do pedido</b><button class="mini ultped" id="oUlt" title="Preenche as quantidades com o último pedido deste cliente">↻ Último pedido</button>${KITS.map((k, i) => `<button class="mini" data-kit="${i}">+ ${k.n}</button>`).join('')}<span class="atsep"></span><button class="mini" id="oZera">Zerar tudo</button></div>` : '<p class="empty">Nenhum PDV disponível. Cadastre um ponto no mapa primeiro.</p>'}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
   <div style="position:relative"><label class="lb">Cliente</label><input id="oBusca" autocomplete="off" placeholder="Digite o nome, razão social ou bairro…" value="${p ? esc(p.nome) + ' · ' + etapa(p.etapa).n : ''}" style="width:100%"><div id="oSug" class="sugs"></div></div>
   ${jaCliente ? `<div style="align-self:end;color:var(--soft);font-size:13px">Já é cliente (${etapa(p.etapa).n}): lança só o pedido, sem mexer na etapa nem no expositor.</div><div style="display:none">` : '<div style="display:contents">'}
   <div><label class="lb">Expositor</label><select id="oExp" style="width:100%">${ex.map(e => `<option value="${e.id}">${esc(e.nome)} · ${e.capacidade} un.</option>`).join('')}<option value="">Sem expositor</option></select></div>
   <div><label class="lb">Pedido mínimo combinado (R$)</label><input id="oMin" type="number" step="10" value="150" style="width:100%"></div>
   <div><label class="lb">Repor a cada</label><select id="oCad" style="width:100%"><option value="">${cadPadrao().avaliacao || 7} dias (padrão da avaliação)</option><option value="10">10 dias</option><option value="14">14 dias</option></select></div></div></div>
  <h3 style="margin:16px 0 6px">Pagamento</h3><div class="row" style="flex-wrap:wrap;gap:14px;align-items:flex-end"><div class="pay" style="margin:0">${FORMAS.map((c, i) => `<label><input type="radio" name="oc" value="${c}" ${i === 0 ? 'checked' : ''}> ${c}</label>`).join('')}</div>
   <div id="oVencBox"><label class="lb">Vencimento</label><div class="row" style="gap:6px;flex-wrap:nowrap"><input id="oVenc" type="date" value="${vencPadrao(FORMAS[0])}">${atalhoPrazo('oprz')}</div></div>
   <div id="oNBol"><label class="lb">Boletos</label><div class="nbol">${[1, 2, 3, 4].map(n => `<button type="button" data-nbol="${n}" class="${n === 1 ? 'on' : ''}">${n}×</button>`).join('')}</div></div></div>
  <label class="chkcomp"><input type="checkbox" id="oDiv"> Dividir o pagamento (entrada, vários boletos, Pix + cartão…)</label>
  <label class="chkcomp"><input type="checkbox" id="oFrete"> 🚚 Entrega terceirizada</label>
  <div id="oFreteBox" class="divpag" hidden><div class="row"><label class="lb" style="margin:0">Custo da entrega</label><input id="oFreteV" type="number" step="0.01" min="0" inputmode="decimal" placeholder="R$" style="width:120px"></div>
   <div class="row frq"><label><input type="radio" name="ofq" value="1" checked> Cobrar do cliente <small>(soma no pedido)</small></label><label><input type="radio" name="ofq" value="0"> Por nossa conta <small>(só registra o custo)</small></label></div></div>
  <div id="oDivBox" class="divpag" hidden><div id="oParc"></div>
   <div class="row" style="justify-content:space-between"><button type="button" class="mini" id="oAddParc">+ parcela</button><small id="oParcInfo" style="color:var(--mute)"></small></div></div>
  <div class="row" style="justify-content:space-between;flex-wrap:wrap;margin:16px 0 6px"><h3 style="margin:0">Itens do pedido</h3></div><div id="oItens" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px 18px"></div><small style="color:var(--mute)">O preço ao lado de cada linha vale para todos os sabores dela. Em laranja: diferente da tabela do Bling.</small>
  <div class="row" style="justify-content:space-between;margin-top:14px;flex-wrap:wrap"><div><b id="oUn">0</b> unidades · <span id="oInfo" style="color:var(--soft)"></span></div><div style="text-align:right"><small id="oDesc" style="display:block;color:var(--soft);font-size:12.5px"></small><div style="font-family:var(--fh);font-size:26px" id="oTot">R$ 0,00</div></div></div>
  ${caixaPix()}${blocoEntrega('o', p && encVenda(p.id))}
  <label class="lb">Observação</label><textarea id="oObs" rows="2" style="width:100%"></textarea>
  <div class="row" style="margin-top:12px;justify-content:flex-end;gap:14px;flex-wrap:wrap"><label style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" id="oPadrao" checked style="width:auto"> Guardar os preços como padrão deste cliente</label><label style="display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" id="oBling" checked style="width:auto"> Criar o pedido no Bling</label><button class="btn pri" id="oSave" ${p ? '' : 'disabled'}>Lançar venda</button></div></div></div></section>`;
  const fill = () => { const e = +$('#oExp').value; let l = ''; $('#oItens').innerHTML = S.base.produtos.map(pr => { const pc = S.precosCli?.[pr.id], v = pc != null ? Number(pc) : Number(pr.preco);
    const h = pr.linha !== l ? `<div class="linha-h"><span>${esc(l = pr.linha)}</span><label class="preco" title="Tabela: ${brl(pr.preco)} · vale para todos os sabores da linha">R$ <input type="number" step="0.05" min="0" class="olp" data-linha="${esc(pr.linha)}" data-tab="${pr.preco}" value="${v.toFixed(2)}"></label><small>por unidade</small></div>` : '';
    return h + `<div class="item-v"><span>${esc(pr.sabor)}</span><input type="hidden" class="opr" data-p="${pr.id}" data-linha="${esc(pr.linha)}" data-tab="${pr.preco}" value="${v.toFixed(2)}">${stepper('oq', 0, false, `data-p="${pr.id}"`)}</div>`; }).join('');
    document.querySelectorAll('.olp').forEach(i => i.oninput = () => { document.querySelectorAll('.opr').forEach(o => { if (o.dataset.linha === i.dataset.linha) o.value = i.value; }); calc(); }); ligarSteppers($('#oItens')); calc(); };
  const cond = () => document.querySelector('input[name=oc]:checked').value;
  const freteAtual = () => { const on = $('#oFrete')?.checked, v = on ? Math.round((+$('#oFreteV').value || 0) * 100) / 100 : 0; return { v, cobrado: on && v > 0 && document.querySelector('input[name=ofq]:checked')?.value === '1' }; };
  const precoDe = pid => +(document.querySelector(`.opr[data-p="${pid}"]`)?.value) || 0;
  const tabDe = pid => +(document.querySelector(`.opr[data-p="${pid}"]`)?.dataset.tab) || 0;
  const calc = () => { const qs = [...document.querySelectorAll('.oq')], un = qs.reduce((a, i) => a + (+i.value || 0), 0); let tot = qs.reduce((a, i) => a + (+i.value || 0) * precoDe(i.dataset.p), 0), c = cond();
    const desc = qs.reduce((a, i) => a + (+i.value || 0) * Math.max(0, tabDe(i.dataset.p) - precoDe(i.dataset.p)), 0), acima = qs.reduce((a, i) => a + (+i.value || 0) * Math.max(0, precoDe(i.dataset.p) - tabDe(i.dataset.p)), 0);
    $('#oDesc').innerHTML = desc > 0.004 || acima > 0.004 ? `Tabela ${brl(tot + desc - acima)}${desc > 0.004 ? ` · <b style="color:var(--t-ok)">desconto − ${brl(desc)}</b>` : ''}${acima > 0.004 ? ` · <b style="color:var(--car-d)">acima da tabela + ${brl(acima)}</b>` : ''}` : '';
    document.querySelectorAll('.olp').forEach(i => i.parentElement.classList.toggle('custom', Math.abs((+i.value || 0) - +i.dataset.tab) > 0.001));
    const fr = freteAtual(); if (fr.cobrado) tot += fr.v;
    $('#oUn').textContent = un; $('#oTot').textContent = brl(tot); if (fr.v) $('#oDesc').innerHTML += `${$('#oDesc').innerHTML ? ' · ' : ''}🚚 entrega ${brl(fr.v)}${fr.cobrado ? ' (no total)' : ' por nossa conta'}`;
    $('#oInfo').textContent = tot && tot < (+$('#oMin').value || 0) ? 'abaixo do pedido mínimo' : '';
    restoParc(tot); return { un, tot, c }; };
  // parcelas: cada linha com forma, valor e vencimento; a última fica com o restante
  const vencDe = (f, i) => vencPadrao(f, f === 'Boleto' ? 7 * (i + 1) : 0);
  const linhaParc = (f, i, v = '') => `<div class="row parc" data-i="${i}"><select class="pf">${FORMAS.map(x => `<option ${x === f ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <input class="pv" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Valor" value="${v}"><b class="pr" hidden></b><input class="pd" type="date" value="${vencDe(f, i)}"><button type="button" class="mini px" title="Tirar parcela">✕</button></div>`;
  function montarParc(lista) { $('#oParc').innerHTML = lista.map((x, i) => linhaParc(x.f, i, x.v ?? '')).join(''); ligarParc(); calc(); }
  function ligarParc() { const ls = [...document.querySelectorAll('#oParc .parc')];
    ls.forEach((l, i) => { const ult = i === ls.length - 1; l.querySelector('.pv').hidden = ult; l.querySelector('.pr').hidden = !ult; l.querySelector('.px').hidden = ls.length <= 2;
      l.querySelector('.pv').oninput = () => calc(); l.querySelector('.pf').onchange = e => { const nBol = ls.slice(0, i).filter(x => x.querySelector('.pf').value === 'Boleto').length; l.querySelector('.pd').value = vencDe(e.target.value, nBol); }; // 1º boleto em 7 dias, 2º em 14…
      l.querySelector('.px').onclick = () => { l.remove(); ligarParc(); calc(); }; }); }
  function restoParc(tot) { const ls = [...document.querySelectorAll('#oParc .parc')]; if (!ls.length) return;
    const pagos = ls.slice(0, -1).reduce((a, l) => a + (+l.querySelector('.pv').value || 0), 0), resto = Math.round((tot - pagos) * 100) / 100;
    ls[ls.length - 1].querySelector('.pr').textContent = brl(Math.max(0, resto)); $('#oParcInfo').textContent = resto < 0 ? 'as parcelas passam do total' : `${ls.length} parcelas · total ${brl(tot)}`; }
  const lerParc = tot => { const ls = [...document.querySelectorAll('#oParc .parc')]; let soma = 0;
    return ls.map((l, i) => { const ult = i === ls.length - 1, v = ult ? Math.round((tot - soma) * 100) / 100 : Math.round((+l.querySelector('.pv').value || 0) * 100) / 100; soma += v;
      return { forma: l.querySelector('.pf').value, valor: v, vencimento: l.querySelector('.pd').value || null }; }); };
  const abrirDiv = on => { $('#oDiv').checked = on; $('#oDivBox').hidden = !on; document.querySelector('.pay').classList.toggle('apagado', on); $('#oVencBox').classList.toggle('apagado', on); };
  $('#oDiv').onchange = () => { abrirDiv($('#oDiv').checked); if ($('#oDiv').checked && !document.querySelector('#oParc .parc')) montarParc([{ f: 'Pix', v: '' }, { f: cond() === 'Boleto' ? 'Boleto' : 'Cartão' }]); };
  $('#oFrete').onchange = () => { $('#oFreteBox').hidden = !$('#oFrete').checked; calc(); }; $('#oFreteV').oninput = () => calc(); document.querySelectorAll('input[name=ofq]').forEach(x => x.onchange = () => calc());
  $('#oAddParc').onclick = () => { const ls = document.querySelectorAll('#oParc .parc'); if (ls.length >= 6) return toast('Até 6 parcelas');
    $('#oParc').insertAdjacentHTML('beforeend', linhaParc(ls[ls.length - 1]?.querySelector('.pf').value || 'Boleto', ls.length)); ligarParc(); calc(); };
  // atalho: número de boletos divide o total em parcelas iguais com vencimento a cada 7 dias
  document.querySelectorAll('[data-nbol]').forEach(b => b.onclick = () => { const n = +b.dataset.nbol; document.querySelectorAll('[data-nbol]').forEach(x => x.classList.toggle('on', x === b));
    if (n === 1) { abrirDiv(false); $('#oParc').innerHTML = ''; return; }
    const tot = calc().tot, cada = tot ? Math.floor(tot / n * 100) / 100 : ''; abrirDiv(true); montarParc(Array.from({ length: n }, () => ({ f: 'Boleto', v: cada }))); });
  const mostraNBol = () => { $('#oNBol').hidden = cond() !== 'Boleto'; }; mostraNBol();
  document.querySelectorAll('input[name=oc]').forEach(x => x.onchange = () => { mostraNBol(); $('#oVenc').value = vencPadrao(cond()); document.querySelector('.oprz').hidden = cond() !== 'Boleto'; });
  document.querySelector('.oprz').hidden = cond() !== 'Boleto';
  document.querySelectorAll('.oprz [data-prz]').forEach(b => b.onclick = () => { $('#oVenc').value = vencPadrao('Boleto', +b.dataset.prz); });
  document.querySelectorAll('[data-kit]').forEach(b => b.onclick = () => { const k = KITS[+b.dataset.kit]; Object.entries(k.q).forEach(([cod, q]) => { const pr = S.base.produtos.find(x => x.bling_codigo === cod), inp = pr && document.querySelector(`.oq[data-p="${pr.id}"]`); if (inp) inp.value = (+inp.value || 0) + q; }); calc(); });
  $('#oZera').onclick = () => { document.querySelectorAll('.oq').forEach(i => i.value = 0); calc(); };
  if ($('#oUlt')) $('#oUlt').onclick = async () => { const b = $('#oUlt'); b.disabled = true; b.textContent = 'Buscando…';
    try { const u = await db.ultimoPedidoItens(p.id); b.disabled = false; b.textContent = '↻ Último pedido';
      if (!u) return toast('Este cliente ainda não tem pedidos');
      if (!u.itens.length) return toast(`O último pedido (${dstr(u.criado_em)}) não tem itens detalhados`);
      document.querySelectorAll('.oq').forEach(i => i.value = 0);
      let n = 0; u.itens.forEach(i => { const inp = document.querySelector(`.oq[data-p="${i.produto_id}"]`); if (inp) { inp.value = (+inp.value || 0) + Math.round(+i.quantidade); n += Math.round(+i.quantidade); } });
      calc(); toast(`Copiado o pedido de ${dstr(u.criado_em)}: ${n} un. Ajuste o que precisar.`);
    } catch (e) { b.disabled = false; b.textContent = '↻ Último pedido'; erro(e); } };
  const bu = $('#oBusca'), sug = $('#oSug');
  const listar = () => { const q = norm(bu.value).trim(), ls = elig.filter(x => !q || norm([x.nome, x.razao_social, x.bairro, x.cidade].filter(Boolean).join(' ')).includes(q)).slice(0, 12);
    sug.innerHTML = ls.map(x => `<div data-pick="${x.id}"><b>${esc(x.nome)}</b> <small style="color:${etapa(x.etapa).c};font-weight:700">${etapa(x.etapa).n}</small><br><small style="color:var(--mute)">${esc([x.bairro, x.cidade].filter(Boolean).join(' · '))}</small></div>`).join('') || '<div style="color:var(--mute)">Nenhum cliente encontrado</div>';
    sug.style.display = 'block'; sug.querySelectorAll('[data-pick]').forEach(d => d.onmousedown = e => { e.preventDefault(); S.abPdv = d.dataset.pick; telaAbertura(); }); };
  bu.onfocus = () => { bu.select(); listar(); }; bu.oninput = listar; bu.onblur = () => setTimeout(() => { sug.style.display = 'none'; }, 150);
  $('#oCad').onclick = () => abrirCadastro(null);
  $('#oExp').onchange = fill; const sec = $('#main section'); sec.addEventListener('input', calc); sec.addEventListener('change', calc);
  S.precosCli = {}; fill();
  if (p && S.prefillVenda?.pdv === p.id) { const q = S.prefillVenda.q; S.prefillVenda = null; document.querySelectorAll('.oq').forEach(i => i.value = q[i.dataset.p] || 0); calc(); toast('Itens do pedido excluído já preenchidos: corrija e lance de novo'); }
  // venda guardada para entrega: volta preenchida (itens, preços, pagamento); ao lançar, sai da rota
  const encV = p && encVenda(p.id);
  if (encV) { $('#oExp').value = encV.exp || ''; fill(); Object.entries(encV.precos || {}).forEach(([pid, v]) => { const o = document.querySelector(`.opr[data-p="${pid}"]`); if (o) o.value = v; });
    document.querySelectorAll('.olp').forEach(i => { const o = document.querySelector(`.opr[data-linha="${i.dataset.linha}"]`); if (o) i.value = (+o.value).toFixed(2); });
    document.querySelectorAll('.oq').forEach(i => i.value = encV.q?.[i.dataset.p] || 0);
    const r = document.querySelector(`input[name=oc][value="${encV.forma}"]`); if (r) r.checked = true; if (encV.vencimento) $('#oVenc').value = encV.vencimento; if (encV.min) $('#oMin').value = encV.min;
    $('#oEnt').checked = false; $('#oEntBox').hidden = true; calc();
    $('#main .panel').insertAdjacentHTML('afterbegin', `<div class="esteira" style="margin:0 0 12px"><b>📦 Venda para entrega${encV.data ? ' em ' + dstr(encV.data + 'T12:00') : ''}${entregaTxt(encV) ? ' · ' + esc(entregaTxt(encV)) : ''}</b><p style="margin:4px 0 0">Itens e pagamento já preenchidos. Confira e toque em <b>Lançar venda</b>. <a href="#" id="encVDesc">descartar a entrega</a></p></div>`);
    $('#encVDesc').onclick = async e => { e.preventDefault(); await apagarEncomenda(p.id); toast('Entrega descartada'); telaAbertura(); }; }
  const entO = ligarEntrega('o', on => { $('#oSave').textContent = on ? '📦 Salvar para entrega' : 'Lançar venda'; });
  atualizaPix();
  if (p) db.precosCliente(p.id).then(pc => { if (S.abPdv !== p.id || !Object.keys(pc || {}).length) return; S.precosCli = pc; const q = {}; document.querySelectorAll('.oq').forEach(i => q[i.dataset.p] = i.value); fill(); document.querySelectorAll('.oq').forEach(i => i.value = q[i.dataset.p] || 0); calc(); toast('Preços combinados com este cliente carregados'); });
  $('#oSave').onclick = async () => {
    const t = calc(); if (!t.un) return toast('Coloque os itens do pedido');
    const div = $('#oDiv').checked && document.querySelectorAll('#oParc .parc').length > 1, parc = div ? lerParc(t.tot) : [];
    if (div && parc.some(x => !(x.valor > 0))) return toast('Cada parcela precisa ter valor, e a soma não pode passar do total');
    const formasP = [...new Set(parc.map(x => x.forma))], f1 = formasP[0];
    const c = div ? (formasP.length === 1 ? `${parc.length}× ${f1}` : parc.map(x => x.forma).filter((f, i, a) => a.indexOf(f) === i).join(' + ')) : t.c;
    const fr = freteAtual(), pagExtra = { ...(div ? { pagamentos: parc } : {}), ...(fr.v ? { frete: fr.v, frete_cobrado: fr.cobrado } : {}) };
    const itens = [...document.querySelectorAll('.oq')].map(i => ({ produto_id: +i.dataset.p, quantidade: +i.value || 0, preco_unit: precoDe(i.dataset.p), bonificado: 0 }));
    const novosPrecos = {}; document.querySelectorAll('.opr').forEach(i => { if (Math.abs((+i.value || 0) - +i.dataset.tab) > 0.001) novosPrecos[i.dataset.p] = +(+i.value).toFixed(2); });
    const hoje = new Date(), venc = div ? parc.map(x => x.vencimento).filter(Boolean).sort().pop() || null : ($('#oVenc').value || null), mandar = $('#oBling').checked, guardar = $('#oPadrao').checked;
    if (entO.on()) { const e = entO.ler(); if (!e.data) return toast('Escolha a data da entrega');
      const q = {}, precos = {}; itens.forEach(i => { if (i.quantidade) q[i.produto_id] = i.quantidade; precos[i.produto_id] = i.preco_unit; });
      $('#oSave').disabled = true;
      try { await salvarEncomenda(p.id, { tipo: 'venda', q, precos, forma: div ? f1 : c, vencimento: venc, exp: $('#oExp').value ? +$('#oExp').value : null, min: +$('#oMin').value || null, ...e });
        toast(`📦 Venda para entrega salva para ${dstr(e.data + 'T12:00')}: entra na rota desse dia`); S.abPdv = null; const volta = S.vendaVolta; S.vendaVolta = null;
        if (volta?.aba === 'perfil') abrirPerfil(p.id); else if (volta?.aba === 'mapa') { S.sel = p.id; irPara('mapa'); } else if (volta?.aba === 'rota') irPara('rota'); else telaAbertura(); } catch (er) { erro(er); $('#oSave').disabled = false; } return; }
    $('#oSave').disabled = true;
    try {
      const reg = jaCliente
        ? await db.registrarVenda({ pdvId: p.id, usuarioId: S.eu.id, pedido: { tipo: 'reposicao', condicao: c, unidades: t.un, valor: t.tot, pago_na_hora: c === 'Dinheiro', vencimento: venc, ...pagExtra }, itens, patch: div ? null : { condicao: c } })
        : await db.registrarAbertura({ pdvId: p.id, usuarioId: S.eu.id, observacao: $('#oObs').value || null,
        contagens: itens.filter(i => i.quantidade).map(i => ({ produto_id: i.produto_id, deixado_anterior: 0, encontrado: 0, troca: 0, reposto: i.quantidade })),
        pedido: { tipo: 'abertura', condicao: c, unidades: t.un, valor: t.tot, pago_na_hora: c === 'Dinheiro', vencimento: venc, ...pagExtra },
        itens,
        patch: { etapa: 'avaliacao', avaliacao_inicio: hoje.toISOString().slice(0, 10), expositor_id: $('#oExp').value ? +$('#oExp').value : null, condicao: div ? f1 : c, pedido_minimo: +$('#oMin').value || 150, cadencia_dias: $('#oCad').value ? +$('#oCad').value : null } });
      if (!jaCliente && $('#oExp').value) registrarExpositor(p.id, +$('#oExp').value, 'primeira venda');
      if (encVenda(p.id)) await apagarEncomenda(p.id);
      await atualizarUm(p.id); const n = S.pdvs.find(x => x.id === p.id);
      toast(jaCliente ? `Venda lançada para ${p.nome}.` : `Venda lançada para ${p.nome}. Primeira reposição em ${dstr(n.proxima_reposicao)}.`);
      if (guardar && JSON.stringify(novosPrecos) !== JSON.stringify(S.precosCli || {})) { try { await db.salvarPrecos(p.id, novosPrecos); } catch (e) { toast('Venda salva, mas os preços do cliente não foram guardados: rode o SQL 015'); } }
      if (mandar && reg?.pedido?.id) await enviarAoBling(reg.pedido.id, p.nome); S.abPdv = null;
      const volta = S.vendaVolta; S.vendaVolta = null;
      if (S.prosp) { PZ.visHoje[p.id] = 'fechou'; PZ.aberto = null; irPara('mapa'); }
      else if (volta?.aba === 'perfil') abrirPerfil(p.id);
      else if (volta?.aba === 'mapa') { S.sel = p.id; irPara('mapa'); }
      else if (volta?.aba === 'rota') irPara('rota');
      else telaAbertura();
    } catch (e) { erro(/pagamentos/.test(e.message) ? new Error('Rode o 025_pagamento_dividido_agrupar.sql no Supabase para dividir o pagamento') : /frete/.test(e.message) ? new Error('Rode o 027_frete.sql no Supabase para lançar o custo da entrega') : e); $('#oSave').disabled = false; }
  };
}

/* =================== painel (números e metas) =================== */
const PV = { mes: null, cmp: 'ant', vend: 'todos', dados: null, t: 0 };
const COR = { s1: '#2a78d6', s2: '#eb6834', s3: '#1baf7a', grid: 'var(--grid)', eixo: 'var(--mute)', bom: '#0ca30c', aviso: '#fab219', ruim: '#d03b3b', neutro: 'var(--neutro)' };
const LINHAS = [{ k: 'B', n: 'Brownie', c: COR.s1 }, { k: 'C', n: 'Cookies', c: COR.s2 }, { k: 'P', n: 'Palha italiana', c: COR.s3 }];
const IND = [['fat', 'Faturamento', 'R$', true], ['margem', 'Margem bruta', 'R$', true], ['compradores', 'Clientes compradores', 'n', true], ['ticket', 'Ticket médio', 'R$', false], ['un', 'Unidades vendidas', 'n', true], ['novos', 'Novos clientes', 'n', true], ['segundo', '2º pedido em até 45 dias', '%', false], ['retencao', 'Retenção mensal', '%', false]];
const metasV2 = () => ({ meses: {}, faixas: { verde: 100, amarelo: 85 }, feriados: [], anual: {}, ...(S.base.regras.metas_v2 || {}) });
const mesKey = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); };
const mesNome = (k, curto) => { const [a, m] = k.split('-').map(Number); const s = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: curto ? 'short' : 'long', year: curto ? '2-digit' : 'numeric' }).replace('.', '').replace(' de ', '/'); return s.charAt(0).toUpperCase() + s.slice(1); };
const mesSoma = (k, n) => { const [a, m] = k.split('-').map(Number); return mesKey(new Date(a, m - 1 + n, 1)); };
const mesIni = k => { const [a, m] = k.split('-').map(Number); return new Date(a, m - 1, 1); };
const mesFim = k => { const [a, m] = k.split('-').map(Number); return new Date(a, m, 1); };
function diasUteis(k) { const fer = new Set(metasV2().feriados || []), out = []; for (let d = mesIni(k); d < mesFim(k); d = new Date(+d + DIA)) if (d.getDay() !== 0 && !fer.has(isoDe(d))) out.push(isoDe(d)); return out; }
const razao = (a, b) => b ? a / b : null;
const fmtV = (v, u) => v == null || !isFinite(v) ? '—' : u === 'R$' ? brl(v) : u === '%' ? Math.round(v * 100) + '%' : fmt(Math.round(v));
const nomeVend = id => id === 'bling' ? 'Moisés (pedidos do Bling)' : (PV.dados?.perfis.find(p => p.id === id)?.nome || 'Vendedor');
function metaDe(mes, vend, k) {
  const M = metasV2().meses[mes] || {}, v = M[vend]?.[k];
  if (v != null && v !== '') return Number(v);
  if (vend === 'todos' && IND.find(i => i[0] === k)?.[3]) { const vs = Object.entries(M).filter(([x]) => x !== 'todos').map(([, o]) => o?.[k]).filter(x => x != null && x !== ''); if (vs.length) return vs.reduce((a, b) => a + Number(b), 0); }
  return null;
}
function faixa(r) { const f = metasV2().faixas; if (r == null) return null; return r * 100 >= f.verde ? { c: COR.bom, ic: '✓', n: 'No alvo' } : r * 100 >= f.amarelo ? { c: COR.aviso, ic: '!', n: 'Atenção' } : { c: COR.ruim, ic: '✕', n: 'Abaixo' }; }

// prepara os dados: itens, unidades, custo e linha de cada pedido
function prepararPainel(raw) {
  const prod = {}, porCod = {}; raw.produtos.forEach(p => { prod[p.id] = p; if (p.bling_codigo) porCod[p.bling_codigo] = p; });
  const custoLinha = {}; LINHAS.forEach(l => { const ps = raw.produtos.filter(p => (p.bling_codigo || '').startsWith(l.k)); custoLinha[l.k] = ps.length ? ps.reduce((a, p) => a + Number(p.custo), 0) / ps.length : 2.5; });
  const pi = {}, bi = {}; raw.pitens.forEach(i => (pi[i.pedido_id] = pi[i.pedido_id] || []).push(i)); raw.bitens.forEach(i => (bi[i.pedido_id] = bi[i.pedido_id] || []).push(i));
  const linhaDe = (cod, desc) => { const c = (cod || '').charAt(0).toUpperCase(); if (['B', 'C', 'P'].includes(c)) return c; const d = norm(desc || ''); return /brownie/.test(d) ? 'B' : /cookie/.test(d) ? 'C' : /palha/.test(d) ? 'P' : 'B'; };
  let recI = 0, custoI = 0;
  raw.pedidos.forEach(o => {
    o.valor = Number(o.valor) || 0; o.data = new Date(o.criado_em); o.mes = mesKey(o.data); o.vend = o.criado_por || 'bling';
    let its = [];
    if (pi[o.id]?.length) its = pi[o.id].map(i => { const p = prod[i.produto_id] || {}; const cod = p.bling_codigo || ''; return { cod, l: linhaDe(cod, p.linha), sabor: p.sabor || cod, q: +i.quantidade, rec: +i.quantidade * +i.preco_unit, custo: +i.quantidade * Number(p.custo || custoLinha[linhaDe(cod, p.linha)]) }; });
    else if (bi[o.id]?.length) its = bi[o.id].map(i => { const p = porCod[i.codigo]; const l = linhaDe(i.codigo, i.descricao); return { cod: i.codigo, l, sabor: p?.sabor || (i.descricao || i.codigo || '').replace(/^(Brownie|Cookies?|Palha Italiana)\s*-?\s*/i, '').replace(/\s*-\s*\d+g$/i, ''), q: +i.quantidade, rec: +i.quantidade * +i.valor * (1 - (+i.desconto || 0) / 100), custo: +i.quantidade * Number(p?.custo ?? custoLinha[l]) }; });
    its = its.filter(i => i.q > 0);
    const r = its.reduce((a, i) => a + i.rec, 0); if (r > 0) its.forEach(i => i.rec = i.rec * o.valor / r);
    o.itens = its; o.un = its.length ? its.reduce((a, i) => a + i.q, 0) : (Number(o.unidades) || Math.round(o.valor / 4.6)); o.custo = its.length ? its.reduce((a, i) => a + i.custo, 0) : null;
    if (o.custo != null && o.valor > 0) { recI += o.valor; custoI += o.custo; }
  });
  const margemMedia = recI ? 1 - custoI / recI : 0.45;
  raw.pedidos.forEach(o => { if (o.custo == null) { o.custo = o.valor * (1 - margemMedia); o.estimado = true; } });
  raw.margemMedia = margemMedia; raw.prod = prod; raw.porCod = porCod;
  // primeira compra e histórico por cliente
  raw.porPdv = {}; raw.pedidos.forEach(o => (raw.porPdv[o.pdv_id] = raw.porPdv[o.pdv_id] || []).push(o));
  return raw;
}
const pedidosDe = (D, de, ate, vend = PV.vend) => D.pedidos.filter(o => o.data >= de && o.data < ate && o.valor > 0 && (vend === 'todos' || o.vend === vend));
function numeros(peds) { const fat = peds.reduce((a, o) => a + o.valor, 0), custo = peds.reduce((a, o) => a + o.custo, 0), cl = new Set(peds.map(o => o.pdv_id)); return { fat, margem: fat - custo, margemP: fat ? (fat - custo) / fat : null, compradores: cl.size, ticket: peds.length ? fat / peds.length : null, un: peds.reduce((a, o) => a + o.un, 0), pedidos: peds.length }; }
// ativo numa data = comprou nos 90 dias anteriores
const ativoEm = (D, pdv, data) => (D.porPdv[pdv] || []).some(o => o.data <= data && o.data > new Date(+data - 90 * DIA));
function base(D, ini0, fim0, iniAnt) {
  const ini = ini0, fim = new Date(Math.min(+fim0, Date.now())), pdvs = Object.keys(D.porPdv);
  const ativosIni = pdvs.filter(p => ativoEm(D, p, new Date(+ini - 1)));
  const noMes = new Set(D.pedidos.filter(o => o.data >= ini && o.data < fim).map(o => o.pdv_id));
  const novos = [...noMes].filter(p => D.porPdv[p][0].data >= ini);
  const recup = [...noMes].filter(p => D.porPdv[p][0].data < ini && !ativoEm(D, p, new Date(+ini - 1)));
  const ativosFim = pdvs.filter(p => ativoEm(D, p, fim));
  const perdidos = ativosIni.filter(p => !ativosFim.includes(p));
  const antes = new Set(D.pedidos.filter(o => o.data >= iniAnt && o.data < ini).map(o => o.pdv_id));
  const retencao = antes.size ? [...antes].filter(p => noMes.has(p)).length / antes.size : null;
  // 2º pedido em até 45 dias: clientes que abriram entre 45 e 225 dias atrás
  const coorte = pdvs.filter(p => { const f = D.porPdv[p][0].data; return f < new Date(+fim - 45 * DIA) && f >= new Date(+fim - 225 * DIA); });
  const segundo = coorte.length ? coorte.filter(p => D.porPdv[p][1] && D.porPdv[p][1].data - D.porPdv[p][0].data <= 45 * DIA).length / coorte.length : null;
  return { ativosIni: ativosIni.length, novos: novos.length, recup: recup.length, perdidos: perdidos.length, ativosFim: ativosFim.length, retencao, segundo, coorte: coorte.length };
}
// ritmo de cada cliente: valor por mês, intervalo e atraso
function ritmos(D) {
  return Object.entries(D.porPdv).map(([id, ps]) => {
    const p = S.pdvs.find(x => x.id === id); if (!p || p.etapa === 'perdido') return null;
    const vs = ps.filter(o => o.valor > 0); if (!vs.length) return null;
    const gaps = vs.slice(1).map((o, i) => (o.data - vs[i].data) / DIA).filter(g => g > .5), inter = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 29;
    const ticket = vs.reduce((a, o) => a + o.valor, 0) / vs.length, semPed = (Date.now() - vs[vs.length - 1].data) / DIA;
    return { p, n: vs.length, inter, ticket, mensal: ticket * 30 / Math.max(inter, 7), semPed: Math.floor(semPed), atraso: semPed / inter, ult: vs[vs.length - 1].data };
  }).filter(Boolean);
}

/* ---- gráficos em SVG, com dica ao passar o mouse ---- */
function dica(e, html) { let t = document.getElementById('vtip'); if (!t) { t = document.createElement('div'); t.id = 'vtip'; document.body.appendChild(t); } if (!html) { t.style.display = 'none'; return; } t.innerHTML = html; t.style.display = 'block'; const x = e.clientX + 14, y = e.clientY + 14, w = t.offsetWidth, h = t.offsetHeight; t.style.left = Math.min(x, innerWidth - w - 8) + 'px'; t.style.top = Math.min(y, innerHeight - h - 8) + 'px'; }
const escalaY = (max) => { const m = max > 0 ? max : 1, p = Math.pow(10, Math.floor(Math.log10(m))), n = [1, 2, 2.5, 5, 10].map(k => k * p).find(k => m / k <= 5) || 10 * p; return { top: Math.ceil(m / n) * n, passo: n }; };
const curto = (v, u) => u === 'R$' ? (v >= 1000 ? 'R$ ' + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + ' mil' : 'R$ ' + Math.round(v)) : u === '%' ? Math.round(v * 100) + '%' : fmt(Math.round(v));
// linhas: series [{nome, cor, vals[], tracejado, rotulo}], xs = rótulos
function grafLinhas(id, xs, series, u, { h = 230, marcas = true } = {}) {
  const W = 640, H = h, L = 72, R = 104, T = 14, B = 26, iw = W - L - R, ih = H - T - B;
  const max = Math.max(...series.flatMap(s => s.vals.filter(v => v != null)), 0), { top, passo } = escalaY(max);
  const X = i => L + (xs.length < 2 ? iw / 2 : i * iw / (xs.length - 1)), Y = v => T + ih - v / top * ih;
  let g = ''; for (let v = 0; v <= top + 1e-9; v += passo) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${COR.grid}" stroke-width="1"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="ax">${curto(v, u)}</text>`;
  const rot = [];
  const passoX = Math.ceil(xs.length / 8); xs.forEach((x, i) => { const ult = i === xs.length - 1; if ((i % passoX === 0 && (ult || xs.length - 1 - i >= passoX * 0.6)) || ult) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="ax">${x}</text>`; });
  series.forEach(s => {
    let d = '', on = false; s.vals.forEach((v, i) => { if (v == null) { on = false; return; } d += (on ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); on = true; });
    g += `<path d="${d}" fill="none" stroke="${s.cor}" stroke-width="2" stroke-linejoin="miter" stroke-linecap="butt" ${s.tracejado ? 'stroke-dasharray="5 4"' : ''}/>`;
    const li = s.vals.map((v, i) => v == null ? -1 : i).filter(i => i >= 0).pop();
    if (li != null && li >= 0) { if (marcas && !s.tracejado) g += `<circle cx="${X(li)}" cy="${Y(s.vals[li])}" r="4" fill="${s.cor}" stroke="var(--card)" stroke-width="2"/>`; if (s.rotulo !== false) rot.push({ x: X(li) + 8, y: Y(s.vals[li]) + 4, t: s.nome }); }
  });
  rot.sort((a, b) => a.y - b.y).forEach((r, i, a) => { if (i && r.y - a[i - 1].y < 14) r.y = a[i - 1].y + 14; }); rot.forEach(r => { g += `<text x="${r.x}" y="${r.y}" class="lb" fill="var(--choc)">${esc(r.t)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="grf" id="${id}" data-tipo="linha" role="img"><g>${g}</g><line class="xh" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="${COR.eixo}" stroke-width="1" style="display:none"/><rect x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent" class="hov"/></svg>`
    + `<script type="application/json" data-for="${id}">${JSON.stringify({ xs, series: series.map(s => ({ nome: s.nome, cor: s.cor, vals: s.vals })), u, L, iw, n: xs.length, W })}</script>`;
}
// barras verticais (uma ou mais séries lado a lado) com marcador de meta opcional
function grafBarras(id, xs, series, u, { h = 230, metas = null, rotulos = false } = {}) {
  const W = 640, H = h, L = 72, R = 12, T = 14, B = 26, iw = W - L - R, ih = H - T - B;
  const max = Math.max(...series.flatMap(s => s.vals), ...(metas || []).filter(v => v != null), 0), { top, passo } = escalaY(max);
  const Y = v => T + ih - v / top * ih, gw = iw / xs.length, bw = Math.max(4, Math.min(28, (gw - 8) / series.length - 2));
  let g = ''; for (let v = 0; v <= top + 1e-9; v += passo) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${COR.grid}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="ax">${curto(v, u)}</text>`;
  xs.forEach((x, i) => {
    const cx = L + gw * i + gw / 2, x0 = cx - (bw * series.length + 2 * (series.length - 1)) / 2;
    series.forEach((s, j) => { const v = s.vals[i] || 0, y = Y(v), hh = T + ih - y, bx = x0 + j * (bw + 2), rr = Math.min(4, bw / 2, hh);
      if (hh > 0) g += `<rect x="${bx}" y="${y}" width="${bw}" height="${hh}" fill="${s.cor}"/>`;
      if (rotulos && v) g += `<text x="${bx + bw / 2}" y="${y - 5}" text-anchor="middle" class="ax" fill="var(--choc)">${curto(v, u)}</text>`; });
    if (metas && metas[i] != null) { const y = Y(metas[i]); g += `<line x1="${cx - gw / 2 + 4}" x2="${cx + gw / 2 - 4}" y1="${y}" y2="${y}" stroke="var(--choc)" stroke-width="2" stroke-dasharray="3 2"/>`; }
    g += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="ax">${x}</text><rect x="${cx - gw / 2}" y="${T}" width="${gw}" height="${ih}" fill="transparent" class="hb" data-i="${i}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="grf" id="${id}" data-tipo="barra" role="img">${g}</svg><script type="application/json" data-for="${id}">${JSON.stringify({ xs, series: series.map(s => ({ nome: s.nome, cor: s.cor, vals: s.vals })), u, metas })}</script>`;
}
// barras horizontais (ranking) em HTML
function ranking(itens, u, { max = null } = {}) {
  const m = max || Math.max(...itens.map(i => i.v), 1);
  return `<div class="rank">${itens.map(i => `<div class="rk" data-tip="${esc(i.tip || '')}"><span class="rn">${esc(i.n)}</span><div class="rb"><i style="width:${Math.max(1, i.v / m * 100)}%;background:${i.c || COR.s1}"></i></div><b>${fmtV(i.v, u)}</b>${i.d != null ? `<small class="${i.d >= 0 ? 'up' : 'dn'}">${i.d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(i.d * 100))}%</small>` : '<small></small>'}</div>`).join('')}</div>`;
}
function ligarGraficos(raiz) {
  raiz.querySelectorAll('svg.grf').forEach(svg => {
    const cfg = JSON.parse(raiz.querySelector(`script[data-for="${svg.id}"]`).textContent);
    const linhaTip = i => `<b>${cfg.xs[i]}</b>${cfg.series.map(s => s.vals[i] == null ? '' : `<div><i style="background:${s.cor}"></i>${esc(s.nome)}: <b>${fmtV(s.vals[i], cfg.u)}</b></div>`).join('')}${cfg.metas && cfg.metas[i] != null ? `<div><i style="background:var(--choc)"></i>Meta: <b>${fmtV(cfg.metas[i], cfg.u)}</b></div>` : ''}`;
    if (svg.dataset.tipo === 'linha') {
      const hov = svg.querySelector('.hov'), xh = svg.querySelector('.xh');
      hov.addEventListener('mousemove', e => { const r = svg.getBoundingClientRect(), sx = (e.clientX - r.left) * cfg.W / r.width, i = Math.max(0, Math.min(cfg.n - 1, Math.round((sx - cfg.L) / (cfg.iw / Math.max(1, cfg.n - 1))))), x = cfg.L + i * cfg.iw / Math.max(1, cfg.n - 1);
        xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.style.display = ''; dica(e, linhaTip(i)); });
      hov.addEventListener('mouseleave', e => { xh.style.display = 'none'; dica(e, null); });
    } else svg.querySelectorAll('.hb').forEach(b => { b.addEventListener('mousemove', e => dica(e, linhaTip(+b.dataset.i))); b.addEventListener('mouseleave', e => dica(e, null)); });
  });
  raiz.querySelectorAll('[data-tip]').forEach(el => { if (!el.dataset.tip) return; el.addEventListener('mousemove', e => dica(e, el.dataset.tip)); el.addEventListener('mouseleave', e => dica(e, null)); });
}
const legenda = ss => `<div class="leg">${ss.map(s => `<span><i style="background:${s.cor};${s.tracejado ? 'height:2px;border-top:2px dashed ' + s.cor + ';background:none' : ''}"></i>${esc(s.nome)}</span>`).join('')}</div>`;

/* ---- métricas de carteira e campo (sem R$: o financeiro fica na aba própria) ---- */
const FUNIL = ['visitado', 'negociacao', 'avaliacao', 'ativo'];
// funil a partir da visita: quem entrou em cada etapa, quantos passaram para a próxima e em quantos dias
function metFunil(D, vend) {
  const ent = {}; (D.etapas || []).forEach(e => { const o = ent[e.pdv_id] = ent[e.pdv_id] || {}; if (!o[e.para]) o[e.para] = { em: new Date(e.em), u: e.usuario_id }; });
  const ord = k => FUNIL.indexOf(k);
  const lista = Object.entries(ent).filter(([, o]) => o.visitado && (vend === 'todos' || o.visitado.u === vend)).map(([id, o]) => {
    const pdv = S.pdvs.find(p => p.id === id); let max = 0; FUNIL.forEach((k, i) => { if (o[k]) max = Math.max(max, i); }); if (pdv && ord(pdv.etapa) > max) max = ord(pdv.etapa);
    return { id, o, max, perdido: pdv && ['perdido', 'fechado'].includes(pdv.etapa) && max < 3 }; });
  return FUNIL.map((k, i) => { const chegou = lista.filter(x => x.max >= i), passou = lista.filter(x => x.max > i);
    const dias = lista.filter(x => x.o[k] && x.o[FUNIL[i + 1]]).map(x => (x.o[FUNIL[i + 1]].em - x.o[k].em) / DIA).filter(d => d >= 0);
    const parados = chegou.filter(x => x.max === i && !x.perdido && x.o[k]).map(x => (Date.now() - x.o[k].em) / DIA);
    return { k, n: chegou.length, passou: i < FUNIL.length - 1 ? passou.length : null, conv: i < FUNIL.length - 1 && chegou.length ? passou.length / chegou.length : null,
      dias: dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : null, parados: parados.length, paradoMed: parados.length ? parados.reduce((a, b) => a + b, 0) / parados.length : null }; });
}
// contagens por visita de um cliente (ordem de data), para sell-out, ruptura, trocas e giro
function visitasContadas(D) {
  const pv = {}; (D.contagens || []).forEach(c => { if (!c.visitas) return; const id = c.visita_id || c.visitas.em + c.visitas.pdv_id, v = (pv[c.visitas.pdv_id] = pv[c.visitas.pdv_id] || {})[id] = pv[c.visitas.pdv_id]?.[id] || { em: new Date(c.visitas.em), u: c.visitas.usuario_id, so: 0, tr: 0, lin: 0, zer: 0, cont: [] };
    v.so += +c.sellout || Math.max(0, (+c.deixado_anterior || 0) - (+c.encontrado || 0)); v.tr += +c.troca || 0; if (+c.deixado_anterior > 0) { v.lin++; if (+c.encontrado === 0) v.zer++; } v.cont.push(c); });
  const out = {}; Object.entries(pv).forEach(([id, o]) => out[id] = Object.values(o).sort((a, b) => a.em - b.em)); return out;
}
// giro do expositor: quantos dias ele leva para esvaziar no ritmo de venda do cliente
function giroDe(p, vs) {
  const ex = p.expositor_id ? expo(p.expositor_id) : null; if (!ex?.capacidade || !vs || vs.length < 2) return null;
  const u = vs.slice(-5), dias = (u[u.length - 1].em - u[0].em) / DIA; if (dias < 3) return null;
  const vd = u.slice(1).reduce((a, v) => a + v.so, 0) / dias; if (!(vd > 0)) return { ex, vd: 0, dias: null, st: 'grande', sug: S.base.expositores.slice().sort((a, b) => a.capacidade - b.capacidade)[0] };
  const d = ex.capacidade / vd, alvo = vd * 14, sug = S.base.expositores.filter(x => x.capacidade).slice().sort((a, b) => Math.abs(a.capacidade - alvo) - Math.abs(b.capacidade - alvo))[0];
  return { ex, vd, dias: d, st: d < 7 ? 'pequeno' : d > 28 ? 'grande' : 'ok', sug: sug && sug.id !== ex.id ? sug : null };
}
// saúde de cada cliente (0 a 100): ritmo de compra, sell-out, ruptura, trocas e dias sem visita
function saudeCarteira(D) {
  const VC = visitasContadas(D), R = Object.fromEntries(ritmos(D).map(r => [r.p.id, r])), agora = Date.now();
  const ultVis = {}; (D.visitas || []).forEach(v => { const t = new Date(v.em); if (!ultVis[v.pdv_id] || t > ultVis[v.pdv_id]) ultVis[v.pdv_id] = t; });
  return S.pdvs.filter(p => ['avaliacao', 'ativo', 'risco', 'revisao'].includes(p.etapa)).map(p => {
    const vs = VC[p.id] || [], r = R[p.id], u3 = vs.slice(-3), a3 = vs.slice(-6, -3);
    const ptsRit = !r ? 15 : r.atraso <= 1 ? 35 : r.atraso <= 1.5 ? 20 : r.atraso <= 2 ? 8 : 0;
    const so3 = u3.reduce((a, v) => a + v.so, 0), soA = a3.reduce((a, v) => a + v.so, 0), tend = a3.length >= 2 && soA ? so3 / u3.length / (soA / a3.length) - 1 : null;
    const ptsSo = tend == null ? 12 : tend >= -0.1 ? 20 : tend >= -0.3 ? 10 : 0;
    const lin = u3.reduce((a, v) => a + v.lin, 0), rup = lin ? u3.reduce((a, v) => a + v.zer, 0) / lin : null, ptsRup = rup == null ? 10 : rup === 0 ? 15 : rup <= 0.2 ? 8 : 0;
    const v90 = vs.filter(v => v.em > agora - 90 * DIA), so90 = v90.reduce((a, v) => a + v.so, 0), tr90 = v90.reduce((a, v) => a + v.tr, 0), troca = so90 ? tr90 / so90 : null, ptsTr = troca == null ? 10 : troca <= 0.05 ? 15 : troca <= 0.12 ? 8 : 0;
    const semVis = ultVis[p.id] ? Math.floor((agora - ultVis[p.id]) / DIA) : null, ptsVis = semVis == null ? 8 : semVis <= 21 ? 15 : semVis <= 45 ? 8 : 0;
    const nota = ptsRit + ptsSo + ptsRup + ptsTr + ptsVis, faixa = nota >= 70 ? 'ok' : nota >= 45 ? 'atencao' : 'risco';
    const dSo = vs.length >= 2 ? (vs[vs.length - 1].em - vs[Math.max(0, vs.length - 5)].em) / DIA : 0, soSem = dSo > 3 ? vs.slice(Math.max(1, vs.length - 4)).reduce((a, v) => a + v.so, 0) / dSo * 7 : null;
    return { p, nota, faixa, partes: { ritmo: ptsRit, sellout: ptsSo, ruptura: ptsRup, troca: ptsTr, visita: ptsVis }, r, tend, rup, troca, semVis, soSem, giro: giroDe(p, vs), vs };
  }).sort((a, b) => a.nota - b.nota);
}
const FAIXA_S = { ok: { n: 'Saudável', c: '#16A34A', i: '🟢' }, atencao: { n: 'Atenção', c: '#F5A524', i: '🟡' }, risco: { n: 'Risco', c: '#DC2626', i: '🔴' } };
const pctM = v => v == null ? '—' : Math.round(v * 100) + '%';
// ruptura e trocas no período (contagens das reposições), com o filtro de vendedor
function metExpositor(D, ini, fim, vend) {
  const cs = (D.contagens || []).filter(c => c.visitas && new Date(c.visitas.em) >= ini && new Date(c.visitas.em) < fim && (vend === 'todos' || c.visitas.usuario_id === vend));
  const lin = cs.filter(c => +c.deixado_anterior > 0), zer = lin.filter(c => +c.encontrado === 0);
  const so = cs.reduce((a, c) => a + (+c.sellout || Math.max(0, (+c.deixado_anterior || 0) - (+c.encontrado || 0))), 0), tr = cs.reduce((a, c) => a + (+c.troca || 0), 0);
  const porSab = {}, porCli = {}; lin.forEach(c => { const k = c.produto_id; porSab[k] = porSab[k] || { n: 0, z: 0 }; porSab[k].n++; if (+c.encontrado === 0) porSab[k].z++; const q = c.visitas.pdv_id; porCli[q] = porCli[q] || { n: 0, z: 0 }; porCli[q].n++; if (+c.encontrado === 0) porCli[q].z++; });
  return { lin: lin.length, zer: zer.length, rup: lin.length ? zer.length / lin.length : null, so, tr, troca: so ? tr / so : null, porSab, porCli, visitas: new Set(cs.map(c => c.visita_id || c.visitas.em)).size };
}
// produtividade de campo no período, para quem estiver no filtro (você, Moisés ou todos)
function metCampo(D, ini, fim, vend) {
  const em = x => new Date(x) >= ini && new Date(x) < fim, eu = u => vend === 'todos' || u === vend;
  const vis = (D.visitas || []).filter(v => em(v.em) && eu(v.usuario_id)), rep = vis.filter(v => v.tipo === 'reposicao').length, pro = vis.filter(v => v.tipo === 'prospeccao').length;
  const porDia = {}; vis.forEach(v => { const k = (v.usuario_id || '') + '|' + isoDe(new Date(v.em)); (porDia[k] = porDia[k] || []).push(new Date(v.em)); });
  const dias = Object.keys(porDia).length, gaps = Object.values(porDia).flatMap(ts => ts.sort((a, b) => a - b).slice(1).map((t, i) => (t - ts[i]) / 60000)).filter(g => g > 2 && g <= 120);
  const rotas = (D.rotas || []).filter(r => r.data && new Date(r.data + 'T12:00') >= ini && new Date(r.data + 'T12:00') < fim && new Date(r.data + 'T12:00') <= new Date() && eu(r.motorista) && (r.paradas || []).length);
  const visDia = {}; (D.visitas || []).forEach(v => visDia[v.pdv_id + '|' + isoDe(new Date(v.em))] = 1);
  let plan = 0, feitas = 0; rotas.forEach(r => (r.paradas || []).forEach(s => { plan++; if (s.status === 'feito' || s.status === 'ausente' || visDia[s.id + '|' + r.data]) feitas++; }));
  const motivos = { 'Postergada': 0, 'Cliente negou': 0, 'Não estava': 0 };
  (D.notas || []).filter(n => em(n.em) && eu(n.autor)).forEach(n => { if (/Entrega postergada/.test(n.texto)) motivos['Postergada']++; else if (/negou a reposi/.test(n.texto)) motivos['Cliente negou']++; });
  vis.filter(v => v.resultado === 'nao_estava' || v.tipo === 'nao_estava').forEach(() => motivos['Não estava']++);
  return { vis: vis.length, rep, pro, dias, porDia: dias ? vis.length / dias : null, tempo: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null, rotas: rotas.length, plan, feitas, cumprida: plan ? feitas / plan : null, motivos };
}
function blocoCarteira(D, ini, fim, rotPer) {
  const F = metFunil(D, PV.vend), E = metExpositor(D, ini, fim, PV.vend), C = metCampo(D, ini, fim, PV.vend), SC = saudeCarteira(D);
  const nF = k => SC.filter(x => x.faixa === k).length, giros = SC.map(x => x.giro).filter(Boolean);
  const prod = Object.fromEntries(S.base.produtos.map(p => [p.id, p]));
  const kp = (n, v, sub) => `<div class="kpi"><small>${n}</small><b>${v}</b>${sub ? `<small class="sub">${sub}</small>` : ''}</div>`;
  const maxF = Math.max(1, F[0].n);
  return `<h2 class="psec">Carteira e campo <button class="btn" id="pvDetCart" style="margin-left:10px;font-size:12px;padding:5px 10px">Detalhes da carteira →</button></h2>
  <div class="pgrid">
   <div class="panel"><h3>Funil a partir da visita</h3><p class="psub">Todos os pontos que já foram visitados${PV.vend === 'todos' ? '' : ' por ' + esc(nomeVend(PV.vend))} · % que passa para a etapa seguinte e dias até passar</p>
    <div class="funil">${F.map((f, i) => `<div class="fz"><div class="fzb" style="width:${Math.max(6, f.n / maxF * 100)}%;background:${etapa(f.k).c}"><span>${etapa(f.k).n}</span><b>${f.n}</b></div>
     ${f.conv != null ? `<div class="fzc"><b>${pctM(f.conv)}</b> passam${f.dias != null ? ` · <b>${Math.round(f.dias)} dias</b> em média` : ''}${f.parados ? ` · ${f.parados} parados aqui há ~${Math.round(f.paradoMed)} dias` : ''}</div>` : ''}</div>`).join('')}</div>
    ${F[0].n ? '' : '<p class="empty" style="padding:10px 0">Ainda não há pontos que passaram por "Visitado". O funil começa a encher quando as visitas de prospecção mudarem a etapa.</p>'}</div>
   <div class="panel"><h3>Expositor · ${rotPer}</h3><p class="psub">Das contagens de reposição</p>
    <div class="kpis k2">${kp('Ruptura', pctM(E.rup), `${E.zer} de ${E.lin} sabores encontrados zerados`)}${kp('Índice de troca', pctM(E.troca), `${fmt(E.tr)} trocas para ${fmt(E.so)} vendidas`)}
     ${kp('Expositor pequeno', giros.filter(g => g.st === 'pequeno').length, 'esvazia em menos de 7 dias')}${kp('Expositor grande', giros.filter(g => g.st === 'grande').length, 'leva mais de 28 dias para girar')}</div>
    ${Object.keys(E.porSab).length ? `<p class="psub" style="margin-top:10px">Sabores que mais zeram</p>${ranking(Object.entries(E.porSab).map(([k, v]) => ({ n: prod[k] ? (prod[k].linha || '').split(' ')[0] + ' ' + prod[k].sabor : k, v: v.z / v.n, c: COR.ruim, tip: `${v.z} de ${v.n} contagens zeradas` })).sort((a, b) => b.v - a.v).slice(0, 5), '%', { max: 1 })}` : ''}</div>
  </div>
  <div class="pgrid">
   <div class="panel"><h3>Saúde da carteira</h3><p class="psub">Nota de 0 a 100: ritmo de compra, sell-out, ruptura, trocas e dias sem visita</p>
    <div class="mixn">${['ok', 'atencao', 'risco'].map(k => `<div><b style="color:${FAIXA_S[k].c}">${nF(k)}</b><small>${FAIXA_S[k].i} ${FAIXA_S[k].n}</small></div>`).join('')}</div>
    <div class="lst" style="margin-top:10px">${SC.filter(x => x.faixa !== 'ok').slice(0, 8).map(x => `<div class="trow" data-cmet="${x.p.id}"><i style="background:${FAIXA_S[x.faixa].c}"></i><div style="flex:1"><b>${esc(x.p.nome)}</b><br><small style="color:var(--mute)">${motivoSaude(x)}</small></div><b>${x.nota}</b></div>`).join('') || '<p class="psub">Nenhum cliente em atenção ou risco.</p>'}</div></div>
   <div class="panel"><h3>Produtividade de campo · ${rotPer}</h3><p class="psub">${PV.vend === 'todos' ? 'Todos' : esc(nomeVend(PV.vend))}</p>
    <div class="kpis k2">${kp('Visitas', C.vis, `${C.rep} reposições · ${C.pro} prospecções`)}${kp('Visitas por dia de rua', C.porDia == null ? '—' : dec(C.porDia), `${C.dias} dia${C.dias === 1 ? '' : 's'} com visita`)}
     ${kp('Rota cumprida', pctM(C.cumprida), C.plan ? `${C.feitas} de ${C.plan} paradas em ${C.rotas} rota${C.rotas === 1 ? '' : 's'}` : 'sem rota salva no período')}${kp('Tempo por parada', C.tempo == null ? '—' : Math.round(C.tempo) + ' min', 'entre uma visita e a próxima')}</div>
    <p class="psub" style="margin-top:10px">Motivos de não atender</p>${ranking(Object.entries(C.motivos).map(([n, v]) => ({ n, v, c: COR.s2 })), 'n')}</div>
  </div>`;
}
function motivoSaude(x) { const m = [];
  if (x.r && x.r.atraso > 1.3) m.push(`${x.r.semPed} dias sem pedido (ritmo ${Math.round(x.r.inter)})`); if (x.tend != null && x.tend < -0.1) m.push(`sell-out ${Math.round(x.tend * 100)}%`);
  if (x.rup) m.push(`ruptura ${pctM(x.rup)}`); if (x.troca > 0.05) m.push(`troca ${pctM(x.troca)}`); if (x.semVis == null || x.semVis > 21) m.push(x.semVis == null ? 'nunca visitado' : `${x.semVis} dias sem visita`);
  return esc(m.join(' · ') || 'pouco histórico'); }
// tela: a carteira inteira com as métricas, ordenável; o nome abre os detalhes do cliente
async function telaCarteiraMet() {
  $('#main').innerHTML = '<section class="view on"><div class="loading">Calculando a carteira…</div></section>';
  try { if (!PV.dados) { PV.dados = prepararPainel(await db.painelDados()); PV.t = Date.now(); } } catch (e) { return erro(e); }
  const SC = saudeCarteira(PV.dados); S.cmOrd = S.cmOrd || 'nota';
  const col = { nota: x => x.nota, nome: x => x.p.nome, rup: x => x.rup ?? -1, troca: x => x.troca ?? -1, so: x => x.soSem ?? -1, giro: x => x.giro?.dias ?? 999, vis: x => x.semVis ?? 9999, atraso: x => x.r?.atraso ?? -1 };
  const draw = () => { const f = S.cmFil || '', ls = SC.filter(x => !f || x.faixa === f).sort((a, b) => { const va = col[S.cmOrd](a), vb = col[S.cmOrd](b); return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * (S.cmDesc ? -1 : 1); });
    $('#cmT').innerHTML = `<tr>${[['nome', 'Cliente'], ['nota', 'Saúde'], ['atraso', 'Ritmo de compra'], ['so', 'Sell-out/sem.'], ['rup', 'Ruptura'], ['troca', 'Troca'], ['giro', 'Giro do expositor'], ['vis', 'Última visita']].map(([k, n]) => `<th data-o="${k}">${n}${S.cmOrd === k ? (S.cmDesc ? ' ▼' : ' ▲') : ''}</th>`).join('')}</tr>` +
      ls.map(x => `<tr><td><a href="#" data-cli="${x.p.id}"><b>${esc(x.p.nome)}</b></a><br><small style="color:var(--mute)">${esc(etapa(x.p.etapa).n)}${x.p.bairro ? ' · ' + esc(x.p.bairro) : ''}</small></td>
       <td><span class="badge" style="background:${FAIXA_S[x.faixa].c};color:#fff">${x.nota}</span> <small>${FAIXA_S[x.faixa].n}</small></td>
       <td>${x.r ? `${x.r.semPed} d sem pedido<br><small style="color:var(--mute)">compra a cada ${Math.round(x.r.inter)} d</small>` : '—'}</td>
       <td>${x.soSem == null ? '—' : dec(x.soSem) + ' un.'}${x.tend != null ? `<br><small class="${x.tend >= 0 ? 'up' : 'dn'}">${x.tend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(x.tend * 100))}%</small>` : ''}</td>
       <td>${pctM(x.rup)}</td><td>${pctM(x.troca)}</td>
       <td>${x.giro ? `${x.giro.dias == null ? 'parado' : Math.round(x.giro.dias) + ' dias'} <small style="color:var(--mute)">· ${esc(x.giro.ex.nome)}</small>${x.giro.st !== 'ok' ? `<br><small style="color:${x.giro.st === 'pequeno' ? 'var(--t-bad)' : 'var(--car-d)'}">${x.giro.st === 'pequeno' ? 'pequeno' : 'grande'}${x.giro.sug ? ' → ' + esc(x.giro.sug.nome) : ''}</small>` : ''}` : '<small style="color:var(--mute)">sem contagens</small>'}</td>
       <td>${x.semVis == null ? 'nunca' : x.semVis + ' dias'}</td></tr>`).join('');
    $('#cmT').querySelectorAll('th[data-o]').forEach(th => th.onclick = () => { if (S.cmOrd === th.dataset.o) S.cmDesc = !S.cmDesc; else { S.cmOrd = th.dataset.o; S.cmDesc = false; } draw(); });
    $('#cmT').querySelectorAll('[data-cli]').forEach(a => a.onclick = e => { e.preventDefault(); S.perfilId = a.dataset.cli; S.sel = a.dataset.cli; irPara('pedcli'); }); };
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl"><div class="row" style="gap:8px"><button class="btn" id="cmVoltar">← Painel</button><span style="color:var(--mute)">Detalhes da carteira · ${SC.length} clientes</span></div>
   <div class="row" style="gap:6px;flex-wrap:wrap">${[['', 'Todos'], ['risco', '🔴 Risco'], ['atencao', '🟡 Atenção'], ['ok', '🟢 Saudável']].map(([k, n]) => `<button class="mini ${(S.cmFil || '') === k ? 'on' : ''}" data-f="${k}">${n} (${k ? SC.filter(x => x.faixa === k).length : SC.length})</button>`).join('')}</div>
   <div class="panel" style="overflow-x:auto"><table class="dped" id="cmT"></table></div>
   <small style="color:var(--mute)">Saúde: ritmo de compra 35 pts · sell-out em alta ou estável 20 · sem ruptura nas 3 últimas contagens 15 · troca até 5% em 90 dias 15 · visita nos últimos 21 dias 15. Giro: dias para o expositor esvaziar no ritmo de venda (bom entre 7 e 28).</small></div></section>`;
  $('#cmVoltar').onclick = () => voltar('painel');
  document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.cmFil = b.dataset.f; document.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  draw();
}
// no detalhe do cliente: as mesmas métricas só dele
function blocoMetCliente(id) {
  if (!PV.dados) return '<div id="cliMet"></div>';
  const x = saudeCarteira(PV.dados).find(y => y.p.id === id); if (!x) return '';
  const pt = x.partes, barra = (n, v, m) => `<div class="hp"><span>${n}</span><div class="rb"><i style="width:${v / m * 100}%;background:${v / m >= .7 ? '#16A34A' : v / m >= .4 ? '#F5A524' : '#DC2626'}"></i></div><b>${v}/${m}</b></div>`;
  const vs = x.vs.slice(-8);
  return `<div class="panel"><h3>Saúde e expositor <span class="badge" style="background:${FAIXA_S[x.faixa].c};color:#fff;margin-left:6px">${x.nota} · ${FAIXA_S[x.faixa].n}</span></h3><p class="psub">${motivoSaude(x)}</p>
   <div class="pgrid" style="margin:0"><div>${barra('Ritmo de compra', pt.ritmo, 35)}${barra('Sell-out', pt.sellout, 20)}${barra('Sem ruptura', pt.ruptura, 15)}${barra('Troca baixa', pt.troca, 15)}${barra('Visita recente', pt.visita, 15)}</div>
   <div class="kpis k2" style="margin:0"><div class="kpi"><small>Ruptura (3 últimas)</small><b>${pctM(x.rup)}</b></div><div class="kpi"><small>Troca (90 dias)</small><b>${pctM(x.troca)}</b></div>
    <div class="kpi"><small>Sell-out</small><b>${x.soSem == null ? '—' : dec(x.soSem) + ' un./sem.'}</b>${x.tend != null ? `<small class="sub ${x.tend >= 0 ? 'up' : 'dn'}">${x.tend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(x.tend * 100))}% nas 3 últimas</small>` : ''}</div>
    <div class="kpi"><small>Giro do expositor</small><b>${x.giro ? (x.giro.dias == null ? 'parado' : Math.round(x.giro.dias) + ' dias') : '—'}</b><small class="sub">${x.giro ? esc(x.giro.ex.nome) + ' · ' + x.giro.ex.capacidade + ' un.' + (x.giro.st !== 'ok' ? ` · ${x.giro.st === 'pequeno' ? 'pequeno' : 'grande'}${x.giro.sug ? ', sugestão: ' + esc(x.giro.sug.nome) : ''}` : ' · tamanho certo') : 'precisa de 2 contagens'}</small></div></div></div>
   ${vs.length >= 2 ? `<p class="psub" style="margin-top:12px">Sell-out e trocas por reposição</p>${grafBarras('cmSo', vs.map(v => v.em.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })), [{ nome: 'Sell-out', cor: COR.s1, vals: vs.map(v => v.so) }, { nome: 'Trocas', cor: COR.s2, vals: vs.map(v => v.tr) }], 'un', { h: 180 })}${legenda([{ nome: 'Sell-out', cor: COR.s1 }, { nome: 'Trocas', cor: COR.s2 }])}` : ''}</div>`;
}

/* ---- painel de um dia ---- */
function painelDia(D, vends) {
  const hojeI = hojeISO(); if (!PV.dia) PV.dia = hojeI; if (!PV.cmpDia) PV.cmpDia = 'sem';
  const ini = new Date(PV.dia + 'T00:00'), fim = new Date(+ini + DIA), dC = new Date(+ini - (PV.cmpDia === 'sem' ? 7 : 1) * DIA), fimC = new Date(+dC + DIA);
  const peds = pedidosDe(D, ini, fim), N = numeros(peds), NC = numeros(pedidosDe(D, dC, fimC));
  const rotC = PV.cmpDia === 'sem' ? `${DIAS[dC.getDay()].toLowerCase()} passada (${dstr(dC)})` : `dia anterior (${dstr(dC)})`;
  const dvar = (v, c) => c ? (v - c) / c : null;
  const card = (n, v, c, u, sub = '') => { const d = dvar(v, c); return `<div class="kpi"><small>${n}</small><b>${fmtV(v, u)}</b><div class="kmeta"><span>vs ${rotC}</span>${d == null ? `<span>${c === 0 && v ? 'novo' : '—'}</span>` : `<span class="${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}%</span>`}</div>${sub}</div>`; };
  // últimos 30 dias até o dia escolhido
  const dias30 = Array.from({ length: 30 }, (_, i) => new Date(+ini - (29 - i) * DIA)), fat30 = dias30.map(d => numeros(pedidosDe(D, d, new Date(+d + DIA))).fat);
  const sab = {}; peds.forEach(o => o.itens.forEach(i => { const k = i.l + '|' + i.sabor; sab[k] = sab[k] || { n: i.sabor, l: i.l, q: 0 }; sab[k].q += i.q; }));
  const sabL = Object.values(sab).sort((a, b) => b.q - a.q), corL = k => (LINHAS.find(l => l.k === k) || {}).c || COR.neutro, nomeL = k => (LINHAS.find(l => l.k === k) || {}).n || '';
  const vis = D.visitas.filter(v => new Date(v.em) >= ini && new Date(v.em) < fim && (PV.vend === 'todos' || v.usuario_id === PV.vend));
  const cads = S.pdvs.filter(p => new Date(p.criado_em) >= ini && new Date(p.criado_em) < fim && !['carteira_atual', 'google_maps'].includes(p.origem));
  const nomeP = id => S.pdvs.find(p => p.id === id)?.nome || 'Cliente';
  const fds = ini.getDay() === 0 || ini.getDay() === 6;
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl">
  <div class="pfiltros"><div><h2>Painel</h2><small>${DIAS[ini.getDay()]}, ${dataLonga(ini)}${PV.dia === hojeI ? ' · hoje, até agora' : ''} · ${PV.vend === 'todos' ? 'todos os vendedores' : esc(nomeVend(PV.vend))}</small></div>
   <div class="row" style="gap:8px;flex-wrap:wrap"><select id="pvPer">${[['dia', 'Por dia'], ['semana', 'Por semana'], ['mes', 'Por mês'], ['90d', 'Últimos 90 dias'], ['6m', 'Últimos 6 meses'], ['ano', 'Por ano'], ['custom', 'Personalizado']].map(([k, n]) => `<option value="${k}" ${k === 'dia' ? 'selected' : ''}>${n}</option>`).join('')}</select>
   <button class="btn" id="pvDiaAnt" title="Dia anterior">◀</button><input type="date" id="pvDia" value="${PV.dia}" max="${hojeI}"><button class="btn" id="pvDiaProx" title="Próximo dia" ${PV.dia >= hojeI ? 'disabled' : ''}>▶</button>
   <select id="pvCmpDia"><option value="sem" ${PV.cmpDia === 'sem' ? 'selected' : ''}>vs mesmo dia da semana passada</option><option value="ant" ${PV.cmpDia === 'ant' ? 'selected' : ''}>vs dia anterior</option></select>
   <select id="pvVend"><option value="todos">Todos os vendedores</option>${vends.map(v => `<option value="${v}" ${PV.vend === v ? 'selected' : ''}>${esc(nomeVend(v))}</option>`).join('')}</select>
   <button class="btn" id="pvAtual" title="Recarregar os dados">↻</button></div></div>
  <div class="kpis">${card('Faturamento', N.fat, NC.fat, 'R$')}${card('Margem', N.margem, NC.margem, 'R$', `<small class="sub">${N.margemP != null ? Math.round(N.margemP * 100) + '% de margem' : ''}</small>`)}${card('Pedidos', peds.length, pedidosDe(D, dC, fimC).length, 'un', `<small class="sub">${N.compradores} cliente${N.compradores === 1 ? '' : 's'}</small>`)}${card('Unidades', N.un, NC.un, 'un', `<small class="sub">ticket ${fmtV(N.ticket, 'R$')}</small>`)}</div>
  <div class="pgrid">
   <div class="panel"><h3>Últimos 30 dias</h3><p class="psub">Faturamento por dia até ${dstr(ini)}</p>${grafBarras('gDia30', dias30.map(d => String(d.getDate())), [{ nome: 'Faturamento', cor: COR.s1, vals: fat30 }], 'R$')}</div>
   <div class="panel"><h3>Saída de produtos no dia</h3><p class="psub">Unidades por sabor</p>${sabL.length ? ranking(sabL.map(x => ({ n: `${x.n} · ${nomeL(x.l)}`, v: x.q, c: corL(x.l) })), 'un') : `<p class="empty">${peds.length ? 'Os pedidos do dia não têm itens detalhados.' : 'Nenhum pedido neste dia.'}</p>`}</div>
  </div>
  <div class="panel"><h3>Pedidos do dia</h3>${peds.length ? `<table class="dped"><tr><th>Cliente</th><th>Tipo</th><th>Un.</th><th>Vendedor</th><th style="text-align:right">Valor</th></tr>${peds.slice().sort((a, b) => b.valor - a.valor).map(o => `<tr class="lnk" data-pdv="${o.pdv_id}"><td><b>${esc(nomeP(o.pdv_id))}</b></td><td>${o.tipo === 'abertura' ? 'Abertura' : 'Reposição'}</td><td>${fmt(o.un)}</td><td>${esc(nomeVend(o.vend))}</td><td style="text-align:right"><b>${brl(o.valor)}</b></td></tr>`).join('')}</table>` : `<p class="empty">Nenhum pedido em ${dstr(ini)}${fds ? ' (fim de semana)' : ''}.</p>`}</div>
  <div class="pgrid">
   <div class="panel"><h3>Atividade do dia</h3><div class="kv" style="margin:0"><div><small>Visitas de prospecção</small><b>${vis.filter(v => v.tipo === 'prospeccao').length}</b></div><div><small>Reposições</small><b>${vis.filter(v => v.tipo === 'reposicao').length}</b></div><div><small>Aberturas</small><b>${vis.filter(v => v.tipo === 'abertura').length}</b></div><div><small>Pontos cadastrados</small><b>${cads.length}</b></div></div></div>
   <div class="panel"><h3>Faturamento por linha</h3>${ranking(LINHAS.map(l => ({ n: l.n, v: peds.reduce((a, o) => a + o.itens.filter(i => i.l === l.k).reduce((b, i) => b + i.rec, 0), 0), c: l.c })), 'R$')}</div>
  </div></div></section>`;
  const vai = d => { PV.dia = d > hojeI ? hojeI : d; telaPainel(); };
  $('#pvPer').onchange = e => { PV.per = e.target.value; telaPainel(); };
  $('#pvDia').onchange = e => e.target.value && vai(e.target.value);
  $('#pvDiaAnt').onclick = () => vai(isoDe(new Date(+ini - DIA)));
  $('#pvDiaProx').onclick = () => vai(isoDe(new Date(+ini + DIA)));
  $('#pvCmpDia').onchange = e => { PV.cmpDia = e.target.value; telaPainel(); };
  $('#pvVend').onchange = e => { PV.vend = e.target.value; telaPainel(); };
  $('#pvAtual').onclick = () => telaPainel(true);
  document.querySelectorAll('tr[data-pdv]').forEach(tr => tr.onclick = () => abrirPerfil(tr.dataset.pdv));
  ligarGraficos($('#main section'));
}

/* ---- a tela ---- */
async function telaPainel(recarregarDados) {
  $('#main').innerHTML = '<section class="view on"><div class="loading">Montando o painel…</div></section>';
  try { if (!PV.dados || recarregarDados || Date.now() - PV.t > 5 * 60000) { PV.dados = prepararPainel(await db.painelDados()); PV.t = Date.now(); } } catch (e) { $('#main').innerHTML = `<section class="view on"><div class="empty">Não consegui carregar o painel: ${esc(e.message)}</div></section>`; return; }
  const D = PV.dados, hoje = new Date();
  if (!PV.mes) PV.mes = mesKey(hoje); if (!PV.per) PV.per = 'mes'; if (!PV.ano) PV.ano = String(hoje.getFullYear());
  const meses = [...new Set([mesKey(hoje), ...D.pedidos.map(o => o.mes)])].sort().reverse(), anos = [...new Set(meses.map(m => m.slice(0, 4)))];
  const vends = [...new Set(D.pedidos.map(o => o.vend))];
  if (PV.per === 'dia') return painelDia(D, vends);
  // períodos: mês, ano ou uma faixa de datas (semana, últimos 3 ou 6 meses, personalizado), sempre comparada com a faixa anterior do mesmo tamanho
  const FX = ['semana', '90d', '6m', 'custom'].includes(PV.per), porAno = PV.per === 'ano', fx = FX ? faixaPainel(hoje) : null;
  const mes = FX ? mesKey(new Date(+fx.fim - DIA)) : porAno ? PV.ano + '-12' : PV.mes, mesC = PV.cmp === 'ano' ? mesSoma(mes, -12) : mesSoma(mes, -1);
  const mesesPer = porAno ? Array.from({ length: 12 }, (_, i) => PV.ano + '-' + String(i + 1).padStart(2, '0')) : [mes];
  const ini = FX ? fx.ini : porAno ? new Date(+PV.ano, 0, 1) : mesIni(mes), fim = FX ? fx.fim : porAno ? new Date(+PV.ano + 1, 0, 1) : mesFim(mes), atual = hoje >= ini && hoje < fim, corte = atual ? hoje : fim;
  const rot = FX ? fx.rot : porAno ? 'Ano de ' + PV.ano : mesNome(mes), rotC = FX ? 'período anterior' : porAno ? String(+PV.ano - 1) : mesNome(mes, true), unid = FX ? (PV.per === 'semana' ? 'semana' : 'período') : porAno ? 'ano' : 'mês';
  const rotCurto = FX ? fx.curto : porAno ? PV.ano : mesNome(mes, true), doU = unid === 'semana' ? 'da semana' : 'do ' + unid, noU = unid === 'semana' ? 'na semana' : 'no ' + unid;
  const N = numeros(pedidosDe(D, ini, fim)), duTot = FX ? diasUteisEntre(ini, fim) : mesesPer.flatMap(k => diasUteis(k)), duPass = duTot.filter(d => d <= isoDe(corte)).length;
  // comparação no mesmo ponto do período (se for o atual)
  const lenFx = +fim - +ini, iniC = FX ? new Date(+ini - lenFx) : porAno ? new Date(+PV.ano - 1, 0, 1) : mesIni(mesC), fimC0 = FX ? new Date(+ini) : porAno ? new Date(+PV.ano, 0, 1) : mesFim(mesC);
  const fimCmp = atual ? new Date(Math.min(+fimC0, +iniC + (+corte - +ini))) : fimC0, NC = numeros(pedidosDe(D, iniC, fimCmp));
  const iniAnt = FX ? iniC : porAno ? new Date(+PV.ano - 1, 0, 1) : mesIni(mesSoma(mes, -1));
  const B = base(D, ini, fim, iniAnt), BC = base(D, iniC, fimC0, FX ? new Date(+iniC - lenFx) : porAno ? new Date(+PV.ano - 2, 0, 1) : mesIni(mesSoma(mesC, -1)));
  // meta do período: no ano, soma dos meses (indicadores de soma) ou média dos meses com meta
  const metaPer = (k) => { if (FX) return null; if (!porAno) return metaDe(mes, PV.vend, k); const vs = mesesPer.map(m => metaDe(m, PV.vend, k)).filter(v => v != null); if (!vs.length) return null; if (IND.find(i => i[0] === k)[3]) return vs.length === 12 ? vs.reduce((a, b) => a + b, 0) : null; return vs.reduce((a, b) => a + b, 0) / vs.length; };
  const proj = (v) => atual && duPass ? v / duPass * duTot.length : v;
  const vals = { fat: N.fat, margem: N.margem, compradores: N.compradores, ticket: N.ticket, un: N.un, novos: B.novos, segundo: B.segundo, retencao: B.retencao };
  const valsC = { fat: NC.fat, margem: NC.margem, compradores: NC.compradores, ticket: NC.ticket, un: NC.un, novos: BC.novos, segundo: BC.segundo, retencao: BC.retencao };
  const card = (k, extra = '') => { const [, n, u, aditivo] = IND.find(i => i[0] === k), v = vals[k], m = metaPer(k), pr = aditivo ? proj(v) : v, r = m ? razao(atual && aditivo ? pr : v, m) : null, f = faixa(r), dv = u === '%' ? (v != null && valsC[k] != null ? v - valsC[k] : null) : valsC[k] ? (v - valsC[k]) / Math.abs(valsC[k]) : null;
    return `<div class="kpi"><small>${n}</small><b>${fmtV(v, u)}</b>${extra}
      ${m != null ? `<div class="kbar"><i style="width:${Math.min(100, (v / m) * 100)}%;background:${f?.c || COR.s1}"></i>${atual && aditivo ? `<em style="left:${Math.min(100, pr / m * 100)}%"></em>` : ''}</div>
      <div class="kmeta"><span>Meta ${fmtV(m, u)}</span>${f ? `<span class="st" style="--c:${f.c}">${f.ic} ${f.n} · ${Math.round(r * 100)}%</span>` : ''}</div>` : `<div class="kmeta"><span style="color:var(--mute)">sem meta · <a href="#" data-bo>definir</a></span></div>`}
      ${atual && aditivo ? `<div class="kmeta"><span>Projeção ${doU}</span><b>${fmtV(pr, u)}</b></div>` : ''}
      <div class="kmeta"><span>vs ${FX ? 'período anterior' : porAno ? 'ano anterior' : PV.cmp === 'ano' ? 'mesmo mês do ano passado' : 'mês anterior'}${atual ? ' (mesmo ponto)' : ''}</span>${dv == null ? '<span>—</span>' : `<span class="${dv >= 0 ? 'up' : 'dn'}">${dv >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(dv * 100))}${u === '%' ? ' p.p.' : '%'}</span>`}</div></div>`; };

  // ritmo do mês: acumulado dia a dia
  const bk = FX ? baldes(ini, fim) : null;
  const nd = FX ? bk.length : porAno ? 12 : new Date(fim - DIA).getDate(), xsD = FX ? bk.map(b => b.lab) : porAno ? mesesPer.map(k => mesNome(k, true).split('/')[0]) : Array.from({ length: nd }, (_, i) => String(i + 1));
  const acum = FX ? (de, peds, ate) => { let s = 0; return bk.map(b => { const a = new Date(+de + (b.a - ini)), z = new Date(+de + (b.b - ini)); if (a > ate) return null; s += peds.filter(o => o.data >= a && o.data < z).reduce((x, o) => x + o.valor, 0); return s; }); } : (de, peds, ate) => { let s = 0; return xsD.map((_, i) => { const d = porAno ? new Date(de.getFullYear(), i, 1) : new Date(+de + i * DIA); if (d > ate) return null; s += peds.filter(o => porAno ? o.data.getMonth() === i : o.data.getDate() === i + 1).reduce((a, o) => a + o.valor, 0); return s; }); };
  const pedM = pedidosDe(D, ini, fim), pedC = pedidosDe(D, iniC, fimC0), mFat = metaPer('fat');
  const serieMeta = mFat ? (porAno ? (() => { let s = 0, alguma = false; const v = mesesPer.map(k => { const m = metaDe(k, PV.vend, 'fat'); if (m != null) alguma = true; s += m || 0; return s; }); return alguma ? v : null; })() : (() => { let k = 0; return xsD.map((_, i) => { const d = isoDe(new Date(+ini + i * DIA)); if (duTot.includes(d)) k++; return mFat * k / duTot.length; }); })()) : null;
  const sRitmo = [{ nome: 'Realizado', cor: COR.s1, vals: acum(ini, pedM, corte) }, { nome: FX ? 'Período anterior' : porAno ? 'Ano anterior' : PV.cmp === 'ano' ? mesNome(mesC, true) : 'Mês anterior', cor: COR.s2, vals: acum(iniC, pedC, fimC0).slice(0, nd), tracejado: true }, ...(serieMeta ? [{ nome: 'Meta', cor: '#5A463B', vals: serieMeta, tracejado: true }] : [])];
  const falta = mFat ? Math.max(0, mFat - N.fat) : null, duRest = duTot.length - duPass;

  // 12 meses
  const m12 = porAno ? mesesPer : Array.from({ length: 12 }, (_, i) => mesSoma(mes, i - 11));
  const fat12 = m12.map(k => numeros(pedidosDe(D, mesIni(k), mesFim(k))));
  // produtos
  const unLinhaMes = (k, l) => pedidosDe(D, mesIni(k), mesFim(k)).reduce((a, o) => a + o.itens.filter(i => i.l === l).reduce((b, i) => b + i.q, 0), 0);
  const temItens = D.pedidos.some(o => o.itens.length);
  const sabores = (peds) => { const m = {}; peds.forEach(o => o.itens.forEach(i => { const k = i.l + '|' + i.sabor; m[k] = m[k] || { l: i.l, sabor: i.sabor, q: 0, rec: 0 }; m[k].q += i.q; m[k].rec += i.rec; })); return m; };
  const sabM = sabores(pedM), sabC = sabores(pedidosDe(D, iniC, fimCmp));
  const rankSab = Object.entries(sabM).sort((a, b) => b[1].q - a[1].q).map(([k, s]) => ({ n: `${s.sabor}`, v: s.q, c: LINHAS.find(l => l.k === s.l).c, d: sabC[k]?.q ? (s.q - sabC[k].q) / sabC[k].q : null, tip: `<b>${esc(LINHAS.find(l => l.k === s.l).n)} · ${esc(s.sabor)}</b><div>${fmt(s.q)} un. · ${brl(s.rec)}</div>${sabC[k] ? `<div>${PV.cmp === 'ano' ? 'Ano passado' : 'Mês anterior'}: ${fmt(sabC[k].q)} un.</div>` : ''}` }));
  // mix: clientes ativos (90 dias) por nº de linhas
  const mix = {}; D.pedidos.filter(o => o.data >= ini && o.data < fim && (PV.vend === 'todos' || o.vend === PV.vend)).forEach(o => { mix[o.pdv_id] = mix[o.pdv_id] || new Set(); o.itens.forEach(i => mix[o.pdv_id].add(i.l)); });
  const mixN = [1, 2, 3].map(n => Object.values(mix).filter(s => s.size === n).length), soUma = Object.entries(mix).filter(([, s]) => s.size === 1).map(([id, s]) => ({ p: S.pdvs.find(x => x.id === id), l: [...s][0] })).filter(x => x.p);
  // trocas (das contagens de reposição)
  const cont = D.contagens.filter(c => c.visitas && new Date(c.visitas.em) >= ini && new Date(c.visitas.em) < fim && (PV.vend === 'todos' || c.visitas.usuario_id === PV.vend));
  const trocaUn = cont.reduce((a, c) => a + (+c.troca || 0), 0), trocaR = cont.reduce((a, c) => a + (+c.troca || 0) * Number(D.prod[c.produto_id]?.custo || 2.5), 0);
  const trocaSab = {}; cont.forEach(c => { if (!c.troca) return; const p = D.prod[c.produto_id] || {}; const k = p.sabor || c.produto_id; trocaSab[k] = trocaSab[k] || { q: 0, r: 0, l: (p.bling_codigo || 'B').charAt(0) }; trocaSab[k].q += +c.troca; trocaSab[k].r += +c.troca * Number(p.custo || 2.5); });
  const trocaPdv = {}; cont.forEach(c => { if (!c.troca) return; trocaPdv[c.visitas.pdv_id] = (trocaPdv[c.visitas.pdv_id] || 0) + +c.troca; });
  // risco e potencial
  const R = ritmos(D), risco = R.filter(r => r.n >= 2 && r.atraso > 1.3 && r.semPed <= 180).sort((a, b) => b.mensal - a.mensal);
  const potencial = R.reduce((a, r) => a + r.mensal, 0), fat90 = D.pedidos.filter(o => o.data > new Date(Date.now() - 90 * DIA)).reduce((a, o) => a + o.valor, 0) / 3;
  // turmas
  const turmas = Array.from({ length: 12 }, (_, i) => mesSoma(mesKey(hoje), i - 11)).map(k => { const cl = Object.entries(D.porPdv).filter(([, ps]) => ps[0].mes === k).map(([id]) => id); return { k, n: cl.length, ret: Array.from({ length: 7 }, (_, j) => { const mk = mesSoma(k, j); if (mk > mesKey(hoje)) return null; return cl.length ? cl.filter(id => D.porPdv[id].some(o => o.mes === mk)).length / cl.length : null; }) }; }).filter(t => t.n);
  const azul = v => { if (v == null) return 'transparent'; const st = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab']; return st[Math.min(9, Math.floor(v * 10))]; };
  // composição
  const porReg = {}, porCanal = {}, porCli = {}; pedM.forEach(o => { const p = S.pdvs.find(x => x.id === o.pdv_id); const rg = p?.regiao || '—', cn = p?.canal || 'Sem canal'; porReg[rg] = (porReg[rg] || 0) + o.valor; porCanal[cn] = (porCanal[cn] || 0) + o.valor; porCli[o.pdv_id] = (porCli[o.pdv_id] || 0) + o.valor; });
  const top10 = Object.values(porCli).sort((a, b) => b - a).slice(0, 10).reduce((a, b) => a + b, 0);
  // atividade comercial
  const vis = D.visitas.filter(v => v.tipo === 'prospeccao' && new Date(v.em) >= ini && new Date(v.em) < fim && (PV.vend === 'todos' || v.usuario_id === PV.vend));
  const cads = S.pdvs.filter(p => new Date(p.criado_em) >= ini && new Date(p.criado_em) < fim && p.origem !== 'carteira_atual' && p.origem !== 'google_maps').length;
  const MT = metas(), visMeta = (MT.visitas_dia || 0) * duTot.length, conv = vis.length ? B.novos / new Set(vis.map(v => v.pdv_id)).size : null;

  $('#main').innerHTML = `<section class="view on"><div class="dash pnl">
  <div class="pfiltros"><div><h2>Painel</h2><small>${rot}${atual && (!FX || PV.per === 'semana') ? ` · ${duPass} de ${duTot.length} dias úteis` : ''} · ${PV.vend === 'todos' ? 'todos os vendedores' : esc(nomeVend(PV.vend))}</small></div>
   <div class="row" style="gap:8px;flex-wrap:wrap"><select id="pvPer">${[['dia', 'Por dia'], ['semana', 'Por semana'], ['mes', 'Por mês'], ['90d', 'Últimos 90 dias'], ['6m', 'Últimos 6 meses'], ['ano', 'Por ano'], ['custom', 'Personalizado']].map(([k, n]) => `<option value="${k}" ${PV.per === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
   ${PV.per === 'semana' ? `<select id="pvSem">${semanasPainel(hoje).map(w => `<option value="${w.v}" ${w.v === PV.sem ? 'selected' : ''}>${w.n}</option>`).join('')}</select>` : PV.per === 'custom' ? `<button class="btn" id="pvCal">📅 ${esc(fx.curto)}</button>` : ''}
   ${FX ? '' : porAno ? `<select id="pvAno">${anos.map(a => `<option ${a === PV.ano ? 'selected' : ''}>${a}</option>`).join('')}</select>` : `<select id="pvMes">${meses.map(k => `<option value="${k}" ${k === mes ? 'selected' : ''}>${mesNome(k)}</option>`).join('')}</select>`}
   ${FX ? '<span class="pcmp">vs período anterior</span>' : porAno ? '<span class="pcmp">vs ano anterior</span>' : `<select id="pvCmp"><option value="ant" ${PV.cmp === 'ant' ? 'selected' : ''}>vs mês anterior</option><option value="ano" ${PV.cmp === 'ano' ? 'selected' : ''}>vs mesmo mês do ano passado</option></select>`}
   <select id="pvVend"><option value="todos">Todos os vendedores</option>${vends.map(v => `<option value="${v}" ${PV.vend === v ? 'selected' : ''}>${esc(nomeVend(v))}</option>`).join('')}</select>
   <button class="btn" id="pvAtual" title="Recarregar os dados">↻</button><button class="btn pri" id="pvBO">⚙️ Metas</button></div></div>

  <div class="kpis">${card('fat')}${card('margem', `<small class="sub">${N.margemP != null ? Math.round(N.margemP * 100) + '% de margem' : ''}${pedM.some(o => o.estimado) ? ' · parte estimada' : ''}</small>`)}${card('compradores', `<small class="sub">${N.pedidos} pedidos</small>`)}${card('ticket', `<small class="sub">${fmt(Math.round(N.un))} unidades</small>`)}</div>

  <div class="pgrid">
   <div class="panel"><h3>Ritmo ${doU}</h3><p class="psub">Faturamento acumulado ${FX ? (bk.semanal ? 'semana a semana' : 'dia a dia') : porAno ? 'mês a mês' : 'dia a dia'}${mFat ? ', contra a meta' : ''}</p>${grafLinhas('gRitmo', xsD, sRitmo, 'R$')}${legenda(sRitmo)}
    <div class="pnota">${mFat ? (atual ? (falta > 0 ? `Faltam <b>${brl(falta)}</b> em ${duRest} dias úteis: <b>${brl(duRest ? falta / duRest : falta)} por dia útil</b>.` : `<b>Meta ${doU} batida.</b>`) : `Fechou em ${Math.round(N.fat / mFat * 100)}% da meta.`) : 'Defina a meta de faturamento em ⚙️ Metas para ver a linha da meta.'}</div></div>
   ${porAno ? `<div class="panel"><h3>Faturamento · meses de ${PV.ano}</h3><p class="psub">Barras: faturamento · traço: meta de cada mês</p>${grafBarras('g12', m12.map(k => mesNome(k, true)), [{ nome: 'Faturamento', cor: COR.s1, vals: fat12.map(n => n.fat) }], 'R$', { metas: m12.map(k => metaDe(k, PV.vend, 'fat')) })}</div>`
     : FX ? `<div class="panel"><h3>Faturamento por ${bk.semanal ? 'semana' : 'dia'} · ${rotCurto}</h3><p class="psub">Quanto entrou em cada ${bk.semanal ? 'semana' : 'dia'} do período</p>${grafBarras('g12', xsD, [{ nome: 'Faturamento', cor: COR.s1, vals: bk.map(b => b.a > corte ? null : numeros(pedidosDe(D, b.a, b.b)).fat) }], 'R$')}</div>`
     : `<div class="panel"><h3>Faturamento por dia · ${mesNome(mes, true)}</h3><p class="psub">Quanto entrou em cada dia do mês${mFat ? ` · meta do mês ${fmtV(mFat, 'R$')}` : ''}</p>${grafBarras('g12', xsD, [{ nome: 'Faturamento', cor: COR.s1, vals: xsD.map((_, i) => { const d0 = new Date(+ini + i * DIA); return d0 > corte ? null : numeros(pedidosDe(D, d0, new Date(+d0 + DIA))).fat; }) }], 'R$')}</div>`}
  </div>

  <h2 class="psec">Saída de produtos</h2>
  ${temItens ? `<div class="pgrid">
   <div class="panel"><h3>Unidades por linha · ${porAno ? 'meses de ' + PV.ano : '12 meses'}</h3>${(() => { const ss = LINHAS.map(l => ({ nome: l.n, cor: l.c, vals: m12.map(k => k > mesKey(hoje) ? null : unLinhaMes(k, l.k)) })); return grafLinhas('gLinhas', m12.map(k => mesNome(k, true)), ss, 'n') + legenda(ss); })()}</div>
   <div class="panel"><h3>Ranking de sabores · ${rotCurto}</h3><p class="psub">Unidades ${noU} e variação ${FX ? 'contra o período anterior' : porAno || PV.cmp === 'ano' ? 'contra o ano anterior' : 'contra o mês anterior'}</p>${rankSab.length ? ranking(rankSab, 'n') + legenda(LINHAS.map(l => ({ nome: l.n, cor: l.c }))) : '<p class="empty">Sem itens neste mês.</p>'}</div>
   <div class="panel"><h3>Mix por cliente · ${rotCurto}</h3><p class="psub">Clientes que compraram ${noU}${PV.vend === 'todos' ? '' : ' (' + esc(nomeVend(PV.vend)) + ')'}, por quantas linhas levam</p>
    <div class="mixn">${mixN.map((n, i) => `<div><b>${n}</b><small>${i + 1} linha${i ? 's' : ''}</small></div>`).join('')}</div>
    ${soUma.length ? `<p class="psub" style="margin-top:10px">Compram só uma linha: oportunidade de oferecer as outras</p><div class="lst">${soUma.slice(0, 8).map(x => `<div class="trow" data-ab="${x.p.id}"><i style="background:${LINHAS.find(l => l.k === x.l)?.c}"></i><div style="flex:1">${esc(x.p.nome)}</div><small>só ${esc(LINHAS.find(l => l.k === x.l)?.n || '')}</small></div>`).join('')}</div>` : ''}</div>
   <div class="panel"><h3>Faturamento por linha · ${rotCurto}</h3>${ranking(LINHAS.map(l => ({ n: l.n, v: pedM.reduce((a, o) => a + o.itens.filter(i => i.l === l.k).reduce((b, i) => b + i.rec, 0), 0), c: l.c })), 'R$')}<p class="psub" style="margin-top:8px">Margem média dos itens: <b>${Math.round(D.margemMedia * 100)}%</b> (preço praticado menos custo da Baccaro)</p></div>
  </div>` : `<div class="panel"><p class="empty">Os itens dos pedidos ainda não foram puxados do Bling. Vá em <b>Regras e metas → Puxar itens dos pedidos</b>.</p></div>`}

  <h2 class="psec">Trocas e impacto financeiro · ${rotCurto}</h2>
  ${cont.length ? `<div class="kpis"><div class="kpi"><small>Unidades trocadas</small><b>${fmt(trocaUn)}</b><small class="sub">${N.un ? (trocaUn / N.un * 100).toFixed(1).replace('.', ',') + '% do vendido ' + noU : ''}</small></div><div class="kpi"><small>Custo das trocas</small><b>${brl(trocaR)}</b><small class="sub">produto perdido, a preço de custo</small></div><div class="kpi"><small>Margem consumida</small><b>${N.margem ? Math.round(trocaR / N.margem * 100) + '%' : '—'}</b><small class="sub">da margem bruta ${doU}</small></div><div class="kpi"><small>Pontos com troca</small><b>${Object.keys(trocaPdv).length}</b></div></div>
   <div class="pgrid"><div class="panel"><h3>Trocas por sabor · ${rotCurto}</h3>${ranking(Object.entries(trocaSab).sort((a, b) => b[1].q - a[1].q).map(([k, s]) => ({ n: k, v: s.q, c: LINHAS.find(l => l.k === s.l)?.c, tip: `<b>${esc(k)}</b><div>${s.q} un. · ${brl(s.r)} de custo</div>` })), 'n')}</div>
   <div class="panel"><h3>Pontos que mais trocam · ${rotCurto}</h3>${ranking(Object.entries(trocaPdv).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, q]) => ({ n: S.pdvs.find(p => p.id === id)?.nome || '—', v: q, c: COR.s2 })), 'n')}</div></div>`
   : `<div class="panel"><p class="empty">Sem trocas registradas em ${rot}. As trocas entram pelas contagens de reposição (aba Reposição): assim que vocês registrarem, aqui aparecem as unidades, o custo e quanto da margem elas consomem.</p></div>`}

  <h2 class="psec">Base de clientes</h2>
  <div class="pgrid">
   <div class="panel"><h3>Movimento da base · ${rotCurto}</h3><p class="psub">Cliente ativo = comprou nos últimos 90 dias</p>${ponte(B)}</div>
   <div class="panel"><h3>Saúde da base</h3><div class="kpis k2">${card('retencao', `<small class="sub">de quem comprou ${noU} anterior</small>`)}${card('segundo', `<small class="sub">${B.coorte} clientes abertos nos últimos 6 meses</small>`)}${card('novos')}
    <div class="kpi"><small>Base ativa ÷ potencial</small><b>${potencial ? Math.round(fat90 / potencial * 100) + '%' : '—'}</b><small class="sub">${brl(fat90)}/mês faturados de ${brl(potencial)}/mês possíveis se todos comprassem no seu ritmo</small></div></div></div>
  </div>
  <div class="pgrid">
   <div class="panel"><h3>Receita em risco · ${brl(risco.reduce((a, r) => a + r.mensal, 0))}/mês</h3><p class="psub">Clientes fora do próprio ritmo de compra, do maior para o menor</p>
    <div class="lst">${risco.slice(0, 12).map(r => `<div class="trow" style="cursor:default"><i style="background:${r.atraso > 2.5 ? COR.ruim : COR.aviso}"></i><div style="flex:1"><b>${esc(r.p.nome)}</b><br><small style="color:var(--mute)">comprava a cada ${Math.round(r.inter)} dias · sem pedido há ${r.semPed} dias · ${r.atraso > 2.5 ? 'parou' : 'atrasado'}</small></div><b style="margin-right:8px">${brl(r.mensal)}/mês</b><button class="mini" data-rtar="${r.p.id}">+ tarefa</button><button class="mini" data-rven="${r.p.id}">venda</button></div>`).join('') || '<p class="empty">Ninguém fora do ritmo. 👏</p>'}</div></div>
   <div class="panel"><h3>Turmas de abertura</h3><p class="psub">% dos clientes abertos em cada mês que compraram no mês 0, 1, 2… depois</p>
    <table class="coh"><tr><th>Abertura</th><th>Clientes</th>${Array.from({ length: 7 }, (_, j) => `<th>M${j}</th>`).join('')}</tr>${turmas.map(t => `<tr><td>${mesNome(t.k, true)}</td><td>${t.n}</td>${t.ret.map(v => `<td style="background:${azul(v)};color:${v != null && v > .55 ? '#fff' : 'var(--choc)'}" data-tip="${v == null ? '' : `${mesNome(t.k, true)}: ${Math.round(v * 100)}% compraram`}">${v == null ? '' : Math.round(v * 100) + '%'}</td>`).join('')}</tr>`).join('')}</table></div>
  </div>

  <h2 class="psec">Composição · ${rotCurto}</h2>
  <div class="pgrid">
   <div class="panel"><h3>Por região</h3>${ranking(Object.entries(porReg).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ n: k + (regNome(k) !== 'sem região' ? ' · ' + regNome(k) : ''), v, c: COR.s1 })), 'R$')}</div>
   <div class="panel"><h3>Por canal</h3>${ranking(Object.entries(porCanal).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ n: k, v, c: COR.s1 })), 'R$')}<p class="psub" style="margin-top:8px">Os 10 maiores clientes fizeram <b>${N.fat ? Math.round(top10 / N.fat * 100) : 0}%</b> do faturamento do ${unid}.</p></div>
  </div>

  <h2 class="psec">Atividade comercial · ${rotCurto}</h2>
  <div class="kpis"><div class="kpi"><small>Visitas de prospecção</small><b>${vis.length}</b>${visMeta ? `<div class="kbar"><i style="width:${Math.min(100, vis.length / visMeta * 100)}%;background:${faixa(vis.length / visMeta).c}"></i></div><div class="kmeta"><span>Meta ${visMeta}</span></div>` : ''}</div>
   <div class="kpi"><small>Conversão visita → cliente</small><b>${conv == null ? '—' : Math.round(conv * 100) + '%'}</b><small class="sub">${B.novos} novos de ${new Set(vis.map(v => v.pdv_id)).size} pontos visitados</small></div>
   <div class="kpi"><small>Pontos cadastrados</small><b>${cads}</b><small class="sub">meta ${(MT.cadastros_semana || 0) * Math.round(duTot.length / 6)} ${noU}</small></div>
   <div class="kpi"><small>Tarefas atrasadas</small><b>${S.pdvs.filter(p => p.acao_data && ymd(p.acao_data) < hojeISO()).length}</b></div></div>

  ${blocoCarteira(D, ini, fim, rotCurto)}
  <div id="orfaosBling"></div>
  ${(() => { const al = alertasProsp(); return al.length ? `<div class="panel alertas"><h3>Alertas de prospecção (${al.length}) · visitados sem próxima ação</h3>${al.slice(0, 30).map(p => `<div class="trow" style="cursor:default"><i style="background:${p.ultimo_resultado === 'nao_estava' ? '#3F6FA8' : etapa(p.etapa).c}"></i><div style="flex:1"><b>${esc(p.nome)}</b><br><small style="color:var(--mute)">${RESULTADOS[p.ultimo_resultado]?.n || 'Visitado'} em ${dstr(p.ultima_prospeccao)}${p.melhor_horario ? ' · melhor horário: ' + esc(p.melhor_horario) : ''}</small></div><button class="mini" data-altar="${p.id}">+ tarefa</button><button class="mini" data-alab="${p.id}">abrir</button></div>`).join('')}</div>` : ''; })()}
  </div></section>`;

  const sec = $('#main section'); ligarGraficos(sec);
  $('#pvPer').onchange = e => { PV.per = e.target.value; if (PV.per === 'custom' && !PV.de) { PV.de = isoDe(new Date(Date.now() - 29 * DIA)); PV.ate = hojeISO(); } telaPainel(); if (PV.per === 'custom') setTimeout(() => $('#pvCal')?.click(), 50); };
  if ($('#pvSem')) $('#pvSem').onchange = e => { PV.sem = e.target.value; telaPainel(); };
  if ($('#pvCal')) $('#pvCal').onclick = e => { e.stopPropagation(); calendarioFaixa($('#pvCal'), PV.de, PV.ate, (de, ate) => { PV.de = de; PV.ate = ate; telaPainel(); }); };
  if ($('#pvMes')) $('#pvMes').onchange = e => { PV.mes = e.target.value; telaPainel(); };
  if ($('#pvAno')) $('#pvAno').onchange = e => { PV.ano = e.target.value; telaPainel(); };
  if ($('#pvCmp')) $('#pvCmp').onchange = e => { PV.cmp = e.target.value; telaPainel(); };
  $('#pvVend').onchange = e => { PV.vend = e.target.value; telaPainel(); };
  $('#pvAtual').onclick = () => telaPainel(true);
  $('#pvDetCart').onclick = () => irPara('carteiramet');
  sec.querySelectorAll('[data-cmet]').forEach(d => d.onclick = () => { S.perfilId = d.dataset.cmet; S.sel = d.dataset.cmet; irPara('pedcli'); });
  $('#pvBO').onclick = () => telaBackoffice(); sec.querySelectorAll('[data-bo]').forEach(a => a.onclick = e => { e.preventDefault(); telaBackoffice(); });
  sec.querySelectorAll('[data-ab]').forEach(d => d.onclick = () => abrirPerfil(d.dataset.ab));
  sec.querySelectorAll('[data-rtar]').forEach(b => b.onclick = () => { const p = S.pdvs.find(x => x.id === b.dataset.rtar); modalTarefa({ data: hojeISO(), titulo: 'Recuperar: ' + p.nome, tipo: 'ligacao', pdv_id: p.id, contato_id: p.contato_id }, () => telaPainel()); });
  sec.querySelectorAll('[data-rven]').forEach(b => b.onclick = () => { S.abPdv = b.dataset.rven; S.vendaVolta = null; irPara('abertura'); });
  document.querySelectorAll('[data-altar]').forEach(b => b.onclick = () => { const p = S.pdvs.find(x => x.id === b.dataset.altar); modalTarefa({ data: hojeISO(), titulo: 'Retorno: ' + p.nome, pdv_id: p.id, contato_id: p.contato_id }, () => telaPainel()); });
  document.querySelectorAll('[data-alab]').forEach(b => b.onclick = () => abrirPerfil(b.dataset.alab));
  db.blingOrfaos().then(ls => { const el = $('#orfaosBling'); if (!el || !ls.length) return;
    el.innerHTML = `<div class="panel alertas"><h3>Pedidos do Bling sem cliente no app (${ls.length})</h3><p style="color:var(--soft);margin-top:0">Cadastre o cliente (com o mesmo CNPJ) e o pedido entra na próxima sincronização, ou ignore.</p>${ls.slice(0, 30).map(o => `<div class="trow" style="cursor:default"><div style="flex:1"><b>${esc(o.contato_nome || '—')}</b><br><small style="color:var(--mute)">nº ${esc(o.numero)} · ${o.data ? new Date(o.data + 'T12:00').toLocaleDateString('pt-BR') : ''} · ${brl(o.total)} · ${esc(o.situacao || '')}${o.documento ? ' · doc ' + esc(o.documento) : ''}</small></div><button class="mini" data-orign="${o.bling_id}">ignorar</button></div>`).join('')}</div>`;
    el.querySelectorAll('[data-orign]').forEach(b => b.onclick = async () => { try { await db.blingIgnorar(b.dataset.orign); b.closest('.trow').remove(); } catch (e) { erro(e); } });
  }).catch(() => { });
}
// ponte da base: início + novos + recuperados − perdidos = fim
// ---- períodos do painel: semana, últimos 3/6 meses e personalizado ----
const segundaDe = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const w = (x.getDay() + 6) % 7; return new Date(+x - w * DIA); };
const ddmm = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
function semanasPainel(hoje) { const s0 = segundaDe(hoje); return Array.from({ length: 26 }, (_, i) => { const a = new Date(+s0 - i * 7 * DIA), b = new Date(+a + 6 * DIA); return { v: isoDe(a), n: (i === 0 ? 'Esta semana · ' : i === 1 ? 'Semana passada · ' : '') + `${ddmm(a)} a ${ddmm(b)}` }; }); }
function faixaPainel(hoje) {
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
  if (PV.per === 'semana') { if (!PV.sem) PV.sem = isoDe(segundaDe(hoje)); const ini = new Date(PV.sem + 'T00:00'), fim = new Date(+ini + 7 * DIA); return { ini, fim, rot: `Semana de ${ddmm(ini)} a ${ddmm(new Date(+fim - DIA))}`, curto: `semana ${ddmm(ini)}` }; }
  if (PV.per === '90d') { const ini = new Date(+amanha - 90 * DIA); return { ini, fim: amanha, rot: `Últimos 90 dias · ${ddmm(ini)} a ${ddmm(hoje)}`, curto: 'últimos 90 dias' }; }
  if (PV.per === '6m') { const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 6, hoje.getDate() + 1); return { ini, fim: amanha, rot: `Últimos 6 meses · ${ddmm(ini)} a ${ddmm(hoje)}`, curto: 'últimos 6 meses' }; }
  if (!PV.de) { PV.de = isoDe(new Date(+hoje - 29 * DIA)); PV.ate = isoDe(hoje); }
  const ini = new Date(PV.de + 'T00:00'), fim = new Date(new Date(PV.ate + 'T00:00').getTime() + DIA), y = d => d.getFullYear() !== hoje.getFullYear() ? '/' + String(d.getFullYear()).slice(2) : '';
  return { ini, fim, rot: `De ${ddmm(ini)}${y(ini)} a ${ddmm(new Date(+fim - DIA))}${y(new Date(+fim - DIA))}`, curto: `${ddmm(ini)}${y(ini)} – ${ddmm(new Date(+fim - DIA))}${y(new Date(+fim - DIA))}` };
}
function diasUteisEntre(ini, fim) { const fer = new Set(metasV2().feriados || []), out = []; for (let d = new Date(ini); d < fim; d = new Date(+d + DIA)) if (d.getDay() !== 0 && !fer.has(isoDe(d))) out.push(isoDe(d)); return out; }
// divide a faixa em dias (até 62 dias) ou em semanas
function baldes(ini, fim) { const dias = Math.round((fim - ini) / DIA), sem = dias > 62, passo = sem ? 7 : 1, out = [];
  for (let a = new Date(ini); a < fim; a = new Date(+a + passo * DIA)) { const b = new Date(Math.min(+fim, +a + passo * DIA)); out.push({ a, b, lab: sem ? ddmm(a) : dias <= 7 ? DIAS_SEM[a.getDay()] + ' ' + a.getDate() : String(a.getDate()) }); }
  out.semanal = sem; return out; }
// calendário: 1º clique escolhe o dia inicial, 2º o final (um mês por vez; o hover só repinta as classes, sem refazer os botões)
function calendarioFaixa(ancora, de, ate, ok) {
  document.getElementById('calFx')?.remove();
  let a = de ? new Date(de + 'T12:00') : null, b = ate ? new Date(ate + 'T12:00') : null, ver = new Date((b || new Date()).getFullYear(), (b || new Date()).getMonth(), 1);
  const el = document.createElement('div'); el.id = 'calFx'; el.className = 'calfx'; document.body.appendChild(el);
  const r = ancora.getBoundingClientRect(); el.style.top = (r.bottom + 6) + 'px'; el.style.left = Math.max(8, Math.min(r.left, innerWidth - 300)) + 'px';
  const marca = (hov = null) => { const fimR = b || (a && hov) || null, lo = a && fimR ? (a < fimR ? a : fimR) : a, hi = a && fimR ? (a < fimR ? fimR : a) : a;
    el.querySelectorAll('[data-d]').forEach(x => { const dt = new Date(x.dataset.d + 'T12:00'), iso = x.dataset.d;
      x.classList.toggle('ini', !!lo && isoDe(lo) === iso); x.classList.toggle('fim', !!hi && isoDe(hi) === iso); x.classList.toggle('meio', !!(lo && hi && dt > lo && dt < hi)); });
    const m = el.querySelector('.calmsg'); if (m) m.textContent = !a || b ? 'Clique no dia inicial' : 'Agora clique no dia final';
    el.querySelector('.calft small').textContent = a ? ddmm(a) + (b ? ' – ' + ddmm(b) : ' – …') : ''; el.querySelector('[data-ok]').disabled = !(a && b); };
  const pinta = () => { const pri = new Date(ver.getFullYear(), ver.getMonth(), 1), off = (pri.getDay() + 6) % 7, n = new Date(ver.getFullYear(), ver.getMonth() + 1, 0).getDate();
    let g = ''; for (let d = 1; d <= n; d++) { const iso = isoDe(new Date(ver.getFullYear(), ver.getMonth(), d, 12)); g += `<button type="button" data-d="${iso}" class="${iso === hojeISO() ? 'hj' : ''}">${d}</button>`; }
    el.innerHTML = `<div class="calhd"><button type="button" data-n="-1">‹</button><b>${pri.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</b><button type="button" data-n="1">›</button></div><small class="calmsg"></small>
     <div class="calg">${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(x => `<i>${x}</i>`).join('')}${'<span></span>'.repeat(off)}${g}</div>
     <div class="calft"><small></small><span><button type="button" class="mini" data-x>Cancelar</button> <button type="button" class="mini on" data-ok>Aplicar</button></span></div>`;
    marca(); };
  // a mensagem fica numa linha própria
  const msg = () => el.querySelector('.calmsg');
  pinta();
  const marcaMsg = () => { if (msg()) msg().textContent = !a || b ? 'Clique no dia inicial' : 'Agora clique no dia final'; };
  el.addEventListener('click', e => { e.stopPropagation(); const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.n) { ver = new Date(ver.getFullYear(), ver.getMonth() + +t.dataset.n, 1); pinta(); return marcaMsg(); }
    if (t.dataset.d) { const d = new Date(t.dataset.d + 'T12:00'); if (!a || b) { a = d; b = null; } else { b = d; if (b < a) [a, b] = [b, a]; } marca(); return marcaMsg(); }
    if ('x' in t.dataset) return el.remove();
    if ('ok' in t.dataset && a && b) { el.remove(); ok(isoDe(a), isoDe(b)); } });
  el.addEventListener('mouseover', e => { const t = e.target.closest('[data-d]'); if (t && a && !b) marca(new Date(t.dataset.d + 'T12:00')); });
  marcaMsg();
  setTimeout(() => document.addEventListener('click', function fora(ev) { if (!document.body.contains(el)) return document.removeEventListener('click', fora); if (!el.contains(ev.target)) { el.remove(); document.removeEventListener('click', fora); } }), 0);
}
function ponte(B) {
  const passos = [['Ativos no início', B.ativosIni, 'tot'], ['Novos', B.novos, 'mais'], ['Recuperados', B.recup, 'mais'], ['Perdidos', -B.perdidos, 'menos'], ['Ativos agora', B.ativosFim, 'tot']];
  const W = 640, H = 220, L = 20, R = 20, T = 22, Bm = 40, iw = W - L - R, ih = H - T - Bm, max = Math.max(B.ativosIni + B.novos + B.recup, B.ativosFim, 1), Y = v => T + ih - v / max * ih, gw = iw / passos.length, bw = Math.min(70, gw - 18);
  let acc = 0, g = '';
  passos.forEach(([n, v, t], i) => { const x = L + gw * i + (gw - bw) / 2; let y0, y1;
    if (t === 'tot') { y0 = 0; y1 = v; acc = v; } else { y0 = acc; y1 = acc + v; acc = y1; }
    const top = Y(Math.max(y0, y1)), bot = Y(Math.min(y0, y1)), cor = t === 'tot' ? COR.s1 : t === 'mais' ? COR.bom : COR.ruim;
    g += `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(2, bot - top)}" fill="${cor}" data-tip="${esc(n)}: ${Math.abs(v)} clientes"/><text x="${x + bw / 2}" y="${top - 6}" text-anchor="middle" class="lb" fill="var(--choc)">${t === 'tot' ? v : (v >= 0 ? '+' : '−') + Math.abs(v)}</text><text x="${x + bw / 2}" y="${H - 22}" text-anchor="middle" class="ax">${n}</text>`;
    if (i < passos.length - 1) g += `<line x1="${x + bw}" x2="${x + gw}" y1="${Y(acc)}" y2="${Y(acc)}" stroke="${COR.eixo}" stroke-dasharray="2 3"/>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="grf2" role="img">${g}</svg>`;
}

/* ---- backoffice de metas ---- */
async function telaBackoffice() {
  const M = metasV2(); let mes = PV.mes || mesKey(new Date());
  if (!PV.dados) PV.dados = prepararPainel(await db.painelDados());
  const vends = ['todos', ...new Set([...PV.dados.pedidos.map(o => o.vend), ...PV.dados.perfis.map(p => p.id)])];
  const sugestao = k => { const N3 = [1, 2, 3].map(i => numeros(pedidosDe(PV.dados, mesIni(mesSoma(mes, -i)), mesFim(mesSoma(mes, -i)), 'todos'))); const v = N3.map(n => n[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const desenhar = () => {
    const mm = M.meses[mes] || {};
    $('#main').innerHTML = `<section class="view on"><div class="dash pnl">
    <div class="pfiltros"><div><h2>⚙️ Backoffice de metas</h2><small>As metas valem para o Painel. Cada mês guarda a sua meta, então o histórico fica comparável.</small></div><button class="btn" id="boVolta">← Voltar ao painel</button></div>
    <div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px"><div class="row" style="gap:6px"><button class="btn" id="boAnt">‹</button><h3 style="margin:0;min-width:170px;text-align:center">${mesNome(mes)}</h3><button class="btn" id="boProx">›</button></div>
     <div class="row" style="gap:6px"><button class="btn" id="boCopia">Copiar do mês anterior</button><button class="btn" id="boSug">Sugerir pela média dos últimos 3 meses</button></div></div>
     <p class="psub">${diasUteis(mes).length} dias úteis (segunda a sábado, sem feriados). Deixe em branco o que não tiver meta. Em "Todos", os indicadores de soma usam a soma dos vendedores quando ficarem em branco.</p>
     <div style="overflow:auto"><table class="bo"><tr><th>Indicador</th>${vends.map(v => `<th>${v === 'todos' ? 'Todos' : esc(nomeVend(v))}</th>`).join('')}</tr>
     ${IND.map(([k, n, u]) => `<tr><td><b>${n}</b><br><small style="color:var(--mute)">${u === 'R$' ? 'em reais' : u === '%' ? 'em %' : 'quantidade'}</small></td>${vends.map(v => { const val = mm[v]?.[k]; return `<td><input type="number" step="${u === '%' ? 1 : u === 'R$' ? 10 : 1}" data-v="${v}" data-k="${k}" data-u="${u}" value="${val == null || val === '' ? '' : u === '%' ? Math.round(val * 100) : val}" placeholder="—"></td>`; }).join('')}</tr>`).join('')}</table></div>
     <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn pri" id="boSalva">Salvar metas de ${mesNome(mes)}</button></div></div>

    <div class="pgrid">
     <div class="panel"><h3>Meta anual com sazonalidade</h3><p class="psub">Informe o faturamento do ano e o peso de cada mês. "Distribuir" preenche a meta de faturamento (Todos) mês a mês.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><label class="lb" style="margin:0">Ano <input type="number" id="anAno" value="${mes.slice(0, 4)}" style="width:90px"></label><label class="lb" style="margin:0">Faturamento do ano (R$) <input type="number" id="anVal" step="1000" value="${M.anual?.[mes.slice(0, 4)]?.valor || ''}" style="width:140px"></label></div>
      <div class="pesos">${Array.from({ length: 12 }, (_, i) => `<label><small>${mesNome(mes.slice(0, 4) + '-' + String(i + 1).padStart(2, '0'), true).split('/')[0]}</small><input type="number" class="peso" value="${M.anual?.[mes.slice(0, 4)]?.pesos?.[i] ?? 100}"></label>`).join('')}</div>
      <p class="psub">Pesos relativos: 100 = mês normal, 120 = 20% acima, 80 = 20% abaixo.</p><button class="btn" id="anDist">Distribuir no ano</button></div>
     <div class="panel"><h3>Cores das metas</h3><p class="psub">Quando o resultado fica verde, amarelo ou vermelho</p>
      <div class="row" style="gap:10px;flex-wrap:wrap"><label class="lb" style="margin:0">✓ Verde a partir de <input type="number" id="fxV" value="${M.faixas.verde}" style="width:70px">%</label><label class="lb" style="margin:0">! Amarelo a partir de <input type="number" id="fxA" value="${M.faixas.amarelo}" style="width:70px">%</label></div>
      <p class="psub">Abaixo do amarelo fica vermelho. No mês atual, o painel compara a projeção de fechamento com a meta.</p>
      <h3 style="margin-top:16px">Feriados</h3><p class="psub">Um por linha (dd/mm/aaaa). Saem da contagem de dias úteis.</p><textarea id="fer" rows="5" style="width:100%">${(M.feriados || []).map(d => d.split('-').reverse().join('/')).join('\n')}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn pri" id="fxSalva">Salvar cores e feriados</button></div></div>
    </div></div></section>`;
    const salvar = async (msg) => { try { await db.salvarRegra('metas_v2', M); S.base.regras.metas_v2 = JSON.parse(JSON.stringify(M)); toast(msg); } catch (e) { erro(e); } };
    $('#boVolta').onclick = () => telaPainel(); $('#boAnt').onclick = () => { mes = mesSoma(mes, -1); desenhar(); }; $('#boProx').onclick = () => { mes = mesSoma(mes, 1); desenhar(); };
    $('#boSalva').onclick = () => { const o = {}; document.querySelectorAll('table.bo input').forEach(i => { if (i.value === '') return; (o[i.dataset.v] = o[i.dataset.v] || {})[i.dataset.k] = i.dataset.u === '%' ? +i.value / 100 : +i.value; }); M.meses[mes] = o; salvar(`Metas de ${mesNome(mes)} salvas`); };
    $('#boCopia').onclick = () => { const a = M.meses[mesSoma(mes, -1)]; if (!a) return toast('O mês anterior não tem metas'); M.meses[mes] = JSON.parse(JSON.stringify(a)); desenhar(); toast('Copiado. Confira e clique em Salvar.'); };
    $('#boSug').onclick = () => { document.querySelectorAll('table.bo input[data-v="todos"]').forEach(i => { const v = sugestao(i.dataset.k); if (v != null && i.value === '') i.value = i.dataset.u === '%' ? Math.round(v * 100) : Math.round(v); }); toast('Sugestão preenchida em "Todos" (só onde estava vazio). Ajuste e salve.'); };
    $('#anDist').onclick = () => { const ano = $('#anAno').value, val = +$('#anVal').value, pesos = [...document.querySelectorAll('.peso')].map(i => +i.value || 0), sp = pesos.reduce((a, b) => a + b, 0); if (!val || !sp) return toast('Informe o faturamento do ano e os pesos');
      M.anual = M.anual || {}; M.anual[ano] = { valor: val, pesos }; pesos.forEach((p, i) => { const k = ano + '-' + String(i + 1).padStart(2, '0'); M.meses[k] = M.meses[k] || {}; M.meses[k].todos = { ...(M.meses[k].todos || {}), fat: Math.round(val * p / sp) }; }); salvar(`Meta de ${ano} distribuída nos 12 meses`).then(desenhar); };
    $('#fxSalva').onclick = () => { M.faixas = { verde: +$('#fxV').value || 100, amarelo: +$('#fxA').value || 85 }; M.feriados = $('#fer').value.split(/\n+/).map(s => s.trim()).filter(Boolean).map(s => { const [d, m, a] = s.split('/'); return a && m && d ? `${a}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null; }).filter(Boolean); salvar('Cores e feriados salvos'); };
  };
  desenhar();
}

/* =================== regras =================== */
function telaRegras() {
  const r = regraAval(), cp = cadPadrao();
  setTimeout(painelBling, 0);
  $('#main').innerHTML = `<section class="view on"><div class="dash">
  <div class="panel" id="blingPanel"><h3>Integração com o Bling</h3><small style="color:var(--mute)">verificando…</small></div>
  <div class="panel"><h3>Metas do comercial</h3><p style="color:var(--soft);margin-top:0">Aparecem no topo do CRM, com barra de progresso. Os dias de trabalho contam de segunda a sábado.</p>
   <div class="metas">${[['visitas_dia', 'Visitas de prospecção por dia', 'visitas'], ['vendas_dia', 'Vendas (novos clientes) por dia', 'vendas'], ['valor_mes', 'Valor em vendas novas por mês', 'R$'], ['cadastros_semana', 'Novos pontos cadastrados por semana', 'pontos']].map(([k, n, u]) => `<label><span>${n}</span><span class="row" style="gap:6px"><input type="number" min="0" class="rMeta" data-k="${k}" value="${metas()[k]}" style="width:110px"> <small>${u}</small></span></label>`).join('')}</div></div>
  <div class="panel"><h3>Esteira de avaliação</h3><div class="row" style="flex-wrap:wrap;gap:10px">Avaliação de <input type="number" id="rRep" value="${r.reposicoes}" style="width:70px"> reposições. Aprova com sell-out médio de pelo menos <input type="number" id="rMin" value="${r.meta_minima_sellout}" style="width:70px"> un. por reposição.</div></div>
  <div class="panel"><h3>Frequência padrão de reposição por etapa</h3><table><tr><th>Etapa</th><th>Repor a cada</th><th>PDVs</th></tr>${['avaliacao', 'ativo', 'risco', 'revisao'].map(k => `<tr><td><i class="dot" style="background:${etapa(k).c}"></i> ${etapa(k).n}</td><td><input type="number" class="rCad" data-k="${k}" value="${cp[k] || ''}" style="width:70px"> dias</td><td>${S.pdvs.filter(p => p.etapa === k).length}</td></tr>`).join('')}</table></div>
  <div class="panel"><h3>Dia de rota por região</h3><table><tr><th>Região</th><th>Dia</th><th>PDVs com reposição</th></tr>${S.base.regioes.map(g => `<tr><td><b style="color:${g.cor}">${g.codigo}</b> · ${esc(g.nome)}</td><td><select class="rDia" data-c="${g.codigo}"><option value="" ${g.dia_rota == null ? 'selected' : ''}>Sem dia fixo</option>${DIAS.map((d, i) => `<option value="${i}" ${g.dia_rota === i ? 'selected' : ''}>${d}</option>`).join('')}</select></td><td>${S.pdvs.filter(p => p.regiao === g.codigo && ROTA_ETAPAS.includes(p.etapa)).length}</td></tr>`).join('')}</table></div></div></section>`;
  const salvarAval = async () => { const v = { reposicoes: +$('#rRep').value || 13, meta_minima_sellout: +$('#rMin').value || 6 }; try { await db.salvarRegra('avaliacao', v); S.base.regras.avaliacao = v; toast('Regra da avaliação salva'); } catch (e) { erro(e); } };
  $('#rRep').onchange = $('#rMin').onchange = salvarAval;
  document.querySelectorAll('.rMeta').forEach(i => i.onchange = async () => { const v = { ...metas(), [i.dataset.k]: +i.value || 0 }; try { await db.salvarRegra('metas', v); S.base.regras.metas = v; toast('Meta salva'); } catch (e) { erro(e); } });
  document.querySelectorAll('.rCad').forEach(i => i.onchange = async () => { const v = { ...cadPadrao(), [i.dataset.k]: +i.value || 7 }; try { await db.salvarRegra('cadencia_padrao', v); S.base.regras.cadencia_padrao = v; await recarregar(); toast('Frequência salva'); } catch (e) { erro(e); } });
  document.querySelectorAll('.rDia').forEach(s => s.onchange = async () => { try { const v = s.value === '' ? null : +s.value; await db.salvarRegiao(s.dataset.c, { dia_rota: v }); S.base.regioes.find(g => g.codigo === s.dataset.c).dia_rota = v; S.rotaReg = null; toast('Dia de rota salvo'); } catch (e) { erro(e); } });
}

/* =================== dia de rota (um carro por dia) =================== */
// janela de cada período, em minutos do dia
const JANELAS = { manha: [8 * 60, 12 * 60], tarde: [13 * 60, 18 * 60], noite: [18 * 60, 22 * 60], dia_todo: [8 * 60, 20 * 60] };
const TIPOS_DIA = { reposicao: 'Reposição', prospeccao: 'Prospecção', misto: 'Misto' };
const URG = { ruptura: { n: 'Possível zerado (até 2 dias)', i: '🔴', c: '#d03b3b' }, ideal: { n: 'Janela ideal', i: '🟠', c: '#fab219' }, espera: { n: 'Pode esperar', i: '⚪', c: '#9A8F86' } };

const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const minDe = s => { const [h, m] = String(s || '08:00').split(':'); return +h * 60 + (+m || 0); };
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const km = (a, b) => { const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// tempo de carro na cidade: distância em linha reta × 1,35 (ruas), a 25 km/h, mais 3 min para estacionar
// tempos e distâncias reais pelas ruas (OSRM, o mesmo tipo de cálculo do Google Maps); sem internet, cai na estimativa em linha reta
const MZ = { idx: {}, dur: [], dist: [] }, chaveP = p => p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
const mzIJ = (a, b) => { const i = MZ.idx[chaveP(a)], j = MZ.idx[chaveP(b)]; return i != null && j != null && MZ.dur[i]?.[j] != null ? [i, j] : null; };
const viagem = (a, b) => { const ij = mzIJ(a, b); if (ij) return ij[0] === ij[1] ? 0 : MZ.dur[ij[0]][ij[1]] / 60 + 2; return km(a, b) < 0.05 ? 0 : km(a, b) * 1.35 / 25 * 60 + 3; };
const kmRua = (a, b) => { const ij = mzIJ(a, b); return ij && MZ.dist[ij[0]]?.[ij[1]] != null ? MZ.dist[ij[0]][ij[1]] / 1000 : km(a, b) * 1.35; };
async function garantirMatriz(pontos) {
  const uniq = [...new Map(pontos.filter(p => p && p.lat).map(p => [chaveP(p), p])).values()];
  if (uniq.every(p => MZ.idx[chaveP(p)] != null) || uniq.length < 2) return false;
  const todos = [...new Map([...Object.keys(MZ.idx).map(k => { const [lat, lng] = k.split(',').map(Number); return [k, { lat, lng }]; }), ...uniq.map(p => [chaveP(p), p])]).values()];
  const lista = todos.length > 95 ? uniq.slice(0, 95) : todos;
  try { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 12000);
    const r = await (await fetch(`https://router.project-osrm.org/table/v1/driving/${lista.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')}?annotations=duration,distance`, { signal: ctl.signal })).json();
    if (r.code !== 'Ok') return false;
    MZ.idx = Object.fromEntries(lista.map((p, i) => [chaveP(p), i])); MZ.dur = r.durations; MZ.dist = r.distances || []; return true;
  } catch { return false; } }
const ehCanoas = p => ['CAN', 'C1', 'C2'].includes(p.regiao) || norm(p.cidade) === 'canoas';
const cfgRota = () => ({ tempo_rep: 20, tempo_prosp: 15, ...(S.base.regras.rota || {}) });
const diaSemana = data => new Date(data + 'T12:00').getDay();
function proximoDiaJanela(p, data) { const ds = p.janela_dias?.length ? p.janela_dias : [1, 2, 3, 4, 5, 6]; for (let i = 1; i <= 7; i++) { const d = new Date(new Date(data + 'T12:00').getTime() + i * DIA); if (ds.includes(d.getDay())) return `${DIAS_SEM[d.getDay()]} ${dstr(d)}`; } return '—'; }

// previsão de ruptura de cada cliente: contagem (quando tem) ou ritmo de pedidos; cai na cadência se não tiver nada
function prever(raw, data) {
  const porPdv = {}; raw.pedidos.forEach(o => (porPdv[o.pdv_id] = porPdv[o.pdv_id] || []).push(o));
  const pi = {}; raw.pitens.forEach(i => (pi[i.pedido_id] = pi[i.pedido_id] || []).push(i));
  const bi = {}; raw.bitens.forEach(i => (bi[i.pedido_id] = bi[i.pedido_id] || []).push(i));
  const porCod = {}; S.base.produtos.forEach(p => { if (p.bling_codigo) porCod[p.bling_codigo] = p.id; });
  const ult = {}; raw.contagens.forEach(c => { const v = c.visitas; const u = ult[v.pdv_id]; if (!u || v.em > u.em) ult[v.pdv_id] = { id: v.id, em: v.em, por: {} }; });
  raw.contagens.forEach(c => { const u = ult[c.visitas.pdv_id]; if (u && u.id === c.visitas.id) u.por[c.produto_id] = (u.por[c.produto_id] || 0) + c.deixado_agora; });
  const agora = data && data !== hoje() ? new Date(data + 'T08:00').getTime() : Date.now(), out = {};
  S.pdvs.filter(p => repoe(p)).forEach(p => {
    const ps = (porPdv[p.id] || []).slice(-7), r = { fonte: 'cadência', dias: null, vd: null, estoque: null, pedido: {}, un: 0 };
    if (ps.length >= 2) { const span = (new Date(ps[ps.length - 1].criado_em) - new Date(ps[0].criado_em)) / DIA, inter = span / (ps.length - 1);
      const unMed = ps.reduce((a, o) => a + (o.unidades || 0), 0) / ps.length; if (inter > 0) { r.vd = unMed / inter;
        r.dias = inter - (agora - new Date(ps[ps.length - 1].criado_em)) / DIA; r.fonte = 'ritmo de pedidos'; } }
    const sel = (S.sellouts[p.id] || []).slice(-6), u = ult[p.id];
    if (sel.length >= 2) { const d = (new Date(sel[sel.length - 1].em) - new Date(sel[0].em)) / DIA; if (d > 0) r.vd = sel.slice(1).reduce((a, s) => a + s.sellout, 0) / d; }
    if (u && r.vd) { const tot = Object.values(u.por).reduce((a, b) => a + b, 0); r.estoque = Math.max(0, tot - r.vd * (agora - new Date(u.em)) / DIA); r.dias = r.estoque / r.vd; r.fonte = 'contagem'; }
    if (r.dias === null && ps.length === 1) { const inter = p.cadencia_efetiva || 14; r.vd = (ps[0].unidades || 0) / inter; r.dias = inter - (agora - new Date(ps[0].criado_em)) / DIA; r.fonte = 'cadência'; }
    if (r.dias === null && p.proxima_reposicao) r.dias = (new Date(p.proxima_reposicao) - agora) / DIA;
    if (r.dias === null) { r.dias = 99; r.fonte = 'sem histórico'; }
    r.urg = r.dias <= 2 ? 'ruptura' : r.dias <= 5 ? 'ideal' : 'espera';
    // pedido esperado: os itens do último pedido (se o ponto tem contagem e expositor, completa o expositor)
    const ul = ps[ps.length - 1];
    if (ul) { (pi[ul.id] || []).forEach(i => r.pedido[i.produto_id] = (r.pedido[i.produto_id] || 0) + +i.quantidade);
      if (!Object.keys(r.pedido).length) (bi[ul.id] || []).forEach(i => { const id = porCod[i.codigo]; if (id) r.pedido[id] = (r.pedido[id] || 0) + +i.quantidade; }); }
    // deixado: o que ficou no cliente (última contagem ou o último pedido entregue) e a estimativa de quanto ainda tem hoje
    const qPed = Object.values(r.pedido).reduce((a, b) => a + b, 0) || Math.round(ul?.unidades || 0);
    if (u && (!ul || new Date(u.em) >= new Date(ul.criado_em) - 6e5)) { r.deixado = Object.values(u.por).reduce((a, b) => a + b, 0); r.deixadoEm = u.em; }
    else if (ul) { r.deixado = qPed; r.deixadoEm = ul.criado_em; }
    if (r.deixado != null && r.estoque == null && r.vd != null) r.estoque = Math.max(0, r.deixado - r.vd * (agora - new Date(r.deixadoEm)) / DIA);
    if (u && p.expositor_id && r.vd) { const fr = r.estoque / Math.max(1, Object.values(u.por).reduce((a, b) => a + b, 0)); const ped = {};
      S.base.produtos.forEach(pr => { const q = alvo(p.expositor_id, pr.id) - Math.round((u.por[pr.id] || 0) * fr); if (q > 0) ped[pr.id] = q; }); if (Object.keys(ped).length) r.pedido = ped; }
    r.un = Object.values(r.pedido).reduce((a, b) => a + b, 0) || Math.round(ul?.unidades || 0);
    out[p.id] = r;
  });
  return out;
}

// simula uma ordem fixa de paradas; devolve horários ou null se alguma parada não couber
function simular(ordem, ini, fim, base, t0 = ini, pos0 = base) {
  let t = t0, pos = pos0; const hs = [];
  for (const s of ordem) {
    const chega = t + viagem(pos, s.p), w = s.jan.find(([a, b]) => Math.max(chega, a) + s.serv <= b); // primeira janela em que ainda dá para atender
    if (!w) return null; const comeca = Math.max(chega, w[0]);
    hs.push({ chega, comeca, espera: comeca - chega }); t = comeca + s.serv; pos = s.p;
  }
  const volta = t + viagem(pos, base); if (volta > fim) return null;
  return { hs, volta, km: ordem.reduce((a, s, i) => a + kmRua(i ? ordem[i - 1].p : pos0, s.p), 0) + (ordem.length ? kmRua(ordem[ordem.length - 1].p, base) : 0) };
}
// monta a ordem: a urgência só decide QUEM entra; a ordem é pela proximidade, saindo da base e voltando para ela.
// janela de horário só pesa para quem tem horário cadastrado (vira restrição, não preferência)
function montarOrdem(reps, prosps, ini, fim, base, t0, pos0) {
  // caminho a partir da saída, do mais perto para o mais longe; a volta para casa não entra na ordem (é direta no fim)
  const dist = o => o.reduce((a, s, i) => a + kmRua(i ? o[i - 1].p : pos0, s.p), 0);
  const sim = o => simular(o, ini, fim, base, t0, pos0);
  // vizinho mais próximo a partir da saída
  const vizinho = lista => { const o = []; let resto = lista.slice(), pos = pos0;
    while (resto.length) { let b = resto[0]; resto.forEach(s => { if (kmRua(pos, s.p) < kmRua(pos, b.p)) b = s; }); o.push(b); pos = b.p; resto = resto.filter(s => s !== b); } return o; };
  // 2-opt: desfaz cruzamentos enquanto encurtar o caminho (e não quebrar janela de quem tem horário)
  const melhorar = o => { let melhorou = true, d = dist(o), ok = !!sim(o);
    while (melhorou && o.length > 2) { melhorou = false;
      for (let i = 0; i < o.length - 1; i++) for (let j = i + 1; j < o.length; j++) {
        const nova = [...o.slice(0, i), ...o.slice(i, j + 1).reverse(), ...o.slice(j + 1)], d2 = dist(nova);
        if (d2 < d - 0.01) { const ok2 = !!sim(nova); if (ok2 || !ok) { o = nova; d = d2; ok = ok2; melhorou = true; } } } }
    // move uma parada para a posição onde ela custa menos (or-opt)
    melhorou = true;
    while (melhorou && o.length > 2) { melhorou = false;
      for (let i = 0; i < o.length && !melhorou; i++) { const sem = [...o.slice(0, i), ...o.slice(i + 1)];
        for (let k = 0; k <= sem.length && !melhorou; k++) { if (k === i) continue; const nova = [...sem.slice(0, k), o[i], ...sem.slice(k)], d2 = dist(nova);
          if (d2 < d - 0.01) { const ok2 = !!sim(nova); if (ok2 || !ok) { o = nova; d = d2; ok = ok2; melhorou = true; } } } } }
    return o; };
  let ordem = melhorar(vizinho(reps));
  // quem tem janela e ficou fora dela: tenta reposicionar na melhor posição que respeite os horários
  if (!sim(ordem)) ordem.filter(s => s.temJan).forEach(s => { const sem = ordem.filter(x => x !== s); let best = null, bd = 1e9;
    for (let k = 0; k <= sem.length; k++) { const nova = [...sem.slice(0, k), s, ...sem.slice(k)]; if (sim(nova) && dist(nova) < bd) { bd = dist(nova); best = nova; } }
    if (best) ordem = best; });
  // não cabe no dia: sai primeiro o menos urgente, e entre eles o que mais desvia o caminho
  const prio = { ruptura: 2, ideal: 1, espera: 0 }, foraRep = [];
  while (ordem.length && !sim(ordem)) {
    let pior = null, pc = -1e9;
    ordem.forEach((s, i) => { const nova = ordem.filter((_, k) => k !== i), ganho = dist(ordem) - dist(nova) + (sim(nova) ? 1000 : 0) - (s.livre ? 3 : prio[s.urg]) * 10000; if (ganho > pc) { pc = ganho; pior = s; } });
    ordem = melhorar(ordem.filter(s => s !== pior)); foraRep.push(pior);
  }
  // prospecções: encaixa onde aumentar menos o caminho
  let pz = prosps.slice(); const foraP = [];
  while (pz.length) {
    let best = null, bc = 1e9, bo = null;
    pz.forEach(s => { for (let k = 0; k <= ordem.length; k++) { const nova = [...ordem.slice(0, k), s, ...ordem.slice(k)];
      if (sim(nova)) { const c = dist(nova) - dist(ordem); if (c < bc) { bc = c; best = s; bo = nova; } } } });
    if (!best) { foraP.push(...pz); break; }
    ordem = bo; pz = pz.filter(s => s !== best);
  }
  return { ordem, sim: sim(ordem), foraRep, foraP };
}

const RT = { data: null, cfg: null, raw: null, prev: null, perfis: [], salvo: null, plano: null, visitas: [], mapa: null };
async function telaRota() {
  $('#main').innerHTML = '<section class="view on"><div class="loading">Montando o dia de rota…</div></section>';
  RT.data = RT.data || hoje();
  try {
    if (!S.vendasCorrigidas) { S.vendasCorrigidas = true; await db.corrigirVendasSemVisita().catch(() => 0); }
    await recarregar();
    const [raw, perfis, doDia, vis] = await Promise.all([db.dadosRota(), RT.perfis.length ? RT.perfis : db.perfisTodos().catch(() => [S.eu]), db.rotasDoDia(RT.data).catch(e => { RT.semTabela = true; return []; }), db.visitasDoDia(RT.data)]);
    RT.raw = raw; RT.perfis = perfis; RT.visitas = vis; RT.prev = prever(raw, RT.data);
    RT.cont = await db.contagensDasVisitas(vis.filter(v => v.tipo === 'reposicao').map(v => v.id)).catch(() => []);
    // cada pessoa tem a sua rota no dia: abre a de quem está escolhido em "Rota de" (padrão: quem está usando o app)
    RT.motorista = RT.motorista || S.eu.id;
    const salvo = doDia.find(r => r.motorista === RT.motorista);
    RT.outras = doDia.filter(r => r.motorista !== RT.motorista);
    RT.salvo = salvo || { data: RT.data, motorista: RT.motorista, tipo: 'reposicao', inicio: '08:00', fim: '18:00', incluir: [], tirar: [], paradas: [] };
  } catch (e) { return erro(e); }
  RT.salvo.data = RT.data;
  desenharRota();
}
function baseRota() { const c = cfgRota(); return c.lat ? { lat: c.lat, lng: c.lng, end: c.endereco } : { lat: -29.9177, lng: -51.1836, end: null }; }
function calcularRota() {
  const R = RT.salvo, c = cfgRota(), base = baseRota(), dow = diaSemana(R.data), ini = minDe(R.inicio), fim = minDe(R.fim);
  const mot = RT.perfis.find(x => x.id === R.motorista) || S.eu, moises = /mois/i.test(semAcento(mot.nome || ''));
  const feitos = new Set(RT.visitas.filter(v => { const p = S.pdvs.find(q => q.id === v.pdv_id); return ROTA_ETAPAS.includes(p?.etapa) ? v.tipo === 'reposicao' : v.tipo === 'prospeccao'; }).map(v => v.pdv_id)), incl = new Set(R.incluir), tira = new Set(R.tirar); // cliente só conta como atendido com reposição; prospect, com visita de prospecção
  // janelas do cliente: um intervalo por período marcado (manhã e noite viram dois intervalos); sem período, a jornada toda
  const jan = p => { const ks = perList(p); return ks.length ? ks.map(k => JANELAS[k]).sort((a, b) => a[0] - b[0]) : [[ini, fim]]; };
  const atendeHoje = p => !p.janela_dias?.length || p.janela_dias.includes(dow);
  // fila de reposição
  const fila = S.pdvs.filter(p => repoe(p) && p.lat && !tira.has(p.id) && (incl.has(p.id) || !adiadoAte(p, R.data))).map(p => ({ p, ...RT.prev[p.id] })).filter(x => x.urg).sort((a, b) => a.dias - b.dias);
  // quem já está na rota do outro no mesmo dia não entra sozinho nesta
  const doOutro = new Set((RT.outras || []).flatMap(r => [...(r.paradas || []).map(s => s.id), ...(r.incluir || [])]));
  const encs = S.base.regras.encomendas || {};
  const entra = x => { if (tira.has(x.p.id)) return false; if (incl.has(x.p.id)) return true; if (doOutro.has(x.p.id)) return false; if (encDoDia(encs[x.p.id], R.data)) return true; if (R.tipo === 'prospeccao') return false;
    if (!atendeHoje(x.p)) return false; if (ehCanoas(x.p) && !moises && x.urg !== 'ruptura') return false; return x.urg !== 'espera'; };
  const reps = fila.filter(entra).map(x => ({ id: x.p.id, tipo: 'rep', p: x.p, urg: x.urg, jan: jan(x.p), temJan: !!x.p.janela_periodo, serv: c.tempo_rep, livre: incl.has(x.p.id) }));
  // prospecções: no misto, até 500 m de alguma parada de reposição; na prospecção, as que você escolheu
  let prosps = [];
  if (R.tipo !== 'reposicao') {
    const perto = S.pdvs.filter(p => PROSP_ETAPAS.includes(p.etapa) && p.lat && !tira.has(p.id) && (incl.has(p.id) || !doOutro.has(p.id)) && atendeHoje(p) && (incl.has(p.id) || (R.tipo === 'misto' && reps.some(r => km(r.p, p) <= 0.5))));
    prosps = perto.sort((a, b) => (b.potencial || 0) - (a.potencial || 0)).slice(0, 25).map(p => ({ id: p.id, tipo: 'prosp', p, urg: 'espera', jan: jan(p), serv: c.tempo_prosp }));
  }
  // clientes colocados à mão na rota (qualquer um, mesmo sem urgência ou consumidor final)
  [...R.incluir, ...Object.keys(encs).filter(id => !doOutro.has(id) && encDoDia(encs[id], R.data))].forEach(id => { if (tira.has(id) || reps.some(x => x.id === id) || prosps.some(x => x.id === id)) return; const p = S.pdvs.find(q => q.id === id); if (!p || !p.lat) return;
    const pr = PROSP_ETAPAS.includes(p.etapa) && !encs[id]; (pr ? prosps : reps).push({ id, tipo: pr ? 'prosp' : 'rep', p, urg: RT.prev[id]?.urg || 'espera', jan: jan(p), temJan: !!p.janela_periodo, serv: pr ? c.tempo_prosp : c.tempo_rep, livre: true }); });
  // entregas marcadas para hoje: prioridade (não saem da rota) e no período combinado
  reps.forEach(x => { const e = encs[x.id]; if (!encDoDia(e, R.data)) return; x.urg = 'ruptura'; x.livre = true; x.enc = e; if (e.periodo && e.periodo !== 'dia_todo' && JANELAS[e.periodo]) { x.jan = [JANELAS[e.periodo]]; x.temJan = true; } });
  // rota já em andamento: o que foi feito fica, o resto é recalculado a partir de agora
  const st = Object.fromEntries((R.paradas || []).map(s => [s.id, s.status]));
  const feito = s => feitos.has(s.id) || st[s.id] === 'feito' || st[s.id] === 'ausente';
  const ordemSalva = (R.paradas || []).map(s => [...reps, ...prosps].find(x => x.id === s.id) || (() => { const p = S.pdvs.find(q => q.id === s.id); return p && p.lat ? { id: p.id, tipo: s.tipo, p, urg: RT.prev[p.id]?.urg || 'espera', jan: jan(p), serv: s.tipo === 'prosp' ? c.tempo_prosp : c.tempo_rep } : null; })()).filter(Boolean);
  const doTipo = s => R.tipo === 'misto' || (R.tipo === 'reposicao' ? s.tipo === 'rep' : s.tipo === 'prosp');
  const fixos = ordemSalva.filter(s => feito(s) && doTipo(s));
  // quem já foi atendido hoje (mesmo fora da rota salva) entra como feito
  RT.visitas.filter(v => feitos.has(v.pdv_id)).forEach(v => { if (fixos.some(f => f.id === v.pdv_id)) return; const p = S.pdvs.find(q => q.id === v.pdv_id); if (!p || !p.lat) return;
    const s = { id: p.id, tipo: v.tipo === 'reposicao' ? 'rep' : 'prosp', p, urg: RT.prev[p.id]?.urg || 'espera', jan: jan(p), serv: v.tipo === 'reposicao' ? c.tempo_rep : c.tempo_prosp }; if (doTipo(s)) fixos.push(s); });
  // paradas que já estavam na rota salva continuam nela, mesmo que tenham deixado de ser urgentes
  ordemSalva.filter(s => !feito(s) && !tira.has(s.id) && doTipo(s)).forEach(s => { if (s.tipo === 'rep' && !reps.some(x => x.id === s.id)) reps.push(s); if (s.tipo === 'prosp' && !prosps.some(x => x.id === s.id)) prosps.push(s); });
  [...reps, ...prosps].filter(s => feitos.has(s.id) && !fixos.some(f => f.id === s.id)).forEach(s => fixos.push(s));
  const ehHoje = R.data === hoje(), agoraMin = new Date().getHours() * 60 + new Date().getMinutes();
  const emAndamento = fixos.length && ehHoje && agoraMin > ini && agoraMin < fim; // fora do horário (ex.: testando à noite) a rota parte da casa
  const t0 = emAndamento ? agoraMin : ini, pos0 = emAndamento ? fixos[fixos.length - 1].p : base;
  const pend = x => !fixos.some(f => f.id === x.id);
  // ordem manual (setas ↑ ↓): mantém a sequência escolhida e só calcula os horários; o que entrar depois vai para o fim
  const manual = (R.paradas || []).some(s => s.manual);
  const simLivre = o => { let t = t0, pos = pos0; const hs = [];
    for (const s of o) { const chega = t + viagem(pos, s.p), w = s.jan.find(([a, b]) => Math.max(chega, a) + s.serv <= b), comeca = w ? Math.max(chega, w[0]) : chega;
      hs.push({ chega, comeca, espera: comeca - chega, foraJanela: !w }); t = comeca + s.serv; pos = s.p; }
    return { hs, volta: t + viagem(pos, base), km: o.reduce((a, s, i) => a + kmRua(i ? o[i - 1].p : pos0, s.p), 0) + (o.length ? kmRua(o[o.length - 1].p, base) : 0) }; };
  let m;
  if (manual) { const pt = [...reps, ...prosps].filter(pend), ids = (R.paradas || []).map(s => s.id);
    const ordem = [...ids.map(id => pt.find(x => x.id === id)).filter(Boolean), ...pt.filter(x => !ids.includes(x.id) && incl.has(x.id))]; // os urgentes que não estavam na ordem ficam na fila, com "+ pôr na rota"
    m = { ordem, sim: simLivre(ordem), foraRep: [], foraP: [] }; }
  else m = montarOrdem(reps.filter(pend), prosps.filter(pend), ini, fim, base, t0, pos0);
  const naoHoje = fila.filter(x => R.tipo !== 'prospeccao' && !tira.has(x.p.id) && x.urg !== 'espera' && !atendeHoje(x.p) && !incl.has(x.p.id));
  return { base, ini, fim, t0, pos0, fixos, ordem: m.ordem, sim: m.sim, foraRep: m.foraRep, foraP: m.foraP, fila: fila.filter(x => incl.has(x.p.id) || !doOutro.has(x.p.id)), naoHoje: naoHoje.filter(x => !doOutro.has(x.p.id)), moises, mot, st, feitos, manual };
}
function carga(ordem) {
  const tot = {}; ordem.filter(s => s.tipo === 'rep').forEach(s => Object.entries(RT.prev[s.id]?.pedido || {}).forEach(([k, q]) => tot[k] = (tot[k] || 0) + q));
  return S.base.produtos.filter(p => tot[p.id]).map(p => ({ p, q: tot[p.id], levar: Math.ceil(tot[p.id] * 1.1) }));
}
// rota no Google Maps parando nas fichas dos estabelecimentos (código do lugar guardado em link_maps);
// quem não tem ficha guardada entra pela coordenada. Até 9 paradas por trecho, como o Google permite.
// carga do carro: sugestão pelo pedido esperado de cada parada (+10%), que pode ser ajustada à mão e fica salva na rota
function cargaFinal(cg) { const aj = RT.salvo?.carga; const sug = Object.fromEntries(cg.map(x => [x.p.id, x.levar]));
  if (!aj || !Object.keys(aj).length) return { aj: false, q: sug };
  return { aj: true, q: Object.fromEntries(Object.entries(aj).map(([k, v]) => [k, +v]).filter(([, v]) => v > 0)) }; }
function painelCarga(cg) {
  const { aj, q } = cargaFinal(cg), prev = Object.fromEntries(cg.map(x => [x.p.id, x.q]));
  const saiu = RT.saiu || {}, temSaida = Object.values(saiu).some(v => v > 0);
  const ids = [...new Set([...cg.map(x => String(x.p.id)), ...Object.keys(q), ...Object.keys(saiu).filter(k => saiu[k] > 0)])], prods = S.base.produtos.filter(p => ids.includes(String(p.id)));
  const nome = p => `${esc(p.linha.split(' ')[0])} · ${esc(p.sabor)}`, outros = S.base.produtos.filter(p => !ids.includes(String(p.id)));
  return `<h3 style="margin-top:0">🚗 Carga do carro <small style="font-weight:400;color:var(--mute)">· ${aj ? '<b style="color:var(--choc)">ajustada à mão</b>' : 'sugestão: pedido esperado de cada parada + 10% para trocas'}</small></h3>
   ${prods.length ? `<table class="rcarga"><tr><th>Produto</th><th>Previsto</th><th>Levar</th>${temSaida ? '<th>Saiu</th><th>Sobra</th>' : ''}</tr>${prods.map(p => `<tr><td>${nome(p)}</td><td>${prev[p.id] || '—'}</td><td><input type="number" min="0" inputmode="numeric" class="cgq" data-cg="${p.id}" value="${q[p.id] || 0}" style="width:70px"></td>${temSaida ? `<td>${saiu[p.id] || 0}</td><td class="cgsob" data-sob="${p.id}" style="${(q[p.id] || 0) - (saiu[p.id] || 0) < 0 ? 'color:#B8402A;font-weight:700' : ''}">${(q[p.id] || 0) - (saiu[p.id] || 0)}</td>` : ''}</tr>`).join('')}
    <tr><td><b>Total</b></td><td>${cg.reduce((a, x) => a + x.q, 0)}</td><td><b id="cgTot">${Object.values(q).reduce((a, b) => a + b, 0)}</b></td>${temSaida ? `<td>${Object.values(saiu).reduce((a, b) => a + b, 0)}</td><td></td>` : ''}</tr></table>
    <small style="color:var(--mute)">Em caixas: ${KITS.map(kt => { const tot = Object.keys(kt.q).reduce((a, cod) => { const pr = S.base.produtos.find(x => x.bling_codigo === cod); return a + (pr ? q[pr.id] || 0 : 0); }, 0), cx = Object.values(kt.q).reduce((a, b) => a + b, 0); return `${kt.n.split(' ')[0]} ${dec(tot / cx)} cx`; }).join(' · ')}</small>` : '<span style="color:var(--mute)">Sem reposições na rota. Monte a carga com as caixas abaixo.</span>'}
   <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px"><b style="font-size:13px">Caixas:</b>${KITS.map((kt, i) => `<span class="cxbtn"><button class="mini" data-cxm="${i}" title="Tirar 1 caixa">−</button><button class="mini" data-cx="${i}" title="Somar 1 caixa: ${Object.entries(kt.q).map(([c, n]) => n + ' ' + (S.base.produtos.find(x => x.bling_codigo === c)?.sabor || c)).join(', ')}">+1 cx ${kt.n}</button></span>`).join('')}</div>
   <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">${outros.length ? `<select id="cgAdd" style="max-width:220px"><option value="">+ outro produto…</option>${outros.map(p => `<option value="${p.id}">${nome(p)}</option>`).join('')}</select>` : ''}${aj ? '<button class="mini" id="cgReset">voltar à sugestão</button>' : ''}<small id="cgSalvo" style="color:var(--mute)"></small></div>`;
}
function ligarCarga(cg) {
  const box = $('#rCarga'); if (!box) return; let tm = null;
  const salvar = carga => { clearTimeout(tm); tm = setTimeout(async () => { await salvarRotaDia({ carga }); const el = $('#cgSalvo'); if (el && !RT.semTabela) el.textContent = carga ? '✓ carga salva' : ''; }, 500); };
  const ler = () => Object.fromEntries([...box.querySelectorAll('[data-cg]')].map(i => [i.dataset.cg, Math.max(0, Math.round(+i.value || 0))]));
  box.querySelectorAll('[data-cg]').forEach(i => i.oninput = () => { const c = ler(); $('#cgTot').textContent = Object.values(c).reduce((a, b) => a + b, 0);
    box.querySelectorAll('[data-sob]').forEach(t => { const v = (c[t.dataset.sob] || 0) - ((RT.saiu || {})[t.dataset.sob] || 0); t.textContent = v; t.style.color = v < 0 ? '#B8402A' : ''; }); salvar(c); });
  if ($('#cgAdd')) $('#cgAdd').onchange = e => { if (!e.target.value) return; const c = { ...cargaFinal(cg).q, ...ler(), [e.target.value]: 1 }; RT.salvo.carga = c; box.innerHTML = painelCarga(cg); ligarCarga(cg); salvar(c); };
  if ($('#cgReset')) $('#cgReset').onclick = () => { RT.salvo.carga = null; box.innerHTML = painelCarga(cg); ligarCarga(cg); salvar(null); };
  // caixa fechada: soma (ou tira) a composição da caixa em "Levar"
  const caixa = (i, sinal) => { const c = { ...cargaFinal(cg).q, ...ler() }; Object.entries(KITS[i].q).forEach(([cod, n]) => { const pr = S.base.produtos.find(x => x.bling_codigo === cod); if (pr) c[pr.id] = Math.max(0, (c[pr.id] || 0) + sinal * n); });
    RT.salvo.carga = c; box.innerHTML = painelCarga(cg); ligarCarga(cg); salvar(c); };
  box.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => caixa(+b.dataset.cx, 1));
  box.querySelectorAll('[data-cxm]').forEach(b => b.onclick = () => caixa(+b.dataset.cxm, -1));
}
// as outras pessoas que podem rodar (para "jogar" um cliente para a rota delas)
const outrosMot = () => (RT.perfis || []).filter(p => p.id !== RT.salvo?.motorista);
async function passarCliente(id, para) {
  const R = RT.salvo, p = S.pdvs.find(x => x.id === id), quem = RT.perfis.find(x => x.id === para)?.nome || 'outro';
  const r = (RT.outras || []).find(x => x.motorista === para) || { data: R.data, motorista: para, tipo: 'reposicao', inicio: R.inicio, fim: R.fim, incluir: [], tirar: [], paradas: [] };
  try { const nv = await db.salvarRota({ data: r.data, motorista: para, tipo: r.tipo, inicio: r.inicio, fim: r.fim, incluir: [...new Set([...(r.incluir || []), id])], tirar: (r.tirar || []).filter(x => x !== id), paradas: r.paradas || [] });
    nv.data = R.data; RT.outras = [...(RT.outras || []).filter(x => x.motorista !== para), nv];
  } catch (e) { return toast(/on conflict|unique or exclusion/i.test(e.message || '') ? 'Rode o 031_rota_por_pessoa.sql no Supabase para ter uma rota para cada um' : 'Erro: ' + e.message); }
  await salvarRotaDia({ tirar: [...new Set([...R.tirar, id])], incluir: R.incluir.filter(x => x !== id), paradas: (R.paradas || []).filter(x => x.id !== id) }, `${p?.nome || 'Cliente'} foi para a rota de ${quem}`);
  desenharRota();
}
function linksMaps(base, ordem, de = null, pulo = 0, aqui = null) { // aqui: localização atual do celular (o trajeto sai dela) e termina na última parada // de: última parada concluída (o trajeto sai dela); pulo: quantas já foram feitas, para numerar
  const pto = p => { const hex = (String(p.link_maps || '').match(/(0x[0-9a-f]+:0x[0-9a-f]+)/i) || [])[1];
    return hex ? { seg: encodeURIComponent(p.nome || 'Parada').replace(/%20/g, '+'), blk: `!1m5!1m1!1s${hex}!2m2!1d${(+p.lng).toFixed(6)}!2d${(+p.lat).toFixed(6)}`, n: 6, ficha: true }
      : { seg: `${(+p.lat).toFixed(5)},${(+p.lng).toFixed(5)}`, blk: '!1m0', n: 1, ficha: false }; };
  const o = pto({ lat: base.lat, lng: base.lng }), o0 = aqui ? pto(aqui) : de ? pto(de) : o, pts = ordem.map(s => pto(s.p)), out = [];
  for (let i = 0; i < pts.length; i += 9) { const tr = pts.slice(i, i + 9), fimTr = i + 9 >= pts.length;
    const lista = [i ? pts[i - 1] : o0, ...tr, ...(fimTr && !aqui ? [o] : [])], dentro = lista.reduce((a, x) => a + x.n, 0) + 1;
    out.push({ n: `${pulo + i + 1}–${pulo + i + tr.length}`, fichas: tr.filter(x => x.ficha).length, url: `https://www.google.com/maps/dir/${lista.map(x => x.seg).join('/')}/data=!4m${dentro + 1}!4m${dentro}${lista.map(x => x.blk).join('')}!3e0` }); }
  return out;
}
async function salvarRotaDia(patch, msg) {
  Object.assign(RT.salvo, patch);
  try { const { data, motorista, tipo, inicio, fim, incluir, tirar, paradas, carga } = RT.salvo; RT.salvo = await db.salvarRota({ data, motorista, tipo, inicio, fim, incluir, tirar, paradas, ...(carga !== undefined ? { carga } : {}) }); RT.salvo.data = data; RT.semTabela = false; if (msg) toast(msg); }
  catch (e) { RT.semTabela = true; if (/carga/.test(e.message || '')) { delete RT.salvo.carga; return toast('Para salvar a carga ajustada, rode o 032_carga_da_rota.sql no Supabase'); } toast(/on conflict|unique or exclusion/i.test(e.message || '') ? 'Não salvou: rode o 031_rota_por_pessoa.sql no Supabase (uma rota para cada um no mesmo dia)' : 'Não salvou: rode o 019_dia_de_rota.sql no Supabase'); }
}
async function desenharRota() {
  let k = calcularRota();
  if (await garantirMatriz([k.base, ...k.fixos.map(s => s.p), ...k.ordem.map(s => s.p), ...k.foraRep.map(s => s.p)])) k = calcularRota();
  pintarRota(k);
}
function pintarRota(k) {
  const R = RT.salvo, c = cfgRota();
  const todas = [...k.fixos, ...k.ordem], hs = k.sim ? k.sim.hs : [];
  const linha = (s, i, h) => { const p = s.p, pv = RT.prev[p.id] || {}, est = k.feitos.has(p.id) || k.st[p.id] === 'feito' ? 'feito' : k.st[p.id] === 'ausente' ? 'ausente' : null;
    const u = URG[pv.urg] || URG.espera, rep = s.tipo === 'rep';
    return `<div class="stop rstop ${est ? 'done' : ''}" data-id="${p.id}">${!est && i >= k.fixos.length ? `<div class="grip" data-grip="${p.id}" title="Arraste para mudar a ordem">⠿</div>` : ''}<div class="n" style="background:${corPin(s, est)}">${est === 'feito' ? '✓' : est === 'ausente' ? '🚪' : i + 1}</div>
     <div class="info"><div class="rhora">${est === 'feito' ? '✅ feito' : est === 'ausente' ? '🚪 não estava' : h ? `${hhmm(h.comeca)}${h.espera > 4 ? ` <small>(chega ${hhmm(h.chega)}, espera ${Math.round(h.espera)} min)</small>` : ''}${h.foraJanela ? ' <small style="color:#B8402A">⚠️ fora do horário do cliente</small>' : ''}` : ''}</div>
      <b class="lnkperfil" data-perfil="${p.id}" title="Abrir o perfil do negócio">${esc(p.nome)}</b>${encDoDia((S.base.regras.encomendas || {})[p.id], R.data) && !est ? (e => ` <span class="badge" style="background:var(--bg-ok)" title="${esc(e.obs || 'Pedido já combinado')}">📦 ${e.tipo === 'venda' ? 'venda para entregar' : 'pedido para entrega'}${entregaTxt(e) ? ' · ' + esc(entregaTxt(e)) : ''}</span>`)(S.base.regras.encomendas[p.id]) : ''} ${est ? '' : rep ? `<span class="badge" style="background:${u.c}22">${u.i} ${pv.dias <= 0 ? 'possível zerado' : `~${Math.round(pv.dias)} dia${Math.round(pv.dias) === 1 ? '' : 's'}`}</span>` : '<span class="badge" style="background:#7B4FC022">🟣 prospecção</span>'}
      ${p.precisa_dono !== false && (p.janela_dias?.length || p.janela_periodo) ? ' <span title="Precisa do dono">🔒</span>' : ''}${ehCanoas(p) ? ' <span class="badge">Canoas</span>' : ''}
      <br><small style="color:var(--mute)">${esc(p.bairro || '')}${janelaTxt(p) ? ' · 🕘 ' + esc(janelaTxt(p)) : ' · sem janela cadastrada'}${rep && pv.deixado != null ? ` · deixado ${pv.deixado} un. em ${dstr(pv.deixadoEm)}${pv.estoque != null ? ` · estimado ~${Math.round(pv.estoque)}` : ''}` : ''}${rep && pv.un ? ` · repor ~${pv.un} un.` : ''}${rep ? ` · previsão por ${pv.fonte}` : ''}</small></div>
     ${est === 'feito' && rep && RT.visitas.some(v => v.pdv_id === p.id && v.tipo === 'reposicao') ? `<div class="racoes"><button class="mini reabrir" data-reab="${p.id}">reabrir reposição</button></div>` : ''}${est ? '' : `<div class="racoes">${encVenda(p.id) && encDoDia(encVenda(p.id), R.data) ? `<button class="btn pri" data-entv="${p.id}">Entregar</button>` : rep ? `<button class="btn pri" data-rep="${p.id}">Repor</button>` : `<button class="btn pri" data-pv="${p.id}">Visitei</button>`}<button class="mini" data-aus="${p.id}">não estava</button><button class="mini" data-tira="${p.id}">tirar</button>${outrosMot().map(m => `<button class="mini" data-passa="${p.id}" data-para="${m.id}" title="Passar para a rota de ${esc(m.nome)}">→ ${esc(m.nome)}</button>`).join('')}</div>`}</div>`; };
  const nRep = todas.filter(s => s.tipo === 'rep'), nPr = todas.filter(s => s.tipo === 'prosp');
  const feitosN = l => l.filter(s => k.feitos.has(s.id) || k.st[s.id] === 'feito').length;
  const cg = carga(todas.filter(s => !k.feitos.has(s.id)));
  // o que já saiu do carro hoje nas reposições desta rota (inclui trocas e bonificação)
  const ids = new Set(todas.map(s => s.id)), vRota = new Set((RT.visitas || []).filter(v => v.tipo === 'reposicao' && ids.has(v.pdv_id)).map(v => v.id));
  RT.saiu = {}; (RT.cont || []).filter(c => vRota.has(c.visita_id)).forEach(c => RT.saiu[c.produto_id] = (RT.saiu[c.produto_id] || 0) + (c.reposto || 0));
  const foraLista = [...k.foraRep.map(s => ({ p: s.p, m: 'não cabe no horário' })), ...k.naoHoje.map(x => ({ p: x.p, m: 'não atende neste dia' }))];
  const naFila = k.fila.filter(x => !todas.some(s => s.id === x.p.id) && !foraLista.some(f => f.p.id === x.p.id));
  const base = k.base;
  $('#main').innerHTML = `<section class="view on"><div class="route rotadia">
  <div class="toolbar"><h2 style="font-family:var(--fh);margin:0 10px 0 0">Dia de rota</h2>
   <input type="date" id="rData" value="${R.data}"><label class="rlbl">Rota de <select id="rMot">${RT.perfis.map(p => `<option value="${p.id}" ${p.id === R.motorista ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>
   <div class="seg" id="rTipo">${Object.entries(TIPOS_DIA).map(([t, n]) => `<button class="${R.tipo === t ? 'on' : ''}" data-t="${t}">${n}</button>`).join('')}</div>
   <label class="rlbl">das <input type="time" id="rIni" value="${R.inicio}"></label><label class="rlbl">às <input type="time" id="rFim" value="${R.fim}"></label></div>
  <div class="toolbar"><span class="rbase">🏠 Saída e volta: <b>${base.end ? esc(base.end) : '⚠️ endereço do Moisés não cadastrado (usando o centro de Canoas)'}</b> <button class="mini" id="rBase">alterar</button></span>
   ${RT.semTabela ? '<span class="badge" style="background:var(--bg-bad)">A rota não está salvando: rode o SQL indicado no aviso</span>' : ''}
   ${(RT.outras || []).filter(r => (r.paradas || []).length || (r.incluir || []).length).map(r => `<span class="badge" style="background:var(--bg-info)">🚗 Rota de ${esc(RT.perfis.find(p => p.id === r.motorista)?.nome || 'outro')} neste dia: ${(r.paradas || []).length || (r.incluir || []).length} parada(s) <a href="#" data-verrota="${r.motorista}">ver</a></span>`).join(' ')}</div>
  <div class="tiles rtiles"><div class="tile hi"><small>Paradas</small><b>${todas.length}</b><small>${nRep.length} reposição · ${nPr.length} prospecção</small></div>
   <div class="tile"><small>Volta para casa</small><b>${k.sim ? hhmm(k.sim.volta) : '—'}</b><small id="rKm">${k.sim ? `~${Math.round(k.sim.km)} km rodados` : ''}</small></div>
   <div class="tile"><small>🔵 Reposição</small><b>${feitosN(nRep)}/${nRep.length}</b><small>feitas</small></div>
   <div class="tile"><small>🟣 Prospecção</small><b>${feitosN(nPr)}/${nPr.length}</b><small>visitadas</small></div></div>
  <div class="rgrid"><div>
   <div class="toolbar">${k.ordem.length ? linksMaps(base, k.ordem, k.fixos.length ? k.fixos[k.fixos.length - 1].p : null, k.fixos.length, RT.aqui).map((l, i) => `<a class="btn car gmlink" data-gmi="${i}" href="${l.url}" target="_blank" rel="noopener" style="text-decoration:none">Google Maps · paradas ${l.n} ↗</a>`).join('') + ` <small style="color:var(--mute)" id="gmDe">${RT.aqui ? 'saindo da sua localização atual' : k.fixos.length ? 'só o que falta, saindo de ' + esc(k.fixos[k.fixos.length - 1].p.nome) : 'buscando sua localização…'}</small>` : todas.length ? '<span class="badge" style="background:var(--bg-ok)">✅ Todas as paradas concluídas</span>' : ''}
    ${k.manual ? '<span class="badge" style="background:var(--bg-warn)">✋ ordem definida à mão</span>' : ''}<button class="btn" id="rRecalc">${k.manual ? '↻ Voltar à ordem automática' : '↻ Recalcular o resto'}</button>${R.data === hoje() ? '<button class="btn car" id="rComecar" title="Começa agora: refaz a previsão de horário a partir deste momento">▶ Começar rota agora</button>' : ''}<button class="btn pri" id="rSalvar">Salvar rota</button></div>
   <div class="stop rstop rcasa"><div class="n">🏠</div><div class="info"><div class="rhora">${R.inicio}</div><b>Saída</b> <small style="color:var(--mute)">carregar o carro (lista abaixo)</small></div></div>
   ${todas.map((s, i) => linha(s, i, i >= k.fixos.length ? hs[i - k.fixos.length] : null)).join('') || '<div class="empty">Nenhuma parada para este dia. Escolha clientes na fila abaixo.</div>'}
   ${todas.length ? `<div class="stop rstop rcasa"><div class="n">🏠</div><div class="info"><div class="rhora">${k.sim ? hhmm(k.sim.volta) : ''}</div><b>Volta</b></div></div>` : ''}
  </div><div><div id="rmap"></div>
   <div class="panel" style="margin-top:12px" id="rCarga">${painelCarga(cg)}</div></div></div>
  ${foraLista.length ? `<div class="panel rfora"><h3 style="margin-top:0">⚠️ Urgentes que ficaram fora</h3>${foraLista.map(f => `<div class="rfila"><span>${URG[RT.prev[f.p.id]?.urg]?.i || ''} <b>${esc(f.p.nome)}</b> <small>${f.m} · próximo dia na janela: ${proximoDiaJanela(f.p, R.data)}</small></span>${f.m === 'não cabe no horário' ? `<button class="mini" data-tira="${f.p.id}">tirar de hoje</button>` : `<button class="mini" data-inc="${f.p.id}">pôr mesmo assim</button>`}</div>`).join('')}</div>` : ''}
  <div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Pôr um cliente na rota</h3><div class="mbusca" style="max-width:420px"><input id="rLivre" autocomplete="off" placeholder="🔍 Qualquer cliente ou prospect pelo nome…"><div id="rLivreSug" class="sugs"></div></div>
   <small style="color:var(--mute)">Entra na rota de hoje mesmo sem reposição prevista (inclui consumidor final). Para mudar a ordem, arraste a parada pela alça ⠿.</small></div>
  <div class="panel" style="margin-top:12px"><h3 style="margin-top:0">Fila de urgência <small style="font-weight:400;color:var(--mute)">· clientes que não estão na rota de hoje</small></h3>
   ${['ruptura', 'ideal', 'espera'].map(u => { const l = naFila.filter(x => x.urg === u); return l.length ? `<div class="lingrp">${URG[u].i} ${URG[u].n} · ${l.length}</div>${l.map(x => `<div class="rfila"><span><b>${esc(x.p.nome)}</b> <small>${x.dias <= 0 ? 'possível zerado' : `~${Math.round(x.dias)} dias`} · ${esc(x.p.bairro || regNome(x.p.regiao))}${ehCanoas(x.p) ? ' · Canoas (Moisés)' : ''}${janelaTxt(x.p) ? ' · 🕘 ' + esc(janelaTxt(x.p)) : ''}</small></span><button class="mini" data-inc="${x.p.id}">+ pôr na rota</button>${outrosMot().map(m => `<button class="mini" data-passa="${x.p.id}" data-para="${m.id}">→ ${esc(m.nome)}</button>`).join('')}</div>`).join('')}` : ''; }).join('') || '<span style="color:var(--mute)">Todos os clientes já estão na rota.</span>'}
   ${R.tipo !== 'reposicao' ? `<div class="lingrp">🟣 Prospecção ${R.tipo === 'misto' ? '· até 500 m da rota entram sozinhos; busque outros' : ''}</div><div class="mbusca" style="max-width:420px"><input id="rProsp" autocomplete="off" placeholder="🔍 Pôr um prospect na rota…"><div id="rProspSug" class="sugs"></div></div>${k.foraP.length ? `<small style="color:var(--mute)">${k.foraP.length} prospect(s) perto da rota não couberam no horário.</small>` : ''}` : ''}
  </div></div></section>`;
  ligarRota(k, todas);
}
function ligarRota(k, todas) {
  // início do trajeto no Google Maps = onde o celular está agora (atualiza enquanto a tela está aberta)
  const gm = pos => { RT.aqui = { lat: pos.coords.latitude, lng: pos.coords.longitude, em: Date.now() };
    const ls = linksMaps(k.base, k.ordem, null, k.fixos.length, RT.aqui); document.querySelectorAll('a.gmlink').forEach(a => { const l = ls[+a.dataset.gmi]; if (l) a.href = l.url; });
    if ($('#gmDe')) $('#gmDe').textContent = 'saindo da sua localização atual'; };
  if (navigator.geolocation && k.ordem.length) {
    if (RT.gmWatch != null) navigator.geolocation.clearWatch(RT.gmWatch);
    RT.gmWatch = navigator.geolocation.watchPosition(p => { if (!document.querySelector('a.gmlink')) { navigator.geolocation.clearWatch(RT.gmWatch); RT.gmWatch = null; return; } gm(p); },
      () => { if ($('#gmDe') && !RT.aqui) $('#gmDe').textContent = 'sem acesso à localização: permita no navegador para sair de onde você está'; }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
  }
  document.querySelectorAll('[data-passa]').forEach(b => b.onclick = () => passarCliente(b.dataset.passa, b.dataset.para));
  ligarCarga(carga(todas.filter(s => !k.feitos.has(s.id))));
  const R = RT.salvo, comStatus = () => (R.paradas || []).filter(x => x.status), troca = async patch => { await salvarRotaDia({ ...patch, paradas: comStatus() }); desenharRota(); };
  $('#rData').onchange = e => { RT.data = e.target.value; telaRota(); };
  $('#rMot').onchange = e => { RT.motorista = e.target.value; telaRota(); }; // troca de rota (cada um tem a sua no dia)
  document.querySelectorAll('[data-verrota]').forEach(a => a.onclick = e => { e.preventDefault(); RT.motorista = a.dataset.verrota; telaRota(); });
  $('#rTipo').onclick = e => { const t = e.target.dataset.t; if (t) troca({ tipo: t }); };
  $('#rIni').onchange = e => troca({ inicio: e.target.value }); $('#rFim').onchange = e => troca({ fim: e.target.value });
  const fixar = (manual = k.manual) => [...k.fixos, ...k.ordem].map(s => ({ id: s.id, tipo: s.tipo, status: (R.paradas || []).find(x => x.id === s.id)?.status || null, ...(manual ? { manual: true } : {}) }));
  $('#rSalvar').onclick = async () => { await salvarRotaDia({ paradas: fixar() }, 'Rota salva'); desenharRota(); };
  if ($('#rComecar')) $('#rComecar').onclick = async () => { const n = new Date(), hm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    await salvarRotaDia({ inicio: hm, fim: minDe(R.fim) <= minDe(hm) ? '22:00' : R.fim, paradas: fixar() }, `Rota começou às ${hm}: horários recalculados`); desenharRota(); };
  document.querySelectorAll('[data-perfil]').forEach(b => b.onclick = () => abrirPerfil(b.dataset.perfil));
  $('#rRecalc').onclick = async () => { await salvarRotaDia({ paradas: fixar(false) }, k.manual ? 'Voltou para a ordem automática' : 'Rota recalculada a partir de agora'); desenharRota(); };
  // arrastar a parada pela alça ⠿: solta no lugar novo e a rota (horários e links do Google Maps) é refeita nessa ordem
  const salvarOrdem = async ids => { const l = [...k.fixos, ...ids.map(id => k.ordem.find(s => s.id === id))], y = window.scrollY;
    await salvarRotaDia({ paradas: l.map(s => ({ id: s.id, tipo: s.tipo, status: (R.paradas || []).find(x => x.id === s.id)?.status || null, manual: true })) }); await desenharRota(); window.scrollTo(0, y); }; // continua no mesmo ponto da lista
  document.querySelectorAll('[data-grip]').forEach(g => g.onpointerdown = e => {
    if (e.button > 0) return; e.preventDefault();
    const cards = [...document.querySelectorAll('.rstop[data-id]')].filter(c => c.querySelector('[data-grip]')), card = g.closest('.rstop'), i0 = cards.indexOf(card);
    const tops = cards.map(c => c.getBoundingClientRect().top + window.scrollY), passo = cards.length > 1 ? tops[1] - tops[0] : card.offsetHeight + 8;
    const y0 = e.clientY + window.scrollY; let alvo = i0;
    card.classList.add('arrastando'); try { g.setPointerCapture(e.pointerId); } catch { }
    const mexe = ev => { const y = ev.clientY + window.scrollY, dy = y - y0; card.style.transform = `translateY(${dy}px)`;
      const centro = tops[i0] + card.offsetHeight / 2 + dy; alvo = Math.max(0, Math.min(cards.length - 1, cards.filter((c, j) => j !== i0 && tops[j] + c.offsetHeight / 2 < centro).length));
      cards.forEach((c, j) => { if (j === i0) return; c.style.transform = i0 < alvo && j > i0 && j <= alvo ? `translateY(${-passo}px)` : alvo < i0 && j >= alvo && j < i0 ? `translateY(${passo}px)` : ''; });
      if (ev.clientY < 60) window.scrollBy(0, -12); else if (ev.clientY > innerHeight - 60) window.scrollBy(0, 12); };
    const solta = () => { g.removeEventListener('pointermove', mexe); g.removeEventListener('pointerup', solta); g.removeEventListener('pointercancel', solta);
      card.classList.remove('arrastando'); cards.forEach(c => c.style.transform = '');
      if (alvo === i0) return; const ids = cards.map(c => c.dataset.id); ids.splice(alvo, 0, ids.splice(i0, 1)[0]); salvarOrdem(ids); };
    g.addEventListener('pointermove', mexe); g.addEventListener('pointerup', solta); g.addEventListener('pointercancel', solta); });
  // cliente que está na rota do outro no mesmo dia: mostra de quem é e, se for posto aqui, sai de lá
  const outraCom = id => (RT.outras || []).find(r => (r.paradas || []).some(s => s.id === id && !s.status) || (r.incluir || []).includes(id));
  const noOutro = id => { const r = outraCom(id); return r ? (RT.perfis.find(p => p.id === r.motorista)?.nome || 'outro') : null; };
  const tirarDoOutro = async id => { const r = outraCom(id); if (!r) return;
    try { const nv = await db.salvarRota({ data: r.data, motorista: r.motorista, tipo: r.tipo, inicio: r.inicio, fim: r.fim, incluir: (r.incluir || []).filter(x => x !== id), tirar: [...new Set([...(r.tirar || []), id])], paradas: (r.paradas || []).filter(s => s.id !== id || s.status) }); Object.assign(r, nv); } catch (e) { erro(e); } };
  // busca para pôr qualquer cliente na rota (mesma busca do mapa: nome, razão social, bairro, cidade)
  const ligarBusca = (inp, box, filtro) => { if (!inp) return;
    const listar = () => { const t = norm(inp.value); if (t.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }
      const l = S.pdvs.filter(p => p.etapa !== 'fechado' && filtro(p) && !todas.some(s => s.id === p.id) && norm([p.nome, p.razao_social, p.bairro, p.cidade].filter(Boolean).join(' ')).includes(t)).slice(0, 10);
      box.innerHTML = l.map(p => `<div data-livre="${p.id}" ${p.lat ? '' : 'style="opacity:.55"'}><b>${esc(p.nome)}</b> <small style="color:${etapa(p.etapa).c};font-weight:700">${etapa(p.etapa).n}</small>${p.consumidor_final ? ' <small>· consumidor final</small>' : ''}${noOutro(p.id) ? ` <small style="color:#3F6FA8">· na rota de ${esc(noOutro(p.id))} (passa para esta)</small>` : ''}<br><small style="color:var(--mute)">${esc([p.bairro, p.cidade].filter(Boolean).join(' · '))}${p.lat ? '' : ' · sem localização no mapa'}</small></div>`).join('') || '<div style="color:var(--mute)">Nenhum cliente encontrado</div>';
      box.style.display = 'block';
      box.querySelectorAll('[data-livre]').forEach(d => d.onmousedown = async e => { e.preventDefault(); const id = d.dataset.livre, p = S.pdvs.find(x => x.id === id);
        if (!p.lat) return toast('Esse cliente não tem localização: abra o perfil e use Ajustar localização ou Editar endereço');
        box.style.display = 'none'; inp.value = ''; await tirarDoOutro(id); await salvarRotaDia({ incluir: [...new Set([...R.incluir, id])], tirar: R.tirar.filter(x => x !== id) }, p.nome + ' entrou na rota'); desenharRota(); }); };
    inp.oninput = listar; inp.onfocus = listar; inp.onblur = () => setTimeout(() => { box.style.display = 'none'; }, 150);
    inp.onkeydown = e => { if (e.key === 'Enter') box.querySelector('[data-livre]')?.dispatchEvent(new MouseEvent('mousedown')); if (e.key === 'Escape') { inp.value = ''; listar(); } }; };
  ligarBusca($('#rLivre'), $('#rLivreSug'), () => true);
  document.querySelectorAll('[data-inc]').forEach(b => b.onclick = async () => { const id = b.dataset.inc; await salvarRotaDia({ incluir: [...new Set([...R.incluir, id])], tirar: R.tirar.filter(x => x !== id) }); desenharRota(); });
  // tirar da rota: pergunta o motivo (postergar ou cliente negou) e grava no histórico do negócio
  document.querySelectorAll('[data-tira]').forEach(b => b.onclick = () => { const id = b.dataset.tira, p = S.pdvs.find(x => x.id === id);
    modal(`<h3>Tirar ${esc(p.nome)} da rota</h3>
     <div class="tiraops"><label><input type="radio" name="tmot" value="adiar" checked><span><b>Postergar a entrega</b><small>Fica para outro dia</small></span></label>
      <div id="tAte" style="margin:-2px 0 6px 28px"><small>Voltar a entrar na rota a partir de</small>
       <div class="row" style="gap:6px;flex-wrap:wrap;margin:4px 0"><select id="tMes" style="width:auto"><option value="">Mês…</option>${mesesAdiar(R.data).map(m => `<option value="${m.v}">${m.n}</option>`).join('')}</select>
        <select id="tSem" style="width:auto">${['1ª', '2ª', '3ª', '4ª', 'última'].map((n, i) => `<option value="${i + 1}">${n} semana</option>`).join('')}</select>
        <input type="date" id="tData" min="${R.data}" style="width:150px"></div>
       <small id="tSug" style="color:var(--soft);display:block"></small><small style="color:var(--mute)">Em branco: sai só da rota deste dia.</small></div>
      <label><input type="radio" name="tmot" value="negou"><span><b>Cliente negou a reposição</b><small>Não quis repor agora</small></span></label></div>
     <label>Motivo</label><textarea id="tTxt" rows="3" style="width:100%" placeholder="Ex.: dono viajando, volta segunda; ainda tem bastante produto…"></textarea>
     <p style="color:var(--soft);font-size:12px;margin:6px 0 0">Fica registrado no histórico do negócio.</p>
     <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="tOk">Tirar da rota</button></div>`);
    document.querySelectorAll('input[name=tmot]').forEach(r => r.onchange = () => $('#tAte').style.display = document.querySelector('input[name=tmot]:checked').value === 'adiar' ? '' : 'none');
    const sugere = () => { const m = $('#tMes').value; if (!m) return; const r = diaDaRegiao(p, m, +$('#tSem').value, R.data); $('#tData').value = r.data; $('#tSug').innerHTML = `→ entra na rota <b>${DIAS[r.dow].toLowerCase()}, ${dstr(r.data + 'T12:00')}</b> · ${esc(r.por)}`; };
    $('#tMes').onchange = sugere; $('#tSem').onchange = sugere; $('#tData').onchange = () => { $('#tMes').value = ''; $('#tSug').textContent = ''; };
    $('#tOk').onclick = async () => { const tipo = document.querySelector('input[name=tmot]:checked').value, txt = $('#tTxt').value.trim(), ate = tipo === 'adiar' ? $('#tData').value : '';
      if (!txt) return toast('Escreva o motivo');
      if (ate && ate <= R.data) return toast('A data precisa ser depois de hoje');
      const nota = `${tipo === 'adiar' ? '🗓️ Entrega postergada' + (ate ? ' até ' + dstr(ate + 'T12:00') : '') : '🚫 Cliente negou a reposição'} (rota de ${dstr(R.data + 'T12:00')}): ${txt}`;
      $('#tOk').disabled = true;
      if (ate) { const ad = { ...(S.base.regras.adiados || {}), [id]: ate }; try { await db.salvarRegra('adiados', ad); S.base.regras.adiados = ad; } catch (e) { $('#tOk').disabled = false; return erro(e); } }
      try { await db.criarNota(id, nota, S.eu.id); } catch (e) { toast(/pdv_notas/.test(e.message) ? 'Saiu da rota, mas o motivo não foi guardado: rode o 022_observacoes.sql' : 'Saiu da rota, mas o motivo não foi guardado'); }
      fecharModal(); await salvarRotaDia({ tirar: [...new Set([...R.tirar, id])], incluir: R.incluir.filter(x => x !== id), paradas: (R.paradas || []).filter(x => x.id !== id) }, ate ? `Postergado até ${dstr(ate + 'T12:00')} · motivo no histórico` : 'Tirado da rota · motivo no histórico'); desenharRota(); }; });
  document.querySelectorAll('[data-rep]').forEach(b => b.onclick = async () => { if (!R.paradas?.length) await salvarRotaDia({ paradas: fixar() }); S.contando = b.dataset.rep; irPara('reposicao'); });
  document.querySelectorAll('[data-entv]').forEach(b => b.onclick = async () => { if (!R.paradas?.length) await salvarRotaDia({ paradas: fixar() }); S.abPdv = b.dataset.entv; S.vendaVolta = { aba: 'rota' }; irPara('abertura'); });
  document.querySelectorAll('[data-aus]').forEach(b => b.onclick = async () => { const id = b.dataset.aus, p = S.pdvs.find(x => x.id === id);
    const ps = (R.paradas?.length ? R.paradas : fixar()).map(x => x.id === id ? { ...x, status: 'ausente' } : x);
    await salvarRotaDia({ paradas: ps }); toast(`${p.nome}: não estava. Próximo dia na janela: ${proximoDiaJanela(p, R.data)}`); desenharRota(); });
  document.querySelectorAll('[data-pv]').forEach(b => b.onclick = async () => { const p = S.pdvs.find(x => x.id === b.dataset.pv);
    try { await db.registrarVisita(p.id, 'prospeccao', null, S.eu.id); if (p.etapa === 'mapeado') await db.atualizarPdv(p.id, { etapa: 'visitado' }); } catch (e) { return erro(e); }
    await salvarRotaDia({ paradas: (R.paradas?.length ? R.paradas : fixar()).map(x => x.id === p.id ? { ...x, status: 'feito' } : x) }, 'Visita registrada'); completarCadastro(p, () => telaRota()); });
  document.querySelectorAll('[data-reab]').forEach(b => b.onclick = () => { const p = S.pdvs.find(x => x.id === b.dataset.reab), v = RT.visitas.filter(x => x.pdv_id === p.id && x.tipo === 'reposicao').sort((a, b) => new Date(b.em) - new Date(a.em))[0];
    modal(`<h3>Reabrir a reposição de ${esc(p.nome)}?</h3><p style="color:var(--soft)">Apaga a reposição lançada (pedido e contagem) e <b>exclui o pedido de venda no Bling</b>. Depois abre a contagem com os mesmos números para você corrigir e fechar de novo, o que cria um pedido novo no Bling.</p><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="reOk">Reabrir</button></div>`);
    $('#reOk').onclick = async () => { $('#reOk').disabled = true; $('#reOk').textContent = 'Reabrindo…';
      try { const d = await db.dadosReabrir(v.id);
        if (d.pedido?.bling_id) await db.bling('excluir_pedido', { pedido_id: d.pedido.id });
        if (d.pedido) await db.excluirPedido(d.pedido.id, v.id); else await db.excluirPedido('00000000-0000-0000-0000-000000000000', v.id);
        S.reabrir = { pdvId: p.id, contagens: d.contagens, condicao: d.pedido?.condicao, vencimento: d.pedido?.vencimento, bonif: Object.fromEntries((d.itens || []).filter(i => i.bonificado).map(i => [i.produto_id, i.bonificado])) };
        fecharModal(); toast(d.pedido?.bling_id ? `Pedido nº ${d.pedido.bling_pedido_id || d.pedido.bling_id} excluído do Bling` : 'Reposição reaberta'); await recarregar(); S.contando = p.id; irPara('reposicao');
      } catch (e) { fecharModal(); modal(`<h3>Não deu para reabrir</h3><p style="font-size:13px;color:var(--t-bad)">${esc(e.message)}</p><p style="color:var(--soft)">Nada foi apagado no app. Se o Bling recusou (por exemplo, pedido já faturado), cancele por lá primeiro.</p><div class="row" style="justify-content:flex-end"><button class="btn pri" onclick="fecharModal()">Ok</button></div>`); } }; });
  $('#rBase').onclick = () => { const b = baseRota();
    modal(`<h3>Ponto de saída e volta</h3><p style="color:var(--soft);margin-top:0">Casa do Moisés, onde fica o estoque. A rota sai daqui e volta para cá.</p><label>Endereço</label><input id="rbEnd" value="${esc(b.end || '')}" placeholder="Rua, número, bairro, Canoas" style="width:100%">
     <div class="row" style="margin-top:8px"><div style="flex:1"><label>Tempo em cada reposição (min)</label><input id="rbTr" type="number" value="${cfgRota().tempo_rep}"></div><div style="flex:1"><label>Tempo em cada prospecção (min)</label><input id="rbTp" type="number" value="${cfgRota().tempo_prosp}"></div></div>
     <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="rbOk">Salvar</button></div>`);
    $('#rbOk').onclick = async () => { const end = $('#rbEnd').value.trim(), nv = { ...cfgRota(), tempo_rep: +$('#rbTr').value || 20, tempo_prosp: +$('#rbTp').value || 15 };
      if (end && end !== b.end) { $('#rbOk').disabled = true; $('#rbOk').textContent = 'Localizando…';
        // procura só na Grande Porto Alegre; sem cidade no texto, prefere Canoas (onde fica o estoque)
        try { const busca = async q => (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=br&accept-language=pt-BR&viewbox=-51.7,-29.3,-49.9,-30.4&bounded=1&q=${encodeURIComponent(q)}`)).json();
          let r = await busca(end); const temCidade = /canoas|porto alegre|novo hamburgo|esteio|sapucaia|cachoeirinha|gravata|alvorada|viam|s[aã]o leopoldo|capão|capao/i.test(end);
          if (!temCidade) { const rc = await busca(end + ', Canoas'); if (rc.length) r = rc; }
          if (!r.length) { $('#rbOk').disabled = false; $('#rbOk').textContent = 'Salvar'; return toast('Não achei esse endereço. Confira rua, número e cidade.'); }
          Object.assign(nv, { endereco: end, lat: +r[0].lat, lng: +r[0].lon }); toast('Localizado: ' + r[0].display_name.split(', Rio Grande do Sul')[0]); } catch (e) { return erro(e); } }
      try { await db.salvarRegra('rota', nv); S.base.regras.rota = nv; fecharModal(); toast('Ponto de saída salvo'); desenharRota(); } catch (e) { erro(e); } }; };
  ligarBusca($('#rProsp'), $('#rProspSug'), p => PROSP_ETAPAS.includes(p.etapa));
  // mapa: mesma cor e símbolo da lista (urgência, prospecção, feito, não estava) e o caminho pelas ruas
  if (RT.mapa) { RT.mapa.remove(); RT.mapa = null; }
  const el = $('#rmap'); if (!el || !window.L) return;
  const m = RT.mapa = L.map(el, { zoomControl: true }); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
  const b = k.base, pts = [[b.lat, b.lng]];
  L.marker([b.lat, b.lng], { icon: L.divIcon({ className: '', html: '<div class="rpin casa">🏠</div>', iconSize: [28, 28], iconAnchor: [14, 14] }), zIndexOffset: 1000 }).addTo(m).bindTooltip('Saída e volta');
  todas.forEach((s, i) => { pts.push([s.p.lat, s.p.lng]); const st = estParada(k, s.id), pv = RT.prev[s.id] || {};
    const sim = st === 'feito' ? '✓' : st === 'ausente' ? '🚪' : i + 1, extra = s.p.precisa_dono !== false && (s.p.janela_dias?.length || s.p.janela_periodo) ? '<i>🔒</i>' : '';
    L.marker([s.p.lat, s.p.lng], { icon: L.divIcon({ className: '', html: `<div class="rpin ${st ? 'ok' : ''}" style="background:${corPin(s, st)}">${sim}${extra}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(m)
      .bindTooltip(`<b>${i + 1}. ${esc(s.p.nome)}</b><br>${s.tipo === 'rep' ? `${URG[pv.urg]?.i || ''} ${pv.dias <= 0 ? 'possível zerado' : `~${Math.round(pv.dias)} dias`}` : '🟣 prospecção'}${st ? ` · ${st === 'feito' ? '✅ feito' : '🚪 não estava'}` : ''}`); });
  pts.push([b.lat, b.lng]);
  const reta = todas.length ? L.polyline(pts, { color: '#18181B', weight: 2, opacity: .5, dashArray: '6 6' }).addTo(m) : null;
  const leg = L.control({ position: 'bottomleft' }); leg.onAdd = () => { const d = L.DomUtil.create('div', 'rleg'); d.innerHTML = '<span><i style="background:#d03b3b"></i>Possível zerado</span><span><i style="background:#fab219"></i>Janela ideal</span><span><i style="background:#9A8F86"></i>Pode esperar</span><span><i style="background:#7B4FC0"></i>Prospecção</span><span><i style="background:#0ca30c"></i>✓ Feito</span><span>🚪 Não estava</span><span>🔒 Precisa do dono</span>'; return d; }; leg.addTo(m);
  setTimeout(() => { m.invalidateSize(); m.fitBounds(L.latLngBounds(pts).pad(0.1)); }, 50);
  if (todas.length) caminhoRuas(pts).then(g => { if (!g || RT.mapa !== m) return; reta.remove(); L.polyline(g.coords, { color: '#18181B', weight: 4, opacity: .7 }).addTo(m); const e = $('#rKm'); if (e) e.textContent = `${Math.round(g.km)} km pelas ruas · ${Math.round(g.min / 60 * 10) / 10} h dirigindo`; });
}
const estParada = (k, id) => k.feitos.has(id) || k.st[id] === 'feito' ? 'feito' : k.st[id] === 'ausente' ? 'ausente' : null;
const corPin = (s, st) => st === 'feito' ? '#0ca30c' : st === 'ausente' ? '#9A8F86' : s.tipo === 'prosp' ? '#7B4FC0' : (URG[RT.prev[s.id]?.urg] || URG.espera).c;
const CAM = {};
async function caminhoRuas(pts) {
  const chave = pts.map(p => p.map(x => x.toFixed(5)).join(',')).join(';'); if (CAM[chave]) return CAM[chave];
  try { const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${pts.map(([la, ln]) => `${ln.toFixed(5)},${la.toFixed(5)}`).join(';')}?overview=full&geometries=geojson`)).json();
    if (r.code !== 'Ok') return null; const rt = r.routes[0];
    return CAM[chave] = { coords: rt.geometry.coordinates.map(([ln, la]) => [la, ln]), km: rt.distance / 1000, min: rt.duration / 60 };
  } catch { return null; } }

/* =================== pagamento (mesmo jeito da Nova venda: forma, boletos, dividir, entrega) =================== */
function blocoPag(px, forma, venc) {
  return `<div id="${px}Pag"><div class="row" style="flex-wrap:wrap;gap:14px;align-items:flex-end"><div class="pay pgf" style="margin:0">${FORMAS.map(c => `<label><input type="radio" name="${px}c" value="${c}" ${c === forma ? 'checked' : ''}> ${c}</label>`).join('')}</div>
   <div class="pgvb"><label class="lb">Vencimento</label><div class="row" style="gap:6px;flex-wrap:nowrap"><input class="pgv" type="date" value="${venc || vencPadrao(forma)}">${atalhoPrazo('pgprz')}</div></div>
   <div class="pgnb"><label class="lb">Boletos</label><div class="nbol">${[1, 2, 3, 4].map(n => `<button type="button" data-nb="${n}" class="${n === 1 ? 'on' : ''}">${n}×</button>`).join('')}</div></div></div>
  <label class="chkcomp"><input type="checkbox" class="pgdiv"> Dividir o pagamento (entrada, vários boletos, Pix + cartão…)</label>
  <label class="chkcomp"><input type="checkbox" class="pgfr"> 🚚 Entrega terceirizada</label>
  <div class="divpag pgfrbox" hidden><div class="row"><label class="lb" style="margin:0">Custo da entrega</label><input class="pgfrv" type="number" step="0.01" min="0" inputmode="decimal" placeholder="R$" style="width:120px"></div>
   <div class="row frq"><label><input type="radio" name="${px}fq" value="1" checked> Cobrar do cliente <small>(soma no pedido)</small></label><label><input type="radio" name="${px}fq" value="0"> Por nossa conta <small>(só registra o custo)</small></label></div></div>
  <div class="divpag pgdivbox" hidden><div class="pgparc"></div><div class="row" style="justify-content:space-between"><button type="button" class="mini pgadd">+ parcela</button><small class="pginfo" style="color:var(--mute)"></small></div></div></div>`;
}
// liga o bloco; base() devolve o total dos itens; muda() é chamado quando algo do pagamento muda. Devolve { total, ler, preencher }
function ligarPag(px, base, muda = () => { }) {
  const R = document.getElementById(px + 'Pag'), q = sel => R.querySelector(sel), qa = sel => [...R.querySelectorAll(sel)];
  const cond = () => R.querySelector(`input[name=${px}c]:checked`).value;
  const frete = () => { const on = q('.pgfr').checked, v = on ? Math.round((+q('.pgfrv').value || 0) * 100) / 100 : 0; return { v, cobrado: on && v > 0 && R.querySelector(`input[name=${px}fq]:checked`)?.value === '1' }; };
  const total = () => { const f = frete(); return Math.round((base() + (f.cobrado ? f.v : 0)) * 100) / 100; };
  const vencDe = (f, i) => vencPadrao(f, f === 'Boleto' ? 7 * (i + 1) : 0);
  const linha = (f, i, v = '', d) => `<div class="row parc"><select class="pf">${FORMAS.map(x => `<option ${x === f ? 'selected' : ''}>${x}</option>`).join('')}</select><input class="pv" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Valor" value="${v}"><b class="pr" hidden></b><input class="pd" type="date" value="${d || vencDe(f, i)}"><button type="button" class="mini px" title="Tirar parcela">✕</button></div>`;
  const resto = () => { const ls = qa('.parc'); if (!ls.length) return; const tot = total(), pagos = ls.slice(0, -1).reduce((a, l) => a + (+l.querySelector('.pv').value || 0), 0), r = Math.round((tot - pagos) * 100) / 100;
    ls[ls.length - 1].querySelector('.pr').textContent = brl(Math.max(0, r)); q('.pginfo').textContent = r < 0 ? 'as parcelas passam do total' : `${ls.length} parcelas · total ${brl(tot)}`; };
  const ligarParc = () => { const ls = qa('.parc');
    ls.forEach((l, i) => { const ult = i === ls.length - 1; l.querySelector('.pv').hidden = ult; l.querySelector('.pr').hidden = !ult; l.querySelector('.px').hidden = ls.length <= 2;
      l.querySelector('.pv').oninput = () => { resto(); muda(); }; l.querySelector('.pf').onchange = e => { const nB = ls.slice(0, i).filter(x => x.querySelector('.pf').value === 'Boleto').length; l.querySelector('.pd').value = vencDe(e.target.value, nB); };
      l.querySelector('.px').onclick = () => { l.remove(); ligarParc(); resto(); muda(); }; }); };
  const montar = lista => { q('.pgparc').innerHTML = lista.map((x, i) => linha(x.f, i, x.v ?? '', x.d)).join(''); ligarParc(); resto(); };
  const abrirDiv = on => { q('.pgdiv').checked = on; q('.pgdivbox').hidden = !on; q('.pgf').classList.toggle('apagado', on); q('.pgvb').classList.toggle('apagado', on); };
  const mostraNB = () => { q('.pgnb').hidden = cond() !== 'Boleto'; q('.pgprz').hidden = cond() !== 'Boleto'; };
  q('.pgdiv').onchange = () => { abrirDiv(q('.pgdiv').checked); if (q('.pgdiv').checked && !qa('.parc').length) montar([{ f: 'Pix', v: '' }, { f: cond() === 'Boleto' ? 'Boleto' : 'Cartão' }]); muda(); };
  q('.pgfr').onchange = () => { q('.pgfrbox').hidden = !q('.pgfr').checked; resto(); muda(); }; q('.pgfrv').oninput = () => { resto(); muda(); };
  qa(`input[name=${px}fq]`).forEach(x => x.onchange = () => { resto(); muda(); });
  q('.pgadd').onclick = () => { const ls = qa('.parc'); if (ls.length >= 6) return toast('Até 6 parcelas'); q('.pgparc').insertAdjacentHTML('beforeend', linha(ls[ls.length - 1]?.querySelector('.pf').value || 'Boleto', ls.length)); ligarParc(); resto(); };
  qa('[data-nb]').forEach(b => b.onclick = () => { const n = +b.dataset.nb; qa('[data-nb]').forEach(x => x.classList.toggle('on', x === b));
    if (n === 1) { abrirDiv(false); q('.pgparc').innerHTML = ''; muda(); return; }
    const tot = total(), cada = tot ? Math.floor(tot / n * 100) / 100 : ''; abrirDiv(true); montar(Array.from({ length: n }, () => ({ f: 'Boleto', v: cada }))); muda(); });
  qa(`input[name=${px}c]`).forEach(x => x.onchange = () => { mostraNB(); q('.pgv').value = vencPadrao(cond()); muda(); });
  qa('.pgprz [data-prz]').forEach(b => b.onclick = () => { q('.pgv').value = vencPadrao('Boleto', +b.dataset.prz); muda(); });
  mostraNB();
  // lê o que foi escolhido: condição (ex.: "2× Boleto", "Pix + Boleto"), vencimento final e os campos extras do pedido
  const ler = () => { const tot = total(), ls = qa('.parc'), div = q('.pgdiv').checked && ls.length > 1; let soma = 0;
    const parc = div ? ls.map((l, i) => { const ult = i === ls.length - 1, v = ult ? Math.round((tot - soma) * 100) / 100 : Math.round((+l.querySelector('.pv').value || 0) * 100) / 100; soma += v; return { forma: l.querySelector('.pf').value, valor: v, vencimento: l.querySelector('.pd').value || null }; }) : [];
    const fp = [...new Set(parc.map(x => x.forma))], f = frete();
    const condicao = div ? (fp.length === 1 ? `${parc.length}× ${fp[0]}` : fp.join(' + ')) : cond();
    return { ok: !div || parc.every(x => x.valor > 0), condicao, forma: cond(), total: tot, vencimento: div ? parc.map(x => x.vencimento).filter(Boolean).sort().pop() || null : (q('.pgv').value || null), parcelas: parc, frete: f,
      extra: { ...(div ? { pagamentos: parc } : {}), ...(f.v ? { frete: f.v, frete_cobrado: f.cobrado } : {}) } }; };
  // repõe um pagamento guardado (encomenda)
  const preencher = g => { if (!g) return; const r = R.querySelector(`input[name=${px}c][value="${g.forma}"]`); if (r) r.checked = true; mostraNB(); if (g.vencimento) q('.pgv').value = g.vencimento;
    if (g.frete?.v) { q('.pgfr').checked = true; q('.pgfrbox').hidden = false; q('.pgfrv').value = g.frete.v; const fq = R.querySelector(`input[name=${px}fq][value="${g.frete.cobrado ? 1 : 0}"]`); if (fq) fq.checked = true; }
    if (g.parcelas?.length > 1) { abrirDiv(true); montar(g.parcelas.map(x => ({ f: x.forma, v: x.valor, d: x.vencimento }))); } };
  return { total, ler, preencher, resto };
}

/* =================== reposição (contagem) =================== */
function stepper(cls, v, peq, attrs = '') { return `<div class="stp ${peq ? 'sm' : ''}"><button type="button" data-d="-1" aria-label="menos">−</button><input type="number" min="0" inputmode="numeric" class="${cls}" value="${v}" ${attrs}><button type="button" data-d="1" aria-label="mais">+</button></div>`; }
function ligarSteppers(raiz) {
  if (!raiz || raiz._stp) return; raiz._stp = true;
  raiz.addEventListener('click', e => { const b = e.target.closest('.stp button'); if (!b) return; const i = b.parentElement.querySelector('input');
    i.value = Math.max(0, (+i.value || 0) + +b.dataset.d); i.dispatchEvent(new Event('input', { bubbles: true })); });
  raiz.addEventListener('focusin', e => { if (e.target.matches('.stp input')) e.target.select(); });
}
// pedido para entrega: data, período e por onde veio; vira encomenda e entra na rota daquele dia como prioridade
const PERIODOS_ENT = { manha: 'Manhã', tarde: 'Tarde', dia_todo: 'Dia todo' }, ORIGENS = { whatsapp: 'WhatsApp', ligacao: 'Ligação', presencial: 'Presencial' };
const proxUtil = () => { let d = new Date(Date.now() + DIA); while (d.getDay() === 0) d = new Date(+d + DIA); return isoDe(d); };
function blocoEntrega(px, e = null) {
  return `<label class="chkcomp"><input type="checkbox" id="${px}Ent" ${e ? 'checked' : ''}> 📦 Pedido para entrega <small style="color:var(--mute)">(guarda o pedido; entra na rota do dia escolhido como prioridade)</small></label>
  <div class="divpag" id="${px}EntBox" ${e ? '' : 'hidden'}><div class="row" style="flex-wrap:wrap;gap:12px;align-items:flex-end">
   <div><label class="lb">Data da entrega</label><input type="date" id="${px}EntD" value="${e?.data || proxUtil()}" min="${hoje()}"></div>
   <div><label class="lb">Período</label><select id="${px}EntP">${Object.entries(PERIODOS_ENT).map(([k, n]) => `<option value="${k}" ${(e?.periodo || 'dia_todo') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
   <div><label class="lb">Pedido feito por</label><div class="nbol">${Object.entries(ORIGENS).map(([k, n]) => `<button type="button" data-ori="${k}" class="${(e?.origem || 'whatsapp') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div></div>
   <label class="lb">Observação da entrega</label><input id="${px}EntO" value="${esc(e?.obs || '')}" placeholder="Ex.: entregar com o gerente; levar maquininha" style="width:100%"></div>`;
}
function ligarEntrega(px, aoMudar = () => { }) {
  const chk = document.getElementById(px + 'Ent'), box = document.getElementById(px + 'EntBox');
  chk.onchange = () => { box.hidden = !chk.checked; aoMudar(chk.checked); };
  box.querySelectorAll('[data-ori]').forEach(b => b.onclick = () => box.querySelectorAll('[data-ori]').forEach(x => x.classList.toggle('on', x === b)));
  return { on: () => chk.checked, ler: () => ({ data: document.getElementById(px + 'EntD').value, periodo: document.getElementById(px + 'EntP').value, origem: box.querySelector('[data-ori].on')?.dataset.ori || 'whatsapp', obs: document.getElementById(px + 'EntO').value.trim() }) };
}
const entregaTxt = e => [e.origem ? ORIGENS[e.origem] : null, e.periodo && e.periodo !== 'dia_todo' ? PERIODOS_ENT[e.periodo].toLowerCase() : null].filter(Boolean).join(' · ');
// encomenda vale para o dia da rota quando não tem data ou a data já chegou
const encDoDia = (e, d) => !!e && (!e.data || e.data <= d);
async function salvarEncomenda(pdvId, obj) { const todas = { ...(S.base.regras.encomendas || {}), [pdvId]: { ...obj, em: new Date().toISOString(), por: S.eu.nome || '' } }; await db.salvarRegra('encomendas', todas); S.base.regras.encomendas = todas; }
async function apagarEncomenda(pdvId) { const todas = { ...(S.base.regras.encomendas || {}) }; if (!todas[pdvId]) return; delete todas[pdvId]; await db.salvarRegra('encomendas', todas).catch(() => { }); S.base.regras.encomendas = todas; }
// Pix: mostra a chave para passar ao cliente sempre que Pix estiver escolhido na tela
const chavePix = () => S.base?.regras?.pix_chave || '51999540937';
const caixaPix = () => `<div class="pixinfo" hidden>💠 Chave Pix: <b>${esc(chavePix())}</b> <button type="button" class="mini" data-copiapix>copiar</button><small style="color:var(--mute)"> · passe ao cliente</small></div>`;
function atualizaPix() { document.querySelectorAll('.pixinfo').forEach(el => { const sec = el.closest('section') || document; el.hidden = ![...sec.querySelectorAll('input[type=radio]:checked')].some(r => r.value === 'Pix') && ![...sec.querySelectorAll('select.pf')].some(x => x.value === 'Pix'); }); }
document.addEventListener('change', atualizaPix);
document.addEventListener('click', e => { const b = e.target.closest('[data-copiapix]'); if (!b) return; (navigator.clipboard?.writeText(chavePix()) || Promise.reject()).then(() => toast('Chave Pix copiada'), () => toast('Chave Pix: ' + chavePix())); });
// expositor de cada cliente: histórico (entregue na 1ª venda e trocas), para o custo de aquisição no financeiro
async function registrarExpositor(pdvId, expId, tipo) { const h = { ...(S.base.regras.expositores_hist || {}) }; h[pdvId] = [...(h[pdvId] || []), { expositor_id: expId, tipo, em: new Date().toISOString(), por: S.eu.nome || '' }];
  try { await db.salvarRegra('expositores_hist', h); S.base.regras.expositores_hist = h; } catch (e) { } }
function voltarDaRep() { const v = S.repVolta; S.repVolta = null; S.contando = null; if (v?.aba === 'pedidos') irPara('pedidos'); else if (v?.aba === 'abertura') irPara('abertura'); else if (v?.aba === 'perfil') abrirPerfil(v.id); else if (v?.aba === 'mapa') { S.sel = v.id; irPara('mapa'); } else irPara('rota'); }
async function telaReposicao() {
  const p = S.pdvs.find(x => x.id === S.contando);
  if (!p) { $('#main').innerHTML = '<section class="view on"><div class="empty">Escolha um cliente no <b>Dia de rota</b> para começar.</div></section>'; return; }
  $('#main').innerHTML = '<section class="view on"><div class="loading">Carregando a última contagem…</div></section>';
  let ant, dx, precos = {}; try { [dx, precos] = await Promise.all([db.ultimoDeixado(p.id), db.precosCliente(p.id).catch(() => ({}))]); ant = dx.por; } catch (e) { return erro(e); }
  // reabrindo uma reposição: volta com os números que foram lançados
  const re = S.reabrir && S.reabrir.pdvId === p.id ? S.reabrir : null, reC = re ? Object.fromEntries(re.contagens.map(c => [c.produto_id, c])) : {}, reB = re?.bonif || {};
  // encomenda feita antes (ex.: pelo WhatsApp): volta com o pedido e o pagamento guardados
  const enc = !re && (S.base.regras.encomendas || {})[p.id], encL = enc?.linhas || {};
  if (re) ant = Object.fromEntries(re.contagens.map(c => [c.produto_id, c.deixado_anterior]));
  const ex = expo(p.expositor_id), cons = p.condicao === 'Consignado';
  const preco = pr => Number(precos[pr.id] ?? pr.preco);
  const formaIni = re?.condicao && FORMAS.includes(re.condicao) ? re.condicao : FORMAS.includes(p.condicao) ? p.condicao : 'Boleto';
  let h = `<section class="view on"><div class="count"><div class="toolbar"><h2 style="font-family:var(--fh);margin:0">${esc(p.nome)}</h2><span class="badge">Expositor ${esc(ex.nome)} · ${ex.capacidade} un.</span>${re ? '<span class="badge" style="background:var(--bg-warn)">Reabrindo a reposição</span>' : ''}${enc ? `<span class="badge" style="background:var(--bg-ok)">📦 Encomenda de ${dstr(enc.em)}${enc.por ? ' · ' + esc(enc.por) : ''}</span>` : ''}</div>
  <div class="atalhos"><b>Atalhos do pedido</b>${KITS.map((k, i) => `<button class="mini" type="button" data-kit="${i}">+ ${k.n} <b class="kq" data-kq="${i}"></b></button>`).join('')}<span class="atsep"></span><button class="mini" type="button" id="kZerar">Zerar repor</button><button class="mini" type="button" id="kZerEnc">Zerar encontrados</button><button class="mini" type="button" id="kZerTudo">Zerar tudo</button></div>
  ${enc ? `<div class="esteira" style="margin-bottom:10px"><b>📦 Pedido para entrega${enc.data ? ' em ' + dstr(enc.data + 'T12:00') : ''}${entregaTxt(enc) ? ' · ' + esc(entregaTxt(enc)) : ''}${enc.obs ? ': ' + esc(enc.obs) : ''}.</b><p style="margin:4px 0 0">O pedido e o pagamento já estão preenchidos. Conte o expositor e toque em <b>Fechar reposição</b> para lançar e mandar ao Bling. <a href="#" id="encDesc">descartar a encomenda</a></p></div>` : ''}
  <p style="color:var(--soft);margin-top:0">Conte o que tem de cada sabor no expositor, inclusive o que vai ser trocado. O sistema sugere quanto repor e calcula o sell-out.<br><small>Deixado: ${re ? 'o mesmo da reposição reaberta' : dx.fonte === 'contagem' ? `contagem de ${dstr(dx.em)}` : dx.fonte === 'pedido' ? `o que foi entregue no último pedido (${dstr(dx.em)}), pelo histórico` : 'sem histórico deste cliente'}${Object.keys(precos).length ? ' · preços combinados com o cliente aplicados' : ''}</small></p>
  <div id="ct" class="contagem">`;
  let l = '';
  S.base.produtos.forEach(pr => { if (pr.linha !== l) { l = pr.linha; h += `<div class="lingrp">${esc(l)}</div>`; }
    const a = ant[pr.id] ?? 0, rc = reC[pr.id];
    h += `<div class="lin" data-p="${pr.id}" data-ant="${a}" data-alvo="${alvo(ex.id, pr.id)}" data-pre="${preco(pr)}">
     <div class="sab"><b>${esc(pr.sabor)}</b><small>deixado: ${a}${precos[pr.id] != null ? ` · ${brl(preco(pr))}` : ''}</small></div>
     <div class="cel"><small>Encontrado</small>${stepper('enc', rc ? rc.encontrado : a)}</div>
     <div class="cel"><small>Troca</small>${stepper('trc', rc ? rc.troca : 0, true)}</div>
     <div class="cel"><small>Repor</small>${stepper('rep', rc ? Math.max(0, rc.reposto - rc.troca - (reB[pr.id] || 0)) : encL[pr.id] ? encL[pr.id].rep || 0 : 0, false, rc || enc ? 'data-mexeu="1"' : '')}</div>
     <div class="cel"><small>Bonificação</small>${stepper('bon', rc ? reB[pr.id] || 0 : encL[pr.id]?.bon || 0, true)}</div>
     <div class="res"><small>sell-out</small><b class="so">0</b><small class="val">—</small></div></div>`; });
  h += `</div><div class="panel totpanel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;margin-top:12px"><div><b id="tUn">0 un.</b> a repor · sell-out <b id="tSo">0 un.</b> · trocas <b id="tTr">0</b> <small style="color:var(--mute)">(repostas sem cobrar)</small> · bonificação <b id="tBon">0</b> <small style="color:var(--mute)">(não cobra; sai do carro)</small></div><div style="font-family:var(--fh);font-size:24px" id="tVal">R$ 0,00</div></div>
  ${cons ? `<div class="esteira" style="margin-top:12px"><b>Cliente em consignado.</b><p>Cobra só o que foi vendido desde a última visita: <b id="tCons">R$ 0,00</b>.</p></div>` : ''}
  <h3 style="margin:14px 0 6px">Pagamento</h3>${blocoPag('rp', formaIni, re?.vencimento)}${caixaPix()}
  ${re ? '' : blocoEntrega('rp')}
  <label style="display:flex;gap:8px;align-items:center;margin-top:10px" id="rBlingL"><input type="checkbox" id="rBling" checked> Criar o pedido de venda no Bling</label>
  <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="btn" id="bVoltar">Voltar</button><button class="btn pri" id="fechar">Fechar reposição</button></div></div></div></section>`;
  $('#main').innerHTML = h;
  const linhas = () => [...document.querySelectorAll('#ct .lin[data-p]')];
  const kitsUsados = {};
  let pag = null, valItens = 0;
  const calc = () => { let un = 0, so = 0, tr = 0, val = 0, vc = 0, bo = 0;
    linhas().forEach(r => { const a = +r.dataset.ant, enc = r.querySelector('.enc').value, t = +r.querySelector('.trc').value || 0, pre = +r.dataset.pre;
      // repor = o que é vendido (cobrado); as trocas são repostas 1 a 1 sem cobrar e não entram aqui
      // Repor começa zerado (só a encomenda vem preenchida); a sugestão para completar o expositor aparece ao lado
      const sug = enc === '' ? 0 : Math.max(0, +r.dataset.alvo - +enc);
      const rep = +r.querySelector('.rep').value || 0, s = enc === '' ? null : Math.max(0, a - +enc);
      r.querySelector('.so').textContent = s === null ? '—' : s; r.querySelector('.val').innerHTML = rep ? 'repor ' + brl(rep * pre) : sug ? `<a href="#" data-sug="${sug}">sugestão ${sug}</a>` : '—';
      r.classList.toggle('vendeu', (s || 0) > 0);
      un += rep; so += s || 0; tr += t; val += rep * pre; vc += (s || 0) * pre; bo += +r.querySelector('.bon').value || 0; });
    if (cons) { val = vc; $('#tCons').textContent = brl(vc); }
    valItens = val; $('#tUn').textContent = un + ' un.'; $('#tSo').textContent = so + ' un.'; $('#tTr').textContent = tr; $('#tBon').textContent = bo + ' un.';
    const fr = pag ? pag.ler().frete : { v: 0 }; $('#tVal').textContent = brl(val + (fr.cobrado ? fr.v : 0)); pag?.resto(); return { un, so, tr, val, bo }; };
  $('#ct').addEventListener('input', e => { if (e.target.classList.contains('rep')) e.target.dataset.mexeu = 1; calc(); });
  $('#ct').addEventListener('click', e => { const a = e.target.closest('[data-sug]'); if (!a) return; e.preventDefault(); const i = a.closest('.lin').querySelector('.rep'); i.value = a.dataset.sug; i.dataset.mexeu = 1; calc(); });
  ligarSteppers($('#ct')); calc();
  document.querySelectorAll('[data-kit]').forEach(b => b.onclick = () => { const i = +b.dataset.kit, k = KITS[i];
    // primeiro toque num kit troca a sugestão daquela linha pelo kit; os próximos somam
    Object.entries(k.q).forEach(([cod, q]) => { const pr = S.base.produtos.find(x => x.bling_codigo === cod), r = pr && linhas().find(x => +x.dataset.p === pr.id); if (!r) return;
      const inp = r.querySelector('.rep'); inp.value = (kitsUsados[i] ? +inp.value || 0 : 0) + q; inp.dataset.mexeu = 1; });
    kitsUsados[i] = (kitsUsados[i] || 0) + 1; document.querySelector(`[data-kq="${i}"]`).textContent = '×' + kitsUsados[i]; calc(); });
  const zerar = cls => { linhas().forEach(r => cls.forEach(c => { const i = r.querySelector('.' + c); if (i) { i.value = 0; i.dataset.mexeu = 1; } })); if (cls.includes('rep')) Object.keys(kitsUsados).forEach(k => { delete kitsUsados[k]; document.querySelector(`[data-kq="${k}"]`).textContent = ''; }); calc(); };
  $('#kZerar').onclick = () => zerar(['rep']); $('#kZerEnc').onclick = () => zerar(['enc']); $('#kZerTudo').onclick = () => zerar(['rep', 'enc', 'trc', 'bon']);
  pag = ligarPag('rp', () => valItens, () => calc()); pag.preencher(enc?.pag); calc();
  // pedido para entrega: em vez de fechar, guarda como encomenda para o dia escolhido
  const ent = re ? null : ligarEntrega('rp', on => { $('#fechar').textContent = on ? '📦 Salvar para entrega' : 'Fechar reposição'; $('#rBlingL').style.display = on ? 'none' : ''; });
  atualizaPix();
  if ($('#encDesc')) $('#encDesc').onclick = async e => { e.preventDefault(); const todas = { ...(S.base.regras.encomendas || {}) }; delete todas[p.id];
    try { await db.salvarRegra('encomendas', todas); S.base.regras.encomendas = todas; toast('Encomenda descartada'); telaReposicao(); } catch (er) { erro(er); } };
  $('#bVoltar').onclick = () => { S.reabrir = null; voltarDaRep(); };
  $('#fechar').onclick = async () => {
    const t = calc(), g = pag.ler(), pg = g.condicao, venc = g.vencimento, mandar = $('#rBling').checked;
    if (!g.ok) return toast('Cada parcela precisa ter valor, e a soma não pode passar do total');
    if (ent?.on()) { const e = ent.ler(), ln = {}; linhas().forEach(r => { const rp = +r.querySelector('.rep').value || 0, bn = +r.querySelector('.bon').value || 0; if (rp || bn) ln[r.dataset.p] = { rep: rp, bon: bn }; });
      if (!Object.keys(ln).length) return toast('Coloque os itens do pedido em Repor'); if (!e.data) return toast('Escolha a data da entrega');
      try { await salvarEncomenda(p.id, { tipo: 'reposicao', linhas: ln, pag: { forma: g.forma, vencimento: g.vencimento, parcelas: g.parcelas, frete: g.frete }, ...e });
        toast(`📦 Entrega salva para ${dstr(e.data + 'T12:00')}: entra na rota desse dia`); S.contando = null; voltarDaRep(); } catch (er) { erro(er); } return; }
    // reposto (físico) = vendido + trocas repostas; o pedido cobra só o vendido
    // bonificação: vai para o expositor (entra no reposto e sai do carro), mas não é cobrada
    const bonDe = r => +r.querySelector('.bon').value || 0;
    const contagens = linhas().map(r => ({ produto_id: +r.dataset.p, deixado_anterior: +r.dataset.ant, encontrado: +r.querySelector('.enc').value, troca: +r.querySelector('.trc').value || 0, reposto: (+r.querySelector('.rep').value || 0) + (+r.querySelector('.trc').value || 0) + bonDe(r) }));
    const itens = cons ? linhas().map(r => ({ produto_id: +r.dataset.p, quantidade: Math.max(0, +r.dataset.ant - +r.querySelector('.enc').value), preco_unit: +r.dataset.pre, bonificado: bonDe(r) }))
                       : linhas().map(r => ({ produto_id: +r.dataset.p, quantidade: +r.querySelector('.rep').value || 0, preco_unit: +r.dataset.pre, bonificado: bonDe(r) }));
    $('#fechar').disabled = true;
    try {
      const reg = await db.registrarReposicao({ pdvId: p.id, usuarioId: S.eu.id, contagens, itens,
        pedido: { tipo: cons ? 'reposicao_consignado' : 'reposicao', condicao: pg, unidades: cons ? t.so : t.un, valor: g.total, pago_na_hora: pg === 'Dinheiro', vencimento: venc, ...g.extra } });
      if (enc) await apagarEncomenda(p.id);
      let n = await db.carregarPdv(p.id), extra = '';
      const r = regraAval();
      if (n.etapa === 'avaliacao' && (n.aval_reposicoes || 0) >= r.reposicoes) {
        const novo = Number(n.aval_media) >= r.meta_minima_sellout ? 'ativo' : 'revisao';
        await db.atualizarPdv(p.id, { etapa: novo }); extra = novo === 'ativo' ? ' Avaliação concluída: virou cliente ativo.' : ' Avaliação abaixo da meta: foi para revisão comercial.';
      } else if (n.etapa === 'avaliacao') extra = ` Avaliação: ${n.aval_reposicoes} de ${r.reposicoes}.`;
      if (p.condicao !== g.forma && !cons && !g.parcelas.length) await db.atualizarPdv(p.id, { condicao: g.forma }).catch(() => { });
      S.reabrir = null; await recarregar(); await avaliarRisco(); toast('Reposição registrada.' + extra); voltarDaRep();
      if (mandar && reg.pedido && (cons ? t.so : t.un) > 0) enviarAoBling(reg.pedido.id, p.nome);
    } catch (e) { erro(e); $('#fechar').disabled = false; }
  };
}

/* =================== resumo do dia =================== */
async function telaResumo() {
  $('#main').innerHTML = '<section class="view on"><div class="loading">Carregando…</div></section>';
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  let peds, trocas; try { [peds, trocas] = await Promise.all([db.carregarPedidosDesde(ini.toISOString()), db.carregarTrocas(28)]); } catch (e) { return erro(e); }
  const rep = peds.filter(o => o.tipo !== 'abertura');
  const tot = rep.reduce((a, o) => a + Number(o.valor), 0), rec = rep.filter(o => o.pago_na_hora).reduce((a, o) => a + Number(o.valor), 0);
  const trHoje = trocas.filter(t => new Date(t.visitas.em) >= ini).reduce((a, t) => a + t.troca, 0);
  const unHoje = rep.reduce((a, o) => a + o.unidades, 0);
  const porProd = {}; trocas.forEach(t => porProd[t.produto_id] = (porProd[t.produto_id] || 0) + t.troca);
  const totTr = Object.values(porProd).reduce((a, b) => a + b, 0);
  const so4 = Object.values(S.sellouts).flat().filter(s => new Date(s.em) >= Date.now() - 28 * DIA).reduce((a, s) => a + s.sellout, 0);
  const taxa = so4 + totTr ? totTr / (so4 + totTr) * 100 : 0, meta = Number(S.base.regras.meta_troca_pct || 3);
  const ps = S.base.produtos.map(p => ({ n: p.sabor, l: p.linha, v: porProd[p.id] || 0 })).sort((a, b) => b.v - a.v), mx = Math.max(1, ps[0]?.v || 0);
  const porPdv = {}; trocas.forEach(t => porPdv[t.visitas.pdv_id] = (porPdv[t.visitas.pdv_id] || 0) + t.troca);
  const top = Object.entries(porPdv).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, v]) => ({ n: (S.pdvs.find(p => p.id === id) || {}).nome || '—', v }));
  $('#main').innerHTML = `<section class="view on"><div class="tablewrap"><div class="tiles" style="margin-bottom:14px">
  <div class="tile hi"><small>Reposições hoje</small><b>${rep.length}</b></div><div class="tile"><small>Total vendido</small><b>${brl(tot)}</b></div>
  <div class="tile"><small>Recebido na hora</small><b>${brl(rec)}</b></div><div class="tile"><small>A receber</small><b>${brl(tot - rec)}</b></div>
  <div class="tile"><small>Trocas hoje</small><b>${trHoje} un.</b><small>${unHoje ? dec(trHoje / unHoje * 100) + '% do reposto' : '—'}</small></div>
  <div class="tile" style="background:${taxa > meta ? 'var(--bg-bad)' : '#DCEBDF'}"><small>Taxa de troca · 4 semanas</small><b>${dec(taxa)}%</b><small>${taxa > meta ? 'acima' : 'dentro'} da meta de ${meta}%</small></div></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px">
  <div class="panel"><h3>Trocas por sabor · 4 semanas</h3><div class="bars">${ps.map(x => `<div class="bar"><span>${esc(x.n)} <small style="color:var(--mute)">· ${esc(x.l.split(' ')[0])}</small></span><div class="tr"><div class="fl" style="width:${x.v / mx * 100}%;background:${x.l.startsWith('Cookie') ? '#B8402A' : x.l.startsWith('Palha') ? '#D08A3C' : '#18181B'}"></div></div><b>${x.v}</b></div>`).join('')}</div></div>
  <div class="panel"><h3>PDVs com mais troca · 4 semanas</h3><div class="bars">${top.map(x => `<div class="bar" style="grid-template-columns:1fr 50px"><span>${esc(x.n)}</span><b>${x.v} un.</b></div>`).join('') || '<span style="color:var(--mute)">Sem trocas</span>'}</div></div></div>
  <table><tr><th>Pedido</th><th>Tipo</th><th>PDV</th><th>Unidades</th><th>Valor</th><th>Pagamento</th><th>Situação</th><th>Bling</th><th></th></tr>${peds.map(o => `<tr><td>#${o.numero}</td><td>${o.tipo === 'abertura' ? 'Abertura' : o.tipo === 'reposicao_consignado' ? 'Reposição (consignado)' : 'Reposição'}</td><td>${esc(o.pdvs?.nome)}</td><td>${o.unidades}</td><td>${brl(o.valor)}</td><td>${esc(o.condicao)}</td><td>${o.pago_na_hora ? 'Pago' : 'A receber' + (o.vencimento ? ' · ' + dstr(o.vencimento + 'T12:00') : '')}</td><td>${esc(o.bling_status)}${o.bling_pedido_id ? ' · nº ' + esc(o.bling_pedido_id) : ''}</td><td><button class="mini" data-exped="${o.id}" style="color:var(--t-bad)">excluir</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nenhum pedido hoje.</td></tr>'}</table></div></section>`;
  document.querySelectorAll('[data-exped]').forEach(b => b.onclick = () => { const o = peds.find(x => x.id === b.dataset.exped);
    modal(`<h3>Excluir o pedido #${o.numero}?</h3><p style="color:var(--soft)">${esc(o.pdvs?.nome || '')} · ${brl(o.valor)}. Apaga de vez o pedido, os itens${o.visita_id ? ', a visita e a contagem (sell-out e trocas) dessa reposição' : ''}. Não dá para desfazer.</p>${o.bling_id ? `<p style="color:var(--car-d);font-size:13px">Esse pedido também está no Bling (nº ${esc(o.bling_pedido_id || o.bling_id)}). Exclua ou cancele lá também, senão ele pode voltar na próxima sincronização.</p>` : ''}<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="xpOk" style="background:#7A2414;border-color:var(--t-bad)">Excluir de vez</button></div>`);
    $('#xpOk').onclick = async () => { try { await db.excluirPedido(o.id, o.visita_id); fecharModal(); PV.dados = null; toast(`Pedido #${o.numero} excluído`); telaResumo(); } catch (e) { fecharModal(); erro(e); } }; });
}

/* =================== campos reutilizáveis =================== */
const perList = p => String(p.janela_periodo || '').split(',').filter(k => PERIODOS[k]); // um ou mais períodos (ex.: 'manha,noite')
const DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], PERIODOS = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', dia_todo: 'Dia todo' };
function campoJanela(id, p) { const ds = p.janela_dias || [];
  return `<div class="janela" id="${id}"><div class="jdias">${DIAS_SEM.map((d, i) => `<label class="${ds.includes(i) ? 'on' : ''}"><input type="checkbox" value="${i}" ${ds.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
   <div class="jper">${Object.entries(PERIODOS).map(([k, n]) => { const on = perList(p).includes(k); return `<label class="${on ? 'on' : ''}"><input type="checkbox" value="${k}" ${on ? 'checked' : ''}>${n}</label>`; }).join('')}</div>
   <label class="jdono"><input type="checkbox" ${p.precisa_dono === false ? '' : 'checked'}> Precisa do dono presente</label></div>`; }
function ligarJanela(id) { const el = document.getElementById(id); if (!el) return; el.querySelectorAll('.jdias input, .jper input').forEach(i => i.onchange = () => {
    // "Dia todo" exclui os outros períodos (e vice-versa); manhã, tarde e noite combinam entre si
    if (i.closest('.jper') && i.checked) el.querySelectorAll('.jper input').forEach(o => { if (o !== i && (i.value === 'dia_todo' || o.value === 'dia_todo')) o.checked = false; });
    el.querySelectorAll('.jdias label, .jper label').forEach(l => l.classList.toggle('on', l.querySelector('input').checked)); }); }
function lerJanela(id) { const el = document.getElementById(id); if (!el) return {}; const dias = [...el.querySelectorAll('.jdias input:checked')].map(i => +i.value), per = [...el.querySelectorAll('.jper input:checked')].map(i => i.value).join(',') || null;
  return { janela_dias: dias.length ? dias : null, janela_periodo: per, precisa_dono: el.querySelector('.jdono input').checked }; }
const janelaTxt = p => { const ds = (p.janela_dias || []).slice().sort(), dt = ds.length === 6 && !ds.includes(0) ? 'Seg a Sáb' : ds.length === 7 ? 'Todos os dias' : ds.map(i => DIAS_SEM[i]).join(', '); return [dt, perList(p).map(k => PERIODOS[k]).join(' e '), p.precisa_dono === false ? 'qualquer responsável' : (ds.length || p.janela_periodo) ? 'com o dono' : ''].filter(Boolean).join(' · '); };
const CARGOS = ['Dono', 'Gerente', 'Funcionário'];
function campoCanal(id, valor) {
  const custom = valor && !CANAIS.includes(valor);
  return `<select id="${id}">${CANAIS.map(c => `<option ${(c === valor || (custom && c === 'Outro')) ? 'selected' : ''}>${c}</option>`).join('')}</select>
  <input id="${id}Outro" placeholder="Descreva o canal (ex.: Bar, Academia, Hotel)" value="${custom ? esc(valor) : ''}" style="margin-top:6px;width:100%;display:${custom || valor === 'Outro' ? 'block' : 'none'}">`;
}
function ligarCanal(id) { const s = $('#' + id); if (s) s.onchange = () => { $('#' + id + 'Outro').style.display = s.value === 'Outro' ? 'block' : 'none'; if (s.value === 'Outro') $('#' + id + 'Outro').focus(); }; }
const lerCanal = id => $('#' + id).value === 'Outro' ? ($('#' + id + 'Outro').value.trim() || 'Outro') : $('#' + id).value;
const campoPot = (id, v = 3) => `<select id="${id}">${[1, 2, 3, 4, 5].map(x => `<option ${x === (v || 3) ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
function campoEmpresa(pre, p = {}) {
  return `<div class="row"><div style="flex:1"><label>CNPJ</label><div class="row" style="gap:6px"><input id="${pre}Cnpj" inputmode="numeric" value="${esc(p.cnpj || '')}" style="flex:1"><button class="btn" type="button" id="${pre}BuscaCnpj" title="Preencher pelo CNPJ">Buscar</button></div></div><div style="flex:1"><label>Razão social</label><input id="${pre}Razao" value="${esc(p.razao_social || '')}"></div></div>`;
}
function ligarEmpresa(pre, nomeId) {
  const b = $('#' + pre + 'BuscaCnpj'); if (!b) return;
  b.onclick = async () => { const c = soDig($('#' + pre + 'Cnpj').value); if (c.length !== 14) return toast('CNPJ precisa ter 14 números');
    b.disabled = true; b.textContent = '…';
    try { const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + c); if (!r.ok) throw new Error('CNPJ não encontrado'); const j = await r.json();
      $('#' + pre + 'Razao').value = j.razao_social || ''; if (nomeId && !$('#' + nomeId).value) $('#' + nomeId).value = j.nome_fantasia || j.razao_social || '';
      document.dispatchEvent(new CustomEvent('cnpj-encontrado', { detail: j }));
      toast('Dados do CNPJ preenchidos' + (j.descricao_situacao_cadastral && j.descricao_situacao_cadastral !== 'ATIVA' ? ' · situação: ' + j.descricao_situacao_cadastral : '')); }
    catch (e) { toast(e.message); } b.disabled = false; b.textContent = 'Buscar'; };
}
const lerEmpresa = pre => ({ cnpj: soDig($('#' + pre + 'Cnpj').value) || null, razao_social: $('#' + pre + 'Razao').value.trim() || null });

/* ---------- depois de uma visita de prospecção: cadastrar o contato e completar os dados do negócio ---------- */
function completarCadastro(p, depois, semContato) {
  const fim = () => { try { depois && depois(); } catch (e) { erro(e); } };
  const c = S.contatos.find(x => x.id === p.contato_id);
  modal(`<h3>Completar cadastro · ${esc(p.nome)}</h3><p style="color:var(--soft);margin-top:0">Aproveite a visita para registrar quem atende e os dados do negócio. Dá para pular.</p>
   ${semContato ? '' : `<div class="sect" style="margin-top:6px"><h3>Contato</h3>
   ${c ? `<p style="margin:2px 0 6px">Principal hoje: <b>${esc(c.nome)}</b>${c.cargo ? ' (' + esc(c.cargo) + ')' : ''}${c.telefone ? ' · ' + esc(c.telefone) : ''}<br><small style="color:var(--mute)">Preencha abaixo só se quiser adicionar outra pessoa.</small></p>` : ''}
   <div class="row"><div style="flex:1"><label>Nome</label><input id="ccNome" placeholder="Com quem falou"></div><div style="flex:1"><label>Cargo</label><select id="ccCargo">${CARGOS.map(x => `<option>${x}</option>`).join('')}</select></div></div>
   <div class="row"><div style="flex:1"><label>Telefone / WhatsApp</label><input id="ccTel" inputmode="tel"></div><div style="flex:1"><label>E-mail</label><input id="ccEmail" inputmode="email"></div></div>
   <label class="chkbox" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="ccComp" style="width:auto" ${c ? '' : 'checked'}> É quem decide a compra (vira o contato principal)</label></div>`}
   <div class="sect"><h3>Detalhes do negócio</h3>
   <label>Canal</label>${campoCanal('ccCanal', p.canal || 'Minimercado')}
   <div class="row"><div style="flex:2"><label>Endereço</label><input id="ccEnd" value="${esc(p.endereco || '')}"></div><div style="flex:1"><label>Bairro</label><input id="ccBairro" value="${esc(p.bairro || '')}"></div></div>
   <div class="row"><div style="flex:1"><label>Classe</label><select id="ccClasse"><option value="">—</option>${['A', 'B', 'C', 'D'].map(k => `<option ${p.classe === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div><div style="flex:1"><label>Fornecedor atual</label><input id="ccForn" value="${esc(p.fornecedor_atual || '')}"></div></div>
   <label>Horário de atendimento</label>${campoJanela('ccJ', p)}
   <label>Observação</label><textarea id="ccObs" rows="2">${esc(p.observacao || '')}</textarea></div>
   <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="ccPula">Pular</button><button class="btn pri" id="ccOk">Salvar</button></div>`);
  ligarCanal('ccCanal'); ligarJanela('ccJ');
  $('#ccPula').onclick = () => { fecharModal(); fim(); };
  $('#ccOk').onclick = async () => { $('#ccOk').disabled = true;
    try {
      const patch = { canal: lerCanal('ccCanal'), endereco: $('#ccEnd').value.trim() || null, bairro: $('#ccBairro').value.trim() || null, classe: $('#ccClasse').value || null, fornecedor_atual: $('#ccForn').value.trim() || null, observacao: $('#ccObs').value.trim() || null, ...lerJanela('ccJ') };
      if (!semContato) { const nome = $('#ccNome').value.trim(), tel = $('#ccTel').value.trim(), email = $('#ccEmail').value.trim(), comp = $('#ccComp').checked;
        if (nome || tel) { const id = await obterContato({ nome, telefone: tel, whatsapp: tel, email, cargo: $('#ccCargo').value, empresa: p.nome, comprador: comp });
          if (id && id !== p.contato_id) { if (!p.contato_id || comp) { patch.contato_id = id; if (p.contato_id) await db.vincularContato(p.id, p.contato_id).catch(() => {}); } else await db.vincularContato(p.id, id).catch(() => {}); } } }
      await db.atualizarPdv(p.id, patch); await atualizarUm(p.id); fecharModal(); toast('Cadastro atualizado'); fim();
    } catch (e) { $('#ccOk').disabled = false; erro(/janela_|precisa_dono/.test(e.message) ? new Error('Rode o SQL 018 no Supabase para salvar a janela de atendimento') : e); } };
}
// mapeado que não faz sentido: some do mapa e do cadastro
function excluirDoMapa(p, depois) {
  modal(`<h3>Excluir ${esc(p.nome)} do mapa?</h3><p style="color:var(--soft)">O ponto sai do mapa e do cadastro. Use para mapeados que não são ponto de venda para vocês.</p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="exmOk">Excluir</button></div>`);
  $('#exmOk').onclick = async () => { $('#exmOk').disabled = true;
    // com histórico (visita, contato, tarefa), não apaga, para não perder o registro: marca como estabelecimento fechado, que também some do mapa
    const temHist = p.ultima_prospeccao || p.ultima_visita || p.contato_id || p.acao_data;
    try { if (temHist) throw new Error('historico'); await db.excluirPdv(p.id); S.pdvs = S.pdvs.filter(x => x.id !== p.id); toast('Excluído do mapa'); }
    catch (e) {
      try { await db.atualizarPdv(p.id, { etapa: 'fechado' }); await atualizarUm(p.id); toast('Tinha histórico: marquei como estabelecimento fechado (some do mapa)'); } catch (e2) { fecharModal(); return erro(e2); } }
    fecharModal(); depois && depois(); };
}

/* ---------- visita rápida + comentário depois ---------- */
async function visitaRapida(p, depois) {
  try { const v = await db.registrarVisita(p.id, 'prospeccao', null, S.eu.id);
    if (p.etapa === 'mapeado') await db.atualizarPdv(p.id, { etapa: 'visitado' });
    S.ultimaVisita = { pdvId: p.id, id: v.id, em: new Date() }; await atualizarUm(p.id); toast('Visita registrada'); completarCadastro(S.pdvs.find(x => x.id === p.id) || p, depois); } catch (e) { erro(e); }
}
function caixaComentario(p) {
  const u = S.ultimaVisita; if (!u || u.pdvId !== p.id) return '';
  return `<div class="esteira" style="background:var(--bg-info);border-color:#C9D7EA"><b>Visita registrada às ${u.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>
  <textarea id="vCom" rows="2" placeholder="Comentário da visita (opcional): com quem falou, objeções, próximo passo…" style="width:100%;margin-top:6px">${esc(u.obs || '')}</textarea>
  <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="vComOk">${u.obs ? 'Atualizar comentário' : 'Salvar comentário'}</button></div></div>`;
}
function ligarComentario(depois) {
  const b = $('#vComOk'); if (!b) return;
  b.onclick = async () => { const u = S.ultimaVisita, t = $('#vCom').value.trim(); try { await db.atualizarVisita(u.id, { observacao: t || null }); u.obs = t; toast('Comentário salvo'); depois && depois(); } catch (e) { erro(e); } };
}

/* =================== contatos, duplicidade e perfil =================== */
const norm = s => semAcento(String(s || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const soDig = s => String(s || '').replace(/\D/g, '');
function duplicado(nome, lat, lng, ignorar) {
  const n = norm(nome);
  return S.pdvs.find(p => p.id !== ignorar && ((n && norm(p.nome) === n) || (lat && p.lat && Math.abs(p.lat - lat) < 0.0003 && Math.abs(p.lng - lng) < 0.0003)));
}
function acharContato({ nome, telefone, whatsapp, email }, ignorar) {
  const tels = [telefone, whatsapp].map(soDig).filter(t => t.length >= 8).map(t => t.slice(-8));
  const e = (email || '').toLowerCase().trim(), n = norm(nome);
  return S.contatos.find(c => c.id !== ignorar && (tels.some(t => soDig(c.telefone).endsWith(t) || soDig(c.whatsapp).endsWith(t)) || (e && (c.email || '').toLowerCase().trim() === e) || (n && norm(c.nome) === n)));
}
async function obterContato(dados) {
  if (!dados.nome && !dados.telefone) return null;
  const achado = acharContato(dados); if (achado) { toast(`Contato ${achado.nome} já existia e foi vinculado`); return achado.id; }
  const c = await db.criarContato({ ...(dados.comprador ? { comprador: true } : {}), nome: dados.nome || dados.telefone, empresa: dados.empresa || null, cargo: dados.cargo || null, telefone: dados.telefone || null, whatsapp: dados.whatsapp || null, email: dados.email || null, cnpj: dados.cnpj || null, observacao: dados.observacao || null, criado_por: S.eu.id });
  S.contatos.push(c); return c.id;
}
function campoContato() {
  return `<details style="margin-top:10px;background:var(--sand);border-radius:10px;padding:8px 10px"><summary style="cursor:pointer;font-weight:700;font-size:13px">Contato (responsável)</summary>
  <label>Contato já cadastrado</label><select id="kSel"><option value="">— novo contato —</option>${S.contatos.map(c => `<option value="${c.id}">${esc(c.nome)}${c.empresa ? ' · ' + esc(c.empresa) : ''}</option>`).join('')}</select>
  <div class="row"><div style="flex:1"><label>Nome</label><input id="kNome"></div><div style="flex:1"><label>Cargo</label><select id="kCargo"><option value="">—</option>${CARGOS.map(c => `<option>${c}</option>`).join('')}</select></div></div>
  <div class="row"><div style="flex:1"><label>Telefone / WhatsApp</label><input id="kTel" inputmode="tel"></div><div style="flex:1"><label>E-mail</label><input id="kEmail" type="email"></div></div>
  <label class="chkcomp"><input type="checkbox" id="kComp"> 🛒 É o comprador</label></details>`;
}
async function contatoDoForm(empresa) {
  if ($('#kSel') && $('#kSel').value) return $('#kSel').value;
  const nome = $('#kNome')?.value.trim(), tel = $('#kTel')?.value.trim();
  if (!nome && !tel) return null;
  return obterContato({ nome, telefone: tel, whatsapp: tel, email: $('#kEmail')?.value.trim(), cargo: $('#kCargo')?.value || null, empresa, comprador: !!$('#kComp')?.checked });
}
// leva o nome (pessoa de contato) e o cargo (informações do contato) para o cadastro do cliente no Bling
async function contatoParaBling(contatoId) {
  if (!S.pdvs.some(p => p.contato_id === contatoId && p.bling_contato_id)) return;
  try { const r = await db.bling('atualizar_contato', { contato_id: contatoId });
    if (r?.atualizados) toast(`Bling atualizado: ${r.feitos.join(', ')}`); if (r?.erros?.length) toast('Bling não aceitou: ' + r.erros[0]);
  } catch (e) { toast(/atualizar_contato|Ação|acao/i.test(e.message) ? 'Para levar ao Bling, atualize a função bling-oauth' : 'Bling: ' + e.message); } }
// comprador vira o contato principal dos negócios em que aparece como secundário
async function virarPrincipal(contatoId) {
  let ids = []; try { ids = await db.vinculosDoContato(contatoId); } catch (e) { return; }
  for (const pid of ids) { const p = S.pdvs.find(x => x.id === pid); if (!p || p.contato_id === contatoId) continue;
    await db.atualizarPdv(pid, { contato_id: contatoId }); await db.desvincularContato(pid, contatoId); if (p.contato_id) await db.vincularContato(pid, p.contato_id); await atualizarUm(pid); }
  if (ids.length) contatoParaBling(contatoId);
  if (ids.length) toast('Comprador agora é o contato principal');
}
function abrirPerfil(id) { if (!['perfil', 'contato'].includes(S.aba)) S.voltar = S.aba; S.perfilId = id; S.sel = id; irPara('perfil'); }
function abrirContato(id) { S.contatoId = id; irPara('contato'); }
window.abrirPerfil = abrirPerfil; window.abrirContato = abrirContato;
const linkWpp = t => { const d = soDig(t); return d.length >= 10 ? `https://wa.me/${d.length <= 11 ? '55' + d : d}` : null; };
const quando = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

async function telaPerfil() {
  const p = S.pdvs.find(x => x.id === S.perfilId);
  if (!p) { $('#main').innerHTML = '<section class="view on"><div class="empty">Negócio não encontrado.</div></section>'; return; }
  $('#main').innerHTML = '<section class="view on"><div class="loading">Carregando o histórico…</div></section>';
  let h, tars, secIds = [], semTabelaSec = false, notas = [], semNotas = false; try { [h, tars, secIds] = await Promise.all([db.historico(p.id), db.tarefasDoPdv(p.id), db.vinculosDoPdv(p.id).catch(() => { semTabelaSec = true; return []; })]); notas = await db.notasDoPdv(p.id).catch(() => { semNotas = true; return []; }); } catch (e) { return erro(e); }
  const secs = secIds.map(id => S.contatos.find(x => x.id === id)).filter(x => x && x.id !== p.contato_id);
  const c = S.contatos.find(x => x.id === p.contato_id);
  const ev = [];
  h.etapas.forEach(e => ev.push({ em: e.em, cor: etapa(e.para).c, t: e.de ? `Passou de <b>${etapa(e.de).n}</b> para <b>${etapa(e.para).n}</b>` : `Negócio criado como <b>${etapa(e.para).n}</b>`, quem: e.perfis?.nome, obs: e.motivo }));
  const soV = Object.fromEntries(h.sellouts.map(s => [s.visita_id, s]));
  const pedV = Object.fromEntries(h.pedidos.filter(o => o.visita_id).map(o => [o.visita_id, o]));
  h.visitas.forEach(v => { const o = pedV[v.id], s = soV[v.id];
    const t = v.tipo === 'prospeccao' ? 'Visita de prospecção' : v.tipo === 'abertura' ? `Abertura: pedido #${o?.numero ?? '—'} · ${o?.unidades ?? 0} un. · ${brl(o?.valor)} · ${esc(o?.condicao || '')}`
      : `Reposição: sell-out <b>${s?.sellout ?? 0} un.</b> (${brl(s?.valor_sellout)})${s?.trocas ? ` · ${s.trocas} trocas` : ''} · pedido #${o?.numero ?? '—'} ${brl(o?.valor)} · ${esc(o?.condicao || '')}`;
    ev.push({ em: v.em, cor: v.tipo === 'prospeccao' ? '#3F6FA8' : '#D08A3C', t, quem: v.perfis?.nome, obs: v.observacao }); });
  notas.forEach(n => ev.push({ em: n.em, cor: '#7B4FC0', t: `📝 <b>Observação</b>`, quem: n.perfis?.nome, obs: n.texto, nota: n.id }));
  ev.sort((a, b) => new Date(b.em) - new Date(a.em));
  const podeComprar = p.etapa !== 'perdido' && !repoe(p);
  $('#main').innerHTML = `<section class="view on"><div class="dash" style="">
  <div class="row" style="gap:8px"><button class="btn" id="pVoltar">← ${esc(rotuloVoltar('Negócios'))}</button><span style="color:var(--mute)">Perfil do negócio</span></div>
  <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:start">
   <div style="display:flex;flex-direction:column;gap:16px">
    <div class="panel"><small style="color:var(--mute)">${esc(p.canal || '')} · ${esc([p.bairro, p.cidade].filter(Boolean).join(', '))}</small>
     <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px"><h2 style="font-family:var(--fh);margin:4px 0 8px;font-size:28px">${esc(p.nome)}</h2><button class="btn car" id="pTarTopo" style="white-space:nowrap">+ Tarefa</button></div>
     <div class="badges"><span class="badge st" style="background:${etapa(p.etapa).c}">${etapa(p.etapa).n}</span>${p.classe ? `<span class="badge">Classe ${p.classe}</span>` : ''}<span class="badge">${p.regiao || '—'} · ${esc(regNome(p.regiao))}</span>${p.expositor_id ? `<span class="badge">Expositor ${esc(expo(p.expositor_id).nome)}</span>` : ''}<span class="badge">${'★'.repeat(p.potencial || 0) || 'sem potencial'}</span>${p.geo_precisao && p.geo_precisao !== 'exata' ? `<span class="badge" style="background:var(--bg-warn)">localização ${esc(p.geo_precisao)}</span>` : ''}</div>
     ${p.razao_social || p.cnpj ? `<p style="color:var(--soft);margin:6px 0">${esc(p.razao_social || '')}${p.cnpj ? ' · CNPJ ' + esc(p.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')) : ''}</p>` : ''}
     <p style="color:var(--soft);margin:6px 0">${esc(p.endereco || 'Sem endereço')}${p.condicao ? ` · Condição: <b>${esc(p.condicao)}</b>` : ''}${p.proxima_reposicao ? ` · Próxima reposição: <b>${dstr(p.proxima_reposicao)}</b> (${prazoTxt(p)})` : ''}</p>
     ${adiadoAte(p) ? `<p style="background:var(--bg-warn);padding:8px 10px;border-radius:8px;margin:8px 0 0">🗓️ Reposição postergada até <b>${dstr(adiadoAte(p) + 'T12:00')}</b>: até lá não entra sozinho na rota. <a href="#" id="pRetomar">retomar agora</a></p>` : ''}
     ${p.observacao ? `<p style="background:var(--sand);padding:8px 10px;border-radius:8px;margin:8px 0 0">${esc(p.observacao)}</p>` : ''}
     <div class="row" style="flex-wrap:wrap;margin-top:12px">
      ${botoesRota(p, 'p')}${repoe(p) ? '<button class="btn pri" id="pRepor">Repor (contar o expositor) →</button>' : ''}${podeComprar ? '<button class="btn car" id="pComprar">Registrar venda →</button>' : ''}
      <button class="btn pri" id="pVisita">Registrar visita</button>
      <select id="pEtapa">${ETAPAS.map(e => `<option value="${e.k}" ${e.k === p.etapa ? 'selected' : ''}>${e.n}</option>`).join('')}</select>
      <button class="btn" id="pEditar">Editar dados</button><button class="btn" id="pMapa">Ver no mapa</button><button class="btn" id="pAjustar">Ajustar localização</button><button class="btn" id="pExcluirTopo" style="color:var(--t-bad)">Excluir negócio</button>
     </div></div>
    ${caixaComentario(p) ? `<div class="panel" style="padding:4px 14px 14px">${caixaComentario(p)}</div>` : ''}
    <div class="panel" style="padding:12px 14px"><label style="margin:0 0 8px;display:block;font-weight:700">🕘 Melhor horário para visita</label>${campoJanela('pj', p)}<div class="row" style="gap:8px;margin-top:8px"><input id="pHor" value="${esc(p.melhor_horario || '')}" placeholder="Observação (opcional): ex. depois das 10h, falar com a Carla" style="flex:1"><button class="btn" id="pHorOk">Salvar</button></div></div>
    ${caixaEsteira(p) ? `<div class="panel" style="padding:4px 14px 14px">${caixaEsteira(p)}</div>` : ''}
    ${ultimos6(p) ? `<div class="panel">${ultimos6(p)}</div>` : ''}
    <div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Histórico</h3><button class="btn pri" id="pNota" style="padding:5px 10px">+ Observação</button></div>
     <div id="pNotaBox" hidden style="margin-top:10px"><textarea id="pNotaTxt" rows="3" style="width:100%" placeholder="Ex.: dono pediu para voltar depois do dia 10; reclamou da validade do palha…"></textarea><div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn" id="pNotaX">Cancelar</button><button class="btn pri" id="pNotaOk">Salvar no histórico</button></div></div>
     ${semNotas ? '<small style="display:block;color:var(--mute);margin-top:6px">Rode o 022_observacoes.sql para guardar observações no histórico.</small>' : ''}<div style="margin-top:6px"></div>${ev.map(e => `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--sand)"><i style="width:12px;height:12px;border-radius:50%;background:${e.cor};flex:none;margin-top:4px"></i><div style="flex:1"><div>${e.t}</div>${e.obs ? `<div style="color:var(--soft);margin-top:2px">“${esc(e.obs)}”</div>` : ''}<small style="color:var(--mute)">${quando(e.em)}${e.quem ? ' · ' + esc(e.quem) : ''}${e.nota ? ` · <a href="#" data-delnota="${e.nota}" style="color:var(--mute)">excluir</a>` : ''}</small></div></div>`).join('') || '<p class="empty">Sem histórico ainda.</p>'}</div>
   </div>
   <div style="display:flex;flex-direction:column;gap:16px">
    ${campoPrior(p) ? `<div class="panel">${campoPrior(p)}</div>` : ''}
    <div class="panel"><h3>Contatos</h3>${faltaContato(p).length ? `<div style="margin:-4px 0 10px">${avisoContato(p)}</div>` : ''}${c ? `<small class="ctpapel">Principal</small><div style="font-size:18px;font-weight:700">${esc(c.nome)} ${c.comprador ? '<span class="badge comp">🛒 Comprador</span>' : ''}</div><div style="color:var(--soft)">${esc([c.cargo, c.empresa].filter(Boolean).join(' · '))}</div>
     <p style="margin:8px 0;line-height:1.7">${c.telefone ? `📞 ${esc(c.telefone)}<br>` : ''}${c.email ? `✉️ ${esc(c.email)}<br>` : ''}</p>
     <div class="row" style="flex-wrap:wrap">${linkWpp(c.whatsapp || c.telefone) ? `<a class="btn car" style="text-decoration:none" target="_blank" rel="noopener" href="${linkWpp(c.whatsapp || c.telefone)}">WhatsApp ↗</a>` : ''}<button class="btn" id="pVerContato">Abrir contato</button><button class="btn" id="pTrocarContato">Trocar</button></div>`
      : `<p class="empty" style="padding:6px 0">Nenhum contato vinculado.</p><button class="btn pri" id="pTrocarContato">Vincular contato</button>`}
     ${secs.map(s => `<div class="ctsec"><small class="ctpapel">Secundário</small><div><b>${esc(s.nome)}</b> <span style="color:var(--soft)">${esc(s.cargo || '')}</span>${s.comprador ? ' <span class="badge comp">🛒 Comprador</span>' : ''}</div>
       <div style="font-size:13px;color:var(--soft);line-height:1.6">${s.telefone ? `📞 ${esc(s.telefone)}<br>` : ''}${s.email ? `✉️ ${esc(s.email)}` : ''}</div>
       <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:4px">${linkWpp(s.whatsapp || s.telefone) ? `<a class="mini" style="text-decoration:none" target="_blank" rel="noopener" href="${linkWpp(s.whatsapp || s.telefone)}">WhatsApp ↗</a>` : ''}<button class="mini" data-ctabre="${s.id}">abrir</button><button class="mini" data-ctprin="${s.id}">tornar principal</button><button class="mini" data-ctrem="${s.id}">remover</button></div></div>`).join('')}
     ${c ? `<button class="btn" id="pAddSec" style="margin-top:10px">+ Contato secundário</button>` : ''}${semTabelaSec ? '<small style="display:block;color:var(--mute);margin-top:6px">Rode o 020_contatos_secundarios.sql para usar contatos secundários.</small>' : ''}</div>
    <div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Próximas ações</h3><button class="btn pri" id="pNovaTar" style="padding:5px 10px">+ Nova</button></div><div style="margin-top:8px">${listaTarefas(tars.filter(t => !t.concluida), 'Nenhuma ação marcada.')}</div>${tars.some(t => t.concluida) ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--mute);font-size:12px">Concluídas (${tars.filter(t => t.concluida).length})</summary>${listaTarefas(tars.filter(t => t.concluida), '')}</details>` : ''}</div>
    <div class="panel"><h3>Resumo</h3><div class="kv" style="margin:0"><div><small>${h.pedidos.length ? 'Cliente desde' : 'Criado em'}</small><b>${dataLonga(h.pedidos.length ? h.pedidos[0].criado_em : p.criado_em)}</b>${h.pedidos.length ? '<small>1º pedido no Bling</small>' : ''}</div><div><small>Visitas</small><b>${h.visitas.length}</b></div><div><small>Pedidos</small><b>${h.pedidos.length}</b></div><div><small>Total pedido</small><b>${brl(h.pedidos.reduce((a, o) => a + Number(o.valor), 0))}</b></div></div></div>
    ${fluxoPedidos(h.pedidos)}
    <div id="pProd"></div>
    ${(() => { const pend = h.pedidos.filter(o => o.bling_status === 'pendente' || o.bling_status === 'erro'); return pend.length ? `<div class="panel alertas"><h3>Pedidos do app ainda não criados no Bling (${pend.length})</h3>${pend.map(o => `<div class="trow" style="cursor:default"><div style="flex:1"><b>${dataLonga(o.criado_em)} · ${brl(o.valor)}</b> <small style="color:var(--mute)">${esc(o.condicao)}</small>${o.bling_erro ? `<br><small style="color:var(--t-bad)">${esc(o.bling_erro.slice(0, 220))}</small>` : ''}</div><button class="mini" data-envbling="${o.id}">enviar ao Bling</button></div>`).join('')}</div>` : ''; })()}
    <div class="panel"><button class="btn" id="pExcluir" style="width:100%;color:var(--t-bad)">Excluir negócio</button><small style="color:var(--mute);display:block;margin-top:6px">Use para apagar cadastro duplicado, errado ou de teste. Apaga também os pedidos dele.</small></div>
   </div></div></div></section>`;
  $('#pVoltar').onclick = () => voltar(S.voltar || 'carteira');
  if (h.pedidos.length) db.itensDoCliente(p.id).then(it => { const el = $('#pProd'); if (el) el.outerHTML = maisSaem(it, h.pedidos); }).catch(() => { });
  $('#pNovaTar').onclick = $('#pTarTopo').onclick = () => modalTarefa({ data: hojeISO(), pdv_id: p.id, contato_id: p.contato_id });
  document.querySelectorAll('[data-tid]').forEach(el => el.onclick = () => modalTarefa(tars.find(t => t.id === el.dataset.tid)));
  if ($('#pRetomar')) $('#pRetomar').onclick = async e => { e.preventDefault(); const ad = { ...(S.base.regras.adiados || {}) }; delete ad[p.id]; try { await db.salvarRegra('adiados', ad); S.base.regras.adiados = ad; toast('Reposição retomada'); abrirPerfil(p.id); } catch (er) { erro(er); } };
  if ($('#pRota')) $('#pRota').onclick = () => porNaRotaHoje(p.id, false);
  if ($('#pReat')) $('#pReat').onclick = async () => { await porNaRotaHoje(p.id, true); telaPerfil(); };
  if ($('#pRepor')) $('#pRepor').onclick = () => { S.contando = p.id; S.repVolta = { aba: 'perfil', id: p.id }; irPara('reposicao'); };
  if ($('#pComprar')) $('#pComprar').onclick = () => { S.abPdv = p.id; S.vendaVolta = { aba: 'perfil', id: p.id }; irPara('abertura'); };
  $('#pVisita').onclick = () => visitaRapida(p, telaPerfil);
  ligarComentario(telaPerfil);
  $('#pEtapa').onchange = e => mudarEtapa(p.id, e.target.value, telaPerfil);
  $('#pMapa').onclick = () => { if (p.etapa === 'fechado') return toast('Estabelecimento fechado não aparece no mapa'); if (!p.lat) return toast('Este negócio ainda não tem localização: use Ajustar localização');
    S.etapasMapa = new Set([p.etapa]); S.modoPend = false; S.sel = p.id; irPara('mapa'); mapa.setView([p.lat, p.lng], 16); }; // abre o mapa filtrado na etapa deste negócio
  $('#pAjustar').onclick = () => { irPara('mapa'); if (p.lat) mapa.setView([p.lat, p.lng], 17); marcando = true; $('#hint').textContent = 'Toque no lugar exato de ' + p.nome; $('#hint').style.display = 'block';
    aoMarcar = async ([lng, lat]) => { try { const g = await geoReverso(lat, lng); await db.atualizarPdv(p.id, { lat, lng, geo_precisao: 'manual', regiao: await garantirRegiao(lng, lat, g.cidade || p.cidade), endereco: g.rua || p.endereco, bairro: g.bairro || p.bairro, cidade: g.cidade || p.cidade }); $('#hint').textContent = 'Toque no mapa onde fica o ponto'; await atualizarUm(p.id); toast('Localização ajustada'); } catch (e) { erro(e); } }; };
  $('#pEditar').onclick = () => { modal(`<h3>Editar ${esc(p.nome)}</h3><label>Nome fantasia</label><input id="eNome" value="${esc(p.nome)}">${campoEmpresa('e', p)}<label>Canal</label>${campoCanal('eCanal', p.canal)}
    ${(() => { const sp = separarRua(p); return `<div class="row"><div style="flex:3"><label>Rua</label><input id="eEnd" value="${esc(sp.rua)}" placeholder="Av. Benjamin Constant"></div><div style="flex:1"><label>Número</label><input id="eNum" value="${esc(sp.num)}" inputmode="numeric"></div></div>
    <div class="row"><div style="flex:2"><label>Bairro</label><input id="eBai" value="${esc(p.bairro || '')}"></div><div style="flex:2"><label>Cidade</label><input id="eCid" value="${esc(p.cidade || '')}"></div><div style="flex:.8"><label>UF</label><input id="eUf" value="${esc(p.uf || (p.cidade ? 'RS' : ''))}" maxlength="2" style="text-transform:uppercase"></div><div style="flex:1.4"><label>CEP</label><input id="eCep" value="${esc(p.cep || '')}" inputmode="numeric" placeholder="00000-000"></div></div>
    <small id="eEndTxt" style="color:var(--mute)"></small>`; })()}
    <label>Link do Google Maps <small style="color:var(--mute);font-weight:400">(opcional: cole o link do lugar e o pino vai para lá)</small></label><input id="eLink" value="${esc(/^https?:/.test(p.link_maps || '') ? p.link_maps : '')}" placeholder="https://www.google.com/maps/place/…"><div class="linkmsg" id="eLinkMsg"></div>
    <div class="row"><div style="flex:1"><label>Classe</label><select id="eCla"><option value="">—</option>${['A', 'B', 'C', 'D'].map(x => `<option ${x === p.classe ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div style="flex:1"><label>Potencial</label>${campoPot('ePot', p.potencial)}</div></div>
    <label>Expositor</label><select id="eExp"><option value="">— sem expositor —</option>${S.base.expositores.map(x => `<option value="${x.id}" ${x.id === p.expositor_id ? 'selected' : ''}>${esc(x.nome)} · ${x.capacidade} un.</option>`).join('')}</select>
    <label class="chkbox" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="eCF" style="width:auto" ${p.consumidor_final ? 'checked' : ''}> Consumidor final <small style="color:var(--mute)">(não gera reposição automática; dá para pôr na rota à mão)</small></label>
    <label>Observação</label><textarea id="eObs" rows="3">${esc(p.observacao || '')}</textarea><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="eOk">Salvar</button></div>`);
    ligarCanal('eCanal'); ligarEmpresa('e', 'eNome');
    // mostra o endereço montado no padrão do Google ("Av. Benjamin Constant, 76 - São João, Porto Alegre - RS, 90550-003")
    const mostraEnd = () => { const t = linhaEndereco({ rua: $('#eEnd').value.trim(), num: $('#eNum').value.trim(), bairro: $('#eBai').value.trim(), cidade: $('#eCid').value.trim(), uf: $('#eUf').value.trim().toUpperCase(), cep: $('#eCep').value.trim() }); $('#eEndTxt').textContent = t ? '📍 ' + t : ''; };
    ['eEnd', 'eNum', 'eBai', 'eCid', 'eUf', 'eCep'].forEach(id => $('#' + id).addEventListener('input', mostraEnd)); mostraEnd();
    const pore = a => { if (a.rua != null) $('#eEnd').value = a.rua; if (a.num != null) $('#eNum').value = a.num; if (a.bairro) $('#eBai').value = a.bairro; if (a.cidade) $('#eCid').value = a.cidade; if (a.uf) $('#eUf').value = a.uf; if (a.cep) $('#eCep').value = a.cep; mostraEnd(); };
    // CEP completo: preenche rua, bairro, cidade e UF
    $('#eCep').addEventListener('input', async () => { const c = soDig($('#eCep').value); if (c.length !== 8) return; $('#eCep').value = c.slice(0, 5) + '-' + c.slice(5);
      try { const j = await (await fetch('https://brasilapi.com.br/api/cep/v2/' + c)).json(); if (j.street || j.city) pore({ rua: j.street ? abreviarRua(j.street) : null, bairro: j.neighborhood, cidade: j.city, uf: j.state }); } catch { } });
    // CNPJ buscado: usa o endereço da Receita
    document.addEventListener('cnpj-encontrado', e => { const j = e.detail; if (!$('#eEnd')) return; pore({ rua: abreviarRua([j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' ')), num: j.numero && j.numero !== 'S/N' ? j.numero : '', bairro: j.bairro, cidade: j.municipio ? j.municipio.toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase()) : '', uf: j.uf, cep: j.cep ? String(j.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : '' }); }, { once: true });
    // link do Google colado: lê a localização (e o nome) para mostrar antes de salvar
    const lerLink = u => { const m = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || u.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/); return m ? { lat: +m[1], lng: +m[2] } : null; };
    const msgLink = (t, okk) => { const m = $('#eLinkMsg'); m.style.display = t ? 'block' : 'none'; m.style.background = okk ? 'var(--bg-ok)' : 'var(--bg-warn)'; m.style.color = okk ? '#1F5A37' : '#7A4A16'; m.innerHTML = t; };
    $('#eLink').oninput = async () => { const u = $('#eLink').value.trim(); if (!u || u === p.link_maps) return msgLink('');
      if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(u)) return msgLink('Link curto do celular: abra ele no navegador, copie o endereço completo da barra (começa com google.com/maps/place) e cole aqui.', false);
      const g = lerLink(u); if (!g) return msgLink('Não achei a localização nesse link. Copie o link da página do lugar no Google Maps.', false);
      msgLink(`Localização do link: ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} · buscando o endereço…`, true);
      // o mapa aberto (OpenStreetMap) às vezes pega o vizinho: bairro, cidade e UF entram sozinhos; rua, número e CEP ficam como sugestão para você confirmar
      const r = await enderecoDoPonto(g.lat, g.lng); if (r) pore({ bairro: r.bairro, cidade: r.cidade, uf: r.uf });
      const sug = r && (r.rua || r.cep) ? linhaEndereco(r) : '';
      msgLink(`📍 O pino vai para o lugar do link.${sug ? `<br><small>Endereço que o mapa achou nesse ponto: <b>${esc(sug)}</b> · <a href="#" id="eUsaSug">usar</a></small>` : ''}<br><small>Para o endereço exato: digite o <b>CEP</b> (preenche a rua) e o número, ou use <b>Buscar</b> no CNPJ.</small>`, true);
      if ($('#eUsaSug')) $('#eUsaSug').onclick = e => { e.preventDefault(); pore(r); }; };
    $('#eOk').onclick = async () => { try { const rua = $('#eEnd').value.trim(), num = $('#eNum').value.trim(), bai = $('#eBai').value.trim(), cid = $('#eCid').value.trim(), uf = $('#eUf').value.trim().toUpperCase(), cep = $('#eCep').value.trim();
      const end = [rua, num].filter(Boolean).join(', ');
      const patch = { nome: $('#eNome').value.trim() || p.nome, ...lerEmpresa('e'), canal: lerCanal('eCanal'), endereco: end || null, bairro: bai || null, cidade: cid || null, classe: $('#eCla').value || null, potencial: +$('#ePot').value, observacao: $('#eObs').value.trim() || null };
      if (!!$('#eCF').checked !== !!p.consumidor_final) patch.consumidor_final = $('#eCF').checked;
      const nExp = $('#eExp').value ? +$('#eExp').value : null; if (nExp !== (p.expositor_id || null)) { patch.expositor_id = nExp; if (nExp) registrarExpositor(p.id, nExp, p.expositor_id ? 'troca' : 'entregue'); }
      if ((num || null) !== (p.numero || null)) patch.numero = num || null; if ((uf || null) !== (p.uf || null)) patch.uf = uf || null; if ((cep || null) !== (p.cep || null)) patch.cep = cep || null;
      // link do Google novo: o pino vai para o lugar do link (mais preciso que o endereço) e o link fica guardado
      const link = $('#eLink').value.trim(), gl = link && link !== p.link_maps ? lerLink(link) : null;
      if (link !== (/^https?:/.test(p.link_maps || '') ? p.link_maps : '') && (gl || !link)) patch.link_maps = link ? link.split('?')[0] : null;
      if (gl) Object.assign(patch, { lat: gl.lat, lng: gl.lng, geo_precisao: 'exata', regiao: await garantirRegiao(gl.lng, gl.lat, cid || p.cidade) });
      // endereço digitado mudou (e não veio link): move o pino para o endereço novo
      else if (end && (end !== (p.endereco || '') || cid !== (p.cidade || '') || bai !== (p.bairro || ''))) { $('#eOk').disabled = true; $('#eOk').textContent = 'Localizando endereço…';
        const g = await geocodificar(`${end}${bai ? ' - ' + bai : ''} - ${cid || 'Porto Alegre'}/${uf || 'RS'}${cep ? ' - ' + cep : ''}`).catch(() => null);
        if (g) Object.assign(patch, { lat: g.lat, lng: g.lng, geo_precisao: g.precisao, regiao: await garantirRegiao(g.lng, g.lat, g.cidade || cid), cidade: cid || g.cidade || null, bairro: bai || g.bairro || null });
        else toast('Não achei esse endereço no mapa: o pino ficou onde estava (use Ajustar localização)'); }
      await db.atualizarPdv(p.id, patch); fecharModal(); await atualizarUm(p.id); toast('Dados salvos'); telaPerfil(); } catch (e) { erro(e); } }; };
  if ($('#pVerContato')) $('#pVerContato').onclick = () => abrirContato(c.id);
  $('#pTrocarContato').onclick = () => { modal(`<h3>Contato de ${esc(p.nome)}</h3>${campoContato()}<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="kOk">Vincular</button></div>`); document.querySelector('#modalBox details').open = true;
    $('#kOk').onclick = async () => { try { const id = await contatoDoForm(p.nome); if (!id) return toast('Escolha um contato ou preencha o nome'); await db.atualizarPdv(p.id, { contato_id: id }); fecharModal(); await atualizarUm(p.id); toast('Contato vinculado'); telaPerfil(); } catch (e) { erro(e); } }; };
  $('#pExcluirTopo').onclick = () => $('#pExcluir').click();
  if ($('#pDetPed')) $('#pDetPed').onclick = () => irPara('pedcli');
  $('#pNota').onclick = () => { $('#pNotaBox').hidden = false; $('#pNotaTxt').focus(); };
  $('#pNotaX').onclick = () => { $('#pNotaBox').hidden = true; $('#pNotaTxt').value = ''; };
  $('#pNotaOk').onclick = async () => { const t = $('#pNotaTxt').value.trim(); if (!t) return toast('Escreva a observação');
    $('#pNotaOk').disabled = true; try { await db.criarNota(p.id, t, S.eu.id); toast('Observação salva no histórico'); telaPerfil(); } catch (e) { $('#pNotaOk').disabled = false; erro(/pdv_notas/.test(e.message) ? new Error('Rode o 022_observacoes.sql no Supabase') : e); } };
  document.querySelectorAll('[data-delnota]').forEach(a => a.onclick = async e => { e.preventDefault(); modal(`<h3>Excluir esta observação?</h3><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="nxOk">Excluir</button></div>`);
    $('#nxOk').onclick = async () => { try { await db.excluirNota(a.dataset.delnota); fecharModal(); toast('Observação excluída'); telaPerfil(); } catch (er) { fecharModal(); erro(er); } }; });
  ligarPrior(p, () => telaPerfil());
  if ($('#pAddSec')) $('#pAddSec').onclick = () => { modal(`<h3>Contato secundário de ${esc(p.nome)}</h3><p style="color:var(--soft);margin-top:0">Ex.: o gerente, quando o principal é o dono.</p>${campoContato()}<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="kOk">Adicionar</button></div>`); document.querySelector('#modalBox details').open = true;
    $('#kOk').onclick = async () => { try { const id = await contatoDoForm(p.nome); if (!id) return toast('Escolha um contato ou preencha o nome'); if (id === p.contato_id) return toast('Esse já é o contato principal');
      const comp = $('#kComp')?.checked;
      if (comp) { if ($('#kSel').value) await db.atualizarContato(id, { comprador: true }).then(n => Object.assign(S.contatos.find(x => x.id === id) || {}, n)).catch(() => { });
        await db.atualizarPdv(p.id, { contato_id: id }); if (p.contato_id) await db.vincularContato(p.id, p.contato_id); await atualizarUm(p.id); fecharModal(); toast('Comprador adicionado como contato principal'); return telaPerfil(); }
      await db.vincularContato(p.id, id); fecharModal(); toast('Contato secundário adicionado'); telaPerfil(); } catch (e) { erro(/pdv_contatos/.test(e.message) ? new Error('Rode o 020_contatos_secundarios.sql no Supabase') : e); } }; };
  document.querySelectorAll('[data-ctabre]').forEach(b => b.onclick = () => abrirContato(b.dataset.ctabre));
  document.querySelectorAll('[data-ctrem]').forEach(b => b.onclick = async () => { try { await db.desvincularContato(p.id, b.dataset.ctrem); toast('Contato removido deste negócio'); telaPerfil(); } catch (e) { erro(e); } });
  document.querySelectorAll('[data-ctprin]').forEach(b => b.onclick = async () => { const novo = b.dataset.ctprin;
    try { await db.atualizarPdv(p.id, { contato_id: novo }); await db.desvincularContato(p.id, novo); if (p.contato_id) await db.vincularContato(p.id, p.contato_id); await atualizarUm(p.id); toast('Contato principal trocado'); contatoParaBling(novo); telaPerfil(); } catch (e) { erro(e); } });
  ligarJanela('pj');
  $('#pHorOk').onclick = async () => { const v = $('#pHor').value.trim() || null; try { await db.atualizarPdv(p.id, { melhor_horario: v, ...lerJanela('pj') }); p.melhor_horario = v; await atualizarUm(p.id); toast('Janela de atendimento salva'); } catch (e) { erro(/janela_|precisa_dono/.test(e.message) ? new Error('Rode o SQL 018 no Supabase para salvar a janela de atendimento') : e); } };
  document.querySelectorAll('[data-envbling]').forEach(b => b.onclick = async () => { b.disabled = true; await enviarAoBling(b.dataset.envbling, p.nome); telaPerfil(); });
  $('#pExcluir').onclick = () => { const np = h.pedidos.length; modal(`<h3>Excluir ${esc(p.nome)}?</h3><p style="color:var(--soft)">Apaga o negócio com as visitas, contagens e tarefas dele${np ? `, <b>e também os ${np} pedido${np > 1 ? 's' : ''} (${brl(h.pedidos.reduce((a, o) => a + Number(o.valor), 0))})</b>` : ''}. O contato vinculado continua cadastrado. Não dá para desfazer.</p>${np ? '<p style="color:var(--soft);font-size:13px">Se é um cliente real que parou de comprar, prefira mudar a etapa para Inativo e manter o histórico.</p>' : ''}<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="xOk" style="background:#7A2414;border-color:var(--t-bad)">Excluir</button></div>`);
    $('#xOk').onclick = async () => { try { await db.excluirPdv(p.id); fecharModal(); S.pdvs = S.pdvs.filter(x => x.id !== p.id); S.sel = null; toast('Negócio excluído'); irPara('carteira'); } catch (e) { fecharModal(); toast('Erro: ' + e.message); } }; };
}

/* =================== detalhes de pedidos do cliente =================== */
const LINHAS_COR = { Brownie: COR.s1, Cookie: COR.s2, Palha: COR.s3 };
async function telaPedidosCliente() {
  const p = S.pdvs.find(x => x.id === S.perfilId); if (!p) return irPara('carteira');
  $('#main').innerHTML = '<section class="view on"><div class="loading">Lendo os pedidos…</div></section>';
  let peds, it, precosC = {}; try { [peds, it, precosC] = await Promise.all([db.pedidosDoCliente(p.id), db.itensDoCliente(p.id), db.precosCliente(p.id).catch(() => ({}))]); } catch (e) { return erro(e); }
  peds = peds.filter(o => !/cancel/i.test(o.bling_situacao || ''));
  const voltarHtml = `<div class="row" style="gap:8px"><button class="btn" id="dVoltar">← ${esc(p.nome)}</button><span style="color:var(--mute)">Detalhes dos pedidos</span></div>`;
  if (!PV.dados) { try { PV.dados = prepararPainel(await db.painelDados()); PV.t = Date.now(); } catch (e) { } }
  if (!peds.length) { $('#main').innerHTML = `<section class="view on"><div class="dash pnl">${voltarHtml}${blocoMetCliente(p.id)}<p class="empty">Este cliente ainda não tem pedidos.</p></div></section>`; $('#dVoltar').onclick = () => voltar('perfil'); ligarGraficos($('#main section')); return; }
  // itens por pedido (app primeiro; se o pedido não tem itens no app, usa os do Bling)
  const prodId = Object.fromEntries(S.base.produtos.map(x => [x.id, x])), porCod = {}; S.base.produtos.forEach(x => { if (x.bling_codigo) porCod[x.bling_codigo] = x; });
  const itens = {}; it.pitens.forEach(i => (itens[i.pedido_id] = itens[i.pedido_id] || []).push({ pr: prodId[i.produto_id], q: +i.quantidade, v: +i.quantidade * +i.preco_unit }));
  it.bitens.forEach(i => { if (it.pitens.some(x => x.pedido_id === i.pedido_id)) return; (itens[i.pedido_id] = itens[i.pedido_id] || []).push({ pr: porCod[i.codigo], cod: i.codigo, q: +i.quantidade, v: +i.quantidade * +i.valor - (+i.desconto || 0) }); });
  const linha = x => (x.pr?.linha || '').split(' ')[0] || 'Outros', un = o => (itens[o.id] || []).reduce((a, x) => a + x.q, 0) || Number(o.unidades) || 0;
  // números
  const ds = peds.map(o => new Date(o.criado_em)), total = peds.reduce((a, o) => a + Number(o.valor || 0), 0), unT = peds.reduce((a, o) => a + un(o), 0);
  const gaps = ds.slice(1).map((d, i) => (d - ds[i]) / DIA).filter(g => g > 0.5), inter = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const dp = gaps.length > 1 ? Math.sqrt(gaps.reduce((a, g) => a + (g - inter) ** 2, 0) / gaps.length) : null, cv = dp != null ? dp / inter : null;
  const regular = cv == null ? '—' : cv < .35 ? 'Regular' : cv < .7 ? 'Oscila' : 'Irregular';
  const semPed = Math.floor((Date.now() - ds[ds.length - 1]) / DIA), spanD = Math.max(7, (ds[ds.length - 1] - ds[0]) / DIA + (inter || 14));
  const unSem = unT / spanD * 7, porMes = total / spanD * 30.4;
  // meses (últimos 12)
  const hojeD = new Date(), meses = []; for (let i = 11; i >= 0; i--) { const m = new Date(hojeD.getFullYear(), hojeD.getMonth() - i, 1); meses.push({ k: m.getFullYear() + '-' + m.getMonth(), n: m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), v: 0, q: 0, l: {} }); }
  peds.forEach(o => { const d = new Date(o.criado_em), m = meses.find(x => x.k === d.getFullYear() + '-' + d.getMonth()); if (!m) return; m.v += Number(o.valor || 0); m.q++;
    (itens[o.id] || []).forEach(x => { const l = linha(x); m.l[l] = (m.l[l] || 0) + x.q; }); });
  const linhasUs = [...new Set(Object.values(itens).flat().map(linha))].sort((a, b) => Object.keys(LINHAS_COR).indexOf(a) - Object.keys(LINHAS_COR).indexOf(b));
  // sabores, dia da semana, pagamento
  const sab = {}; Object.values(itens).flat().forEach(x => { const k = x.pr ? x.pr.id : x.cod; sab[k] = sab[k] || { n: x.pr ? x.pr.sabor : x.cod, l: linha(x), q: 0 }; sab[k].q += x.q; });
  const sabL = Object.values(sab).sort((a, b) => b.q - a.q), sabT = sabL.reduce((a, x) => a + x.q, 0);
  const dow = [0, 0, 0, 0, 0, 0, 0]; ds.forEach(d => dow[d.getDay()]++);
  const formaDe = o => !o.condicao || /importad/i.test(o.condicao) ? null : o.condicao; // pedidos do Bling vieram sem a forma
  const pag = {}; peds.forEach(o => { const k = formaDe(o); if (k) pag[k] = (pag[k] || 0) + 1; });
  const nPag = Object.values(pag).reduce((a, b) => a + b, 0);
  // tendência: média dos 3 últimos pedidos contra a média dos anteriores
  const tick = peds.map(o => Number(o.valor || 0)), ult3 = tick.slice(-3), ant = tick.slice(0, -3);
  const tend = ant.length >= 2 ? (ult3.reduce((a, b) => a + b, 0) / ult3.length) / (ant.reduce((a, b) => a + b, 0) / ant.length) - 1 : null;
  const kpi = (n, v, sub) => `<div class="kpi"><small>${n}</small><b>${v}</b>${sub ? `<small class="sub">${sub}</small>` : ''}</div>`;
  const leit = [];
  if (inter) leit.push(`Compra a cada <b>${Math.round(inter)} dias</b> em média (${regular.toLowerCase()}${cv != null ? `, varia ±${Math.round(dp)} dias` : ''}).`);
  leit.push(semPed > (inter || 30) * 1.5 ? `Está há <b>${semPed} dias</b> sem pedido, ${inter ? `${(semPed / inter).toFixed(1).replace('.', ',')}× o intervalo normal` : 'acima do esperado'}.` : `Último pedido há <b>${semPed} dias</b>, dentro do ritmo.`);
  if (sabL.length) leit.push(`O sabor que mais sai é <b>${esc(sabL[0].n)}</b> (${Math.round(sabL[0].q / sabT * 100)}% das unidades).`);
  if (tend != null && Math.abs(tend) >= .1) leit.push(`Os 3 últimos pedidos foram <b>${Math.round(Math.abs(tend) * 100)}% ${tend > 0 ? 'maiores' : 'menores'}</b> que a média anterior.`);
  const dowMax = Math.max(...dow); if (peds.length >= 4 && dowMax / peds.length >= .4) leit.push(`Costuma comprar na <b>${DIAS[dow.indexOf(dowMax)].toLowerCase()}</b> (${Math.round(dowMax / peds.length * 100)}% dos pedidos).`);
  // preço aplicado: combinado no cadastro, último pago e média paga (valor ÷ quantidade, já com desconto)
  const pp = {}; peds.forEach(o => (itens[o.id] || []).forEach(x => { if (!x.pr || !x.q) return; const e = pp[x.pr.id] = pp[x.pr.id] || { q: 0, v: 0, ult: null, em: null };
    e.q += x.q; e.v += x.v; if (!e.em || o.criado_em >= e.em) { e.em = o.criado_em; e.ult = x.v / x.q; } }));
  const linhasPreco = S.base.produtos.filter(pr => pp[pr.id] || precosC[pr.id] != null).map(pr => ({ pr, tab: Number(pr.preco), comb: precosC[pr.id] != null ? Number(precosC[pr.id]) : null, ...(pp[pr.id] || {}), med: pp[pr.id] ? pp[pr.id].v / pp[pr.id].q : null }));
  const difTab = (v, tab) => v == null || !tab ? '' : Math.abs(v - tab) < 0.005 ? '<small class="ptab">= tabela</small>' : `<small class="${v < tab ? 'pdn' : 'pup'}">${v < tab ? '▼' : '▲'} ${Math.abs(Math.round((v / tab - 1) * 100))}%</small>`;
  const xsP = ds.map(d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
  const foraBling = peds.filter(o => !o.bling_id && o.bling_status !== 'importado');
  const seloBling = o => o.bling_status === 'importado' ? '<span class="sbl imp">Veio do Bling</span>' : o.bling_id ? `<span class="sbl ok">✓ No Bling</span>` : o.bling_status === 'erro' ? `<span class="sbl err" title="${esc(o.bling_erro || '')}">Erro ao enviar</span>` : '<span class="sbl pend">Não enviado</span>';
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl">${voltarHtml}
  <div class="pfiltros"><div><h2>${esc(p.nome)}</h2><small>${peds.length} pedidos desde ${dataLonga(ds[0])} · ${etapa(p.etapa).n}</small></div></div>
  <div class="kpis">${kpi('Total comprado', brl(total), `${brl(porMes)} por mês em média`)}${kpi('Ticket médio', brl(total / peds.length), tend != null ? `${tend >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(tend) * 100)}% nos 3 últimos` : '')}${kpi('Compra a cada', inter ? Math.round(inter) + ' dias' : '—', regular !== '—' ? regular : '')}${kpi('Consumo', `${dec(unSem)} un./semana`, `${fmt(unT)} unidades no total · ${dec(unT / peds.length)} por pedido`)}</div>
  ${blocoMetCliente(p.id)}
  <div class="panel pleit"><h3>Leitura do padrão</h3><ul>${leit.map(l => `<li>${l}</li>`).join('')}</ul></div>
  <div class="pgrid">
   <div class="panel"><h3>Compras por mês</h3><p class="psub">Valor comprado nos últimos 12 meses</p>${grafBarras('dMes', meses.map(m => m.n), [{ nome: 'Valor', cor: COR.s1, vals: meses.map(m => m.v) }], 'R$')}</div>
   <div class="panel"><h3>Unidades por linha</h3><p class="psub">Unidades por mês, separadas por linha de produto</p>${linhasUs.length ? grafBarras('dLin', meses.map(m => m.n), linhasUs.map(l => ({ nome: l, cor: LINHAS_COR[l] || COR.neutro, vals: meses.map(m => m.l[l] || 0) })), 'un') + legenda(linhasUs.map(l => ({ nome: l, cor: LINHAS_COR[l] || COR.neutro }))) : '<p class="empty">Os pedidos deste cliente não têm itens detalhados.</p>'}</div>
   <div class="panel"><h3>Valor de cada pedido</h3><p class="psub">Linha: valor do pedido · traço: ticket médio</p>${grafLinhas('dTick', xsP, [{ nome: 'Pedido', cor: COR.s1, vals: tick }, { nome: 'Média', cor: COR.neutro, vals: tick.map(() => total / peds.length), tracejado: true }], 'R$')}</div>
   <div class="panel"><h3>Intervalo entre pedidos</h3><p class="psub">Dias desde o pedido anterior · traço: intervalo médio</p>${gaps.length ? grafLinhas('dGap', xsP.slice(1), [{ nome: 'Dias', cor: COR.s2, vals: ds.slice(1).map((d, i) => Math.round((d - ds[i]) / DIA)) }, { nome: 'Média', cor: COR.neutro, vals: gaps.map(() => inter), tracejado: true }], 'un') : '<p class="empty">Precisa de 2 pedidos ou mais.</p>'}</div>
   <div class="panel"><h3>Sabores</h3><p class="psub">Unidades de cada sabor em todos os pedidos</p>${sabL.length ? ranking(sabL.map(x => ({ n: x.n + ' · ' + x.l, v: x.q, c: LINHAS_COR[x.l] || COR.neutro, tip: `${Math.round(x.q / sabT * 100)}% das unidades` })), 'un') : '<p class="empty">Sem itens detalhados.</p>'}</div>
   <div class="panel"><h3>Quando e como compra</h3><p class="psub">Pedidos por dia da semana</p>${ranking([1, 2, 3, 4, 5, 6, 0].map(i => ({ n: DIAS[i], v: dow[i], c: COR.s1 })), 'un')}
    ${nPag ? `<p class="psub" style="margin-top:14px">Forma de pagamento <small>(${nPag} de ${peds.length} pedidos têm a forma registrada)</small></p>${ranking(Object.entries(pag).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ n: k, v, c: COR.s3, tip: `${Math.round(v / nPag * 100)}% dos pedidos com forma registrada` })), 'un')}` : ''}</div>
  </div>
  ${linhasPreco.length ? `<div class="panel"><h3>Preço aplicado por produto</h3><p class="psub">Combinado: preço guardado para este cliente na venda · Pago: valor do item ÷ quantidade, já com desconto · % comparado à tabela do Bling</p>
   <table class="dped dprec"><tr><th>Produto</th><th>Tabela</th><th>Combinado</th><th>Último pago</th><th>Média paga</th><th>Unidades</th></tr>
   ${linhasPreco.map(x => `<tr><td><span class="dchip" style="--c:${LINHAS_COR[(x.pr.linha || '').split(' ')[0]] || COR.neutro}">${esc((x.pr.linha || '').split(' ')[0])}</span> ${esc(x.pr.sabor)}</td><td>${brl(x.tab)}</td>
    <td>${x.comb != null ? `<b>${brl(x.comb)}</b> ${difTab(x.comb, x.tab)}` : '<small style="color:var(--mute)">tabela</small>'}</td>
    <td>${x.ult != null ? `${brl(x.ult)} ${difTab(x.ult, x.tab)}<br><small>${dstr(x.em)}</small>` : '—'}</td><td>${x.med != null ? `${brl(x.med)} ${difTab(x.med, x.tab)}` : '—'}</td><td>${x.q ? fmt(Math.round(x.q)) : '—'}</td></tr>`).join('')}</table></div>` : ''}
  <div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 style="margin:0">Todos os pedidos</h3>
    <div class="row" style="gap:8px;align-items:center"><small id="dSelN" style="color:var(--mute)">${foraBling.length ? `${foraBling.length} pedido${foraBling.length > 1 ? 's' : ''} fora do Bling · marque para enviar` : 'Todos os pedidos estão no Bling'}</small><button class="btn pri" id="dEnviar" hidden>Mandar ao Bling</button></div></div>
   <table class="dped"><tr><th></th><th>Data</th><th>Nº</th><th>Bling</th><th>Itens</th><th>Un.</th><th>Pagamento</th><th style="text-align:right">Valor</th></tr>
   ${peds.slice().reverse().map(o => { const its = itens[o.id] || [], fora = foraBling.includes(o); return `<tr class="lnk ${fora ? 'fora' : ''}" data-ped="${o.id}" title="Ver o pedido e a contagem"><td>${fora ? `<input type="checkbox" class="dsel" value="${o.id}">` : ''}</td><td>${new Date(o.criado_em).toLocaleDateString('pt-BR')}<br><small>${DIAS[new Date(o.criado_em).getDay()].slice(0, 3)}</small></td><td>${esc(o.bling_pedido_id || o.numero || '—')}${o.tipo === 'abertura' ? '<br><small>abertura</small>' : ''}</td><td>${seloBling(o)}</td>
    <td>${its.length ? its.sort((a, b) => b.q - a.q).map(x => `<span class="dchip" style="--c:${LINHAS_COR[linha(x)] || COR.neutro}">${esc(x.pr ? x.pr.sabor : x.cod)} <b>${x.q}</b></span>`).join('') : '<small style="color:var(--mute)">sem itens</small>'}</td>
    <td>${fmt(un(o))}</td><td>${esc(formaDe(o) || '—')}${Array.isArray(o.pagamentos) && o.pagamentos.length > 1 ? `<br><small>${o.pagamentos.map(x => `${esc(x.forma)} ${brl(x.valor)}`).join(' · ')}</small>` : ''}</td><td style="text-align:right"><b>${brl(o.valor)}</b></td></tr>`; }).join('')}</table></div>
  </div></section>`;
  $('#dVoltar').onclick = () => voltar('perfil');
  ligarGraficos($('#main section'));
  document.querySelectorAll('tr[data-ped]').forEach(tr => tr.onclick = e => { if (e.target.closest('.dsel')) return; verPedido(tr.dataset.ped, p); });
  const marcados = () => [...document.querySelectorAll('.dsel:checked')].map(i => i.value);
  document.querySelectorAll('.dsel').forEach(i => i.onchange = () => { const n = marcados().length, b = $('#dEnviar'); b.hidden = !n;
    b.textContent = n > 1 ? `Juntar ${n} pedidos e mandar como um só` : 'Mandar ao Bling'; $('#dSelN').textContent = n ? `${n} selecionado${n > 1 ? 's' : ''} · ${brl(peds.filter(o => marcados().includes(o.id)).reduce((a, o) => a + Number(o.valor || 0), 0))}` : `${foraBling.length} pedido${foraBling.length > 1 ? 's' : ''} fora do Bling · marque para enviar`; });
  $('#dEnviar').onclick = async () => { const ids = marcados(); if (!ids.length) return;
    if (ids.length === 1) { await enviarAoBling(ids[0], p.nome); return telaPedidosCliente(); }
    const sel = peds.filter(o => ids.includes(o.id)), tot = sel.reduce((a, o) => a + Number(o.valor || 0), 0);
    modal(`<h3>Juntar ${ids.length} pedidos em um só?</h3><p style="color:var(--soft)">Os pedidos de ${sel.map(o => dstr(o.criado_em)).join(', ')} viram <b>um pedido só</b> de ${brl(tot)}, com os itens somados por sabor, e esse pedido vai para o Bling. No app eles também passam a ser um pedido só, na data do mais antigo. Não dá para desfazer.</p>
     <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="agOk">Juntar e mandar</button></div>`);
    $('#agOk').onclick = async () => { $('#agOk').disabled = true; $('#agOk').textContent = 'Juntando…';
      try { const id = await db.agruparPedidos(ids); fecharModal(); toast('Pedidos juntados'); await enviarAoBling(id, p.nome); telaPedidosCliente(); }
      catch (e) { fecharModal(); erro(/agrupar_pedidos|function/.test(e.message) ? new Error('Rode o 025_pagamento_dividido_agrupar.sql no Supabase') : e); } }; };
}

// editar sem excluir: quantidades, preços, bonificação e pagamento; se já está no Bling, atualiza o mesmo pedido lá
function editarPedidoModal(o, d, p) {
  const its = Object.fromEntries(d.itens.map(i => [i.produto_id, i])), linhaPr = {};
  const prods = S.base.produtos;
  modal(`<h3 style="margin-top:0">Editar pedido ${esc(o.bling_pedido_id || o.numero || '')} · ${esc(p.nome)}</h3>
   <p class="psub" style="margin:0 0 8px">${o.bling_id ? `Ao salvar, o pedido nº ${esc(o.bling_pedido_id || '')} é atualizado no Bling (o mesmo número, sem excluir).` : 'Este pedido ainda não está no Bling.'}${o.visita_id ? ' A contagem da visita e a baixa do estoque acompanham.' : ''}</p>
   <div style="max-height:44vh;overflow:auto"><table class="dped"><tr><th>Produto</th><th>Qtd.</th><th>Bonif.</th><th>Preço un.</th><th style="text-align:right">Total</th></tr>
   ${prods.map(pr => { const i = its[pr.id]; return `<tr><td>${esc(nomeProd(pr))}</td><td><input type="number" min="0" class="epQ" data-p="${pr.id}" value="${i ? +i.quantidade : 0}" style="width:64px"></td><td><input type="number" min="0" class="epB" data-p="${pr.id}" value="${i ? +i.bonificado || 0 : 0}" style="width:56px"></td><td><input type="number" step="0.05" min="0" class="epP" data-p="${pr.id}" value="${(i ? +i.preco_unit : (S.precosCli?.[pr.id] ?? +pr.preco)).toFixed(2)}" style="width:76px"></td><td class="epT" data-p="${pr.id}" style="text-align:right"></td></tr>`; }).join('')}</table></div>
   <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px"><div><label>Pagamento</label><select id="epF">${[...new Set([...FORMAS, o.condicao].filter(Boolean))].map(f => `<option ${f === o.condicao ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
    <div><label>Vencimento</label><input type="date" id="epV" value="${o.vencimento || ''}"></div><div style="margin-left:auto;text-align:right"><small style="color:var(--mute)">Total</small><br><b id="epTot" style="font-size:20px"></b></div></div>
   ${caixaPix()}
   <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="epOk">Salvar${o.bling_id ? ' e atualizar no Bling' : ''}</button></div>`);
  const tot = () => { let t = 0; prods.forEach(pr => { const q = +document.querySelector(`.epQ[data-p="${pr.id}"]`).value || 0, v = +document.querySelector(`.epP[data-p="${pr.id}"]`).value || 0; t += q * v; document.querySelector(`.epT[data-p="${pr.id}"]`).textContent = q ? brl(q * v) : ''; }); $('#epTot').textContent = brl(t); };
  document.querySelectorAll('.epQ,.epP,.epB').forEach(i => i.oninput = tot); tot(); atualizaPix();
  $('#epOk').onclick = async () => {
    const itens = prods.map(pr => ({ produto_id: pr.id, quantidade: +document.querySelector(`.epQ[data-p="${pr.id}"]`).value || 0, bonificado: +document.querySelector(`.epB[data-p="${pr.id}"]`).value || 0, preco_unit: +document.querySelector(`.epP[data-p="${pr.id}"]`).value || 0 }));
    if (!itens.some(i => i.quantidade > 0)) return toast('O pedido precisa ter pelo menos um item cobrado (para zerar, use Excluir)');
    $('#epOk').disabled = true; $('#epOk').textContent = 'Salvando…';
    try { const r = await db.editarPedido(o.id, { itens, condicao: $('#epF').value, vencimento: $('#epV').value || null });
      let msg = `Pedido editado: ${brl(r.valor)} · ${r.unidades} un.`;
      if (o.bling_id) { try { await db.bling('atualizar_pedido', { pedido_id: o.id }); msg += ` · atualizado no Bling (nº ${o.bling_pedido_id || o.bling_id})`; }
        catch (e) { fecharModal(); await recarregar(); return modal(`<h3>Salvo no app, mas o Bling não aceitou a edição</h3><p style="font-size:13px;color:var(--t-bad)">${esc(e.message)}</p><p style="color:var(--soft)">Se o pedido já foi atendido/faturado no Bling, ele pode não aceitar mudanças. Ajuste por lá ou use "Excluir e refazer".</p><div class="row" style="justify-content:flex-end"><button class="btn pri" onclick="fecharModal()">Ok</button></div>`); } }
      fecharModal(); toast(msg); await recarregar(); if (S.aba === 'pedidos') telaPedidos(); else if (S.aba === 'pedcli') telaPedidosCliente(); }
    catch (e) { $('#epOk').disabled = false; $('#epOk').textContent = 'Salvar'; erro(e); } };
}
// um pedido em detalhe: itens, pagamento e a contagem do expositor (tinha, vendeu, trocas, repôs, bonificação, ficou); dá para excluir e refazer
async function verPedido(id, p) {
  modal('<div class="loading">Abrindo o pedido…</div>');
  let d; try { d = await db.detalhePedido(id); } catch (e) { fecharModal(); return erro(e); }
  const o = d.pedido, pr = Object.fromEntries(S.base.produtos.map(x => [x.id, x])), porCod = {}; S.base.produtos.forEach(x => { if (x.bling_codigo) porCod[x.bling_codigo] = x; });
  const nomeP = x => x ? `${(x.linha || '').split(' ')[0]} ${x.sabor}` : '—';
  const bon = Object.fromEntries(d.itens.filter(i => +i.bonificado).map(i => [i.produto_id, +i.bonificado])), cob = Object.fromEntries(d.itens.map(i => [i.produto_id, +i.quantidade]));
  const its = d.itens.length ? d.itens.filter(i => +i.quantidade > 0).map(i => ({ n: nomeP(pr[i.produto_id]), q: +i.quantidade, u: +i.preco_unit, v: +i.quantidade * +i.preco_unit }))
    : d.bitens.map(i => ({ n: porCod[i.codigo] ? nomeP(porCod[i.codigo]) : i.descricao || i.codigo, q: +i.quantidade, u: +i.valor, v: +i.quantidade * +i.valor - (+i.desconto || 0) }));
  const cs = d.contagens.slice().sort((a, b) => a.produto_id - b.produto_id), soma = k => cs.reduce((a, c) => a + (+c[k] || 0), 0);
  const repCob = c => cob[c.produto_id] ?? Math.max(0, (+c.reposto || 0) - (+c.troca || 0) - (bon[c.produto_id] || 0));
  const tabC = cs.length ? `<h4 style="margin:14px 0 6px">Contagem do expositor</h4><div style="overflow-x:auto"><table class="dped"><tr><th>Produto</th><th>Tinha</th><th>Encontrou</th><th>Vendeu</th><th>Trocas</th><th>Repôs</th><th>Bonif.</th><th>Ficou</th></tr>
     ${cs.map(c => `<tr><td>${esc(nomeP(pr[c.produto_id]))}</td><td>${c.deixado_anterior}</td><td>${c.encontrado}</td><td><b>${c.sellout ?? Math.max(0, c.deixado_anterior - c.encontrado)}</b></td><td>${c.troca || '—'}</td><td>${repCob(c) || '—'}</td><td>${bon[c.produto_id] || '—'}</td><td>${c.deixado_agora ?? ''}</td></tr>`).join('')}
     <tr style="font-weight:700"><td>Total</td><td>${soma('deixado_anterior')}</td><td>${soma('encontrado')}</td><td>${soma('sellout')}</td><td>${soma('troca')}</td><td>${cs.reduce((a, c) => a + repCob(c), 0)}</td><td>${Object.values(bon).reduce((a, b) => a + b, 0)}</td><td>${soma('deixado_agora')}</td></tr></table></div>
     <small style="color:var(--mute)">Tinha = deixado na reposição anterior · Vendeu = tinha − encontrou · Repôs = cobrado no pedido · Ficou = encontrou − trocas + tudo que foi colocado</small>`
    : `<p style="color:var(--mute);margin:12px 0 0">${o.visita_id ? 'Esta visita não tem contagem do expositor (venda registrada sem contar).' : 'Pedido sem contagem do expositor.'}</p>`;
  const doBling = o.bling_status === 'importado' && !o.criado_por;
  modal(`<h3 style="margin-top:0">Pedido ${esc(o.bling_pedido_id || o.numero || '')} · ${new Date(o.criado_em).toLocaleDateString('pt-BR')}</h3>
   <p style="color:var(--soft);margin:0">${esc(p.nome)} · ${o.tipo === 'abertura' ? 'abertura' : 'reposição'}${d.visita?.perfis?.nome ? ' · por ' + esc(d.visita.perfis.nome) : ''} · ${o.bling_id ? 'no Bling' : doBling ? 'veio do Bling' : 'não enviado ao Bling'}</p>
   <p style="margin:6px 0 0">Pagamento: <b>${esc(o.condicao || '—')}</b>${o.vencimento ? ' · vence ' + dstr(o.vencimento + 'T12:00') : ''}${Array.isArray(o.pagamentos) && o.pagamentos.length > 1 ? '<br><small>' + o.pagamentos.map(x => `${esc(x.forma)} ${brl(x.valor)}${x.vencimento ? ' (' + dstr(x.vencimento + 'T12:00') + ')' : ''}`).join(' · ') + '</small>' : ''}${+o.frete ? ` · frete ${brl(o.frete)}` : ''}</p>
   <h4 style="margin:14px 0 6px">Itens cobrados</h4>${its.length ? `<table class="dped"><tr><th>Produto</th><th>Qtd.</th><th>Preço</th><th style="text-align:right">Valor</th></tr>${its.map(i => `<tr><td>${esc(i.n)}</td><td>${i.q}</td><td>${brl(i.u)}</td><td style="text-align:right">${brl(i.v)}</td></tr>`).join('')}<tr style="font-weight:700"><td>Total</td><td>${its.reduce((a, i) => a + i.q, 0)}</td><td></td><td style="text-align:right">${brl(o.valor)}</td></tr></table>` : '<small style="color:var(--mute)">sem itens detalhados</small>'}
   ${tabC}${d.visita?.observacao ? `<p style="background:var(--sand);padding:8px 10px;border-radius:8px;margin:10px 0 0">${esc(d.visita.observacao)}</p>` : ''}
   <div class="row" style="margin-top:16px;justify-content:space-between;flex-wrap:wrap;gap:8px">
    ${doBling ? '<small style="color:var(--mute)">Pedido importado do Bling: edite ou exclua por lá.</small>' : '<div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn car" id="vpEdit">✏️ Editar pedido</button><button class="btn" id="vpExc" style="color:var(--t-bad)">Excluir pedido</button><button class="btn" id="vpRef">Excluir e refazer</button></div>'}
    <button class="btn pri" onclick="fecharModal()">Fechar</button></div>`);
  if (doBling) return;
  const excluir = async refazer => {
    modal(`<h3>Excluir o pedido de ${new Date(o.criado_em).toLocaleDateString('pt-BR')} (${brl(o.valor)})?</h3><p style="color:var(--soft)">Apaga o pedido${o.visita_id ? ' e a visita/contagem ligada a ele' : ''} no app${o.bling_id ? ` e <b>exclui o pedido nº ${esc(o.bling_pedido_id || o.bling_id)} no Bling</b>` : ''}. Não dá para desfazer.${refazer ? ' Em seguida abre a tela para lançar de novo, já preenchida.' : ''}</p>
     <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="vpOk" style="background:#7A2414;border-color:var(--t-bad)">${refazer ? 'Excluir e refazer' : 'Excluir'}</button></div>`);
    $('#vpOk').onclick = async () => { $('#vpOk').disabled = true; $('#vpOk').textContent = 'Excluindo…';
      try { if (o.bling_id) await db.bling('excluir_pedido', { pedido_id: o.id }); await db.excluirPedido(o.id, o.visita_id || null); }
      catch (e) { fecharModal(); return modal(`<h3>Não deu para excluir</h3><p style="font-size:13px;color:var(--t-bad)">${esc(e.message)}</p><p style="color:var(--soft)">Se o Bling recusou (por exemplo, pedido já faturado), cancele por lá primeiro.</p><div class="row" style="justify-content:flex-end"><button class="btn pri" onclick="fecharModal()">Ok</button></div>`); }
      fecharModal(); toast(o.bling_id ? `Pedido excluído, também no Bling (nº ${o.bling_pedido_id || o.bling_id})` : 'Pedido excluído'); await recarregar();
      if (!refazer) return telaPedidosCliente();
      if (cs.length && d.visita?.tipo === 'reposicao') { S.reabrir = { pdvId: p.id, contagens: cs, condicao: o.condicao, vencimento: o.vencimento, bonif: bon }; S.contando = p.id; S.repVolta = { aba: 'perfil', id: p.id }; irPara('reposicao'); }
      else { S.prefillVenda = { pdv: p.id, q: Object.fromEntries(d.itens.filter(i => +i.quantidade > 0).map(i => [i.produto_id, +i.quantidade])) }; S.abPdv = p.id; S.vendaVolta = { aba: 'perfil', id: p.id }; irPara('abertura'); } }; };
  $('#vpExc').onclick = () => excluir(false); $('#vpRef').onclick = () => excluir(true);
  $('#vpEdit').onclick = () => editarPedidoModal(o, d, p);
}

/* =================== pedidos =================== */
// histórico de todos os pedidos: em aberto, finalizados, cancelados, com erro no Bling e as entregas agendadas; tocar abre os detalhes
const situacaoPed = o => { const s = (o.bling_situacao || '').toLowerCase();
  if (/cancel/.test(s)) return { k: 'cancelado', n: 'Cancelado', c: 'var(--bg-bad)' };
  if (o.bling_status === 'erro' || (o.bling_status === 'pendente' && !o.bling_id)) return { k: 'erro', n: o.bling_status === 'erro' ? 'Erro no Bling' : 'Não enviado', c: 'var(--bg-bad)' };
  if (/atendid|finaliz|faturad|conclu|entregue/.test(s)) return { k: 'finalizado', n: o.bling_situacao, c: 'var(--bg-ok)' };
  if (!o.bling_id && o.bling_status !== 'importado') return { k: 'app', n: 'Só no app', c: 'var(--sand)' };
  return { k: 'aberto', n: o.bling_situacao || 'Em aberto', c: 'var(--bg-warn)' }; };
async function telaPedidos() {
  const F = S.pdF = S.pdF || { per: 'hoje', sit: '', vend: '', tipo: '', q: '' };
  const h0 = new Date(); h0.setHours(0, 0, 0, 0);
  if (!['hoje', 'mes', 'mesant', '3m', 'custom'].includes(F.per)) F.per = 'hoje';
  const de = F.per === 'hoje' ? h0 : F.per === 'mes' ? new Date(h0.getFullYear(), h0.getMonth(), 1) : F.per === 'mesant' ? new Date(h0.getFullYear(), h0.getMonth() - 1, 1) : F.per === '3m' ? new Date(h0.getFullYear(), h0.getMonth() - 3, h0.getDate() + 1) : new Date((F.de || hojeISO()) + 'T00:00');
  const ate = F.per === 'mesant' ? new Date(h0.getFullYear(), h0.getMonth(), 1) : F.per === 'custom' ? new Date(new Date((F.ate || hojeISO()) + 'T00:00').getTime() + DIA) : new Date(+h0 + DIA);
  $('#main').innerHTML = '<section class="view on"><div class="dash pnl"><div class="loading">Carregando os pedidos…</div></div></section>';
  let ls, perfis; try { [ls, perfis] = await Promise.all([db.listarPedidos(de.toISOString(), ate.toISOString()), S.perfisCache || db.perfisLista()]); S.perfisCache = perfis; } catch (e) { return erro(e); }
  const nomeP = id => (perfis.find(p => p.id === id)?.nome || '').split(' ')[0];
  const encs = Object.entries(S.base.regras.encomendas || {}).map(([id, e]) => ({ id, e, p: S.pdvs.find(x => x.id === id) })).filter(x => x.p).sort((a, b) => String(a.e.data || '').localeCompare(String(b.e.data || '')));
  const desenha = () => {
    const q = F.q.toLowerCase(), f = ls.map(o => ({ ...o, st: situacaoPed(o) })).filter(o => (!F.sit || o.st.k === F.sit) && (!F.tipo || o.tipo === F.tipo) && (!F.vend || (F.vend === 'bling' ? !o.criado_por : o.criado_por === F.vend)) && (!q || (o.pdvs?.nome || '').toLowerCase().includes(q) || String(o.numero).includes(q) || String(o.bling_pedido_id || '').includes(q)));
    // ordenar tocando no título da coluna (toque de novo inverte)
    const ORD = { data: o => o.criado_em, num: o => +(o.bling_pedido_id || 0) || +o.numero || 0, cli: o => (o.pdvs?.nome || '').toLowerCase(), tipo: o => o.tipo || '', pag: o => (o.condicao || '').toLowerCase(), vend: o => o.criado_por ? nomeP(o.criado_por).toLowerCase() : 'zz', sit: o => o.st.n.toLowerCase(), val: o => +o.valor || 0 };
    F.ord = F.ord || 'data'; if (F.desc === undefined) F.desc = true;
    f.sort((a, b) => { const x = ORD[F.ord](a), y = ORD[F.ord](b); return (x < y ? -1 : x > y ? 1 : 0) * (F.desc ? -1 : 1); });
    const th = (k, n, st = '') => `<th data-ord="${k}" style="cursor:pointer;user-select:none;${st}" title="Ordenar">${n}${F.ord === k ? (F.desc ? ' ▼' : ' ▲') : ''}</th>`;
    const cont = k => ls.filter(o => situacaoPed(o).k === k).length, tot = f.filter(o => o.st.k !== 'cancelado').reduce((a, o) => a + (+o.valor || 0), 0);
    $('#pdCorpo').innerHTML = `<div class="row" style="gap:6px;flex-wrap:wrap">${[['', 'Todos', ls.length], ['aberto', 'Em aberto', cont('aberto')], ['finalizado', 'Finalizados', cont('finalizado')], ['app', 'Só no app', cont('app')], ['erro', 'Erro / não enviado', cont('erro')], ['cancelado', 'Cancelados', cont('cancelado')]].map(([k, n, c]) => `<button class="mini ${F.sit === k ? 'on' : ''}" data-st="${k}">${n} (${c})</button>`).join('')}</div>
     <div class="kpis"><div class="kpi"><small>Pedidos</small><b>${f.length}</b></div><div class="kpi"><small>Valor (sem cancelados)</small><b>${brl(tot)}</b></div><div class="kpi"><small>Ticket médio</small><b>${f.length ? brl(tot / Math.max(1, f.filter(o => o.st.k !== 'cancelado').length)) : '—'}</b></div><div class="kpi"><small>Unidades</small><b>${fmt(f.filter(o => o.st.k !== 'cancelado').reduce((a, o) => a + (+o.unidades || 0), 0))}</b></div></div>
     ${encs.length && !F.sit ? `<div class="panel"><h3>📦 Entregas agendadas (${encs.length})</h3><p class="psub">Pedidos salvos para entrega: viram pedido quando você fechar no cliente</p><table class="dped"><tr><th>Entrega</th><th>Cliente</th><th>Tipo</th><th>Por</th><th></th></tr>${encs.map(x => `<tr><td>${x.e.data ? dstr(x.e.data + 'T12:00') : 'sem data'}${x.e.periodo && x.e.periodo !== 'dia_todo' ? ' · ' + PERIODOS_ENT[x.e.periodo].toLowerCase() : ''}</td><td><a href="#" data-cli="${x.id}"><b>${esc(x.p.nome)}</b></a></td><td>${x.e.tipo === 'venda' ? 'Venda' : 'Reposição'}${x.e.origem ? ' · ' + ORIGENS[x.e.origem] : ''}</td><td>${esc(x.e.por || '')}</td><td><button class="mini" data-abre="${x.id}" data-tp="${x.e.tipo}">abrir</button></td></tr>`).join('')}</table></div>` : ''}
     <div class="panel" style="overflow-x:auto">${f.length ? `<table class="dped"><tr>${th('data', 'Data')}${th('num', 'Nº')}${th('cli', 'Cliente')}${th('tipo', 'Tipo')}${th('pag', 'Pagamento')}${th('vend', 'Vendedor')}${th('sit', 'Situação')}${th('val', 'Valor', 'text-align:right')}</tr>${f.map(o => `<tr class="lnk" data-ped="${o.id}" data-pdv="${o.pdv_id}"><td>${new Date(o.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })}<br><small style="color:var(--mute)">${new Date(o.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></td>
       <td>${o.bling_pedido_id ? 'Bling ' + esc(o.bling_pedido_id) : ''}${o.criado_por ? `<br><small style="color:var(--mute)">app ${o.numero}</small>` : ''}</td><td><b>${esc(o.pdvs?.nome || '—')}</b>${o.pdvs?.bairro ? `<br><small style="color:var(--mute)">${esc(o.pdvs.bairro)}</small>` : ''}</td>
       <td>${o.tipo === 'abertura' ? 'Abertura' : 'Reposição'}</td><td>${esc(o.condicao || '—')}${o.vencimento ? `<br><small style="color:var(--mute)">vence ${dstr(o.vencimento + 'T12:00')}</small>` : ''}</td><td>${o.criado_por ? esc(nomeP(o.criado_por)) : '<small style="color:var(--mute)">Bling</small>'}</td>
       <td><span class="badge" style="background:${o.st.c}" title="${esc(o.bling_erro || '')}">${esc(o.st.n)}</span></td><td style="text-align:right"><b>${brl(+o.valor || 0)}</b><br><small style="color:var(--mute)">${fmt(+o.unidades || 0)} un.</small></td></tr>`).join('')}</table>` : '<p class="empty">Nenhum pedido com esses filtros.</p>'}</div>`;
    document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { F.sit = b.dataset.st; desenha(); });
    document.querySelectorAll('th[data-ord]').forEach(t => t.onclick = () => { if (F.ord === t.dataset.ord) F.desc = !F.desc; else { F.ord = t.dataset.ord; F.desc = ['data', 'num', 'val'].includes(F.ord); } desenha(); });
    document.querySelectorAll('tr[data-ped]').forEach(tr => tr.onclick = () => { const p = S.pdvs.find(x => x.id === tr.dataset.pdv) || { id: tr.dataset.pdv, nome: ls.find(o => o.id === tr.dataset.ped)?.pdvs?.nome || 'Cliente' }; verPedido(tr.dataset.ped, p); });
    document.querySelectorAll('[data-cli]').forEach(a => a.onclick = e => { e.preventDefault(); abrirPerfil(a.dataset.cli); });
    document.querySelectorAll('[data-abre]').forEach(b => b.onclick = () => { const id = b.dataset.abre; if (b.dataset.tp === 'venda') { S.abPdv = id; S.vendaVolta = { aba: 'pedidos' }; irPara('abertura'); } else { S.contando = id; S.repVolta = { aba: 'pedidos' }; irPara('reposicao'); } });
  };
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl">
   <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
    <div><label class="lb">Período</label><select id="pdPer">${[['hoje', 'Dia'], ['mes', 'Mês'], ['mesant', 'Mês passado'], ['3m', 'Últimos 3 meses'], ['custom', 'Personalizado']].map(([k, n]) => `<option value="${k}" ${F.per === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    ${F.per === 'custom' ? `<div><label class="lb">&nbsp;</label><button class="btn" id="pdCal">📅 ${dstr((F.de || hojeISO()) + 'T12:00')} – ${dstr((F.ate || hojeISO()) + 'T12:00')}</button></div>` : ''}
    <div><label class="lb">Tipo</label><select id="pdTipo"><option value="">Todos</option><option value="abertura" ${F.tipo === 'abertura' ? 'selected' : ''}>Abertura</option><option value="reposicao" ${F.tipo === 'reposicao' ? 'selected' : ''}>Reposição</option></select></div>
    <div><label class="lb">Vendedor</label><select id="pdVend"><option value="">Todos</option>${perfis.map(p => `<option value="${p.id}" ${F.vend === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}<option value="bling" ${F.vend === 'bling' ? 'selected' : ''}>Lançados no Bling</option></select></div>
    <div style="flex:1;min-width:180px"><label class="lb">Buscar</label><input id="pdQ" placeholder="Cliente ou número do pedido" value="${esc(F.q)}" style="width:100%"></div>
    <button class="btn pri" id="pdNova">+ Cadastrar venda</button></div><div id="pdCorpo"></div></div></section>`;
  $('#pdPer').onchange = e => { F.per = e.target.value; if (F.per === 'custom' && !F.de) { F.de = isoDe(new Date(Date.now() - 6 * DIA)); F.ate = hojeISO(); } telaPedidos(); if (F.per === 'custom') setTimeout(() => $('#pdCal')?.click(), 60); };
  if ($('#pdCal')) $('#pdCal').onclick = e => { e.stopPropagation(); calendarioFaixa($('#pdCal'), F.de, F.ate, (a, b) => { F.de = a; F.ate = b; telaPedidos(); }); };
  $('#pdTipo').onchange = e => { F.tipo = e.target.value; desenha(); }; $('#pdVend').onchange = e => { F.vend = e.target.value; desenha(); }; $('#pdQ').oninput = e => { F.q = e.target.value; desenha(); };
  $('#pdNova').onclick = () => irPara('abertura');
  desenha();
}

/* =================== financeiro (integrado ao Bling) =================== */
// contas a receber, contas a pagar e caixas e bancos: leitura direto do Bling; criar conta, baixa total e lançamento no caixa gravam lá
const FIN = { nomes: (() => { try { return JSON.parse(localStorage.getItem('jg-fin-nomes') || '{}'); } catch (e) { return {}; } })() };
const SIT_FIN = { receber: { 1: 'Em aberto', 2: 'Recebido', 3: 'Parcial', 4: 'Devolvido', 5: 'Cancelado' }, pagar: { 1: 'Em aberto', 2: 'Pago', 3: 'Parcial', 4: 'Cancelado', 5: 'Cancelado' } };
const finLer = (caminho, paginas) => db.bling('fin_listar', { caminho, paginas }).then(r => r?.data || []);
const finUm = caminho => db.bling('ler', { caminho }).then(r => r?.data || r);
const finEsc = (metodo, caminho, corpo) => db.bling('fin_escrever', { metodo, caminho, corpo });
const val = x => +(x ?? 0) || 0;
const nomeContato = c => { if (!c) return '—'; if (c.nome) return c.nome; const p = S.pdvs.find(x => String(x.bling_contato_id) === String(c.id)); return p?.nome || FIN.nomes[c.id] || 'Contato #' + c.id; };
async function resolverNomes(ls) {
  const faltam = [...new Set(ls.map(x => x.contato?.id).filter(id => id && !ls.find(y => y.contato?.id === id && y.contato?.nome) && !S.pdvs.some(p => String(p.bling_contato_id) === String(id)) && !FIN.nomes[id]))].slice(0, 25);
  for (const id of faltam) { try { const c = await finUm('/contatos/' + id); if (c?.nome) FIN.nomes[id] = c.nome; } catch (e) { } }
  try { localStorage.setItem('jg-fin-nomes', JSON.stringify(FIN.nomes)); } catch (e) { }
}
async function finCadastros() {
  if (!FIN.contas) FIN.contas = await finLer('/contas-contabeis', 3).catch(() => []);
  if (!FIN.cats) FIN.cats = await finLer('/categorias/receitas-despesas', 5).catch(() => []);
  if (!FIN.formas) FIN.formas = await finLer('/formas-pagamentos', 3).catch(() => []);
}
const erroFin = e => { const m = String(e.message || e);
  if (/insufficient_scope|\(403\)/.test(m)) return `<div class="panel"><h3>O Bling ainda não deu permissão para esta parte</h3><p>O app conectado ao Bling não tem a permissão (escopo) de <b>Caixas e bancos</b>. No Bling: <b>Central de extensões → Área do integrador → seu aplicativo → Escopos</b>, marque <b>Caixas e bancos</b> (e <b>Contas a pagar/receber</b>, se não estiverem), salve e depois reconecte o Bling em <b>Regras e metas</b>.</p><small style="color:var(--mute)">${esc(m.slice(0, 200))}</small></div>`; if (/não permitido|desconhecida/.test(m)) return `<div class="panel"><h3>Falta publicar a função do Bling</h3><p>Para o financeiro funcionar, a função <b>bling-oauth</b> no Supabase precisa ser atualizada com a versão nova (Edge Functions → bling-oauth → colar o código → Deploy).</p><small style="color:var(--mute)">${esc(m)}</small></div>`; return `<div class="panel"><h3>Não consegui ler do Bling</h3><p style="color:var(--t-bad)">${esc(m)}</p></div>`; };
function finPeriodo(k) { const h = new Date(), iso = d => isoDe(d); FIN[k] = FIN[k] || { de: iso(new Date(h.getFullYear(), h.getMonth() - 2, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth() + 2, 0)), sit: 'abertos' }; return FIN[k]; }
async function telaContas(tipo) { // tipo: 'receber' | 'pagar'
  const F = finPeriodo(tipo), rec = tipo === 'receber';
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl"><div class="loading">Lendo as contas a ${tipo} no Bling…</div></div></section>`;
  let ls; try { ls = await finLer(`/contas/${tipo}?dataVencimentoInicial=${F.de}&dataVencimentoFinal=${F.ate}`, 20); await resolverNomes(ls); } catch (e) { return $('#main .dash').innerHTML = erroFin(e); }
  FIN['ls_' + tipo] = ls;
  // no Bling a conta a receber só nasce quando o pedido é atendido/lançado; os pedidos em aberto aparecem aqui como "previsto"
  let prev = []; if (rec) { try { prev = (await db.listarPedidos(new Date(Date.now() - 180 * DIA).toISOString(), new Date(Date.now() + DIA).toISOString())).filter(o => o.bling_id && /em aberto/i.test(o.bling_situacao || '') && !ls.some(x => String(x.origem?.id) === String(o.bling_id))); } catch (e) { } }
  const hoje0 = hojeISO(), aberto = x => [1, 3].includes(+x.situacao), em7 = isoDe(new Date(Date.now() + 7 * DIA));
  const desenha = () => {
    const q = (FIN['q_' + tipo] || '').toLowerCase();
    const f = ls.filter(x => (F.sit === 'todos' || (F.sit === 'abertos' ? aberto(x) : F.sit === 'vencidos' ? aberto(x) && x.vencimento < hoje0 : !aberto(x) && [2].includes(+x.situacao))) && (!q || nomeContato(x.contato).toLowerCase().includes(q)))
      .sort((a, b) => a.vencimento < b.vencimento ? -1 : 1);
    const soma = a => a.reduce((s, x) => s + val(x.saldo ?? x.valor), 0), abertos = ls.filter(aberto);
    const venc = abertos.filter(x => x.vencimento < hoje0), prox = abertos.filter(x => x.vencimento >= hoje0 && x.vencimento <= em7), quit = ls.filter(x => +x.situacao === 2);
    $('#finCorpo').innerHTML = `<div class="kpis"><div class="kpi"><small>Em aberto</small><b>${brl(soma(abertos))}</b><small class="sub">${abertos.length} contas no período</small></div>
      <div class="kpi"><small>Vencido</small><b style="color:${venc.length ? 'var(--t-bad)' : 'inherit'}">${brl(soma(venc))}</b><small class="sub">${venc.length} conta${venc.length === 1 ? '' : 's'}</small></div>
      <div class="kpi"><small>Vence em 7 dias</small><b>${brl(soma(prox))}</b><small class="sub">${prox.length} conta${prox.length === 1 ? '' : 's'}</small></div>
      <div class="kpi"><small>${rec ? 'Recebido' : 'Pago'} no período</small><b>${brl(quit.reduce((s, x) => s + val(x.valor), 0))}</b><small class="sub">${quit.length} conta${quit.length === 1 ? '' : 's'}</small></div></div>
     ${rec && prev.length ? `<div class="panel" style="overflow-x:auto"><h3>Previsto: pedidos em aberto no Bling (${prev.length}) · ${brl(prev.reduce((a, o) => a + (+o.valor || 0), 0))}</h3><p class="psub">Ainda não viraram conta a receber no Bling: a conta é criada quando o pedido é atendido ou quando as contas são lançadas no pedido.</p>
       <table class="dped"><tr><th>Vencimento</th><th>Cliente</th><th>Pedido</th><th>Pagamento</th><th style="text-align:right">Valor</th></tr>${prev.sort((a, b) => String(a.vencimento || a.criado_em).localeCompare(String(b.vencimento || b.criado_em))).map(o => `<tr class="lnk" data-pprev="${o.id}" data-pdv="${o.pdv_id}"><td>${o.vencimento ? dstr(o.vencimento + 'T12:00') : '<small style="color:var(--mute)">sem vencimento</small>'}</td><td>${esc(o.pdvs?.nome || '—')}</td><td>Bling ${esc(o.bling_pedido_id || '')} · ${new Date(o.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</td><td>${esc(o.condicao || '—')}</td><td style="text-align:right"><b>${brl(+o.valor || 0)}</b></td></tr>`).join('')}</table></div>` : ''}
     <div class="panel" style="overflow-x:auto">${f.length ? `<table class="dped"><tr><th>Vencimento</th><th>${rec ? 'Cliente' : 'Fornecedor'}</th><th>Valor</th><th>Situação</th><th></th></tr>${f.map(x => { const atr = aberto(x) && x.vencimento < hoje0;
       return `<tr class="lnk" data-fid="${x.id}"><td style="${atr ? 'color:var(--t-bad);font-weight:600' : ''}">${dstr(x.vencimento + 'T12:00')}${atr ? `<br><small>${Math.floor((new Date(hoje0) - new Date(x.vencimento)) / DIA)} dias atrasado</small>` : ''}</td><td>${esc(nomeContato(x.contato))}</td><td><b>${brl(val(x.valor))}</b></td>
        <td><span class="badge" style="background:${+x.situacao === 2 ? 'var(--bg-ok)' : atr ? 'var(--bg-bad)' : aberto(x) ? 'var(--bg-warn)' : 'var(--sand)'}">${SIT_FIN[tipo][x.situacao] || x.situacao}</span></td>
        <td>${aberto(x) ? `<button class="mini" data-baixa="${x.id}">${rec ? 'Receber' : 'Pagar'}</button>` : ''}</td></tr>`; }).join('')}</table>` : '<p class="empty">Nenhuma conta com esses filtros.</p>'}</div>`;
    document.querySelectorAll('[data-fid]').forEach(tr => tr.onclick = e => { if (e.target.closest('[data-baixa]')) return; detalheConta(tipo, tr.dataset.fid); });
    document.querySelectorAll('[data-baixa]').forEach(b => b.onclick = () => baixarConta(tipo, b.dataset.baixa));
    document.querySelectorAll('[data-pprev]').forEach(tr => tr.onclick = () => verPedido(tr.dataset.pprev, S.pdvs.find(x => x.id === tr.dataset.pdv) || { id: tr.dataset.pdv, nome: 'Cliente' }));
  };
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl">
   <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">
    <div><label class="lb">Vencimento de</label><input type="date" id="fDe" value="${F.de}"></div><div><label class="lb">até</label><input type="date" id="fAte" value="${F.ate}"></div>
    <div><label class="lb">Mostrar</label><select id="fSit">${[['abertos', 'Em aberto'], ['vencidos', 'Vencidos'], ['quitados', rec ? 'Recebidos' : 'Pagos'], ['todos', 'Todos']].map(([k, n]) => `<option value="${k}" ${F.sit === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div><label class="lb">Buscar</label><input id="fQ" placeholder="${rec ? 'Cliente' : 'Fornecedor'}…" value="${esc(FIN['q_' + tipo] || '')}"></div>
    <button class="btn" id="fRec" title="Ler de novo do Bling">↻</button><button class="btn pri" id="fNova" style="margin-left:auto">+ Nova conta a ${tipo}</button></div>
   <div id="finCorpo"></div><small style="color:var(--mute)">Dados lidos do Bling agora. Toque numa conta para ver os detalhes.</small></div></section>`;
  $('#fDe').onchange = $('#fAte').onchange = () => { F.de = $('#fDe').value; F.ate = $('#fAte').value; telaContas(tipo); };
  $('#fSit').onchange = e => { F.sit = e.target.value; desenha(); }; $('#fQ').oninput = e => { FIN['q_' + tipo] = e.target.value; desenha(); };
  $('#fRec').onclick = () => telaContas(tipo); $('#fNova').onclick = () => novaConta(tipo);
  desenha();
}
async function detalheConta(tipo, id) {
  modal('<div class="loading">Abrindo a conta no Bling…</div>');
  let c; try { c = await finUm(`/contas/${tipo}/${id}`); await finCadastros(); } catch (e) { fecharModal(); return erro(e); }
  const nm = (ls, x) => x?.id ? (ls.find(y => String(y.id) === String(x.id))?.descricao || ls.find(y => String(y.id) === String(x.id))?.nome || '#' + x.id) : '—';
  const lin = (n, v) => v == null || v === '' ? '' : `<tr><td style="color:var(--mute)">${n}</td><td>${v}</td></tr>`;
  modal(`<h3 style="margin-top:0">Conta a ${tipo} · ${esc(nomeContato(c.contato))}</h3><table class="dped">
   ${lin('Situação', SIT_FIN[tipo][c.situacao] || c.situacao)}${lin('Valor', brl(val(c.valor)))}${c.saldo != null ? lin('Saldo', brl(val(c.saldo))) : ''}${lin('Vencimento', c.vencimento ? dstr(c.vencimento + 'T12:00') : '')}
   ${lin('Emissão', c.dataEmissao ? dstr(c.dataEmissao + 'T12:00') : '')}${lin('Competência', c.competencia ? dstr(c.competencia + 'T12:00') : '')}${lin('Documento', esc(c.numeroDocumento || ''))}${lin('Histórico', esc(c.historico || ''))}
   ${lin('Categoria', esc(nm(FIN.cats, c.categoria)))}${lin('Conta financeira', esc(nm(FIN.contas, c.portador || c.contaContabil)))}${lin('Forma de pagamento', esc(nm(FIN.formas, c.formaPagamento)))}${c.origem?.numero ? lin('Origem', esc((c.origem.tipoOrigem || '') + ' ' + c.origem.numero)) : ''}${c.linkBoleto ? lin('Boleto', `<a href="${esc(c.linkBoleto)}" target="_blank" rel="noopener">abrir ↗</a>`) : ''}${c.linkQRCodePix ? lin('Pix', `<a href="${esc(c.linkQRCodePix)}" target="_blank" rel="noopener">QR Code ↗</a>`) : ''}</table>
   <div class="row" style="margin-top:14px;justify-content:space-between"><span>${[1, 3].includes(+c.situacao) ? `<button class="btn car" id="dcBaixa">${tipo === 'receber' ? 'Receber' : 'Pagar'} (baixa total)</button>` : ''}</span><button class="btn pri" onclick="fecharModal()">Fechar</button></div>`);
  if ($('#dcBaixa')) $('#dcBaixa').onclick = () => baixarConta(tipo, id, c);
}
const opcoes = (ls, sel, vazio) => `<option value="">${vazio}</option>` + ls.map(x => `<option value="${x.id}" ${String(sel) === String(x.id) ? 'selected' : ''}>${esc(x.descricao || x.nome || '#' + x.id)}</option>`).join('');
const catsDo = tipo => (FIN.cats || []).filter(c => !c.tipo || (tipo === 'receber' ? [1, 'R', 'receita'].includes(c.tipo) || /receita/i.test(c.tipo) : [2, 'D', 'despesa'].includes(c.tipo) || /despesa/i.test(c.tipo)));
async function baixarConta(tipo, id, c) {
  modal('<div class="loading">Preparando a baixa…</div>');
  try { c = c || await finUm(`/contas/${tipo}/${id}`); await finCadastros(); } catch (e) { fecharModal(); return erro(e); }
  const saldo = val(c.saldo ?? c.valor), rec = tipo === 'receber';
  modal(`<h3 style="margin-top:0">${rec ? 'Receber' : 'Pagar'} · ${esc(nomeContato(c.contato))}</h3>
   <p style="margin:0">Baixa <b>total</b> de <b>${brl(saldo)}</b> (vencimento ${c.vencimento ? dstr(c.vencimento + 'T12:00') : '—'}).</p>
   <div class="row" style="gap:10px;flex-wrap:wrap"><div><label>Data do ${rec ? 'recebimento' : 'pagamento'}</label><input type="date" id="bxD" value="${hojeISO()}"></div>
    <div style="flex:1;min-width:200px"><label>Conta financeira</label><select id="bxC">${opcoes(FIN.contas || [], c.portador?.id ?? c.contaContabil?.id, '— escolha —')}</select></div></div>
   <label>Categoria</label><select id="bxCat">${opcoes(catsDo(tipo), c.categoria?.id, '— sem categoria —')}</select>
   <label>Histórico</label><input id="bxH" value="${esc(c.historico || '')}" style="width:100%">
   <p style="font-size:12px;color:var(--mute)">Baixa parcial: faça direto no Bling (a API do Bling já quitou contas inteiras quando recebeu valor parcial).</p>
   <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="bxOk">Confirmar ${rec ? 'recebimento' : 'pagamento'} de ${brl(saldo)}</button></div>`);
  $('#bxOk').onclick = async () => { if (!$('#bxC').value) return toast('Escolha a conta financeira'); $('#bxOk').disabled = true;
    const corpo = { data: $('#bxD').value, valor: saldo, valorPago: saldo, valorRecebido: saldo, portador: { id: +$('#bxC').value }, ...($('#bxCat').value ? { categoria: { id: +$('#bxCat').value } } : {}), historico: $('#bxH').value.trim() || undefined };
    try { await finEsc('POST', `/contas/${tipo}/${id}/baixar`, corpo); fecharModal(); toast(`${rec ? 'Recebimento' : 'Pagamento'} de ${brl(saldo)} baixado no Bling`); telaContas(tipo); }
    catch (e) { $('#bxOk').disabled = false; modal(`<h3>O Bling recusou a baixa</h3><p style="font-size:13px;color:var(--t-bad)">${esc(e.message)}</p><div class="row" style="justify-content:flex-end"><button class="btn pri" onclick="fecharModal()">Ok</button></div>`); } };
}
async function novaConta(tipo) {
  modal('<div class="loading">Carregando cadastros do Bling…</div>'); try { await finCadastros(); } catch (e) { } const rec = tipo === 'receber';
  modal(`<h3 style="margin-top:0">Nova conta a ${tipo}</h3>
   <label>${rec ? 'Cliente' : 'Fornecedor'} (cadastro no Bling)</label><div class="mbusca"><input id="ncQ" placeholder="Digite o nome e escolha" autocomplete="off"><div class="sugs" id="ncS"></div></div><input type="hidden" id="ncId">
   <div class="row" style="gap:10px;flex-wrap:wrap"><div><label>Valor</label><input type="number" step="0.01" min="0" id="ncV" style="width:120px"></div><div><label>Vencimento</label><input type="date" id="ncVen" value="${hojeISO()}"></div><div><label>Competência</label><input type="date" id="ncComp" value="${hojeISO()}"></div><div><label>Nº documento</label><input id="ncDoc" style="width:120px"></div></div>
   <label>Categoria</label><select id="ncCat">${opcoes(catsDo(tipo), '', '— escolha —')}</select>
   <div class="row" style="gap:10px;flex-wrap:wrap"><div style="flex:1"><label>Conta financeira</label><select id="ncPort">${opcoes(FIN.contas || [], '', '— opcional —')}</select></div><div style="flex:1"><label>Forma de pagamento</label><select id="ncForma">${opcoes(FIN.formas || [], '', '— opcional —')}</select></div></div>
   <label>Histórico</label><input id="ncH" style="width:100%" placeholder="${rec ? 'Ex.: venda balcão' : 'Ex.: compra Baccaro, aluguel, combustível'}">
   <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="ncOk">Lançar no Bling</button></div>`);
  let tmr; $('#ncQ').oninput = () => { clearTimeout(tmr); $('#ncId').value = ''; const q = $('#ncQ').value.trim(); if (q.length < 2) { $('#ncS').style.display = 'none'; return; }
    const loc = rec ? S.pdvs.filter(p => p.bling_contato_id && p.nome.toLowerCase().includes(q.toLowerCase())).slice(0, 6).map(p => ({ id: p.bling_contato_id, nome: p.nome })) : [];
    const pinta = ls => { $('#ncS').innerHTML = ls.map(c => `<div data-ci="${c.id}" data-cn="${esc(c.nome)}"><b>${esc(c.nome)}</b>${c.numeroDocumento ? ' <small>' + esc(c.numeroDocumento) + '</small>' : ''}</div>`).join('') || '<div><small>Nada encontrado</small></div>'; $('#ncS').style.display = 'block';
      $('#ncS').querySelectorAll('[data-ci]').forEach(d => d.onmousedown = () => { $('#ncId').value = d.dataset.ci; $('#ncQ').value = d.dataset.cn; $('#ncS').style.display = 'none'; }); };
    pinta(loc); tmr = setTimeout(async () => { try { const r = await finUm('/contatos?pesquisa=' + encodeURIComponent(q) + '&limite=10'); const ls = [...loc, ...(Array.isArray(r) ? r : []).filter(c => !loc.some(l => String(l.id) === String(c.id)))]; if ($('#ncQ')?.value.trim() === q) pinta(ls); } catch (e) { } }, 450); };
  $('#ncOk').onclick = async () => { const v = +$('#ncV').value; if (!$('#ncId').value) return toast('Escolha o ' + (rec ? 'cliente' : 'fornecedor') + ' na lista'); if (!(v > 0)) return toast('Coloque o valor');
    const corpo = { contato: { id: +$('#ncId').value }, valor: v, vencimento: $('#ncVen').value, competencia: $('#ncComp').value || undefined, dataEmissao: hojeISO(), numeroDocumento: $('#ncDoc').value.trim() || undefined, historico: $('#ncH').value.trim() || undefined,
      ...($('#ncCat').value ? { categoria: { id: +$('#ncCat').value } } : {}), ...($('#ncPort').value ? { portador: { id: +$('#ncPort').value } } : {}), ...($('#ncForma').value ? { formaPagamento: { id: +$('#ncForma').value } } : {}) };
    $('#ncOk').disabled = true;
    try { await finEsc('POST', `/contas/${tipo}`, corpo); fecharModal(); toast(`Conta a ${tipo} de ${brl(v)} lançada no Bling`); telaContas(tipo); }
    catch (e) { $('#ncOk').disabled = false; toast('O Bling recusou: ' + e.message.slice(0, 160)); } };
}
async function telaCaixas() {
  const F = FIN.cx = FIN.cx || { de: isoDe(new Date(Date.now() - 30 * DIA)), ate: hojeISO(), conta: '' };
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl"><div class="loading">Lendo caixas e bancos no Bling…</div></div></section>`;
  let ls; try { await finCadastros(); ls = await finLer(`/caixas?dataInicial=${F.de}&dataFinal=${F.ate}${F.conta ? '&idContaFinanceira=' + F.conta : ''}`, 20); } catch (e) { return $('#main .dash').innerHTML = erroFin(e); }
  const sinal = x => { const t = String(x.debitoCredito ?? x.tipo ?? '').toUpperCase(); return t.startsWith('D') || t === '2' || t === 'S' ? -1 : 1; };
  const contaDe = x => x.contaFinanceira?.id ?? x.contaContabil?.id ?? x.portador?.id;
  const f = ls.filter(x => !F.conta || String(contaDe(x)) === String(F.conta)).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const ent = f.filter(x => sinal(x) > 0).reduce((s, x) => s + val(x.valor), 0), sai = f.filter(x => sinal(x) < 0).reduce((s, x) => s + val(x.valor), 0);
  const porConta = {}; f.forEach(x => { const k = contaDe(x) || '-'; porConta[k] = (porConta[k] || 0) + sinal(x) * val(x.valor); });
  const nmC = id => (FIN.contas || []).find(c => String(c.id) === String(id))?.descricao || (id === '-' ? 'Sem conta' : '#' + id);
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl">
   <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end"><div><label class="lb">De</label><input type="date" id="cxDe" value="${F.de}"></div><div><label class="lb">até</label><input type="date" id="cxAte" value="${F.ate}"></div>
    <div><label class="lb">Conta</label><select id="cxConta">${opcoes(FIN.contas || [], F.conta, 'Todas as contas')}</select></div><button class="btn" id="cxRec">↻</button><button class="btn pri" id="cxNovo" style="margin-left:auto">+ Lançamento</button></div>
   <div class="kpis"><div class="kpi"><small>Entradas</small><b style="color:var(--t-ok)">${brl(ent)}</b></div><div class="kpi"><small>Saídas</small><b style="color:var(--t-bad)">${brl(sai)}</b></div><div class="kpi"><small>Resultado do período</small><b>${brl(ent - sai)}</b></div><div class="kpi"><small>Lançamentos</small><b>${f.length}</b></div></div>
   ${Object.keys(porConta).length > 1 ? `<div class="panel"><h3>Movimento por conta</h3>${ranking(Object.entries(porConta).map(([k, v]) => ({ n: nmC(k), v, c: v >= 0 ? COR.bom : COR.ruim })), 'R$')}</div>` : ''}
   <div class="panel" style="overflow-x:auto">${f.length ? `<table class="dped"><tr><th>Data</th><th>Histórico</th><th>Conta</th><th>Categoria</th><th style="text-align:right">Valor</th></tr>${f.map(x => `<tr><td>${x.data ? dstr(String(x.data).slice(0, 10) + 'T12:00') : '—'}</td><td>${esc(x.historico || x.descricao || '')}</td><td>${esc(nmC(contaDe(x) || '-'))}</td><td>${esc((FIN.cats || []).find(c => String(c.id) === String(x.categoria?.id))?.descricao || '')}</td><td style="text-align:right;font-weight:600;color:${sinal(x) > 0 ? 'var(--t-ok)' : 'var(--t-bad)'}">${sinal(x) > 0 ? '+' : '−'} ${brl(val(x.valor))}</td></tr>`).join('')}</table>` : '<p class="empty">Nenhum lançamento no período.</p>'}</div>
   <small style="color:var(--mute)">Lido do Bling agora (Financeiro → Caixas e bancos).</small></div></section>`;
  $('#cxDe').onchange = $('#cxAte').onchange = () => { F.de = $('#cxDe').value; F.ate = $('#cxAte').value; telaCaixas(); }; $('#cxConta').onchange = e => { F.conta = e.target.value; telaCaixas(); };
  $('#cxRec').onclick = () => telaCaixas();
  $('#cxNovo').onclick = () => { modal(`<h3 style="margin-top:0">Novo lançamento no caixa</h3><div class="nbol" id="lxT"><button type="button" data-t="C" class="on">Entrada</button><button type="button" data-t="D">Saída</button></div>
    <div class="row" style="gap:10px;flex-wrap:wrap"><div><label>Data</label><input type="date" id="lxD" value="${hojeISO()}"></div><div><label>Valor</label><input type="number" step="0.01" min="0" id="lxV" style="width:120px"></div><div style="flex:1;min-width:180px"><label>Conta</label><select id="lxC">${opcoes(FIN.contas || [], F.conta, '— escolha —')}</select></div></div>
    <label>Categoria</label><select id="lxCat">${opcoes(FIN.cats || [], '', '— sem categoria —')}</select><label>Histórico</label><input id="lxH" style="width:100%">
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="lxOk">Lançar no Bling</button></div>`);
    document.querySelectorAll('#lxT [data-t]').forEach(b => b.onclick = () => document.querySelectorAll('#lxT [data-t]').forEach(x => x.classList.toggle('on', x === b)));
    $('#lxOk').onclick = async () => { const v = +$('#lxV').value; if (!(v > 0)) return toast('Coloque o valor'); if (!$('#lxC').value) return toast('Escolha a conta'); if (!$('#lxH').value.trim()) return toast('Escreva o histórico');
      const t = document.querySelector('#lxT .on').dataset.t; $('#lxOk').disabled = true;
      try { await finEsc('POST', '/caixas', { data: $('#lxD').value, valor: v, debitoCredito: t, contaFinanceira: { id: +$('#lxC').value }, contaContabil: { id: +$('#lxC').value }, historico: $('#lxH').value.trim(), ...($('#lxCat').value ? { categoria: { id: +$('#lxCat').value } } : {}) });
        fecharModal(); toast('Lançamento feito no Bling'); telaCaixas(); } catch (e) { $('#lxOk').disabled = false; toast('O Bling recusou: ' + e.message.slice(0, 160)); } }; };
}

/* =================== estoque =================== */
// saldo por produto no depósito e no carro de cada um; entradas de compra, carga/devolução do carro, perdas e inventário.
// As reposições e vendas baixam sozinhas do carro de quem fez (vendido, bonificado e trocado).
const TIPOS_EST = { compra: 'Compra', carga: 'Carga do carro', retorno: 'Devolução do carro', venda: 'Venda', bonificacao: 'Bonificação', troca: 'Troca', perda: 'Perda / vencido', ajuste: 'Ajuste de inventário' };
const EST = {};
const nomeProd = p => `${(p.linha || '').split(' ')[0]} ${p.sabor}`;
async function telaEstoque() {
  $('#main').innerHTML = '<section class="view on"><div class="loading">Carregando o estoque…</div></section>';
  try { [EST.movs, EST.perfis] = await Promise.all([db.estoqueMovs(), db.perfisLista()]); }
  catch (e) { if (/estoque_mov/.test(e.message || '')) return $('#main').innerHTML = `<section class="view on"><div class="dash pnl"><div class="panel"><h3>Falta criar a tabela do estoque</h3><p>Rode o <b>034_estoque.sql</b> no Supabase (SQL Editor → colar → Run) e abra esta aba de novo.</p></div></div></section>`; return erro(e); }
  desenharEstoque();
}
function calcEstoque() {
  const prods = S.base.produtos, locais = ['deposito', ...EST.perfis.map(p => 'carro:' + p.id)], sal = {}, agora = Date.now();
  prods.forEach(p => { sal[p.id] = {}; locais.forEach(l => sal[p.id][l] = 0); });
  let primeiro = agora; const saiu = {}, ultCusto = {};
  EST.movs.forEach(m => { const t = new Date(m.em).getTime(); if (t < primeiro) primeiro = t; if (!sal[m.produto_id]) return; sal[m.produto_id][m.local] = (sal[m.produto_id][m.local] || 0) + +m.qtd;
    if (['venda', 'bonificacao', 'troca'].includes(m.tipo) && t > agora - 56 * DIA) saiu[m.produto_id] = (saiu[m.produto_id] || 0) - +m.qtd;
    if (m.tipo === 'compra' && m.custo_unit && (!ultCusto[m.produto_id] || t > ultCusto[m.produto_id].t)) ultCusto[m.produto_id] = { t, v: +m.custo_unit }; });
  const semanas = Math.max(1, Math.min(8, (agora - primeiro) / (7 * DIA))), min = S.base.regras.estoque_min || {};
  const linhas = prods.map(p => { const tot = Object.values(sal[p.id]).reduce((a, b) => a + b, 0), sem = (saiu[p.id] || 0) / semanas, cob = sem > 0 ? tot / (sem / 7) : null;
    const mn = min[p.id] != null ? +min[p.id] : Math.ceil(sem * 2), custo = ultCusto[p.id]?.v ?? +p.custo ?? 0;
    return { p, sal: sal[p.id], tot, sem, cob, mn, custo, st: tot <= 0 ? 'zerado' : tot < mn ? 'comprar' : 'ok' }; });
  const hoje0 = hojeISO(), em15 = isoDe(new Date(agora + 15 * DIA));
  const lotes = EST.movs.filter(m => m.tipo === 'compra' && m.validade && m.validade <= em15 && sal[m.produto_id] && Object.values(sal[m.produto_id]).reduce((a, b) => a + b, 0) > 0).sort((a, b) => a.validade < b.validade ? -1 : 1);
  return { locais, linhas, lotes, hoje0 };
}
const nomeLocal = l => l === 'deposito' ? 'Depósito' : 'Carro ' + ((EST.perfis.find(p => 'carro:' + p.id === l)?.nome || '?').split(' ')[0]);
function desenharEstoque() {
  const C = calcEstoque(), L = C.linhas, tot = L.reduce((a, x) => a + Math.max(0, x.tot), 0), val = L.reduce((a, x) => a + Math.max(0, x.tot) * x.custo, 0);
  const semT = L.reduce((a, x) => a + x.sem, 0), cobT = semT > 0 ? tot / (semT / 7) : null, f = EST.f || {};
  const sinal = v => v > 0 ? 'var(--t-ok)' : v < 0 ? 'var(--t-bad)' : 'var(--mute)';
  const hist = EST.movs.filter(m => (!f.tipo || m.tipo === f.tipo) && (!f.local || m.local === f.local)).slice(0, 200), prod = Object.fromEntries(S.base.produtos.map(p => [p.id, p]));
  $('#main').innerHTML = `<section class="view on"><div class="dash pnl">
   <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn pri" data-em="compra">+ Entrada (compra)</button><button class="btn" data-em="carga">🚚 Carregar carro</button><button class="btn" data-em="retorno">↩ Devolver do carro</button><button class="btn" data-em="perda">Perda / vencido</button><button class="btn" data-em="ajuste">📋 Inventário</button></div>
   <div class="kpis"><div class="kpi"><small>Unidades em estoque</small><b>${fmt(Math.round(tot))}</b><small class="sub">depósito + carros</small></div><div class="kpi"><small>Valor a custo</small><b>${brl(val)}</b><small class="sub">pelo último custo de compra</small></div>
    <div class="kpi"><small>Cobertura</small><b>${cobT == null ? '—' : Math.round(cobT) + ' dias'}</b><small class="sub">no ritmo de saída das últimas semanas</small></div>
    <div class="kpi"><small>Para comprar</small><b style="color:${L.some(x => x.st !== 'ok') ? 'var(--t-bad)' : 'inherit'}">${L.filter(x => x.st !== 'ok').length}</b><small class="sub">sabores abaixo do mínimo</small></div></div>
   ${C.lotes.length ? `<div class="esteira" style="margin:0"><b>⏳ Lotes vencendo em até 15 dias</b><p style="margin:4px 0 0">${C.lotes.slice(0, 8).map(m => `${esc(nomeProd(prod[m.produto_id] || {}))}${m.lote ? ' · lote ' + esc(m.lote) : ''} vence ${dstr(m.validade + 'T12:00')}${m.validade < C.hoje0 ? ' (vencido)' : ''}`).join(' · ')}</p></div>` : ''}
   <div class="panel" style="overflow-x:auto"><h3>Saldo por produto</h3><p class="psub">Saída/semana = vendido + bonificado + trocado (média das últimas semanas). Mínimo: toque para mudar (padrão: 2 semanas de saída).</p>
    <table class="dped"><tr><th>Produto</th>${C.locais.map(l => `<th>${esc(nomeLocal(l))}</th>`).join('')}<th>Total</th><th>Saída/sem.</th><th>Cobertura</th><th>Mínimo</th><th></th></tr>
    ${LINHAS.map(li => { const ls = L.filter(x => x.p.linha === li.k || (x.p.linha || '').startsWith(li.k)); return ls.length ? `<tr><td colspan="${C.locais.length + 6}" style="background:var(--sand);font-weight:600;font-size:12px">${esc(li.n)}</td></tr>` + ls.map(x => `<tr><td>${esc(x.p.sabor)}</td>${C.locais.map(l => `<td style="color:${x.sal[l] < 0 ? 'var(--t-bad)' : 'inherit'}">${fmt(x.sal[l] || 0)}</td>`).join('')}<td><b>${fmt(x.tot)}</b></td><td>${x.sem ? dec(x.sem) : '—'}</td><td>${x.cob == null ? '—' : Math.round(x.cob) + ' d'}</td>
      <td><input type="number" min="0" class="estmin" data-p="${x.p.id}" value="${x.mn}" style="width:64px"></td><td>${x.st === 'ok' ? '<span class="badge" style="background:var(--bg-ok)">ok</span>' : `<span class="badge" style="background:${x.st === 'zerado' ? '#DC2626' : '#F5A524'};color:#fff">${x.st === 'zerado' ? 'zerado' : 'comprar ' + Math.max(0, Math.ceil(x.mn * 2 - x.tot))}</span>`}</td></tr>`).join('') : ''; }).join('')}
    ${(() => { const resto = L.filter(x => !LINHAS.some(li => x.p.linha === li.k || (x.p.linha || '').startsWith(li.k))); return resto.map(x => `<tr><td>${esc(nomeProd(x.p))}</td>${C.locais.map(l => `<td>${fmt(x.sal[l] || 0)}</td>`).join('')}<td><b>${fmt(x.tot)}</b></td><td>${x.sem ? dec(x.sem) : '—'}</td><td>${x.cob == null ? '—' : Math.round(x.cob) + ' d'}</td><td><input type="number" min="0" class="estmin" data-p="${x.p.id}" value="${x.mn}" style="width:64px"></td><td></td></tr>`).join(''); })()}</table></div>
   <div class="panel" style="overflow-x:auto"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 style="margin:0">Movimentações</h3>
    <div class="row" style="gap:6px"><select id="esTipo"><option value="">Todos os tipos</option>${Object.entries(TIPOS_EST).map(([k, n]) => `<option value="${k}" ${f.tipo === k ? 'selected' : ''}>${n}</option>`).join('')}</select><select id="esLocal"><option value="">Todos os locais</option>${C.locais.map(l => `<option value="${l}" ${f.local === l ? 'selected' : ''}>${esc(nomeLocal(l))}</option>`).join('')}</select></div></div>
    ${hist.length ? `<table class="dped" style="margin-top:8px"><tr><th>Quando</th><th>Produto</th><th>Local</th><th>Tipo</th><th>Qtd.</th><th>Por</th><th>Obs.</th><th></th></tr>${hist.map(m => `<tr><td>${new Date(m.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(nomeProd(prod[m.produto_id] || { sabor: '#' + m.produto_id }))}</td><td>${esc(nomeLocal(m.local))}</td><td>${TIPOS_EST[m.tipo] || m.tipo}</td><td style="color:${sinal(+m.qtd)};font-weight:600">${+m.qtd > 0 ? '+' : ''}${fmt(+m.qtd)}</td><td>${esc(m.perfis?.nome || '')}</td><td><small>${esc([m.obs, m.lote ? 'lote ' + m.lote : '', m.validade ? 'val. ' + dstr(m.validade + 'T12:00') : '', m.ref ? 'automático (reposição/venda)' : ''].filter(Boolean).join(' · '))}</small></td><td>${m.ref ? '' : `<button class="mini" data-apaga="${m.id}" title="Apagar este lançamento">✕</button>`}</td></tr>`).join('')}</table>` : '<p class="empty">Nenhuma movimentação ainda. Comece com "+ Entrada (compra)" ou "📋 Inventário" para lançar o que tem hoje.</p>'}</div>
  </div></section>`;
  document.querySelectorAll('[data-em]').forEach(b => b.onclick = () => modalEstoque(b.dataset.em, C));
  $('#esTipo').onchange = e => { EST.f = { ...f, tipo: e.target.value }; desenharEstoque(); }; $('#esLocal').onchange = e => { EST.f = { ...f, local: e.target.value }; desenharEstoque(); };
  document.querySelectorAll('.estmin').forEach(i => i.onchange = async () => { const m = { ...(S.base.regras.estoque_min || {}), [i.dataset.p]: Math.max(0, +i.value || 0) }; try { await db.salvarRegra('estoque_min', m); S.base.regras.estoque_min = m; desenharEstoque(); } catch (e) { erro(e); } });
  document.querySelectorAll('[data-apaga]').forEach(b => b.onclick = async () => { if (!confirm('Apagar este lançamento do estoque?')) return; try { await db.apagarMovEstoque(b.dataset.apaga); EST.movs = EST.movs.filter(m => String(m.id) !== b.dataset.apaga); desenharEstoque(); toast('Lançamento apagado'); } catch (e) { erro(e); } });
}
// lançamentos: compra, carga, devolução, perda e inventário (grade de produtos + caixas)
async function modalEstoque(tipo, C) {
  const prods = S.base.produtos, carros = C.locais.filter(l => l !== 'deposito'), meu = 'carro:' + S.eu.id;
  const tit = { compra: 'Entrada de compra', carga: 'Carregar o carro', retorno: 'Devolver do carro para o depósito', perda: 'Perda / vencido', ajuste: 'Inventário (contagem do estoque)' }[tipo];
  const selLocal = (id, ls, v) => `<select id="${id}">${ls.map(l => `<option value="${l}" ${l === v ? 'selected' : ''}>${esc(nomeLocal(l))}</option>`).join('')}</select>`;
  const topo = tipo === 'compra' ? `<div class="row" style="gap:10px;flex-wrap:wrap"><div><label>Entra em</label>${selLocal('emLoc', C.locais, 'deposito')}</div><div><label>Fornecedor</label><input id="emForn" placeholder="Baccaro, Monkey…"></div><div><label>Lote</label><input id="emLote" style="width:110px"></div><div><label>Validade</label><input type="date" id="emVal"></div></div>`
    : tipo === 'carga' || tipo === 'retorno' ? `<div><label>Carro</label>${selLocal('emLoc', carros, carros.includes(meu) ? meu : carros[0])}</div>`
    : `<div><label>Local</label>${selLocal('emLoc', C.locais, tipo === 'perda' ? (carros.includes(meu) ? meu : 'deposito') : 'deposito')}</div>`;
  const colQ = tipo === 'ajuste' ? 'Contado' : 'Qtd.';
  modal(`<h3>${tit}</h3>${topo}
   ${tipo === 'compra' || tipo === 'carga' ? `<div class="row" style="gap:6px;flex-wrap:wrap;margin:10px 0 4px"><small style="color:var(--mute)">Caixas:</small>${KITS.map((k, i) => `<button type="button" class="mini cxbtn" data-kit="${i}">+1 ${esc(k.n)}</button>`).join('')}${tipo === 'carga' ? '<button type="button" class="mini" id="emRota">usar a carga da rota de hoje</button>' : ''}</div>` : ''}
   <div style="max-height:46vh;overflow:auto;margin-top:6px"><table class="dped"><tr><th>Produto</th><th id="emSaldoH">Saldo</th><th>${colQ}</th>${tipo === 'compra' ? '<th>Custo un.</th>' : ''}</tr>
   ${prods.map(p => `<tr><td>${esc(nomeProd(p))}</td><td class="emS" data-p="${p.id}"></td><td><input type="number" min="0" class="emQ" data-p="${p.id}" data-cod="${esc(p.codigo || p.bling_codigo || '')}" style="width:74px"></td>${tipo === 'compra' ? `<td><input type="number" step="0.01" min="0" class="emC" data-p="${p.id}" value="${p.custo ?? ''}" style="width:80px"></td>` : ''}</tr>`).join('')}</table></div>
   <label>Observação</label><input id="emObs" style="width:100%" placeholder="${tipo === 'perda' ? 'Motivo: vencido, quebrado…' : ''}">
   <div class="row" style="margin-top:14px;justify-content:space-between;align-items:center"><small id="emTot" style="color:var(--mute)"></small><span><button class="btn" onclick="fecharModal()">Cancelar</button> <button class="btn pri" id="emOk">Lançar</button></span></div>`);
  const pintaSaldo = () => { const l = $('#emLoc').value; document.querySelectorAll('.emS').forEach(td => td.textContent = fmt(C.linhas.find(x => String(x.p.id) === td.dataset.p)?.sal[l] || 0));
    $('#emSaldoH').textContent = 'Saldo ' + nomeLocal(l).toLowerCase(); if (tipo === 'ajuste' || tipo === 'retorno') document.querySelectorAll('.emQ').forEach(i => { const v = C.linhas.find(x => String(x.p.id) === i.dataset.p)?.sal[l] || 0; i.value = tipo === 'ajuste' ? Math.max(0, v) : (v > 0 ? v : ''); }); soma(); };
  const soma = () => { $('#emTot').textContent = [...document.querySelectorAll('.emQ')].reduce((a, i) => a + (+i.value || 0), 0) + ' unidades'; };
  $('#emLoc').onchange = pintaSaldo; document.querySelectorAll('.emQ').forEach(i => i.oninput = soma); pintaSaldo();
  const byCod = c => document.querySelector(`.emQ[data-p="${S.base.produtos.find(p => p.codigo === c || p.bling_codigo === c)?.id}"]`);
  document.querySelectorAll('[data-kit]').forEach(b => b.onclick = () => { Object.entries(KITS[+b.dataset.kit].q).forEach(([cod, q]) => { const i = byCod(cod); if (i) i.value = (+i.value || 0) + q; }); soma(); });
  if ($('#emRota')) $('#emRota').onclick = async () => { const mot = $('#emLoc').value.split(':')[1]; try { const r = await db.obterRota(hojeISO(), mot); const cg = r?.carga; if (!cg || !Object.keys(cg).length) return toast('A rota de hoje desse carro não tem carga ajustada salva');
    document.querySelectorAll('.emQ').forEach(i => i.value = cg[i.dataset.p] || ''); soma(); } catch (e) { erro(e); } };
  $('#emOk').onclick = async () => {
    const loc = $('#emLoc').value, obs = $('#emObs').value.trim() || null, rows = [], base = { usuario_id: S.eu.id, obs };
    document.querySelectorAll('.emQ').forEach(i => { const pid = +i.dataset.p, q = +i.value; if (i.value === '' || (tipo !== 'ajuste' && !(q > 0))) return;
      if (tipo === 'compra') rows.push({ ...base, produto_id: pid, local: loc, qtd: q, tipo, custo_unit: +document.querySelector(`.emC[data-p="${pid}"]`).value || null, lote: $('#emLote').value.trim() || null, validade: $('#emVal').value || null, obs: [$('#emForn').value.trim(), obs].filter(Boolean).join(' · ') || null });
      else if (tipo === 'carga') { rows.push({ ...base, produto_id: pid, local: 'deposito', qtd: -q, tipo }); rows.push({ ...base, produto_id: pid, local: loc, qtd: q, tipo }); }
      else if (tipo === 'retorno') { rows.push({ ...base, produto_id: pid, local: loc, qtd: -q, tipo }); rows.push({ ...base, produto_id: pid, local: 'deposito', qtd: q, tipo }); }
      else if (tipo === 'perda') rows.push({ ...base, produto_id: pid, local: loc, qtd: -q, tipo });
      else if (tipo === 'ajuste') { const atual = C.linhas.find(x => x.p.id === pid)?.sal[loc] || 0, dif = q - atual; if (dif) rows.push({ ...base, produto_id: pid, local: loc, qtd: dif, tipo, obs: obs || `contado ${q}, sistema ${atual}` }); } });
    if (!rows.length) return toast(tipo === 'ajuste' ? 'Nada mudou: o contado é igual ao saldo' : 'Coloque as quantidades');
    $('#emOk').disabled = true;
    try { await db.lancarEstoque(rows); fecharModal(); toast(`${tit}: lançado`); telaEstoque(); } catch (e) { $('#emOk').disabled = false; erro(e); }
  };
}

/* =================== contatos =================== */
function telaContatos() {
  $('#main').innerHTML = `<section class="view on"><div class="tablewrap"><div class="toolbar"><input id="kq" placeholder="Buscar contato…" style="width:240px"><button class="btn pri" id="kNovo">+ Novo contato</button><span id="kN" style="color:var(--mute)"></span></div><table id="ktbl"></table></div></section>`;
  const neg = id => S.pdvs.filter(p => p.contato_id === id);
  const draw = () => { const q = norm($('#kq').value); const ds = S.contatos.filter(c => !q || norm(c.nome + ' ' + (c.empresa || '') + ' ' + (c.telefone || '')).includes(q));
    $('#kN').textContent = ds.length + ' contatos';
    $('#ktbl').innerHTML = `<tr><th>Nome</th><th>Empresa</th><th>Cargo</th><th>Telefone</th><th>E-mail</th><th>Negócios</th></tr>` + ds.map(c => `<tr data-id="${c.id}" style="cursor:pointer"><td><b>${esc(c.nome)}</b>${c.comprador ? ' 🛒' : ''}</td><td>${esc(c.empresa || '')}</td><td>${esc(c.cargo || '')}</td><td>${esc(c.telefone || '')}</td><td>${esc(c.email || '')}</td><td>${neg(c.id).map(p => esc(p.nome)).join(', ') || '—'}</td></tr>`).join('');
    $('#ktbl').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => abrirContato(tr.dataset.id)); };
  manter('contatos', ['kq']);
  $('#kq').oninput = draw; draw();
  $('#kNovo').onclick = () => formContato(null);
}
function formContato(c) {
  modal(`<h3>${c ? 'Editar contato' : 'Novo contato'}</h3><label>Nome</label><input id="fNome" value="${esc(c?.nome || '')}">
  <div class="row"><div style="flex:1"><label>Empresa</label><input id="fEmp" value="${esc(c?.empresa || '')}"></div><div style="flex:1"><label>Cargo</label><select id="fCargo"><option value="">—</option>${CARGOS.map(x => `<option ${x === c?.cargo ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
  <div class="row"><div style="flex:1"><label>Telefone</label><input id="fTel" value="${esc(c?.telefone || '')}"></div><div style="flex:1"><label>WhatsApp</label><input id="fWpp" value="${esc(c?.whatsapp || '')}"></div></div>
  <label>E-mail</label><input id="fEmail" value="${esc(c?.email || '')}">
  <label class="chkcomp"><input type="checkbox" id="fComp" ${c?.comprador ? 'checked' : ''}> 🛒 É o comprador <small>(vira o contato principal dos negócios dele)</small></label>
  <label>Observação</label><textarea id="fObs" rows="2">${esc(c?.observacao || '')}</textarea>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="fOk">Salvar</button></div>`);
  $('#fOk').onclick = async () => { const o = { nome: $('#fNome').value.trim(), empresa: $('#fEmp').value.trim() || null, cargo: $('#fCargo').value || null, telefone: $('#fTel').value.trim() || null, whatsapp: $('#fWpp').value.trim() || null, email: $('#fEmail').value.trim() || null, observacao: $('#fObs').value.trim() || null, ...($('#fComp').checked !== !!c?.comprador ? { comprador: $('#fComp').checked } : {}) }; // só manda o campo quando muda (funciona mesmo antes do SQL 024)
    if (!o.nome) return toast('Coloque o nome');
    if (o.observacao && /sem pessoa de contato/.test(o.observacao) && norm(o.nome) !== norm(o.empresa || '')) o.observacao = o.observacao.replace(/ ?· ?sem pessoa de contato/, '').trim() || null;
    const ja = acharContato(o, c?.id); if (ja) return toast(`Já existe o contato ${ja.nome} com esse nome, telefone ou e-mail.`);
    try { let salvo; if (c) { salvo = await db.atualizarContato(c.id, o); Object.assign(c, salvo); } else { salvo = await db.criarContato({ ...o, criado_por: S.eu.id }); S.contatos.push(salvo); }
      if (o.comprador && c) await virarPrincipal(salvo.id);
      if (c && (o.nome !== undefined || o.cargo !== undefined)) contatoParaBling(salvo.id);
      if (o.comprador === true && !c) { /* contato novo ainda não tem negócio */ }
      fecharModal(); toast('Contato salvo'); S.aba === 'contato' ? telaContato() : telaContatos(); } catch (e) { erro(/comprador/.test(e.message) ? new Error('Rode o 024_contato_comprador.sql no Supabase para marcar o comprador') : e); } };
}
async function telaContato() {
  const c = S.contatos.find(x => x.id === S.contatoId); if (!c) return irPara('contatos');
  let tars = [], secDe = []; try { [tars, secDe] = await Promise.all([db.tarefasDoContato(c.id), db.vinculosDoContato(c.id).catch(() => [])]); } catch (e) { }
  const negs = S.pdvs.filter(p => p.contato_id === c.id || secDe.includes(p.id)), w = linkWpp(c.whatsapp || c.telefone);
  $('#main').innerHTML = `<section class="view on"><div class="dash" style=""><div class="row"><button class="btn" id="cVoltar">← ${esc(rotuloVoltar('Contatos'))}</button></div>
  <div class="panel"><small style="color:var(--mute)">Contato</small><h2 style="font-family:var(--fh);margin:4px 0">${esc(c.nome)} ${c.comprador ? '<span class="badge comp" style="font-family:inherit;font-size:13px;vertical-align:middle">🛒 Comprador</span>' : ''}</h2><div style="color:var(--soft)">${esc([c.cargo, c.empresa].filter(Boolean).join(' · '))}</div>
   <div class="kv"><div><small>Telefone</small><b>${esc(c.telefone || '—')}</b></div><div><small>WhatsApp</small><b>${esc(c.whatsapp || '—')}</b></div><div style="grid-column:1/-1"><small>E-mail</small><b style="font-size:14px">${esc(c.email || '—')}</b></div></div>
   ${c.observacao ? `<p style="color:var(--soft)">${esc(c.observacao)}</p>` : ''}
   <div class="row">${w ? `<a class="btn car" style="text-decoration:none" target="_blank" rel="noopener" href="${w}">WhatsApp ↗</a>` : ''}<button class="btn" id="cEditar">Editar</button><button class="btn" id="cExcluir" style="color:var(--t-bad)">Excluir contato</button></div></div>
  <div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Tarefas</h3><button class="btn pri" id="cNovaTar" style="padding:5px 10px">+ Nova</button></div><div style="margin-top:8px">${listaTarefas(tars, 'Nenhuma tarefa com este contato.')}</div></div>
  <div class="panel"><h3>Negócios deste contato</h3>${negs.map(p => `<div class="stop" data-id="${p.id}" style="cursor:pointer"><div class="info"><b>${esc(p.nome)}</b>${p.contato_id === c.id ? '' : ' <span class="badge">secundário</span>'}<br><small style="color:var(--mute)">${esc(p.canal || '')} · ${esc(p.cidade || '')}</small></div><span class="badge st" style="background:${etapa(p.etapa).c}">${etapa(p.etapa).n}</span></div>`).join('') || '<p class="empty">Nenhum negócio vinculado.</p>'}</div></div></section>`;
  $('#cVoltar').onclick = () => voltar('contatos'); $('#cEditar').onclick = () => formContato(c);
  $('#cExcluir').onclick = () => { modal(`<h3>Excluir ${esc(c.nome)}?</h3><p style="color:var(--soft)">Apaga só o contato.${negs.length ? ` ${negs.length === 1 ? 'O negócio vinculado continua' : `Os ${negs.length} negócios vinculados continuam`} cadastrado${negs.length > 1 ? 's' : ''}, sem contato.` : ''}${tars.length ? ' As tarefas dele ficam sem contato.' : ''} Não dá para desfazer.</p><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="cxOk" style="background:#7A2414;border-color:var(--t-bad)">Excluir</button></div>`);
    $('#cxOk').onclick = async () => { try { await db.excluirContato(c.id); fecharModal(); S.contatos = S.contatos.filter(x => x.id !== c.id); S.pdvs.forEach(x => { if (x.contato_id === c.id) x.contato_id = null; }); toast('Contato excluído'); irPara('contatos'); } catch (e) { fecharModal(); erro(e); } }; };
  $('#cNovaTar').onclick = () => modalTarefa({ data: hojeISO(), contato_id: c.id }, telaContato);
  document.querySelectorAll('[data-tid]').forEach(el => el.onclick = () => modalTarefa(tars.find(t => t.id === el.dataset.tid), telaContato));
  document.querySelectorAll('.stop[data-id]').forEach(d => d.onclick = () => abrirPerfil(d.dataset.id));
}

/* =================== uploads (CSV) =================== */
function lerCSV(txt) {
  txt = txt.replace(/^﻿/, '');
  const primeira = txt.split(/\r?\n/)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < txt.length; i++) { const ch = txt[i];
    if (aspas) { if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; }
    else if (ch === '"') aspas = true; else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; linha.push(campo); campo = ''; if (linha.some(x => x.trim())) linhas.push(linha); linha = []; }
    else campo += ch; }
  linha.push(campo); if (linha.some(x => x.trim())) linhas.push(linha);
  const cab = (linhas.shift() || []).map(h => norm(h).replace(/ /g, '_'));
  return linhas.map(l => Object.fromEntries(cab.map((h, i) => [h, (l[i] || '').trim()])));
}
// "RUA JOAO WOBETO, 350 - MATO GRANDE - Canoas/RS - 92320-160"
function partesEndereco(s) {
  const p = String(s).split(/\s+-\s+/).map(x => x.trim()).filter(Boolean);
  const cep = (s.match(/\d{5}-?\d{3}/) || [''])[0];
  const cidUf = p.find(x => /\/\s*[A-Z]{2}$/i.test(x)) || '';
  const [cidade, uf] = cidUf ? cidUf.split('/').map(x => x.trim()) : ['', ''];
  const ruaNum = p[0] || ''; const m = ruaNum.match(/^(.*?),\s*(\d+[A-Za-z]?)/);
  const bairro = p.find((x, i) => i > 0 && x !== cidUf && !/^\d{5}-?\d{3}$/.test(x)) || '';
  return { rua: m ? m[1] : ruaNum, numero: m ? m[2] : '', bairro, cidade, uf: uf || 'RS', cep };
}
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function nominatim(params) {
  const u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=br&accept-language=pt-BR&' + new URLSearchParams(params);
  let r; try { r = await fetch(u); } catch { throw new Error('LIMITE'); }
  if (r.status === 429 || r.status === 403 || r.status >= 500) throw new Error('LIMITE');
  return (await r.json())[0];
}
// expande abreviações comuns de endereço e tira complementos (loja, fundos…)
function limparRua(s) {
  return String(s || '').replace(/^(R|Rua)\.?\s+/i, 'Rua ').replace(/^(Av|Avda|Avenida)\.?\s+/i, 'Avenida ').replace(/^(Tv|Trav)\.?\s+/i, 'Travessa ').replace(/^(Al)\.?\s+/i, 'Alameda ').replace(/^(Est)\.?\s+/i, 'Estrada ')
    .replace(/\bDr\.?\s/gi, 'Doutor ').replace(/\bCel\.?\s/gi, 'Coronel ').replace(/\bDes\.?\s/gi, 'Desembargador ').replace(/\bPres\.?\s/gi, 'Presidente ').replace(/\bGal\.?\s/gi, 'General ').replace(/\bSto\.?\s/gi, 'Santo ').replace(/\bN\.?\s?Sra\.?\s/gi, 'Nossa Senhora ')
    .replace(/,\s*(\d{1,3})\.(\d{3})\b/, ', $1$2').replace(/,\s*(\d+)[^,]*$/, ', $1').trim();
}
// devolve { lat, lng, precisao: 'exata' | 'rua' | 'cidade', ... } ou null
async function geocodificar(endereco) {
  const e = partesEndereco(endereco); e.rua = limparRua(e.rua + (e.numero ? ', ' + e.numero : '')).replace(/,\s*\d+$/, '');
  const tentativas = [
    e.numero ? { street: `${e.numero} ${e.rua}`, city: e.cidade, state: e.uf, ...(e.cep ? { postalcode: e.cep } : {}) } : null,
    e.numero ? { street: `${e.numero} ${e.rua}`, city: e.cidade, state: e.uf } : null,
    { q: [e.rua + (e.numero ? ', ' + e.numero : ''), e.bairro, e.cidade, e.uf].filter(Boolean).join(', ') },
    { street: e.rua, city: e.cidade, state: e.uf },
  ].filter(Boolean);
  for (const t of tentativas) {
    let r; try { r = await nominatim(t); } catch (er) { await esperar(30000); try { r = await nominatim(t); } catch { throw new Error('LIMITE'); } } await esperar(1500);
    if (!r) continue;
    const a = r.address || {};
    const precisao = (a.house_number && e.numero && soDig(a.house_number) === soDig(e.numero)) || ['house', 'building'].includes(r.type) || r.category === 'building' ? 'exata' : (a.road ? 'rua' : 'cidade');
    return { lat: +r.lat, lng: +r.lon, precisao, cidade: a.city || a.town || a.village || a.municipality || e.cidade, bairro: a.suburb || a.neighbourhood || e.bairro, rua: [a.road || e.rua, a.house_number || e.numero].filter(Boolean).join(', ') };
  }
  return null;
}
const MODELOS = {
  contatos: { titulo: 'Contatos', desc: 'Pessoas: dono, gerente, funcionário. Não entram contatos repetidos (mesmo nome, telefone ou e-mail).', cols: ['nome', 'empresa', 'cargo', 'telefone', 'whatsapp', 'email', 'observacao'], ex: ['Maria Souza', 'Padaria Pão Quente', 'Dono', '(51) 99999-0000', '(51) 99999-0000', 'maria@email.com', 'Prefere visita de manhã'] },
  negocios: { titulo: 'Negócios', desc: 'Clientes e negócios já em andamento, em qualquer etapa do funil. "nome" é o nome fantasia. A localização é buscada pelo endereço.', cols: ['nome', 'razao_social', 'cnpj', 'canal', 'etapa', 'localizacao', 'contato_nome', 'contato_cargo', 'contato_telefone', 'classe', 'potencial', 'expositor', 'condicao', 'observacao'], ex: ['Mercado Bom Dia', 'Mercado Bom Dia Ltda', '00.000.000/0001-00', 'Minimercado', 'Ativo', 'RUA JOAO WOBETO, 350 - MATO GRANDE - Canoas/RS - 92320-160', 'João', 'Dono', '(51) 98888-0000', 'A', '5', '3 andares', 'À vista · Pix', ''] },
  prospectos: { titulo: 'Prospectos', desc: 'Lista de alvos. "nome" é o nome fantasia. Cada endereço é localizado; os encontrados no número exato entram como Mapeado, os aproximados ficam para você confirmar. Canal fora da lista entra com o texto que você escrever.', cols: ['nome', 'razao_social', 'cnpj', 'canal', 'localizacao', 'contato_nome', 'contato_cargo', 'contato_telefone', 'potencial', 'observacao'], ex: ['Padaria Exemplo', '', '', 'Padaria', 'RUA JOAO WOBETO, 350 - MATO GRANDE - Canoas/RS - 92320-160', '', '', '', '3', ''] } };
function baixarModelo(k) {
  const m = MODELOS[k], q = v => /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = '﻿' + m.cols.join(';') + '\n' + m.ex.map(q).join(';') + '\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `modelo_${k}.csv`; document.body.appendChild(a); a.click(); a.remove();
}

/* ---- importação direta do Google Maps (arquivo do Outscraper) ---- */
// nomes de categoria do Google em português e em inglês (o Outscraper pode devolver nos dois)
const GMAPS_CANAL = [[/padaria|panificadora|bakery/, 'Padaria'], [/confeitaria|doceria|loja de doces|bolo|confection|dessert|pastry shop|chocolate/, 'Confeitaria'], [/cafeteria|cafe|coffee/, 'Cafeteria'],
  [/auto ?atendimento|autosservico|self service|mercado autonomo|minimercado autonomo|honest market/, 'Minimercado de autoatendimento'],
  [/minimercado|mercearia|supermercado|mercado|armazem|emporio|atacad|grocery|mini ?market|supermarket|general store|health food|imported food|produtos naturais|importados/, 'Minimercado'], [/hortifruti|fruteira|quitanda|sacolao|produce/, 'Fruteira'],
  [/conveniencia|posto de (gasolina|combustivel)|convenience|gas station/, 'Conveniência'], [/cantina|canteen|praca de alimentacao|food court/, 'Cantina'],
  [/escola|colegio|faculdade|universidade|curso|cursinho|ensino|educa|university|language school|test preparation|student housing|moradia estudantil/, 'Escola / faculdade'],
  [/lanchonete|lancheria|hamburgueria|pastelaria|pastel|cachorro|lanche|acai|sorvet|sucos|snack|hot dog|hamburger|ice cream|juice/, 'Lancheria'],
  [/restaurante|buffet|pizzaria|churrascaria|comida|restaurant|pizza/, 'Restaurante'], [/bar\b|choperia|cervejaria|pub|boteco|brewpub|sinuca|pool hall/, 'Bar'],
  [/academia|crossfit|pilates|fitness|ginastica|danca|clube/, 'Academia / clube'], [/farmacia|drogaria|pharmacy|drug ?store/, 'Farmácia'],
  [/barbearia|salao|cabeleireir|estetica|manicure|barber|beauty salon/, 'Barbearia / salão'], [/lava|oficina|borracharia|auto ?center|mecanic/, 'Serviços automotivos'],
  [/pet/, 'Pet shop'], [/hospital|clinica|laboratorio/, 'Saúde'], [/hotel|hostel|pousada/, 'Hotel'], [/distribuidora de bebidas|bebidas|adega|tabacaria|beverage|tobacco/, 'Bebidas / tabacaria'],
  [/banca|loterica|papelaria|copiadora|grafica rapida|livraria|newsstand|stationery|copy shop|book ?store/, 'Banca / lotérica / papelaria'], [/presentes|gift/, 'Loja de presentes']];
function canalGoogle(cat) { const n = norm(cat); const m = GMAPS_CANAL.find(([re]) => re.test(n)); return m ? m[1] : (cat || 'Outro'); }
const campo = (l, ...ks) => { for (const k of ks) if (l[k]) return l[k]; return ''; };
let gmaps = null;
function prepararGoogle(linhas, el) {
  const vistos = new Set(); let fechados = 0, fora = 0, repetidos = 0, jaTem = 0, semCoord = 0; const ok = [];
  for (const l of linhas) {
    const lat = parseFloat(String(campo(l, 'latitude', 'lat')).replace(',', '.')), lng = parseFloat(String(campo(l, 'longitude', 'lng', 'lon')).replace(',', '.')), nome = campo(l, 'name', 'nome', 'title');
    if (!nome || !isFinite(lat) || !isFinite(lng)) { semCoord++; continue; }
    if (/closed/i.test(campo(l, 'business_status'))) { fechados++; continue; }
    const cid = campo(l, 'city', 'cidade') || 'Porto Alegre';
    const id = campo(l, 'google_id', 'place_id', 'cid') || norm(nome) + lat.toFixed(4) + lng.toFixed(4); if (vistos.has(id)) { repetidos++; continue; } vistos.add(id);
    if (S.pdvs.some(p => p.lat && norm(p.nome) === norm(nome) && distM(p, { lat, lng }) < 150)) { jaTem++; continue; }
    const cat = campo(l, 'category', 'type', 'categoria') || (campo(l, 'subtypes').split(',')[0] || '').trim();
    ok.push({ l, nome, lat, lng, cat, cid, canal: canalGoogle(cat + ' ' + campo(l, 'subtypes')) });
  }
  const porCanal = {}; ok.forEach(x => { (porCanal[x.canal] = porCanal[x.canal] || { n: 0, cats: {} }).n++; porCanal[x.canal].cats[x.cat] = (porCanal[x.canal].cats[x.cat] || 0) + 1; });
  gmaps = { ok, porCanal };
  el.innerHTML = `<p style="margin:6px 0"><b>${ok.length} pontos novos</b> no arquivo · ${repetidos} repetidos no arquivo · ${jaTem} já estão no sistema · ${fechados} fechados${(() => { const cs = [...new Set(ok.map(x => x.cid))]; return cs.length > 1 || (cs[0] && cs[0] !== 'Porto Alegre') ? ' · cidades: ' + esc(cs.join(', ')) : ''; })()}${semCoord ? ` · ${semCoord} sem coordenada` : ''}</p>
   <p style="color:var(--soft);margin:4px 0 8px">Desmarque o que não quer importar. O canal é sugerido a partir da categoria do Google.</p>
   <table><tr><th></th><th>Canal</th><th>Categorias do Google</th><th style="text-align:right">Pontos</th></tr>${Object.entries(porCanal).sort((a, b) => b[1].n - a[1].n).map(([c, v]) => `<tr><td><input type="checkbox" data-gc="${esc(c)}" checked style="width:auto"></td><td><b>${esc(c)}</b></td><td><small>${Object.entries(v.cats).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${esc(k || '—')} (${n})`).join(' · ')}</small></td><td style="text-align:right">${v.n}</td></tr>`).join('')}</table>
   <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn pri" id="gImp">Importar selecionados</button></div><div id="gRes"></div>`;
  const atual = () => { const sel = new Set([...el.querySelectorAll('[data-gc]:checked')].map(c => c.dataset.gc)); return ok.filter(x => sel.has(x.canal)); };
  el.querySelectorAll('[data-gc]').forEach(c => c.onchange = () => { $('#gImp').textContent = `Importar ${atual().length} selecionados`; });
  $('#gImp').textContent = `Importar ${ok.length} selecionados`;
  $('#gImp').onclick = async () => {
    const lista = atual(); if (!lista.length) return toast('Nada selecionado'); $('#gImp').disabled = true;
    try {
      const regs = []; for (const x of lista) regs.push(await garantirRegiao(x.lng, x.lat, x.cid));
      const linhasDb = lista.map((x, i) => { const l = x.l, tel = campo(l, 'phone', 'telefone'), nota = campo(l, 'rating'), av = campo(l, 'reviews'), site = campo(l, 'site', 'website');
        return { nome: x.nome, canal: x.canal, endereco: campo(l, 'street', 'endereco') || (campo(l, 'full_address', 'address').split(' - ')[0]) || null, bairro: campo(l, 'borough', 'bairro', 'neighborhood') || null, cidade: x.cid, lat: x.lat, lng: x.lng, geo_precisao: 'exata', potencial: 3,
          link_maps: (() => { const ll = campo(l, 'location_link', 'link', 'url'), gid = campo(l, 'google_id'); return /^https?:\/\//.test(ll) ? ll : /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(gid) ? `https://www.google.com/maps/place/data=!4m2!3m1!1s${gid}` : null; })(),
          observacao: ['Google: ' + (x.cat || '—'), tel ? 'Tel ' + tel : null, nota ? `★ ${nota}${av ? ' (' + av + ')' : ''}` : null, site || null].filter(Boolean).join(' · '), etapa: 'mapeado', origem: 'google_maps', regiao: regs[i], criado_por: S.eu.id }; });
      $('#gRes').innerHTML = '<small>Gravando…</small>';
      await db.criarPdvs(linhasDb); await recarregar();
      $('#gRes').innerHTML = `<p><b>${linhasDb.length} prospects importados como Mapeado.</b> Já aparecem no mapa e nos blocos do modo prospecção.</p>`; toast(`${linhasDb.length} prospects importados`);
    } catch (e) { erro(e); $('#gImp').disabled = false; }
  };
}
// busca usada no Outscraper para achar um negócio já cadastrado: nome + endereço + bairro + cidade
function buscaGoogle(p) {
  if (!p.endereco && !p.cidade) return null;
  const cep = ((p.observacao || '').match(/\d{5}-?\d{3}/) || [null])[0];
  return [p.nome, p.endereco ? limparRua(p.endereco) : null, p.bairro, (p.cidade || '') + ' RS', cep].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
}
async function localizarPeloOutscraper(linhas, el) {
  const porBusca = new Map(S.pdvs.filter(x => !x.lat).map(p => [norm(buscaGoogle(p) || ''), p]));
  let ok = 0; const longe = [], semPar = [], usados = new Set();
  for (const l of linhas) {
    const lat = parseFloat(String(l.latitude).replace(',', '.')), lng = parseFloat(String(l.longitude).replace(',', '.'));
    const p = porBusca.get(norm(l.query || l.original_query || '')) || S.pdvs.find(x => !x.lat && !usados.has(x.id) && norm(x.nome) === norm(l.name || ''));
    if (!p) { semPar.push(l.query || l.name || '—'); continue; }
    if (usados.has(p.id) || !isFinite(lat) || !isFinite(lng)) continue; usados.add(p.id);
    const nomeG = l.name || '', tel = l.phone || '';
    const patch = { lat, lng, geo_precisao: 'exata', regiao: p.regiao || await garantirRegiao(lng, lat, p.cidade || l.city), ...(p.telefone || !tel ? {} : { telefone: tel }), ...(l.location_link ? { link_maps: l.location_link } : {}), ...(!p.endereco && l.street ? { endereco: l.street, cidade: p.cidade || l.city || null } : {}), ...(l.place_id ? { place_id: l.place_id } : {}) };
    try { await db.atualizarPdv(p.id, patch); ok++; const ng = norm(nomeG).replace(/[^a-z0-9 ]/g, ''), np = norm(p.nome + ' ' + (p.razao_social || '')).replace(/[^a-z0-9 ]/g, ''); if (ng && !np.includes(ng) && !ng.includes(norm(p.nome).replace(/[^a-z0-9 ]/g, '')) && !ng.split(' ').some(w => w.length >= 3 && np.includes(w))) longe.push([p, nomeG]); } catch (e) { semPar.push(p.nome + ': ' + e.message); }
  }
  await recarregar();
  const falta = S.pdvs.filter(x => !x.lat);
  el.innerHTML = `<p><b>${ok} negócios localizados pelo Google.</b>${falta.length ? ` Ainda faltam ${falta.length}.` : ' Todos no mapa!'}</p>
   ${longe.length ? `<div class="panel"><h3>Confira (o Google achou um nome diferente)</h3><table><tr><th>Negócio</th><th>Google achou</th><th></th></tr>${longe.map(([p, g]) => `<tr><td>${esc(p.nome)}</td><td>${esc(g)}</td><td><button class="mini" data-gper="${p.id}">abrir</button></td></tr>`).join('')}</table></div>` : ''}
   ${falta.length ? `<div class="panel"><h3>Sem localização</h3><table>${falta.map(p => `<tr><td>${esc(p.nome)}</td><td>${esc([p.endereco, p.bairro, p.cidade].filter(Boolean).join(' · ') || 'sem endereço')}</td><td><button class="mini" data-gper="${p.id}">abrir</button></td></tr>`).join('')}</table></div>` : ''}`;
  el.querySelectorAll('[data-gper]').forEach(b => b.onclick = () => abrirPerfil(b.dataset.gper));
}
async function localizarSemCoord(el, bt) {
  bt.disabled = true; const sem = S.pdvs.filter(x => !x.lat); let ok = 0, parou = false; const aprox = [], falha = [];
  for (let i = 0; i < sem.length; i++) { const p = sem[i];
    el.innerHTML = `<div class="prog" style="height:12px"><i style="width:${i / sem.length * 100}%;background:var(--car)"></i></div><small>${i} de ${sem.length} · ${ok} localizados · ${p.nome}</small>`;
    if (!p.endereco || !p.cidade) { falha.push([p, 'sem endereço']); continue; }
    const cep = ((p.observacao || '').match(/\d{5}-?\d{3}/) || [''])[0];
    try { const g = await geocodificar(`${p.endereco}${p.bairro ? ' - ' + p.bairro : ''} - ${p.cidade}/RS${cep ? ' - ' + cep : ''}`);
      if (!g || g.precisao === 'cidade') { falha.push([p, 'endereço não encontrado']); continue; }
      await db.atualizarPdv(p.id, { lat: g.lat, lng: g.lng, geo_precisao: g.precisao, regiao: p.regiao || await garantirRegiao(g.lng, g.lat, p.cidade) }); ok++; if (g.precisao !== 'exata') aprox.push(p);
    } catch (e) { if (e.message === 'LIMITE') { parou = true; break; } falha.push([p, e.message]); } }
  await recarregar(); bt.disabled = false;
  if (parou) { el.innerHTML = `<p><b>${ok} localizados.</b> O serviço de mapas gratuito pediu uma pausa. Espere uns 10 minutos e clique de novo: ele continua só com os que faltam.</p>`; return; }
  el.innerHTML = `<p><b>${ok} localizados</b>${aprox.length ? ` · ${aprox.length} só pela rua (confira o pino)` : ''}${falha.length ? ` · <b style="color:var(--t-bad)">${falha.length} sem localização</b>` : ''}</p>
   ${aprox.length || falha.length ? `<table><tr><th>Negócio</th><th>Endereço</th><th>Situação</th><th></th></tr>${[...aprox.map(p => [p, 'aproximado pela rua']), ...falha].map(([p, m]) => `<tr><td>${esc(p.nome)}</td><td>${esc([p.endereco, p.bairro, p.cidade].filter(Boolean).join(' · ') || '—')}</td><td>${esc(m)}</td><td><button class="mini" data-gper="${p.id}">abrir</button></td></tr>`).join('')}</table>` : ''}`;
  el.querySelectorAll('[data-gper]').forEach(b => b.onclick = () => abrirPerfil(b.dataset.gper));
}
const etapaDe = t => { const n = norm(t); return (ETAPAS.find(e => norm(e.n) === n || e.k === n.replace(/ /g, '')) || ETAPAS.find(e => n && norm(e.n).startsWith(n)) || {}).k; };
const expoDe = t => { const n = norm(t); return (S.base.expositores.find(e => norm(e.nome) === n || String(e.capacidade) === soDig(t)) || {}).id || null; };
const canalDe = t => CANAIS.find(c => norm(c) === norm(t)) || (t ? t.trim() : null);
const cargoDe = t => CARGOS.find(c => norm(c) === norm(t)) || (t ? t.trim() : null);
let pendentes = [];
function telaUploads() {
  $('#main').innerHTML = `<section class="view on"><div class="dash" style="">
  <div class="panel"><h3>Como funciona</h3><p style="color:var(--soft);margin:0">Baixe o modelo, preencha no Excel ou Google Planilhas e salve como <b>CSV</b>. Pode ser separado por ponto e vírgula (padrão do Excel no Brasil) ou por vírgula. A coluna <b>localizacao</b> segue o padrão <i>RUA JOAO WOBETO, 350 - MATO GRANDE - Canoas/RS - 92320-160</i>. A busca de endereço faz cerca de 1 por segundo, então 100 linhas levam uns 2 a 4 minutos.</p></div>
  ${(() => { const sem = S.pdvs.filter(x => !x.lat); return sem.length ? `<div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 style="margin:0">Negócios sem localização no mapa (${sem.length})</h3></div>
   <p style="color:var(--soft)"><b>Pelo Outscraper (recomendado):</b> 1) baixe a lista de buscas; 2) cole no Outscraper (Google Maps Scraper) com <b>limite de 1 resultado por busca</b> e exporte em CSV; 3) suba o CSV aqui. Cada linha volta para o negócio certo com a posição exata do Google.</p>
   <div class="row" style="flex-wrap:wrap"><button class="btn" id="gBaixa">1. Baixar lista de buscas</button><input type="file" accept=".csv,text/csv" id="gLocArq"><button class="btn pri" id="gLocSobe">3. Subir resultado</button></div>
   <p style="color:var(--mute);font-size:12px;margin-top:10px">Ou, sem Outscraper: <button class="mini" id="gLoc">localizar pelo mapa gratuito</button> (mais lento e menos preciso).</p><div id="gLocRes"></div></div>` : ''; })()}
  <div class="panel"><h3 style="margin:0">Google Maps (arquivo do Outscraper)</h3><p style="color:var(--soft)">Suba o CSV exportado do Outscraper como veio, sem editar. Os pontos já têm coordenada, então entram na hora como <b>Mapeado</b>. Repetidos, fechados, fora de Porto Alegre e os que já estão no sistema ficam de fora.</p>
   <div class="row" style="flex-wrap:wrap"><input type="file" accept=".csv,text/csv" id="gArq"><button class="btn pri" id="gLer">Ler arquivo</button></div><div id="gOut" style="margin-top:10px"></div></div>
  ${Object.entries(MODELOS).map(([k, m]) => `<div class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 style="margin:0">${m.titulo}</h3><button class="btn" data-mod="${k}">Baixar modelo</button></div>
   <p style="color:var(--soft)">${m.desc}</p><p style="font-size:12px;color:var(--mute)">Colunas: ${m.cols.join(' · ')}</p>
   <div class="row" style="flex-wrap:wrap"><input type="file" accept=".csv,text/csv" data-arq="${k}"><button class="btn pri" data-imp="${k}">Importar</button></div><div id="res-${k}" style="margin-top:10px"></div></div>`).join('')}</div></section>`;
  document.querySelectorAll('[data-mod]').forEach(b => b.onclick = () => baixarModelo(b.dataset.mod));
  if ($('#gLoc')) $('#gLoc').onclick = () => localizarSemCoord($('#gLocRes'), $('#gLoc'));
  if ($('#gBaixa')) $('#gBaixa').onclick = () => { const l = S.pdvs.filter(x => !x.lat).map(buscaGoogle).filter(Boolean);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([l.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })); a.download = 'buscas_localizacao_clientes.txt'; document.body.appendChild(a); a.click(); a.remove();
    toast(`${l.length} buscas na lista${S.pdvs.filter(x => !x.lat).length - l.length ? ` · ${S.pdvs.filter(x => !x.lat).length - l.length} sem endereço nem cidade ficaram de fora` : ''}`); };
  if ($('#gLocSobe')) $('#gLocSobe').onclick = async () => { const f = $('#gLocArq').files[0]; if (!f) return toast('Escolha o CSV do Outscraper'); const linhas = lerCSV(await f.text());
    if (!linhas.length || !('latitude' in linhas[0])) return toast('Não achei a coluna latitude. Exporte em CSV pelo Outscraper.'); await localizarPeloOutscraper(linhas, $('#gLocRes')); };
  $('#gLer').onclick = async () => { const f = $('#gArq').files[0]; if (!f) return toast('Escolha o arquivo CSV do Outscraper'); const linhas = lerCSV(await f.text()); if (!linhas.length) return toast('Arquivo vazio');
    if (!('latitude' in linhas[0] || 'lat' in linhas[0])) return toast('Não achei a coluna latitude. Exporte em CSV pelo Outscraper.'); prepararGoogle(linhas, $('#gOut')); };
  document.querySelectorAll('[data-imp]').forEach(b => b.onclick = async () => {
    const k = b.dataset.imp, f = document.querySelector(`[data-arq="${k}"]`).files[0];
    if (!f) return toast('Escolha o arquivo CSV');
    const linhas = lerCSV(await f.text()); if (!linhas.length) return toast('O arquivo está vazio ou sem cabeçalho');
    if (!('nome' in linhas[0]) && k !== 'contatos') return toast('Falta a coluna "nome". Use o modelo.');
    b.disabled = true; try { await importar(k, linhas, $('#res-' + k)); } catch (e) { erro(e); } b.disabled = false;
  });
}
async function importar(k, linhas, el) {
  let feitos = 0, ignorados = 0; const falhas = []; pendentes = [];
  const prog = i => el.innerHTML = `<div class="prog" style="height:12px"><i style="width:${i / linhas.length * 100}%;background:var(--car)"></i></div><small>${i} de ${linhas.length} · ${feitos} importados · ${ignorados} já existiam · ${falhas.length + pendentes.length} para revisar</small>`;
  for (let i = 0; i < linhas.length; i++) { prog(i); const l = linhas[i];
    try {
      if (k === 'contatos') {
        if (!l.nome) { falhas.push({ l, motivo: 'sem nome' }); continue; }
        if (acharContato(l)) { ignorados++; continue; }
        await obterContato({ ...l, cargo: cargoDe(l.cargo) }); feitos++; continue;
      }
      if (!l.nome) { falhas.push({ l, motivo: 'sem nome' }); continue; }
      if (S.pdvs.some(p => norm(p.nome) === norm(l.nome))) { ignorados++; continue; }
      if (!l.localizacao) { falhas.push({ l, motivo: 'sem localização' }); continue; }
      const g = await geocodificar(l.localizacao);
      if (!g) { falhas.push({ l, motivo: 'endereço não encontrado' }); continue; }
      const base = { nome: l.nome, razao_social: l.razao_social || null, cnpj: soDig(l.cnpj) || null, canal: canalDe(l.canal), endereco: g.rua || null, bairro: g.bairro || null, cidade: g.cidade || null, lat: g.lat, lng: g.lng, geo_precisao: g.precisao, potencial: +l.potencial || 3, observacao: l.observacao || null, criado_por: S.eu.id };
      if (k === 'prospectos' && g.precisao !== 'exata') { pendentes.push({ l, g, base }); continue; }
      await gravarImportado(k, l, g, base); feitos++;
    } catch (e) { falhas.push({ l, motivo: e.message }); }
  }
  prog(linhas.length);
  el.innerHTML += `<div style="margin-top:10px"><b>${feitos} importados</b> · ${ignorados} já existiam${falhas.length ? ` · <b style="color:var(--t-bad)">${falhas.length} com problema</b>` : ''}${pendentes.length ? ` · <b style="color:var(--car-d)">${pendentes.length} com localização aproximada</b>` : ''}</div>
   ${pendentes.length ? `<div class="panel" style="margin-top:10px"><h3>Confirme a localização</h3><p style="color:var(--soft);margin-top:0">O endereço foi achado só no nível da rua ou da cidade. Aceite a posição aproximada (dá para ajustar depois no perfil, em "Ajustar localização") ou deixe de fora.</p><table><tr><th>Nome</th><th>Endereço informado</th><th>Encontrado</th><th></th></tr>${pendentes.map((x, i) => `<tr id="pend-${i}"><td>${esc(x.l.nome)}</td><td>${esc(x.l.localizacao)}</td><td>${esc(x.g.rua || '')}, ${esc(x.g.cidade || '')} <small>(${x.g.precisao})</small></td><td><button class="btn" data-acc="${i}">Aceitar</button></td></tr>`).join('')}</table><div class="row" style="margin-top:8px;justify-content:flex-end"><button class="btn car" id="accTodos">Aceitar todos</button></div></div>` : ''}
   ${falhas.length ? `<div class="panel" style="margin-top:10px"><h3>Não importados</h3><table><tr><th>Nome</th><th>Localização</th><th>Motivo</th></tr>${falhas.map(f => `<tr><td>${esc(f.l.nome || '—')}</td><td>${esc(f.l.localizacao || '')}</td><td>${esc(f.motivo)}</td></tr>`).join('')}</table></div>` : ''}`;
  const aceitar = async i => { const x = pendentes[i]; if (!x) return; pendentes[i] = null; try { await gravarImportado(k, x.l, x.g, x.base); const tr = document.getElementById('pend-' + i); if (tr) tr.style.opacity = .4; } catch (e) { erro(e); } };
  el.querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => { b.disabled = true; await aceitar(+b.dataset.acc); toast('Prospecto adicionado'); });
  if ($('#accTodos')) $('#accTodos').onclick = async () => { for (let i = 0; i < pendentes.length; i++) await aceitar(i); toast('Prospectos adicionados como Mapeado'); };
  await recarregar();
}
async function gravarImportado(k, l, g, base) {
  const contato_id = (l.contato_nome || l.contato_telefone) ? await obterContato({ nome: l.contato_nome, cargo: cargoDe(l.contato_cargo), telefone: l.contato_telefone, whatsapp: l.contato_telefone, empresa: l.nome }) : null;
  const extra = k === 'negocios' ? { etapa: etapaDe(l.etapa) || 'mapeado', classe: ['A', 'B', 'C', 'D'].includes((l.classe || '').toUpperCase()) ? l.classe.toUpperCase() : null, expositor_id: expoDe(l.expositor), condicao: l.condicao || null, origem: 'importacao' } : { etapa: 'mapeado', origem: 'importacao' };
  const n = await db.criarPdv({ ...base, ...extra, contato_id, regiao: await garantirRegiao(g.lng, g.lat, g.cidade) });
  S.pdvs.push({ ...n }); return n;
}

/* =================== modo prospecção do mapa =================== */
const PROSP_ETAPAS = ['mapeado', 'visitado', 'negociacao'];
const RESULTADOS = {
  fechou: { n: 'Fechou', ic: '✓', c: '#2F7D4E' }, pensar: { n: 'Vai pensar', ic: '…', c: '#D08A3C' },
  nao_estava: { n: 'Não estava', ic: '⌂', c: '#3F6FA8' }, fornecedor: { n: 'Já tem fornecedor', ic: '⇄', c: '#6B4FA0' },
  sem_interesse: { n: 'Sem interesse', ic: '✕', c: '#8C7E74' } };
const PZ = { plano: [], dia: null, visHoje: {}, canal: '', ativos: false, editando: false, aberto: null, carregado: false };
const distM = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const centro = l => ({ lat: l.reduce((s, p) => s + p.lat, 0) / l.length, lng: l.reduce((s, p) => s + p.lng, 0) / l.length });
const daqui = dias => isoDe(new Date(Date.now() + dias * DIA));
const pdvsPlano = () => PZ.plano.map(id => S.pdvs.find(p => p.id === id)).filter(p => p && p.lat);
// quem pode entrar no plano: prospects e negócios com tarefa até hoje
const candidatos = () => S.pdvs.filter(p => p.lat && (PROSP_ETAPAS.includes(p.etapa) || (p.acao_data && ymd(p.acao_data) <= PZ.dia && p.etapa !== 'perdido')));
function prioridade(p) { return (p.acao_data && ymd(p.acao_data) <= PZ.dia ? 100 : 0) + ({ negociacao: 30, visitado: 20, mapeado: 10 }[p.etapa] || 0) + (p.potencial || 0) * 3; }

// ordem da rota: vizinho mais próximo + melhoria 2-opt
function ordenarRota(lista, inicio) {
  if (lista.length < 2) return lista.slice();
  let rest = lista.slice(), atual = inicio || rest.reduce((a, b) => (b.lat > a.lat ? b : a)), ord = [];
  if (!inicio) { ord.push(atual); rest = rest.filter(p => p !== atual); }
  while (rest.length) { let m = rest[0]; for (const p of rest) if (distM(atual, p) < distM(atual, m)) m = p; ord.push(m); rest = rest.filter(p => p !== m); atual = m; }
  const tot = o => o.reduce((s, p, i) => s + (i ? distM(o[i - 1], p) : (inicio ? distM(inicio, p) : 0)), 0);
  for (let melhorou = true, voltas = 0; melhorou && voltas < 50; voltas++) { melhorou = false;
    for (let i = 0; i < ord.length - 1; i++) for (let k = i + 1; k < ord.length; k++) { const n = [...ord.slice(0, i), ...ord.slice(i, k + 1).reverse(), ...ord.slice(k + 1)]; if (tot(n) + 1 < tot(ord)) { ord = n; melhorou = true; } } }
  return ord;
}
// paradas de carro: pontos seguidos a até 300 m do primeiro do grupo, no máximo 6
function paradasDeCarro(ord) {
  const g = []; for (const p of ord) { const ult = g[g.length - 1]; if (ult && ult.length < 6 && distM(ult[0], p) <= 300) ult.push(p); else g.push([p]); }
  return g.map(l => ({ pts: l, c: centro(l) }));
}
// blocos: agrupa prospects por proximidade em grupos que cabem num turno
function blocos() {
  let rest = S.pdvs.filter(p => p.lat && PROSP_ETAPAS.includes(p.etapa) && (!PZ.canal || p.canal === PZ.canal)); const out = [];
  while (rest.length && out.length < 12) {
    let semente = rest[0], bn = -1; for (const p of rest) { const n = rest.filter(q => distM(p, q) < 1500).length; if (n > bn) { bn = n; semente = p; } }
    const grupo = rest.slice().sort((a, b) => distM(semente, a) - distM(semente, b)).filter(q => distM(semente, q) < 3000).slice(0, 18);
    rest = rest.filter(q => !grupo.includes(q));
    const cont = {}; grupo.forEach(p => { const b = p.bairro || p.cidade || regNome(p.regiao); cont[b] = (cont[b] || 0) + 1; });
    out.push({ pts: grupo, nome: Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(' e '), reg: semente.regiao });
  }
  return out.sort((a, b) => b.pts.length - a.pts.length);
}
async function carregarProsp() {
  PZ.dia = hojeISO();
  try { const [pl, vs] = await Promise.all([db.obterPlano(S.eu.id, PZ.dia), db.visitasDoDia(PZ.dia)]);
    PZ.plano = (pl?.paradas || []).filter(id => S.pdvs.some(p => p.id === id));
    PZ.visHoje = {}; vs.filter(v => v.tipo === 'prospeccao' || v.tipo === 'abertura').sort((a, b) => new Date(a.em) - new Date(b.em)).forEach(v => PZ.visHoje[v.pdv_id] = v.tipo === 'abertura' ? 'fechou' : (v.resultado || 'visitado'));
  } catch (e) { erro(e); }
  PZ.carregado = true; if (!PZ.plano.length) PZ.editando = true;
}
async function salvarPlanoAtual() { try { await db.salvarPlano(S.eu.id, PZ.dia, PZ.plano); } catch (e) { erro(e); } }
function pinoNum(cor, num, feito, alerta) {
  const w = 32, h = 42;
  return L.divIcon({ className: '', iconSize: [w, h], iconAnchor: [w / 2, h], tooltipAnchor: [0, -h * .8],
    html: `<div style="position:relative"><svg width="${w}" height="${h}" viewBox="0 0 30 40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35));opacity:${feito ? .75 : 1}"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 39 15 39s14-13.7 14-24.1C29 7.2 22.7 1 15 1z" fill="${cor}" stroke="rgba(0,0,0,.25)"/><circle cx="15" cy="14.5" r="9" fill="var(--card)"/></svg>
    <b style="position:absolute;left:0;right:0;top:7px;text-align:center;font:700 12px 'DM Sans',sans-serif;color:${cor}">${feito || num}</b>${alerta ? '<i style="position:absolute;right:-3px;top:-3px;width:12px;height:12px;border-radius:50%;background:#B8402A;border:2px solid var(--card)"></i>' : ''}</div>` });
}

async function telaProspeccao() {
  if (!PZ.carregado || PZ.dia !== hojeISO()) await carregarProsp();
  const canais = [...new Set(S.pdvs.filter(p => PROSP_ETAPAS.includes(p.etapa)).map(p => p.canal).filter(Boolean))].sort();
  $('#main').innerHTML = `<section class="view on" style="display:flex;height:100%"><div id="mapa" class="modo-prosp"><div id="lmap"></div>
   <div class="maptools"><button class="btn" id="zSair">← Sair do modo prospecção</button><button class="btn ${PZ.editando ? 'car' : ''}" id="zEditar">${PZ.editando ? 'Montando o plano…' : 'Editar plano'}</button>
   <button class="btn" id="bLoc">📍</button>
   <select id="zCanal"><option value="">Todos os canais</option>${canais.map(c => `<option ${PZ.canal === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
   <label class="regchk"><input type="checkbox" id="zAtivos" ${PZ.ativos ? 'checked' : ''}> Clientes ativos</label></div>
   <div class="prosp-tag">MODO PROSPECÇÃO</div></div><aside id="side" class="open"></aside></section>`;
  if (mapa) { mapa.remove(); mapa = null; }
  mapa = L.map('lmap', { zoomControl: false }).setView([-29.98, -51.18], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  camada = L.layerGroup().addTo(mapa);
  $('#zSair').onclick = () => { S.prosp = false; telaMapa(); };
  $('#zEditar').onclick = () => { PZ.editando = !PZ.editando; PZ.aberto = null; telaProspeccao(); };
  $('#zCanal').onchange = e => { PZ.canal = e.target.value; desenharProsp(); painelProsp(); };
  $('#zAtivos').onchange = e => { PZ.ativos = e.target.checked; desenharProsp(); };
  $('#bLoc').onclick = () => alternarLocalizacao();
  if (S.rastreando) { mostrarEu(false); $('#bLoc').classList.add('pri'); }
  desenharProsp(true); painelProsp();
}
function desenharProsp(enquadrar) {
  camada.clearLayers();
  const h = PZ.dia, filtroC = p => !PZ.canal || p.canal === PZ.canal;
  if (PZ.ativos) S.pdvs.filter(p => p.lat && CART.includes(p.etapa)).forEach(p => L.circleMarker([p.lat, p.lng], { radius: 4, color: '#9A8F86', weight: 1, fillColor: '#BDB3A8', fillOpacity: .8 }).bindTooltip(esc(p.nome) + ' · cliente').addTo(camada));
  const pl = pdvsPlano();
  if (PZ.editando) {
    candidatos().filter(filtroC).filter(p => !PZ.plano.includes(p.id)).forEach(p => L.marker([p.lat, p.lng], { icon: pino(etapa(p.etapa).c, .75, true), opacity: .9 }).bindTooltip(esc(p.nome) + ' · toque para incluir').on('click', () => { PZ.plano.push(p.id); salvarPlanoAtual(); desenharProsp(); painelProsp(); }).addTo(camada));
  } else {
    paradasDeCarro(pl).forEach((g, i) => { if (g.pts.length > 1) L.circle([g.c.lat, g.c.lng], { radius: 300, color: '#18181B', weight: 1, dashArray: '4 6', fillOpacity: .03, interactive: false }).addTo(camada);
      L.marker([g.c.lat, g.c.lng], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="pcarro">P${i + 1}</div>` }), zIndexOffset: -500 }).bindTooltip(`Parada de carro ${i + 1} · ${g.pts.length} visita${g.pts.length > 1 ? 's' : ''} a pé`).addTo(camada); });
  }
  pl.forEach((p, i) => { if (!filtroC(p)) return; const r = PZ.visHoje[p.id], res = RESULTADOS[r];
    const m = L.marker([p.lat, p.lng], { icon: pinoNum(res ? res.c : etapa(p.etapa).c, i + 1, res ? res.ic : (r ? '•' : null), p.acao_data && ymd(p.acao_data) <= h), zIndexOffset: PZ.aberto === p.id ? 1000 : 0 });
    m.bindTooltip(`${i + 1}. ${esc(p.nome)}`); m.on('click', () => { if (PZ.editando) { PZ.plano = PZ.plano.filter(x => x !== p.id); salvarPlanoAtual(); desenharProsp(); painelProsp(); } else { PZ.aberto = p.id; painelProsp(); desenharProsp(); } }); m.addTo(camada); });
  const pts = (pl.length ? pl : PZ.editando ? candidatos() : []).filter(filtroC);
  if (enquadrar && pts.length) mapa.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])).pad(.15));
}
function painelProsp() {
  const s = $('#side'); if (!s) return;
  if (PZ.editando) return painelPlano(s);
  if (PZ.aberto) return painelParada(s);
  const pl = pdvsPlano(), feitos = pl.filter(p => PZ.visHoje[p.id]).length, grupos = paradasDeCarro(pl), M = metas();
  const fechou = pl.filter(p => PZ.visHoje[p.id] === 'fechou').length;
  const carro = grupos.length ? `https://www.google.com/maps/dir/?api=1${S.minhaPos ? `&origin=${S.minhaPos.lat},${S.minhaPos.lng}` : ''}&destination=${grupos[grupos.length - 1].c.lat.toFixed(5)},${grupos[grupos.length - 1].c.lng.toFixed(5)}&waypoints=${grupos.slice(0, -1).slice(0, 9).map(g => `${g.c.lat.toFixed(5)},${g.c.lng.toFixed(5)}`).join('%7C')}&travelmode=driving` : null;
  const ape = g => `https://www.google.com/maps/dir/?api=1&origin=${g.c.lat.toFixed(5)},${g.c.lng.toFixed(5)}&destination=${g.c.lat.toFixed(5)},${g.c.lng.toFixed(5)}&waypoints=${g.pts.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('%7C')}&travelmode=walking`;
  let n = 0;
  s.innerHTML = `<h2>Plano de hoje</h2>
  <div class="kv" style="margin:6px 0 10px"><div><small>Visitas feitas</small><b>${feitos} / ${pl.length}</b><small>meta ${M.visitas_dia}/dia</small></div><div><small>Fechamentos</small><b>${fechou} / ${M.vendas_dia}</b><small>meta do dia</small></div></div>
  ${barra(feitos, pl.length || 1)}
  <div class="actions" style="margin:12px 0"><button class="btn pri" id="zOtim">Otimizar rota ${S.minhaPos ? 'a partir de onde estou' : ''}</button>${carro ? `<a class="btn car" href="${carro}" target="_blank" rel="noopener">Rota de carro no Google Maps ↗</a>` : ''}</div>
  ${grupos.map((g, i) => `<div class="grupo"><div class="row" style="justify-content:space-between"><b>P${i + 1} · parada de carro</b>${g.pts.length > 1 ? `<a href="${ape(g)}" target="_blank" rel="noopener" style="font-size:12px">circuito a pé ↗</a>` : ''}</div>
   ${g.pts.map(p => { n++; const r = PZ.visHoje[p.id], res = RESULTADOS[r]; return `<div class="parada ${r ? 'feita' : ''}" data-par="${p.id}"><span class="num" style="background:${res ? res.c : etapa(p.etapa).c}">${res ? res.ic : n}</span><div style="flex:1"><b>${esc(p.nome)}</b><br><small>${esc(p.canal || '')} · ${etapa(p.etapa).n}${res ? ' · ' + res.n : ''}</small>${p.acao_data && ymd(p.acao_data) <= PZ.dia ? `<br><small style="color:#B8402A">tarefa: ${esc(p.acao_titulo)}</small>` : ''}</div></div>`; }).join('')}</div>`).join('') || '<p class="empty">Plano vazio. Toque em "Editar plano" para montar.</p>'}`;
  $('#zOtim').onclick = () => { const ord = ordenarRota(pl, S.minhaPos || null); PZ.plano = ord.map(p => p.id).concat(PZ.plano.filter(id => !ord.some(p => p.id === id))); salvarPlanoAtual(); desenharProsp(true); painelProsp(); toast(S.minhaPos ? 'Rota otimizada a partir da sua posição' : 'Rota otimizada. Ligue o 📍 para partir de onde você está.'); };
  s.querySelectorAll('[data-par]').forEach(d => d.onclick = () => { PZ.aberto = d.dataset.par; const p = S.pdvs.find(x => x.id === PZ.aberto); painelProsp(); desenharProsp(); mapa.setView([p.lat, p.lng], 17); });
}
function painelPlano(s) {
  const pl = pdvsPlano(), bl = blocos(), regs = S.base.regioes.filter(r => candidatos().some(p => p.regiao === r.codigo));
  s.innerHTML = `<h2>Montar plano do dia</h2><p style="color:var(--soft);margin-top:0">Escolha um bloco pronto, uma região ou toque nos pinos tracejados para incluir. Toque numa parada numerada para tirar.</p>
  <div class="sect"><h3>Blocos sugeridos (por proximidade)</h3>${bl.slice(0, 6).map((b, i) => `<div class="stop" style="padding:8px 10px;cursor:pointer" data-bl="${i}"><div class="info"><b>${esc(b.nome || 'Bloco ' + (i + 1))}</b><br><small style="color:var(--mute)">${b.pts.length} prospects · ${b.reg || ''}</small></div><span class="badge">usar</span></div>`).join('') || '<p class="empty">Sem prospects mapeados. Cadastre pontos ou importe em Uploads.</p>'}</div>
  <div class="sect"><h3>Ou por região</h3><div class="row"><select id="zReg" style="flex:1">${regs.map(r => `<option value="${r.codigo}">${r.codigo} · ${esc(r.nome)} (${candidatos().filter(p => p.regiao === r.codigo).length})</option>`).join('')}</select><button class="btn" id="zRegOk">Usar</button></div></div>
  <div class="sect"><h3>Paradas do plano (${pl.length})</h3>${pl.map((p, i) => `<div class="parada"><span class="num" style="background:${etapa(p.etapa).c}">${i + 1}</span><div style="flex:1"><b>${esc(p.nome)}</b><br><small>${esc(p.canal || '')} · ${etapa(p.etapa).n}</small></div><button class="mini" data-tira="${p.id}">tirar</button></div>`).join('') || '<p class="empty" style="padding:4px 0">Nenhuma parada ainda.</p>'}</div>
  <div class="actions"><button class="btn pri" id="zPronto" ${pl.length ? '' : 'disabled'}>Pronto: otimizar rota e sair</button>${pl.length ? '<button class="btn" id="zLimpar">Limpar plano</button>' : ''}</div>`;
  const usar = lista => { const extra = candidatos().filter(p => p.acao_data && ymd(p.acao_data) <= PZ.dia && !lista.includes(p) && lista.some(q => distM(p, q) < 1500));
    PZ.plano = ordenarRota([...lista, ...extra].slice(0, 20), S.minhaPos || null).map(p => p.id); salvarPlanoAtual(); desenharProsp(true); painelProsp(); toast(`${PZ.plano.length} paradas no plano`); };
  s.querySelectorAll('[data-bl]').forEach(d => d.onclick = () => usar(bl[+d.dataset.bl].pts));
  if ($('#zRegOk')) $('#zRegOk').onclick = () => usar(candidatos().filter(p => p.regiao === $('#zReg').value && (!PZ.canal || p.canal === PZ.canal)).sort((a, b) => prioridade(b) - prioridade(a)).slice(0, 18));
  s.querySelectorAll('[data-tira]').forEach(b => b.onclick = () => { PZ.plano = PZ.plano.filter(x => x !== b.dataset.tira); salvarPlanoAtual(); desenharProsp(); painelProsp(); });
  $('#zPronto').onclick = () => { PZ.plano = ordenarRota(pdvsPlano(), S.minhaPos || null).map(p => p.id); salvarPlanoAtual(); PZ.editando = false; telaProspeccao(); };
  if ($('#zLimpar')) $('#zLimpar').onclick = () => { PZ.plano = []; salvarPlanoAtual(); desenharProsp(); painelProsp(); };
}
function painelParada(s) {
  const p = S.pdvs.find(x => x.id === PZ.aberto); if (!p) { PZ.aberto = null; return painelProsp(); }
  const i = PZ.plano.indexOf(p.id), r = PZ.visHoje[p.id], c = S.contatos.find(x => x.id === p.contato_id);
  s.innerHTML = `<button class="btn" id="zVolta" style="padding:4px 10px">← Plano</button>
  <small style="display:block;color:var(--mute);margin-top:10px">Parada ${i + 1} · ${esc(p.canal || '')} · ${etapa(p.etapa).n}</small><h2>${esc(p.nome)}</h2>
  <p style="color:var(--soft);margin:4px 0">${esc([p.endereco, p.bairro].filter(Boolean).join(' · '))}</p>
  ${c ? `<p style="margin:4px 0">Contato: <b>${esc(c.nome)}</b>${c.cargo ? ' (' + esc(c.cargo) + ')' : ''}${c.telefone ? ' · ' + esc(c.telefone) : ''}</p>` : ''}
  ${janelaTxt(p) || p.melhor_horario ? `<p style="margin:4px 0">🕘 <b>${esc([janelaTxt(p), p.melhor_horario].filter(Boolean).join(' · '))}</b></p>` : ''}${p.fornecedor_atual ? `<p style="margin:4px 0">Fornecedor atual: <b>${esc(p.fornecedor_atual)}</b></p>` : ''}
  ${p.observacao ? `<p style="margin:4px 0;font-size:13px;color:var(--soft)">${esc(p.observacao)}</p>` : ''}
  ${p.acao_data ? `<p style="margin:4px 0">${chipAcao(p)}</p>` : ''}
  ${r ? `<div class="esteira" style="background:var(--bg-ok);border-color:#BFD9C6"><b>Visitado hoje:</b> ${RESULTADOS[r]?.n || 'visita registrada'}</div>` : ''}
  <div class="sect"><h3>Como foi a visita?</h3><div class="resultados">${Object.entries(RESULTADOS).map(([k, v]) => `<button data-res="${k}" style="--c:${v.c}"><span>${v.ic}</span>${v.n}</button>`).join('')}</div></div>
  <div class="actions"><button class="btn" id="zPerfil">Abrir perfil</button>${p.lat ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking">Ir a pé até aqui ↗</a>` : ''}<button class="btn" id="zTirar">Tirar do plano</button>${p.etapa === 'mapeado' ? `<button class="btn" id="zExMapa" style="color:#B8402A">Excluir do mapa</button>` : ''}</div>`;
  $('#zVolta').onclick = () => { PZ.aberto = null; painelProsp(); desenharProsp(); };
  $('#zPerfil').onclick = () => abrirPerfil(p.id);
  $('#zTirar').onclick = () => { PZ.plano = PZ.plano.filter(x => x !== p.id); PZ.aberto = null; salvarPlanoAtual(); painelProsp(); desenharProsp(); };
  if ($('#zExMapa')) $('#zExMapa').onclick = () => excluirDoMapa(p, () => { PZ.plano = PZ.plano.filter(x => x !== p.id); PZ.aberto = null; salvarPlanoAtual(); painelProsp(); desenharProsp(); });
  s.querySelectorAll('[data-res]').forEach(b => b.onclick = () => resultadoVisita(p, b.dataset.res));
}
async function concluirParada(p, res, toastTxt) {
  PZ.visHoje[p.id] = res; await atualizarUm(p.id);
  const prox = pdvsPlano().find(x => !PZ.visHoje[x.id]);
  PZ.aberto = null; if (S.aba === 'mapa' && S.prosp) { painelProsp(); desenharProsp(); }
  toast(toastTxt + (prox ? ` Próxima: ${prox.nome}.` : ' Plano do dia concluído!'));
}
const avancar = (p, para) => (p.etapa === 'mapeado' || (para === 'negociacao' && p.etapa === 'visitado')) ? db.atualizarPdv(p.id, { etapa: para }) : null;
function resultadoVisita(p, res) {
  const nomeT = `<b>${esc(p.nome)}</b>`;
  if (res === 'fechou') { (async () => { try { await db.registrarVisita(p.id, 'prospeccao', null, S.eu.id, 'fechou'); await avancar(p, 'negociacao'); PZ.visHoje[p.id] = 'fechou'; await atualizarUm(p.id); S.abPdv = p.id; irPara('abertura'); toast('Fechou! Lance a venda e volte ao mapa para a próxima parada.'); } catch (e) { erro(e); } })(); return; }
  if (res === 'sem_interesse') { (async () => { try { await db.registrarVisita(p.id, 'prospeccao', null, S.eu.id, 'sem_interesse'); PZ.visHoje[p.id] = 'sem_interesse'; mudarEtapa(p.id, 'perdido', () => concluirParada(p, 'sem_interesse', 'Registrado como perdido.')); setTimeout(() => { if ($('#mMot')) $('#mMot').value = 'Sem interesse'; }, 0); } catch (e) { erro(e); } })(); return; }
  const tarefaHtml = (titulo, dias, tipo, marcado = true) => `<div class="esteira" style="background:var(--bg-info);border-color:#C9D7EA"><label style="display:flex;gap:8px;align-items:center;margin:0;font-weight:700"><input type="checkbox" id="rTar" ${marcado ? 'checked' : ''} style="width:auto"> Criar tarefa</label>
    <input id="rTit" value="${esc(titulo)}" style="width:100%;margin-top:6px"><div class="row" style="margin-top:6px"><input id="rData" type="date" value="${daqui(dias)}" style="flex:1"><input id="rHora" type="time" style="flex:1"><select id="rTipo" style="flex:1">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v.n}</option>`).join('')}</select></div></div>`;
  const criarTar = async () => { if (!$('#rTar')?.checked) return; await db.criarTarefa({ titulo: $('#rTit').value.trim() || 'Retorno', tipo: $('#rTipo').value, data: $('#rData').value, hora: $('#rHora').value || null, pdv_id: p.id, contato_id: p.contato_id || null, dono: S.eu.id }); };
  if (res === 'pensar') {
    modal(`<h3>Vai pensar · ${esc(p.nome)}</h3><label>Retorno por</label><div class="pay" id="rCanal"><label><input type="radio" name="rc" value="whatsapp" checked> WhatsApp</label><label><input type="radio" name="rc" value="visita"> Visita</label><label><input type="radio" name="rc" value="ligacao"> Ligação</label></div>
    <label>Anotação</label><textarea id="rObs" rows="2" placeholder="O que ficou de pensar, objeções…"></textarea>${tarefaHtml('Retorno: ' + p.nome + ' (vai pensar)', 2, 'whatsapp')}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="rOk">Salvar</button></div>`);
    $('#rCanal').onchange = () => { $('#rTipo').value = document.querySelector('input[name=rc]:checked').value; };
    $('#rOk').onclick = async () => { try { await db.registrarVisita(p.id, 'prospeccao', $('#rObs').value.trim() || null, S.eu.id, 'pensar'); await avancar(p, 'negociacao'); await criarTar(); fecharModal(); completarCadastro(p, () => concluirParada(p, 'pensar', 'Anotado: vai pensar.')); } catch (e) { erro(e); } };
    return;
  }
  if (res === 'nao_estava') {
    modal(`<h3>Não estava · ${esc(p.nome)}</h3>
    <div class="row"><div style="flex:1"><label>Nome do dono</label><input id="rDono" placeholder="se souber"></div><div style="flex:1"><label>Telefone do dono</label><input id="rTel" inputmode="tel"></div></div>
    <label>Melhor dia e horário para encontrar</label><input id="rHor" value="${esc(p.melhor_horario || '')}" placeholder="Ex.: terça e quinta, 9h às 11h">
    <div class="row"><div style="flex:1"><label>Com quem falou</label><input id="rQuem" placeholder="Nome"></div><div style="flex:1"><label>Cargo</label><select id="rCargo">${CARGOS.map(c => `<option ${c === 'Funcionário' ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
    ${tarefaHtml('Voltar em ' + p.nome + ' (falar com o dono)', 1, 'visita')}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="rOk">Salvar</button></div>`);
    $('#rOk').onclick = async () => {
      try {
        const tel = $('#rTel').value.trim(), dono = $('#rDono').value.trim(), hor = $('#rHor').value.trim(), quem = $('#rQuem').value.trim();
        let contato_id = p.contato_id || null;
        if (tel || dono) contato_id = await obterContato({ nome: dono || 'Dono · ' + p.nome, telefone: tel, whatsapp: tel, cargo: 'Dono', empresa: p.nome });
        const obs = [quem ? `Falou com ${quem} (${$('#rCargo').value})` : null, hor ? `Melhor horário: ${hor}` : null].filter(Boolean).join(' · ') || null;
        await db.registrarVisita(p.id, 'prospeccao', obs, S.eu.id, 'nao_estava');
        await db.atualizarPdv(p.id, { melhor_horario: hor || p.melhor_horario || null, contato_id, ...(p.etapa === 'mapeado' ? { etapa: 'visitado' } : {}) });
        if ($('#rTar').checked) await db.criarTarefa({ titulo: $('#rTit').value.trim() || 'Voltar', tipo: $('#rTipo').value, data: $('#rData').value, hora: $('#rHora').value || null, pdv_id: p.id, contato_id, descricao: hor ? 'Melhor horário: ' + hor : null, dono: S.eu.id });
        fecharModal(); completarCadastro(S.pdvs.find(x => x.id === p.id) || p, () => concluirParada(p, 'nao_estava', 'Anotado: não estava.'), true);
      } catch (e) { erro(e); } };
    return;
  }
  if (res === 'fornecedor') {
    modal(`<h3>Já tem fornecedor · ${esc(p.nome)}</h3><label>Qual fornecedor?</label><input id="rForn" value="${esc(p.fornecedor_atual || '')}" placeholder="Marca ou distribuidor">
    <label>Anotação</label><textarea id="rObs" rows="2" placeholder="Preço que paga, giro, o que gostaria de melhorar…"></textarea>${tarefaHtml('Voltar em ' + p.nome + ' (tem fornecedor)', 60, 'visita')}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="rOk">Salvar</button></div>`);
    $('#rOk').onclick = async () => { try { const f = $('#rForn').value.trim(); await db.registrarVisita(p.id, 'prospeccao', [f ? 'Fornecedor: ' + f : null, $('#rObs').value.trim() || null].filter(Boolean).join(' · ') || null, S.eu.id, 'fornecedor');
      await db.atualizarPdv(p.id, { fornecedor_atual: f || null, ...(p.etapa === 'mapeado' ? { etapa: 'visitado' } : {}) }); await criarTar(); fecharModal(); completarCadastro(p, () => concluirParada(p, 'fornecedor', 'Anotado: já tem fornecedor.')); } catch (e) { erro(e); } };
  }
}
// alertas de prospecção para o painel: visitados sem próxima ação
function alertasProsp() {
  return S.pdvs.filter(p => PROSP_ETAPAS.includes(p.etapa) && p.ultima_prospeccao && !p.acao_data)
    .sort((a, b) => (b.ultimo_resultado === 'nao_estava') - (a.ultimo_resultado === 'nao_estava') || new Date(b.ultima_prospeccao) - new Date(a.ultima_prospeccao));
}


/* =================== integração Bling =================== */
const quandoB = d => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const resumoSync = r => r ? `${r.lidos ?? 0} pedidos lidos · ${r.novos ?? 0} novos · ${r.atualizados ?? 0} atualizados${r.cancelados ? ` · ${r.cancelados} cancelados removidos` : ''}${r.sem_cliente ? ` · ${r.sem_cliente} sem cliente no app` : ''}${r.status_mudou ? ` · ${r.status_mudou} mudaram de ativo/inativo` : ''}${r.removidos ? ` · ${r.removidos} excluídos no Bling removidos do app` : ''}${r.contatos_atualizados ? ` · ${r.contatos_atualizados} contatos atualizados do Bling` : ''}${r.contatos_erro ? ` · contatos: ${r.contatos_erro}` : ''}` : '';
async function painelBling() {
  const el = $('#blingPanel'); if (!el) return;
  let s; try { s = await db.bling('status'); } catch (e) { el.innerHTML = `<h3>Integração com o Bling</h3><p style="color:var(--soft)">A função do Bling ainda não está instalada no Supabase.</p><small style="color:var(--mute)">${esc(e.message)}</small>`; return; }
  el.innerHTML = `<h3>Integração com o Bling</h3>
   ${!s.configurado ? '<p style="color:var(--t-bad)">Falta cadastrar BLING_CLIENT_ID e BLING_CLIENT_SECRET nos segredos do Supabase.</p>' : ''}
   <div class="kv" style="margin:6px 0 10px"><div><small>Situação</small><b>${s.conectado ? 'Conectado' : 'Não conectado'}</b><small>${s.conectado ? 'desde ' + quandoB(s.conectado_em) : ''}</small></div><div><small>Última sincronização</small><b>${quandoB(s.ultima_sync)}</b><small>${esc(resumoSync(s.ultimo_resultado))}</small></div></div>
   ${s.ultimo_erro ? `<p style="color:var(--t-bad);font-size:13px">Último erro: ${esc(s.ultimo_erro)}</p>` : ''}
   <p style="color:var(--soft);margin-top:0">Os pedidos do Bling entram sozinhos ao abrir o app (no máximo a cada 15 minutos). Clientes ficam Ativos ou Inativos pela regra dos 90 dias.</p>
   <div class="row" style="flex-wrap:wrap">${s.conectado ? '<button class="btn pri" id="bSync">Sincronizar agora</button><button class="btn" id="bCont">Puxar contatos do Bling</button><button class="btn" id="bItens">Puxar itens dos pedidos</button><button class="btn" id="bCon">Reconectar</button>' : `<button class="btn pri" id="bCon" ${s.configurado ? '' : 'disabled'}>Conectar ao Bling</button>`}</div><div id="bRes" style="margin-top:8px"></div>`;
  $('#bCon').onclick = async () => { try { const r = await db.bling('conectar'); location.href = r.url; } catch (e) { erro(e); } };
  if ($('#bItens')) $('#bItens').onclick = async () => { const b = $('#bItens'); b.disabled = true; let feitos = 0, erros = 0;
    try { for (let volta = 0; volta < 40; volta++) { const r = await db.bling('itens'); feitos += r.feitos; erros += r.erros; $('#bRes').innerHTML = `<small>Lendo os itens dos pedidos no Bling… ${feitos} pedidos lidos, faltam ${r.faltam}</small>`; if (r.fim || !r.feitos) break; }
      $('#bRes').innerHTML = `<b>Itens de ${feitos} pedidos gravados${erros ? ` · ${erros} com erro (tente de novo)` : ''}.</b> Agora dá para analisar a saída por produto e sabor.`; toast('Itens dos pedidos atualizados');
    } catch (e) { $('#bRes').innerHTML = `<span style="color:var(--t-bad)">${esc(e.message)}</span>`; } b.disabled = false; };
  if ($('#bCont')) $('#bCont').onclick = async () => { const b = $('#bCont'); b.disabled = true; let ini = 0, tot = { criados: 0, completados: 0, sem_dados: 0, nao_achados: 0 };
    try { for (let volta = 0; volta < 40; volta++) { $('#bRes').innerHTML = `<small>Lendo contatos no Bling… ${ini} clientes</small>`;
        const r = await db.bling('contatos', { inicio: ini }); ['criados', 'completados', 'sem_dados', 'nao_achados'].forEach(k => tot[k] += r[k] || 0); ini = r.feitos;
        $('#bRes').innerHTML = `<small>Lendo contatos no Bling… ${r.feitos} de ${r.total} clientes</small>`; if (r.fim) break; }
      await recarregar(); const falta = S.pdvs.filter(p => faltaContato(p).length).length;
      $('#bRes').innerHTML = `<b>${tot.criados} contatos criados · ${tot.completados} completados · ${tot.sem_dados} sem dados no Bling${tot.nao_achados ? ` · ${tot.nao_achados} não achados no Bling` : ''}.</b><br><small>${falta} clientes ainda com ⚠️ dados faltando (filtro em Negócios).</small>`; toast('Contatos atualizados');
    } catch (e) { $('#bRes').innerHTML = `<span style="color:var(--t-bad)">${esc(e.message)}</span>`; } b.disabled = false; };
  if ($('#bSync')) $('#bSync').onclick = async () => { const b = $('#bSync'); b.disabled = true; $('#bRes').innerHTML = '<small>Lendo pedidos do Bling…</small>'; try { const r = await db.bling('sincronizar'); S.blingSync = Date.now(); await recarregar(); toast('Bling sincronizado'); $('#bRes').innerHTML = `<b>${esc(resumoSync(r))}</b>`; setTimeout(painelBling, 1500); } catch (e) { $('#bRes').innerHTML = `<span style="color:var(--t-bad)">${esc(e.message)}</span>`; b.disabled = false; } };
}
// o Pedidook foi descontinuado: tira o "Pedidook cód. N" que veio na importação da carteira
async function limparPedidook() {
  const sujos = S.pdvs.filter(p => /Pedidook cód\./.test(p.observacao || ''));
  for (const p of sujos) {
    const obs = (p.observacao || '').replace(/Pedidook cód\.\s*\S+(\s*·\s*)?/g, '').replace(/^[\s·]+|[\s·]+$/g, '') || null;
    try { await db.atualizarPdv(p.id, { observacao: obs }); p.observacao = obs; } catch (e) { console.warn(e); return; }
  }
  if (sujos.length && S.aba === 'perfil') telaPerfil();
}
const dataLonga = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
// pequena análise do fluxo de pedidos de um cliente
// produtos que mais saem num cliente: soma os itens de todos os pedidos (app e Bling)
function maisSaem(it, peds) {
  const porCod = {}; S.base.produtos.forEach(p => { if (p.bling_codigo) porCod[p.bling_codigo] = p; });
  const prodId = Object.fromEntries(S.base.produtos.map(p => [p.id, p])), comItensApp = new Set(it.pitens.map(i => i.pedido_id)), t = {};
  const soma = (pr, nome, q, v) => { const k = pr ? pr.id : nome; t[k] = t[k] || { n: pr ? pr.sabor : nome, l: pr ? pr.linha : '', cod: pr?.bling_codigo || '', q: 0, v: 0 }; t[k].q += q; t[k].v += v; };
  it.pitens.forEach(i => soma(prodId[i.produto_id], 'Produto ' + i.produto_id, +i.quantidade, +i.quantidade * +i.preco_unit));
  it.bitens.filter(i => !comItensApp.has(i.pedido_id)).forEach(i => soma(porCod[i.codigo], i.codigo, +i.quantidade, +i.quantidade * +i.valor - (+i.desconto || 0)));
  const l = Object.values(t).sort((a, b) => b.q - a.q); if (!l.length) return '';
  const tot = l.reduce((a, x) => a + x.q, 0), mx = l[0].q, nPed = new Set([...it.pitens.map(i => i.pedido_id), ...it.bitens.map(i => i.pedido_id)]).size || peds.length;
  const cor = c => c.startsWith('C') ? '#eb6834' : c.startsWith('P') ? '#1baf7a' : '#2a78d6';
  const linhas = {}; l.forEach(x => { const k = (x.l || 'Outros').split(' ')[0]; linhas[k] = (linhas[k] || 0) + x.q; });
  return `<div class="panel"><h3>Produtos que mais saem</h3><div class="mslinhas">${Object.entries(linhas).sort((a, b) => b[1] - a[1]).map(([k, q]) => `<span><b>${Math.round(q / tot * 100)}%</b> ${esc(k)}</span>`).join('')}</div>
   <div class="bars">${l.map(x => `<div class="bar" style="grid-template-columns:minmax(0,1.4fr) 1fr 64px"><span>${esc(x.n)} <small style="color:var(--mute)">· ${esc((x.l || '').split(' ')[0])}</small></span><div class="tr"><div class="fl" style="width:${x.q / mx * 100}%;background:${cor(x.cod)}"></div></div><b style="text-align:right">${fmt(x.q)} <small style="font-weight:400;color:var(--mute)">${Math.round(x.q / tot * 100)}%</small></b></div>`).join('')}</div>
   <small style="color:var(--mute);display:block;margin-top:8px">${fmt(tot)} unidades em ${nPed} pedidos · média de ${dec(tot / Math.max(1, nPed))} un. por pedido</small></div>`;
}
function fluxoPedidos(peds, lateral) {
  if (!peds.length) return '';
  const ds = peds.map(o => new Date(o.criado_em)).sort((a, b) => a - b), vals = peds.map(o => Number(o.valor) || 0);
  const total = vals.reduce((a, b) => a + b, 0), ticket = total / peds.length;
  const gaps = ds.slice(1).map((d, i) => (d - ds[i]) / DIA).filter(g => g > 0.5);
  const inter = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  const ult = ds[ds.length - 1], semPedido = Math.floor((Date.now() - ult) / DIA);
  // meses (últimos 12)
  const hoje = new Date(), meses = [];
  for (let i = 11; i >= 0; i--) { const m = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1); meses.push({ k: m.getFullYear() + '-' + m.getMonth(), n: m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), v: 0, q: 0 }); }
  peds.forEach(o => { const d = new Date(o.criado_em), m = meses.find(x => x.k === d.getFullYear() + '-' + d.getMonth()); if (m) { m.v += Number(o.valor) || 0; m.q++; } });
  const max = Math.max(...meses.map(m => m.v), 1);
  // leitura
  let leitura, cor;
  if (peds.length === 1) { leitura = `Fez só 1 pedido, há ${semPedido} dias. Ainda não tem ritmo de compra.`; cor = semPedido > 45 ? '#B8402A' : '#8C7E74'; }
  else {
    const atraso = semPedido / inter;
    if (atraso <= 1.3) { leitura = `No ritmo: compra a cada ${Math.round(inter)} dias em média e o último pedido foi há ${semPedido} dias.`; cor = '#2F7D4E'; }
    else if (atraso <= 2.5) { leitura = `Atrasado: comprava a cada ${Math.round(inter)} dias e está há ${semPedido} dias sem pedido. Vale um contato.`; cor = '#D08A3C'; }
    else { leitura = `Parou de comprar: o ritmo era a cada ${Math.round(inter)} dias e já são ${semPedido} dias sem pedido (${atraso.toFixed(1).replace('.', ',')}× o normal).`; cor = '#B8402A'; }
    const meio = Math.floor(vals.length / 2), a1 = vals.slice(0, meio), a2 = vals.slice(meio);
    if (a1.length >= 2 && a2.length >= 2) { const m1 = a1.reduce((a, b) => a + b, 0) / a1.length, m2 = a2.reduce((a, b) => a + b, 0) / a2.length, var_ = (m2 - m1) / m1;
      if (Math.abs(var_) >= .15) leitura += ` O valor por pedido ${var_ > 0 ? 'subiu' : 'caiu'} ${Math.round(Math.abs(var_) * 100)}% na segunda metade do histórico.`; }
  }
  return `<div class="${lateral ? 'sect' : 'panel'}">${lateral ? '<h3>Métricas</h3>' : '<div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 style="margin:0">Fluxo de pedidos</h3><button class="btn" id="pDetPed">Detalhes →</button></div>'}
   <div class="kv" style="margin:0 0 10px">${lateral ? `<div><small>Total comprado</small><b>${brl(total)}</b><small>${peds.length} pedido${peds.length === 1 ? '' : 's'} desde ${dataLonga(ds[0])}</small></div>` : ''}<div><small>Ticket médio</small><b>${brl(ticket)}</b></div><div><small>Compra a cada</small><b>${inter ? Math.round(inter) + ' dias' : '—'}</b></div><div><small>Último pedido</small><b>${dataLonga(ult)}</b><small>há ${semPedido} dias</small></div><div><small>Próximo esperado</small><b>${inter ? dataLonga(new Date(+ult + inter * DIA)) : '—'}</b></div></div>
   <div class="fluxo">${meses.map(m => `<div title="${m.n}: ${m.q} pedido${m.q === 1 ? '' : 's'} · ${brl(m.v)}"><i style="height:${Math.round(m.v / max * 100)}%"></i><small>${m.n}</small></div>`).join('')}</div>
   <p style="margin:10px 0 0;font-size:13px;border-left:3px solid ${cor};padding-left:8px">${leitura}</p>${lateral ? checarRegras(peds, inter, semPedido) : ''}</div>`;
}
// confere o histórico de pedidos com as regras de Regras e metas (esteira de avaliação)
function checarRegras(peds, inter, semPedido) {
  const ra = regraAval(), cad = cadPadrao().avaliacao || 7;
  const uns = peds.map(o => Number(o.unidades) > 0 ? Number(o.unidades) : Math.round((Number(o.valor) || 0) / 4.6)), mediaUn = uns.reduce((a, b) => a + b, 0) / uns.length;
  const itens = [
    [inter != null && inter <= cad * 2, `Frequência: ${inter == null ? 'só 1 pedido, sem ritmo ainda' : `compra a cada ${Math.round(inter)} dias`} · regra: reposição a cada ${cad} dias (aceita até ${cad * 2})`],
    [mediaUn >= ra.meta_minima_sellout, `Volume: cerca de ${Math.round(mediaUn)} un. por pedido · regra: mínimo ${ra.meta_minima_sellout} un. por reposição`],
    [semPedido <= 90, `Recência: último pedido há ${semPedido} dias · regra: até 90 dias`]];
  const ok = itens.every(i => i[0]);
  return `<div class="regcheck ${ok ? 'ok' : 'nao'}"><b>${ok ? '✓ Dentro das regras para a avaliação' : '✕ Fora das regras para a avaliação'}</b>${itens.map(([b, t]) => `<div>${b ? '✓' : '✕'} ${t}</div>`).join('')}</div>`;
}
async function enviarAoBling(pedidoId, nome) {
  toast('Criando o pedido no Bling…');
  try { const r = await db.bling('enviar_pedido', { pedido_id: pedidoId });
    modal(`<h3>Pedido criado no Bling ✓</h3><p>${esc(nome)} · <b>pedido nº ${esc(r.numero || r.bling_id)}</b>, situação Em aberto.</p><p style="color:var(--soft)">O Moisés já encontra o pedido no Bling para conferir e emitir a nota.</p>${(r.alertas || []).length ? `<p style="color:var(--car-d);font-size:13px">Avisos do Bling: ${esc(JSON.stringify(r.alertas))}</p>` : ''}<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn pri" onclick="fecharModal()">Ok</button></div>`);
  } catch (e) { modal(`<h3>O Bling não aceitou o pedido</h3><p style="color:var(--soft)">A venda ficou salva no app. Corrija o que o Bling pediu e reenvie pelo perfil do cliente.</p><p style="font-size:13px;color:var(--t-bad)">${esc(e.message)}</p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn pri" onclick="fecharModal()">Ok</button></div>`); }
}
async function syncBlingAuto() {
  try { if (S.blingSync && Date.now() - S.blingSync < 15 * 60000) return;
    const s = await db.bling('status'); if (!s.conectado) return;
    if (s.ultima_sync && Date.now() - new Date(s.ultima_sync) < 15 * 60000) { S.blingSync = new Date(s.ultima_sync).getTime(); return; }
    S.blingSync = Date.now(); const r = await db.bling('sincronizar');
    if (r.novos) db.bling('itens').catch(() => { });
    if (r.novos || r.cancelados || r.status_mudou || r.removidos) { await recarregar(); if (S.aba === 'mapa' && !S.prosp) { desenhar(); } toast(`Bling: ${r.novos} pedido${r.novos === 1 ? '' : 's'} novo${r.novos === 1 ? '' : 's'}`); }
  } catch (e) { console.warn('Bling', e); }
}
/* =================== início =================== */
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });
iniciar();

/* =================== ditado por voz nos campos de observação =================== */
// botão 🎤 ao lado de toda caixa de observação/motivo: fala e o texto entra no campo (reconhecimento de voz do navegador, em português)
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
  const ALVO = el => !/hor|tel|mail|cnpj|cep|num|link|busca/i.test(el.id || '') && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (!el.type || el.type === 'text') && /obs|txt|mot|hist|EntO|^ncH$|^lxH$|^bxH$|nota|coment|desc/i.test((el.id || '') + ' ' + (el.className || '') + ' ' + (el.placeholder || ''))));
  let rec = null, ativo = null;
  const parar = () => { try { rec && rec.stop(); } catch (e) { } };
  const ouvir = (campo, btn) => {
    if (ativo === btn) return parar();
    parar(); rec = new SR(); rec.lang = 'pt-BR'; rec.continuous = true; rec.interimResults = true;
    const base = campo.value ? campo.value.replace(/\s*$/, ' ') : ''; let final = '';
    rec.onresult = e => { let parcial = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else parcial += t; }
      const txt = (final + parcial).trim(); campo.value = base + (txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : ''); campo.dispatchEvent(new Event('input', { bubbles: true })); };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Permita o microfone para este site no navegador'); else if (e.error !== 'aborted' && e.error !== 'no-speech') toast('Não consegui ouvir: ' + e.error); };
    rec.onend = () => { btn.classList.remove('ouvindo'); btn.title = 'Falar (ditado)'; if (ativo === btn) ativo = null; campo.dispatchEvent(new Event('change', { bubbles: true })); };
    try { rec.start(); ativo = btn; btn.classList.add('ouvindo'); btn.title = 'Ouvindo… toque para parar'; campo.focus(); } catch (e) { toast('Microfone indisponível'); }
  };
  const decorar = el => { if (el.dataset.voz || !ALVO(el) || el.closest('.calfx')) return; el.dataset.voz = 1;
    const w = document.createElement('span'); w.className = 'vozbox'; el.parentNode.insertBefore(w, el); w.appendChild(el);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'vozbtn'; b.title = 'Falar (ditado)'; b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); ouvir(el, b); }; w.appendChild(b); };
  const varrer = raiz => { if (!raiz.querySelectorAll) return; if (raiz.matches?.('textarea,input')) decorar(raiz); raiz.querySelectorAll('textarea,input').forEach(decorar); };
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(varrer))).observe(document.body, { childList: true, subtree: true });
  varrer(document.body);
})();
