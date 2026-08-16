/**
 * Testes do validador de import (PDV-4) — sem test runner.
 *
 * Módulo puro (sem banco), então roda direto no Node/ts-node.
 * Rodar: npx ts-node -P tsconfig.main.json src/main/services/productImport.test.ts
 */
import type { RawCsvRow } from "./productCsv";
import {
  validateImportRows,
  type ExistingCategoryRow,
  type ExistingProductRow
} from "./productImport";

// ─── Mini harness ───────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}\n        esperado: ${JSON.stringify(expected)}\n        obtido:   ${JSON.stringify(actual)}`
    );
  }
}

// ─── Fixtures ───────────────────────────────────────────────────
const PRODUCTS: ExistingProductRow[] = [
  {
    id: 1,
    name: "Arroz",
    barcode: "7891000100103",
    unit_type: "unit",
    price_per_unit: 5,
    stock_qty: 10,
    stock_alert_qty: 2,
    category_id: 20
  },
  {
    id: 2,
    name: "Feijão",
    barcode: null,
    unit_type: "unit",
    price_per_unit: 8,
    stock_qty: 5,
    stock_alert_qty: 0,
    category_id: 20
  }
];
const CATEGORIES: ExistingCategoryRow[] = [
  { id: 10, name: "Hortifruti" },
  { id: 20, name: "Mercearia" }
];

let lineSeq = 2;
function row(partial: Partial<Omit<RawCsvRow, "line">>): RawCsvRow {
  return {
    line: lineSeq++,
    id: "",
    name: "",
    barcode: "",
    unit_type: "unit",
    price_per_unit: "",
    stock_qty: "",
    stock_alert_qty: "",
    category_name: "",
    ...partial
  };
}

function validate(rows: RawCsvRow[]) {
  return validateImportRows(rows, PRODUCTS, CATEGORIES);
}

// ─── Classificação básica ───────────────────────────────────────
test("linha sem id vira INSERT; com id existente vira UPDATE", () => {
  const res = validate([
    row({ name: "Novo", price_per_unit: "3,50" }),
    row({ id: "1", name: "Editado", price_per_unit: "9,90" })
  ]);
  assertEqual(res.summary.toInsert, 1, "um insert");
  assertEqual(res.summary.toUpdate, 1, "um update");
  assertEqual(res.errors.length, 0, "sem erros");
  const insert = res.validRows.find((r) => r.op === "insert")!;
  assertEqual(insert.stock_qty, 0, "stock vazio no insert vira 0");
  const update = res.validRows.find((r) => r.op === "update")!;
  assertEqual(update.id, 1, "update aponta para o produto existente");
  assertEqual(update.stock_qty, null, "update ignora stock (null)");
});

test("linha id idêntica ao produto atual vira INALTERADA (não conta como update)", () => {
  const res = validate([
    // igual ao produto 1 em todos os campos gravaveis (estoque é ignorado)
    row({
      id: "1",
      name: "Arroz",
      barcode: "7891000100103",
      unit_type: "unit",
      price_per_unit: "5",
      stock_qty: "10",
      stock_alert_qty: "2",
      category_name: "Mercearia"
    }),
    // mesma linha, mas com preço diferente → update de verdade
    row({
      id: "2",
      name: "Feijão",
      unit_type: "unit",
      price_per_unit: "7,50",
      stock_alert_qty: "0",
      category_name: "Mercearia"
    })
  ]);
  assertEqual(res.errors.length, 0, "sem erros");
  assertEqual(res.summary.unchanged, 1, "uma inalterada");
  assertEqual(res.summary.toUpdate, 1, "uma a atualizar");
  const inalterada = res.validRows.find((r) => r.id === 1)!;
  assertEqual(inalterada.op, "unchanged", "produto 1 inalterado");
});

// ─── Erros de célula ────────────────────────────────────────────
test("name vazio, preço inválido e unit_type inválido viram erro", () => {
  const res = validate([
    row({ price_per_unit: "1,00" }), // name vazio
    row({ name: "X", price_per_unit: "-1" }), // preço negativo
    row({ name: "Y", price_per_unit: "abc" }), // preço não-numérico
    row({ name: "Z", price_per_unit: "1", unit_type: "litro" }) // unit inválido
  ]);
  assertEqual(res.errors.length, 4, "quatro erros");
  assertEqual(res.summary.ignored, 4, "ignoradas = erros");
});

test("id preenchido mas inexistente vira erro", () => {
  const res = validate([row({ id: "999", name: "Fantasma", price_per_unit: "1" })]);
  assertEqual(res.errors.length, 1, "um erro");
  assert(res.errors[0].message.includes("999"), "menciona o id");
});

// ─── Barcode ────────────────────────────────────────────────────
test("barcode não-dígitos vira erro", () => {
  const res = validate([
    row({ name: "A", price_per_unit: "1", barcode: "12ab34" })
  ]);
  assertEqual(res.errors.length, 1, "um erro");
});

test("barcode colidindo com OUTRO produto vira erro; mesmo produto é ok", () => {
  const colide = validate([
    row({ name: "A", price_per_unit: "1", barcode: "7891000100103" }) // é do id 1, mas é insert
  ]);
  assertEqual(colide.errors.length, 1, "insert com barcode de outro produto falha");

  const mesmo = validate([
    row({ id: "1", name: "A", price_per_unit: "1", barcode: "7891000100103" })
  ]);
  assertEqual(mesmo.errors.length, 0, "update do próprio produto mantém seu barcode");
  assertEqual(mesmo.summary.toUpdate, 1, "classificado como update");
});

// ─── Duplicatas no arquivo ──────────────────────────────────────
test("id duplicado no arquivo → ambas as linhas erram", () => {
  const res = validate([
    row({ id: "1", name: "A", price_per_unit: "1" }),
    row({ id: "1", name: "B", price_per_unit: "2" })
  ]);
  assertEqual(res.errors.length, 2, "duas linhas com erro");
});

test("barcode duplicado entre linhas novas → ambas erram", () => {
  const res = validate([
    row({ name: "A", price_per_unit: "1", barcode: "555" }),
    row({ name: "B", price_per_unit: "2", barcode: "555" })
  ]);
  assertEqual(res.errors.length, 2, "duas linhas com erro");
});

// ─── Categoria ──────────────────────────────────────────────────
test("categoria por nome (case-insensitive); inexistente vira erro; vazia → null", () => {
  const res = validate([
    row({ name: "A", price_per_unit: "1", category_name: "hortifruti" }),
    row({ name: "B", price_per_unit: "1", category_name: "Inexistente" }),
    row({ name: "C", price_per_unit: "1", category_name: "" })
  ]);
  assertEqual(res.errors.length, 1, "só a categoria inexistente erra");
  const a = res.validRows.find((r) => r.name === "A")!;
  assertEqual(a.category_id, 10, "hortifruti resolvida case-insensitive");
  const c = res.validRows.find((r) => r.name === "C")!;
  assertEqual(c.category_id, null, "categoria vazia vira null");
});

// ─── Estoque em update ──────────────────────────────────────────
test("stock_qty alterado em update gera aviso; igual não gera", () => {
  const res = validate([
    row({ id: "1", name: "A", price_per_unit: "1", stock_qty: "99" }), // difere de 10
    row({ id: "2", name: "B", price_per_unit: "1", stock_qty: "5" }) // igual a 5
  ]);
  assertEqual(res.errors.length, 0, "sem erros");
  assertEqual(res.summary.warnings, 1, "um aviso de estoque ignorado");
  const a = res.validRows.find((r) => r.id === 1)!;
  assert(a.stockIgnoredWarning, "linha do id 1 avisa");
  const b = res.validRows.find((r) => r.id === 2)!;
  assert(!b.stockIgnoredWarning, "linha do id 2 não avisa");
});

test("estoque negativo em insert vira erro; alerta vazio → 0", () => {
  const res = validate([
    row({ name: "A", price_per_unit: "1", stock_qty: "-3" })
  ]);
  assertEqual(res.errors.length, 1, "estoque negativo no insert erra");

  const ok = validate([row({ name: "A", price_per_unit: "1" })]);
  assertEqual(ok.validRows[0].stock_alert_qty, 0, "alerta vazio vira 0");
});

// ─── Resumo ─────────────────────────────────────────────────────
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
