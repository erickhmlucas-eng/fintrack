/* Teste local do MCP com um "banco" em memória: node scripts/test-mcp.mjs */
import assert from "node:assert/strict";

process.env.MCP_SECRET = "segredo-de-teste-com-mais-de-24-caracteres";
let versao = 1;
let blob = {
  version: 2, settings: { emergencyGoal: 10000, reservaAncora: { emergencia: { valor: 8882.32, data: "2026-10-01" }, pessoal: { valor: 0, data: null } } },
  accounts: [
    { id: "c6", nome: "C6", temCartao: true, fechamento: 4, vencimento: 10, limite: 1150, saldoInicial: 1000, ancoraData: "2026-10-01" },
    { id: "nu", nome: "Nubank", temCartao: true, fechamento: 4, vencimento: 10, limite: 1200, saldoInicial: 0, ancoraData: "2026-10-01" },
    { id: "pt", nome: "Porto", temCartao: true, fechamento: 30, vencimento: 5, limite: 4000, saldoInicial: 0 },
  ],
  cats: [{ id: "al", nome: "Alimentação", icon: "🍔" }, { id: "ga", nome: "Gasolina", icon: "⛽" }, { id: "ou", nome: "Outros", icon: "📌" }],
  months: {}, dividas: [],
};
globalThis.__FINTRACK_TEST_STORE = {
  async load() { return { value: JSON.parse(JSON.stringify(blob)), updatedAt: String(versao) }; },
  async save(v, prev) { if (prev !== String(versao)) return false; blob = JSON.parse(JSON.stringify(v)); versao++; return true; },
};
const { default: handler } = await import("../api/mcp.js");

const r2 = (v) => Math.round(v * 100) / 100;
const chamar = async (corpo, k = process.env.MCP_SECRET, via = "query") => {
  const r = { code: 0, body: undefined, headers: {} };
  const res = { setHeader(n, v) { r.headers[n] = v; }, status(c) { r.code = c; return res; }, json(b) { r.body = b; return res; }, end() { return res; } };
  const req = via === "header" ? { method: "POST", query: {}, headers: { authorization: `Bearer ${k}` }, body: corpo } : { method: "POST", query: { k }, headers: {}, body: corpo };
  await handler(req, res);
  return r;
};
const tool = async (name, args) => {
  const r = await chamar({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const out = r.body.result; return { erro: !!out.isError, texto: out.content[0].text };
};

// protocolo
assert.equal((await chamar({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).body.result.protocolVersion, "2025-06-18");
assert.equal((await chamar({ jsonrpc: "2.0", method: "notifications/initialized" })).code, 202);
assert.equal((await chamar({ jsonrpc: "2.0", id: 2, method: "tools/list" })).body.result.tools.length, 9);
// autenticação
assert.equal((await chamar({ jsonrpc: "2.0", id: 1, method: "ping" }, "errado")).code, 401);
assert.equal((await chamar({ jsonrpc: "2.0", id: 1, method: "ping" }, process.env.MCP_SECRET, "header")).code, 200);
assert.equal((await chamar({ jsonrpc: "2.0", id: 1, method: "ping" }, "errado", "header")).code, 401);

// confirmação obrigatória
let t = await tool("fintrack_lancar_gasto", { descricao: "Cortineiro", valor: 20, categoria: "outros", conta: "c6" });
assert.ok(t.erro && /confirmação/.test(t.texto));
assert.equal(versao, 1);

// gasto débito
t = await tool("fintrack_lancar_gasto", { descricao: "Mercado", valor: 85.01, categoria: "alimentacao", conta: "C6", data: "2026-10-12", confirmado: true });
assert.ok(!t.erro, t.texto);
assert.equal(JSON.parse(t.texto).saldo_da_conta_agora, 914.99);
// duplicado
t = await tool("fintrack_lancar_gasto", { descricao: "Mercado", valor: 85.01, categoria: "alimentacao", conta: "C6", data: "2026-10-12", confirmado: true });
assert.ok(t.erro && /igual/.test(t.texto));
// nomes inexistentes
t = await tool("fintrack_lancar_gasto", { descricao: "x", valor: 1, categoria: "xyz", conta: "C6", confirmado: true });
assert.ok(t.erro && /Opções/.test(t.texto));

// crédito: fechamento dia 4; compra dia 18/10 no Santander-like (C6) cai na fatura de novembro; 2x
t = await tool("fintrack_lancar_credito", { descricao: "Ingresso", valor: 462.46, categoria: "outros", cartao: "Nubank", parcelas: 2, data: "2026-10-18", confirmado: true });
assert.ok(!t.erro, t.texto);
let j = JSON.parse(t.texto);
assert.equal(j.lancado.cai_na_fatura_de, "Novembro 2026");
assert.equal(blob.months["2026-11"].gastos[0].valor + blob.months["2026-12"].gastos[0].valor, 462.46);
// Porto fecha dia 30: compra dia 31 vai para o mês seguinte
t = await tool("fintrack_lancar_credito", { descricao: "Tênis", valor: 239, categoria: "outros", cartao: "Porto", data: "2026-10-31", confirmado: true });
assert.equal(JSON.parse(t.texto).lancado.cai_na_fatura_de, "Novembro 2026");

// entrada e transferência
t = await tool("fintrack_lancar_entrada", { fonte: "Alex", valor: 500, conta: "Nubank", data: "2026-10-31", confirmado: true });
assert.equal(JSON.parse(t.texto).saldo_da_conta_agora, 500);
t = await tool("fintrack_transferir", { de: "Nubank", para: "C6", valor: 500, data: "2026-10-31", confirmado: true });
j = JSON.parse(t.texto); assert.equal(j.saldo_origem_agora, 0); assert.equal(j.saldo_destino_agora, 1414.99);

// leitura
t = await tool("fintrack_resumo", { mes: "2026-10" });
j = JSON.parse(t.texto); assert.equal(j.entradas, 500); assert.equal(j.total_nas_contas, 1414.99);
t = await tool("fintrack_extrato", { mes: "2026-10", tipo: "gastos" });
assert.equal(JSON.parse(t.texto).gastos.length, 2);

// conflito de versão: outro escritor muda o bloco no meio → tenta de novo e conclui
const store = globalThis.__FINTRACK_TEST_STORE; const orig = store.load; let primeira = true;
store.load = async function () { const r = await orig(); if (primeira) { primeira = false; versao++; } return r; };
t = await tool("fintrack_lancar_entrada", { fonte: "Teste", valor: 10, conta: "C6", data: "2026-10-31", confirmado: true });
assert.ok(!t.erro, t.texto);
// ─── editar e apagar ───
const saldoC6 = async () => JSON.parse((await tool("fintrack_resumo", { mes: "2026-10" })).texto).contas.find((c) => c.nome === "C6").saldo;
t = await tool("fintrack_extrato", { mes: "2026-10", tipo: "gastos" });
const gMercado = JSON.parse(t.texto).gastos.find((g) => g.descricao === "Mercado");
assert.ok(gMercado.id);
// sem confirmação / sem campos / id inexistente
assert.ok((await tool("fintrack_editar_lancamento", { id: gMercado.id, valor: 90 })).texto.includes("confirmação"));
assert.ok((await tool("fintrack_editar_lancamento", { id: gMercado.id, confirmado: true })).texto.includes("Informe o que mudar"));
assert.ok((await tool("fintrack_editar_lancamento", { id: "nao-existe", valor: 1, confirmado: true })).texto.includes("Não achei"));
// editar valor e categoria
let s0 = await saldoC6();
t = await tool("fintrack_editar_lancamento", { id: gMercado.id, valor: 90.01, categoria: "gasolina", confirmado: true });
assert.ok(!t.erro, t.texto); j = JSON.parse(t.texto);
assert.equal(j.antes.valor, 85.01); assert.equal(j.depois.valor, 90.01); assert.equal(j.depois.categoria, "Gasolina");
assert.equal(r2(s0 - (await saldoC6())), 5);
// mesma coisa de novo: nada mudou
assert.ok((await tool("fintrack_editar_lancamento", { id: gMercado.id, valor: 90.01, confirmado: true })).texto.includes("Nada mudou"));
// mudar a data para outro mês move o lançamento
t = await tool("fintrack_editar_lancamento", { id: gMercado.id, data: "2026-11-02", confirmado: true });
j = JSON.parse(t.texto); assert.ok(j.movido_para.includes("Novembro"));
assert.ok(blob.months["2026-11"].gastos.some((g) => g.id === gMercado.id));
assert.ok(!blob.months["2026-10"].gastos.some((g) => g.id === gMercado.id));
// crédito: cartão não muda; fatura_mes move
t = await tool("fintrack_extrato", { mes: "2026-11", tipo: "credito" });
const cred = JSON.parse(t.texto).credito;
const tenis = cred.find((g) => g.descricao === "Tênis");
assert.ok((await tool("fintrack_editar_lancamento", { id: tenis.id, conta: "C6", confirmado: true })).texto.includes("cartão"));
t = await tool("fintrack_editar_lancamento", { id: tenis.id, fatura_mes: "2026-12", valor: 249, confirmado: true });
assert.ok(!t.erro, t.texto);
assert.ok(blob.months["2026-12"].gastos.some((g) => g.id === tenis.id && g.valor === 249));
// apagar sem confirmação; apagar uma parcela; apagar o grupo
assert.ok((await tool("fintrack_apagar_lancamento", { id: tenis.id })).texto.includes("confirmação"));
const ing = cred.find((g) => g.descricao.startsWith("Ingresso (1/2)"));
t = await tool("fintrack_apagar_lancamento", { id: ing.id, confirmado: true });
j = JSON.parse(t.texto); assert.equal(j.apagado.length, 1); assert.ok(j.aviso.includes("parcelada"));
t = await tool("fintrack_extrato", { mes: "2026-12", tipo: "credito" });
const ing2 = JSON.parse(t.texto).credito.find((g) => g.descricao.startsWith("Ingresso (2/2)"));
assert.ok(ing2);
t = await tool("fintrack_apagar_lancamento", { id: ing2.id, grupo: true, confirmado: true });
assert.equal(JSON.parse(t.texto).apagado.length, 1);
// apagar o tênis
t = await tool("fintrack_apagar_lancamento", { id: tenis.id, confirmado: true });
assert.ok(!t.erro); assert.ok(!Object.values(blob.months).some((mm) => mm.gastos.some((g) => g.id === tenis.id)));
// vínculos: parcela de dívida desmarca, fixa volta a pendente, antecipação e dívida no cartão são bloqueadas
blob.dividas = [{ id: "dv1", nome: "Carro", parcelas: 48, valorParcela: 100, total: 4800, inicioMes: "2026-01", pagos: ["2026-11"], quitada: false }];
const m11 = blob.months["2026-11"];
m11.fixas = [{ id: "f1", nome: "Luz", valor: 350, pago: true, gastoId: "gfix" }];
m11.gastos.unshift({ id: "gdv", catId: "ou", descricao: "Parcela Carro", valor: 100, forma: "pix", accId: "c6", data: "2026-11-01", dividaId: "dv1", ts: 1 });
m11.gastos.unshift({ id: "gfix", catId: "ou", descricao: "Luz", valor: 350, forma: "pix", accId: "c6", data: "2026-11-06", fixaId: "f1", ts: 1 });
m11.gastos.unshift({ id: "gdc", catId: "ou", descricao: "Carro no cartão", valor: 100, forma: "credito", accId: "nu", data: "", dividaId: "dv1", ts: 1 });
m11.gastos.unshift({ id: "gan", catId: "ou", descricao: "Antecipação", valor: 500, forma: "pix", accId: "c6", data: "2026-11-02", dividaId: "dv1", antecip: true, ts: 1 });
assert.ok((await tool("fintrack_apagar_lancamento", { id: "gdc", confirmado: true })).texto.includes("Dívidas"));
assert.ok((await tool("fintrack_editar_lancamento", { id: "gan", valor: 1, confirmado: true })).texto.includes("antecipação"));
t = await tool("fintrack_apagar_lancamento", { id: "gdv", confirmado: true });
assert.ok(JSON.parse(t.texto).aviso.includes("dívida")); assert.deepEqual(blob.dividas[0].pagos, []);
t = await tool("fintrack_apagar_lancamento", { id: "gfix", confirmado: true });
assert.equal(blob.months["2026-11"].fixas[0].pago, false);
// entrada: editar e apagar
t = await tool("fintrack_extrato", { mes: "2026-10", tipo: "entradas" });
const ent = JSON.parse(t.texto).entradas.find((e) => e.fonte === "Teste");
t = await tool("fintrack_editar_lancamento", { id: ent.id, fonte: "Teste 2", valor: 12, confirmado: true });
assert.equal(JSON.parse(t.texto).depois.fonte, "Teste 2");
t = await tool("fintrack_apagar_lancamento", { id: ent.id, confirmado: true });
assert.equal(JSON.parse(t.texto).apagado[0].fonte, "Teste 2");
console.log("OK: todos os testes passaram");
