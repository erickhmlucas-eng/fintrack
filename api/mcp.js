/* FinTrack MCP — deixa o Claude ler e lançar no FinTrack.
   Servidor MCP "Streamable HTTP" sem estado, numa função serverless da Vercel.

   Variáveis de ambiente (Vercel → Settings → Environment Variables):
     MCP_SECRET                 texto longo e aleatório; vai na URL (?k=...)
     SUPABASE_URL               mesma URL do app
     SUPABASE_SERVICE_ROLE_KEY  chave service_role do Supabase (NUNCA no código)
     FINTRACK_USER_ID           uuid do seu usuário no Supabase (Authentication → Users)

   Escrita: lê o bloco, altera, e só salva se o bloco não mudou desde a leitura
   (checagem por updated_at). Se mudou, tenta de novo. */

import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

const DATA_KEY = "fintrack:v2:data";
const FORMAS_DEBITO = ["pix", "debito", "dinheiro", "boleto"];
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

/* ─── Helpers (mesmos do app) ─────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const r2 = (v) => Math.round(v * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const fmt = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(v) ? v : 0);
const hoje = () => { const t = new Date(Date.now() - 3 * 3600e3); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const keyOf = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
const shiftKey = (mk, delta) => { const [y, m] = mk.split("-").map(Number); return keyOf(new Date(y, m - 1 + delta, 1)); };
const labelKey = (mk) => { const [y, m] = mk.split("-"); return `${MESES[Number(m) - 1]} ${y}`; };
const dmy = (iso) => (iso ? iso.slice(5).split("-").reverse().join("/") : "");
const parseVal = (s) => {
  if (typeof s === "number") return Math.abs(s);
  const t = String(s || "").replace(/R\$\s*/gi, "").replace(/\s/g, "").trim();
  if (/^-?\d{1,3}(\.\d{3})*,\d{1,2}$/.test(t)) return Math.abs(parseFloat(t.replace(/\./g, "").replace(",", ".")));
  if (/^-?\d{1,3}(,\d{3})*\.\d{1,2}$/.test(t)) return Math.abs(parseFloat(t.replace(/,/g, "")));
  return Math.abs(parseFloat(t.replace(",", ".")) || 0);
};
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const novoMes = () => ({ entradas: [], gastos: [], fixas: [], reservas: [], faturasPagas: {}, notes: "" });
function ensureMonth(d, mk) {
  if (!d.months) d.months = {};
  if (!d.months[mk]) d.months[mk] = novoMes();
  const m = d.months[mk];
  if (!m.entradas) m.entradas = []; if (!m.gastos) m.gastos = []; if (!m.fixas) m.fixas = [];
  if (!m.reservas) m.reservas = []; if (!m.faturasPagas) m.faturasPagas = {};
  return m;
}
const contaById = (d, id) => (d.accounts || []).find((a) => a.id === id);
const catById = (d, id) => (d.cats || []).find((c) => c.id === id) || { nome: "—", icon: "📌" };

function faturaDe(d, mk, cardId) {
  const m = d.months?.[mk]; if (!m) return 0;
  return (m.gastos || []).filter((g) => g.forma === "credito" && g.accId === cardId).reduce((s, g) => s + g.valor, 0);
}
function mesFaturaDe(dataCompra, fechamento) {
  const dt = new Date((dataCompra || hoje()) + "T12:00");
  let m = dt.getMonth(), y = dt.getFullYear();
  if (fechamento > 1 && dt.getDate() >= fechamento) { m++; if (m > 11) { m = 0; y++; } }
  return `${y}-${pad(m + 1)}`;
}
function saldoConta(d, accId) {
  const acc = contaById(d, accId); if (!acc) return 0;
  const anc = acc.ancoraData || null;
  const conta = (dt, ts) => {
    if (!anc) return true;
    if (!dt) return true;
    if (dt > anc) return true;
    if (dt < anc) return false;
    if (!acc.ancoraTs) return true;
    return (ts || 0) > acc.ancoraTs;
  };
  let s = acc.saldoInicial || 0;
  Object.entries(d.months || {}).forEach(([mk, m]) => {
    (m.entradas || []).forEach((e) => { if (e.accId === accId && conta(e.data, e.ts)) s += e.valor; });
    (m.gastos || []).forEach((g) => {
      if (g.forma === "credito") return;
      if (!conta(g.data, g.ts)) return;
      if (g.transferParaId) { if (g.accId === accId) s -= g.valor; if (g.transferParaId === accId) s += g.valor; return; }
      if (g.accId === accId) s -= g.valor;
    });
    (m.reservas || []).forEach((r) => {
      if (r.rend) return;
      if (r.accId !== accId || !conta(r.data, r.ts)) return;
      s += r.retirada ? r.valor : -r.valor;
    });
    Object.entries(m.faturasPagas || {}).forEach(([cardId, fp]) => {
      if (fp && fp.contaId === accId && conta(fp.data, fp.ts)) s -= faturaDe(d, mk, cardId);
    });
  });
  return r2(s);
}
function metricsMes(d, mk) {
  const m = d.months?.[mk];
  if (!m) return { entradas: 0, gastosDeb: 0, faturasPagas: 0, aportes: 0, saidas: 0, sobra: 0, comprometido: 0, gastoCredito: 0 };
  const entradas = (m.entradas || []).reduce((s, e) => s + e.valor, 0);
  const gastosDeb = (m.gastos || []).filter((g) => g.forma !== "credito" && !g.transferParaId).reduce((s, g) => s + g.valor, 0);
  const gastoCredito = (m.gastos || []).filter((g) => g.forma === "credito").reduce((s, g) => s + g.valor, 0);
  let faturasPagas = 0, comprometido = 0;
  (d.accounts || []).filter((a) => a.temCartao).forEach((a) => {
    const fv = faturaDe(d, mk, a.id);
    if (!fv) return;
    if (m.faturasPagas && m.faturasPagas[a.id]) faturasPagas += fv; else comprometido += fv;
  });
  const aportes = (m.reservas || []).filter((r) => !r.retirada && !r.rend).reduce((s, r) => s + r.valor, 0);
  const saidas = gastosDeb + faturasPagas + aportes;
  return { entradas, gastosDeb, faturasPagas, aportes, saidas, sobra: entradas - saidas, comprometido, gastoCredito };
}
function reservaTotais(d) {
  const anc = d.settings?.reservaAncora || {};
  const calc = (tipo) => {
    const a = anc[tipo] || { valor: 0, data: null };
    let t = a.valor || 0;
    Object.values(d.months || {}).forEach((m) => (m.reservas || []).forEach((r) => {
      if (r.tipo !== tipo) return;
      if (a.data && r.data && r.data < a.data) return;
      t += r.retirada ? -r.valor : r.valor;
    }));
    return r2(t);
  };
  return { emergencia: calc("emergencia"), pessoal: calc("pessoal") };
}
const idxParcela = (dv, mk) => {
  const [y, m] = mk.split("-").map(Number); const [iy, im] = dv.inicioMes.split("-").map(Number);
  return (y * 12 + m) - (iy * 12 + im);
};
const mesesDivida = (dv) => {
  const [iy, im] = dv.inicioMes.split("-").map(Number);
  return Array.from({ length: dv.parcelas }, (_, i) => { const t = iy * 12 + (im - 1) + i; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; });
};
const pagasDivida = (d, dv) => {
  const set = new Set(dv.pagos || []);
  if (dv.cartaoId) mesesDivida(dv).forEach((k) => { const m = d.months?.[k]; if (m?.faturasPagas?.[dv.cartaoId]) set.add(k); });
  return [...set];
};

/* ─── Persistência (checagem de versão) ───────────────────────────────────── */
function getStore() {
  if (globalThis.__FINTRACK_TEST_STORE) return globalThis.__FINTRACK_TEST_STORE;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const user = process.env.FINTRACK_USER_ID;
  if (!url || !key || !user) throw new Error("Servidor sem SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou FINTRACK_USER_ID.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async load() {
      const { data, error } = await db.from("user_data").select("value,updated_at")
        .eq("user_id", user).eq("key", DATA_KEY).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.value) throw new Error("Nenhum dado do FinTrack encontrado para esse usuário.");
      return { value: data.value, updatedAt: data.updated_at };
    },
    async save(value, prevUpdatedAt) {
      const { data, error } = await db.from("user_data")
        .update({ value, updated_at: new Date().toISOString() })
        .eq("user_id", user).eq("key", DATA_KEY).eq("updated_at", prevUpdatedAt).select("updated_at");
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length === 1;
    },
  };
}
async function ler() { return (await getStore().load()).value; }
async function mutar(fn) {
  const store = getStore();
  for (let t = 0; t < 4; t++) {
    const { value, updatedAt } = await store.load();
    const d = JSON.parse(JSON.stringify(value));
    const out = fn(d);                       /* pode lançar erro de validação: nada é salvo */
    if (await store.save(d, updatedAt)) return out;
  }
  throw new Error("Os dados mudaram várias vezes durante a gravação. Tente de novo.");
}

/* ─── Resolução de nomes ──────────────────────────────────────────────────── */
function achar(lista, nome, rotulo) {
  const n = norm(nome);
  if (!n) throw new Error(`Informe ${rotulo}.`);
  let hit = lista.filter((x) => norm(x.nome) === n);
  if (!hit.length) hit = lista.filter((x) => norm(x.nome).includes(n) || n.includes(norm(x.nome)));
  if (hit.length === 1) return hit[0];
  const opcoes = lista.map((x) => x.nome).join(", ");
  throw new Error(hit.length ? `"${nome}" bate com mais de um (${hit.map((x) => x.nome).join(", ")}). Seja mais específico.` : `Não achei ${rotulo} "${nome}". Opções: ${opcoes}.`);
}
function dataValida(s) {
  const v = s || hoje();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v + "T12:00").getTime())) throw new Error("Data inválida. Use AAAA-MM-DD.");
  return v;
}
function exigirConfirmacao(a) {
  if (a.confirmado !== true) throw new Error("Falta confirmação. Mostre a tabelinha ao Erick, pergunte \"posso gravar assim?\" e só chame de novo com confirmado=true depois do \"pode lançar\" dele.");
}
function valorValido(v) {
  const n = r2(parseVal(v));
  if (!(n > 0) || n > 1e6) throw new Error("Valor inválido.");
  return n;
}
function duplicado(m, g) {
  return (m.gastos || []).some((x) => x.data === g.data && x.valor === g.valor && x.accId === g.accId
    && x.forma === g.forma && norm(x.descricao) === norm(g.descricao) && !x.parcela);
}

/* ─── Ferramentas ─────────────────────────────────────────────────────────── */
const T_LEITURA = { readOnlyHint: true };
const MES_PROP = { type: "string", description: "Mês no formato AAAA-MM. Padrão: mês atual." };
const CONF = { type: "boolean", description: "Só true depois que o Erick confirmou a tabelinha." };
const FORCAR = { type: "boolean", description: "true para lançar mesmo parecendo duplicado." };

const TOOLS = [
  { name: "fintrack_cadastros", description: "Lista as contas, os cartões (fechamento, vencimento, limite) e as categorias do FinTrack. Use antes de lançar, para usar os nomes exatos.",
    inputSchema: { type: "object", properties: {} }, annotations: T_LEITURA },
  { name: "fintrack_resumo", description: "Resumo do mês: saldo por conta, entradas, saídas, sobra, faturas de cada cartão, reservas e dívidas ativas.",
    inputSchema: { type: "object", properties: { mes: MES_PROP } }, annotations: T_LEITURA },
  { name: "fintrack_extrato", description: "Lançamentos de um mês (gastos, crédito, entradas ou tudo).",
    inputSchema: { type: "object", properties: { mes: MES_PROP, tipo: { type: "string", enum: ["todos", "gastos", "credito", "entradas"] } } }, annotations: T_LEITURA },
  { name: "fintrack_lancar_gasto", description: "Lança um gasto no débito, Pix, dinheiro ou boleto. SEMPRE mostre a tabelinha (data, descrição, valor, categoria, forma, conta) e espere o Erick confirmar antes de chamar com confirmado=true.",
    inputSchema: { type: "object", required: ["descricao", "valor", "categoria", "conta", "confirmado"], properties: {
      descricao: { type: "string" }, valor: { type: "number", description: "Em reais, positivo." }, categoria: { type: "string" },
      conta: { type: "string", description: "Conta de onde saiu." }, forma: { type: "string", enum: FORMAS_DEBITO, description: "Padrão: pix." },
      data: { type: "string", description: "AAAA-MM-DD. Padrão: hoje." }, confirmado: CONF, forcar: FORCAR } } },
  { name: "fintrack_lancar_credito", description: "Lança uma compra no cartão de crédito (cai na fatura certa pelo fechamento; aceita parcelas). SEMPRE mostre a tabelinha e espere confirmação.",
    inputSchema: { type: "object", required: ["descricao", "valor", "categoria", "cartao", "confirmado"], properties: {
      descricao: { type: "string" }, valor: { type: "number", description: "Valor TOTAL da compra." }, categoria: { type: "string" },
      cartao: { type: "string" }, parcelas: { type: "integer", minimum: 1, maximum: 48 },
      data: { type: "string", description: "Data da compra, AAAA-MM-DD. Padrão: hoje." },
      fatura_mes: { type: "string", description: "AAAA-MM da fatura, se quiser forçar. Padrão: calculado pelo fechamento." },
      confirmado: CONF, forcar: FORCAR } } },
  { name: "fintrack_lancar_entrada", description: "Lança uma entrada (salário, freela, reembolso). SEMPRE mostre a tabelinha e espere confirmação.",
    inputSchema: { type: "object", required: ["fonte", "valor", "conta", "confirmado"], properties: {
      fonte: { type: "string" }, valor: { type: "number" }, conta: { type: "string", description: "Conta onde caiu." },
      data: { type: "string" }, confirmado: CONF } } },
  { name: "fintrack_transferir", description: "Transferência entre contas do próprio Erick (não conta como gasto). SEMPRE mostre a tabelinha e espere confirmação.",
    inputSchema: { type: "object", required: ["de", "para", "valor", "confirmado"], properties: {
      de: { type: "string" }, para: { type: "string" }, valor: { type: "number" }, data: { type: "string" }, confirmado: CONF } } },
];

function mesArg(a) { const mk = a.mes || hoje().slice(0, 7); if (!/^\d{4}-\d{2}$/.test(mk)) throw new Error("Mês inválido. Use AAAA-MM."); return mk; }

const HANDLERS = {
  async fintrack_cadastros() {
    const d = await ler();
    return {
      contas: d.accounts.map((a) => ({ nome: a.nome, cartao: !!a.temCartao, fechamento: a.temCartao ? a.fechamento : undefined, vencimento: a.temCartao ? a.vencimento : undefined, limite: a.temCartao ? a.limite : undefined })),
      categorias: d.cats.map((c) => `${c.icon} ${c.nome}`),
      formas_debito: FORMAS_DEBITO,
    };
  },

  async fintrack_resumo(a) {
    const d = await ler(); const mk = mesArg(a);
    const met = metricsMes(d, mk); const rt = reservaTotais(d); const m = d.months?.[mk] || novoMes();
    const contas = d.accounts.map((c) => ({ nome: c.nome, saldo: saldoConta(d, c.id) }));
    return {
      mes: labelKey(mk),
      total_nas_contas: r2(contas.reduce((s, c) => s + c.saldo, 0)), contas,
      entradas: r2(met.entradas), saidas: r2(met.saidas), sobra: r2(met.sobra),
      debito_pix: r2(met.gastosDeb), faturas_pagas: r2(met.faturasPagas), aportes: r2(met.aportes), credito_no_mes: r2(met.gastoCredito),
      faturas: d.accounts.filter((c) => c.temCartao).map((c) => {
        const v = faturaDe(d, mk, c.id);
        return { cartao: c.nome, fatura: r2(v), paga: !!m.faturasPagas?.[c.id], fecha_dia: c.fechamento, vence_dia: c.vencimento,
          limite: c.limite || undefined, disponivel: c.limite ? r2(Math.max(c.limite - v, 0)) : undefined, proxima_fatura: r2(faturaDe(d, shiftKey(mk, 1), c.id)) };
      }).filter((f) => f.fatura > 0 || f.proxima_fatura > 0),
      reservas: { emergencia: rt.emergencia, meta_emergencia: d.settings?.emergencyGoal, pessoal: rt.pessoal },
      fixas_pendentes: (m.fixas || []).filter((f) => !f.pago).map((f) => ({ nome: f.nome, valor: f.valor, dia: f.dia })),
      dividas: (d.dividas || []).filter((x) => !x.quitada).map((dv) => {
        const pagas = pagasDivida(d, dv).length;
        return { nome: dv.nome, parcelas: dv.parcelas, valor_parcela: dv.valorParcela, pagas, restante: r2(Math.max(dv.total - pagas * dv.valorParcela, 0)), no_cartao: dv.cartaoId ? contaById(d, dv.cartaoId)?.nome : undefined };
      }),
    };
  },

  async fintrack_extrato(a) {
    const d = await ler(); const mk = mesArg(a); const m = d.months?.[mk] || novoMes(); const tipo = a.tipo || "todos";
    const nomeConta = (id) => contaById(d, id)?.nome || "—";
    const gasto = (g) => ({ data: dmy(g.data), descricao: g.descricao, valor: g.valor, categoria: catById(d, g.catId).nome, conta: nomeConta(g.accId), forma: g.forma, parcela: g.parcela ? `${g.parcela.i}/${g.parcela.n}` : undefined, transferencia_para: g.transferParaId ? nomeConta(g.transferParaId) : undefined });
    const out = { mes: labelKey(mk) };
    if (tipo === "todos" || tipo === "gastos") out.gastos = (m.gastos || []).filter((g) => g.forma !== "credito").map(gasto);
    if (tipo === "todos" || tipo === "credito") out.credito = (m.gastos || []).filter((g) => g.forma === "credito").map(gasto);
    if (tipo === "todos" || tipo === "entradas") out.entradas = (m.entradas || []).map((e) => ({ data: dmy(e.data), fonte: e.fonte, valor: e.valor, conta: nomeConta(e.accId) }));
    return out;
  },

  async fintrack_lancar_gasto(a) {
    exigirConfirmacao(a);
    const valor = valorValido(a.valor); const data = dataValida(a.data);
    const forma = a.forma || "pix"; if (!FORMAS_DEBITO.includes(forma)) throw new Error(`Forma inválida. Use: ${FORMAS_DEBITO.join(", ")}. Para cartão de crédito use fintrack_lancar_credito.`);
    return mutar((d) => {
      const conta = achar(d.accounts, a.conta, "a conta"); const cat = achar(d.cats, a.categoria, "a categoria");
      const mm = ensureMonth(d, data.slice(0, 7));
      const g = { id: uid(), catId: cat.id, descricao: String(a.descricao || "").trim() || cat.nome, valor, data, ts: Date.now(), forma, accId: conta.id, parcela: null };
      if (!a.forcar && duplicado(mm, g)) throw new Error("Já existe um lançamento igual (mesma data, valor, descrição e conta). Se for outro mesmo, chame com forcar=true.");
      mm.gastos.unshift(g);
      return { lancado: { data: dmy(data), descricao: g.descricao, valor, categoria: cat.nome, forma, conta: conta.nome }, saldo_da_conta_agora: saldoConta(d, conta.id) };
    });
  },

  async fintrack_lancar_credito(a) {
    exigirConfirmacao(a);
    const total = valorValido(a.valor); const data = dataValida(a.data);
    const np = Math.max(1, Math.min(48, parseInt(a.parcelas) || 1));
    return mutar((d) => {
      const card = achar(d.accounts.filter((c) => c.temCartao), a.cartao, "o cartão"); const cat = achar(d.cats, a.categoria, "a categoria");
      const faturaMes = a.fatura_mes || mesFaturaDe(data, card.fechamento);
      if (!/^\d{4}-\d{2}$/.test(faturaMes)) throw new Error("fatura_mes inválido. Use AAAA-MM.");
      const desc = String(a.descricao || "").trim() || cat.nome; const grupo = np > 1 ? uid() : null; const base = r2(total / np);
      if (!a.forcar && np === 1 && duplicado(ensureMonth(d, faturaMes), { data, valor: total, accId: card.id, forma: "credito", descricao: desc })) throw new Error("Já existe uma compra igual nessa fatura. Se for outra mesmo, chame com forcar=true.");
      for (let i = 0; i < np; i++) {
        const mm = ensureMonth(d, shiftKey(faturaMes, i));
        const v = i === np - 1 ? r2(total - base * (np - 1)) : base;
        mm.gastos.unshift({ id: uid(), ts: Date.now(), catId: cat.id, descricao: desc + (np > 1 ? ` (${i + 1}/${np})` : ""), valor: v, forma: "credito", accId: card.id, data: i === 0 ? data : "", parcela: np > 1 ? { i: i + 1, n: np, grupo } : null });
      }
      return { lancado: { data: dmy(data), descricao: desc, valor_total: total, parcelas: np, valor_parcela: base, categoria: cat.nome, cartao: card.nome, cai_na_fatura_de: labelKey(faturaMes) },
        fatura_do_mes_agora: r2(faturaDe(d, faturaMes, card.id)), limite_disponivel: card.limite ? r2(Math.max(card.limite - faturaDe(d, faturaMes, card.id), 0)) : undefined };
    });
  },

  async fintrack_lancar_entrada(a) {
    exigirConfirmacao(a);
    const valor = valorValido(a.valor); const data = dataValida(a.data);
    return mutar((d) => {
      const conta = achar(d.accounts, a.conta, "a conta"); const mm = ensureMonth(d, data.slice(0, 7));
      const e = { id: uid(), fonte: String(a.fonte || "").trim() || "Entrada", valor, data, accId: conta.id, ts: Date.now() };
      mm.entradas.unshift(e);
      return { lancado: { data: dmy(data), fonte: e.fonte, valor, conta: conta.nome }, saldo_da_conta_agora: saldoConta(d, conta.id) };
    });
  },

  async fintrack_transferir(a) {
    exigirConfirmacao(a);
    const valor = valorValido(a.valor); const data = dataValida(a.data);
    return mutar((d) => {
      const de = achar(d.accounts, a.de, "a conta de origem"); const para = achar(d.accounts, a.para, "a conta de destino");
      if (de.id === para.id) throw new Error("Origem e destino são a mesma conta.");
      const cat = d.cats.find((c) => norm(c.nome) === "outros") || d.cats[d.cats.length - 1];
      const mm = ensureMonth(d, data.slice(0, 7));
      mm.gastos.unshift({ id: uid(), catId: cat.id, descricao: `Transferência ${de.nome} → ${para.nome}`, valor, data, ts: Date.now(), forma: "pix", accId: de.id, parcela: null, transferParaId: para.id });
      return { lancado: { data: dmy(data), de: de.nome, para: para.nome, valor }, saldo_origem_agora: saldoConta(d, de.id), saldo_destino_agora: saldoConta(d, para.id) };
    });
  },
};

/* ─── Protocolo MCP (JSON-RPC sobre HTTP, sem estado) ─────────────────────── */
const PROTOCOLOS = ["2025-06-18", "2025-03-26", "2024-11-05"];

async function tratar(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const erro = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === undefined) return null;                                   /* notificação */
  if (method === "initialize") {
    const pedido = params?.protocolVersion;
    return ok({ protocolVersion: PROTOCOLOS.includes(pedido) ? pedido : PROTOCOLOS[0], capabilities: { tools: {} },
      serverInfo: { name: "fintrack", version: "1.0.0" },
      instructions: "Antes de qualquer lançamento, mostre uma tabela (Campo | Valor) e pergunte \"posso gravar assim?\". Só grave com confirmado=true depois do \"pode lançar\"." });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    const h = HANDLERS[params?.name];
    if (!h) return erro(-32602, `Ferramenta desconhecida: ${params?.name}`);
    try {
      const out = await h(params.arguments || {});
      return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return ok({ isError: true, content: [{ type: "text", text: e.message || "Erro" }] });
    }
  }
  return erro(-32601, `Método não suportado: ${method}`);
}

function segredoOk(recebido) {
  const esperado = process.env.MCP_SECRET || "";
  if (esperado.length < 24) return null;                               /* servidor mal configurado */
  const a = Buffer.from(String(recebido || "")); const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET" || req.method === "DELETE") return res.status(405).json({ error: "Method not allowed" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const auth = segredoOk(req.query?.k);
  if (auth === null) return res.status(500).json({ error: "MCP_SECRET não configurado (mínimo 24 caracteres)." });
  if (!auth) return res.status(401).json({ error: "Não autorizado" });

  const corpo = req.body;
  if (!corpo || (typeof corpo !== "object")) return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } });
  if (Array.isArray(corpo)) {
    const resp = (await Promise.all(corpo.map(tratar))).filter(Boolean);
    return resp.length ? res.status(200).json(resp) : res.status(202).end();
  }
  const resp = await tratar(corpo);
  return resp ? res.status(200).json(resp) : res.status(202).end();
}
