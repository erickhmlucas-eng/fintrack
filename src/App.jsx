import React, { useState, useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

/* ════════════════════════════════════════════════════════════════════════════
   FinTrack v2 — Controle financeiro pessoal
   Arquitetura: bloco único de dados + tudo derivado (nada calculado é salvo)
   ─ 1 chave no Supabase (fintrack:v2:data) salva atômica a cada mutação
   ─ Saldo por conta, faturas, reservas e métricas SEMPRE recalculados na hora
   ─ Contas e categorias referenciadas por ID (renomear não quebra histórico)
   ─ Crédito mora no mesmo extrato (forma:"credito"); fatura = filtro por mês
   ─ Migrador embutido lê os dados antigos (fintrack:*:v9) uma única vez
   ════════════════════════════════════════════════════════════════════════════ */

const SUPABASE_URL = "https://rjcgvlstriiepixogqnl.supabase.co";
const SUPABASE_KEY = "sb_publishable_qmzTdrWgLlNUiihld4Q3nw_iz_ED6aS";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const DATA_KEY = "fintrack:v2:data";

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const fmt = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(v) ? v : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MESES_C = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const hoje = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; };
const keyOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
const mesAtualKey = () => keyOf(new Date());
const shiftKey = (mk, delta) => { const [y,m] = mk.split("-").map(Number); const d = new Date(y, m-1+delta, 1); return keyOf(d); };
const labelKey = (mk) => { const [y,m] = mk.split("-"); return `${MESES[Number(m)-1]} ${y}`; };
const curtoKey = (mk) => MESES_C[Number(mk.split("-")[1])-1];
const dmy = (iso) => iso ? iso.slice(5).split("-").reverse().join("/") : "";
const parseVal = (s) => {
  if (typeof s === "number") return Math.abs(s);
  let t = String(s||"").replace(/R\$\s*/gi,"").replace(/\s/g,"").trim();
  if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(t)) return Math.abs(parseFloat(t.replace(/\./g,"").replace(",",".")));
  if (/^-?\d{1,3}(,\d{3})*\.\d{1,2}$/.test(t)) return Math.abs(parseFloat(t.replace(/,/g,"")));
  return Math.abs(parseFloat(t.replace(",","."))||0);
};
const FORMAS = [["pix","PIX"],["debito","Débito"],["dinheiro","Dinheiro"],["boleto","Boleto"]];
const FORMA_LABEL = { pix:"PIX", debito:"Débito", dinheiro:"Dinheiro", boleto:"Boleto", credito:"Crédito" };
const CORES = ["#6366f1","#8b5cf6","#0ea5e9","#22c55e","#f59e0b","#ef4444","#ec4899","#14b8a6","#a855f7","#2d2d2d","#1a4fcc","#e8001c","#8a05be","#64748b"];
const ICONES = ["🍔","🚌","⛽","💊","📦","👟","📚","🚗","✂️","🎮","🏥","📺","🏠","📌","🎯","💡","🎁","🐾","✈️","🏋️","🎵","🛒","🥖","💈"];

const CATS_SEED = [
  {nome:"Alimentação",icon:"🍔",cor:"#ef4444"},{nome:"Transporte",icon:"🚌",cor:"#f59e0b"},
  {nome:"Gasolina",icon:"⛽",cor:"#ea580c"},{nome:"Farmácia",icon:"💊",cor:"#ec4899"},
  {nome:"Compras online",icon:"📦",cor:"#8b5cf6"},{nome:"Roupa / Tênis",icon:"👟",cor:"#db2777"},
  {nome:"Cursos online",icon:"📚",cor:"#14b8a6"},{nome:"Carro / Seguro / IPVA",icon:"🚗",cor:"#0ea5e9"},
  {nome:"Corte de cabelo",icon:"✂️",cor:"#a855f7"},{nome:"Lazer",icon:"🎮",cor:"#6366f1"},
  {nome:"Saúde",icon:"🏥",cor:"#22c55e"},{nome:"Assinaturas",icon:"📺",cor:"#2563eb"},
  {nome:"Moradia",icon:"🏠",cor:"#ca8a04"},{nome:"Outros",icon:"📌",cor:"#64748b"},
];

/* ─── Modelo de dados ─────────────────────────────────────────────────────── */
/* Bloco único:
   {
     version: 2,
     settings: { name, theme, emergencyGoal, personalGoalName, personalGoalValue,
                 catBudgets: {catId: valor}, reservaAncora: {emergencia:{valor,data}, pessoal:{valor,data}} },
     accounts: [ {id, nome, cor, saldoInicial, ancoraData, temCartao, limite, fechamento, vencimento} ],
     cats:     [ {id, nome, icon, cor} ],
     months:   { "2026-07": { entradas:[], gastos:[], fixas:[], reservas:[], faturasPagas:{}, notes:"" } },
     dividas:  [ {id, nome, catId, total, parcelas, valorParcela, inicioMes, pagos:[], quitada} ],
   }
   Transação de gasto: {id, catId, descricao, valor, forma, accId, data,
                        parcela:{i,n,grupo}|null, fixaId?, dividaId?, transferParaId?}
   Entrada: {id, fonte, valor, data, accId}
   Fixa:    {id, nome, valor, dia, catId, recorrente, pago, gastoId}
   Reserva: {id, tipo:"emergencia"|"pessoal"|"outro", nome, valor, data, accId, retirada}
   faturasPagas: { [cardAccId]: {contaId, data} }  → fatura DESTE mês paga por aquela conta
*/

const novoMes = () => ({ entradas:[], gastos:[], fixas:[], reservas:[], faturasPagas:{}, notes:"" });

const seedData = () => ({
  version: 2,
  settings: {
    name:"", theme:"dark",
    emergencyGoal:10000, personalGoalName:"Meta pessoal", personalGoalValue:100000,
    catBudgets:{}, reservaAncora:{ emergencia:{valor:0,data:null}, pessoal:{valor:0,data:null} },
  },
  accounts: [
    {id:uid(),nome:"Nubank",cor:"#8a05be",saldoInicial:0,ancoraData:null,temCartao:true,limite:0,fechamento:1,vencimento:8},
    {id:uid(),nome:"C6",cor:"#2d2d2d",saldoInicial:0,ancoraData:null,temCartao:true,limite:0,fechamento:1,vencimento:8},
  ],
  cats: CATS_SEED.map(c=>({id:uid(),...c})),
  months: { [mesAtualKey()]: novoMes() },
  dividas: [],
});

function ensureMonth(d, mk){ if(!d.months[mk]) d.months[mk]=novoMes(); const m=d.months[mk];
  if(!m.entradas)m.entradas=[]; if(!m.gastos)m.gastos=[]; if(!m.fixas)m.fixas=[];
  if(!m.reservas)m.reservas=[]; if(!m.faturasPagas)m.faturasPagas={}; return m; }

/* migrate(): TODA evolução de schema acontece só aqui, na carga. */
function migrate(d){
  if(!d||typeof d!=="object") return seedData();
  if(!d.settings) d.settings={};
  const s=d.settings;
  if(!s.theme) s.theme="dark";
  if(s.emergencyGoal==null) s.emergencyGoal=10000;
  if(!s.personalGoalName) s.personalGoalName="Meta pessoal";
  if(s.personalGoalValue==null) s.personalGoalValue=100000;
  if(!s.catBudgets) s.catBudgets={};
  if(!s.reservaAncora) s.reservaAncora={emergencia:{valor:0,data:null},pessoal:{valor:0,data:null}};
  if(!s.reservaAncora.emergencia) s.reservaAncora.emergencia={valor:0,data:null};
  if(!s.reservaAncora.pessoal) s.reservaAncora.pessoal={valor:0,data:null};
  if(!Array.isArray(d.accounts)||!d.accounts.length) d.accounts=seedData().accounts;
  d.accounts.forEach(a=>{ if(a.temCartao==null)a.temCartao=true; if(a.fechamento==null)a.fechamento=1; if(a.vencimento==null)a.vencimento=8; if(a.saldoInicial==null)a.saldoInicial=0; });
  if(!Array.isArray(d.cats)||!d.cats.length) d.cats=seedData().cats;
  d.cats.forEach(c=>{ if(!c.id)c.id=uid(); });
  if(!d.months) d.months={};
  Object.keys(d.months).forEach(mk=>{
    const m=ensureMonth(d,mk);
    /* fixa paga sem gasto vinculado → cria o gasto (fonte única de verdade é o gasto) */
    m.fixas.forEach(f=>{
      if(f.pago&&!f.gastoId){
        const gid=uid();
        m.gastos.unshift({id:gid,catId:f.catId||d.cats[d.cats.length-1].id,descricao:f.nome,valor:f.valor||0,forma:"pix",accId:f.accIdPago||"",data:f.dataPago||hoje(),parcela:null,fixaId:f.id});
        f.gastoId=gid;
      }
      if(!f.pago) f.gastoId=null;
    });
  });
  if(!Array.isArray(d.dividas)) d.dividas=[];
  d.version=2;
  return d;
}

/* ─── Derivações (a contabilidade única do app) ───────────────────────────── */

const contaById=(d,id)=>(d.accounts||[]).find(a=>a.id===id);
const catById=(d,id)=>(d.cats||[]).find(c=>c.id===id)||{nome:"—",icon:"📌",cor:"#64748b"};

/* Fatura do cartão X no mês mk = soma dos gastos de crédito daquele cartão no mês */
function faturaDe(d, mk, cardId){
  const m=d.months[mk]; if(!m) return 0;
  return (m.gastos||[]).filter(g=>g.forma==="credito"&&g.accId===cardId).reduce((s,g)=>s+g.valor,0);
}
function gastosCartao(d, mk, cardId){
  const m=d.months[mk]; if(!m) return [];
  return (m.gastos||[]).filter(g=>g.forma==="credito"&&g.accId===cardId);
}

/* Em que mês de fatura cai uma compra feita em `dataCompra` num cartão com dia de fechamento F */
function mesFaturaDe(dataCompra, fechamento){
  const dt=new Date((dataCompra||hoje())+"T12:00");
  let m=dt.getMonth(), y=dt.getFullYear();
  if(fechamento>1 && dt.getDate()>=fechamento){ m++; if(m>11){m=0;y++;} }
  else if(fechamento<=1 && false){ /* fechamento dia 1: compra sempre no mês corrente */ }
  return `${y}-${String(m+1).padStart(2,"0")}`;
}

/* Saldo real de uma CONTA, sempre derivado:
   saldoInicial (ancorado em ancoraData) + entradas − gastos débito/pix
   ± transferências − faturas pagas por esta conta ∓ aportes/retiradas de reserva */
function saldoConta(d, accId){
  const acc=contaById(d,accId); if(!acc) return 0;
  const anc=acc.ancoraData||null;
  const conta=(dt)=>!anc||!dt||dt>=anc;
  let s=acc.saldoInicial||0;
  Object.entries(d.months||{}).forEach(([mk,m])=>{
    (m.entradas||[]).forEach(e=>{ if(e.accId===accId&&conta(e.data)) s+=e.valor; });
    (m.gastos||[]).forEach(g=>{
      if(g.forma==="credito") return;            /* crédito só sai quando a fatura é paga */
      if(!conta(g.data)) return;
      if(g.transferParaId){ if(g.accId===accId)s-=g.valor; if(g.transferParaId===accId)s+=g.valor; return; }
      if(g.accId===accId) s-=g.valor;
    });
    (m.reservas||[]).forEach(r=>{ if(r.accId!==accId||!conta(r.data)) return; s+=r.retirada?r.valor:-r.valor; });
    Object.entries(m.faturasPagas||{}).forEach(([cardId,fp])=>{
      if(fp&&fp.contaId===accId&&conta(fp.data)) s-=faturaDe(d,mk,cardId);
    });
  });
  return r2(s);
}

/* Métricas de um mês — função pura, sem estado salvo.
   Saídas do mês = débito/pix + faturas pagas + aportes. Crédito não pago = "comprometido". */
function metricsMes(d, mk){
  const m=d.months[mk];
  if(!m) return {entradas:0,gastosDeb:0,faturasPagas:0,aportes:0,retiradas:0,saidas:0,sobra:0,comprometido:0,fixasPend:0,gastoCredito:0};
  const entradas=(m.entradas||[]).reduce((s,e)=>s+e.valor,0);
  const gastosDeb=(m.gastos||[]).filter(g=>g.forma!=="credito"&&!g.transferParaId).reduce((s,g)=>s+g.valor,0);
  const gastoCredito=(m.gastos||[]).filter(g=>g.forma==="credito").reduce((s,g)=>s+g.valor,0);
  let faturasPagasV=0, comprometido=0;
  (d.accounts||[]).filter(a=>a.temCartao).forEach(a=>{
    const fv=faturaDe(d,mk,a.id);
    if(!fv) return;
    if(m.faturasPagas&&m.faturasPagas[a.id]) faturasPagasV+=fv; else comprometido+=fv;
  });
  const aportes=(m.reservas||[]).filter(r=>!r.retirada).reduce((s,r)=>s+r.valor,0);
  const retiradas=(m.reservas||[]).filter(r=>r.retirada).reduce((s,r)=>s+r.valor,0);
  const fixasPend=(m.fixas||[]).filter(f=>!f.pago).length;
  const saidas=gastosDeb+faturasPagasV+aportes;
  return {entradas,gastosDeb,faturasPagas:faturasPagasV,aportes,retiradas,saidas,sobra:entradas-saidas,comprometido,fixasPend,gastoCredito};
}

/* Totais de reserva: âncora + aportes − retiradas depois da data da âncora */
function reservaTotais(d){
  const anc=d.settings.reservaAncora||{};
  const calc=(tipo)=>{
    const a=anc[tipo]||{valor:0,data:null};
    let t=a.valor||0;
    Object.values(d.months||{}).forEach(m=>(m.reservas||[]).forEach(r=>{
      if(r.tipo!==tipo) return;
      if(a.data&&r.data&&r.data<a.data) return;
      t+=r.retirada?-r.valor:r.valor;
    }));
    return r2(t);
  };
  return {emergencia:calc("emergencia"), pessoal:calc("pessoal")};
}

/* Gastos por categoria de um mês (inclui crédito — é consumo real) */
function gastosPorCat(d, mk){
  const m=d.months[mk]; const o={};
  if(!m) return o;
  (m.gastos||[]).forEach(g=>{ if(g.transferParaId) return; o[g.catId]=(o[g.catId]||0)+g.valor; });
  return o;
}

/* Alertas inteligentes derivados (média dos 3 meses anteriores) */
function gerarAlertas(d, mk){
  const out=[];
  const met=metricsMes(d,mk);
  const atual=gastosPorCat(d,mk);
  const past={}; let n=0;
  for(let i=1;i<=3;i++){ const k=shiftKey(mk,-i); const m=d.months[k]; if(!m) continue; n++;
    const g=gastosPorCat(d,k); Object.entries(g).forEach(([c,v])=>{past[c]=(past[c]||0)+v;}); }
  if(n>0){
    Object.entries(atual).forEach(([c,v])=>{
      const avg=(past[c]||0)/n;
      if(avg>0&&v>=avg*2.5&&v>=100){ const cat=catById(d,c);
        out.push({icon:"⚠️",tipo:"warn",msg:`${cat.icon} ${cat.nome}: ${fmt(v)} este mês (${(v/avg).toFixed(1)}x sua média de ${fmt(avg)})`}); }
    });
  }
  const rt=reservaTotais(d);
  if(d.settings.emergencyGoal>0&&rt.emergencia<d.settings.emergencyGoal*0.2)
    out.push({icon:"🛡️",tipo:"warn",msg:`Reserva em ${((rt.emergencia/d.settings.emergencyGoal)*100).toFixed(0)}% da meta. Priorize aportes antes de parcelar compras novas.`});
  /* parcelas de dívida vs renda média */
  let inc=0,im=0;
  for(let i=1;i<=3;i++){ const m=d.months[shiftKey(mk,-i)]; if(!m) continue;
    const v=(m.entradas||[]).reduce((s,e)=>s+e.valor,0); if(v>0){inc+=v;im++;} }
  const rendaMedia=im>0?inc/im:met.entradas;
  const parcelasMes=d.dividas.filter(dv=>!dv.quitada).reduce((s,dv)=>{
    const idx=idxParcela(dv,mk); return idx>=0&&idx<dv.parcelas?s+dv.valorParcela:s; },0);
  if(rendaMedia>0&&parcelasMes>rendaMedia*0.3)
    out.push({icon:"🔗",tipo:"warn",msg:`Parcelas de dívidas comprometem ${((parcelasMes/rendaMedia)*100).toFixed(0)}% da sua renda média. Evite novas dívidas.`});
  if(met.comprometido>0&&rendaMedia>0&&met.comprometido>rendaMedia*0.5)
    out.push({icon:"💳",tipo:"warn",msg:`Faturas em aberto somam ${fmt(met.comprometido)} — mais da metade da renda média.`});
  return out.slice(0,4);
}

function idxParcela(dv, mk){
  const [y,m]=mk.split("-").map(Number);
  const [iy,im]=dv.inicioMes.split("-").map(Number);
  return (y*12+m)-(iy*12+im);
}

/* Sugerir categoria pela memória de descrições já lançadas */
function memoriaCategorias(d){
  const mem={};
  Object.values(d.months||{}).forEach(m=>(m.gastos||[]).forEach(g=>{
    if(!g.descricao||!g.catId) return;
    const k=g.descricao.toLowerCase().trim().slice(0,30);
    if(!mem[k]) mem[k]={};
    mem[k][g.catId]=(mem[k][g.catId]||0)+1;
  }));
  return mem;
}
function sugerirCat(desc, mem, def){
  if(!desc) return def;
  const k=desc.toLowerCase().trim().slice(0,30);
  const top=(o)=>Object.entries(o).sort((a,b)=>b[1]-a[1])[0][0];
  if(mem[k]) return top(mem[k]);
  for(const mk in mem){ if(mk.length<4) continue; if(k.includes(mk)||mk.includes(k)) return top(mem[mk]); }
  return def;
}

/* ─── Migrador do FinTrack antigo (v9) ────────────────────────────────────── */
/* Lê todas as chaves fintrack:*:v9 do Supabase e converte para o modelo novo.
   Importa transações reais; DESCARTA artefatos calculados:
   ajustes de saldo, entradas automáticas de retirada, marcadores de fatura. */
async function migrarLegado(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return null;
  const {data:rows,error}=await supabase.from("user_data").select("key,value")
    .eq("user_id",user.id).like("key","fintrack:%:v9");
  if(error||!rows||!rows.length) return null;

  const old={months:{},credits:{},settings:null,debts:[]};
  rows.forEach(r=>{
    const k=r.key;
    let mm;
    if(k==="fintrack:settings:v9") old.settings=r.value;
    else if(k==="fintrack:debts:v9") old.debts=r.value||[];
    else if((mm=k.match(/^fintrack:month:(\d+):(\d+):v9$/))) old.months[`${mm[1]}-${String(Number(mm[2])+1).padStart(2,"0")}`]=r.value;
    else if((mm=k.match(/^fintrack:credit:(\d+):(\d+):v9$/))) old.credits[`${mm[1]}-${String(Number(mm[2])+1).padStart(2,"0")}`]=r.value;
  });
  if(!old.settings&&!Object.keys(old.months).length) return null;

  const d=seedData();
  const os=old.settings||{};
  d.settings.name=os.name||"";
  d.settings.emergencyGoal=os.emergencyGoal||10000;
  d.settings.personalGoalName=os.personalGoalName||"Meta pessoal";
  d.settings.personalGoalValue=os.personalGoalValue||100000;
  /* âncoras de reserva: o total antigo (base+delta) vira a base de hoje */
  d.settings.reservaAncora={
    emergencia:{valor:r2((os.emergencyBase||0)+(os.emergencyDelta||0)),data:hoje()},
    pessoal:{valor:r2((os.personalBase||0)+(os.personalDelta||0)),data:hoje()},
  };

  /* contas: bancos antigos → contas por ID, com cartão embutido */
  const accByName={};
  d.accounts=(os.banks||[]).map(b=>{
    const a={id:uid(),nome:b.name,cor:b.color||"#6366f1",saldoInicial:b.currentBalance||0,
      ancoraData:b.adjustDate||null,temCartao:true,limite:b.limit||0,fechamento:1,vencimento:8};
    accByName[b.name]=a.id; return a;
  });
  if(!d.accounts.length) d.accounts=seedData().accounts;
  const accId=(name)=>accByName[name]||"";

  /* categorias antigas → por ID */
  const catByName={};
  d.cats=(os.expenseCats&&os.expenseCats.length?os.expenseCats:CATS_SEED).map(c=>{
    const nc={id:uid(),nome:c.name||c.nome,icon:c.icon||"📌",cor:c.color||c.cor||"#64748b"};
    catByName[nc.nome]=nc.id; return nc;
  });
  const catId=(name)=>catByName[name]||d.cats[d.cats.length-1].id;
  d.settings.catBudgets={};
  Object.entries(os.catBudgets||{}).forEach(([nome,v])=>{ if(v>0&&catByName[nome]) d.settings.catBudgets[catByName[nome]]=v; });

  /* dívidas: paidMonths antigo usa mês 0-indexado ("2026-6") → converter */
  const convMk=(s)=>{ const [y,m]=String(s).split("-").map(Number); return `${y}-${String(m+1).padStart(2,"0")}`; };
  d.dividas=(old.debts||[]).map(dv=>({
    id:dv.id||uid(),nome:dv.name,catId:catId(dv.category||"Outros"),total:dv.totalValue,
    parcelas:dv.installments,valorParcela:dv.monthlyValue,
    inicioMes:`${dv.startYear}-${String(Number(dv.startMonth)+1).padStart(2,"0")}`,
    pagos:(dv.paidMonths||[]).map(convMk),quitada:!!dv.closed,
  }));

  /* meses antigos */
  d.months={};
  Object.entries(old.months).forEach(([mk,om])=>{
    const m=ensureMonth(d,mk);
    m.notes=om.notes||"";
    (om.incomes||[]).forEach(e=>{
      if(e.isAdjustment||e.autoFromWithdrawal) return;              /* artefatos: fora */
      m.entradas.push({id:uid(),fonte:e.name||"Entrada",valor:e.value||0,data:e.date||"",accId:accId(e.bank)});
    });
    (om.expenses||[]).forEach(g=>{
      if(g.isAdjustment) return;                                     /* artefato: fora */
      const forma={PIX:"pix","Débito":"debito",Dinheiro:"dinheiro",Boleto:"boleto"}[g.method]||"pix";
      const ng={id:uid(),catId:catId(g.category),descricao:g.description||g.category,valor:g.value||0,
        forma,accId:accId(g.bank),data:g.date||"",parcela:null};
      if(g.isTransfer&&g.transferTo){ ng.transferParaId=accId(g.transferTo); }
      if(g.isDebtPayment&&g.debtId){ ng.dividaId=g.debtId; }
      m.gastos.push(ng);
    });
    (om.fixed||[]).forEach(f=>{
      /* marcadores de fatura de todas as gerações: fora */
      if(f.isAutoInvoice||f.isCardInvoice||f.isLegacyMarker) return;
      if(typeof f.name==="string"&&f.name.startsWith("Fatura ")) return;
      const nf={id:uid(),nome:f.name,valor:f.value||0,dia:null,catId:d.cats[d.cats.length-1].id,
        recorrente:f.recurring!==false,pago:!!f.paid,gastoId:null};
      if(nf.pago){
        const gid=uid();
        m.gastos.push({id:gid,catId:nf.catId,descricao:nf.nome,valor:nf.valor,forma:"pix",
          accId:accId(f.bank),data:f.paidDate||`${mk}-15`,parcela:null,fixaId:nf.id});
        nf.gastoId=gid;
      }
      m.fixas.push(nf);
    });
    (om.investments||[]).forEach(iv=>{
      const t=iv.type||"";
      const tipo=t.includes("Emergência")||t==="Retirada — Reserva"?"emergencia"
        :t==="Meta pessoal"||t==="Retirada — Meta"?"pessoal":"outro";
      m.reservas.push({id:uid(),tipo,nome:iv.name||t,valor:iv.value||0,data:iv.date||"",
        accId:accId(iv.bank),retirada:t.startsWith("Retirada")});
    });
  });

  /* compras de crédito antigas → gastos forma "credito" no mês da fatura */
  Object.entries(old.credits).forEach(([mk,oc])=>{
    const m=ensureMonth(d,mk);
    ((oc&&oc.purchases)||[]).forEach(p=>{
      m.gastos.push({id:uid(),catId:catId(p.category),descricao:p.name,valor:p.monthlyValue||0,
        forma:"credito",accId:accId(p.bank),data:p.date||"",
        parcela:p.installments>1?{i:p.installmentNum||1,n:p.installments,grupo:p.groupId||null}:null});
    });
  });

  /* faturas antigas já pagas (billsToPay) → faturasPagas no mês de vencimento */
  (os.billsToPay||[]).forEach(b=>{
    if(!b.paid) return;
    const mk=`${b.dueYear}-${String(Number(b.dueMonth)+1).padStart(2,"0")}`;
    const m=ensureMonth(d,mk);
    const card=accId(b.bankCard);
    if(card) m.faturasPagas[card]={contaId:accId(b.paidBank),data:b.paidDate||null};
  });

  ensureMonth(d,mesAtualKey());
  return migrate(d);
}

/* ─── Persistência ────────────────────────────────────────────────────────── */
async function dbLoad(){
  try{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user) return null;
    const {data}=await supabase.from("user_data").select("value").eq("key",DATA_KEY).eq("user_id",user.id).single();
    return data?.value??null;
  }catch(_){ return null; }
}
async function dbSave(blob){
  try{
    const {data:{user}}=await supabase.auth.getUser();
    if(!user) return false;
    const {error}=await supabase.from("user_data").upsert(
      {key:DATA_KEY,value:blob,user_id:user.id,updated_at:new Date().toISOString()},
      {onConflict:"user_id,key"});
    return !error;
  }catch(_){ return false; }
}

/* ════════════════════════════ UI base ════════════════════════════ */

function Donut({data,size=130,thick=22,label,sublabel}){
  const r=(size-thick)/2,cx=size/2,cy=size/2,circ=2*Math.PI*r;
  const total=data.reduce((s,x)=>s+x.value,0);
  let off=0;
  const segs=data.filter(x=>x.value>0).map(x=>{const dash=(total>0?x.value/total:0)*circ;const sg={...x,dash,gap:circ-dash,offset:circ-off};off+=dash;return sg;});
  return (
    <div style={{position:"relative",width:size,height:size,margin:"0 auto"}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        {total===0?<circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={thick}/>
          :segs.map((s,i)=><circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={thick} strokeDasharray={`${s.dash} ${s.gap}`} strokeDashoffset={s.offset}/>)}
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"0 10px"}}>
        {label&&<div style={{fontSize:12,fontWeight:800,textAlign:"center",lineHeight:1.2}}>{label}</div>}
        {sublabel&&<div style={{fontSize:9,color:"var(--muted)",textAlign:"center"}}>{sublabel}</div>}
      </div>
    </div>
  );
}

function GoalBar({label,icon,current,goal,color}){
  const pct=goal>0?Math.min((current/goal)*100,100):0;
  return (
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
        <span style={{fontSize:12,fontWeight:600}}>{icon} {label}</span>
        <span style={{fontSize:10,color:"var(--muted)"}}>{fmt(current)} / {fmt(goal)}</span>
      </div>
      <div style={{height:6,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:color,borderRadius:3,transition:"width .5s"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
        <span style={{fontSize:10,color,fontWeight:700}}>{pct.toFixed(1)}%</span>
        <span style={{fontSize:10,color:"var(--muted)"}}>Faltam {fmt(Math.max(goal-current,0))}</span>
      </div>
    </div>
  );
}

function Toast({msg,onDone}){
  useEffect(()=>{const t=setTimeout(onDone,2400);return()=>clearTimeout(t);},[onDone]);
  return <div className="toast">{msg}</div>;
}

function Modal({onClose,children,tall}){
  useEffect(()=>{document.body.style.overflow="hidden";return()=>{document.body.style.overflow="";};},[]);
  return (
    <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal-surface" style={{maxHeight:tall?"95vh":"88vh"}} onClick={e=>e.stopPropagation()}>{children}</div>
    </div>
  );
}
const MHdr=({title,onClose})=>(
  <div className="mhdr"><div className="mtitle">{title}</div><button className="mclose" onClick={onClose}>✕</button></div>
);

/* ════════════════════════════ Login ════════════════════════════ */
function AuthScreen(){
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [loading,setLoading]=useState(false); const [error,setError]=useState(""); const [msg,setMsg]=useState("");
  async function handle(){
    setLoading(true);setError("");setMsg("");
    try{
      if(mode==="login"){const{error}=await supabase.auth.signInWithPassword({email,password});if(error)setError(error.message);}
      else if(mode==="signup"){const{error}=await supabase.auth.signUp({email,password});if(error)setError(error.message);else setMsg("Conta criada! Verifique seu e-mail.");}
      else{const{error}=await supabase.auth.resetPasswordForEmail(email);if(error)setError(error.message);else setMsg("E-mail de recuperação enviado!");}
    }catch(_){}
    setLoading(false);
  }
  return (
    <div style={{minHeight:"100vh",background:"#09090f",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Plus Jakarta Sans',sans-serif",color:"#f0f0ff"}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:28,fontWeight:800,letterSpacing:"-1px"}}>Fin<span style={{color:"#6366f1"}}>Track</span></div>
          <div style={{fontSize:13,color:"#7070a0",marginTop:6}}>Controle financeiro pessoal</div>
        </div>
        <div style={{background:"#16161f",border:"1px solid rgba(255,255,255,.08)",borderRadius:20,padding:24}}>
          <div style={{display:"flex",gap:8,marginBottom:20}}>
            {[["login","Entrar"],["signup","Criar conta"]].map(([m,l])=>(
              <button key={m} onClick={()=>{setMode(m);setError("");setMsg("");}}
                style={{flex:1,padding:"9px 0",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,
                background:mode===m?"#6366f1":"#111118",color:mode===m?"#fff":"#7070a0"}}>{l}</button>
            ))}
          </div>
          <div style={{marginBottom:12}}>
            <label style={{display:"block",fontSize:11,fontWeight:700,opacity:.7,marginBottom:5}}>E-mail</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="seu@email.com"
              style={{width:"100%",background:"#111118",border:"1px solid rgba(255,255,255,.12)",color:"#f0f0ff",fontFamily:"inherit",fontSize:14,borderRadius:10,padding:"11px 12px",outline:"none",boxSizing:"border-box"}}/>
          </div>
          {mode!=="reset"&&(
            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:11,fontWeight:700,opacity:.7,marginBottom:5}}>Senha</label>
              <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handle()}
                style={{width:"100%",background:"#111118",border:"1px solid rgba(255,255,255,.12)",color:"#f0f0ff",fontFamily:"inherit",fontSize:14,borderRadius:10,padding:"11px 12px",outline:"none",boxSizing:"border-box"}}/>
            </div>
          )}
          {error&&<div style={{background:"rgba(239,68,68,.12)",border:"1px solid rgba(239,68,68,.3)",borderRadius:9,padding:"9px 12px",fontSize:12,color:"#ef4444",marginBottom:12}}>{error}</div>}
          {msg&&<div style={{background:"rgba(34,197,94,.1)",border:"1px solid rgba(34,197,94,.25)",borderRadius:9,padding:"9px 12px",fontSize:12,color:"#22c55e",marginBottom:12}}>{msg}</div>}
          <button onClick={handle} disabled={loading}
            style={{width:"100%",background:"#6366f1",color:"#fff",border:"none",fontFamily:"inherit",fontSize:14,fontWeight:700,borderRadius:11,padding:13,cursor:"pointer",opacity:loading?.6:1}}>
            {loading?"Aguarde...":{login:"Entrar",signup:"Criar conta",reset:"Enviar e-mail"}[mode]}
          </button>
          {mode==="login"&&<button onClick={()=>{setMode("reset");setError("");setMsg("");}}
            style={{width:"100%",background:"none",border:"none",color:"#7070a0",fontFamily:"inherit",fontSize:12,cursor:"pointer",marginTop:12,padding:4}}>Esqueci minha senha</button>}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════ App raiz ════════════════════════════ */
export default function FinTrack(){
  const [session,setSession]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{setSession(session);setAuthLoading(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>setSession(s));
    return ()=>subscription.unsubscribe();
  },[]);
  if(authLoading) return <div style={{minHeight:"100vh",background:"#09090f",display:"flex",alignItems:"center",justifyContent:"center",color:"#7070a0",fontFamily:"sans-serif"}}>Carregando…</div>;
  if(!session) return <AuthScreen/>;
  return <AppInner session={session}/>;
}

function AppInner({session}){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [migrando,setMigrando]=useState(false);
  const [mes,setMes]=useState(mesAtualKey());
  const [page,setPage]=useState("resumo");
  const [menuOpen,setMenuOpen]=useState(false);
  const [saving,setSaving]=useState(false);
  const [toast,setToast]=useState(null);
  const [modal,setModal]=useState(null);
  const saveChain=useRef(Promise.resolve());

  /* Carga: blob novo; se não existir, tenta migrar do legado; senão seed */
  useEffect(()=>{(async()=>{
    let d=await dbLoad();
    if(d){ setData(migrate(d)); setLoading(false); return; }
    setMigrando(true);
    d=await migrarLegado();
    if(!d) d=seedData();
    await dbSave(d);
    setData(d); setMigrando(false); setLoading(false);
  })();},[]);

  /* mutate: ÚNICO caminho de alteração. Clona, altera, salva o bloco inteiro.
     Salvamentos encadeados em fila — nunca dois uploads simultâneos. */
  function mutate(updater){
    setData(prev=>{
      const next=migrate(updater(JSON.parse(JSON.stringify(prev))));
      setSaving(true);
      saveChain.current=saveChain.current.then(()=>dbSave(next)).then(ok=>{
        setSaving(false);
        if(!ok) setToast("⚠️ Falha ao salvar — verifique a conexão");
      });
      return next;
    });
  }

  useEffect(()=>{ if(data&&!data.months[mes]) mutate(d=>{criarMesComFixas(d,mes);return d;}); },[mes,data]);

  const mem=useMemo(()=>data?memoriaCategorias(data):{},[data]);

  if(loading||!data) return (
    <div style={{minHeight:"100vh",background:"#09090f",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,color:"#7070a0",fontFamily:"sans-serif",fontSize:14}}>
      <div style={{fontSize:30}}>{migrando?"📦":"⏳"}</div>
      {migrando?"Migrando seus dados antigos…":"Carregando…"}
    </div>
  );

  const theme=data.settings.theme||"dark";
  const m=data.months[mes]||novoMes();
  const met=metricsMes(data,mes);
  const rt=reservaTotais(data);
  const totalContas=data.accounts.reduce((s,a)=>s+saldoConta(data,a.id),0);
  const alerts=gerarAlertas(data,mes);

  const NAV=[
    ["resumo","📊","Início"],["extrato","🧾","Extrato"],["apagar","📅","A pagar"],
    ["cartoes","💳","Cartões"],["carteira","💼","Carteira"],["reservas","💰","Reservas"],
    ["dividas","🔗","Dívidas"],["planejar","🎯","Planejar"],["anual","📈","Anual"],["config","⚙️","Config"],
  ];

  const props={data,mutate,mes,setMes,setModal,setToast,mem,met,rt,totalContas};

  return (
    <div className={theme}>
      <Styles/>
      {menuOpen&&<div className="sidebar-overlay" onClick={()=>setMenuOpen(false)}/>}
      <div className={`sidebar${menuOpen?" open":""}`}>
        <div className="sidebar-header">
          <div className="logo">Fin<em>Track</em></div>
          <div className="sidebar-user">
            <div className="avatar">{(data.settings.name||"U").slice(0,2).toUpperCase()}</div>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{data.settings.name||"Usuário"}</div>
              <div style={{fontSize:10,color:"var(--muted)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{session?.user?.email}</div>
            </div>
          </div>
        </div>
        <div className="sidebar-nav">
          {NAV.map(([id,ic,lb])=>(
            <button key={id} className={`snav${page===id?" active":""}`} onClick={()=>{setPage(id);setMenuOpen(false);}}>
              <span className="snav-ic">{ic}</span>{lb}
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="theme-toggle" onClick={()=>mutate(d=>{d.settings.theme=d.settings.theme==="dark"?"light":"dark";return d;})}>
            <span style={{fontSize:13,fontWeight:600,color:"var(--text2)"}}>{theme==="dark"?"🌙 Tema escuro":"☀️ Tema claro"}</span>
            <div className={`pill${theme==="light"?" on":""}`}/>
          </div>
          <button className="signout" onClick={()=>supabase.auth.signOut()}>🚪 Sair da conta</button>
        </div>
      </div>

      <div className="main">
        <div className="topbar">
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <button className="hamburger" onClick={()=>setMenuOpen(o=>!o)}><span/><span/><span/></button>
            <div className="logo">Fin<em>Track</em></div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {saving&&<span title="Salvando…" style={{fontSize:13}}>☁️</span>}
            <div className="avatar sm">{(data.settings.name||"U").slice(0,2).toUpperCase()}</div>
          </div>
        </div>

        <div className="month-nav">
          <button onClick={()=>setMes(shiftKey(mes,-1))}>‹</button>
          <span className="month-label">{labelKey(mes)}{saving&&" ☁️"}</span>
          <button onClick={()=>setMes(shiftKey(mes,1))}>›</button>
        </div>

        {page==="resumo"&&<PageResumo {...props} alerts={alerts} setPage={setPage}/>}
        {page==="extrato"&&<PageExtrato {...props}/>}
        {page==="apagar"&&<PageAPagar {...props}/>}
        {page==="cartoes"&&<PageCartoes {...props}/>}
        {page==="carteira"&&<PageCarteira {...props}/>}
        {page==="reservas"&&<PageReservas {...props}/>}
        {page==="dividas"&&<PageDividas {...props}/>}
        {page==="planejar"&&<PagePlanejar {...props}/>}
        {page==="anual"&&<PageAnual {...props}/>}
        {page==="config"&&<PageConfig {...props} userEmail={session?.user?.email}/>}
      </div>

      {["resumo","extrato","cartoes","reservas"].includes(page)&&(
        <button className="fab" onClick={()=>setModal({type:page==="cartoes"?"credito":page==="reservas"?"reserva":"gasto"})}>+</button>
      )}
      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
      {modal&&<ModalRouter modal={modal} setModal={setModal} data={data} mutate={mutate} mes={mes} mem={mem} setToast={setToast}/>}
    </div>
  );
}

/* ════════════════════════════ Página: Resumo ════════════════════════════ */
function PageResumo({data,mutate,mes,met,rt,totalContas,alerts,setModal,setPage}){
  const cards=data.accounts.filter(a=>a.temCartao);
  const catTot=gastosPorCat(data,mes);
  const catData=Object.entries(catTot).map(([id,v])=>({cat:catById(data,id),id,v,budget:data.settings.catBudgets[id]||0}))
    .sort((a,b)=>b.v-a.v);
  const maxCat=Math.max(...catData.map(c=>Math.max(c.v,c.budget)),1);
  /* evolução anual do ano do mês visualizado */
  const ano=mes.split("-")[0];
  const rows=Array.from({length:12},(_,i)=>{const k=`${ano}-${String(i+1).padStart(2,"0")}`;const mm=metricsMes(data,k);return {k,i,...mm};});
  const chartMax=Math.max(...rows.flatMap(r=>[r.entradas,r.saidas]),1);
  const score=(()=>{ if(!met.entradas) return 50; let s=50; const sr=met.sobra/met.entradas;
    if(sr>=0.3)s+=30; else if(sr>=0.2)s+=20; else if(sr>=0.1)s+=10; else if(sr<0)s-=20;
    if(met.fixasPend===0)s+=10; else if(met.fixasPend<=2)s+=5;
    const ep=rt.emergencia/(data.settings.emergencyGoal||10000);
    if(ep>=1)s+=10; else if(ep>=0.5)s+=5;
    return Math.max(0,Math.min(100,s)); })();
  const scoreCor=score>=85?"#22c55e":score>=70?"#3b82f6":score>=50?"#f59e0b":"#ef4444";
  const scoreLbl=score>=85?"Excelente":score>=70?"Ótimo":score>=50?"Bom":"Atenção";

  return (
    <div className="pg">
      <div className="hero">
        <div className="hero-greet">Olá, {data.settings.name||"👋"}</div>
        <div className="hero-sub">{labelKey(mes)} · {alerts.length>0?"⚠️ Atenção necessária":"Tudo em ordem"}</div>
        <div className="hero-actions">
          <button className="hbtn g" onClick={()=>setModal({type:"entrada"})}>+ Entrada</button>
          <button className="hbtn r" onClick={()=>setModal({type:"gasto"})}>+ Gasto</button>
          <button className="hbtn b" onClick={()=>setModal({type:"credito"})}>+ Crédito</button>
        </div>
      </div>

      {alerts.length>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {alerts.map((a,i)=>(<div key={i} className="alert warn"><span>{a.icon}</span><div>{a.msg}</div></div>))}
        </div>
      )}

      <div className="metrics4">
        <div className="mc4" onClick={()=>setPage("carteira")} style={{cursor:"pointer"}}>
          <div className="mc4-l">💼 Total nas contas</div>
          <div className="mc4-v" style={{color:totalContas>=0?"var(--green)":"var(--red)"}}>{fmt(totalContas)}</div>
          <div className="mc4-s">Saldo real · toque para ver</div>
        </div>
        <div className="mc4" onClick={()=>setPage("apagar")} style={{cursor:"pointer",borderColor:met.comprometido>0?"rgba(239,68,68,.3)":"var(--border)"}}>
          <div className="mc4-l">💳 Faturas em aberto</div>
          <div className="mc4-v" style={{color:met.comprometido>0?"var(--red)":"var(--muted)"}}>{fmt(met.comprometido)}</div>
          <div className="mc4-s">Comprometido no crédito</div>
        </div>
        <div className="mc4">
          <div className="mc4-l">📥 Entradas do mês</div>
          <div className="mc4-v" style={{color:"var(--green)"}}>{fmt(met.entradas)}</div>
          <div className="mc4-s">{(data.months[mes]?.entradas||[]).length} lançamento(s)</div>
        </div>
        <div className="mc4">
          <div className="mc4-l">📤 Saídas do mês</div>
          <div className="mc4-v" style={{color:"var(--red)"}}>{fmt(met.saidas)}</div>
          <div className="mc4-s">{fmt(met.aportes)} guardado em reservas</div>
        </div>
      </div>

      <div className="card" style={{display:"flex",alignItems:"center",gap:14}}>
        {(()=>{const r=28,c=2*Math.PI*r,dash=(score/100)*c;return(
          <div style={{position:"relative",width:60,height:60,flexShrink:0}}>
            <svg width="60" height="60" viewBox="0 0 60 60" style={{transform:"rotate(-90deg)"}}>
              <circle cx="30" cy="30" r={r} fill="none" stroke="var(--border)" strokeWidth="6"/>
              <circle cx="30" cy="30" r={r} fill="none" stroke={scoreCor} strokeWidth="6" strokeDasharray={`${dash} ${c-dash}`} strokeLinecap="round"/>
            </svg>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:scoreCor}}>{score}</div>
          </div>);})()}
        <div>
          <div className="st">Saúde financeira</div>
          <div style={{fontSize:15,fontWeight:800,color:scoreCor}}>{scoreLbl}</div>
          <div style={{fontSize:10,color:"var(--muted)"}}>Sobra do mês: <strong style={{color:met.sobra>=0?"var(--green)":"var(--red)"}}>{fmt(met.sobra)}</strong>{met.fixasPend>0?` · ${met.fixasPend} fixa(s) pendente(s)`:" · ✓ fixas em dia"}</div>
        </div>
      </div>

      <div className="card">
        <div className="st" style={{marginBottom:8}}>Evolução — {ano}</div>
        <div style={{display:"flex",gap:10,marginBottom:6}}>
          {[["var(--green)","Entradas"],["var(--red)","Saídas"]].map(([c,l])=>(
            <span key={l} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"var(--muted)"}}><span style={{width:10,height:10,borderRadius:2,background:c}}/>{l}</span>
          ))}
        </div>
        <div className="chart" style={{height:74}}>
          {rows.map(r=>(
            <div key={r.k} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div className="cgrp">
                <div className="cbar" style={{background:r.k===mes?"var(--green)":"rgba(34,197,94,.3)",height:`${Math.max((r.entradas/chartMax)*74,r.entradas>0?2:0)}px`}}/>
                <div className="cbar" style={{background:r.k===mes?"var(--red)":"rgba(239,68,68,.3)",height:`${Math.max((r.saidas/chartMax)*74,r.saidas>0?2:0)}px`}}/>
              </div>
              <div className="clbl" style={{color:r.k===mes?"var(--accent)":"var(--muted)",fontWeight:r.k===mes?700:400}}>{MESES_C[r.i]}</div>
            </div>
          ))}
        </div>
      </div>

      {cards.length>0&&(
        <div className="card">
          <div className="st" style={{marginBottom:10}}>Crédito — faturas de {MESES[Number(mes.split("-")[1])-1]}</div>
          {cards.map(a=>{
            const fv=faturaDe(data,mes,a.id);
            const paga=!!(data.months[mes]?.faturasPagas||{})[a.id];
            if(!fv) return null;
            const pct=a.limite>0?Math.min((fv/a.limite)*100,100):0;
            return (
              <div key={a.id} style={{marginBottom:11}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,alignItems:"center"}}>
                  <span style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:700}}>
                    <span style={{width:9,height:9,borderRadius:"50%",background:a.cor}}/>{a.nome}
                    {paga&&<span className="chip" style={{background:"rgba(34,197,94,.15)",color:"var(--green)"}}>paga</span>}
                  </span>
                  <span style={{fontSize:12,fontWeight:800,color:paga?"var(--green)":"var(--red)"}}>{fmt(fv)}</span>
                </div>
                {a.limite>0&&<div style={{height:4,background:"var(--border)",borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:pct>90?"var(--red)":pct>70?"var(--gold)":a.cor,borderRadius:2}}/>
                </div>}
              </div>
            );
          })}
          {cards.every(a=>!faturaDe(data,mes,a.id))&&<div style={{fontSize:11,color:"var(--green)",textAlign:"center",fontWeight:600}}>✅ Nenhum gasto de crédito neste mês</div>}
        </div>
      )}

      <div className="card">
        <div className="st" style={{marginBottom:10}}>Metas & reservas</div>
        <GoalBar label="Reserva de emergência" icon="🛡️" current={rt.emergencia} goal={data.settings.emergencyGoal} color="var(--green)"/>
        <GoalBar label={data.settings.personalGoalName} icon="🎯" current={rt.pessoal} goal={data.settings.personalGoalValue} color="var(--accent)"/>
      </div>

      {catData.length>0&&(
        <div className="card">
          <div className="st" style={{marginBottom:10}}>Gastos por categoria (inclui crédito)</div>
          {catData.map(c=>{
            const hasB=c.budget>0, pct=hasB?Math.min((c.v/c.budget)*100,100):0;
            const over=hasB&&c.v>c.budget, warn=hasB&&pct>=80&&!over;
            return (
              <div key={c.id} style={{marginBottom:9}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3,alignItems:"center"}}>
                  <span style={{fontSize:11,fontWeight:500}}>{c.cat.icon} {c.cat.nome}</span>
                  <span style={{fontSize:10,display:"flex",gap:5,alignItems:"center"}}>
                    {over&&<span style={{color:"var(--red)",fontSize:9,fontWeight:700}}>⚠ estourou</span>}
                    {warn&&<span style={{color:"var(--gold)",fontSize:9,fontWeight:700}}>⚡ quase</span>}
                    <span style={{color:"var(--muted)"}}>{fmt(c.v)}{hasB?` / ${fmt(c.budget)}`:""}</span>
                  </span>
                </div>
                <div style={{height:5,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:3,width:`${hasB?pct:(c.v/maxCat)*100}%`,background:over?"var(--red)":warn?"var(--gold)":c.cat.cor}}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="st" style={{marginBottom:8}}>Observações do mês</div>
        <textarea className="notesarea" placeholder="Ajustes, decisões pro próximo mês…" value={data.months[mes]?.notes||""}
          onChange={e=>{const v=e.target.value;mutate(d=>{ensureMonth(d,mes).notes=v;return d;});}}/>
      </div>
    </div>
  );
}

/* ════════════════════════════ Página: Extrato ════════════════════════════ */
function PageExtrato({data,mutate,mes,setModal,setToast}){
  const [aba,setAba]=useState("gastos");
  const [busca,setBusca]=useState("");
  const [fCat,setFCat]=useState("");
  const [fAcc,setFAcc]=useState("");
  const [sort,setSort]=useState("date_desc");
  const m=data.months[mes]||novoMes();

  const aplicar=(items,nameF,valF="valor")=>{
    let out=items.slice();
    if(busca){const q=busca.toLowerCase();out=out.filter(i=>`${i[nameF]||""} ${catById(data,i.catId).nome} ${(contaById(data,i.accId)||{}).nome||""}`.toLowerCase().includes(q));}
    if(fCat)out=out.filter(i=>i.catId===fCat);
    if(fAcc)out=out.filter(i=>i.accId===fAcc);
    const cmp={date_desc:(a,b)=>(b.data||"").localeCompare(a.data||""),date_asc:(a,b)=>(a.data||"").localeCompare(b.data||""),
      value_desc:(a,b)=>(b[valF]||0)-(a[valF]||0),value_asc:(a,b)=>(a[valF]||0)-(b[valF]||0)}[sort];
    if(cmp)out.sort(cmp);
    return out;
  };

  const gastos=aplicar((m.gastos||[]).filter(g=>g.forma!=="credito"&&!g.fixaId&&!g.dividaId),"descricao");
  const fixos=aplicar((m.gastos||[]).filter(g=>g.forma!=="credito"&&(g.fixaId||g.dividaId)),"descricao");
  const creditos=aplicar((m.gastos||[]).filter(g=>g.forma==="credito"),"descricao");
  const entradas=aplicar(m.entradas||[],"fonte");
  const totG=gastos.filter(g=>!g.transferParaId).reduce((s,g)=>s+g.valor,0);
  const totF=fixos.reduce((s,g)=>s+g.valor,0);
  const totE=entradas.reduce((s,e)=>s+e.valor,0);
  const totC=creditos.reduce((s,g)=>s+g.valor,0);

  function delGasto(id){
    mutate(d=>{const mm=ensureMonth(d,mes);
      const g=mm.gastos.find(x=>x.id===id);
      if(g?.fixaId){const f=mm.fixas.find(x=>x.id===g.fixaId);if(f){f.pago=false;f.gastoId=null;}}
      if(g?.dividaId){const dv=d.dividas.find(x=>x.id===g.dividaId);if(dv){dv.pagos=dv.pagos.filter(k=>k!==mes);}}
      mm.gastos=mm.gastos.filter(x=>x.id!==id);return d;});
  }
  function delEntrada(id){ mutate(d=>{const mm=ensureMonth(d,mes);mm.entradas=mm.entradas.filter(x=>x.id!==id);return d;}); }

  const Item=({g,tipo})=>{
    const cat=catById(data,g.catId);
    const acc=contaById(data,g.accId);
    const dest=g.transferParaId?contaById(data,g.transferParaId):null;
    return (
      <div className="txi" onClick={()=>setModal(tipo==="entrada"?{type:"entrada",edit:g}:g.forma==="credito"?{type:"credito",edit:g}:{type:"gasto",edit:g})}>
        <div className="txicon" style={{background:tipo==="entrada"?"rgba(34,197,94,.15)":g.transferParaId?"rgba(99,102,241,.15)":cat.cor+"30"}}>
          {tipo==="entrada"?"💰":g.transferParaId?"🔄":cat.icon}
        </div>
        <div className="txinfo">
          <div className="txd">{tipo==="entrada"?g.fonte:g.transferParaId?`${acc?.nome||"?"} → ${dest?.nome||"?"}`:(g.descricao||cat.nome)}</div>
          <div className="txm">
            <span>{dmy(g.data)}</span>
            {tipo!=="entrada"&&!g.transferParaId&&<span className="chip" style={{background:(acc?.cor||"#888")+"30",color:acc?.cor||"var(--muted)"}}>{acc?.nome||"—"}</span>}
            {tipo!=="entrada"&&<span>{g.transferParaId?"Transferência":FORMA_LABEL[g.forma]}</span>}
            {g.parcela&&<span>parcela {g.parcela.i}/{g.parcela.n}</span>}
            {g.fixaId&&<span className="chip" style={{background:"rgba(59,130,246,.15)",color:"var(--blue)"}}>fixa</span>}
            {g.dividaId&&<span className="chip" style={{background:"rgba(99,102,241,.15)",color:"var(--accent)"}}>dívida</span>}
          </div>
        </div>
        <div className="txa" style={{color:tipo==="entrada"?"var(--green)":g.transferParaId?"var(--muted)":"var(--red)"}}>
          {tipo==="entrada"?"+":g.transferParaId?"":"-"}{fmt(g.valor)}
        </div>
        <button className="tdel" onClick={ev=>{ev.stopPropagation();tipo==="entrada"?delEntrada(g.id):delGasto(g.id);}}>✕</button>
      </div>
    );
  };

  return (
    <div className="pg">
      <div style={{display:"flex",gap:6}}>
        {[["gastos",`Gastos · ${fmt(totG)}`],["fixas",`Fixas · ${fmt(totF)}`],["credito",`Crédito · ${fmt(totC)}`],["entradas",`Entradas · ${fmt(totE)}`]].map(([id,lb])=>(
          <button key={id} className={`tab${aba===id?" on":""}`} onClick={()=>setAba(id)}>{lb}</button>
        ))}
      </div>
      <div style={{display:"flex",gap:6}}>
        <input className="fi" placeholder="🔍 Buscar…" value={busca} onChange={e=>setBusca(e.target.value)} style={{flex:1,fontSize:12,padding:"8px 12px"}}/>
        <select className="fi" value={sort} onChange={e=>setSort(e.target.value)} style={{flex:"0 0 120px",fontSize:11,padding:8}}>
          <option value="date_desc">Mais recente</option><option value="date_asc">Mais antigo</option>
          <option value="value_desc">Maior valor</option><option value="value_asc">Menor valor</option>
        </select>
      </div>
      <div style={{display:"flex",gap:6}}>
        <select className="fi" value={fCat} onChange={e=>setFCat(e.target.value)} style={{flex:1,fontSize:11,padding:8}}>
          <option value="">Todas as categorias</option>
          {data.cats.map(c=><option key={c.id} value={c.id}>{c.icon} {c.nome}</option>)}
        </select>
        <select className="fi" value={fAcc} onChange={e=>setFAcc(e.target.value)} style={{flex:1,fontSize:11,padding:8}}>
          <option value="">Todas as contas</option>
          {data.accounts.map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="bulkbtn" onClick={()=>setModal({type:"bulk",destino:aba==="fixas"?"gastos":aba})}>📋 Colar em lote</button>
        <button className="bulkbtn" style={{color:"var(--accent)",borderColor:"rgba(99,102,241,.3)"}} onClick={()=>setModal({type:"import",destino:aba==="fixas"?"gastos":aba})}>📂 Importar CSV/PDF</button>
      </div>
      <div className="txlist">
        {aba==="gastos"&&(gastos.length?gastos.map(g=><Item key={g.id} g={g} tipo="gasto"/>):<div className="empty">Nenhum gasto em {labelKey(mes)}.<br/>Toque no <strong style={{color:"var(--accent)"}}>+</strong> para lançar.</div>)}
        {aba==="fixas"&&(fixos.length?fixos.map(g=><Item key={g.id} g={g} tipo="gasto"/>):<div className="empty">Nenhuma fixa paga em {labelKey(mes)}.<br/>Cadastre e marque como paga na aba <strong style={{color:"var(--accent)"}}>A pagar</strong>.</div>)}
        {aba==="credito"&&(creditos.length?creditos.map(g=><Item key={g.id} g={g} tipo="gasto"/>):<div className="empty">Nenhuma compra de crédito na fatura de {labelKey(mes)}.</div>)}
        {aba==="entradas"&&(entradas.length?entradas.map(e=><Item key={e.id} g={e} tipo="entrada"/>):<div className="empty">Nenhuma entrada em {labelKey(mes)}.</div>)}
      </div>
    </div>
  );
}

/* ════════════════════════════ Página: A pagar ════════════════════════════ */
function PageAPagar({data,mutate,mes,setModal}){
  const m=data.months[mes]||novoMes();
  const cards=data.accounts.filter(a=>a.temCartao);
  const contas=data.accounts;
  const [pagando,setPagando]=useState(null);   /* {tipo:"fatura"|"fixa"|"divida", id} */
  const [selConta,setSelConta]=useState("");
  const [selForma,setSelForma]=useState("pix");

  const faturas=cards.map(a=>({acc:a,valor:faturaDe(data,mes,a.id),paga:(m.faturasPagas||{})[a.id]||null}))
    .filter(f=>f.valor>0);
  const fixasPend=(m.fixas||[]).filter(f=>!f.pago);
  const fixasPagas=(m.fixas||[]).filter(f=>f.pago);
  const dividasMes=data.dividas.filter(dv=>!dv.quitada).map(dv=>{
    const idx=idxParcela(dv,mes);
    if(idx<0||idx>=dv.parcelas) return null;
    return {dv,idx,paga:dv.pagos.includes(mes)};
  }).filter(Boolean);

  const totalPend=faturas.filter(f=>!f.paga).reduce((s,f)=>s+f.valor,0)
    +fixasPend.reduce((s,f)=>s+(f.valor||0),0)
    +dividasMes.filter(x=>!x.paga).reduce((s,x)=>s+x.dv.valorParcela,0);

  function pagarFatura(cardId){
    if(!selConta) return;
    mutate(d=>{
      const acc2=d.accounts.find(a=>a.id===cardId);
      const venc=acc2?.vencimento||15, fech=acc2?.fechamento||1;
      let [yy,mm2]=mes.split("-").map(Number);
      if(venc<fech){ mm2++; if(mm2>12){mm2=1;yy++;} }
      const dtPag=`${yy}-${String(mm2).padStart(2,"0")}-${String(Math.min(venc,28)).padStart(2,"0")}`;
      ensureMonth(d,mes).faturasPagas[cardId]={contaId:selConta,data:dtPag};return d;});
    setPagando(null);setSelConta("");
  }
  function desfazerFatura(cardId){
    mutate(d=>{delete ensureMonth(d,mes).faturasPagas[cardId];return d;});
  }
  function pagarFixa(fixaId){
    if(!selConta) return;
    mutate(d=>{
      const mm=ensureMonth(d,mes);
      const f=mm.fixas.find(x=>x.id===fixaId); if(!f) return d;
      const gid=uid();
      const dtPag=`${mes}-${String(Math.min(f.dia||15,28)).padStart(2,"0")}`;
      mm.gastos.unshift({id:gid,catId:f.catId||d.cats[d.cats.length-1].id,descricao:f.nome,valor:f.valor||0,
        forma:selForma,accId:selConta,data:dtPag,parcela:null,fixaId:f.id});
      f.pago=true; f.gastoId=gid; return d;
    });
    setPagando(null);setSelConta("");
  }
  function desfazerFixa(fixaId){
    mutate(d=>{const mm=ensureMonth(d,mes);const f=mm.fixas.find(x=>x.id===fixaId);
      if(f){mm.gastos=mm.gastos.filter(g=>g.id!==f.gastoId);f.pago=false;f.gastoId=null;}return d;});
  }
  function pagarDivida(dvId){
    if(!selConta) return;
    mutate(d=>{
      const dv=d.dividas.find(x=>x.id===dvId); if(!dv||dv.pagos.includes(mes)) return d;
      const mm=ensureMonth(d,mes);
      const idx=idxParcela(dv,mes);
      const dtPag=`${mes}-15`;
      mm.gastos.unshift({id:uid(),catId:dv.catId,descricao:`Parcela: ${dv.nome} (${idx+1}/${dv.parcelas})`,
        valor:dv.valorParcela,forma:selForma,accId:selConta,data:dtPag,parcela:null,dividaId:dv.id});
      dv.pagos.push(mes); return d;
    });
    setPagando(null);setSelConta("");
  }
  function desfazerDivida(dvId){
    mutate(d=>{const dv=d.dividas.find(x=>x.id===dvId);
      if(dv)dv.pagos=dv.pagos.filter(k=>k!==mes);
      const mm=ensureMonth(d,mes);
      mm.gastos=mm.gastos.filter(g=>g.dividaId!==dvId);
      return d;});
  }

  const SeletorPagto=({onConfirm,pedirForma=true})=>(
    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginTop:8}}>
      <select className="fi" value={selConta} onChange={e=>setSelConta(e.target.value)} style={{flex:1,minWidth:130,fontSize:12,padding:"9px 10px"}}>
        <option value="">— Conta que pagou —</option>
        {contas.map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}
      </select>
      {pedirForma&&<select className="fi" value={selForma} onChange={e=>setSelForma(e.target.value)} style={{flex:"0 0 100px",fontSize:12,padding:"9px 10px"}}>
        {FORMAS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
      </select>}
      <button className="btn-green" onClick={onConfirm} disabled={!selConta}>Confirmar</button>
      <button className="btn-ghost" onClick={()=>{setPagando(null);setSelConta("");}}>✕</button>
    </div>
  );

  return (
    <div className="pg">
      <div className="st">📅 A pagar — {labelKey(mes)}</div>
      {totalPend>0&&(
        <div className="card" style={{background:"rgba(239,68,68,.06)",borderColor:"rgba(239,68,68,.2)"}}>
          <div className="st">Total pendente no mês</div>
          <div style={{fontSize:24,fontWeight:800,color:"var(--red)"}}>{fmt(totalPend)}</div>
        </div>
      )}

      {faturas.length>0&&<div className="sep">Faturas de cartão</div>}
      {faturas.map(({acc,valor,paga})=>(
        <div key={acc.id} className="card">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:7,fontSize:13,fontWeight:700}}>
                <span style={{width:9,height:9,borderRadius:"50%",background:acc.cor}}/>Fatura {acc.nome}
              </div>
              <div style={{fontSize:10,color:paga?"var(--green)":"var(--muted)",marginTop:3}}>
                {paga?`✓ Paga em ${dmy(paga.data)} via ${(contaById(data,paga.contaId)||{}).nome||"—"}`:`Vence dia ${acc.vencimento} · fecha dia ${acc.fechamento}`}
              </div>
            </div>
            <div style={{fontSize:16,fontWeight:800,color:paga?"var(--green)":"var(--red)"}}>{fmt(valor)}</div>
          </div>
          {paga
            ?<button className="btn-ghost" style={{marginTop:8,width:"100%"}} onClick={()=>desfazerFatura(acc.id)}>Desmarcar pagamento</button>
            :pagando?.tipo==="fatura"&&pagando.id===acc.id
              ?<SeletorPagto pedirForma={false} onConfirm={()=>pagarFatura(acc.id)}/>
              :<button className="btn-green" style={{marginTop:8,width:"100%"}} onClick={()=>{setPagando({tipo:"fatura",id:acc.id});setSelConta("");}}>✓ Marcar fatura como paga</button>}
        </div>
      ))}

      <div className="sep" style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span>Despesas fixas</span>
        <button className="btn-mini" onClick={()=>setModal({type:"fixa"})}>+ Nova fixa</button>
      </div>
      {fixasPend.length===0&&fixasPagas.length===0&&<div className="empty">Nenhuma fixa cadastrada neste mês.</div>}
      {fixasPend.map(f=>(
        <div key={f.id} className="card" style={{padding:"11px 13px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:600}}>{f.nome}{f.recorrente&&<span style={{marginLeft:6,fontSize:9,color:"var(--accent)"}}>♻️</span>}{f.dia?<span style={{marginLeft:6,fontSize:9,color:"var(--muted)"}}>dia {f.dia}</span>:null}</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:13,fontWeight:700,color:"var(--red)"}}>{fmt(f.valor)}</span>
              <button className="tdel" onClick={()=>setModal({type:"fixa",edit:f})}>✏️</button>
              <button className="tdel" onClick={()=>mutate(d=>{const mm=ensureMonth(d,mes);mm.fixas=mm.fixas.filter(x=>x.id!==f.id);return d;})}>✕</button>
            </div>
          </div>
          {pagando?.tipo==="fixa"&&pagando.id===f.id
            ?<SeletorPagto onConfirm={()=>pagarFixa(f.id)}/>
            :<button className="btn-green" style={{marginTop:8,width:"100%"}} onClick={()=>{setPagando({tipo:"fixa",id:f.id});setSelConta("");}}>✓ Marcar como paga</button>}
        </div>
      ))}
      {fixasPagas.map(f=>(
        <div key={f.id} className="card" style={{padding:"11px 13px",opacity:.75}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:600,textDecoration:"line-through",color:"var(--muted)"}}>{f.nome}</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:13,fontWeight:700,color:"var(--green)"}}>{fmt(f.valor)}</span>
              <button className="btn-ghost" onClick={()=>desfazerFixa(f.id)} style={{fontSize:10,padding:"4px 8px"}}>desfazer</button>
            </div>
          </div>
        </div>
      ))}

      {dividasMes.length>0&&<div className="sep">Parcelas de dívidas</div>}
      {dividasMes.map(({dv,idx,paga})=>(
        <div key={dv.id} className="card" style={{padding:"11px 13px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,fontWeight:600,textDecoration:paga?"line-through":"none",color:paga?"var(--muted)":"var(--text)"}}>{dv.nome} ({idx+1}/{dv.parcelas})</div>
            <span style={{fontSize:13,fontWeight:700,color:paga?"var(--green)":"var(--red)"}}>{fmt(dv.valorParcela)}</span>
          </div>
          {paga
            ?<button className="btn-ghost" style={{marginTop:8,width:"100%"}} onClick={()=>desfazerDivida(dv.id)}>Desmarcar</button>
            :pagando?.tipo==="divida"&&pagando.id===dv.id
              ?<SeletorPagto onConfirm={()=>pagarDivida(dv.id)}/>
              :<button className="btn-green" style={{marginTop:8,width:"100%"}} onClick={()=>{setPagando({tipo:"divida",id:dv.id});setSelConta("");}}>✓ Marcar parcela como paga</button>}
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════ Página: Cartões ════════════════════════════ */
function PageCartoes({data,mutate,mes,setModal}){
  const cards=data.accounts.filter(a=>a.temCartao);
  const [sel,setSel]=useState(cards[0]?.id||"");
  useEffect(()=>{ if(!cards.find(c=>c.id===sel)&&cards[0]) setSel(cards[0].id); },[cards.length]);
  const acc=cards.find(c=>c.id===sel);
  if(!acc) return <div className="pg"><div className="empty">Nenhum cartão configurado.<br/>Vá em <strong style={{color:"var(--accent)"}}>⚙️ Config</strong> e ative o cartão em uma conta.</div></div>;

  const compras=gastosCartao(data,mes,acc.id);
  const total=compras.reduce((s,g)=>s+g.valor,0);
  const paga=(data.months[mes]?.faturasPagas||{})[acc.id]||null;
  const pct=acc.limite>0?Math.min((total/acc.limite)*100,100):0;
  const proxima=faturaDe(data,shiftKey(mes,1),acc.id);
  const catBreak=Object.entries(compras.reduce((o,g)=>{o[g.catId]=(o[g.catId]||0)+g.valor;return o;},{}))
    .map(([id,v])=>({cat:catById(data,id),v})).sort((a,b)=>b.v-a.v);

  function delCompra(id){ mutate(d=>{const mm=ensureMonth(d,mes);mm.gastos=mm.gastos.filter(g=>g.id!==id);return d;}); }

  return (
    <div className="pg">
      <div className="st">💳 Cartões — fatura de {labelKey(mes)}</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {cards.map(c=>{
          const t=faturaDe(data,mes,c.id);
          return (
            <button key={c.id} onClick={()=>setSel(c.id)}
              style={{padding:"7px 14px",borderRadius:20,border:`2px solid ${sel===c.id?c.cor:"var(--border)"}`,
              background:sel===c.id?c.cor+"22":"var(--surface)",color:sel===c.id?c.cor:"var(--muted)",
              fontFamily:"inherit",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              {c.nome}{t>0&&<span style={{marginLeft:5,fontSize:9,background:c.cor,color:"#fff",padding:"1px 5px",borderRadius:10}}>{fmt(t)}</span>}
            </button>
          );
        })}
      </div>

      <div className="card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{width:12,height:12,borderRadius:"50%",background:acc.cor}}/>
              <span style={{fontSize:14,fontWeight:700}}>{acc.nome}</span>
            </div>
            <div style={{fontSize:11,color:paga?"var(--green)":"var(--muted)"}}>
              {paga?`✓ Fatura paga em ${dmy(paga.data)}`:`Fecha dia ${acc.fechamento} · vence dia ${acc.vencimento}`}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:20,fontWeight:800,color:paga?"var(--green)":"var(--red)"}}>{fmt(total)}</div>
            {acc.limite>0&&<div style={{fontSize:10,color:"var(--muted)"}}>de {fmt(acc.limite)} de limite</div>}
          </div>
        </div>
        {acc.limite>0&&<>
          <div style={{height:8,background:"var(--border)",borderRadius:4,overflow:"hidden",marginBottom:6}}>
            <div style={{height:"100%",width:`${pct}%`,borderRadius:4,background:pct>90?"var(--red)":pct>70?"var(--gold)":acc.cor}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11}}>
            <span style={{color:pct>90?"var(--red)":pct>70?"var(--gold)":"var(--muted)"}}>{pct.toFixed(0)}% usado</span>
            <span style={{color:"var(--green)",fontWeight:600}}>{fmt(Math.max(acc.limite-total,0))} disponível</span>
          </div>
        </>}
        {proxima>0&&<div style={{marginTop:10,fontSize:11,color:"var(--muted)"}}>Próxima fatura ({labelKey(shiftKey(mes,1))}): <strong style={{color:"var(--text)"}}>{fmt(proxima)}</strong> já comprometidos</div>}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <button className="btn-accent" onClick={()=>setModal({type:"credito",cardId:acc.id})}>+ Lançar compra</button>
        <button className="bulkbtn" style={{color:"var(--accent)",borderColor:"rgba(99,102,241,.3)"}} onClick={()=>setModal({type:"import",destino:"credito",cardId:acc.id})}>📂 Importar fatura</button>
      </div>

      {catBreak.length>0&&(
        <div className="card">
          <div className="st" style={{marginBottom:10}}>Por categoria</div>
          <div style={{marginBottom:14}}>
            <Donut size={126} thick={21} data={catBreak.map(c=>({color:c.cat.cor,value:c.v}))} label={fmt(total)} sublabel={acc.nome}/>
          </div>
          {catBreak.map(c=>(
            <div key={c.cat.id} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                <span style={{fontSize:11}}>{c.cat.icon} {c.cat.nome}</span>
                <span style={{fontSize:11,fontWeight:600,color:"var(--red)"}}>{fmt(c.v)}</span>
              </div>
              <div style={{height:5,background:"var(--border)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${total>0?(c.v/total)*100:0}%`,background:c.cat.cor,borderRadius:3}}/>
              </div>
            </div>
          ))}
        </div>
      )}

      {compras.length>0?(
        <div className="txlist">
          {compras.slice().sort((a,b)=>(b.data||"").localeCompare(a.data||"")).map(g=>{
            const cat=catById(data,g.catId);
            return (
              <div key={g.id} className="txi" onClick={()=>setModal({type:"credito",edit:g})}>
                <div className="txicon" style={{background:cat.cor+"30"}}>{cat.icon}</div>
                <div className="txinfo">
                  <div className="txd">{g.descricao}</div>
                  <div className="txm"><span>{dmy(g.data)}</span><span>{cat.nome}</span>{g.parcela&&<span>parcela {g.parcela.i}/{g.parcela.n}</span>}</div>
                </div>
                <div className="txa" style={{color:"var(--red)"}}>-{fmt(g.valor)}</div>
                <button className="tdel" onClick={ev=>{ev.stopPropagation();delCompra(g.id);}}>✕</button>
              </div>
            );
          })}
        </div>
      ):<div className="empty">Nenhum lançamento na fatura de {labelKey(mes)}.<br/>Compras após o fechamento (dia {acc.fechamento}) caem automaticamente na fatura seguinte.</div>}
    </div>
  );
}

/* ════════════════════════════ Página: Carteira ════════════════════════════ */
function PageCarteira({data,mutate,totalContas}){
  const [editando,setEditando]=useState(null);
  const [valor,setValor]=useState("");
  function salvar(accId){
    const v=parseVal(valor);
    mutate(d=>{const a=d.accounts.find(x=>x.id===accId);if(a){a.saldoInicial=v;a.ancoraData=hoje();}return d;});
    setEditando(null);setValor("");
  }
  return (
    <div className="pg">
      <div className="card" style={{background:"linear-gradient(135deg,rgba(99,102,241,.15),rgba(139,92,246,.06))",borderColor:"rgba(99,102,241,.25)"}}>
        <div className="st">💼 Total nas contas</div>
        <div style={{fontSize:26,fontWeight:800,color:totalContas>=0?"var(--green)":"var(--red)"}}>{fmt(totalContas)}</div>
        <div style={{fontSize:10,color:"var(--muted)",marginTop:4}}>Sempre derivado: saldo definido + todas as movimentações desde então</div>
      </div>
      <div className="st">Saldo por conta</div>
      {data.accounts.map(a=>{
        const s=saldoConta(data,a.id);
        const isEd=editando===a.id;
        return (
          <div key={a.id} className="card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:700}}>
                <span style={{width:10,height:10,borderRadius:"50%",background:a.cor}}/>{a.nome}
              </div>
              <div style={{fontSize:17,fontWeight:800,color:s>=0?"var(--green)":"var(--red)"}}>{fmt(s)}</div>
            </div>
            <div style={{fontSize:10,color:"var(--muted)",marginBottom:8,lineHeight:1.5}}>
              {a.ancoraData
                ?<>Saldo definido em {dmy(a.ancoraData)}: {fmt(a.saldoInicial||0)} + movimentações desde então</>
                :<>⚠ Saldo ainda não definido. Digite o saldo real de hoje para ancorar.</>}
            </div>
            {isEd
              ?<div style={{display:"flex",gap:6}}>
                <input className="fi" inputMode="decimal" placeholder="Ex: 1.234,56" value={valor} onChange={e=>setValor(e.target.value)} autoFocus style={{flex:1}}/>
                <button className="btn-green" onClick={()=>salvar(a.id)}>Salvar</button>
                <button className="btn-ghost" onClick={()=>{setEditando(null);setValor("");}}>✕</button>
              </div>
              :<button className="btn-ghost" style={{width:"100%",color:a.ancoraData?"var(--accent)":"var(--green)",borderColor:a.ancoraData?"rgba(99,102,241,.3)":"rgba(34,197,94,.3)"}}
                onClick={()=>{setEditando(a.id);setValor(String(a.saldoInicial||""));}}>
                {a.ancoraData?"🔧 Ajustar saldo (digitar o real de hoje)":"➕ Definir saldo atual"}
              </button>}
          </div>
        );
      })}
      <div className="hint">
        <strong style={{color:"var(--accent)"}}>Como funciona:</strong> definir o saldo cria uma âncora na data de hoje. Lançamentos anteriores à âncora ficam no histórico para análise mas não mexem no saldo; tudo dali em diante atualiza automaticamente. Se divergir do banco real, é sinal de lançamento faltando — ou é só redefinir a âncora.
      </div>
    </div>
  );
}

/* ════════════════════════════ Página: Reservas ════════════════════════════ */
function PageReservas({data,mutate,mes,rt,setModal}){
  const m=data.months[mes]||novoMes();
  const [corrigindo,setCorrigindo]=useState(null); /* "emergencia"|"pessoal" */
  const [valor,setValor]=useState("");
  function corrigir(tipo){
    const v=parseVal(valor);
    mutate(d=>{d.settings.reservaAncora[tipo]={valor:v,data:hoje()};return d;});
    setCorrigindo(null);setValor("");
  }
  function del(id){
    mutate(d=>{const mm=ensureMonth(d,mes);mm.reservas=mm.reservas.filter(r=>r.id!==id);return d;});
  }
  return (
    <div className="pg">
      <div className="st">💰 Reservas & investimentos</div>
      <div className="card">
        <GoalBar label="Reserva de emergência" icon="🛡️" current={rt.emergencia} goal={data.settings.emergencyGoal} color="var(--green)"/>
        <GoalBar label={data.settings.personalGoalName} icon="🎯" current={rt.pessoal} goal={data.settings.personalGoalValue} color="var(--accent)"/>
        <div style={{display:"flex",gap:6,marginTop:4}}>
          {[["emergencia","Corrigir reserva"],["pessoal","Corrigir meta"]].map(([t,l])=>(
            <button key={t} className="btn-ghost" style={{flex:1,fontSize:10}} onClick={()=>{setCorrigindo(t);setValor("");}}>🔧 {l}</button>
          ))}
        </div>
        {corrigindo&&(
          <div style={{marginTop:10,background:"rgba(99,102,241,.07)",border:"1px solid rgba(99,102,241,.2)",borderRadius:10,padding:12}}>
            <div style={{fontSize:11,color:"var(--muted)",marginBottom:8}}>Digite o saldo real que você tem hoje em <strong>{corrigindo==="emergencia"?"reserva de emergência":data.settings.personalGoalName}</strong>. Vira a nova âncora; aportes futuros somam em cima.</div>
            <div style={{display:"flex",gap:6}}>
              <input className="fi" inputMode="decimal" placeholder="Ex: 2.500,00" value={valor} onChange={e=>setValor(e.target.value)} autoFocus style={{flex:1}}/>
              <button className="btn-green" onClick={()=>corrigir(corrigindo)}>Definir</button>
              <button className="btn-ghost" onClick={()=>setCorrigindo(null)}>✕</button>
            </div>
          </div>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <button className="btn-accent" onClick={()=>setModal({type:"reserva"})}>+ Aporte</button>
        <button className="btn-ghost" style={{color:"var(--gold)",borderColor:"rgba(245,158,11,.3)"}} onClick={()=>setModal({type:"reserva",retirada:true})}>📤 Retirada</button>
      </div>
      {(m.reservas||[]).length===0?<div className="empty">Nenhum lançamento em {labelKey(mes)}.</div>
        :<div className="txlist">
          {(m.reservas||[]).map(r=>{
            const acc=contaById(data,r.accId);
            return (
              <div key={r.id} className="txi" style={{cursor:"default"}}>
                <div className="txicon" style={{background:r.retirada?"rgba(239,68,68,.15)":"rgba(245,158,11,.15)"}}>{r.retirada?"📤":"💰"}</div>
                <div className="txinfo">
                  <div className="txd">{r.nome||({emergencia:"Reserva de emergência",pessoal:data.settings.personalGoalName,outro:"Investimento"})[r.tipo]}</div>
                  <div className="txm"><span>{dmy(r.data)}</span><span>{({emergencia:"🛡️ Emergência",pessoal:"🎯 Meta",outro:"Outro"})[r.tipo]}</span>{acc&&<span className="chip" style={{background:acc.cor+"30",color:acc.cor}}>{acc.nome}</span>}</div>
                </div>
                <div className="txa" style={{color:r.retirada?"var(--red)":"var(--gold)"}}>{r.retirada?"-":"+"}{fmt(r.valor)}</div>
                <button className="tdel" onClick={()=>del(r.id)}>✕</button>
              </div>
            );
          })}
        </div>}
      <div className="hint">Aporte sai do saldo da conta escolhida; retirada volta para ela. Sem lançamentos duplicados — o saldo da Carteira e o total da reserva são derivados do mesmo registro.</div>
    </div>
  );
}

/* ════════════════════════════ Página: Dívidas ════════════════════════════ */
function PageDividas({data,mutate,mes}){
  const [showForm,setShowForm]=useState(false);
  const [f,setF]=useState({nome:"",total:"",parcelas:"",inicio:mes,catId:""});
  const ativas=data.dividas.filter(d=>!d.quitada);
  const quitadas=data.dividas.filter(d=>d.quitada);
  const tv=parseVal(f.total), np=parseInt(f.parcelas)||0, vp=np>0?r2(tv/np):0;

  function add(){
    if(!f.nome||!tv||!np) return;
    mutate(d=>{d.dividas.push({id:uid(),nome:f.nome,catId:f.catId||d.cats[d.cats.length-1].id,
      total:tv,parcelas:np,valorParcela:vp,inicioMes:f.inicio,pagos:[],quitada:false});return d;});
    setF({nome:"",total:"",parcelas:"",inicio:mes,catId:""});setShowForm(false);
  }
  return (
    <div className="pg">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div className="st">🔗 Dívidas & parcelamentos</div>
        <button className="btn-mini" onClick={()=>setShowForm(s=>!s)}>{showForm?"Cancelar":"+ Nova"}</button>
      </div>
      {showForm&&(
        <div className="card">
          <div className="fg"><label className="fl">Nome</label><input className="fi" placeholder="Ex: Carro, Funileiro…" value={f.nome} onChange={e=>setF(p=>({...p,nome:e.target.value}))}/></div>
          <div className="fg"><label className="fl">Categoria</label>
            <select className="fi" value={f.catId} onChange={e=>setF(p=>({...p,catId:e.target.value}))}>
              <option value="">— Selecione —</option>
              {data.cats.map(c=><option key={c.id} value={c.id}>{c.icon} {c.nome}</option>)}
            </select></div>
          <div className="frow">
            <div className="fg"><label className="fl">Valor total (R$)</label><input className="fi" inputMode="decimal" value={f.total} onChange={e=>setF(p=>({...p,total:e.target.value}))}/></div>
            <div className="fg"><label className="fl">Parcelas</label><input className="fi" type="number" inputMode="numeric" value={f.parcelas} onChange={e=>setF(p=>({...p,parcelas:e.target.value}))}/></div>
          </div>
          {vp>0&&<div className="hint" style={{marginBottom:10}}>Parcela mensal: <strong style={{color:"var(--accent)"}}>{fmt(vp)}</strong></div>}
          <div className="fg"><label className="fl">Mês da 1ª parcela</label><input className="fi" type="month" value={f.inicio} onChange={e=>setF(p=>({...p,inicio:e.target.value}))}/></div>
          <button className="savebtn" onClick={add} disabled={!f.nome||!tv||!np}>Adicionar dívida</button>
        </div>
      )}
      {ativas.length===0&&!showForm&&<div className="empty">Nenhuma dívida ativa. 🎉</div>}
      {ativas.map(dv=>{
        const pagas=dv.pagos.length;
        const pct=Math.min((pagas/dv.parcelas)*100,100);
        const restante=r2(dv.total-pagas*dv.valorParcela);
        const idx=idxParcela(dv,mes);
        const vigente=idx>=0&&idx<dv.parcelas;
        const pagaMes=dv.pagos.includes(mes);
        return (
          <div key={dv.id} className="card">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div>
                <div style={{fontSize:13,fontWeight:700}}>{dv.nome}</div>
                <div style={{fontSize:10,color:"var(--muted)",marginTop:2}}>{dv.parcelas}x de {fmt(dv.valorParcela)} · Total {fmt(dv.total)} · início {labelKey(dv.inicioMes)}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--red)"}}>{fmt(Math.max(restante,0))}</div>
                <div style={{fontSize:9,color:"var(--muted)"}}>restando</div>
              </div>
            </div>
            <div style={{height:6,background:"var(--border)",borderRadius:3,overflow:"hidden",marginBottom:4}}>
              <div style={{height:"100%",width:`${pct}%`,background:"var(--green)",borderRadius:3}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--muted)",marginBottom:8}}>
              <span>{pagas}/{dv.parcelas} pagas ({pct.toFixed(0)}%)</span>
              {vigente&&<span style={{color:pagaMes?"var(--green)":"var(--gold)",fontWeight:700}}>{pagaMes?"✓ Paga este mês":"⚡ Vence este mês — marque em A pagar"}</span>}
            </div>
            <div style={{display:"flex",gap:7}}>
              <button className="btn-ghost" style={{flex:1,color:"var(--green)",borderColor:"rgba(34,197,94,.3)"}}
                onClick={()=>mutate(d=>{const x=d.dividas.find(y=>y.id===dv.id);if(x)x.quitada=true;return d;})}>✓ Quitar tudo</button>
              <button className="btn-ghost" style={{color:"var(--red)",borderColor:"rgba(239,68,68,.3)"}}
                onClick={()=>{if(confirm("Apagar esta dívida? (os pagamentos já lançados no extrato permanecem)"))mutate(d=>{d.dividas=d.dividas.filter(y=>y.id!==dv.id);return d;});}}>Apagar</button>
            </div>
          </div>
        );
      })}
      {quitadas.map(dv=>(
        <div key={dv.id} className="card" style={{opacity:.6,padding:"10px 13px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:12,fontWeight:600,textDecoration:"line-through",color:"var(--muted)"}}>{dv.nome}</div>
            <div style={{fontSize:10,color:"var(--muted)"}}>{dv.parcelas}x de {fmt(dv.valorParcela)}</div>
          </div>
          <button className="tdel" onClick={()=>mutate(d=>{d.dividas=d.dividas.filter(y=>y.id!==dv.id);return d;})}>✕</button>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════ Página: Planejar ════════════════════════════ */
function PagePlanejar({data,mes,rt}){
  const [tab,setTab]=useState("sim");
  const [simV,setSimV]=useState(""); const [simP,setSimP]=useState("10");
  const tv=parseVal(simV), np=parseInt(simP)||1, vp=np>0?tv/np:0;

  /* médias dos últimos meses com dado */
  let inc=0,out=0,n=0;
  for(let i=1;i<=6;i++){ const k=shiftKey(mes,-i); if(!data.months[k]) continue;
    const mm=metricsMes(data,k); if(mm.entradas>0||mm.saidas>0){inc+=mm.entradas;out+=mm.saidas;n++;} }
  const metAtual=metricsMes(data,mes);
  if(n===0){inc=metAtual.entradas;out=metAtual.saidas;n=metAtual.entradas>0?1:0;}
  const rendaM=n>0?inc/n:0, saidaM=n>0?out/n:0, folga=rendaM-saidaM;

  let verdict=null;
  if(tv>0&&vp>0){
    const nova=folga-vp;
    if(nova>=vp*0.5) verdict={cor:"var(--green)",bg:"rgba(34,197,94,.08)",bd:"rgba(34,197,94,.3)",t:"💚 Pode parcelar tranquilo",s:`Sobra mensal estimada após a parcela: ${fmt(nova)}`};
    else if(nova>=0) verdict={cor:"var(--gold)",bg:"rgba(245,158,11,.08)",bd:"rgba(245,158,11,.3)",t:"⚠️ Vai apertar",s:`Sobra cai para ${fmt(nova)} — pouca folga para imprevistos`};
    else verdict={cor:"var(--red)",bg:"rgba(239,68,68,.08)",bd:"rgba(239,68,68,.3)",t:"🔴 Não recomendado",s:`Você ficaria ${fmt(Math.abs(nova))} no negativo todo mês`};
  }
  const aVistaDepois=rt.emergencia-tv;
  const aVistaOk=aVistaDepois>=(data.settings.emergencyGoal||0)*0.3;

  /* análise de categorias: mês atual vs média 3 meses */
  const atual=gastosPorCat(data,mes);
  const past={}; let pn=0;
  for(let i=1;i<=3;i++){ const k=shiftKey(mes,-i); if(!data.months[k]) continue; pn++;
    Object.entries(gastosPorCat(data,k)).forEach(([c,v])=>{past[c]=(past[c]||0)+v;}); }
  const catAvg=Object.entries(past).map(([id,t])=>({id,cat:catById(data,id),avg:t/Math.max(pn,1),cur:atual[id]||0}))
    .sort((a,b)=>b.avg-a.avg);

  return (
    <div className="pg">
      <div className="st">🎯 Planejar</div>
      <div style={{display:"flex",gap:6}}>
        <button className={`tab${tab==="sim"?" on":""}`} onClick={()=>setTab("sim")}>💳 Simulador</button>
        <button className={`tab${tab==="ana"?" on":""}`} onClick={()=>setTab("ana")}>📊 Análise</button>
      </div>

      {tab==="sim"&&<>
        <div className="card">
          <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>Posso parcelar essa compra?</div>
          <div className="frow">
            <div className="fg"><label className="fl">Valor total (R$)</label><input className="fi" inputMode="decimal" placeholder="Ex: 3.000,00" value={simV} onChange={e=>setSimV(e.target.value)}/></div>
            <div className="fg"><label className="fl">Parcelas</label><input className="fi" inputMode="numeric" placeholder="Ex: 10" value={simP} onChange={e=>setSimP(e.target.value)}/></div>
          </div>
          {tv>0&&<div className="hint">Parcela mensal: <strong style={{color:"var(--accent)"}}>{fmt(vp)}</strong> · {np}x até {labelKey(shiftKey(mes,np-1))}</div>}
        </div>
        {verdict&&(
          <div className="card" style={{background:verdict.bg,borderColor:verdict.bd}}>
            <div style={{fontSize:14,fontWeight:800,color:verdict.cor,marginBottom:6}}>{verdict.t}</div>
            <div style={{fontSize:12,lineHeight:1.6}}>{verdict.s}</div>
          </div>
        )}
        {tv>0&&(
          <div className="card">
            <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>Parcelar × à vista</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:9,padding:10}}>
                <div style={{fontSize:10,color:"var(--muted)",fontWeight:700,marginBottom:4}}>💳 PARCELAR</div>
                <div style={{fontSize:11,marginBottom:3}}>Saída/mês: <strong style={{color:"var(--red)"}}>{fmt(vp)}</strong></div>
                <div style={{fontSize:11}}>Reserva mantida: <strong style={{color:"var(--green)"}}>{fmt(rt.emergencia)}</strong></div>
              </div>
              <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:9,padding:10}}>
                <div style={{fontSize:10,color:"var(--muted)",fontWeight:700,marginBottom:4}}>💰 À VISTA</div>
                <div style={{fontSize:11,marginBottom:3}}>Reserva após: <strong style={{color:aVistaDepois<0?"var(--red)":aVistaOk?"var(--green)":"var(--gold)"}}>{fmt(aVistaDepois)}</strong></div>
                <div style={{fontSize:10,color:aVistaOk?"var(--green)":"var(--gold)"}}>{aVistaOk?"✓ Mantém saúde da reserva":"⚠ Impacta a reserva"}</div>
              </div>
            </div>
          </div>
        )}
        <div className="card">
          <div className="st" style={{marginBottom:10}}>Seu panorama (média dos últimos meses)</div>
          {[["Renda média mensal",fmt(rendaM),"var(--green)"],["Saídas médias mensais",fmt(saidaM),"var(--red)"],["Folga mensal média",fmt(folga),folga>=0?"var(--green)":"var(--red)"],["🛡️ Reserva atual",fmt(rt.emergencia),"var(--accent)"]].map(([l,v,c])=>(
            <div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
              <span style={{color:"var(--muted)"}}>{l}</span><span style={{fontWeight:700,color:c}}>{v}</span>
            </div>
          ))}
        </div>
      </>}

      {tab==="ana"&&(pn<1
        ?<div className="empty">Precisa de pelo menos 1 mês anterior com dados para comparar.</div>
        :<div className="card">
          <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>Categorias: este mês × média</div>
          {catAvg.slice(0,10).map(c=>{
            const diff=c.cur-c.avg, pctD=c.avg>0?(diff/c.avg)*100:0;
            const over=c.cur>c.avg*1.15, under=c.cur<c.avg*0.85&&c.cur>0;
            return (
              <div key={c.id} style={{marginBottom:10,paddingBottom:10,borderBottom:"1px solid var(--border)"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:12,fontWeight:600}}>{c.cat.icon} {c.cat.nome}</span>
                  <span style={{fontSize:11,fontWeight:700,color:"var(--red)"}}>{fmt(c.avg)}/mês</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--muted)"}}>
                  <span>Este mês: <strong style={{color:over?"var(--red)":under?"var(--green)":"var(--text2)"}}>{fmt(c.cur)}</strong></span>
                  <span style={{color:over?"var(--red)":under?"var(--green)":"var(--muted)"}}>{c.cur>0?(diff>=0?"+":"")+pctD.toFixed(0)+"% vs média":"—"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════ Página: Anual ════════════════════════════ */
function PageAnual({data,mes}){
  const ano=mes.split("-")[0];
  const rows=Array.from({length:12},(_,i)=>{const k=`${ano}-${String(i+1).padStart(2,"0")}`;return {k,i,...metricsMes(data,k)};});
  const tInc=rows.reduce((s,r)=>s+r.entradas,0), tOut=rows.reduce((s,r)=>s+r.saidas,0);
  const chartMax=Math.max(...rows.flatMap(r=>[r.entradas,r.saidas]),1);
  return (
    <div className="pg">
      <div className="st">📈 Visão anual — {ano}</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
        {[["Entradas",fmt(tInc),"var(--green)"],["Saídas",fmt(tOut),"var(--red)"],["Sobrou",fmt(tInc-tOut),tInc-tOut>=0?"var(--accent)":"var(--red)"]].map(([l,v,c])=>(
          <div key={l} className="card" style={{padding:11}}><div className="st">{l}</div><div style={{fontSize:13,fontWeight:800,color:c}}>{v}</div></div>
        ))}
      </div>
      <div className="card">
        <div className="chart" style={{height:90}}>
          {rows.map(r=>(
            <div key={r.k} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
              <div className="cgrp">
                <div className="cbar" style={{background:r.k===mes?"var(--green)":"rgba(34,197,94,.3)",height:`${Math.max((r.entradas/chartMax)*90,r.entradas>0?2:0)}px`}}/>
                <div className="cbar" style={{background:r.k===mes?"var(--red)":"rgba(239,68,68,.3)",height:`${Math.max((r.saidas/chartMax)*90,r.saidas>0?2:0)}px`}}/>
              </div>
              <div className="clbl">{MESES_C[r.i]}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{overflowX:"auto"}}>
        <table className="atable">
          <thead><tr><th>Mês</th><th>Entradas</th><th>Débito/PIX</th><th>Faturas</th><th>Reservas</th><th>Sobrou</th></tr></thead>
          <tbody>{rows.map(r=>(
            <tr key={r.k} className={r.k===mes?"cur":""}>
              <td>{MESES_C[r.i]}</td>
              <td style={{color:"var(--green)"}}>{r.entradas>0?fmt(r.entradas):"—"}</td>
              <td style={{color:"var(--red)"}}>{r.gastosDeb>0?fmt(r.gastosDeb):"—"}</td>
              <td style={{color:"var(--blue)"}}>{r.faturasPagas>0?fmt(r.faturasPagas):"—"}</td>
              <td style={{color:"var(--gold)"}}>{r.aportes>0?fmt(r.aportes):"—"}</td>
              <td style={{color:r.sobra>=0?(r.entradas>0?"var(--green)":"var(--muted)"):"var(--red)"}}>{r.entradas>0||r.saidas>0?fmt(r.sobra):"—"}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td>Total</td>
            <td style={{color:"var(--green)"}}>{fmt(tInc)}</td>
            <td style={{color:"var(--red)"}}>{fmt(rows.reduce((s,r)=>s+r.gastosDeb,0))}</td>
            <td style={{color:"var(--blue)"}}>{fmt(rows.reduce((s,r)=>s+r.faturasPagas,0))}</td>
            <td style={{color:"var(--gold)"}}>{fmt(rows.reduce((s,r)=>s+r.aportes,0))}</td>
            <td style={{color:tInc>=tOut?"var(--green)":"var(--red)"}}>{fmt(tInc-tOut)}</td>
          </tr></tfoot>
        </table>
      </div>
      <div className="hint">💡 "Sobrou" = fluxo do mês (entradas − saídas). O saldo real de cada banco fica na aba 💼 Carteira. Fatura conta como saída no mês em que foi PAGA.</div>
    </div>
  );
}

/* ════════════════════════════ Página: Config ════════════════════════════ */
function PageConfig({data,mutate,userEmail,setToast}){
  const [novaCat,setNovaCat]=useState({nome:"",icon:"📌",cor:"#64748b"});
  const [showCat,setShowCat]=useState(false);
  const [remigrando,setRemigrando]=useState(false);
  return (
    <div className="pg">
      <div className="st">Conta</div>
      <div className="card">
        <div style={{fontSize:11,color:"var(--muted)"}}>Logado como</div>
        <div style={{fontSize:13,fontWeight:600,marginTop:4}}>{userEmail}</div>
        <div className="fg" style={{marginTop:12}}><label className="fl">Como quer ser chamado</label>
          <input className="fi" value={data.settings.name} onChange={e=>{const v=e.target.value;mutate(d=>{d.settings.name=v;return d;});}}/></div>
        <button className="btn-ghost" style={{color:"var(--red)",borderColor:"rgba(239,68,68,.3)"}} onClick={()=>supabase.auth.signOut()}>Sair da conta</button>
      </div>

      <div className="st">Metas de reserva</div>
      <div className="card">
        <div className="frow">
          <div className="fg"><label className="fl">🛡️ Meta da emergência (R$)</label>
            <input className="fi" inputMode="decimal" value={data.settings.emergencyGoal||""} onChange={e=>{const v=parseVal(e.target.value);mutate(d=>{d.settings.emergencyGoal=v;return d;});}}/></div>
          <div className="fg"><label className="fl">🎯 Meta pessoal (R$)</label>
            <input className="fi" inputMode="decimal" value={data.settings.personalGoalValue||""} onChange={e=>{const v=parseVal(e.target.value);mutate(d=>{d.settings.personalGoalValue=v;return d;});}}/></div>
        </div>
        <div className="fg"><label className="fl">Nome da meta pessoal</label>
          <input className="fi" value={data.settings.personalGoalName} onChange={e=>{const v=e.target.value;mutate(d=>{d.settings.personalGoalName=v;return d;});}}/></div>
        <div className="hint">Para corrigir o saldo atual das reservas, use o botão 🔧 na aba 💰 Reservas.</div>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div className="st">Contas & cartões</div>
        <button className="btn-mini" onClick={()=>mutate(d=>{d.accounts.push({id:uid(),nome:"Nova conta",cor:"#64748b",saldoInicial:0,ancoraData:null,temCartao:false,limite:0,fechamento:1,vencimento:8});return d;})}>+ Adicionar</button>
      </div>
      <div className="card">
        {data.accounts.map(a=>(
          <div key={a.id} style={{marginBottom:16,paddingBottom:16,borderBottom:"1px solid var(--border)"}}>
            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
              {CORES.map(c=>(
                <button key={c} onClick={()=>mutate(d=>{const x=d.accounts.find(y=>y.id===a.id);if(x)x.cor=c;return d;})}
                  style={{width:17,height:17,borderRadius:"50%",background:c,border:"none",cursor:"pointer",outline:a.cor===c?"2px solid var(--text)":"none",outlineOffset:1}}/>
              ))}
              <button className="btn-mini" style={{marginLeft:"auto",background:"none",border:"1px solid var(--red)",color:"var(--red)"}}
                onClick={()=>{if(confirm(`Apagar a conta ${a.nome}? Os lançamentos antigos ficam sem conta vinculada.`))mutate(d=>{d.accounts=d.accounts.filter(y=>y.id!==a.id);return d;});}}>Apagar</button>
            </div>
            <div className="frow">
              <div className="fg" style={{margin:0}}><label className="fl">Nome</label>
                <input className="fi" value={a.nome} onChange={e=>{const v=e.target.value;mutate(d=>{const x=d.accounts.find(y=>y.id===a.id);if(x)x.nome=v;return d;});}}/></div>
              <div className="fg" style={{margin:0}}>
                <label className="fl">Tem cartão de crédito?</label>
                <button className="fi" style={{textAlign:"left",cursor:"pointer",color:a.temCartao?"var(--green)":"var(--muted)"}}
                  onClick={()=>mutate(d=>{const x=d.accounts.find(y=>y.id===a.id);if(x)x.temCartao=!x.temCartao;return d;})}>
                  {a.temCartao?"✓ Sim":"✗ Não"}</button>
              </div>
            </div>
            {a.temCartao&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginTop:10}}>
                <div className="fg" style={{margin:0}}><label className="fl">Limite (R$)</label>
                  <input className="fi" inputMode="decimal" placeholder="0 = sem" value={a.limite||""} onChange={e=>{const v=parseVal(e.target.value);mutate(d=>{const x=d.accounts.find(y=>y.id===a.id);if(x)x.limite=v;return d;});}}/></div>
                <div className="fg" style={{margin:0}}><label className="fl">Fecha dia</label>
                  <input className="fi" type="number" min="1" max="31" value={a.fechamento} onChange={e=>{const v=Math.min(31,Math.max(1,parseInt(e.target.value)||1));mutate(d=>{const x=d.accounts.find(y=>y.id===a.id);if(x)x.fechamento=v;return d;});}}/></div>
                <div className="fg" style={{margin:0}}><label className="fl">Vence dia</label>
                  <input className="fi" type="number" min="1" max="28" value={a.vencimento} onChange={e=>{const v=Math.min(28,Math.max(1,parseInt(e.target.value)||1));mutate(d=>{const x=d.accounts.find(y=>y.id===a.id);if(x)x.vencimento=v;return d;});}}/></div>
              </div>
            )}
          </div>
        ))}
        <div className="hint">Compra feita no dia do fechamento ou depois cai automaticamente na fatura do mês seguinte. Renomear uma conta não afeta o histórico (tudo é vinculado por ID).</div>
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div className="st">Categorias de gasto</div>
        <button className="btn-mini" onClick={()=>setShowCat(s=>!s)}>{showCat?"Cancelar":"+ Nova"}</button>
      </div>
      {showCat&&(
        <div className="card">
          <div className="frow">
            <div className="fg"><label className="fl">Nome</label><input className="fi" placeholder="Ex: Pet, Academia…" value={novaCat.nome} onChange={e=>setNovaCat(c=>({...c,nome:e.target.value}))}/></div>
            <div className="fg"><label className="fl">Ícone</label><select className="fi" value={novaCat.icon} onChange={e=>setNovaCat(c=>({...c,icon:e.target.value}))}>{ICONES.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
          </div>
          <div className="fg"><label className="fl">Cor</label>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {CORES.map(c=><button key={c} onClick={()=>setNovaCat(nc=>({...nc,cor:c}))} style={{width:20,height:20,borderRadius:"50%",background:c,border:"none",cursor:"pointer",outline:novaCat.cor===c?"2px solid var(--text)":"none",outlineOffset:1}}/>)}
            </div>
          </div>
          <button className="savebtn" disabled={!novaCat.nome.trim()}
            onClick={()=>{mutate(d=>{d.cats.push({id:uid(),...novaCat});return d;});setNovaCat({nome:"",icon:"📌",cor:"#64748b"});setShowCat(false);}}>Adicionar categoria</button>
        </div>
      )}
      <div className="card">
        {data.cats.map(c=>(
          <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
            <span style={{fontSize:18}}>{c.icon}</span>
            <div style={{flex:1,fontSize:12,fontWeight:500}}>{c.nome}</div>
            <span style={{width:12,height:12,borderRadius:"50%",background:c.cor}}/>
            <button className="tdel" onClick={()=>mutate(d=>{d.cats=d.cats.filter(x=>x.id!==c.id);return d;})}>✕</button>
          </div>
        ))}
      </div>

      <div className="st">Orçamento por categoria 🎯</div>
      <div className="card">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {data.cats.map(c=>(
            <div key={c.id} className="fg" style={{margin:0}}><label className="fl">{c.icon} {c.nome}</label>
              <input className="fi" inputMode="decimal" placeholder="sem limite" value={data.settings.catBudgets[c.id]||""}
                onChange={e=>{const v=parseVal(e.target.value);mutate(d=>{if(v>0)d.settings.catBudgets[c.id]=v;else delete d.settings.catBudgets[c.id];return d;});}}/></div>
          ))}
        </div>
      </div>

      <div className="st">Dados</div>
      <div className="card" style={{background:"rgba(99,102,241,.05)",borderColor:"rgba(99,102,241,.25)"}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--accent)",marginBottom:6}}>📦 Reimportar dados do FinTrack antigo</div>
        <div style={{fontSize:11,color:"var(--muted)",lineHeight:1.6,marginBottom:10}}>
          Lê de novo as chaves antigas (fintrack:*:v9) e SUBSTITUI todos os dados atuais pela conversão. Use só se a primeira migração deu problema.
        </div>
        <button className="btn-accent" disabled={remigrando} onClick={async()=>{
          if(!confirm("Substituir TODOS os dados atuais pela reimportação do app antigo?"))return;
          setRemigrando(true);
          const d=await migrarLegado();
          if(d){await dbSave(d);window.location.reload();}
          else{setToast("Nenhum dado antigo encontrado");setRemigrando(false);}
        }}>{remigrando?"⏳ Migrando…":"📦 Reimportar do app antigo"}</button>
      </div>
    </div>
  );
}

/* ════════════════════════════ Modais de lançamento ════════════════════════════ */
function ModalRouter({modal,setModal,data,mutate,mes,mem,setToast}){
  const close=()=>setModal(null);
  const t=modal.type;
  if(t==="entrada"||t==="gasto"||t==="fixa"||t==="reserva") return <Modal onClose={close} tall={t==="gasto"}><EntryModal type={t} modal={modal} data={data} mutate={mutate} mes={mes} mem={mem} onClose={close}/></Modal>;
  if(t==="credito") return <Modal onClose={close} tall><CreditoModal modal={modal} data={data} mutate={mutate} mes={mes} mem={mem} onClose={close}/></Modal>;
  if(t==="bulk") return <Modal onClose={close} tall><BulkPanel destino={modal.destino} data={data} mutate={mutate} mes={mes} mem={mem} onClose={close} setToast={setToast}/></Modal>;
  if(t==="import") return <Modal onClose={close} tall><ImportModal destino={modal.destino} cardId={modal.cardId} data={data} mutate={mutate} mes={mes} onClose={close} setToast={setToast}/></Modal>;
  return null;
}

function EntryModal({type,modal,data,mutate,mes,mem,onClose}){
  const edit=modal.edit||null;
  const dd=`${mes}-${String(new Date().getDate()).padStart(2,"0")}`;
  const [f,setF]=useState(()=>{
    if(edit) return {...edit,valor:String(edit.valor??"")};
    if(type==="entrada") return {fonte:"",valor:"",data:dd,accId:data.accounts[0]?.id||""};
    if(type==="gasto")   return {catId:data.cats[0]?.id||"",descricao:"",valor:"",data:dd,forma:"pix",accId:data.accounts[0]?.id||"",isTransfer:false,transferParaId:""};
    if(type==="fixa")    return {nome:"",valor:"",dia:"",catId:data.cats[data.cats.length-1]?.id||"",recorrente:true};
    if(type==="reserva") return {tipo:"emergencia",nome:"",valor:"",data:dd,accId:data.accounts[0]?.id||"",retirada:!!modal.retirada};
    return {};
  });
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  const titulos={entrada:"Entrada",gasto:"Gasto (Débito/PIX)",fixa:"Despesa fixa",reserva:f.retirada?"Retirada de reserva":"Aporte em reserva"};

  function save(){
    const valor=parseVal(f.valor);
    if(!valor&&type!=="fixa") return;
    mutate(d=>{
      const mm=ensureMonth(d,mes);
      if(type==="entrada"){
        const item={id:edit?edit.id:uid(),fonte:f.fonte||"Entrada",valor,data:f.data,accId:f.accId};
        if(edit){const i=mm.entradas.findIndex(x=>x.id===edit.id);if(i>=0)mm.entradas[i]=item;}
        else mm.entradas.unshift(item);
      }
      if(type==="gasto"){
        const item={id:edit?edit.id:uid(),catId:f.catId,descricao:f.descricao,valor,data:f.data,
          forma:f.forma,accId:f.accId,parcela:edit?.parcela||null,
          fixaId:edit?.fixaId,dividaId:edit?.dividaId,
          transferParaId:f.isTransfer&&f.transferParaId?f.transferParaId:undefined};
        if(edit){const i=mm.gastos.findIndex(x=>x.id===edit.id);if(i>=0)mm.gastos[i]=item;}
        else mm.gastos.unshift(item);
      }
      if(type==="fixa"){
        const item={id:edit?edit.id:uid(),nome:f.nome,valor,dia:f.dia?parseInt(f.dia):null,
          catId:f.catId,recorrente:f.recorrente!==false,pago:edit?.pago||false,gastoId:edit?.gastoId||null};
        if(edit){const i=mm.fixas.findIndex(x=>x.id===edit.id);if(i>=0)mm.fixas[i]=item;
          if(item.gastoId){const g=mm.gastos.find(x=>x.id===item.gastoId);if(g){g.descricao=item.nome;g.valor=valor;}}}
        else mm.fixas.push(item);
      }
      if(type==="reserva"){
        mm.reservas.unshift({id:uid(),tipo:f.tipo,nome:f.nome,valor,data:f.data,accId:f.accId,retirada:!!f.retirada});
      }
      return d;
    });
    onClose();
  }

  return (
    <>
      <MHdr title={`${edit?"Editar":"Nova"} — ${titulos[type]}`} onClose={onClose}/>
      {type==="entrada"&&<>
        <div className="fg"><label className="fl">Nome / fonte</label><input className="fi" placeholder="Ex: Salário, Freela…" value={f.fonte} onChange={e=>upd("fonte",e.target.value)} autoFocus/></div>
        <div className="frow">
          <div className="fg"><label className="fl">Valor (R$)</label><input className="fi" inputMode="decimal" placeholder="0,00" value={f.valor} onChange={e=>upd("valor",e.target.value)}/></div>
          <div className="fg"><label className="fl">Data</label><input className="fi" type="date" value={f.data} onChange={e=>upd("data",e.target.value)}/></div>
        </div>
        <div className="fg"><label className="fl">Conta onde caiu</label>
          <select className="fi" value={f.accId} onChange={e=>upd("accId",e.target.value)}>
            <option value="">— Selecione —</option>
            {data.accounts.map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}
          </select></div>
      </>}
      {type==="gasto"&&<>
        <div className="hint" style={{marginBottom:10}}>💳 Compra no crédito? Use <strong>+ Crédito</strong> — cai direto na fatura certa.</div>
        <div className="fg"><label className="fl">Categoria</label>
          <div className="catgrid">{data.cats.map(c=>(
            <button type="button" key={c.id} className={`catopt${f.catId===c.id?" selected":""}`} onClick={()=>upd("catId",c.id)}>{c.icon} {c.nome}</button>
          ))}</div></div>
        <div className="fg"><label className="fl">Descrição</label>
          <input className="fi" placeholder="Ex: Mercado, Uber, Farmácia…" value={f.descricao} onChange={e=>{
            const v=e.target.value; upd("descricao",v);
            if(v.length>=3){const s=sugerirCat(v,mem,f.catId);if(s&&s!==f.catId)upd("catId",s);}
          }}/></div>
        <div className="frow">
          <div className="fg"><label className="fl">Valor (R$)</label><input className="fi" inputMode="decimal" placeholder="0,00" value={f.valor} onChange={e=>upd("valor",e.target.value)}/></div>
          <div className="fg"><label className="fl">Data</label><input className="fi" type="date" value={f.data} onChange={e=>upd("data",e.target.value)}/></div>
        </div>
        <div className="frow">
          <div className="fg"><label className="fl">Conta</label>
            <select className="fi" value={f.accId} onChange={e=>upd("accId",e.target.value)}>
              {data.accounts.map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}
            </select></div>
          <div className="fg"><label className="fl">Forma</label>
            <select className="fi" value={f.forma} onChange={e=>upd("forma",e.target.value)}>
              {FORMAS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select></div>
        </div>
        <div className="fg" style={{background:"rgba(99,102,241,.05)",border:"1px solid rgba(99,102,241,.18)",borderRadius:10,padding:"10px 12px"}}>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12}}>
            <input type="checkbox" checked={!!f.isTransfer||!!f.transferParaId} onChange={e=>{upd("isTransfer",e.target.checked);if(!e.target.checked)upd("transferParaId","");}} style={{width:16,height:16,accentColor:"var(--accent)"}}/>
            <span><strong>🔄 Transferência entre minhas contas</strong></span>
          </label>
          {(f.isTransfer||f.transferParaId)&&(
            <div style={{marginTop:8}}>
              <label className="fl">Para qual conta?</label>
              <select className="fi" value={f.transferParaId||""} onChange={e=>upd("transferParaId",e.target.value)}>
                <option value="">— Selecione —</option>
                {data.accounts.filter(a=>a.id!==f.accId).map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </div>
          )}
        </div>
      </>}
      {type==="fixa"&&<>
        <div className="fg"><label className="fl">Nome</label><input className="fi" placeholder="Ex: Aluguel, Internet…" value={f.nome} onChange={e=>upd("nome",e.target.value)} autoFocus/></div>
        <div className="frow">
          <div className="fg"><label className="fl">Valor (R$)</label><input className="fi" inputMode="decimal" placeholder="0,00" value={f.valor} onChange={e=>upd("valor",e.target.value)}/></div>
          <div className="fg"><label className="fl">Dia do vencimento</label><input className="fi" type="number" min="1" max="31" placeholder="opcional" value={f.dia||""} onChange={e=>upd("dia",e.target.value)}/></div>
        </div>
        <div className="fg"><label className="fl">Categoria</label>
          <select className="fi" value={f.catId} onChange={e=>upd("catId",e.target.value)}>
            {data.cats.map(c=><option key={c.id} value={c.id}>{c.icon} {c.nome}</option>)}
          </select></div>
        <div className="fg" style={{background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",borderRadius:10,padding:"10px 12px"}}>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12}}>
            <input type="checkbox" checked={f.recorrente!==false} onChange={e=>upd("recorrente",e.target.checked)} style={{width:16,height:16,accentColor:"var(--accent)"}}/>
            <span><strong>♻️ Recorrente</strong> — copiar para os próximos meses</span>
          </label>
        </div>
      </>}
      {type==="reserva"&&<>
        <div className="fg"><label className="fl">Tipo</label>
          <select className="fi" value={f.tipo} onChange={e=>upd("tipo",e.target.value)}>
            <option value="emergencia">🛡️ Reserva de emergência</option>
            <option value="pessoal">🎯 {data.settings.personalGoalName}</option>
            <option value="outro">💡 Outro investimento</option>
          </select></div>
        <div className="fg"><label className="fl">Descrição</label><input className="fi" placeholder="Ex: CDB Nubank, Aporte mensal…" value={f.nome} onChange={e=>upd("nome",e.target.value)}/></div>
        <div className="frow">
          <div className="fg"><label className="fl">Valor (R$)</label><input className="fi" inputMode="decimal" placeholder="0,00" value={f.valor} onChange={e=>upd("valor",e.target.value)}/></div>
          <div className="fg"><label className="fl">Data</label><input className="fi" type="date" value={f.data} onChange={e=>upd("data",e.target.value)}/></div>
        </div>
        <div className="fg"><label className="fl">{f.retirada?"Conta que recebe":"Conta de origem"}</label>
          <select className="fi" value={f.accId} onChange={e=>upd("accId",e.target.value)}>
            <option value="">— Selecione —</option>
            {data.accounts.map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}
          </select></div>
        <div className="fg">
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12}}>
            <input type="checkbox" checked={!!f.retirada} onChange={e=>upd("retirada",e.target.checked)} style={{width:16,height:16,accentColor:"var(--gold)"}}/>
            <span><strong>📤 É uma retirada</strong> (o dinheiro volta para a conta)</span>
          </label>
        </div>
      </>}
      <button className="savebtn" onClick={save}>{edit?"Salvar alterações":"Adicionar"}</button>
    </>
  );
}

/* Compra no crédito: cai automaticamente na fatura certa pelo dia de fechamento */
function CreditoModal({modal,data,mutate,mes,mem,onClose}){
  const edit=modal.edit||null;
  const cards=data.accounts.filter(a=>a.temCartao);
  const dd=hoje();
  const [f,setF]=useState(()=>{
    if(edit) return {...edit,valor:String(edit.parcela?edit.valor*edit.parcela.n:edit.valor),parcelas:String(edit.parcela?.n||1),cardId:edit.accId,faturaMes:mes};
    const cardId=modal.cardId||cards[0]?.id||"";
    const card=cards.find(c=>c.id===cardId);
    return {descricao:"",catId:data.cats[0]?.id||"",cardId,valor:"",parcelas:"1",data:dd,
      faturaMes:card?mesFaturaDe(dd,card.fechamento):mes};
  });
  const upd=(k,v)=>setF(p=>({...p,[k]:v}));
  const card=cards.find(c=>c.id===f.cardId);
  const tv=parseVal(f.valor), np=parseInt(f.parcelas)||1, vp=np>0?tv/np:0;
  const opcoes=[...new Set([f.faturaMes,mes,shiftKey(mes,1),shiftKey(mes,2),shiftKey(mes,3)])];

  /* recalcula fatura sugerida quando muda data ou cartão */
  useEffect(()=>{ if(!edit&&card) upd("faturaMes",mesFaturaDe(f.data,card.fechamento)); },[f.data,f.cardId]);

  function save(){
    if(!f.descricao||!tv||!f.cardId) return;
    mutate(d=>{
      if(edit){
        const mm=ensureMonth(d,mes);
        const g=mm.gastos.find(x=>x.id===edit.id);
        if(g){g.descricao=f.descricao;g.catId=f.catId;g.accId=f.cardId;g.data=f.data;
          g.valor=edit.parcela?r2(tv/edit.parcela.n):tv;}
        return d;
      }
      const grupo=np>1?uid():null;
      const base=r2(tv/np);
      for(let i=0;i<np;i++){
        const mk=shiftKey(f.faturaMes,i);
        const mm=ensureMonth(d,mk);
        const v=i===np-1?r2(tv-base*(np-1)):base;   /* última parcela absorve o resto do arredondamento */
        mm.gastos.unshift({id:uid(),catId:f.catId,descricao:f.descricao+(np>1?` (${i+1}/${np})`:""),
          valor:v,forma:"credito",accId:f.cardId,data:i===0?f.data:"",
          parcela:np>1?{i:i+1,n:np,grupo}:null});
      }
      return d;
    });
    onClose();
  }

  if(!cards.length) return <><MHdr title="💳 Compra no crédito" onClose={onClose}/><div className="empty">Nenhum cartão configurado. Ative em ⚙️ Config.</div></>;
  return (
    <>
      <MHdr title={edit?"✏️ Editar compra":"💳 Nova compra no crédito"} onClose={onClose}/>
      <div className="fg"><label className="fl">Descrição</label>
        <input className="fi" placeholder="Ex: Tênis Nike, iFood…" value={f.descricao} autoFocus onChange={e=>{
          const v=e.target.value;upd("descricao",v);
          if(v.length>=3){const s=sugerirCat(v,mem,f.catId);if(s&&s!==f.catId)upd("catId",s);}
        }}/></div>
      <div className="fg"><label className="fl">Categoria</label>
        <div className="catgrid">{data.cats.map(c=>(
          <button type="button" key={c.id} className={`catopt${f.catId===c.id?" selected":""}`} onClick={()=>upd("catId",c.id)}>{c.icon} {c.nome}</button>
        ))}</div></div>
      <div className="fg"><label className="fl">Cartão</label>
        <select className="fi" value={f.cardId} onChange={e=>upd("cardId",e.target.value)} disabled={!!edit}>
          {cards.map(c=><option key={c.id} value={c.id}>{c.nome} (fecha dia {c.fechamento})</option>)}
        </select></div>
      <div className="frow">
        <div className="fg"><label className="fl">Valor total (R$)</label><input className="fi" inputMode="decimal" placeholder="0,00" value={f.valor} onChange={e=>upd("valor",e.target.value)}/></div>
        <div className="fg"><label className="fl">Parcelas</label><input className="fi" type="number" min="1" max="48" value={f.parcelas} onChange={e=>upd("parcelas",e.target.value)} disabled={!!edit}/></div>
      </div>
      <div className="fg"><label className="fl">Data da compra</label><input className="fi" type="date" value={f.data} onChange={e=>upd("data",e.target.value)}/></div>
      {!edit&&<div className="fg"><label className="fl">Cai na fatura de</label>
        <select className="fi" value={f.faturaMes} onChange={e=>upd("faturaMes",e.target.value)}>
          {opcoes.map(k=><option key={k} value={k}>{labelKey(k)}{card&&k===mesFaturaDe(f.data,card.fechamento)?" (sugerido)":""}</option>)}
        </select></div>}
      {np>1&&vp>0&&<div className="hint" style={{marginBottom:10}}>{np}x de <strong style={{color:"var(--accent)"}}>{fmt(vp)}</strong> · a partir da fatura de {labelKey(f.faturaMes)}</div>}
      <button className="savebtn" onClick={save} disabled={!f.descricao||!tv}>{edit?"Salvar alterações":`Adicionar ${np>1?`(${np}x de ${fmt(vp)})`:`(${fmt(tv)})`}`}</button>
    </>
  );
}

/* ════════════════════════════ Colar em lote ════════════════════════════ */
function BulkPanel({destino,data,mutate,mes,mem,onClose,setToast}){
  const [texto,setTexto]=useState("");
  const [preview,setPreview]=useState(null);
  const labels={gastos:"Gastos (Débito/PIX)",credito:"Compras no crédito",entradas:"Entradas"};
  const exemplos={
    gastos:"iFood 45,90 01/07\nMercado 200 02/07",
    credito:"Tênis Nike 350 05/07\nNetflix 39,90 10/07",
    entradas:"Salário 5000 05/07\nFreela Cliente X 1200 10/07",
  };
  function parseLinha(l){
    const vm=l.match(/\b(\d{1,6}[.,]\d{2}|\d{1,6})\b/);
    if(!vm) return null;
    const valor=parseVal(vm[1]); if(!valor) return null;
    const dm=l.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    let dataI=`${mes}-${String(new Date().getDate()).padStart(2,"0")}`;
    if(dm){const dd2=String(dm[1]).padStart(2,"0"),mm2=String(dm[2]).padStart(2,"0");
      const y=dm[3]?(dm[3].length===2?"20"+dm[3]:dm[3]):mes.split("-")[0];dataI=`${y}-${mm2}-${dd2}`;}
    let desc=l.replace(vm[0]," ").replace(dm?dm[0]:""," ").replace(/\s+/g," ").trim()||"Importado";
    if(destino==="entradas") return {id:uid(),fonte:desc,valor,data:dataI,accId:data.accounts[0]?.id||""};
    const catId=sugerirCat(desc,mem,data.cats[data.cats.length-1]?.id||"");
    return {id:uid(),catId,descricao:desc,valor,data:dataI,
      forma:destino==="credito"?"credito":"pix",
      accId:destino==="credito"?(data.accounts.find(a=>a.temCartao)?.id||""):(data.accounts[0]?.id||""),parcela:null};
  }
  function processar(){ setPreview(texto.split("\n").map(l=>l.trim()).filter(Boolean).map(parseLinha).filter(Boolean)); }
  function confirmar(){
    mutate(d=>{const mm=ensureMonth(d,mes);
      if(destino==="entradas") mm.entradas=[...preview,...mm.entradas];
      else mm.gastos=[...preview,...mm.gastos];
      return d;});
    setToast(`✅ ${preview.length} lançamento(s) adicionado(s)`);
    onClose();
  }
  return (
    <>
      <MHdr title={`📋 Colar em lote — ${labels[destino]||destino}`} onClose={onClose}/>
      {!preview?(<>
        <div style={{background:"var(--card2)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:10,fontSize:11,color:"var(--text2)",lineHeight:1.9,fontFamily:"monospace"}}>{exemplos[destino]}</div>
        <textarea className="notesarea" style={{minHeight:130}} placeholder="Cole aqui, um por linha…" value={texto} onChange={e=>setTexto(e.target.value)} autoFocus/>
        <button className="savebtn" onClick={processar} disabled={!texto.trim()}>Processar →</button>
      </>):(<>
        <div style={{fontSize:11,color:"var(--muted)",marginBottom:10}}>{preview.length} lançamento(s) identificado(s):</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14,maxHeight:"46vh",overflowY:"auto"}}>
          {preview.map((p,i)=>{
            const cat=p.catId?catById(data,p.catId):null;
            return (
              <div key={i} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:"9px 11px",display:"flex",alignItems:"center",gap:9}}>
                {cat&&<span style={{fontSize:16}}>{cat.icon}</span>}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.fonte||p.descricao}</div>
                  <div style={{fontSize:9,color:"var(--muted)"}}>{dmy(p.data)}{cat?` · ${cat.nome}`:""}</div>
                </div>
                <div style={{fontWeight:700,fontSize:13,color:destino==="entradas"?"var(--green)":"var(--red)"}}>{fmt(p.valor)}</div>
                <button className="tdel" onClick={()=>setPreview(pv=>pv.filter((_,j)=>j!==i))}>✕</button>
              </div>
            );
          })}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9}}>
          <button className="btn-ghost" onClick={()=>setPreview(null)}>← Corrigir</button>
          <button className="savebtn" style={{margin:0}} onClick={confirmar} disabled={!preview.length}>Confirmar {preview.length}</button>
        </div>
      </>)}
    </>
  );
}

/* ════════════════════════════ Importar CSV / PDF ════════════════════════════ */
async function loadPDFJS(){
  if(window.pdfjsLib) return window.pdfjsLib;
  return new Promise((res,rej)=>{
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";res(window.pdfjsLib);};
    s.onerror=()=>rej(new Error("PDF.js não carregou"));
    document.head.appendChild(s);
  });
}
async function extrairTextoPDF(file){
  const pdfjs=await loadPDFJS();
  const buf=await file.arrayBuffer();
  const pdf=await pdfjs.getDocument({data:buf}).promise;
  let full="";
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    const byY={};
    content.items.forEach(it=>{const y=Math.round(it.transform[5]);if(!byY[y])byY[y]=[];byY[y].push({x:Math.round(it.transform[4]),str:it.str});});
    Object.keys(byY).sort((a,b)=>b-a).forEach(y=>{full+=byY[y].sort((a,b)=>a.x-b.x).map(i2=>i2.str).join(" ")+"\n";});
    full+="\n";
  }
  return full;
}
function parseDataBR(s,ano){
  if(!s) return null; s=String(s).trim();
  const mo={JAN:"01",FEV:"02",MAR:"03",ABR:"04",MAI:"05",JUN:"06",JUL:"07",AGO:"08",SET:"09",OUT:"10",NOV:"11",DEZ:"12"};
  let m;
  if((m=s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/))) return `${m[3]}-${m[2]}-${m[1]}`;
  if((m=s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if((m=s.match(/^(\d{2})[\/\-](\d{2})$/))) return `${ano}-${m[2]}-${m[1]}`;
  if((m=s.match(/^(\d{2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(?:\s+(\d{2,4}))?$/i))){
    const y=m[3]?(m[3].length===2?"20"+m[3]:m[3]):String(ano);return `${y}-${mo[m[2].toUpperCase()]}-${m[1]}`;}
  if((m=s.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/))) return `${m[3]}-${m[2]}-${m[1]}`;
  if((m=s.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{2})/))) return `20${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
function parsePDFTx(texto,ano){
  const linhas=texto.split("\n").map(l=>l.trim()).filter(l=>l.length>2);
  const rows=[];
  const valPat=/(-?\s*\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
  const datePat=/\b(\d{2}[\/\-]\d{2}(?:[\/\-]\d{2,4})?|\d{2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(?:\s+\d{2,4})?)\b/i;
  const skipPat=/\b(total|saldo|limite|fatura|pagamento|vencimento|cpf|cnpj|agência|conta corrente|poupança|página|page)\b/i;
  for(let i=0;i<linhas.length;i++){
    const l=linhas[i];
    if(skipPat.test(l)) continue;
    const vm=l.match(valPat); if(!vm) continue;
    const val=parseVal(vm[1]); if(!val||val>50000) continue;
    const dm=l.match(datePat); if(!dm) continue;
    const dataI=parseDataBR(dm[1],ano)||`${ano}-01-01`;
    let desc=l.replace(vm[0],"").replace(dm[0],"").replace(/R\$/g,"").replace(/\s{2,}/g," ").replace(/^\s*[-•·]\s*/,"").trim();
    if(desc.length<4&&i>0&&!linhas[i-1].match(valPat)) desc=(linhas[i-1].replace(/\s{2,}/g," ").trim()+" "+desc).trim();
    if(!desc||desc.length<2) desc="Importado";
    rows.push({data:dataI,descricao:desc,valor:val});
  }
  return rows;
}
function parseCSVTx(texto){
  const linhas=texto.trim().split(/\r?\n/).filter(l=>l.trim());
  if(linhas.length<2) return [];
  const sep=linhas[0].includes(";")?";":",";
  const hs=linhas[0].split(sep).map(h=>h.replace(/['"]/g,"").trim().toLowerCase());
  let di=hs.findIndex(h=>/\bdata\b|date|\bdt\b/.test(h));
  let de=hs.findIndex(h=>/títul|titulo|descri|memo|lancam|estabele|histor|narrat|lançam/.test(h));
  let vi=hs.findIndex(h=>/^valor$|^value$|^amount$/.test(h));
  if(vi===-1) vi=hs.findIndex(h=>/valor|value|amount|debito/.test(h));
  if(di===-1) di=0;
  if(de===-1) de=Math.min(1,hs.length-1);
  if(vi===-1) throw new Error("Coluna de valor não encontrada no CSV.");
  const rows=[];
  for(let i=1;i<linhas.length;i++){
    const cols=linhas[i].split(sep).map(c=>c.replace(/['"]/g,"").trim());
    if(cols.length<=vi) continue;
    const val=parseVal(cols[vi]||"0"); if(!val) continue;
    rows.push({data:cols[di]||"",descricao:cols[de]||`Item ${i}`,valor:val});
  }
  return rows;
}

async function fileToBase64(file){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=e=>res(e.target.result.split(",")[1]);
    r.onerror=()=>rej(new Error("Erro ao ler arquivo"));
    r.readAsDataURL(file);
  });
}
/* Foto de extrato/fatura → IA extrai as transações.
   Funciona no ambiente onde o app já rodava com essa função; se a chamada
   falhar (rede/CORS), cai num erro claro orientando exportar CSV. */
async function lerFotoComIA(file){
  const b64=await fileToBase64(file);
  const prompt=`Analise esta imagem de extrato ou fatura bancária. Extraia TODAS as transações individuais.
Retorne APENAS um array JSON válido, sem markdown: [{"date":"DD/MM/YYYY","description":"estabelecimento","value":99.90}]
Regras: value numérico positivo, inclua TODAS as compras, ignore totais/saldos/cabeçalhos, para parcelas use o valor da parcela.`;
  const resp=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:2000,
      messages:[{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:b64}},
        {type:"text",text:prompt}]}]})
  });
  if(!resp.ok) throw new Error(`API ${resp.status}`);
  const dd=await resp.json();
  const txt=dd.content?.find(c=>c.type==="text")?.text||"[]";
  const arr=JSON.parse(txt.replace(/```json?|```/g,"").trim());
  return arr.map(t=>({data:t.date,descricao:t.description,valor:t.value}));
}

function ImportModal({destino,cardId,data,mutate,mes,onClose,setToast}){
  const [step,setStep]=useState("upload");
  const [erro,setErro]=useState("");
  const [preview,setPreview]=useState([]);
  const [editCats,setEditCats]=useState({});
  const [loadMsg,setLoadMsg]=useState("");
  const inputRef=useRef();
  const cards=data.accounts.filter(a=>a.temCartao);
  const [selCard,setSelCard]=useState(cardId||cards[0]?.id||"");
  const [selConta,setSelConta]=useState(data.accounts[0]?.id||"");
  const ehCredito=destino==="credito";
  const ehEntrada=destino==="entradas";
  const mem=useMemo(()=>memoriaCategorias(data),[data]);
  const ano=mes.split("-")[0];

  async function processarArquivo(file){
    const ext=file.name.split(".").pop().toLowerCase();
    if(ext==="pdf"){
      const txt=await extrairTextoPDF(file);
      const rows=parsePDFTx(txt,ano);
      if(!rows.length) throw new Error("Nenhuma transação reconhecida no PDF. Tente exportar como CSV no app do banco.");
      return rows;
    }
    if(["jpg","jpeg","png","gif","webp","heic","jfif"].includes(ext)||file.type.startsWith("image/")){
      try{ return await lerFotoComIA(file); }
      catch(err){
        throw new Error("A leitura por foto não respondeu aqui. Exporte como CSV no app do banco que funciona sempre. ("+err.message+")");
      }
    }
    return await new Promise((res,rej)=>{
      const r=new FileReader();
      r.onload=e=>{try{res(parseCSVTx(e.target.result));}catch(err){rej(err);}};
      r.onerror=()=>rej(new Error("Erro ao ler o arquivo."));
      r.readAsText(file,"UTF-8");
    });
  }
  async function handleFiles(list){
    const files=Array.from(list); if(!files.length) return;
    setErro("");setStep("loading");
    const all=[]; const erros=[];
    for(let i=0;i<files.length;i++){
      setLoadMsg(files.length>1?`Processando ${i+1} de ${files.length} — ${files[i].name}`:`Processando ${files[i].name}…`);
      try{
        const tx=await processarArquivo(files[i]);
        tx.forEach(t=>{
          const dataI=parseDataBR(String(t.data||""),ano)||`${mes}-15`;
          if(ehEntrada) all.push({id:uid(),fonte:t.descricao,valor:t.valor,data:dataI,accId:selConta});
          else all.push({id:uid(),catId:sugerirCat(t.descricao,mem,data.cats[data.cats.length-1]?.id||""),
            descricao:t.descricao,valor:t.valor,data:dataI,
            forma:ehCredito?"credito":"pix",accId:ehCredito?selCard:selConta,parcela:null});
        });
      }catch(err){erros.push(`${files[i].name}: ${err.message}`);}
    }
    if(erros.length) setErro(erros.join(" | "));
    if(!all.length){setStep("upload");return;}
    setPreview(all);setStep("preview");
  }
  function confirmar(){
    const final=preview.map((p,i)=>({...p,catId:editCats[i]||p.catId}));
    mutate(d=>{const mm=ensureMonth(d,mes);
      if(ehEntrada) mm.entradas=[...final,...mm.entradas];
      else mm.gastos=[...final,...mm.gastos];
      return d;});
    setToast(`✅ ${final.length} lançamento(s) importado(s) em ${labelKey(mes)}`);
    onClose();
  }
  const total=preview.reduce((s,p)=>s+p.valor,0);
  return (
    <>
      <MHdr title={`📂 Importar — ${{gastos:"Gastos",credito:"Fatura de cartão",entradas:"Entradas"}[destino]||destino}`} onClose={onClose}/>
      {step==="upload"&&<>
        {ehCredito&&<div className="fg"><label className="fl">Cartão</label>
          <select className="fi" value={selCard} onChange={e=>setSelCard(e.target.value)}>
            {cards.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
          </select></div>}
        {!ehCredito&&<div className="fg"><label className="fl">Conta</label>
          <select className="fi" value={selConta} onChange={e=>setSelConta(e.target.value)}>
            {data.accounts.map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}
          </select></div>}
        <div onClick={()=>inputRef.current?.click()}
          onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--accent)";}}
          onDragLeave={e=>{e.currentTarget.style.borderColor="var(--border)";}}
          onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor="var(--border)";handleFiles(e.dataTransfer.files);}}
          style={{border:"2px dashed var(--border)",borderRadius:14,padding:"30px 16px",textAlign:"center",cursor:"pointer",marginBottom:12}}>
          <div style={{fontSize:30,marginBottom:8}}>📂</div>
          <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>Clique ou arraste aqui</div>
          <div style={{fontSize:11,color:"var(--muted)"}}>CSV, PDF ou foto — pode selecionar vários. Tudo importado para {labelKey(mes)}.</div>
          <input ref={inputRef} type="file" multiple accept=".csv,.txt,.ofx,.pdf,.jpg,.jpeg,.png,.webp,.heic,image/*" style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
        </div>
        {erro&&<div className="alert warn" style={{marginBottom:10}}><span>⚠️</span><div>{erro}</div></div>}
        <div className="hint">
          <strong style={{color:"var(--accent)"}}>Como exportar:</strong> Nubank: App → Fatura → Exportar CSV · Santander: App → Extrato → Exportar · C6/Porto: App → Cartão → Exportar fatura
        </div>
      </>}
      {step==="loading"&&<div style={{textAlign:"center",padding:"48px 20px"}}>
        <div style={{fontSize:32,marginBottom:12}}>⏳</div>
        <div style={{fontSize:13,fontWeight:700}}>{loadMsg}</div>
      </div>}
      {step==="preview"&&<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:12,fontWeight:700}}>{preview.length} transação(ões)</span>
          <span style={{fontSize:14,fontWeight:800,color:"var(--red)"}}>{fmt(total)}</span>
        </div>
        {erro&&<div className="alert warn" style={{marginBottom:10}}><span>⚠️</span><div>{erro}</div></div>}
        <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:12,maxHeight:"46vh",overflowY:"auto"}}>
          {preview.map((p,i)=>{
            const cat=catById(data,editCats[i]||p.catId);
            return (
              <div key={i} style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:"8px 10px",display:"flex",alignItems:"center",gap:8}}>
                {!ehEntrada&&<div style={{width:28,height:28,borderRadius:7,background:cat.cor+"30",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>{cat.icon}</div>}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.fonte||p.descricao}</div>
                  <div style={{fontSize:10,color:"var(--muted)",display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
                    <span>{dmy(p.data)}</span>
                    {!ehEntrada&&<select value={editCats[i]||p.catId} onChange={e=>setEditCats(ec=>({...ec,[i]:e.target.value}))}
                      style={{fontSize:10,background:"var(--card2)",border:"1px solid var(--border)",color:"var(--text2)",borderRadius:5,padding:"1px 3px",fontFamily:"inherit",cursor:"pointer"}}>
                      {data.cats.map(c=><option key={c.id} value={c.id}>{c.icon} {c.nome}</option>)}
                    </select>}
                  </div>
                </div>
                <div style={{fontSize:12,fontWeight:700,color:ehEntrada?"var(--green)":"var(--red)"}}>{fmt(p.valor)}</div>
                <button className="tdel" onClick={()=>setPreview(pv=>pv.filter((_,j)=>j!==i))}>✕</button>
              </div>
            );
          })}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <button className="btn-ghost" onClick={()=>{setStep("upload");setPreview([]);setEditCats({});}}>← Voltar</button>
          <button className="savebtn" style={{margin:0}} onClick={confirmar} disabled={!preview.length}>Confirmar {preview.length}</button>
        </div>
      </>}
    </>
  );
}

/* ════════════════════════════ Fixas recorrentes ════════════════════════════ */
/* Ao abrir um mês novo, copia as fixas recorrentes do mês anterior mais próximo */
function criarMesComFixas(d, mk){
  if(d.months[mk]) return;
  const m=ensureMonth(d,mk);
  for(let i=1;i<=12;i++){
    const prev=d.months[shiftKey(mk,-i)];
    if(!prev) continue;
    if(shiftKey(mk,-i)>mk) break;
    (prev.fixas||[]).filter(f=>f.recorrente!==false).forEach(f=>{
      m.fixas.push({id:uid(),nome:f.nome,valor:f.valor,dia:f.dia||null,catId:f.catId,recorrente:true,pago:false,gastoId:null});
    });
    break;
  }
}

/* ════════════════════════════ Estilos ════════════════════════════ */
function Styles(){
  return <style>{`
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
.dark{--bg:#09090f;--surface:#111118;--card:#16161f;--card2:#1c1c28;--border:rgba(255,255,255,.08);--text:#f0f0ff;--text2:#b8b8d4;--muted:#5c5c82;--green:#22c55e;--red:#ef4444;--gold:#f59e0b;--accent:#6366f1;--accent2:#8b5cf6;--blue:#3b82f6;}
.light{--bg:#f1f1f7;--surface:#fff;--card:#ffffff;--card2:#ededf5;--border:rgba(0,0,0,.09);--text:#0f0f1a;--text2:#3c3c5c;--muted:#8c8cac;--green:#16a34a;--red:#dc2626;--gold:#d97706;--accent:#4f46e5;--accent2:#7c3aed;--blue:#2563eb;}
.dark,.light{background:var(--bg);color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;}
.main{max-width:520px;margin:0 auto;padding-bottom:90px;}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;position:sticky;top:0;z-index:90;background:var(--bg);border-bottom:1px solid var(--border);}
.logo{font-size:18px;font-weight:800;letter-spacing:-.5px;}
.logo em{color:var(--accent);font-style:normal;}
.hamburger{background:var(--card);border:1px solid var(--border);color:var(--text2);cursor:pointer;width:36px;height:36px;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;}
.hamburger span{display:block;width:16px;height:2px;background:currentColor;border-radius:2px;}
.avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.avatar.sm{width:34px;height:34px;font-size:12px;}
.sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;backdrop-filter:blur(4px);}
.sidebar{position:fixed;top:0;left:-290px;bottom:0;width:275px;background:var(--card);z-index:201;display:flex;flex-direction:column;transition:left .2s;box-shadow:4px 0 40px rgba(0,0,0,.25);}
.sidebar.open{left:0;}
.sidebar-header{padding:20px 20px 16px;border-bottom:1px solid var(--border);}
.sidebar-user{margin-top:12px;display:flex;align-items:center;gap:10px;}
.sidebar-nav{flex:1;overflow-y:auto;padding:10px;}
.snav{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;cursor:pointer;margin-bottom:2px;color:var(--text2);font-size:14px;font-weight:500;border:none;background:none;width:100%;text-align:left;font-family:inherit;}
.snav.active{background:rgba(99,102,241,.14);color:var(--accent);font-weight:700;}
.snav-ic{font-size:16px;width:20px;text-align:center;}
.sidebar-footer{padding:14px 16px 20px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px;}
.theme-toggle{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--card2);border-radius:12px;border:1px solid var(--border);cursor:pointer;}
.pill{width:40px;height:22px;background:var(--border);border-radius:11px;position:relative;transition:background .2s;}
.pill.on{background:var(--accent);}
.pill::after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;}
.pill.on::after{transform:translateX(18px);}
.signout{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;cursor:pointer;color:var(--red);font-size:13px;font-weight:600;border:none;background:none;width:100%;font-family:inherit;}
.month-nav{display:flex;align-items:center;gap:10px;padding:10px 16px 4px;}
.month-nav button{background:var(--card);border:1px solid var(--border);color:var(--text2);cursor:pointer;width:32px;height:32px;border-radius:9px;font-size:15px;font-family:inherit;}
.month-label{flex:1;text-align:center;font-size:14px;font-weight:700;}
.pg{padding:10px 16px 6px;display:flex;flex-direction:column;gap:12px;}
.hero-greet{font-size:21px;font-weight:800;letter-spacing:-.3px;}
.hero-sub{font-size:12px;color:var(--text2);margin:2px 0 12px;}
.hero-actions{display:flex;gap:8px;}
.hbtn{flex:1;padding:10px 0;border-radius:11px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;}
.hbtn.g{background:rgba(34,197,94,.1);color:var(--green);border:1px solid rgba(34,197,94,.25);}
.hbtn.r{background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.25);}
.hbtn.b{background:rgba(99,102,241,.1);color:var(--accent);border:1px solid rgba(99,102,241,.25);}
.card{background:var(--card);border:1px solid var(--border);border-radius:15px;padding:14px;}
.st{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}
.sep{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);padding:6px 0 0;}
.metrics4{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.mc4{background:var(--card);border:1px solid var(--border);border-radius:15px;padding:13px;}
.mc4-l{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:5px;}
.mc4-v{font-size:16px;font-weight:800;letter-spacing:-.4px;}
.mc4-s{font-size:10px;color:var(--muted);margin-top:2px;}
.alert{display:flex;align-items:flex-start;gap:9px;padding:10px 13px;border-radius:11px;font-size:11px;font-weight:500;line-height:1.5;}
.alert.warn{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.28);color:var(--gold);}
.chart{display:flex;align-items:flex-end;gap:4px;}
.cgrp{display:flex;align-items:flex-end;gap:2px;flex:1;width:100%;}
.cbar{flex:1;border-radius:3px 3px 0 0;min-height:2px;transition:height .4s;}
.clbl{font-size:7px;text-align:center;margin-top:3px;color:var(--muted);}
.txlist{display:flex;flex-direction:column;gap:7px;}
.txi{display:flex;align-items:center;gap:10px;padding:11px;background:var(--surface);border:1px solid var(--border);border-radius:13px;cursor:pointer;}
.txicon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}
.txinfo{flex:1;min-width:0;}
.txd{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.txm{font-size:10px;color:var(--muted);margin-top:2px;display:flex;gap:5px;align-items:center;flex-wrap:wrap;}
.txa{font-size:13px;font-weight:700;flex-shrink:0;}
.tdel{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:5px 4px;flex-shrink:0;}
.chip{display:inline-flex;font-size:9px;font-weight:700;padding:2px 6px;border-radius:20px;}
.empty{text-align:center;color:var(--muted);font-size:13px;padding:36px 0;line-height:1.8;}
.fab{position:fixed;bottom:20px;right:16px;width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 8px 24px rgba(99,102,241,.4);z-index:80;}
.fab:active{transform:scale(.92);}
.toast{position:fixed;bottom:84px;left:50%;transform:translateX(-50%);background:var(--green);color:#04140a;font-size:12px;font-weight:700;padding:10px 20px;border-radius:20px;z-index:2000;white-space:nowrap;font-family:'Plus Jakarta Sans',sans-serif;}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(8px);z-index:1000;display:flex;align-items:flex-end;justify-content:center;}
.modal-surface{background:var(--card);border-top:1.5px solid var(--border);border-radius:20px 20px 0 0;width:100%;max-width:520px;padding:22px 20px 40px;overflow-y:auto;color:var(--text);}
.mhdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;}
.mtitle{font-size:15px;font-weight:800;}
.mclose{background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:2px 6px;opacity:.6;}
.fl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text2);margin-bottom:6px;display:block;}
.fi{width:100%;background:var(--card2);border:1.5px solid var(--border);color:var(--text);font-family:inherit;font-size:13px;border-radius:10px;padding:11px 13px;outline:none;font-weight:500;}
.fi:focus{border-color:var(--accent);}
.fi::placeholder{color:var(--muted);opacity:1;}
select.fi{appearance:none;-webkit-appearance:none;}
.fg{margin-bottom:12px;}
.frow{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.catgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
.catopt{border:1.5px solid var(--border);background:var(--card2);color:var(--text2);font-family:inherit;font-size:11px;font-weight:700;border-radius:9px;padding:9px 6px;cursor:pointer;text-align:center;line-height:1.5;word-break:break-word;}
.catopt.selected{background:rgba(99,102,241,.2);border-color:var(--accent);color:var(--accent);font-weight:800;}
.savebtn{width:100%;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:none;font-family:inherit;font-size:14px;font-weight:700;border-radius:13px;padding:14px;cursor:pointer;margin-top:6px;}
.savebtn:disabled{opacity:.4;cursor:not-allowed;}
.notesarea{width:100%;background:var(--card2);border:1.5px solid var(--border);color:var(--text);font-family:inherit;font-size:13px;border-radius:12px;padding:12px;resize:vertical;min-height:80px;outline:none;}
.notesarea:focus{border-color:var(--accent);}
.bulkbtn{background:var(--surface);border:1.5px solid var(--border);color:var(--text2);font-family:inherit;font-size:12px;font-weight:600;border-radius:11px;padding:9px 14px;cursor:pointer;}
.btn-green{background:var(--green);border:none;color:#fff;font-family:inherit;font-size:11px;font-weight:700;border-radius:9px;padding:10px 14px;cursor:pointer;}
.btn-green:disabled{opacity:.5;}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--muted);font-family:inherit;font-size:11px;font-weight:600;border-radius:9px;padding:9px 12px;cursor:pointer;}
.btn-accent{background:var(--accent);border:none;color:#fff;font-family:inherit;font-size:12px;font-weight:700;border-radius:11px;padding:12px 8px;cursor:pointer;}
.btn-mini{background:var(--accent);border:none;color:#fff;font-family:inherit;font-size:11px;font-weight:700;border-radius:8px;padding:5px 10px;cursor:pointer;}
.tab{flex:1;padding:9px 4px;border-radius:11px;border:1.5px solid var(--border);background:var(--surface);color:var(--muted);font-family:inherit;font-size:11px;font-weight:700;cursor:pointer;}
.tab.on{border-color:var(--accent);background:rgba(99,102,241,.12);color:var(--accent);}
.atable{width:100%;border-collapse:collapse;font-size:12px;}
.atable th{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:7px 6px;text-align:right;}
.atable th:first-child{text-align:left;}
.atable td{padding:7px 6px;text-align:right;border-top:1px solid var(--border);}
.atable td:first-child{text-align:left;font-weight:600;font-size:11px;}
.atable tr.cur td{background:rgba(99,102,241,.1);}
.atable tfoot td{border-top:2px solid var(--border);font-weight:700;}
.hint{background:rgba(99,102,241,.05);border:1px solid rgba(99,102,241,.15);border-radius:10px;padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.6;}
@media(min-width:900px){
  .main{max-width:640px;margin-left:300px;}
  .sidebar{left:0;box-shadow:none;border-right:1px solid var(--border);}
  .sidebar-overlay{display:none;}
  .hamburger{display:none;}
  .topbar{display:none;}
  .month-nav{padding-top:18px;}
}
`}</style>;
}
