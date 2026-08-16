/**
 * Testes do codec CSV de produtos (PDV-2) — sem test runner.
 *
 * Rodar: npx ts-node -P tsconfig.main.json src/main/services/productCsv.test.ts
 */
import {
  CSV_COLUMNS,
  csvToNumber,
  numberToCsv,
  parseProductsCsv,
  stringifyProducts,
  type ProductCsvExport
} from "./productCsv";

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
    throw new Error(`${message}\n        esperado: ${JSON.stringify(expected)}\n        obtido:   ${JSON.stringify(actual)}`);
  }
}

// ─── Fixtures ───────────────────────────────────────────────────
const sample: ProductCsvExport[] = [
  {
    id: 1,
    name: "Tomate",
    barcode: null,
    unit_type: "kg",
    price_per_unit: 6.9,
    stock_qty: 0,
    stock_alert_qty: 0,
    category_name: "Hortifruti"
  },
  {
    id: 2,
    name: "Arroz 5kg",
    barcode: "7896006700916",
    unit_type: "unit",
    price_per_unit: 24.9,
    stock_qty: 12.5,
    stock_alert_qty: 3,
    category_name: "Mercearia"
  }
];

// ─── Helpers de número ──────────────────────────────────────────
test("numberToCsv usa vírgula decimal e é lossless", () => {
  assertEqual(numberToCsv(6.9), "6,9", "6.9");
  assertEqual(numberToCsv(0), "0", "0");
  assertEqual(numberToCsv(12.5), "12,5", "12.5");
});

test("csvToNumber: vazio → null, vírgula e ponto aceitos, inválido → NaN", () => {
  assertEqual(csvToNumber("   "), null, "vazio vira null");
  assertEqual(csvToNumber("7,50"), 7.5, "vírgula decimal");
  assertEqual(csvToNumber("7.5"), 7.5, "ponto decimal tolerado");
  assert(Number.isNaN(csvToNumber("abc")), "texto vira NaN");
});

// ─── Round-trip ─────────────────────────────────────────────────
test("round-trip: stringify → parse preserva valores", () => {
  const csv = stringifyProducts(sample);
  const result = parseProductsCsv(csv);
  assert(result.ok, "parse deve ter sucesso");
  if (!result.ok) return;

  assertEqual(result.rows.length, 2, "duas linhas");

  const tomate = result.rows[0];
  assertEqual(tomate.name, "Tomate", "nome preservado");
  assertEqual(tomate.barcode, "", "barcode nulo vira vazio");
  assertEqual(csvToNumber(tomate.price_per_unit), 6.9, "preço do tomate");
  assertEqual(tomate.unit_type, "kg", "unit_type kg");

  const arroz = result.rows[1];
  assertEqual(arroz.barcode, "7896006700916", "barcode longo preservado como texto");
  assertEqual(csvToNumber(arroz.stock_qty), 12.5, "estoque decimal");
});

test("stringify inclui BOM e barcode entre aspas", () => {
  const csv = stringifyProducts(sample);
  assert(csv.charCodeAt(0) === 0xfeff, "começa com BOM");
  assert(csv.includes('"7896006700916"'), "barcode entre aspas");
});

// ─── Quoting / caracteres especiais ─────────────────────────────
test("campo com ; aspas e acento é preservado no round-trip", () => {
  const tricky: ProductCsvExport[] = [
    {
      id: 3,
      name: 'Refri "Cola"; 2L — açaí',
      barcode: "111",
      unit_type: "unit",
      price_per_unit: 9.99,
      stock_qty: 1,
      stock_alert_qty: 0,
      category_name: "Bebidas"
    }
  ];
  const result = parseProductsCsv(stringifyProducts(tricky));
  assert(result.ok, "parse ok");
  if (!result.ok) return;
  assertEqual(result.rows[0].name, 'Refri "Cola"; 2L — açaí', "nome com ; e aspas preservado");
});

// ─── Separador alternativo (planilha re-salva como TAB) ─────────
test("arquivo re-salvo com TAB ainda é parseado (delimiter autodetect)", () => {
  const header = CSV_COLUMNS.join("\t");
  const linha = ["56", "Abacate", "123", "kg", "6,9", "0", "0", "Hortifruti"].join("\t");
  const tabCsv = `﻿${header}\n${linha}\n`;
  const result = parseProductsCsv(tabCsv);
  assert(result.ok, "TAB deve ser detectado e parseado");
  if (!result.ok) return;
  assertEqual(result.rows.length, 1, "uma linha");
  assertEqual(result.rows[0].name, "Abacate", "nome preservado");
  assertEqual(result.rows[0].barcode, "123", "barcode preservado");
  assertEqual(csvToNumber(result.rows[0].price_per_unit), 6.9, "decimal com vírgula intacto");
});

// ─── Erros de arquivo inteiro ───────────────────────────────────
test("cabeçalho inválido → erro de arquivo inteiro", () => {
  const bad = "nome;preco\r\nTomate;6,9\r\n";
  const result = parseProductsCsv(bad);
  assert(!result.ok, "deve falhar");
});

test("arquivo só com cabeçalho → erro de arquivo inteiro", () => {
  const headerOnly = stringifyProducts([]);
  const result = parseProductsCsv(headerOnly);
  assert(!result.ok, "deve falhar por não ter linhas");
});

test("arquivo vazio → erro de arquivo inteiro", () => {
  const result = parseProductsCsv("");
  assert(!result.ok, "deve falhar");
});

test("linha reporta número de origem correto", () => {
  const csv = stringifyProducts(sample);
  const result = parseProductsCsv(csv);
  assert(result.ok, "ok");
  if (!result.ok) return;
  assertEqual(result.rows[0].line, 2, "primeira linha de dados é a 2");
  assertEqual(result.rows[1].line, 3, "segunda linha de dados é a 3");
});

// ─── Resumo ─────────────────────────────────────────────────────
console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
