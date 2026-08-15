/**
 * Codec CSV do catálogo de produtos (PDV-2).
 *
 * Módulo puro — sem IPC, sem acesso a banco. Converte entre a lista de
 * produtos e o texto CSV no formato PT-BR decidido para a feature:
 *
 *   - separador de coluna `;`
 *   - decimal com vírgula (`7,50`)
 *   - UTF-8 com BOM
 *   - `barcode` sempre entre aspas na serialização
 *   - colunas fixas, nesta ordem: ver CSV_COLUMNS
 *
 * A validação aqui é apenas ESTRUTURAL (cabeçalho e arquivo vazio). A
 * validação semântica de cada linha contra o banco (id inexistente, preço
 * negativo, categoria desconhecida, etc.) é responsabilidade do import
 * (PDV-4), que consome as `RawCsvRow` produzidas pelo `parseProductsCsv`.
 */
import Papa from "papaparse";

const BOM = "﻿";

export const CSV_COLUMNS = [
  "id",
  "name",
  "barcode",
  "unit_type",
  "price_per_unit",
  "stock_qty",
  "stock_alert_qty",
  "category_name"
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Produto pronto para exportar (categoria já resolvida para nome). */
export interface ProductCsvExport {
  id: number;
  name: string;
  barcode: string | null;
  unit_type: string;
  price_per_unit: number;
  stock_qty: number;
  stock_alert_qty: number;
  category_name: string | null;
}

/** Linha crua do CSV: todos os campos como string já `trim`ada, com a linha de origem. */
export interface RawCsvRow {
  /** Número da linha no arquivo (cabeçalho = 1), para relatar erros no preview. */
  line: number;
  id: string;
  name: string;
  barcode: string;
  unit_type: string;
  price_per_unit: string;
  stock_qty: string;
  stock_alert_qty: string;
  category_name: string;
}

export type ParseResult =
  | { ok: true; rows: RawCsvRow[] }
  | { ok: false; error: string };

// ─── Helpers de número (decimal vírgula ↔ ponto) ────────────────────────────

/** Converte número interno (ponto) para o texto do CSV (vírgula). Lossless. */
export function numberToCsv(value: number): string {
  return String(value).replace(".", ",");
}

/**
 * Converte um campo do CSV para número.
 *   - vazio/branco → `null` (campo não informado)
 *   - inválido     → `NaN` (o chamador reporta "não-numérico")
 * Aceita tanto vírgula quanto ponto como separador decimal. Não trata
 * separador de milhar — o formato definido não usa.
 */
export function csvToNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return Number(trimmed.replace(",", "."));
}

// ─── Serialização ───────────────────────────────────────────────────────────

/** Serializa a lista de produtos em CSV (com BOM). Barcode sempre entre aspas. */
export function stringifyProducts(products: ProductCsvExport[]): string {
  const quotes = CSV_COLUMNS.map((column) => column === "barcode");

  const data = products.map((p) => [
    String(p.id),
    p.name,
    p.barcode ?? "",
    p.unit_type,
    numberToCsv(p.price_per_unit),
    numberToCsv(p.stock_qty),
    numberToCsv(p.stock_alert_qty),
    p.category_name ?? ""
  ]);

  const csv = Papa.unparse(
    { fields: [...CSV_COLUMNS], data },
    { delimiter: ";", quotes, newline: "\r\n" }
  );

  return BOM + csv;
}

// ─── Parse ──────────────────────────────────────────────────────────────────

/**
 * Parseia o texto CSV em linhas cruas. Falha o arquivo inteiro quando o
 * cabeçalho não bate com CSV_COLUMNS ou quando não há nenhuma linha de dados.
 */
export function parseProductsCsv(content: string): ParseResult {
  const withoutBom = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  // Detecta o separador em vez de fixá-lo: ao editar/re-salvar o CSV no
  // Excel/LibreOffice o separador pode virar TAB (foi o que aconteceu em
  // arquivos reais). Restringimos a `;` e TAB para nunca partir o decimal
  // com vírgula (`6,9`) — que aconteceria se `,` fosse um candidato.
  const parsed = Papa.parse<Record<string, string>>(withoutBom, {
    header: true,
    skipEmptyLines: "greedy",
    delimitersToGuess: [";", "\t"]
  });

  const fields = parsed.meta.fields?.map((f) => f.trim()) ?? [];
  const expected = new Set<string>(CSV_COLUMNS);
  const sameSize = fields.length === CSV_COLUMNS.length;
  const sameSet = fields.every((f) => expected.has(f)) && new Set(fields).size === fields.length;
  if (!sameSize || !sameSet) {
    return {
      ok: false,
      error: `Cabeçalho inválido. Esperado: ${CSV_COLUMNS.join("; ")}`
    };
  }

  if (parsed.data.length === 0) {
    return { ok: false, error: "Nenhum produto encontrado no arquivo." };
  }

  const cell = (row: Record<string, string>, column: CsvColumn): string =>
    (row[column] ?? "").trim();

  const rows: RawCsvRow[] = parsed.data.map((row, index) => ({
    // +2: linha 1 é o cabeçalho e o índice começa em 0.
    line: index + 2,
    id: cell(row, "id"),
    name: cell(row, "name"),
    barcode: cell(row, "barcode"),
    unit_type: cell(row, "unit_type"),
    price_per_unit: cell(row, "price_per_unit"),
    stock_qty: cell(row, "stock_qty"),
    stock_alert_qty: cell(row, "stock_alert_qty"),
    category_name: cell(row, "category_name")
  }));

  return { ok: true, rows };
}
