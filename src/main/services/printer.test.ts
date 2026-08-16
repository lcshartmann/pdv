/**
 * Tests for PrinterService — standalone file without a test runner.
 *
 * To run: npx ts-node -P tsconfig.main.json src/main/services/printer.test.ts
 * Or integrate with vitest/jest later by replacing the `test`/`expect` helpers.
 */
import Database from "better-sqlite3";

// ─── Minimal test harness ───────────────────────────────────────
interface AssertionError extends Error {
  name: "AssertionError";
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): void {
  void (async () => {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL  ${name}`);
      console.error(`        ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  })();
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    const error = new Error(message) as AssertionError;
    error.name = "AssertionError";
    throw error;
  }
}

// ─── Mocks ──────────────────────────────────────────────────────
const mockPrinter = {
  font: () => mockPrinter,
  align: () => mockPrinter,
  style: () => mockPrinter,
  size: () => mockPrinter,
  text: (..._args: unknown[]) => mockPrinter,
  println: () => mockPrinter,
  newLine: () => mockPrinter,
  drawLine: () => mockPrinter,
  table: () => mockPrinter,
  tableCustom: () => mockPrinter,
  qrimage: (_content: string, _options: unknown | null, callback: (err: Error | null) => void) => {
    callback(null);
    return mockPrinter;
  },
  cut: () => mockPrinter,
  close: (callback?: (err?: Error) => void) => {
    if (callback) callback();
  },
  flush: (callback?: (err?: Error) => void) => {
    if (callback) callback();
  },
  encode: () => mockPrinter
};

const escposMock = {
  Printer: Object.assign(
    function () {
      return mockPrinter;
    },
    {
      create: async () => mockPrinter
    }
  )
};

// We override require cache before importing the service
const Module = require("module");
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id: string) {
  if (id === "escpos") return escposMock;
  if (id === "escpos-usb") {
    return function () {
      return {
        open: (cb: (err?: Error) => void) => {
          if (cb) cb();
        },
        write: (_data: Buffer, cb: (err?: Error) => void) => {
          if (cb) cb();
        },
        close: (cb?: (err?: Error) => void) => {
          if (cb) cb();
        }
      };
    };
  }
  if (id === "escpos-network") {
    return function () {
      return {
        open: (cb: (err?: Error) => void) => {
          if (cb) cb();
        },
        write: (_data: Buffer, cb: (err?: Error) => void) => {
          if (cb) cb();
        },
        close: (cb?: (err?: Error) => void) => {
          if (cb) cb();
        }
      };
    };
  }
  if (id === "../db") {
    return { getDb: () => testDb };
  }
  return originalRequire.apply(this, arguments as unknown as [string]);
};

// ─── Schema ─────────────────────────────────────────────────────
const mockSchema = `
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
  stock_qty        REAL    NOT NULL DEFAULT 0 CHECK(stock_qty >= 0),
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
`;

let testDb: Database.Database;
let PrinterServiceCtor: typeof import("./printer").PrinterService;

function seedTestData(): number {
  testDb.prepare("INSERT INTO category (name) VALUES ('Test')").run();
  const { id: categoryId } = testDb.prepare("SELECT id FROM category WHERE name = 'Test'").get() as {
    id: number;
  };

  testDb
    .prepare(
      "INSERT INTO product (name, barcode, unit_type, price_per_unit, stock_qty, stock_alert_qty, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run("Arroz 5kg", "123", "unit", 24.9, 10, 2, categoryId);

  testDb
    .prepare(
      "INSERT INTO product (name, barcode, unit_type, price_per_unit, stock_qty, stock_alert_qty, category_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run("Leite 1L", "456", "unit", 4.5, 20, 5, categoryId);

  testDb
    .prepare(
      "INSERT INTO sale (status, subtotal, discount_amount, total, completed_at) VALUES (?, ?, ?, ?, datetime('now'))"
    )
    .run("completed", 33.9, 0, 33.9);

  const { id: saleId } = testDb.prepare("SELECT id FROM sale WHERE status = 'completed'").get() as {
    id: number;
  };

  testDb
    .prepare(
      "INSERT INTO sale_item (sale_id, product_id, quantity, unit_price, discount_amount, total) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(saleId, 1, 1, 24.9, 0, 24.9);

  testDb
    .prepare(
      "INSERT INTO sale_item (sale_id, product_id, quantity, unit_price, discount_amount, total) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(saleId, 2, 2, 4.5, 0, 9.0);

  testDb
    .prepare(
      "INSERT INTO payment (sale_id, method, amount, change_amount, status) VALUES (?, ?, ?, ?, ?)"
    )
    .run(saleId, "cash", 33.9, 6.1, "confirmed");

  return saleId;
}

// ─── Tests ────────────────────────────────────────────────────────
console.log("Running PrinterService tests...\n");

// We must import after setting up mocks and DB
testDb = new Database(":memory:");
testDb.exec(mockSchema);
seedTestData();
const testPrinterConfig = () => ({
  type: "usb" as const,
  address: "",
  storeName: "Mercado Teste",
  receiptFooter: "Obrigado pela preferência!\nVolte sempre!",
  receiptShowQr: true,
  storeCnpj: "",
  storeAddress: "",
  storePhone: ""
});

PrinterServiceCtor = require("./printer").PrinterService;

test("imprime comprovante com itens, totais, pagamento e troco", async () => {
  const service = new PrinterServiceCtor(testPrinterConfig);
  const sale = testDb.prepare("SELECT id FROM sale WHERE status = 'completed'").get() as { id: number };

  const texts: string[] = [];
  const originalText = mockPrinter.text;
  mockPrinter.text = (...args: unknown[]) => {
    texts.push(String(args[0]));
    return mockPrinter;
  };

  await service.printReceipt(sale.id);

  const allText = texts.join(" ");
  assert(allText.includes("Mercado Teste"), "Esperado nome da loja no comprovante");
  assert(allText.includes("Arroz 5kg"), "Esperado item 'Arroz 5kg' no comprovante");
  assert(allText.includes("Leite 1L"), "Esperado item 'Leite 1L' no comprovante");
  assert(allText.includes("Subtotal:"), "Esperado 'Subtotal' no comprovante");
  assert(allText.includes("TOTAL:"), "Esperado 'TOTAL' no comprovante");
  assert(allText.includes("Dinheiro"), "Esperado método de pagamento 'Dinheiro' no comprovante");
  assert(allText.includes("Troco:"), "Esperado 'Troco' no comprovante");

  mockPrinter.text = originalText;
});

test("gera QR Code no comprovante", async () => {
  const service = new PrinterServiceCtor(testPrinterConfig);
  const sale = testDb.prepare("SELECT id FROM sale WHERE status = 'completed'").get() as { id: number };

  let qrContent = "";
  const originalQrimage = mockPrinter.qrimage;
  mockPrinter.qrimage = (content: string, _options: unknown, callback: (err: Error | null) => void) => {
    qrContent = content;
    callback(null);
    return mockPrinter;
  };

  await service.printReceipt(sale.id);

  assert(qrContent.includes(`market-pos://sale/${sale.id}`), "Esperado QR Code com referência à venda");

  mockPrinter.qrimage = originalQrimage;
});

test("envia comando de corte de papel após a impressão", async () => {
  const service = new PrinterServiceCtor(testPrinterConfig);
  const sale = testDb.prepare("SELECT id FROM sale WHERE status = 'completed'").get() as { id: number };

  let cutCalled = false;
  let closeCalled = false;
  const originalCut = mockPrinter.cut;
  const originalClose = mockPrinter.close;
  mockPrinter.cut = () => {
    cutCalled = true;
    return mockPrinter;
  };
  mockPrinter.close = (callback?: (err?: Error) => void) => {
    closeCalled = true;
    if (callback) callback();
  };

  await service.printReceipt(sale.id);

  assert(cutCalled, "Esperado comando de corte de papel (cut)");
  assert(closeCalled, "Esperado fechamento da conexão com a impressora (close)");

  mockPrinter.cut = originalCut;
  mockPrinter.close = originalClose;
});

test("lança erro descritivo quando impressora está offline", async () => {
  const service = new PrinterServiceCtor(testPrinterConfig);
  const sale = testDb.prepare("SELECT id FROM sale WHERE status = 'completed'").get() as { id: number };

  const Module2 = require("module");
  const originalRequire2 = Module2.prototype.require;
  Module2.prototype.require = function (id: string) {
    if (id === "escpos-usb") {
      return function () {
        return {
          open: (cb: (err?: Error) => void) => {
            if (cb) cb(new Error("LIBUSB_ERROR_NO_DEVICE"));
          },
          write: (_data: Buffer, cb: (err?: Error) => void) => {
            if (cb) cb();
          },
          close: (cb?: (err?: Error) => void) => {
            if (cb) cb();
          }
        };
      };
    }
    return originalRequire2.apply(this, arguments as unknown as [string]);
  };

  try {
    await service.printReceipt(sale.id);
    assert(false, "Esperado erro quando impressora está offline");
  } catch (err) {
    assert(
      err instanceof Error && /Não foi possível conectar à impressora/.test(err.message),
      `Mensagem de erro inesperada: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    Module2.prototype.require = originalRequire2;
  }
});

// ─── Wait for async tests and report ────────────────────────────
setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}, 1000);
