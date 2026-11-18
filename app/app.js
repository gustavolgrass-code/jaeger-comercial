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
function erro(e) { console.error(e); toast('Erro: ' + (e.message || e)); }
function modal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.add('on'); }
function fecharModal() { $('#modal').classList.remove('on'); }
window.fecharModal = fecharModal;

/* =================== catálogos =================== */
const ETAPAS = [
  { k: 'mapeado', n: 'Mapeado', c: '#8C7E74' }, { k: 'visitado', n: 'Visitado', c: '#3F6FA8' },
  { k: 'negociacao', n: 'Em negociação', c: '#D08A3C' }, { k: 'perdido', n: 'Perdido', c: '#9A8F86' }, { k: 'avaliacao', n: 'Em avaliação', c: '#6B4FA0' },
  { k: 'revisao', n: 'Revisão comercial', c: '#A23B72' }, { k: 'ativo', n: 'Ativo', c: '#2F7D4E' },
  { k: 'risco', n: 'Em risco', c: '#B8402A' }, { k: 'inativo', n: 'Inativo', c: '#4A3A31' }];
const etapa = k => ETAPAS.find(e => e.k === k) || ETAPAS[0];
const CANAIS = ['Minimercado', 'Padaria', 'Fruteira', 'Cantina', 'Conveniência', 'Cafeteria', 'Restaurante', 'Lancheria', 'Outro'];
const CONDICOES = ['À vista · dinheiro', 'À vista · Pix', 'A prazo · 7 dias', 'A prazo · 14 dias', 'A prazo · 28 dias', 'Consignado', 'Bonificação na abertura'];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ROTA_ETAPAS = ['ativo', 'avaliacao', 'risco', 'revisao'];
const prazoDias = c => { const m = /(\d+) dias/.exec(c || ''); return m ? +m[1] : 0; };

/* =================== estado =================== */
const S = { contatos: [], eu: null, base: null, pdvs: [], sellouts: {}, aba: null, sel: null, rotaReg: null, contando: null, abPdv: null, sugestoes: [] };
const regraAval = () => S.base.regras.avaliacao || { reposicoes: 13, meta_minima_sellout: 6 };
const cadPadrao = () => S.base.regras.cadencia_padrao || {};
const regiaoDe = (lng, lat) => {
  for (const r of S.base.regioes) { const b = r.limites; if (b && lng >= b[0] && lng < b[2] && lat <= b[1] && lat > b[3]) return r.codigo; }
  return null;
};
const semAcento = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const CORES = ['#3F6FA8', '#2F7D4E', '#C27A2C', '#B8402A', '#6B4FA0', '#8A4E17', '#2C7F8C', '#9A3B6E', '#5E6B2E'];
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
const prazoTxt = p => { const a = atraso(p); if (a === null) return ROTA_ETAPAS.includes(p.etapa) ? '1ª reposição' : '—'; return a > 0 ? `atrasada ${a} dia${a > 1 ? 's' : ''}` : a === 0 ? 'vence hoje' : `em ${-a} dia${a < -1 ? 's' : ''}`; };
const expo = id => S.base.expositores.find(e => e.id === id) || S.base.expositores[0];
const alvo = (expoId, prodId) => (S.base.alvo.find(a => a.expositor_id === expoId && a.produto_id === prodId) || {}).quantidade || 0;

async function recarregar() {
  const [pdvs, so, cts] = await Promise.all([db.carregarPdvs(), db.carregarSellouts(), db.listarContatos().catch(() => [])]);
  S.pdvs = pdvs; S.contatos = cts;
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
  } catch (e) { $('#raiz').innerHTML = `<div class="loading">Não foi possível carregar: ${esc(e.message)}</div>`; }
}
function telaLogin() {
  $('#raiz').innerHTML = `<div class="login"><form class="box" id="fLogin"><h3>Jaeger’s Comercial</h3>
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
  comercial: [['mapa', 'Mapa'], ['funil', 'CRM'], ['agenda', 'Agenda'], ['carteira', 'Negócios'], ['contatos', 'Contatos'], ['abertura', 'Abertura de cliente'], ['painel', 'Painel'], ['uploads', 'Uploads'], ['regras', 'Regras e metas']],
  operacao: [['rota', 'Rota de hoje'], ['reposicao', 'Reposição'], ['resumo', 'Resumo do dia']] };
let lado = 'comercial';
function montar() {
  lado = S.eu.papel === 'operacao' ? 'operacao' : 'comercial';
  $('#raiz').innerHTML = `<header><span class="brand">Jaeger’s Comercial</span>
   <div class="roles"><button id="rG">Comercial</button><button id="rM">Reposição</button></div>
   <div class="userbox">${esc(S.eu.nome)} <button id="bSair">Sair</button></div></header>
   <nav id="nav"></nav><main id="main"></main>`;
  $('#rG').onclick = () => trocarLado('comercial'); $('#rM').onclick = () => trocarLado('operacao');
  $('#bSair').onclick = async () => { await db.sair(); location.reload(); };
  trocarLado(lado);
}
function trocarLado(l) { lado = l; $('#rG').classList.toggle('on', l === 'comercial'); $('#rM').classList.toggle('on', l === 'operacao'); irPara(ABAS[l][0][0]); }
function irPara(a) {
  S.aba = a;
  $('#nav').innerHTML = ABAS[lado].map(([k, n]) => `<button data-a="${k}" class="${k === a ? 'on' : ''}">${n}</button>`).join('');
  $('#nav').onclick = e => { const k = e.target.dataset.a; if (k) irPara(k); };
  ({ agenda: telaAgenda, perfil: telaPerfil, contato: telaContato, contatos: telaContatos, uploads: telaUploads, mapa: telaMapa, funil: telaFunil, carteira: telaCarteira, abertura: telaAbertura, painel: telaPainel, regras: telaRegras, rota: telaRota, reposicao: telaReposicao, resumo: telaResumo })[a]();
}
window.irPara = irPara;

/* =================== mapa =================== */
let aoMarcar = null, mapa = null, camada = null, camadaSug = null, marcando = false, mostrarReg = true;
function telaMapa() {
  if (S.prosp) return telaProspeccao();
  $('#main').innerHTML = `<section class="view on" style="display:flex;height:100%"><div id="mapa"><div id="lmap"></div>
   <div class="maptools"><button class="btn car" id="bProsp">🧭 Modo prospecção</button><button class="btn pri" id="bAdd">+ Cadastrar ponto</button><button class="btn" id="bPend">Reposições pendentes <b id="nPend"></b></button><button class="btn" id="bLoc">📍 Minha localização</button>
   <select id="fEt"><option value="">Todas as etapas</option>${ETAPAS.map(e => `<option value="${e.k}">${e.n}</option>`).join('')}</select>
   <select id="fReg"><option value="">Todas as regiões</option>${S.base.regioes.map(r => `<option value="${r.codigo}">${r.codigo} · ${esc(r.nome)}</option>`).join('')}</select>
   <label class="regchk"><input type="checkbox" id="tReg" ${mostrarReg ? 'checked' : ''}> Regiões</label></div>
   <div class="hint" id="hint">Toque no mapa onde fica o ponto</div>
   <div class="legend" id="legend"></div></div><aside id="side"></aside></section>`;
  if (mapa) { mapa.remove(); mapa = null; }
  mapa = L.map('lmap', { zoomControl: false }).setView([-29.98, -51.18], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(mapa);
  camada = L.layerGroup().addTo(mapa); camadaSug = L.layerGroup().addTo(mapa);
  mapa.on('click', e => { if (!marcando) return; marcando = false; $('#hint').style.display = 'none'; const f = aoMarcar || (ll => abrirCadastro(ll)); aoMarcar = null; f([e.latlng.lng, e.latlng.lat]); });
  $('#bProsp').onclick = () => { S.prosp = true; PZ.aberto = null; telaMapa(); };
  $('#bAdd').onclick = () => abrirCadastro(null);
  $('#bPend').onclick = () => { S.modoPend = !S.modoPend; S.sel = null; desenhar(); painel(); };
  $('#bLoc').onclick = () => alternarLocalizacao();
  if (S.rastreando) { mostrarEu(false); $('#bLoc').classList.add('pri'); }
  $('#fEt').onchange = $('#fReg').onchange = desenhar;
  $('#tReg').onchange = e => { mostrarReg = e.target.checked; desenhar(); };
  desenhar(); painel();
}
function pino(cor, k = 1, tracejado = false) {
  const w = Math.round(30 * k), h = Math.round(40 * k);
  return L.divIcon({ className: '', iconSize: [w, h], iconAnchor: [w / 2, h], tooltipAnchor: [0, -h * .8], popupAnchor: [0, -h * .85],
    html: `<svg width="${w}" height="${h}" viewBox="0 0 30 40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 39 15 39s14-13.7 14-24.1C29 7.2 22.7 1 15 1z" fill="${tracejado ? '#FBF7F0' : cor}" stroke="${tracejado ? cor : 'rgba(0,0,0,.25)'}" stroke-width="${tracejado ? 2.5 : 1}" ${tracejado ? 'stroke-dasharray="4 3"' : ''}/><circle cx="15" cy="14.5" r="6" fill="#FBF7F0" ${tracejado ? `stroke="${cor}" stroke-width="2"` : ''}/></svg>` });
}
function desenhar() {
  camada.clearLayers();
  if (mostrarReg) S.base.regioes.forEach(r => { const b = r.limites; if (!b) return; L.rectangle([[b[1], b[0]], [b[3], b[2]]], { color: r.cor, weight: 2, dashArray: '8 6', fillOpacity: .04, interactive: false }).addTo(camada).bindTooltip(`${r.codigo} · ${r.nome}`, { permanent: false }); });
  const fe = $('#fEt').value, fr = $('#fReg').value;
  const pend = repPendentes();
  $('#nPend').textContent = pend.length ? `(${pend.length})` : '';
  $('#bPend').classList.toggle('car', !!S.modoPend);
  (S.modoPend ? pend : S.pdvs).filter(p => p.lat && (!fe || p.etapa === fe) && (!fr || p.regiao === fr)).forEach(p => {
    const m = L.marker([p.lat, p.lng], { icon: pino(etapa(p.etapa).c, S.sel === p.id ? 1.35 : p.classe === 'A' ? 1.15 : 1), zIndexOffset: S.sel === p.id ? 1000 : 0 });
    m.on('click', () => { S.sel = p.id; desenhar(); painel(); });
    m.bindTooltip(esc(p.nome)); m.addTo(camada);
  });
  $('#legend').innerHTML = ETAPAS.map(e => `<span><i class="dot" style="background:${e.c}"></i>${e.n} (${S.pdvs.filter(p => p.etapa === e.k).length})</span>`).join('');
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
  return S.pdvs.filter(p => ROTA_ETAPAS.includes(p.etapa) && (!p.proxima_reposicao || atraso(p) >= 0))
    .sort((a, b) => (atraso(b) ?? 999) - (atraso(a) ?? 999));
}
function listaPendentes(s) {
  const l = repPendentes();
  s.classList.add('open');
  s.innerHTML = `<button class="btn" style="float:right;padding:4px 10px" id="xPend">✕</button><h2>Reposições pendentes</h2>
  <p style="color:var(--soft);margin-top:0">${l.length} cliente${l.length === 1 ? '' : 's'} com reposição para hoje ou atrasada. O mapa mostra só eles.</p>
  ${l.map(p => { const a = atraso(p); return `<div class="stop" style="padding:10px;align-items:flex-start"><div class="info"><b>${esc(p.nome)}</b><br><small style="color:var(--mute)">${p.regiao || '—'} · ${esc(p.bairro || p.cidade || '')} · ${etapa(p.etapa).n}</small><br><span class="badge" style="background:${(a ?? 1) > 0 ? '#F3D6CF' : '#F7E9DD'};margin-top:4px;display:inline-block">${prazoTxt(p)}${p.proxima_reposicao ? ' · era ' + dstr(p.proxima_reposicao) : ''}</span></div>
   <div style="display:flex;flex-direction:column;gap:4px"><button class="btn" data-ver="${p.id}" style="padding:5px 10px">Ver</button><button class="btn pri" data-repor="${p.id}" style="padding:5px 10px">Repor</button></div></div>`; }).join('') || '<p class="empty">Nada pendente. 🎉</p>'}`;
  $('#xPend').onclick = () => { S.modoPend = false; desenhar(); painel(); };
  s.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { const p = S.pdvs.find(x => x.id === b.dataset.ver); S.modoPend = false; S.sel = p.id; desenhar(); painel(); if (p.lat) mapa.setView([p.lat, p.lng], 16); });
  s.querySelectorAll('[data-repor]').forEach(b => b.onclick = () => { S.contando = b.dataset.repor; S.modoPend = false; lado = 'operacao'; $('#rG').classList.remove('on'); $('#rM').classList.add('on'); irPara('reposicao'); });
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

function painel() {
  const s = $('#side'); if (!s) return;
  const p = S.pdvs.find(x => x.id === S.sel);
  if (!p && S.modoPend) return listaPendentes(s);
  if (!p) { s.classList.remove('open'); s.innerHTML = `<div class="empty"><b>Selecione um ponto no mapa.</b><br>A cor mostra a etapa do funil.<br><br><b>+ Cadastrar ponto</b>: pela sua localização, marcando no mapa ou colando o link do Google Maps.<br><b>Reposições pendentes</b>: mostra quem precisa de reposição hoje ou está atrasado.</div>`; return; }
  s.classList.add('open');
  const podeComprar = ['visitado', 'negociacao'].includes(p.etapa);
  const gm = p.lat ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null;
  s.innerHTML = `<button class="btn" style="float:right;padding:4px 10px" id="xSide">✕</button>
  <small style="color:var(--mute)">${esc(p.canal || '')} · ${esc(p.cidade || '')}</small><h2>${esc(p.nome)}</h2>${p.contato_nome ? `<div style="color:var(--soft)">Contato: <b>${esc(p.contato_nome)}</b>${p.contato_telefone ? ' · ' + esc(p.contato_telefone) : ''}</div>` : ''}
  <div class="badges"><span class="badge st" style="background:${etapa(p.etapa).c}">${etapa(p.etapa).n}</span>${p.classe ? `<span class="badge">Classe ${p.classe}</span>` : ''}<span class="badge">${p.regiao || '—'} · ${esc(regNome(p.regiao))}</span>${p.expositor_id ? `<span class="badge">Expositor ${esc(expo(p.expositor_id).nome)}</span>` : ''}</div>
  ${caixaComentario(p)}
  ${caixaEsteira(p)}
  <div class="sect"><h3>Potencial</h3><div class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-pot="${i}" class="${i <= (p.potencial || 0) ? 'on' : ''}">★</button>`).join('')}</div></div>
  ${ultimos6(p)}
  ${p.cadencia_efetiva ? `<div class="sect"><h3>Reposição</h3><div class="kv" style="margin:0 0 8px"><div><small>Próxima</small><b>${dstr(p.proxima_reposicao)}</b><small>${prazoTxt(p)}</small></div><div><small>Rota</small><b>${p.regiao || '—'} · ${DIAS[(S.base.regioes.find(r => r.codigo === p.regiao) || {}).dia_rota] || '—'}</b><small>${esc(regNome(p.regiao))}</small></div></div>
   <div class="row"><span>Repor a cada</span><select id="sCad"><option value="">padrão da etapa (${cadPadrao()[p.etapa] || '—'} dias)</option>${[7, 10, 14, 21, 28, 30].map(d => `<option value="${d}" ${p.cadencia_dias === d ? 'selected' : ''}>${d} dias</option>`).join('')}</select></div>
   <p style="color:var(--soft);margin:8px 0 0">Condição: <b>${esc(p.condicao || '—')}</b> · pedido mínimo ${brl(p.pedido_minimo)}</p></div>` : ''}
  <div class="sect"><h3>Etapa do funil</h3><select id="sEt" style="width:100%">${ETAPAS.map(e => `<option value="${e.k}" ${e.k === p.etapa ? 'selected' : ''}>${e.n}</option>`).join('')}</select></div>
  ${p.observacao ? `<div class="sect"><h3>Observação</h3><div style="color:var(--soft)">${esc(p.observacao)}</div></div>` : ''}
  <div class="actions">
   ${podeComprar ? `<button class="btn car" style="font-size:15px;padding:11px" id="bComprar">Gerar compra →</button>` : ''}
   <button class="btn ${podeComprar ? '' : 'pri'}" id="bVisita">Registrar visita de prospecção</button>
   <button class="btn" id="bPerfil">Abrir perfil do negócio</button>
   ${gm ? `<a class="btn" href="${gm}" target="_blank" rel="noopener">Abrir no Google Maps ↗</a>` : ''}</div>`;
  $('#bPerfil').onclick = () => abrirPerfil(p.id);
  $('#xSide').onclick = () => { S.sel = null; desenhar(); painel(); };
  s.querySelectorAll('[data-pot]').forEach(b => b.onclick = () => salvarPdv(p.id, { potencial: +b.dataset.pot }, 'Potencial atualizado'));
  $('#sEt').onchange = e => mudarEtapa(p.id, e.target.value, () => { desenhar(); painel(); });
  if ($('#sCad')) $('#sCad').onchange = e => salvarPdv(p.id, { cadencia_dias: e.target.value ? +e.target.value : null }, 'Frequência atualizada');
  if ($('#bComprar')) $('#bComprar').onclick = () => { S.abPdv = p.id; irPara('abertura'); };
  $('#bVisita').onclick = () => visitaRapida(p);
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
function abrirCadastro(loc) {
  let pos = loc;
  modal(`<h3>Novo ponto de venda</h3>
  <label>Link do Google Maps</label><input id="cLink" placeholder="Cole o link do lugar no Google Maps">
  <div class="linkmsg" id="cMsg"></div>
  <div class="row" style="margin-top:8px"><button class="btn" id="cGps" style="flex:1">Usar minha localização</button><button class="btn" id="cMarcar" style="flex:1">Marcar no mapa</button></div>
  <label>Nome fantasia</label><input id="cNome">
  ${campoEmpresa('c')}
  <label>Canal</label>${campoCanal('cCanal', 'Minimercado')}
  ${campoContato()}
  <div class="row"><div style="flex:1"><label>Bairro</label><input id="cBairro"></div><div style="flex:1"><label>Cidade</label><input id="cCidade"></div></div>
  <label>Potencial (1 a 5)</label>${campoPot('cPot')}
  <label>Observação</label><textarea id="cObs" rows="2" placeholder="Quem decide, melhor horário, espaço no caixa…"></textarea>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="cSalvar">Salvar no funil</button></div>`);
  ligarCanal('cCanal'); ligarEmpresa('c', 'cNome');
  const msg = (t, okk) => { const m = $('#cMsg'); m.style.display = 'block'; m.style.background = okk ? '#E3F0E7' : '#F7E9DD'; m.style.color = okk ? '#1F5A37' : '#7A4A16'; m.innerHTML = t; };
  let rua = '';
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
    if (m) { marcarPos(+m[2], +m[1], 'encontrada no link'); if (nm && !$('#cNome').value) $('#cNome').value = decodeURIComponent(nm[1].replace(/\+/g, ' ')); return; }
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(u)) { msg('Link curto do celular. Ainda não consigo ler esse tipo (vem na próxima versão). Por enquanto: abra o link no navegador, copie o endereço completo da barra e cole aqui, ou use "Usar minha localização".', false); return; }
    msg('Não encontrei a localização nesse link.', false);
  };
  $('#cGps').onclick = () => { if (!navigator.geolocation) return msg('Este aparelho não informa a localização.', false); msg('Buscando localização…', true); navigator.geolocation.getCurrentPosition(g => marcarPos(g.coords.longitude, g.coords.latitude, 'do aparelho'), () => msg('Não foi possível pegar a localização. Verifique a permissão do navegador.', false), { enableHighAccuracy: true, timeout: 15000 }); };
  $('#cMarcar').onclick = () => { fecharModal(); if (S.aba !== 'mapa') irPara('mapa'); marcando = true; $('#hint').style.display = 'block'; };
  $('#cSalvar').onclick = async () => {
    if (!pos) return msg('Informe a localização: link, localização do aparelho ou marcar no mapa.', false);
    const nome = $('#cNome').value.trim(); if (!nome) return msg('Coloque o nome do estabelecimento.', false);
    const dup = duplicado(nome, pos[1], pos[0]);
    if (dup && !$('#cSalvar').dataset.forca) { msg(`Já existe <b>${esc(dup.nome)}</b> (${etapa(dup.etapa).n}) nesse lugar ou com esse nome. <a href="#" id="cAbrirDup">Abrir o perfil dele</a> ou toque em Salvar de novo para cadastrar mesmo assim.`, false); $('#cAbrirDup').onclick = e => { e.preventDefault(); fecharModal(); abrirPerfil(dup.id); }; $('#cSalvar').dataset.forca = 1; return; }
    $('#cSalvar').disabled = true;
    try {
      const cidade = $('#cCidade').value.trim() || null;
      const contato_id = await contatoDoForm(nome);
      const n = await db.criarPdv({ contato_id, geo_precisao: 'exata', nome, ...lerEmpresa('c'), canal: lerCanal('cCanal'), endereco: rua || null, bairro: $('#cBairro').value.trim() || null, cidade, lng: pos[0], lat: pos[1], regiao: await garantirRegiao(pos[0], pos[1], cidade), potencial: +$('#cPot').value, observacao: $('#cObs').value.trim() || null, origem: $('#cLink').value ? 'link_maps' : 'manual', link_maps: $('#cLink').value.trim() || null, criado_por: S.eu.id });
      fecharModal(); await atualizarUm(n.id); S.sel = n.id; if (S.aba === 'mapa') { desenhar(); painel(); } if (S.aba === 'abertura') { S.abPdv = n.id; telaAbertura(); } toast(nome + ' entrou no funil como Mapeado');
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
const MOTIVOS = ['Preço', 'Sem espaço', 'Concorrente', 'Dono não decide', 'Sem interesse', 'Outro'];
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
    <label>Retomar o contato em</label><input id="mRet" type="date" value="${ret}">
    <p style="color:var(--soft);font-size:12px;margin:6px 0 0">Cria uma tarefa na sua agenda para essa data. Deixe em branco para não retomar.</p>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="mOk">Marcar como perdido</button></div>`);
    $('#mMot').onchange = () => $('#mOutro').style.display = $('#mMot').value === 'Outro' ? 'block' : 'none';
    $('#mOk').onclick = async () => {
      const mot = $('#mMot').value === 'Outro' ? ($('#mOutro').value.trim() || 'Outro') : $('#mMot').value, ret = $('#mRet').value || null;
      try { await db.atualizarPdv(id, { etapa: 'perdido', motivo_perda: mot, retomar_em: ret, etapa_motivo: 'Perdido: ' + mot });
        if (ret) await db.criarTarefa({ titulo: 'Retomar contato com ' + p.nome, tipo: 'visita', data: ret, pdv_id: id, contato_id: p.contato_id || null, descricao: 'Perdido por: ' + mot, dono: S.eu.id });
        fecharModal(); await atualizarUm(id); toast(`${p.nome} marcado como perdido (${mot})`); depois && depois(); } catch (e) { erro(e); } };
    return;
  }
  try { await db.atualizarPdv(id, { etapa: nova, ...(p.etapa === 'perdido' ? { motivo_perda: null, retomar_em: null } : {}) }); await atualizarUm(id); toast('Etapa: ' + etapa(nova).n); depois && depois(); } catch (e) { erro(e); }
}
window.mudarEtapa = mudarEtapa;

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
  const cols = funilVisao === 'prospeccao' ? PROSP : CART, M = metas();
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
    <div class="cardmeta"><span>${dias === null ? '' : `${dias === 0 ? 'hoje' : 'há ' + dias + (dias === 1 ? ' dia' : ' dias')} na etapa`}</span>${p.etapa === 'perdido' && p.motivo_perda ? `<span>· ${esc(p.motivo_perda)}${p.retomar_em ? ' · retomar ' + dstr(ymd(p.retomar_em) + 'T12:00') : ''}</span>` : ''}${CART.includes(p.etapa) && so ? `<span>· último sell-out ${so.sellout} un.</span>` : ''}${CART.includes(p.etapa) && p.proxima_reposicao ? `<span>· reposição ${prazoTxt(p)}</span>` : ''}</div>${extra}${chipAcao(p)}</div>`; };
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
  if (funilVisao === 'prospeccao') html = html.replace('<div class="col" data-et="perdido">', `<div class="col ganho" data-et="ganho"><h4><span><i class="dot" style="background:#2F7D4E"></i> Venda (ganho)</span><span>${ganPer.length} · ${brl(valorPer)}</span></h4><div class="list"><p class="dica">Arraste um negócio para cá para lançar a primeira venda.</p>${ganPer.map(o => { const p = pdv(o.pdv_id); return p ? `<div class="card" data-id="${p.id}" style="border-left-color:#2F7D4E"><b>${esc(p.nome)}</b><small>venda em ${dstr(o.criado_em)} · ${brl(o.valor)} · agora: ${etapa(p.etapa).n}</small></div>` : ''; }).join('')}</div></div><div class="col" data-et="perdido">`);
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
   <div class="row">${novo ? '' : `<button class="btn" id="tDel" style="color:#7A2414">Excluir</button><button class="btn" id="tFeita">${t.concluida ? 'Reabrir' : '✓ Concluir'}</button>`}</div>
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
  $('#main').innerHTML = `<section class="view on"><div class="tablewrap"><div class="toolbar"><input id="q" placeholder="Buscar PDV…" style="width:240px"><select id="tEt"><option value="">Todas as etapas</option>${ETAPAS.map(e => `<option value="${e.k}">${e.n}</option>`).join('')}</select><span id="tN" style="color:var(--mute)"></span></div><table id="tbl"></table></div></section>`;
  const cols = [['nome', 'PDV'], ['regiao', 'Região'], ['canal', 'Canal'], ['etapa', 'Etapa'], ['classe', 'Classe'], ['potencial', 'Potencial'], ['so', 'Sell-out médio'], ['ultima_visita', 'Última visita'], ['proxima_reposicao', 'Próx. reposição']];
  const desenhaT = () => {
    const q = $('#q').value.toLowerCase(), et = $('#tEt').value;
    let ds = S.pdvs.filter(p => (!et || p.etapa === et) && (!q || p.nome.toLowerCase().includes(q))).map(p => { const s = (S.sellouts[p.id] || []).slice(-6); return { ...p, so: s.length ? s.reduce((a, x) => a + x.sellout, 0) / s.length : null }; });
    ds.sort((a, b) => { const x = a[ord.k] ?? '', y = b[ord.k] ?? ''; return (x > y ? 1 : x < y ? -1 : 0) * ord.d; });
    $('#tN').textContent = ds.length + ' pontos';
    $('#tbl').innerHTML = `<tr>${cols.map(([k, n]) => `<th data-k="${k}">${n}${ord.k === k ? (ord.d > 0 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr>` + ds.map(p => `<tr data-id="${p.id}" style="cursor:pointer"><td><b>${esc(p.nome)}</b></td><td>${p.regiao || '—'}</td><td>${esc(p.canal || '')}</td><td><i class="dot" style="background:${etapa(p.etapa).c}"></i> ${etapa(p.etapa).n}</td><td>${p.classe || '—'}</td><td>${'★'.repeat(p.potencial || 0)}</td><td>${p.so === null ? '—' : dec(p.so) + ' un.'}</td><td>${dstr(p.ultima_visita)}</td><td>${p.proxima_reposicao ? dstr(p.proxima_reposicao) + ' · ' + prazoTxt(p) : '—'}</td></tr>`).join('');
    $('#tbl').querySelectorAll('th').forEach(th => th.onclick = () => { ord = { k: th.dataset.k, d: ord.k === th.dataset.k ? -ord.d : 1 }; desenhaT(); });
    $('#tbl').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => abrirPerfil(tr.dataset.id));
  };
  $('#q').oninput = $('#tEt').onchange = desenhaT; desenhaT();
}

/* =================== abertura de cliente =================== */
function telaAbertura() {
  const elig = S.pdvs.filter(p => ['mapeado', 'visitado', 'negociacao', 'inativo'].includes(p.etapa));
  if (!S.abPdv || !elig.some(p => p.id === S.abPdv)) S.abPdv = (elig.find(p => p.id === S.sel) || elig.find(p => p.etapa === 'negociacao') || elig[0] || {}).id;
  const p = S.pdvs.find(x => x.id === S.abPdv);
  const ex = S.base.expositores;
  $('#main').innerHTML = `<section class="view on"><div class="dash"><div class="panel" style="max-width:980px">
  <div class="row" style="justify-content:space-between;flex-wrap:wrap"><h3 style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:600;margin:0">Abertura de cliente</h3><button class="btn" id="oCad">+ Cadastrar ponto</button></div>
  ${p ? '' : '<p class="empty">Nenhum PDV disponível. Cadastre um ponto no mapa primeiro.</p>'}
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
   <div><label class="lb">PDV</label><select id="oPdv" style="width:100%">${elig.map(x => `<option value="${x.id}" ${x.id === S.abPdv ? 'selected' : ''}>${esc(x.nome)} · ${etapa(x.etapa).n}</option>`).join('')}</select></div>
   <div><label class="lb">Expositor entregue</label><select id="oExp" style="width:100%">${ex.map(e => `<option value="${e.id}">${esc(e.nome)} · ${e.capacidade} un.</option>`).join('')}</select></div>
   <div><label class="lb">Preço por unidade (R$)</label><input id="oPre" type="number" step="0.05" value="4.90" style="width:100%"></div>
   <div><label class="lb">Pedido mínimo combinado (R$)</label><input id="oMin" type="number" step="10" value="150" style="width:100%"></div>
   <div><label class="lb">Repor a cada</label><select id="oCad" style="width:100%"><option value="">${cadPadrao().avaliacao || 7} dias (padrão da avaliação)</option><option value="10">10 dias</option><option value="14">14 dias</option></select></div></div>
  <h3 style="margin:16px 0 6px">Condição de pagamento</h3><div class="pay">${CONDICOES.map((c, i) => `<label><input type="radio" name="oc" value="${c}" ${i === 0 ? 'checked' : ''}> ${c}</label>`).join('')}<label><input type="radio" name="oc" value="Outra"> Outra</label></div>
  <input id="oOutra" placeholder="Descreva a negociação" style="width:100%;display:none;margin-bottom:8px">
  <div id="oBon" style="display:none;margin-bottom:8px"><label class="lb">Unidades bonificadas</label><input id="oBonQ" type="number" value="6" style="width:120px"></div>
  <h3 style="margin:16px 0 6px">Itens do primeiro pedido</h3><div id="oItens" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:6px 14px"></div>
  <div class="row" style="justify-content:space-between;margin-top:14px;flex-wrap:wrap"><div><b id="oUn">0</b> unidades · <span id="oInfo" style="color:var(--soft)"></span></div><div style="font-family:Fraunces,Georgia,serif;font-size:26px" id="oTot">R$ 0,00</div></div>
  <label class="lb">Observação</label><textarea id="oObs" rows="2" style="width:100%"></textarea>
  <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn pri" id="oSave" ${p ? '' : 'disabled'}>Lançar venda</button></div></div></div></section>`;
  const fill = () => { const e = +$('#oExp').value; let l = ''; $('#oItens').innerHTML = S.base.produtos.map(pr => { const h = pr.linha !== l ? `<div style="grid-column:1/-1;font-weight:700;margin-top:6px;color:var(--car-d)">${esc(l = pr.linha)}</div>` : ''; return h + `<div class="row" style="justify-content:space-between"><span>${esc(pr.sabor)}</span>${stepper('oq', alvo(e, pr.id), false, `data-p="${pr.id}"`)}</div>`; }).join(''); ligarSteppers($('#oItens')); calc(); };
  const cond = () => document.querySelector('input[name=oc]:checked').value;
  const calc = () => { const un = [...document.querySelectorAll('.oq')].reduce((a, i) => a + (+i.value || 0), 0), pre = +$('#oPre').value || 0, c = cond(), bon = c === 'Bonificação na abertura' ? Math.min(un, +$('#oBonQ').value || 0) : 0, tot = (un - bon) * pre;
    $('#oUn').textContent = un; $('#oTot').textContent = c === 'Consignado' ? 'R$ 0,00 agora' : brl(tot);
    $('#oInfo').textContent = c === 'Consignado' ? `consignado: cobra ${brl(un * pre)} conforme vender` : bon ? `${bon} bonificadas` : tot < (+$('#oMin').value || 0) ? 'abaixo do pedido mínimo' : '';
    $('#oOutra').style.display = c === 'Outra' ? 'block' : 'none'; $('#oBon').style.display = c === 'Bonificação na abertura' ? 'block' : 'none'; return { un, tot, bon, c, pre }; };
  $('#oPdv') && ($('#oPdv').onchange = e => { S.abPdv = e.target.value; telaAbertura(); });
  $('#oCad').onclick = () => abrirCadastro(null);
  $('#oExp').onchange = fill; const sec = $('#main section'); sec.addEventListener('input', calc); sec.addEventListener('change', calc); fill();
  $('#oSave').onclick = async () => {
    const t = calc(); if (!t.un) return toast('Coloque os itens do pedido');
    const c = t.c === 'Outra' ? ($('#oOutra').value.trim() || 'Negociação especial') : t.c;
    const itens = [...document.querySelectorAll('.oq')].map(i => ({ produto_id: +i.dataset.p, quantidade: +i.value || 0, preco_unit: t.pre, bonificado: 0 }));
    if (t.bon) { let r = t.bon; for (const it of itens) { const b = Math.min(r, it.quantidade); it.bonificado = b; r -= b; if (!r) break; } }
    const hoje = new Date();
    $('#oSave').disabled = true;
    try {
      await db.registrarAbertura({ pdvId: p.id, usuarioId: S.eu.id, observacao: $('#oObs').value || null,
        contagens: itens.filter(i => i.quantidade).map(i => ({ produto_id: i.produto_id, deixado_anterior: 0, encontrado: 0, troca: 0, reposto: i.quantidade })),
        pedido: { tipo: 'abertura', condicao: c, unidades: t.un, valor: c === 'Consignado' ? 0 : t.tot, pago_na_hora: c.startsWith('À vista'), vencimento: prazoDias(c) ? new Date(+hoje + prazoDias(c) * DIA).toISOString().slice(0, 10) : null },
        itens,
        patch: { etapa: 'avaliacao', avaliacao_inicio: hoje.toISOString().slice(0, 10), expositor_id: +$('#oExp').value, condicao: c, pedido_minimo: +$('#oMin').value || 150, cadencia_dias: $('#oCad').value ? +$('#oCad').value : null } });
      await atualizarUm(p.id); const n = S.pdvs.find(x => x.id === p.id);
      toast(`Venda lançada para ${p.nome}. Primeira reposição em ${dstr(n.proxima_reposicao)}.`); S.abPdv = null; if (S.prosp) { PZ.visHoje[p.id] = 'fechou'; PZ.aberto = null; irPara('mapa'); } else telaAbertura();
    } catch (e) { erro(e); $('#oSave').disabled = false; }
  };
}

/* =================== painel =================== */
function telaPainel() {
  const cont = k => S.pdvs.filter(p => p.etapa === k).length;
  const desde = Date.now() - 28 * DIA;
  const so4 = Object.values(S.sellouts).flat().filter(s => new Date(s.em) >= desde);
  const un4 = so4.reduce((a, s) => a + s.sellout, 0), val4 = so4.reduce((a, s) => a + Number(s.valor_sellout), 0);
  const atras = S.pdvs.filter(p => ROTA_ETAPAS.includes(p.etapa) && (atraso(p) ?? -1) > 0).length;
  $('#main').innerHTML = `<section class="view on"><div class="dash"><div class="tiles">
  <div class="tile hi"><small>PDVs ativos</small><b>${cont('ativo')}</b><small>+ ${cont('avaliacao')} em avaliação</small></div>
  <div class="tile"><small>Em negociação</small><b>${cont('negociacao')}</b><small>prontos para fechar</small></div>
  <div class="tile"><small>Revisão comercial</small><b>${cont('revisao')}</b><small>decidir preço, mínimo ou retirada</small></div>
  <div class="tile"><small>Reposições atrasadas</small><b>${atras}</b><small>passaram da data</small></div>
  <div class="tile"><small>Sell-out · 4 semanas</small><b>${fmt(un4)}</b><small>${brl(val4)}</small></div></div>
  ${(() => { const al = alertasProsp(); return al.length ? `<div class="panel alertas"><h3>Alertas de prospecção (${al.length}) · visitados sem próxima ação</h3>${al.slice(0, 30).map(p => `<div class="trow" style="cursor:default"><i style="background:${p.ultimo_resultado === 'nao_estava' ? '#3F6FA8' : etapa(p.etapa).c}"></i><div style="flex:1"><b>${esc(p.nome)}</b><br><small style="color:var(--mute)">${RESULTADOS[p.ultimo_resultado]?.n || 'Visitado'} em ${dstr(p.ultima_prospeccao)}${p.melhor_horario ? ' · melhor horário: ' + esc(p.melhor_horario) : ''}</small></div><button class="mini" data-altar="${p.id}">+ tarefa</button><button class="mini" data-alab="${p.id}">abrir</button></div>`).join('')}</div>` : ''; })()}
  <div class="panel"><h3>Funil</h3><div class="bars">${ETAPAS.map(e => { const n = cont(e.k); return `<div class="bar"><span>${e.n}</span><div class="tr"><div class="fl" style="width:${S.pdvs.length ? n / S.pdvs.length * 100 : 0}%;background:${e.c}"></div></div><b>${n}</b></div>`; }).join('')}</div></div></div></section>`;
  document.querySelectorAll('[data-altar]').forEach(b => b.onclick = () => { const p = S.pdvs.find(x => x.id === b.dataset.altar); modalTarefa({ data: hojeISO(), titulo: 'Retorno: ' + p.nome, pdv_id: p.id, contato_id: p.contato_id }, telaPainel); });
  document.querySelectorAll('[data-alab]').forEach(b => b.onclick = () => abrirPerfil(b.dataset.alab));
}

/* =================== regras =================== */
function telaRegras() {
  const r = regraAval(), cp = cadPadrao();
  $('#main').innerHTML = `<section class="view on"><div class="dash">
  <div class="panel" style="max-width:900px"><h3>Metas do comercial</h3><p style="color:var(--soft);margin-top:0">Aparecem no topo do CRM, com barra de progresso. Os dias de trabalho contam de segunda a sábado.</p>
   <div class="metas">${[['visitas_dia', 'Visitas de prospecção por dia', 'visitas'], ['vendas_dia', 'Vendas (novos clientes) por dia', 'vendas'], ['valor_mes', 'Valor em vendas novas por mês', 'R$'], ['cadastros_semana', 'Novos pontos cadastrados por semana', 'pontos']].map(([k, n, u]) => `<label><span>${n}</span><span class="row" style="gap:6px"><input type="number" min="0" class="rMeta" data-k="${k}" value="${metas()[k]}" style="width:110px"> <small>${u}</small></span></label>`).join('')}</div></div>
  <div class="panel" style="max-width:900px"><h3>Esteira de avaliação</h3><div class="row" style="flex-wrap:wrap;gap:10px">Avaliação de <input type="number" id="rRep" value="${r.reposicoes}" style="width:70px"> reposições. Aprova com sell-out médio de pelo menos <input type="number" id="rMin" value="${r.meta_minima_sellout}" style="width:70px"> un. por reposição.</div></div>
  <div class="panel" style="max-width:900px"><h3>Frequência padrão de reposição por etapa</h3><table><tr><th>Etapa</th><th>Repor a cada</th><th>PDVs</th></tr>${['avaliacao', 'ativo', 'risco', 'revisao'].map(k => `<tr><td><i class="dot" style="background:${etapa(k).c}"></i> ${etapa(k).n}</td><td><input type="number" class="rCad" data-k="${k}" value="${cp[k] || ''}" style="width:70px"> dias</td><td>${S.pdvs.filter(p => p.etapa === k).length}</td></tr>`).join('')}</table></div>
  <div class="panel" style="max-width:900px"><h3>Dia de rota por região</h3><table><tr><th>Região</th><th>Dia</th><th>PDVs com reposição</th></tr>${S.base.regioes.map(g => `<tr><td><b style="color:${g.cor}">${g.codigo}</b> · ${esc(g.nome)}</td><td><select class="rDia" data-c="${g.codigo}"><option value="" ${g.dia_rota == null ? 'selected' : ''}>Sem dia fixo</option>${DIAS.map((d, i) => `<option value="${i}" ${g.dia_rota === i ? 'selected' : ''}>${d}</option>`).join('')}</select></td><td>${S.pdvs.filter(p => p.regiao === g.codigo && ROTA_ETAPAS.includes(p.etapa)).length}</td></tr>`).join('')}</table></div></div></section>`;
  const salvarAval = async () => { const v = { reposicoes: +$('#rRep').value || 13, meta_minima_sellout: +$('#rMin').value || 6 }; try { await db.salvarRegra('avaliacao', v); S.base.regras.avaliacao = v; toast('Regra da avaliação salva'); } catch (e) { erro(e); } };
  $('#rRep').onchange = $('#rMin').onchange = salvarAval;
  document.querySelectorAll('.rMeta').forEach(i => i.onchange = async () => { const v = { ...metas(), [i.dataset.k]: +i.value || 0 }; try { await db.salvarRegra('metas', v); S.base.regras.metas = v; toast('Meta salva'); } catch (e) { erro(e); } });
  document.querySelectorAll('.rCad').forEach(i => i.onchange = async () => { const v = { ...cadPadrao(), [i.dataset.k]: +i.value || 7 }; try { await db.salvarRegra('cadencia_padrao', v); S.base.regras.cadencia_padrao = v; await recarregar(); toast('Frequência salva'); } catch (e) { erro(e); } });
  document.querySelectorAll('.rDia').forEach(s => s.onchange = async () => { try { const v = s.value === '' ? null : +s.value; await db.salvarRegiao(s.dataset.c, { dia_rota: v }); S.base.regioes.find(g => g.codigo === s.dataset.c).dia_rota = v; S.rotaReg = null; toast('Dia de rota salvo'); } catch (e) { erro(e); } });
}

/* =================== rota (reposição) =================== */
function aRepor(reg) { return S.pdvs.filter(p => p.regiao === reg && ROTA_ETAPAS.includes(p.etapa) && (!p.proxima_reposicao || (atraso(p) ?? -99) >= -2)); }
function ordenar(pool) { const o = []; let cur = [...pool].sort((a, b) => b.lat - a.lat)[0]; pool = pool.filter(p => p !== cur); while (cur) { o.push(cur); let best = null, bd = 1e9; pool.forEach(p => { const d = (p.lng - cur.lng) ** 2 + (p.lat - cur.lat) ** 2; if (d < bd) { bd = d; best = p; } }); pool = pool.filter(p => p !== best); cur = best; } return o; }
async function telaRota() {
  $('#main').innerHTML = '<section class="view on"><div class="loading">Atualizando a rota…</div></section>';
  try { await recarregar(); } catch (e) { return erro(e); }
  const dia = new Date().getDay();
  if (!S.rotaReg) S.rotaReg = (S.base.regioes.find(g => g.dia_rota === dia) || S.base.regioes[0]).codigo;
  const r = ordenar(aRepor(S.rotaReg).filter(p => p.lat)).slice(0, 15);
  const pts = r.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);
  const url = pts.length ? `https://www.google.com/maps/dir/?api=1&destination=${pts[pts.length - 1]}&waypoints=${pts.slice(0, -1).slice(0, 9).join('%7C')}&travelmode=driving` : null;
  const doDia = S.base.regioes.filter(g => g.dia_rota === dia).map(g => g.codigo).join(' e ') || 'nenhuma';
  $('#main').innerHTML = `<section class="view on"><div class="route"><div class="toolbar"><h2 style="font-family:Fraunces,Georgia,serif;margin:0 12px 0 0">Rota · ${r.length} paradas</h2>${url ? `<a class="btn car" href="${url}" target="_blank" rel="noopener" style="text-decoration:none">Abrir rota no Google Maps ↗</a>` : ''}</div>
  <div class="toolbar"><span>${DIAS[dia]}: regiões do dia <b>${doDia}</b>. Montar rota de</span><select id="rReg">${S.base.regioes.map(g => `<option value="${g.codigo}" ${g.codigo === S.rotaReg ? 'selected' : ''}>${g.codigo} · ${esc(g.nome)} · ${DIAS[g.dia_rota] || '—'} (${aRepor(g.codigo).length} a repor)</option>`).join('')}</select></div>
  <p style="color:var(--soft);margin-top:0">Entram os PDVs da região com reposição vencida ou vencendo em até 2 dias, do mais próximo para o seguinte.</p>
  ${r.map((p, i) => `<div class="stop"><div class="n">${i + 1}</div><div class="info"><b>${esc(p.nome)}</b> <span class="badge" style="background:${(atraso(p) ?? 0) > 0 ? '#F3D6CF' : 'var(--sand)'}">${prazoTxt(p)}</span><br><small style="color:var(--mute)">${esc(p.canal || '')} · ${p.expositor_id ? 'expositor ' + esc(expo(p.expositor_id).nome) + ' · ' : ''}${etapa(p.etapa).n}${p.etapa === 'avaliacao' ? ` ${p.aval_reposicoes || 0}/${regraAval().reposicoes}` : ''} · ${esc(p.condicao || '')} · a cada ${p.cadencia_efetiva} dias</small></div><button class="btn pri" data-rep="${p.id}">Repor</button></div>`).join('') || '<div class="empty">Nenhuma reposição vencida nessa região.</div>'}</div></section>`;
  $('#rReg').onchange = e => { S.rotaReg = e.target.value; telaRota(); };
  document.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { S.contando = b.dataset.rep; irPara('reposicao'); });
}

/* =================== reposição (contagem) =================== */
function stepper(cls, v, peq, attrs = '') { return `<div class="stp ${peq ? 'sm' : ''}"><button type="button" data-d="-1" aria-label="menos">−</button><input type="number" min="0" inputmode="numeric" class="${cls}" value="${v}" ${attrs}><button type="button" data-d="1" aria-label="mais">+</button></div>`; }
function ligarSteppers(raiz) {
  if (!raiz || raiz._stp) return; raiz._stp = true;
  raiz.addEventListener('click', e => { const b = e.target.closest('.stp button'); if (!b) return; const i = b.parentElement.querySelector('input');
    i.value = Math.max(0, (+i.value || 0) + +b.dataset.d); i.dispatchEvent(new Event('input', { bubbles: true })); });
  raiz.addEventListener('focusin', e => { if (e.target.matches('.stp input')) e.target.select(); });
}
async function telaReposicao() {
  const p = S.pdvs.find(x => x.id === S.contando);
  if (!p) { $('#main').innerHTML = '<section class="view on"><div class="empty">Escolha um PDV na <b>Rota de hoje</b> para começar.</div></section>'; return; }
  $('#main').innerHTML = '<section class="view on"><div class="loading">Carregando a última contagem…</div></section>';
  let ant; try { ant = await db.ultimoDeixado(p.id); } catch (e) { return erro(e); }
  const ex = expo(p.expositor_id), cons = p.condicao === 'Consignado';
  let h = `<section class="view on"><div class="count"><div class="toolbar"><h2 style="font-family:Fraunces,Georgia,serif;margin:0">${esc(p.nome)}</h2><span class="badge">Expositor ${esc(ex.nome)} · ${ex.capacidade} un.</span></div>
  <p style="color:var(--soft);margin-top:0">Conte o que tem de cada sabor no expositor, inclusive o que vai ser trocado. O sistema sugere quanto repor e calcula o sell-out.</p>
  <div id="ct" class="contagem">`;
  let l = '';
  S.base.produtos.forEach(pr => { if (pr.linha !== l) { l = pr.linha; h += `<div class="lingrp">${esc(l)}</div>`; }
    const a = ant[pr.id] ?? 0;
    h += `<div class="lin" data-p="${pr.id}" data-ant="${a}" data-alvo="${alvo(ex.id, pr.id)}" data-pre="${pr.preco}">
     <div class="sab"><b>${esc(pr.sabor)}</b><small>deixado: ${a}</small></div>
     <div class="cel"><small>Encontrado</small>${stepper('enc', a)}</div>
     <div class="cel"><small>Troca</small>${stepper('trc', 0, true)}</div>
     <div class="cel"><small>Repor</small>${stepper('rep', 0)}</div>
     <div class="res"><small>sell-out</small><b class="so">0</b><small class="val">—</small></div></div>`; });
  h += `</div><div class="panel totpanel"><div class="row" style="justify-content:space-between;flex-wrap:wrap"><div><b id="tUn">0 un.</b> a repor · sell-out <b id="tSo">0 un.</b> · trocas <b id="tTr">0</b></div><div style="font-family:Fraunces,Georgia,serif;font-size:24px" id="tVal">R$ 0,00</div></div>
  ${cons ? `<div class="esteira" style="margin-top:12px"><b>Cliente em consignado.</b><p>Cobra só o que foi vendido desde a última visita: <b id="tCons">R$ 0,00</b>.</p></div>` : ''}
  <h3 style="margin:14px 0 6px">Pagamento <small style="font-weight:400;color:var(--mute)">· combinado: ${esc(p.condicao || '—')}</small></h3><div class="pay">${CONDICOES.slice(0, 5).map(c => `<label><input type="radio" name="pg" value="${c}" ${(p.condicao === c || (!CONDICOES.slice(0, 5).includes(p.condicao) && c === 'À vista · dinheiro')) ? 'checked' : ''}> ${c}</label>`).join('')}</div>
  <div class="row"><button class="btn" id="bVoltar">Voltar</button><button class="btn pri" id="fechar">Fechar reposição</button></div></div></div></section>`;
  $('#main').innerHTML = h;
  const linhas = () => [...document.querySelectorAll('#ct .lin[data-p]')];
  const calc = () => { let un = 0, so = 0, tr = 0, val = 0, vc = 0;
    linhas().forEach(r => { const a = +r.dataset.ant, enc = r.querySelector('.enc').value, t = +r.querySelector('.trc').value || 0, pre = +r.dataset.pre;
      if (enc !== '' && !r.querySelector('.rep').dataset.mexeu) r.querySelector('.rep').value = Math.max(0, +r.dataset.alvo - (+enc - t));
      const rep = +r.querySelector('.rep').value || 0, s = enc === '' ? null : Math.max(0, a - +enc);
      r.querySelector('.so').textContent = s === null ? '—' : s; r.querySelector('.val').textContent = rep ? 'repor ' + brl(rep * pre) : '—';
      r.classList.toggle('vendeu', (s || 0) > 0);
      un += rep; so += s || 0; tr += t; val += rep * pre; vc += (s || 0) * pre; });
    if (cons) { val = vc; $('#tCons').textContent = brl(vc); }
    $('#tUn').textContent = un + ' un.'; $('#tSo').textContent = so + ' un.'; $('#tTr').textContent = tr; $('#tVal').textContent = brl(val); return { un, so, tr, val }; };
  $('#ct').addEventListener('input', e => { if (e.target.classList.contains('rep')) e.target.dataset.mexeu = 1; calc(); });
  ligarSteppers($('#ct')); calc();
  $('#bVoltar').onclick = () => irPara('rota');
  $('#fechar').onclick = async () => {
    const t = calc(), pg = document.querySelector('input[name=pg]:checked').value;
    const contagens = linhas().map(r => ({ produto_id: +r.dataset.p, deixado_anterior: +r.dataset.ant, encontrado: +r.querySelector('.enc').value, troca: +r.querySelector('.trc').value || 0, reposto: +r.querySelector('.rep').value || 0 }));
    const itens = cons ? linhas().map(r => ({ produto_id: +r.dataset.p, quantidade: Math.max(0, +r.dataset.ant - +r.querySelector('.enc').value), preco_unit: +r.dataset.pre, bonificado: 0 }))
                       : contagens.map(c => ({ produto_id: c.produto_id, quantidade: c.reposto, preco_unit: +linhas().find(r => +r.dataset.p === c.produto_id).dataset.pre, bonificado: 0 }));
    $('#fechar').disabled = true;
    try {
      await db.registrarReposicao({ pdvId: p.id, usuarioId: S.eu.id, contagens, itens,
        pedido: { tipo: cons ? 'reposicao_consignado' : 'reposicao', condicao: pg, unidades: cons ? t.so : t.un, valor: t.val, pago_na_hora: pg.startsWith('À vista'), vencimento: prazoDias(pg) ? new Date(Date.now() + prazoDias(pg) * DIA).toISOString().slice(0, 10) : null } });
      let n = await db.carregarPdv(p.id), extra = '';
      const r = regraAval();
      if (n.etapa === 'avaliacao' && (n.aval_reposicoes || 0) >= r.reposicoes) {
        const novo = Number(n.aval_media) >= r.meta_minima_sellout ? 'ativo' : 'revisao';
        await db.atualizarPdv(p.id, { etapa: novo }); extra = novo === 'ativo' ? ' Avaliação concluída: virou cliente ativo.' : ' Avaliação abaixo da meta: foi para revisão comercial.';
      } else if (n.etapa === 'avaliacao') extra = ` Avaliação: ${n.aval_reposicoes} de ${r.reposicoes}.`;
      await recarregar(); await avaliarRisco(); toast('Reposição registrada.' + extra); S.contando = null; irPara('rota');
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
  <div class="tile" style="background:${taxa > meta ? '#F3D6CF' : '#DCEBDF'}"><small>Taxa de troca · 4 semanas</small><b>${dec(taxa)}%</b><small>${taxa > meta ? 'acima' : 'dentro'} da meta de ${meta}%</small></div></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px">
  <div class="panel"><h3>Trocas por sabor · 4 semanas</h3><div class="bars">${ps.map(x => `<div class="bar"><span>${esc(x.n)} <small style="color:var(--mute)">· ${esc(x.l.split(' ')[0])}</small></span><div class="tr"><div class="fl" style="width:${x.v / mx * 100}%;background:${x.l.startsWith('Cookie') ? '#B8402A' : x.l.startsWith('Palha') ? '#D08A3C' : '#2E1A12'}"></div></div><b>${x.v}</b></div>`).join('')}</div></div>
  <div class="panel"><h3>PDVs com mais troca · 4 semanas</h3><div class="bars">${top.map(x => `<div class="bar" style="grid-template-columns:1fr 50px"><span>${esc(x.n)}</span><b>${x.v} un.</b></div>`).join('') || '<span style="color:var(--mute)">Sem trocas</span>'}</div></div></div>
  <table><tr><th>Pedido</th><th>Tipo</th><th>PDV</th><th>Unidades</th><th>Valor</th><th>Pagamento</th><th>Situação</th><th>Bling</th></tr>${peds.map(o => `<tr><td>#${o.numero}</td><td>${o.tipo === 'abertura' ? 'Abertura' : o.tipo === 'reposicao_consignado' ? 'Reposição (consignado)' : 'Reposição'}</td><td>${esc(o.pdvs?.nome)}</td><td>${o.unidades}</td><td>${brl(o.valor)}</td><td>${esc(o.condicao)}</td><td>${o.pago_na_hora ? 'Pago' : 'A receber' + (o.vencimento ? ' · ' + dstr(o.vencimento + 'T12:00') : '')}</td><td>${esc(o.bling_status)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhum pedido hoje.</td></tr>'}</table></div></section>`;
}

/* =================== campos reutilizáveis =================== */
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
      toast('Dados do CNPJ preenchidos' + (j.descricao_situacao_cadastral && j.descricao_situacao_cadastral !== 'ATIVA' ? ' · situação: ' + j.descricao_situacao_cadastral : '')); }
    catch (e) { toast(e.message); } b.disabled = false; b.textContent = 'Buscar'; };
}
const lerEmpresa = pre => ({ cnpj: soDig($('#' + pre + 'Cnpj').value) || null, razao_social: $('#' + pre + 'Razao').value.trim() || null });

/* ---------- visita rápida + comentário depois ---------- */
async function visitaRapida(p, depois) {
  try { const v = await db.registrarVisita(p.id, 'prospeccao', null, S.eu.id);
    if (p.etapa === 'mapeado') await db.atualizarPdv(p.id, { etapa: 'visitado' });
    S.ultimaVisita = { pdvId: p.id, id: v.id, em: new Date() }; await atualizarUm(p.id); toast('Visita registrada'); depois && depois(); } catch (e) { erro(e); }
}
function caixaComentario(p) {
  const u = S.ultimaVisita; if (!u || u.pdvId !== p.id) return '';
  return `<div class="esteira" style="background:#EEF3FA;border-color:#C9D7EA"><b>Visita registrada às ${u.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>
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
  const c = await db.criarContato({ nome: dados.nome || dados.telefone, empresa: dados.empresa || null, cargo: dados.cargo || null, telefone: dados.telefone || null, whatsapp: dados.whatsapp || null, email: dados.email || null, cnpj: dados.cnpj || null, observacao: dados.observacao || null, criado_por: S.eu.id });
  S.contatos.push(c); return c.id;
}
function campoContato() {
  return `<details style="margin-top:10px;background:var(--sand);border-radius:10px;padding:8px 10px"><summary style="cursor:pointer;font-weight:700;font-size:13px">Contato (responsável)</summary>
  <label>Contato já cadastrado</label><select id="kSel"><option value="">— novo contato —</option>${S.contatos.map(c => `<option value="${c.id}">${esc(c.nome)}${c.empresa ? ' · ' + esc(c.empresa) : ''}</option>`).join('')}</select>
  <div class="row"><div style="flex:1"><label>Nome</label><input id="kNome"></div><div style="flex:1"><label>Cargo</label><select id="kCargo"><option value="">—</option>${CARGOS.map(c => `<option>${c}</option>`).join('')}</select></div></div>
  <div class="row"><div style="flex:1"><label>Telefone / WhatsApp</label><input id="kTel" inputmode="tel"></div><div style="flex:1"><label>E-mail</label><input id="kEmail" type="email"></div></div></details>`;
}
async function contatoDoForm(empresa) {
  if ($('#kSel') && $('#kSel').value) return $('#kSel').value;
  const nome = $('#kNome')?.value.trim(), tel = $('#kTel')?.value.trim();
  if (!nome && !tel) return null;
  return obterContato({ nome, telefone: tel, whatsapp: tel, email: $('#kEmail')?.value.trim(), cargo: $('#kCargo')?.value || null, empresa });
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
  let h, tars; try { [h, tars] = await Promise.all([db.historico(p.id), db.tarefasDoPdv(p.id)]); } catch (e) { return erro(e); }
  const c = S.contatos.find(x => x.id === p.contato_id);
  const ev = [];
  h.etapas.forEach(e => ev.push({ em: e.em, cor: etapa(e.para).c, t: e.de ? `Passou de <b>${etapa(e.de).n}</b> para <b>${etapa(e.para).n}</b>` : `Negócio criado como <b>${etapa(e.para).n}</b>`, quem: e.perfis?.nome, obs: e.motivo }));
  const soV = Object.fromEntries(h.sellouts.map(s => [s.visita_id, s]));
  const pedV = Object.fromEntries(h.pedidos.filter(o => o.visita_id).map(o => [o.visita_id, o]));
  h.visitas.forEach(v => { const o = pedV[v.id], s = soV[v.id];
    const t = v.tipo === 'prospeccao' ? 'Visita de prospecção' : v.tipo === 'abertura' ? `Abertura: pedido #${o?.numero ?? '—'} · ${o?.unidades ?? 0} un. · ${brl(o?.valor)} · ${esc(o?.condicao || '')}`
      : `Reposição: sell-out <b>${s?.sellout ?? 0} un.</b> (${brl(s?.valor_sellout)})${s?.trocas ? ` · ${s.trocas} trocas` : ''} · pedido #${o?.numero ?? '—'} ${brl(o?.valor)} · ${esc(o?.condicao || '')}`;
    ev.push({ em: v.em, cor: v.tipo === 'prospeccao' ? '#3F6FA8' : '#D08A3C', t, quem: v.perfis?.nome, obs: v.observacao }); });
  ev.sort((a, b) => new Date(b.em) - new Date(a.em));
  const podeComprar = ['visitado', 'negociacao', 'mapeado'].includes(p.etapa);
  $('#main').innerHTML = `<section class="view on"><div class="dash" style="max-width:1100px">
  <div class="row" style="gap:8px"><button class="btn" id="pVoltar">← Voltar</button><span style="color:var(--mute)">Perfil do negócio</span></div>
  <div style="display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:start">
   <div style="display:flex;flex-direction:column;gap:16px">
    <div class="panel"><small style="color:var(--mute)">${esc(p.canal || '')} · ${esc([p.bairro, p.cidade].filter(Boolean).join(', '))}</small>
     <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px"><h2 style="font-family:Fraunces,Georgia,serif;margin:4px 0 8px;font-size:28px">${esc(p.nome)}</h2><button class="btn car" id="pTarTopo" style="white-space:nowrap">+ Tarefa</button></div>
     <div class="badges"><span class="badge st" style="background:${etapa(p.etapa).c}">${etapa(p.etapa).n}</span>${p.classe ? `<span class="badge">Classe ${p.classe}</span>` : ''}<span class="badge">${p.regiao || '—'} · ${esc(regNome(p.regiao))}</span>${p.expositor_id ? `<span class="badge">Expositor ${esc(expo(p.expositor_id).nome)}</span>` : ''}<span class="badge">${'★'.repeat(p.potencial || 0) || 'sem potencial'}</span>${p.geo_precisao && p.geo_precisao !== 'exata' ? `<span class="badge" style="background:#F7E9DD">localização ${esc(p.geo_precisao)}</span>` : ''}</div>
     ${p.razao_social || p.cnpj ? `<p style="color:var(--soft);margin:6px 0">${esc(p.razao_social || '')}${p.cnpj ? ' · CNPJ ' + esc(p.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')) : ''}</p>` : ''}
     <p style="color:var(--soft);margin:6px 0">${esc(p.endereco || 'Sem endereço')}${p.condicao ? ` · Condição: <b>${esc(p.condicao)}</b>` : ''}${p.proxima_reposicao ? ` · Próxima reposição: <b>${dstr(p.proxima_reposicao)}</b> (${prazoTxt(p)})` : ''}</p>
     ${p.observacao ? `<p style="background:var(--sand);padding:8px 10px;border-radius:8px;margin:8px 0 0">${esc(p.observacao)}</p>` : ''}
     <div class="row" style="flex-wrap:wrap;margin-top:12px">
      ${podeComprar ? '<button class="btn car" id="pComprar">Gerar compra →</button>' : ''}
      <button class="btn pri" id="pVisita">Registrar visita</button>
      <select id="pEtapa">${ETAPAS.map(e => `<option value="${e.k}" ${e.k === p.etapa ? 'selected' : ''}>${e.n}</option>`).join('')}</select>
      <button class="btn" id="pEditar">Editar dados</button><button class="btn" id="pMapa">Ver no mapa</button><button class="btn" id="pAjustar">Ajustar localização</button>
     </div></div>
    ${caixaComentario(p) ? `<div class="panel" style="padding:4px 14px 14px">${caixaComentario(p)}</div>` : ''}
    ${caixaEsteira(p) ? `<div class="panel" style="padding:4px 14px 14px">${caixaEsteira(p)}</div>` : ''}
    ${ultimos6(p) ? `<div class="panel">${ultimos6(p)}</div>` : ''}
    <div class="panel"><h3>Histórico</h3>${ev.map(e => `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--sand)"><i style="width:12px;height:12px;border-radius:50%;background:${e.cor};flex:none;margin-top:4px"></i><div style="flex:1"><div>${e.t}</div>${e.obs ? `<div style="color:var(--soft);margin-top:2px">“${esc(e.obs)}”</div>` : ''}<small style="color:var(--mute)">${quando(e.em)}${e.quem ? ' · ' + esc(e.quem) : ''}</small></div></div>`).join('') || '<p class="empty">Sem histórico ainda.</p>'}</div>
   </div>
   <div style="display:flex;flex-direction:column;gap:16px">
    <div class="panel"><h3>Contato</h3>${c ? `<div style="font-size:18px;font-weight:700">${esc(c.nome)}</div><div style="color:var(--soft)">${esc([c.cargo, c.empresa].filter(Boolean).join(' · '))}</div>
     <p style="margin:8px 0;line-height:1.7">${c.telefone ? `📞 ${esc(c.telefone)}<br>` : ''}${c.email ? `✉️ ${esc(c.email)}<br>` : ''}</p>
     <div class="row" style="flex-wrap:wrap">${linkWpp(c.whatsapp || c.telefone) ? `<a class="btn car" style="text-decoration:none" target="_blank" rel="noopener" href="${linkWpp(c.whatsapp || c.telefone)}">WhatsApp ↗</a>` : ''}<button class="btn" id="pVerContato">Abrir contato</button><button class="btn" id="pTrocarContato">Trocar</button></div>`
      : `<p class="empty" style="padding:6px 0">Nenhum contato vinculado.</p><button class="btn pri" id="pTrocarContato">Vincular contato</button>`}</div>
    <div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Próximas ações</h3><button class="btn pri" id="pNovaTar" style="padding:5px 10px">+ Nova</button></div><div style="margin-top:8px">${listaTarefas(tars.filter(t => !t.concluida), 'Nenhuma ação marcada.')}</div>${tars.some(t => t.concluida) ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--mute);font-size:12px">Concluídas (${tars.filter(t => t.concluida).length})</summary>${listaTarefas(tars.filter(t => t.concluida), '')}</details>` : ''}</div>
    <div class="panel"><h3>Resumo</h3><div class="kv" style="margin:0"><div><small>Criado em</small><b>${dstr(p.criado_em)}</b></div><div><small>Visitas</small><b>${h.visitas.length}</b></div><div><small>Pedidos</small><b>${h.pedidos.length}</b></div><div><small>Total pedido</small><b>${brl(h.pedidos.reduce((a, o) => a + Number(o.valor), 0))}</b></div></div></div>
    <div class="panel"><button class="btn" id="pExcluir" style="width:100%;color:#7A2414">Excluir negócio</button><small style="color:var(--mute);display:block;margin-top:6px">Use para apagar cadastro duplicado ou errado. Negócio com pedidos não pode ser excluído: mude para Inativo.</small></div>
   </div></div></div></section>`;
  $('#pVoltar').onclick = () => irPara(S.voltar || 'carteira');
  $('#pNovaTar').onclick = $('#pTarTopo').onclick = () => modalTarefa({ data: hojeISO(), pdv_id: p.id, contato_id: p.contato_id });
  document.querySelectorAll('[data-tid]').forEach(el => el.onclick = () => modalTarefa(tars.find(t => t.id === el.dataset.tid)));
  if ($('#pComprar')) $('#pComprar').onclick = () => { S.abPdv = p.id; irPara('abertura'); };
  $('#pVisita').onclick = () => visitaRapida(p, telaPerfil);
  ligarComentario(telaPerfil);
  $('#pEtapa').onchange = e => mudarEtapa(p.id, e.target.value, telaPerfil);
  $('#pMapa').onclick = () => { S.sel = p.id; irPara('mapa'); if (p.lat) mapa.setView([p.lat, p.lng], 16); };
  $('#pAjustar').onclick = () => { irPara('mapa'); if (p.lat) mapa.setView([p.lat, p.lng], 17); marcando = true; $('#hint').textContent = 'Toque no lugar exato de ' + p.nome; $('#hint').style.display = 'block';
    aoMarcar = async ([lng, lat]) => { try { const g = await geoReverso(lat, lng); await db.atualizarPdv(p.id, { lat, lng, geo_precisao: 'manual', regiao: await garantirRegiao(lng, lat, g.cidade || p.cidade), endereco: g.rua || p.endereco, bairro: g.bairro || p.bairro, cidade: g.cidade || p.cidade }); $('#hint').textContent = 'Toque no mapa onde fica o ponto'; await atualizarUm(p.id); toast('Localização ajustada'); } catch (e) { erro(e); } }; };
  $('#pEditar').onclick = () => { modal(`<h3>Editar ${esc(p.nome)}</h3><label>Nome fantasia</label><input id="eNome" value="${esc(p.nome)}">${campoEmpresa('e', p)}<label>Canal</label>${campoCanal('eCanal', p.canal)}
    <label>Endereço</label><input id="eEnd" value="${esc(p.endereco || '')}"><div class="row"><div style="flex:1"><label>Bairro</label><input id="eBai" value="${esc(p.bairro || '')}"></div><div style="flex:1"><label>Cidade</label><input id="eCid" value="${esc(p.cidade || '')}"></div></div>
    <div class="row"><div style="flex:1"><label>Classe</label><select id="eCla"><option value="">—</option>${['A', 'B', 'C'].map(x => `<option ${x === p.classe ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div style="flex:1"><label>Potencial</label>${campoPot('ePot', p.potencial)}</div></div>
    <label>Observação</label><textarea id="eObs" rows="3">${esc(p.observacao || '')}</textarea><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="eOk">Salvar</button></div>`);
    ligarCanal('eCanal'); ligarEmpresa('e', 'eNome');
    $('#eOk').onclick = async () => { try { await db.atualizarPdv(p.id, { nome: $('#eNome').value.trim() || p.nome, ...lerEmpresa('e'), canal: lerCanal('eCanal'), endereco: $('#eEnd').value.trim() || null, bairro: $('#eBai').value.trim() || null, cidade: $('#eCid').value.trim() || null, classe: $('#eCla').value || null, potencial: +$('#ePot').value, observacao: $('#eObs').value.trim() || null }); fecharModal(); await atualizarUm(p.id); toast('Dados salvos'); telaPerfil(); } catch (e) { erro(e); } }; };
  if ($('#pVerContato')) $('#pVerContato').onclick = () => abrirContato(c.id);
  $('#pTrocarContato').onclick = () => { modal(`<h3>Contato de ${esc(p.nome)}</h3>${campoContato()}<div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="kOk">Vincular</button></div>`); document.querySelector('#modalBox details').open = true;
    $('#kOk').onclick = async () => { try { const id = await contatoDoForm(p.nome); if (!id) return toast('Escolha um contato ou preencha o nome'); await db.atualizarPdv(p.id, { contato_id: id }); fecharModal(); await atualizarUm(p.id); toast('Contato vinculado'); telaPerfil(); } catch (e) { erro(e); } }; };
  $('#pExcluir').onclick = () => { modal(`<h3>Excluir ${esc(p.nome)}?</h3><p style="color:var(--soft)">Apaga o negócio e as visitas dele. Não dá para desfazer.</p><div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="xOk" style="background:#7A2414;border-color:#7A2414">Excluir</button></div>`);
    $('#xOk').onclick = async () => { try { await db.excluirPdv(p.id); fecharModal(); S.pdvs = S.pdvs.filter(x => x.id !== p.id); S.sel = null; toast('Negócio excluído'); irPara('carteira'); } catch (e) { fecharModal(); toast(/foreign key|violates/i.test(e.message) ? 'Esse negócio tem pedidos e não pode ser excluído. Mude a etapa para Inativo.' : 'Erro: ' + e.message); } }; };
}

/* =================== contatos =================== */
function telaContatos() {
  $('#main').innerHTML = `<section class="view on"><div class="tablewrap"><div class="toolbar"><input id="kq" placeholder="Buscar contato…" style="width:240px"><button class="btn pri" id="kNovo">+ Novo contato</button><span id="kN" style="color:var(--mute)"></span></div><table id="ktbl"></table></div></section>`;
  const neg = id => S.pdvs.filter(p => p.contato_id === id);
  const draw = () => { const q = norm($('#kq').value); const ds = S.contatos.filter(c => !q || norm(c.nome + ' ' + (c.empresa || '') + ' ' + (c.telefone || '')).includes(q));
    $('#kN').textContent = ds.length + ' contatos';
    $('#ktbl').innerHTML = `<tr><th>Nome</th><th>Empresa</th><th>Cargo</th><th>Telefone</th><th>E-mail</th><th>Negócios</th></tr>` + ds.map(c => `<tr data-id="${c.id}" style="cursor:pointer"><td><b>${esc(c.nome)}</b></td><td>${esc(c.empresa || '')}</td><td>${esc(c.cargo || '')}</td><td>${esc(c.telefone || '')}</td><td>${esc(c.email || '')}</td><td>${neg(c.id).map(p => esc(p.nome)).join(', ') || '—'}</td></tr>`).join('');
    $('#ktbl').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => abrirContato(tr.dataset.id)); };
  $('#kq').oninput = draw; draw();
  $('#kNovo').onclick = () => formContato(null);
}
function formContato(c) {
  modal(`<h3>${c ? 'Editar contato' : 'Novo contato'}</h3><label>Nome</label><input id="fNome" value="${esc(c?.nome || '')}">
  <div class="row"><div style="flex:1"><label>Empresa</label><input id="fEmp" value="${esc(c?.empresa || '')}"></div><div style="flex:1"><label>Cargo</label><select id="fCargo"><option value="">—</option>${CARGOS.map(x => `<option ${x === c?.cargo ? 'selected' : ''}>${x}</option>`).join('')}</select></div></div>
  <div class="row"><div style="flex:1"><label>Telefone</label><input id="fTel" value="${esc(c?.telefone || '')}"></div><div style="flex:1"><label>WhatsApp</label><input id="fWpp" value="${esc(c?.whatsapp || '')}"></div></div>
  <label>E-mail</label><input id="fEmail" value="${esc(c?.email || '')}">
  <label>Observação</label><textarea id="fObs" rows="2">${esc(c?.observacao || '')}</textarea>
  <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="fOk">Salvar</button></div>`);
  $('#fOk').onclick = async () => { const o = { nome: $('#fNome').value.trim(), empresa: $('#fEmp').value.trim() || null, cargo: $('#fCargo').value || null, telefone: $('#fTel').value.trim() || null, whatsapp: $('#fWpp').value.trim() || null, email: $('#fEmail').value.trim() || null, observacao: $('#fObs').value.trim() || null };
    if (!o.nome) return toast('Coloque o nome');
    const ja = acharContato(o, c?.id); if (ja) return toast(`Já existe o contato ${ja.nome} com esse nome, telefone ou e-mail.`);
    try { if (c) { const n = await db.atualizarContato(c.id, o); Object.assign(c, n); } else { S.contatos.push(await db.criarContato({ ...o, criado_por: S.eu.id })); }
      fecharModal(); toast('Contato salvo'); S.aba === 'contato' ? telaContato() : telaContatos(); } catch (e) { erro(e); } };
}
async function telaContato() {
  const c = S.contatos.find(x => x.id === S.contatoId); if (!c) return irPara('contatos');
  let tars = []; try { tars = await db.tarefasDoContato(c.id); } catch (e) { }
  const negs = S.pdvs.filter(p => p.contato_id === c.id), w = linkWpp(c.whatsapp || c.telefone);
  $('#main').innerHTML = `<section class="view on"><div class="dash" style="max-width:900px"><div class="row"><button class="btn" id="cVoltar">← Contatos</button></div>
  <div class="panel"><small style="color:var(--mute)">Contato</small><h2 style="font-family:Fraunces,Georgia,serif;margin:4px 0">${esc(c.nome)}</h2><div style="color:var(--soft)">${esc([c.cargo, c.empresa].filter(Boolean).join(' · '))}</div>
   <div class="kv"><div><small>Telefone</small><b>${esc(c.telefone || '—')}</b></div><div><small>WhatsApp</small><b>${esc(c.whatsapp || '—')}</b></div><div style="grid-column:1/-1"><small>E-mail</small><b style="font-size:14px">${esc(c.email || '—')}</b></div></div>
   ${c.observacao ? `<p style="color:var(--soft)">${esc(c.observacao)}</p>` : ''}
   <div class="row">${w ? `<a class="btn car" style="text-decoration:none" target="_blank" rel="noopener" href="${w}">WhatsApp ↗</a>` : ''}<button class="btn" id="cEditar">Editar</button></div></div>
  <div class="panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Tarefas</h3><button class="btn pri" id="cNovaTar" style="padding:5px 10px">+ Nova</button></div><div style="margin-top:8px">${listaTarefas(tars, 'Nenhuma tarefa com este contato.')}</div></div>
  <div class="panel"><h3>Negócios deste contato</h3>${negs.map(p => `<div class="stop" data-id="${p.id}" style="cursor:pointer"><div class="info"><b>${esc(p.nome)}</b><br><small style="color:var(--mute)">${esc(p.canal || '')} · ${esc(p.cidade || '')}</small></div><span class="badge st" style="background:${etapa(p.etapa).c}">${etapa(p.etapa).n}</span></div>`).join('') || '<p class="empty">Nenhum negócio vinculado.</p>'}</div></div></section>`;
  $('#cVoltar').onclick = () => irPara('contatos'); $('#cEditar').onclick = () => formContato(c);
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
    .replace(/,\s*(\d+)[^,]*$/, ', $1').trim();
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
const GMAPS_CANAL = [[/padaria|panificadora/, 'Padaria'], [/confeitaria|doceria|loja de doces|bolo/, 'Confeitaria'], [/cafeteria|cafe/, 'Cafeteria'],
  [/minimercado|mercearia|supermercado|mercado|armazem|emporio|atacad/, 'Minimercado'], [/hortifruti|fruteira|quitanda|sacolao/, 'Fruteira'],
  [/conveniencia|posto de (gasolina|combustivel)/, 'Conveniência'], [/cantina/, 'Cantina'],
  [/escola|colegio|faculdade|universidade|curso|cursinho|ensino|educa/, 'Escola / faculdade'],
  [/lanchonete|lancheria|hamburgueria|pastelaria|pastel|cachorro|lanche|acai|sorvet/, 'Lancheria'],
  [/restaurante|buffet|pizzaria|churrascaria|comida/, 'Restaurante'], [/bar\b|choperia|cervejaria|pub|boteco/, 'Bar'],
  [/academia|crossfit|pilates|fitness|ginastica|danca|clube/, 'Academia / clube'], [/farmacia|drogaria/, 'Farmácia'],
  [/barbearia|salao|cabeleireir|estetica|manicure/, 'Barbearia / salão'], [/lava|oficina|borracharia|auto ?center|mecanic/, 'Serviços automotivos'],
  [/pet/, 'Pet shop'], [/hospital|clinica|laboratorio/, 'Saúde'], [/hotel|hostel|pousada/, 'Hotel'], [/distribuidora de bebidas|bebidas|adega|tabacaria/, 'Bebidas / tabacaria'],
  [/banca|loterica|papelaria/, 'Banca / lotérica / papelaria']];
function canalGoogle(cat) { const n = norm(cat); const m = GMAPS_CANAL.find(([re]) => re.test(n)); return m ? m[1] : (cat || 'Outro'); }
const campo = (l, ...ks) => { for (const k of ks) if (l[k]) return l[k]; return ''; };
let gmaps = null;
function prepararGoogle(linhas, el) {
  const vistos = new Set(); let fechados = 0, fora = 0, repetidos = 0, jaTem = 0, semCoord = 0; const ok = [];
  for (const l of linhas) {
    const lat = parseFloat(String(campo(l, 'latitude', 'lat')).replace(',', '.')), lng = parseFloat(String(campo(l, 'longitude', 'lng', 'lon')).replace(',', '.')), nome = campo(l, 'name', 'nome', 'title');
    if (!nome || !isFinite(lat) || !isFinite(lng)) { semCoord++; continue; }
    if (/closed/i.test(campo(l, 'business_status'))) { fechados++; continue; }
    const cid = campo(l, 'city', 'cidade'); if (cid && !norm(cid).includes('porto alegre')) { fora++; continue; }
    const id = campo(l, 'google_id', 'place_id', 'cid') || norm(nome) + lat.toFixed(4) + lng.toFixed(4); if (vistos.has(id)) { repetidos++; continue; } vistos.add(id);
    if (S.pdvs.some(p => p.lat && norm(p.nome) === norm(nome) && distM(p, { lat, lng }) < 150)) { jaTem++; continue; }
    const cat = campo(l, 'category', 'type', 'categoria') || (campo(l, 'subtypes').split(',')[0] || '').trim();
    ok.push({ l, nome, lat, lng, cat, canal: canalGoogle(cat + ' ' + campo(l, 'subtypes')) });
  }
  const porCanal = {}; ok.forEach(x => { (porCanal[x.canal] = porCanal[x.canal] || { n: 0, cats: {} }).n++; porCanal[x.canal].cats[x.cat] = (porCanal[x.canal].cats[x.cat] || 0) + 1; });
  gmaps = { ok, porCanal };
  el.innerHTML = `<p style="margin:6px 0"><b>${ok.length} pontos novos</b> no arquivo · ${repetidos} repetidos no arquivo · ${jaTem} já estão no sistema · ${fechados} fechados · ${fora} fora de Porto Alegre${semCoord ? ` · ${semCoord} sem coordenada` : ''}</p>
   <p style="color:var(--soft);margin:4px 0 8px">Desmarque o que não quer importar. O canal é sugerido a partir da categoria do Google.</p>
   <table><tr><th></th><th>Canal</th><th>Categorias do Google</th><th style="text-align:right">Pontos</th></tr>${Object.entries(porCanal).sort((a, b) => b[1].n - a[1].n).map(([c, v]) => `<tr><td><input type="checkbox" data-gc="${esc(c)}" checked style="width:auto"></td><td><b>${esc(c)}</b></td><td><small>${Object.entries(v.cats).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${esc(k || '—')} (${n})`).join(' · ')}</small></td><td style="text-align:right">${v.n}</td></tr>`).join('')}</table>
   <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn pri" id="gImp">Importar selecionados</button></div><div id="gRes"></div>`;
  const atual = () => { const sel = new Set([...el.querySelectorAll('[data-gc]:checked')].map(c => c.dataset.gc)); return ok.filter(x => sel.has(x.canal)); };
  el.querySelectorAll('[data-gc]').forEach(c => c.onchange = () => { $('#gImp').textContent = `Importar ${atual().length} selecionados`; });
  $('#gImp').textContent = `Importar ${ok.length} selecionados`;
  $('#gImp').onclick = async () => {
    const lista = atual(); if (!lista.length) return toast('Nada selecionado'); $('#gImp').disabled = true;
    try {
      const regs = []; for (const x of lista) regs.push(await garantirRegiao(x.lng, x.lat, 'Porto Alegre'));
      const linhasDb = lista.map((x, i) => { const l = x.l, tel = campo(l, 'phone', 'telefone'), nota = campo(l, 'rating'), av = campo(l, 'reviews'), site = campo(l, 'site', 'website');
        return { nome: x.nome, canal: x.canal, endereco: campo(l, 'street', 'endereco') || (campo(l, 'full_address', 'address').split(' - ')[0]) || null, bairro: campo(l, 'borough', 'bairro', 'neighborhood') || null, cidade: 'Porto Alegre', lat: x.lat, lng: x.lng, geo_precisao: 'exata', potencial: 3,
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
  return [p.nome, p.endereco ? limparRua(p.endereco) : null, p.bairro, (p.cidade || '') + ' RS'].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim();
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
    const patch = { lat, lng, geo_precisao: 'exata', regiao: p.regiao || await garantirRegiao(lng, lat, p.cidade || l.city), ...(p.telefone || !tel ? {} : { telefone: tel }), ...(l.location_link ? { link_maps: l.location_link } : {}), ...(l.place_id ? { place_id: l.place_id } : {}) };
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
  el.innerHTML = `<p><b>${ok} localizados</b>${aprox.length ? ` · ${aprox.length} só pela rua (confira o pino)` : ''}${falha.length ? ` · <b style="color:#7A2414">${falha.length} sem localização</b>` : ''}</p>
   ${aprox.length || falha.length ? `<table><tr><th>Negócio</th><th>Endereço</th><th>Situação</th><th></th></tr>${[...aprox.map(p => [p, 'aproximado pela rua']), ...falha].map(([p, m]) => `<tr><td>${esc(p.nome)}</td><td>${esc([p.endereco, p.bairro, p.cidade].filter(Boolean).join(' · ') || '—')}</td><td>${esc(m)}</td><td><button class="mini" data-gper="${p.id}">abrir</button></td></tr>`).join('')}</table>` : ''}`;
  el.querySelectorAll('[data-gper]').forEach(b => b.onclick = () => abrirPerfil(b.dataset.gper));
}
const etapaDe = t => { const n = norm(t); return (ETAPAS.find(e => norm(e.n) === n || e.k === n.replace(/ /g, '')) || ETAPAS.find(e => n && norm(e.n).startsWith(n)) || {}).k; };
const expoDe = t => { const n = norm(t); return (S.base.expositores.find(e => norm(e.nome) === n || String(e.capacidade) === soDig(t)) || {}).id || null; };
const canalDe = t => CANAIS.find(c => norm(c) === norm(t)) || (t ? t.trim() : null);
const cargoDe = t => CARGOS.find(c => norm(c) === norm(t)) || (t ? t.trim() : null);
let pendentes = [];
function telaUploads() {
  $('#main').innerHTML = `<section class="view on"><div class="dash" style="max-width:1000px">
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
  el.innerHTML += `<div style="margin-top:10px"><b>${feitos} importados</b> · ${ignorados} já existiam${falhas.length ? ` · <b style="color:#7A2414">${falhas.length} com problema</b>` : ''}${pendentes.length ? ` · <b style="color:#8A4E17">${pendentes.length} com localização aproximada</b>` : ''}</div>
   ${pendentes.length ? `<div class="panel" style="margin-top:10px"><h3>Confirme a localização</h3><p style="color:var(--soft);margin-top:0">O endereço foi achado só no nível da rua ou da cidade. Aceite a posição aproximada (dá para ajustar depois no perfil, em "Ajustar localização") ou deixe de fora.</p><table><tr><th>Nome</th><th>Endereço informado</th><th>Encontrado</th><th></th></tr>${pendentes.map((x, i) => `<tr id="pend-${i}"><td>${esc(x.l.nome)}</td><td>${esc(x.l.localizacao)}</td><td>${esc(x.g.rua || '')}, ${esc(x.g.cidade || '')} <small>(${x.g.precisao})</small></td><td><button class="btn" data-acc="${i}">Aceitar</button></td></tr>`).join('')}</table><div class="row" style="margin-top:8px;justify-content:flex-end"><button class="btn car" id="accTodos">Aceitar todos</button></div></div>` : ''}
   ${falhas.length ? `<div class="panel" style="margin-top:10px"><h3>Não importados</h3><table><tr><th>Nome</th><th>Localização</th><th>Motivo</th></tr>${falhas.map(f => `<tr><td>${esc(f.l.nome || '—')}</td><td>${esc(f.l.localizacao || '')}</td><td>${esc(f.motivo)}</td></tr>`).join('')}</table></div>` : ''}`;
  const aceitar = async i => { const x = pendentes[i]; if (!x) return; pendentes[i] = null; try { await gravarImportado(k, x.l, x.g, x.base); const tr = document.getElementById('pend-' + i); if (tr) tr.style.opacity = .4; } catch (e) { erro(e); } };
  el.querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => { b.disabled = true; await aceitar(+b.dataset.acc); toast('Prospecto adicionado'); });
  if ($('#accTodos')) $('#accTodos').onclick = async () => { for (let i = 0; i < pendentes.length; i++) await aceitar(i); toast('Prospectos adicionados como Mapeado'); };
  await recarregar();
}
async function gravarImportado(k, l, g, base) {
  const contato_id = (l.contato_nome || l.contato_telefone) ? await obterContato({ nome: l.contato_nome, cargo: cargoDe(l.contato_cargo), telefone: l.contato_telefone, whatsapp: l.contato_telefone, empresa: l.nome }) : null;
  const extra = k === 'negocios' ? { etapa: etapaDe(l.etapa) || 'mapeado', classe: ['A', 'B', 'C'].includes((l.classe || '').toUpperCase()) ? l.classe.toUpperCase() : null, expositor_id: expoDe(l.expositor), condicao: l.condicao || null, origem: 'importacao' } : { etapa: 'mapeado', origem: 'importacao' };
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
    html: `<div style="position:relative"><svg width="${w}" height="${h}" viewBox="0 0 30 40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35));opacity:${feito ? .75 : 1}"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.3 15 39 15 39s14-13.7 14-24.1C29 7.2 22.7 1 15 1z" fill="${cor}" stroke="rgba(0,0,0,.25)"/><circle cx="15" cy="14.5" r="9" fill="#FBF7F0"/></svg>
    <b style="position:absolute;left:0;right:0;top:7px;text-align:center;font:700 12px 'DM Sans',sans-serif;color:${cor}">${feito || num}</b>${alerta ? '<i style="position:absolute;right:-3px;top:-3px;width:12px;height:12px;border-radius:50%;background:#B8402A;border:2px solid #FBF7F0"></i>' : ''}</div>` });
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
    paradasDeCarro(pl).forEach((g, i) => { if (g.pts.length > 1) L.circle([g.c.lat, g.c.lng], { radius: 300, color: '#2E1A12', weight: 1, dashArray: '4 6', fillOpacity: .03, interactive: false }).addTo(camada);
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
  ${p.melhor_horario ? `<p style="margin:4px 0">🕘 Melhor horário: <b>${esc(p.melhor_horario)}</b></p>` : ''}${p.fornecedor_atual ? `<p style="margin:4px 0">Fornecedor atual: <b>${esc(p.fornecedor_atual)}</b></p>` : ''}
  ${p.observacao ? `<p style="margin:4px 0;font-size:13px;color:var(--soft)">${esc(p.observacao)}</p>` : ''}
  ${p.acao_data ? `<p style="margin:4px 0">${chipAcao(p)}</p>` : ''}
  ${r ? `<div class="esteira" style="background:#E3F0E7;border-color:#BFD9C6"><b>Visitado hoje:</b> ${RESULTADOS[r]?.n || 'visita registrada'}</div>` : ''}
  <div class="sect"><h3>Como foi a visita?</h3><div class="resultados">${Object.entries(RESULTADOS).map(([k, v]) => `<button data-res="${k}" style="--c:${v.c}"><span>${v.ic}</span>${v.n}</button>`).join('')}</div></div>
  <div class="actions"><button class="btn" id="zPerfil">Abrir perfil</button>${p.lat ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking">Ir a pé até aqui ↗</a>` : ''}<button class="btn" id="zTirar">Tirar do plano</button></div>`;
  $('#zVolta').onclick = () => { PZ.aberto = null; painelProsp(); desenharProsp(); };
  $('#zPerfil').onclick = () => abrirPerfil(p.id);
  $('#zTirar').onclick = () => { PZ.plano = PZ.plano.filter(x => x !== p.id); PZ.aberto = null; salvarPlanoAtual(); painelProsp(); desenharProsp(); };
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
  const tarefaHtml = (titulo, dias, tipo, marcado = true) => `<div class="esteira" style="background:#EEF3FA;border-color:#C9D7EA"><label style="display:flex;gap:8px;align-items:center;margin:0;font-weight:700"><input type="checkbox" id="rTar" ${marcado ? 'checked' : ''} style="width:auto"> Criar tarefa</label>
    <input id="rTit" value="${esc(titulo)}" style="width:100%;margin-top:6px"><div class="row" style="margin-top:6px"><input id="rData" type="date" value="${daqui(dias)}" style="flex:1"><input id="rHora" type="time" style="flex:1"><select id="rTipo" style="flex:1">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === tipo ? 'selected' : ''}>${v.n}</option>`).join('')}</select></div></div>`;
  const criarTar = async () => { if (!$('#rTar')?.checked) return; await db.criarTarefa({ titulo: $('#rTit').value.trim() || 'Retorno', tipo: $('#rTipo').value, data: $('#rData').value, hora: $('#rHora').value || null, pdv_id: p.id, contato_id: p.contato_id || null, dono: S.eu.id }); };
  if (res === 'pensar') {
    modal(`<h3>Vai pensar · ${esc(p.nome)}</h3><label>Retorno por</label><div class="pay" id="rCanal"><label><input type="radio" name="rc" value="whatsapp" checked> WhatsApp</label><label><input type="radio" name="rc" value="visita"> Visita</label><label><input type="radio" name="rc" value="ligacao"> Ligação</label></div>
    <label>Anotação</label><textarea id="rObs" rows="2" placeholder="O que ficou de pensar, objeções…"></textarea>${tarefaHtml('Retorno: ' + p.nome + ' (vai pensar)', 2, 'whatsapp')}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="rOk">Salvar</button></div>`);
    $('#rCanal').onchange = () => { $('#rTipo').value = document.querySelector('input[name=rc]:checked').value; };
    $('#rOk').onclick = async () => { try { await db.registrarVisita(p.id, 'prospeccao', $('#rObs').value.trim() || null, S.eu.id, 'pensar'); await avancar(p, 'negociacao'); await criarTar(); fecharModal(); await concluirParada(p, 'pensar', 'Anotado: vai pensar.'); } catch (e) { erro(e); } };
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
        fecharModal(); await concluirParada(p, 'nao_estava', 'Anotado: não estava.');
      } catch (e) { erro(e); } };
    return;
  }
  if (res === 'fornecedor') {
    modal(`<h3>Já tem fornecedor · ${esc(p.nome)}</h3><label>Qual fornecedor?</label><input id="rForn" value="${esc(p.fornecedor_atual || '')}" placeholder="Marca ou distribuidor">
    <label>Anotação</label><textarea id="rObs" rows="2" placeholder="Preço que paga, giro, o que gostaria de melhorar…"></textarea>${tarefaHtml('Voltar em ' + p.nome + ' (tem fornecedor)', 60, 'visita')}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" onclick="fecharModal()">Cancelar</button><button class="btn pri" id="rOk">Salvar</button></div>`);
    $('#rOk').onclick = async () => { try { const f = $('#rForn').value.trim(); await db.registrarVisita(p.id, 'prospeccao', [f ? 'Fornecedor: ' + f : null, $('#rObs').value.trim() || null].filter(Boolean).join(' · ') || null, S.eu.id, 'fornecedor');
      await db.atualizarPdv(p.id, { fornecedor_atual: f || null, ...(p.etapa === 'mapeado' ? { etapa: 'visitado' } : {}) }); await criarTar(); fecharModal(); await concluirParada(p, 'fornecedor', 'Anotado: já tem fornecedor.'); } catch (e) { erro(e); } };
  }
}
// alertas de prospecção para o painel: visitados sem próxima ação
function alertasProsp() {
  return S.pdvs.filter(p => PROSP_ETAPAS.includes(p.etapa) && p.ultima_prospeccao && !p.acao_data)
    .sort((a, b) => (b.ultimo_resultado === 'nao_estava') - (a.ultimo_resultado === 'nao_estava') || new Date(b.ultima_prospeccao) - new Date(a.ultima_prospeccao));
}

/* =================== início =================== */
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') fecharModal(); });
iniciar();
