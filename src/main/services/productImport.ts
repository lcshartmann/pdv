/**
 * Validação/classificação do import de produtos (PDV-4).
 *
 * Módulo PURO — sem IPC, sem banco. Recebe as linhas cruas do codec
 * (`RawCsvRow`) mais snapshots dos produtos e categorias atuais, e classifica
 * cada linha em INSERT / UPDATE / ERRO, aplicando as regras decididas para a
 * feature. Não grava nada: a gravação transacional é o PDV-5, que consome as
 * `ValidatedImportRow` produzidas aqui.
 *
 * Regras (resumo):
 *   - Identidade por `id`: com `id` → UPDATE; sem `id` → INSERT.
 *   - `name` obrigatório.
 *   - `price_per_unit`: numérico e >= 0.
 *   - `unit_type` ∈ {unit, kg}.
 *   - `barcode`: vazio → sem código; senão só dígitos, sem colidir com OUTRO
 *     produto, e sem duplicar entre linhas novas.
 *   - `category_name`: vazio → sem categoria; senão precisa existir (por nome,
 *     case-insensitive).
 *   - `stock_qty`: vale só no INSERT (vazio → 0). No UPDATE é ignorado; se o CSV
 *     trouxe um valor diferente do atual, gera aviso leve (não é erro).
 *   - `stock_alert_qty`: vazio → 0.
 *   - `id` duplicado no arquivo e `barcode` duplicado entre linhas novas → erro.
 */
import type { RawCsvRow } from "./productCsv";
import { csvToNumber } from "./productCsv";
import type {
  ProductImportError,
  ProductImportSummary,
  UnitType,
  ValidatedImportRow
} from "../../shared/types";

/** Snapshot do produto atual — usado para validar e detectar no-ops. */
export interface ExistingProductRow {
  id: number;
  name: string;
  barcode: string | null;
  unit_type: string;
  price_per_unit: number;
  stock_qty: number;
  stock_alert_qty: number;
  category_id: number | null;
}

/** Snapshot mínimo de categoria necessário para validar. */
export interface ExistingCategoryRow {
  id: number;
  name: string;
}

export interface ValidationResult {
  summary: ProductImportSummary;
  errors: ProductImportError[];
  validRows: ValidatedImportRow[];
}

const DIGITS_ONLY = /^\d+$/;

export function validateImportRows(
  rows: RawCsvRow[],
  products: ExistingProductRow[],
  categories: ExistingCategoryRow[]
): ValidationResult {
  const productById = new Map(products.map((p) => [p.id, p]));
  const barcodeOwner = new Map<string, ExistingProductRow>();
  for (const p of products) {
    if (p.barcode) barcodeOwner.set(p.barcode, p);
  }
  const categoryByName = new Map(
    categories.map((c) => [c.name.trim().toLowerCase(), c])
  );

  // Pré-passo: detectar duplicatas dentro do arquivo.
  const idCounts = new Map<string, number>();
  const newBarcodeCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.id !== "") idCounts.set(r.id, (idCounts.get(r.id) ?? 0) + 1);
    if (r.id === "" && r.barcode !== "") {
      newBarcodeCounts.set(r.barcode, (newBarcodeCounts.get(r.barcode) ?? 0) + 1);
    }
  }

  const errors: ProductImportError[] = [];
  const validRows: ValidatedImportRow[] = [];

  for (const r of rows) {
    const outcome = validateRow(
      r,
      productById,
      barcodeOwner,
      categoryByName,
      idCounts,
      newBarcodeCounts
    );
    if ("error" in outcome) {
      errors.push({ line: r.line, message: outcome.error });
    } else {
      validRows.push(outcome.row);
    }
  }

  const summary: ProductImportSummary = {
    toInsert: validRows.filter((r) => r.op === "insert").length,
    toUpdate: validRows.filter((r) => r.op === "update").length,
    unchanged: validRows.filter((r) => r.op === "unchanged").length,
    ignored: errors.length,
    warnings: validRows.filter((r) => r.stockIgnoredWarning).length
  };

  return { summary, errors, validRows };
}

function validateRow(
  r: RawCsvRow,
  productById: Map<number, ExistingProductRow>,
  barcodeOwner: Map<string, ExistingProductRow>,
  categoryByName: Map<string, ExistingCategoryRow>,
  idCounts: Map<string, number>,
  newBarcodeCounts: Map<string, number>
): { error: string } | { row: ValidatedImportRow } {
  const isUpdate = r.id !== "";

  if (r.name === "") return { error: "Nome vazio." };

  let existing: ExistingProductRow | undefined;
  if (isUpdate) {
    if (!DIGITS_ONLY.test(r.id)) return { error: `id inválido: "${r.id}".` };
    if ((idCounts.get(r.id) ?? 0) > 1) {
      return { error: `id ${r.id} duplicado no arquivo.` };
    }
    existing = productById.get(Number(r.id));
    if (!existing) return { error: `Produto id ${r.id} não encontrado.` };
  }

  if (r.unit_type !== "unit" && r.unit_type !== "kg") {
    return { error: `Tipo de unidade inválido: "${r.unit_type}".` };
  }
  const unit_type = r.unit_type as UnitType;

  const price = csvToNumber(r.price_per_unit);
  if (price === null || Number.isNaN(price) || price < 0) {
    return { error: `Preço inválido: "${r.price_per_unit}".` };
  }

  let barcode: string | null = null;
  if (r.barcode !== "") {
    if (!DIGITS_ONLY.test(r.barcode)) {
      return {
        error: `Código de barras deve conter apenas dígitos: "${r.barcode}".`
      };
    }
    const owner = barcodeOwner.get(r.barcode);
    if (owner && (!existing || owner.id !== existing.id)) {
      return { error: `Código de barras ${r.barcode} já usado por outro produto.` };
    }
    if (!isUpdate && (newBarcodeCounts.get(r.barcode) ?? 0) > 1) {
      return { error: `Código de barras ${r.barcode} duplicado entre linhas novas.` };
    }
    barcode = r.barcode;
  }

  let category_id: number | null = null;
  if (r.category_name !== "") {
    const category = categoryByName.get(r.category_name.trim().toLowerCase());
    if (!category) {
      return { error: `Categoria não encontrada: "${r.category_name}".` };
    }
    category_id = category.id;
  }

  let stock_alert_qty = 0;
  if (r.stock_alert_qty !== "") {
    const alert = csvToNumber(r.stock_alert_qty);
    if (alert === null || Number.isNaN(alert) || alert < 0) {
      return { error: `Alerta de estoque inválido: "${r.stock_alert_qty}".` };
    }
    stock_alert_qty = alert;
  }

  let stock_qty: number | null;
  let stockIgnoredWarning = false;
  if (isUpdate) {
    stock_qty = null; // ignorado no update
    if (r.stock_qty !== "") {
      const s = csvToNumber(r.stock_qty);
      if (s !== null && !Number.isNaN(s) && existing && s !== existing.stock_qty) {
        stockIgnoredWarning = true;
      }
    }
  } else if (r.stock_qty === "") {
    stock_qty = 0;
  } else {
    const s = csvToNumber(r.stock_qty);
    if (s === null || Number.isNaN(s) || s < 0) {
      return { error: `Estoque inválido: "${r.stock_qty}".` };
    }
    stock_qty = s;
  }

  // No-op: linha com id cujos valores gravaveis batem com o produto atual.
  // O estoque é deliberadamente ignorado no update, então não entra na
  // comparação (mudança de estoque só gera o aviso acima, não um update).
  const isUnchanged =
    !!existing &&
    existing.name === r.name &&
    (existing.barcode ?? null) === barcode &&
    existing.unit_type === unit_type &&
    existing.price_per_unit === price &&
    existing.stock_alert_qty === stock_alert_qty &&
    (existing.category_id ?? null) === category_id;

  const op = isUpdate ? (isUnchanged ? "unchanged" : "update") : "insert";

  return {
    row: {
      line: r.line,
      op,
      id: existing ? existing.id : null,
      name: r.name,
      barcode,
      unit_type,
      price_per_unit: price,
      stock_qty,
      stock_alert_qty,
      category_id,
      stockIgnoredWarning
    }
  };
}
