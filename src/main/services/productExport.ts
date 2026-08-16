/**
 * Exportação do catálogo de produtos (PDV-3).
 *
 * Lê o catálogo INTEIRO (sem filtros da tela) e serializa via codec CSV.
 * A categoria é resolvida para o nome legível com LEFT JOIN — produtos sem
 * categoria saem com `category_name` nulo (célula vazia no CSV).
 */
import type Database from "better-sqlite3";
import { stringifyProducts, type ProductCsvExport } from "./productCsv";

/** Coleta todos os produtos no formato pronto para o codec, ordenados por nome. */
export function collectCatalogForExport(
  db: Database.Database
): ProductCsvExport[] {
  return db
    .prepare(
      `
      SELECT
        p.id AS id,
        p.name AS name,
        p.barcode AS barcode,
        p.unit_type AS unit_type,
        p.price_per_unit AS price_per_unit,
        p.stock_qty AS stock_qty,
        p.stock_alert_qty AS stock_alert_qty,
        c.name AS category_name
      FROM product p
      LEFT JOIN category c ON c.id = p.category_id
      WHERE p.deleted_at IS NULL
      ORDER BY p.name ASC
      `
    )
    .all() as ProductCsvExport[];
}

/** Gera o texto CSV (com BOM) do catálogo inteiro. */
export function buildCatalogCsv(db: Database.Database): string {
  return stringifyProducts(collectCatalogForExport(db));
}
