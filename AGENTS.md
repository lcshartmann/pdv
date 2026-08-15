# AGENTS.md — Market POS

## What this is
Desktop POS (Electron + React + TypeScript + SQLite). Single-machine, no server. Portuguese UI only.

## Two separate compile targets
| Target | Config | Module | Output |
|--------|--------|--------|--------|
| Renderer | `tsconfig.json` | `ESNext` / `Bundler` | Vite → `dist/renderer/` |
| Main + Preload | `tsconfig.main.json` | `CommonJS` / `Node` | `tsc` → `dist/src/main/`, `dist/preload/` |

**Never mix the two configs.** Main process code must use `tsconfig.main.json` (CommonJS). Renderer uses `tsconfig.json` (ESNext). `src/shared/` is included in both.

## Entry points
- `src/main/index.ts` — Electron app bootstrap (creates window, starts DB, services, IPC)
- `preload/index.ts` — `contextBridge` exposure (compiled with main config)
- `src/renderer/main.tsx` — React entry point
- `index.html` — loads `src/renderer/main.tsx`

## Dev workflow

```bash
# One-shot (spawns 3 concurrent processes, wait-on handles ordering)
npm run dev
# ├─ dev:renderer   → vite dev server on :5173
# ├─ dev:main       → tsc -p tsconfig.main.json --watch
# └─ dev:electron   → wait-on tcp:5173 dist/src/main/index.js dist/preload/index.js
#                       then launches electron with VITE_DEV_SERVER_URL=http://localhost:5173
```

`npm run dev` is the only way to start the app in development — the three processes must run together.

## Build

```bash
npm run build    # clean → build:renderer → build:main
npm run build:renderer   # vite build (outputs to dist/renderer, emptyOutDir: false)
npm run build:main       # tsc -p tsconfig.main.json
```

**Important:** `vite.config.ts` sets `emptyOutDir: false` so `dist/renderer` is not wiped during build. The `clean` script removes all of `dist/` first.

## Verification

```bash
npm run typecheck    # runs BOTH tsconfig.json and tsconfig.main.json --noEmit
npm run lint         # eslint . --ext .ts,.tsx
```

No test script exists yet. The project has no test runner configured.

## Native dependencies
`postinstall` runs `electron-builder install-app-deps`. This is required after `npm install` because `better-sqlite3` and `serialport` have native bindings.

## Architecture hard rules

- **Renderer never touches the database.** All DB access goes through IPC handlers in `src/main/ipc.ts`.
- **`contextIsolation: true` and `nodeIntegration: false`** are mandatory in `BrowserWindow` config. Never change them.
- **All IPC channels must be typed end-to-end.** Every channel must exist in `src/shared/types.ts`, `preload/index.ts`, and `src/main/ipc.ts`.
- **No `any` in shared code.** `src/shared/types.ts` is consumed by both compile targets.
- **Vite aliases:** `@renderer` → `src/renderer/`, `@shared` → `src/shared/`. These only work in renderer code, not in main/preload.

## Database
- SQLite via `better-sqlite3`, main process only.
- File stored at `app.getPath("userData")/market-pos.db` — not in the repo.
- Singleton `dbInstance` in `src/main/db.ts`. Tests will need to reset it.
- WAL mode and foreign keys enabled in schema.
- Seed data runs on first boot if `category` table is empty.

## Stubs
Two services are not implemented:
- `src/main/services/printer.ts` — `printReceipt()` does nothing (TODO: escpos)
- `src/main/services/payment.ts` — `createPixCharge()` and `sendToPointMachine()` throw (TODO: mercadopago)

## Style

- **Prettier:** double quotes, semicolons, no trailing commas (`.prettierrc`)
- **ESLint:** `eslint:recommended` + `@typescript-eslint/recommended` + `react-hooks/recommended` + `react-refresh/recommended` + `prettier`
- **Tailwind:** custom theme tokens in `tailwind.config.js` (colors, font sizes, border radius). Prefer named tokens over arbitrary values like `bg-[#hex]`.
- **All UI text in Portuguese (PT-BR).** Never use English in user-facing strings.
- **Currency:** `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`
- **Custom scrollbar:** `custom-scrollbar` class on scrollable containers.

## State management
`src/renderer/store/uiStore.ts` is a global mutable store using `useSyncExternalStore`. Not Redux or Zustand. Tests must reset state to `initialState`.

## Keyboard shortcuts
| Key | Action |
|-----|--------|
| F1 | Nova venda / navigate to Sale |
| F2 | Focus search |
| F3 | Open cash payment |
| F6 | Navigate to Produtos |
| F7 | Navigate to Relatórios |
| F8 | Novo produto (Catalog only) |
| Esc | Close modal / cancel sale |

Modals set `document.body.dataset.posModalOpen = "true"` to suppress navigation shortcuts.

## Important files
- `src/shared/types.ts` — IPC contract. Touching this affects both main and renderer.
- `src/main/ipc.ts` — All business logic and DB access. Changes here require matching changes in `preload/index.ts` and `src/shared/types.ts`.
- `tailwind.config.js` — Source of truth for design tokens.
- `market-pos-docs.md` — Full project documentation (user stories, architecture decisions, data model).
- `scale.md` — Prix 3 Toledo serial protocol specification.

## What to ignore
- `mockup/` — HTML mockups, not source code
- `payment_flows.html` — Visual mockup only
- `agents/` — If it exists, contains subagent context files
