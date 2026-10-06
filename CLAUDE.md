# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`ioBroker.kiwi` is an ioBroker adapter that exposes ioBroker as an **MCP server** (for Claude Desktop, VS Code, … ) and
ships an **integrated chat bot** (OpenAI or Gemini) reachable through the `kiwi.X.chat.prompt` / `kiwi.X.chat.response` states.
States get a free-text description (custom settings) that is embedded into a **vector store** for semantic search.

This repo is a **fork** (`michiproep/ioBroker.kiwi`) of the unmaintained upstream `Holger-Will/ioBroker.kiwi`.
The npm package `iobroker.kiwi` is still owned by the upstream author (npm latest = 0.4.2), so the fork cannot publish
to npm under that name yet. See [CONTRIBUTING.md](CONTRIBUTING.md#releasing).

**Current maintenance goal:** keep the adapter and its dependencies current and running on the latest ioBroker
(js-controller, admin, Node.js LTS). Feature work on AI/vector stores is exploratory — see the
"AI and vector store integration status" section in [README.md](README.md).

## Architecture

The code runs in **two different processes**:

| Entry                                                                | Runs in                     | Purpose                                                                                                |
| -------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `main.js` → `adapter.mjs` (`McpServer` class)                        | the kiwi adapter process    | indexes object descriptions into the vector DB on `objectChange`, runs the `Chatbot` for `chat.prompt` |
| `lib/web.js` → `lib/mcp-web.mjs` (`webExtension` in io-package.json) | the **web adapter** process | serves the MCP HTTP endpoint `/kiwi/<instance>/mcp` and the static UI in `lib/public/`                 |

Key modules:

- `lib/api_adapter.mjs` – `ioBrokerAdapterApi`: the single implementation layer that all MCP tools call. Owns its own vector DB instance.
- `lib/tools/*.mjs` – one MCP tool per file, aggregated in `lib/tools/allTools.mjs`. Shape:
  `{ name, desc, params /* zod shape */, call: (API) => async (args) => ({ content: [{ type: "text", text }] }) }`.
  Exposed tool names are the `name` field, not the file name (e.g. `getState.mjs` → `getIobrokerState`).
- `lib/ai-provider.mjs` – provider selection (`native.aiProvider`: `openai` default, `gemini`): default models, vector store factory, model list for the settings dropdown.
- `lib/chatbot.mjs` – chat bot wired to the tools through an in-process MCP transport (`lib/mcp-direct-transport.mjs`);
  `lib/chat-engines.mjs` holds `OpenAiChat` (Responses API + function calling loop) and `GeminiChat` (`mcpToTool`).
- Vector stores, one SQLite file per provider (different dimensions):
    - `lib/openai-sqlite-vectorize.mjs` – OpenAI `text-embedding-3-large` (3072 dims) + `sqlite-vec`.
    - `lib/sqlite-vectorize.mjs` – Gemini `gemini-embedding-001` (768 dims) + `sqlite-vec`.
    - `lib/openai-postgres-vectorize.mjs` – prepared only: OpenAI embeddings + Postgres/pgvector (no config UI).
- `admin/jsonConfig.json` (instance settings), `admin/jsonCustom.json` (per-state "description" custom setting), `admin/i18n/*`.

Gotchas:

- The vector DB is opened up to three times on the same SQLite file (adapter, chatbot API, web extension). WAL mode is on.
- The SQLite vector table dimension is fixed at creation. Changing the embedding model _within_ a provider requires
  deleting that provider's `<iobroker-data>/kiwi.X/*.sqlite`; on startup `indexMissingDescriptions()` re-indexes.
- The web extension reads kiwi's instance object itself, so `apiKey` arrives encrypted there and is decrypted with
  `adapter.decrypt` (see `decryptIfNeeded` in `lib/mcp-web.mjs`).
- Live OpenAI tests in `lib/ai-provider.test.js` run only with `OPENAI_API_KEY` (env or `.env`, which is git-ignored).
- Never log the API key; it is `protectedNative`/`encryptedNative`.

## Commands

```sh
npm install             # use `npm ci` in CI; keep package-lock.json in sync with package.json
npm run lint            # ESLint
npm run check           # tsc type check (JS, noEmit)
npm test                # unit + package tests (mocha)
npm run test:integration # starts a real js-controller + adapter (slow, needs network)
npx @iobroker/repochecker https://github.com/michiproep/ioBroker.kiwi --local   # ioBroker compliance check
npm run release -- patch|minor|major   # see CONTRIBUTING.md; only on an up-to-date main
```

## Conventions

- ESM (`.mjs`) for adapter code; `main.js`/`lib/web.js` are CommonJS shims required by ioBroker.
- Tabs, double quotes, semicolons (Prettier + ESLint). Match the surrounding code.
- Use `node:` prefixes for built-ins and `this.setTimeout`/`adapter.setTimeout` instead of global timers (repochecker rules).
- Any new admin label/tooltip needs an entry in `admin/i18n/en.json` (run `npm run translate` for other languages).
- User-facing changes go into README.md under `### **WORK IN PROGRESS**` in the Changelog — the release script turns that into the version entry and the `common.news` in io-package.json. Do not edit `version` or `common.news` by hand.

## Git workflow

- `main` is always releasable. Never commit directly to `main`.
- Branch per change: `feat/…`, `fix/…`, `chore/…` (deps, tooling, CI), `docs/…`. Open a PR to `main`; CI must be green.
- `main` has a ruleset (PR required, `check-and-lint` + all `adapter-tests` required). Auto-merge is enabled for the
  repository; merging stays the user's decision (enable it per PR only when asked).
- Always open PRs against `main`, not stacked on another PR branch: merging a stacked PR lands it in the base branch,
  not in `main`.
- Small, focused commits with imperative messages (`fix: await getHistory call`).
- Releases are tags `vX.Y.Z` created by the release script on `main` — never hand-made tags.
- Tags `v0.5.0` and `v0.5.1` are manual snapshots of the upstream state (commit 16a0819). The version in
  package.json/io-package.json was aligned to 0.5.1 afterwards, so the release script continues from there
  (`npm run release -- minor` → 0.6.0). The release script only accepts bump keywords, not explicit versions.
