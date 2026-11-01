---
nome: Universo Kosmos
area: kosmos
fase: em-producao
repo: derekzinnn/UniversoKosmos
producao: https://universo.kosmosdigital.com.br
stack: npm workspaces, Express 5, Prisma 7, Vite + React 19
deploy: vps-kosmos
responsavel: Derek
---

# Universo Kosmos

## Visão geral

- **O que é:** plataforma de onboarding de clientes da **Kosmos Inteligência Digital**. O cliente assina
  o contrato, recebe convite por e-mail, define senha e percorre uma trilha estilo sala de aula.
  A Kosmos vê quem entrou, quem assistiu o quê, quem travou e quem não começou.
- **Área:** kosmos · **Repo:** `derekzinnn/UniversoKosmos` (pasta local `universo-kosmos`)
- **Produção:** `universo.kosmosdigital.com.br` (VPS da Kosmos, containers `UniversoKosmos-*` — não mexer sem pedido)

## Stack

- npm workspaces: `packages/api` (Express 5 + Prisma 7 + PostgreSQL) e `packages/web` (Vite + React 19 +
  React Router + TanStack Query + componentes estilo shadcn)
- Vídeo: **Panda Video** com playback assinado + telemetria por heartbeat
- Testes: Vitest (testes da API precisam de Postgres real)

## Comandos

| Comando | O que faz |
|---|---|
| `npm install` | instala e roda `prisma generate` |
| `cp packages/{api,web}/.env.example …/.env` | configurar ambiente |
| `npm run db:migrate` · `db:seed` · `db:studio` | migrations · cria o primeiro SUPERADMIN (imprime credenciais) · studio |
| `npm run dev` | api :3333 + web :5173 |
| `npm test` · `npm run typecheck` · `npm run lint` · `npm run format` · `npm run build` | verificações e build |

## Arquitetura

```
packages/api/src
├── routes/        superfície HTTP e middlewares — nada mais
├── controllers/   lê request → chama UM service → formata resposta
├── services/      TODA regra de negócio e transação
├── repositories/  TODA query (recebem ScopedDb, nunca o Prisma cru)
├── db/            client Prisma, escopo de tenant, tenant guard
└── middleware/ lib/ schemas/   auth, RBAC, rate limit, Zod, erros
packages/web/src   auth/ hooks/useHeartbeat theme/ components/ pages/ lib/ index.css (tokens)
```

- **Tenant guard em 3 camadas** (a parte mais importante):
  1. `RequestContext` carregado via `AsyncLocalStorage` (`runAsContext`);
  2. `ScopedDb` aplica o filtro de tenant **depois** do que o chamador passou (tenantId forjado é substituído);
  3. extensão do Prisma lança `TenantScopeViolationError` em query não escopada — nunca "conserta" em silêncio.
  Exceções só via `runInGlobalScope(reason, …)` com motivo de uma união fechada (`grep -r "superadmin:"`).
- Audit log e garantias no banco (constraints escritas à mão nas migrations).
- `externalVideoId` nunca sai da API para cliente: URL assinada de curta duração por aula.
- Posições de aulas/módulos são contíguas 0..n-1 (desbloqueio sequencial depende disso).

## Regras do projeto

- Texto lido pelo cliente: **pt-BR**. Código, comentários, commits e identificadores: **inglês**.
- Regras de negócio só em services; controllers não decidem; repositories não têm regra.
- `LessonProgress`/`WatchEvent` têm `tenantId` desnormalizado: gravar o escalar, não via `connect` aninhado.
- `SameSite=Lax` restringe DNS — ver "Infra requirements" no contexto completo antes de mudar domínios.
- Fluxo de trabalho: uma branch `feat/…` por mudança, merge via PR no GitHub.

## Fases

Legenda: ✅ concluída · 🟡 em andamento · ⏳ próxima · 💤 backlog

| # | Fase | Status |
|---|---|---|
| 0 | Monorepo, schema, auth, convites, RBAC, audit log | ✅ |
| 1 | CRUD de conteúdo, ordenação, publicação, atribuição de trilhas | ✅ |
| 2 | Panda Video, playback assinado, player, heartbeat, desbloqueio sequencial | ✅ |
| 3 | Sala de aula do cliente e experiência de progresso | ✅ |
| 4 | Console admin: funil de onboarding, drill-down por cliente, visualizador de auditoria | ✅ |
| — | Melhorias incrementais via PRs (boas-vindas, acesso por aula, atalhos do player…) | 🟡 contínuo |

**Branch atual:** `feat/login-welcome-text` (texto de boas-vindas também na tela de login).

**Próximo passo imediato:** finalizar/mergear `feat/login-welcome-text`.
Riscos conhecidos a tratar antes de tráfego real: limitar frequência de gravação em `watch_events`;
rate limit em memória não sobrevive a 2+ instâncias (Redis adiado); advisory do `deepmerge-ts` (CLI do Prisma).

## Log de decisões

Formato: `AAAA-MM-DD — decisão — motivo` (mais recente no topo). Histórico completo em `docs/contexto-completo.md`.

- 2026-10-31 — CLAUDE.md enxugado; original (721 linhas) movido com `git mv` para `docs/contexto-completo.md` — reduzir contexto por sessão.
- Fase 0 — Rate limit por e-mail frouxo (40/h, `skipSuccessfulRequests`); limites duros por IP e IP+e-mail — evitar que limite vire arma de bloqueio.
- Fase 0 — Tripwire lança em vez de corrigir query não escopada — correção silenciosa esconde o bug.

## Documentação detalhada (ler sob demanda)

`docs/contexto-completo.md`: tenant guard e limites conhecidos · "Five things Prisma 7 does that will bite you" ·
audit log · garantias do banco · autenticação · superfície da API (Fases 0, 2, 4) · decisões por fase ·
tema claro/escuro · ponto de troca do fornecedor de vídeo · requisitos de infra · testes.
