# Market POS — Project Documentation

> Desktop point-of-sale system for a small family market. Built with Electron + React + TypeScript + SQLite.
> 

---

## Table of contents

1. [System context (C4 Level 1)](https://www.notion.so/PDV-33f1bc21102880c388a3c5654579052b?pvs=21)
2. [Container architecture (C4 Level 2)](https://www.notion.so/PDV-33f1bc21102880c388a3c5654579052b?pvs=21)
3. [Data model (ERD)](https://www.notion.so/PDV-33f1bc21102880c388a3c5654579052b?pvs=21)
4. [Design decisions](https://www.notion.so/PDV-33f1bc21102880c388a3c5654579052b?pvs=21)
5. [Design system & palette](https://www.notion.so/PDV-33f1bc21102880c388a3c5654579052b?pvs=21)
6. [User stories & acceptance criteria](https://www.notion.so/PDV-33f1bc21102880c388a3c5654579052b?pvs=21)
7. [Build order & dependencies](https://www.notion.so/PDV-33f1bc21102880c388a3c5654579052b?pvs=21)
8. [Initial agent prompt](https://www.notion.so/PDV-33f1bc21102880c388a3c5654579052b?pvs=21)

---

## System context

**Who and what interacts with the system:**

| Actor | Type | Role |
| --- | --- | --- |
| Cashier | Person | Operates sales and processes payments |
| Manager | Person | Views reports and manages product catalog |
| Mercado Pago | External system | Card (Point machine) and PIX payments via REST API |
| Prix 3 Scale | External system | Weight readings via USB/serial (serialport) |
| Receipt Printer | External system | General Power 80mm — ESC/POS commands via USB |

---

## Container architecture

**Platform:** Electron desktop app (single machine, local storage, no server).

| Container | Technology | Responsibility |
| --- | --- | --- |
| React UI | React 18 + TypeScript | Cashier screen, product catalog, reports & charts |
| Electron main process | Node.js + TypeScript | Business logic, IPC handlers, hardware coordination, API calls |
| SQLite database | better-sqlite3 | All persistent data — products, sales, payments, stock |
| Scale service | serialport (npm) | Reads stable weight from Prix 3 Toledo via USB/serial |
| Printer service | escpos (npm) | Sends ESC/POS receipt commands to General Power printer |
| Payment service | mercadopago (npm) | PIX QR generation, Point card machine API, offline PIX fallback |

**Key constraints:**

- The database is **never** accessed from the renderer process — all DB operations go through IPC handlers in the main process.
- `contextIsolation: true` and `nodeIntegration: false` enforced on all BrowserWindows.
- All IPC channels are typed end-to-end via shared TypeScript interfaces in `/shared/types.ts`.
- App works fully offline for cash sales. Only PIX and card require internet.

**Future migration path:** Node.js business logic in the main process can be extracted to a backend API server later with minimal refactoring, enabling a web or multi-machine version.

---

## Data model

```sql
CREATE TABLE IF NOT EXISTS category (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS product (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  barcode          TEXT    UNIQUE,
  unit_type        TEXT    NOT NULL CHECK(unit_type IN ('unit', 'kg')),
  price_per_unit   REAL    NOT NULL CHECK(price_per_unit >= 0),
  stock_qty        REAL    NOT NULL DEFAULT 0,
  stock_alert_qty  REAL    NOT NULL DEFAULT 0,
  category_id      INTEGER REFERENCES category(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open', 'completed', 'cancelled')),
  subtotal        REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  total           REAL NOT NULL DEFAULT 0,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS sale_item (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id         INTEGER NOT NULL REFERENCES sale(id),
  product_id      INTEGER NOT NULL REFERENCES product(id),
  quantity        REAL    NOT NULL CHECK(quantity > 0),
  unit_price      REAL    NOT NULL,
  discount_amount REAL    NOT NULL DEFAULT 0,
  total           REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS payment (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL REFERENCES sale(id),
  method        TEXT    NOT NULL CHECK(method IN ('cash', 'pix', 'card')),
  amount        REAL    NOT NULL,
  change_amount REAL    NOT NULL DEFAULT 0,
  mp_payment_id TEXT,
  status        TEXT    NOT NULL DEFAULT 'confirmed'
                  CHECK(status IN ('confirmed', 'pending')),
  paid_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stock_movement (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id),
  type       TEXT    NOT NULL CHECK(type IN ('sale', 'restock', 'correction')),
  qty_change REAL    NOT NULL,
  reason     TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

**Entity relationships:**

- `CATEGORY` → (1:N) → `PRODUCT`
- `PRODUCT` → (1:N) → `SALE_ITEM`
- `PRODUCT` → (1:N) → `STOCK_MOVEMENT`
- `SALE` → (1:N) → `SALE_ITEM`
- `SALE` → (1:N) → `PAYMENT`

**Key design decisions in the schema:**

- `unit_type` is either `"unit"` (sold by piece) or `"kg"` (sold by weight). The cashier screen uses this to decide whether to show a quantity input or trigger a scale reading.
- `sale_item.unit_price` is copied from the product at the moment of sale — price changes never affect historical records.
- `sale_item.quantity` is `REAL` (float) to handle both integer units and kg weights in the same column.
- `sale.status` has exactly three values: `open`, `completed`, `cancelled`. Sales are never deleted — only cancelled.
- `stock_movement` logs every stock change as a row, enabling full audit trail and period-based reports (e.g. "350kg of tomatoes sold in the last 7 days" = sum of movements with `type = 'sale'` filtered by date).
- `payment.mp_payment_id` stores the Mercado Pago transaction ID for reconciliation.

---

## Design decisions

### Technology choices

| Decision | Choice | Reason |
| --- | --- | --- |
| Desktop framework | Electron | Native serial port access (Prix 3), Node.js ecosystem, easy future web migration |
| Why not Tauri | Rejected | Rust backend required — no Mercado Pago SDK, thinner serialport ecosystem, steep learning curve for no practical gain on a single machine |
| Database | SQLite via better-sqlite3 | Local, zero-config, no network dependency, works offline |
| Payment provider | Mercado Pago | Official Node.js SDK, PIX + Point card machine in one API, widely used in Brazil |
| Scale integration | serialport (npm) | Prix 3 Toledo communicates via RS-232 serial protocol over USB |
| Printer integration | escpos (npm) | ESC/POS is the universal standard for thermal receipt printers; works without proprietary SDK |
| UI language | Portuguese (PT-BR) | Family market in Brazil — UI should be native, not translated |

### PIX offline fallback

When internet is unavailable at payment time, the app generates a **static PIX QR code** locally using the store's PIX key (CPF/CNPJ) with the sale total embedded. This QR is printed on the receipt. The cashier manually confirms after checking the bank app on their phone. The sale is then marked as `completed` (no `pending_payment` status — the cashier acts as the confirmation layer).

**Online flow:** Mercado Pago API → dynamic QR → customer scans → app detects confirmation → sale completes automatically.

**Offline flow:** Local static QR generated → printed on receipt → customer scans and pays → cashier checks bank app → manually confirms in app → sale completes.

### Hardware

| Hardware | Model | Integration |
| --- | --- | --- |
| Scale | Toledo Prix 3 | USB/serial via `serialport` npm package. Reads stable weight on demand. |
| Receipt printer | General Power 80mm | USB via `escpos` npm package. ESC/POS protocol. Auto-cut via guillotine. Has RJ11 port for optional cash drawer. |
| Card machine | Mercado Pago Point | REST API — app sends payment intent, machine handles customer interaction, app receives confirmation via webhook. |

---

## Design system & palette

### Dark theme tokens

| Token | Value | Usage |
| --- | --- | --- |
| Background | `#111318` | App background |
| Surface | `#22262f` | Cards, inputs |
| Panel | `#1a1d24` | Sidebar, right panel |
| Border | `#2a2d35` | Dividers, subtle borders |
| Primary (teal) | `#1D9E75` | Actions, success states, confirm buttons |
| Danger (red) | `#E24B4A` | Cancel, remove, error |
| Warning (amber) | `#EF9F27` | PIX payment, low stock alerts |
| Info (blue) | `#378ADD` | Card payment, informational |
| Text primary | `#e8e6df` | Main content |
| Text secondary | `#c2c0b6` | Supporting text |
| Text muted | `#6b6a65` | Labels, metadata |

### Typography

| Role | Size | Weight | Example |
| --- | --- | --- | --- |
| Display / total | 32px | 500 | `R$ 47,90` |
| Heading | 16px | 500 | `Venda #0042` |
| Body | 14px | 400 | `Tomate · 1.350 kg × R$ 6,90/kg` |
| Label / meta | 12px | 400 | `14:32 · Dinheiro · Troco R$ 2,10` |

### Border radius

- `4px` — tags, pills, badges
- `8px` — inputs, buttons
- `12px` — cards, panels

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `F1` | Nova venda (reset cashier screen) |
| `F2` | Focus search / barcode field |
| `F3` | Open cash payment flow |
| `F4` | Open PIX payment flow |
| `F5` | Send to Mercado Pago Point card machine |
| `F6` | Navigate to Produtos screen |
| `F7` | Navigate to Relatórios screen |
| `Esc` | Cancel current sale (with confirmation dialog) |
| `E` | Edit selected item's quantity |
| `Del` | Remove selected item |

### Cashier screen layout

Two-column split:

- **Left (flex: 1):** Search bar (always focused, F2), item list with columns (product, qty, unit price, total, actions), scale status bar at bottom.
- **Right (224px fixed):** Sale ID, running total (32px display), item count, discount row, payment method buttons (F3/F4/F5), new sale + cancel actions.

Color coding for payment buttons: teal = cash (primary action), amber border = PIX, blue border = card.

---

## User stories & acceptance criteria

Stories use MoSCoW priority: **Must** = v1 required, **Should** = important but not a v1 blocker.

---

### Sales flow

### SALE-01 · Start a new sale · Must

> As a cashier, I want to start a new sale session so that I can register a customer's items.
> 
- A "Nova venda" button (F1) is always accessible on the cashier screen.
- Clicking it clears any previous state and opens a blank sale.
- The sale's `started_at` timestamp is recorded immediately.
- Sale status is set to `open`.

---

### SALE-02 · Add item by barcode scan · Must

> As a cashier, I want to scan a product barcode so that the item is added to the sale automatically.
> 
- Scanning a barcode looks up the product in the database.
- If found, the product is added with quantity 1 and its current price.
- If the same product is scanned again, its quantity increments by 1.
- If the barcode is not found, a "Produto não encontrado" alert is shown with an option to register it.
- The running total updates immediately after each scan.

---

### SALE-03 · Add item by weight (scale) · Must

> As a cashier, I want to place an item on the scale and have its weight read automatically so that I don't have to type it manually.
> 
- After scanning a product with `unit_type = "kg"`, the app waits for a stable weight reading from the Prix 3.
- The weight (in kg, up to 3 decimal places) is shown on screen before confirmation.
- The cashier can confirm or re-read the weight.
- Price is calculated as `weight × price_per_unit` and added to the sale.
- If the scale is disconnected, an error message is shown and manual weight entry is offered.

---

### SALE-04 · Add item manually · Must

> As a cashier, I want to search for and add a product by name so that I can handle items without barcodes.
> 
- A search field (F2) allows typing a product name and shows a filtered list in real time.
- Selecting a product from the list adds it to the sale.
- For `unit_type = "kg"` products, the scale reading flow is triggered (same as SALE-03).
- For `unit_type = "unit"` products, a quantity input defaults to 1 and can be changed.

---

### SALE-05 · Remove or adjust item · Must

> As a cashier, I want to remove or adjust an item's quantity so that I can correct mistakes before payment.
> 
- Each item in the list has an edit button (E) and a remove button (Del).
- Edit opens a quantity input modal for that item.
- The total recalculates immediately after any change.
- Removing all items returns the sale to an empty state (session stays open, not cancelled).

---

### SALE-06 · Apply a discount · Should

> As a cashier, I want to apply a discount to the whole sale or a single item so that I can handle promotions or negotiations.
> 
- Discount can be entered as a percentage (e.g. 10%) or a fixed amount (e.g. R$ 5,00).
- Discount is applied at sale level or item level.
- The discount amount is shown separately so the original price remains visible.
- Stored in `sale.discount_amount` or `sale_item.discount_amount` accordingly.

---

### SALE-07 · Cancel a sale · Must

> As a cashier, I want to cancel an open sale so that I can void it if the customer leaves.
> 
- A "Cancelar" button (Esc) is available on any open sale.
- A confirmation dialog prevents accidental cancellations.
- Sale status is set to `cancelled` — never deleted.
- No stock movement is recorded for a cancelled sale.

---

### Payment

### PAY-01 · Pay with cash · Must

> As a cashier, I want to register a cash payment and calculate change so that I can close a sale quickly.
> 
- Cashier enters the amount received from the customer (F3).
- System calculates and displays change in real time as the amount is typed.
- Amount received must be ≥ sale total — the confirm button is disabled otherwise.
- On confirm: sale status → `completed`, payment record saved, stock decremented, receipt printed.

---

### PAY-02 · Pay with PIX · Must

> As a cashier, I want to generate a PIX QR code so that the customer can pay instantly from their phone — even if the internet is temporarily unavailable.
> 
- App calls Mercado Pago API to generate a dynamic PIX charge for the exact sale total (F4).
- QR code is displayed on screen for the customer to scan.
- App polls for payment confirmation and shows a success state automatically.
- On confirmation: sale completed, stock decremented, receipt printed.
- If internet is unavailable, a static PIX QR code is generated locally using the store's PIX key, with the sale total embedded. This QR is printed on the receipt so the customer can pay later.
- The offline receipt clearly states: "PIX pendente — escaneie o QR code para pagar R$ X,XX".
- A "Recebi o PIX — confirmar venda" button lets the cashier manually close the sale after checking the bank app.

---

### PAY-03 · Pay with card (Mercado Pago Point) · Must

> As a cashier, I want to send the sale total to the card machine so that the customer can pay by card without me typing the amount manually.
> 
- App sends a payment intent to the Mercado Pago Point API with the exact sale total (F5).
- The card machine prompts the customer to insert/tap their card independently.
- App receives confirmation from the API and closes the sale automatically.
- On confirmation: sale completed, stock decremented, receipt printed.
- If the machine is unreachable, an error is shown and the cashier can retry or switch method.

---

### PAY-04 · Print receipt · Must

> As a cashier, I want a receipt to be printed automatically after payment so that the customer has proof of purchase.
> 
- Receipt prints automatically on sale completion — no manual button needed.
- Receipt includes: store name, date/time, item list with quantities and prices, total, payment method, and change (if cash).
- Receipt includes a QR code for future reference.
- If printer is offline, a warning is shown and the cashier can retry manually.
- The guillotine cuts the paper after printing.

---

### Product catalog

### PROD-01 · Register a new product · Must

> As a manager, I want to register a new product so that it can be sold at the cashier.
> 
- Form requires: name, price, unit type (unit or kg), and category.
- Barcode field is optional — can be scanned or typed.
- Duplicate barcodes are rejected with a clear error message.
- Stock alert threshold can be set (defaults to 0).
- Product is immediately available for sale after saving.

---

### PROD-02 · Update product price · Must

> As a manager, I want to update a product's price so that it reflects current costs.
> 
- Price can be edited from the product list or detail screen.
- The new price applies only to future sales — past sale items are unaffected.
- `updated_at` timestamp is updated on save.

---

### PROD-03 · Receive stock · Must

> As a manager, I want to record incoming stock so that inventory levels stay accurate.
> 
- Manager selects a product and enters the quantity received.
- A `stock_movement` record is created with `type = "restock"`.
- The product's `stock_qty` is incremented accordingly.
- If the product was below the alert threshold, the low-stock alert clears.

---

### PROD-04 · Low stock alert · Should

> As a manager, I want to be alerted when a product runs low so that I can restock before it sells out.
> 
- After each sale, stock levels are checked against `stock_alert_qty`.
- Products below threshold are highlighted in the product list with a warning badge.
- A summary of low-stock products is visible on the manager dashboard.

---

### Reports

### REP-01 · Daily sales summary · Must

> As a manager, I want to see today's sales summary so that I know how the business is performing.
> 
- Dashboard shows: total sales count, total revenue, and breakdown by payment method (cash / PIX / card).
- Data reflects completed sales only — cancelled sales are excluded.
- The date can be changed to view any past day.

---

### REP-02 · Top products chart · Must

> As a manager, I want to see which products sell the most so that I can make better purchasing decisions.
> 
- Bar chart shows top 10 products ranked by revenue or quantity sold.
- Toggle between "by revenue (R$)" and "by quantity sold (units or kg)".
- Date range filter: today, last 7 days, last 30 days, custom range.

---

### REP-03 · Product quantity sold by period · Must

> As a manager, I want to see how much of a specific product was sold over a period so that I can track demand (e.g. 350kg of tomatoes in the last 7 days).
> 
- Manager selects a product and a date range.
- Total quantity sold is shown in the correct unit (kg or units).
- A line chart shows quantity sold per day within the selected range.
- Total revenue from that product in the period is also shown.

---

### REP-04 · Sales history · Should

> As a manager, I want to browse past sales so that I can investigate a specific transaction if needed.
> 
- List of all sales filterable by date range and payment method.
- Clicking a sale shows the full detail: items, quantities, prices, payment, and timestamps.
- Cancelled sales are shown with a distinct visual indicator.
- A past receipt can be reprinted from the sale detail screen.

---

## Build order & dependencies

| Phase | Modules | Depends on | Notes |
| --- | --- | --- | --- |
| 1 | Electron setup, SQLite schema, design system | Nothing | Fully independent — can be built in any order or in parallel |
| 2 | Product catalog, cashier screen (SALE-01–05), cash payment (PAY-01) | Phase 1 | Product catalog must come before cashier screen. Cash payment gives a complete testable loop. |
| 3 | Scale (SALE-03), printer (PAY-04), Mercado Pago PIX + card (PAY-02, 03) | Phase 2 | All require physical hardware or external credentials. Stubbed in phase 1. |
| 4 | Reports (REP-01–04) | Phase 3 | Meaningful only after real sales data exists. |

**After phase 2, the app is usable for cash sales in the market.** Phases 3 and 4 add on top of a working baseline.

---

## Initial agent prompt

Use this prompt to bootstrap the Electron project with the full database schema and project structure.

---

**Role**

You are an expert Electron + React + TypeScript developer. You write clean, well-structured code with clear separation of concerns between the renderer process (React UI) and the main process (Node.js business logic).

**Goal**

Bootstrap a desktop POS (point of sale) application for a small family market in Brazil. Set up the full project structure and database schema so the project is ready for feature development.

**Tech stack**

- Electron (latest stable) with contextIsolation and preload scripts
- React 18 + TypeScript (renderer process)
- better-sqlite3 (SQLite — main process only, never renderer)
- electron-builder for packaging
- Vite as the bundler for the renderer
- Tailwind for styles
- serialport (for Prix 3 Toledo scale — USB/serial, to be integrated later)
- escpos (for General Power 80mm thermal printer — USB, to be integrated later)
- mercadopago (official Node.js SDK — to be integrated later)
- ESLint + Prettier for code style

**Project structure**

```
/src
  /main
    index.ts         ← app entry, window creation
    db.ts            ← SQLite connection and schema setup
    ipc.ts           ← all IPC handlers
    /services
      scale.ts       ← Prix 3 serial port service (stub)
      printer.ts     ← escpos printer service (stub)
      payment.ts     ← Mercado Pago service (stub)
  /renderer
    main.tsx         ← React entry point
    App.tsx          ← root component + router
    /pages
      Sale.tsx       ← cashier screen (stub)
      Catalog.tsx    ← product catalog (stub)
      Reports.tsx    ← reports dashboard (stub)
    /components      ← shared UI components
  /shared
    types.ts         ← TypeScript interfaces shared between main and renderer
/preload
  index.ts           ← contextBridge API exposure
```

**Database schema**

Create the SQLite schema in `db.ts` using better-sqlite3. Run with `db.exec()` on app startup. Use the schema defined in the Data Model section of this document exactly. Enable WAL mode and foreign keys on connection:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

**IPC bridge**

Expose a typed `window.api` object via contextBridge in `preload/index.ts`. Include these channel stubs:

- `sale:create` → creates a new open sale, returns sale id
- `sale:addItem` → adds a product to a sale
- `sale:removeItem` → removes an item from a sale
- `sale:complete` → marks sale as completed
- `sale:cancel` → marks sale as cancelled
- `product:list` → returns all products
- `product:create` → inserts a new product
- `product:update` → updates a product
- `payment:create` → inserts a payment record

Each channel must have a corresponding TypeScript interface in `/shared/types.ts`.

**Seed data**

Insert on first run (check if category table is empty):

Categories: `"Hortifruti"`, `"Laticínios"`, `"Limpeza"`, `"Bebidas"`, `"Mercearia"`

Sample products:

- Tomate · `unit_type: "kg"` · `price: 6.90` · category: Hortifruti
- Leite Integral 1L · `barcode: "7891000100103"` · `unit_type: "unit"` · `price: 4.50` · category: Laticínios
- Arroz 5kg · `barcode: "7896006700916"` · `unit_type: "unit"` · `price: 24.90` · category: Mercearia

**Constraints**

- Never access the database from the renderer process — all DB access goes through IPC handlers in the main process.
- Use `contextIsolation: true` and `nodeIntegration: false` in the BrowserWindow config.
- All IPC handlers must be typed end-to-end using the shared types.
- Service files (`scale.ts`, `printer.ts`, `payment.ts`) should export stub classes with TODO comments marking where real implementation goes.
- The app must start and display the Sale page without errors before you consider the task done.
- Include a `README.md` with setup instructions: `npm install`, `npm run dev`, `npm run build`.
