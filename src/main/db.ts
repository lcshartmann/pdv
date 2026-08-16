import path from "node:path";
import Database from "better-sqlite3";

let dbInstance: Database.Database | null = null;
let dbFilePath: string | null = null;

const schema = `
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
  discount_basis  TEXT    CHECK(discount_basis IN ('unit', 'total')),
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

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
`;

const seedCategories = ["Expositores", "Armário", "Bancas", "B. Verduras", "Geladeira", "Caixa"];

export function getDb(): Database.Database {
  if (!dbInstance) {
    throw new Error("Database is not initialized.");
  }
  return dbInstance;
}

export function getDbPath(): string {
  if (!dbFilePath) {
    throw new Error("Database is not initialized.");
  }
  return dbFilePath;
}

function seedInitialData(db: Database.Database): void {
  const categoryCount = db.prepare("SELECT COUNT(*) AS count FROM category").get() as { count: number };
  if (categoryCount.count > 0) {
    return;
  }

  const insertCategory = db.prepare("INSERT INTO category(name) VALUES (?)");

  const categoryByName = new Map<string, number>();

  const tx = db.transaction(() => {
    for (const categoryName of seedCategories) {
      const info = insertCategory.run(categoryName);
      categoryByName.set(categoryName, Number(info.lastInsertRowid));
    }
  });

  tx();
}

interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

/**
 * Verifica se uma coluna existe antes de adicioná-la. Mantém as migrações
 * idempotentes mesmo em bancos que já receberam a coluna por caminhos antigos
 * (ex.: bancos v1.0.0 cujo `user_version` ainda é 0).
 */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return columns.some((current) => current.name === column);
}

/**
 * Migrações incrementais aplicadas sobre o schema baseline (v0). Cada migração
 * roda uma única vez, na ordem, quando `version` for maior que o `user_version`
 * gravado no arquivo .db.
 */
const migrations: Migration[] = [
  {
    // v1: desconto por item (antes aplicado de forma ad-hoc no boot).
    version: 1,
    up: (db) => {
      if (!hasColumn(db, "sale_item", "discount_basis")) {
        db.exec("ALTER TABLE sale_item ADD COLUMN discount_basis TEXT");
      }
    }
  },
  {
    // v2: soft delete de produtos — `deleted_at` NULL = ativo.
    version: 2,
    up: (db) => {
      if (!hasColumn(db, "product", "deleted_at")) {
        db.exec("ALTER TABLE product ADD COLUMN deleted_at TEXT");
      }
    }
  }
];

/**
 * Runner de migrações versionado por `PRAGMA user_version` (inteiro nativo no
 * cabeçalho do .db). Aplica cada migração pendente numa transação, avançando o
 * `user_version` junto — bancos novos e existentes convergem para a última versão.
 */
function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (const migration of migrations) {
    if (migration.version > current) {
      const apply = db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      });
      apply();
    }
  }
}

export function clearStock(db: Database.Database){
  const update = db.prepare(`
    UPDATE product SET stock_qty = 0
    `)
  update.run();
}

export function initializeDatabase(userDataPath: string): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = path.join(userDataPath, "market-pos.db");
  const db = new Database(dbPath);
  db.exec(schema);
  runMigrations(db);
  seedInitialData(db);
  dbInstance = db;
  dbFilePath = dbPath;
  return db;
}
