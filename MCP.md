# FinTrack MCP

Deixa o Claude (conversa de consultoria) ler seus números e lançar no app, **só depois do seu "pode lançar"**.

## O que ele faz
| Ferramenta | Para quê |
|---|---|
| `fintrack_cadastros` | contas, cartões (fechamento, vencimento, limite) e categorias |
| `fintrack_resumo` | saldo por conta, entradas, saídas, faturas, reservas, dívidas |
| `fintrack_extrato` | lançamentos de um mês |
| `fintrack_lancar_gasto` | débito, Pix, dinheiro, boleto |
| `fintrack_lancar_credito` | compra no cartão, com parcelas; cai na fatura certa |
| `fintrack_lancar_entrada` | salário, freela, reembolso |
| `fintrack_transferir` | entre suas contas |

Toda ferramenta de escrita exige `confirmado=true`, e o Claude só manda isso depois de mostrar a tabelinha e você confirmar. Lançamentos idênticos são barrados (`forcar=true` libera).

## Instalar (uma vez)
1. **Vercel → Settings → Environment Variables** (Production), crie:
   - `MCP_SECRET`: texto aleatório com 32+ caracteres (ex.: `openssl rand -hex 24`).
   - `SUPABASE_URL`: a mesma URL do app.
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API → `service_role`. **Segredo: só na Vercel, nunca no código nem no chat.**
   - `FINTRACK_USER_ID`: Supabase → Authentication → Users → o seu `id` (uuid).
2. Faça o deploy (merge do branch). A URL do MCP fica: `https://SEU-APP.vercel.app/api/mcp?k=SEU_MCP_SECRET`
3. **claude.ai/customize/connectors → adicionar conector personalizado**, colando essa URL.
4. Abra uma conversa nova (o conector só é lido no início da sessão).

## Segurança
- A URL com `?k=` é a senha do MCP: quem tiver a URL consegue ler e lançar. Não compartilhe; para trocar, mude `MCP_SECRET` na Vercel e atualize o conector.
- O segredo na URL pode aparecer em logs da Vercel e no histórico do navegador. O conector do claude.ai não envia cabeçalho fixo, então ele precisa da URL. Para qualquer outro cliente (testes, scripts), use `Authorization: Bearer <segredo>`, que o servidor também aceita e não deixa rastro na URL. Se achar que vazou, troque o `MCP_SECRET`.
- A chave `service_role` ignora o RLS do Supabase. O código só mexe no usuário de `FINTRACK_USER_ID`.
- Confira que o RLS está ligado em `user_data` (Supabase → Authentication → Policies), porque o repositório é público e a chave `publishable` está nele.

## Convivência com o app
O app salva o bloco inteiro; o MCP só salva se o bloco não mudou desde a leitura (checagem por `updated_at`, com nova tentativa). No app, ao voltar para a aba ele recarrega os dados do servidor (se não houver salvamento em andamento).

## Teste local
`npm install && node scripts/test-mcp.mjs`
