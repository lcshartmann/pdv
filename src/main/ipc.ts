import { ipcMain, dialog, BrowserWindow, app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { SerialPort } from "serialport";
import type {
  Category,
  PaymentCreateRequest,
  PaymentCreateResponse,
  Product,
  ReportsDashboardRequest,
  ReportsDashboardResponse,
  ReportsDailyPoint,
  ReportsHistoryItem,
  ReportsPaymentBreakdownItem,
  ReportsSaleDetailItem,
  ReportsSaleDetailResponse,
  ReportsProductOption,
  ReportsProductSeries,
  ReportsProductSeriesPoint,
  ReportsStockAlertItem,
  ReportsTopProduct,
  ProductCreateRequest,
  ProductCreateResponse,
  ProductExportResponse,
  ProductImportCommitRequest,
  ProductImportCommitResponse,
  ProductImportValidateResponse,
  ProductUpdateRequest,
  ValidatedImportRow,
  SaleAddItemRequest,
  SaleAddItemResponse,
  SaleCancelRequest,
  SaleCompleteRequest,
  SaleCompleteResponse,
  SaleCreateResponse,
  SaleItem,
  SaleRemoveItemRequest,
  SaleRemoveLastItemRequest,
  SaleSetItemDiscountRequest,
  ScaleStatus,
  SaleUpdateItemQuantityRequest,
  AppSettings,
  SettingsUpdateRequest,
  SerialPortInfo,
  PrinterTestResponse,
  NetworkCheckResponse,
  DataBackupResponse,
  DataRestoreResponse,
  DataClearStockResponse
} from "../shared/types";
import { PrinterService } from "./services/printer";
import { ScaleService } from "./services/scale";
import { getDbPath, clearStock } from "./db";
import {
  getSettings,
  updateSettings,
  touchesScale
} from "./services/settings";
import { buildCatalogCsv } from "./services/productExport";
import { parseProductsCsv } from "./services/productCsv";
import {
  validateImportRows,
  type ExistingCategoryRow,
  type ExistingProductRow
} from "./services/productImport";

interface SaleAggregate {
  subtotal: number;
  discount_amount: number;
}

interface IpcServices {
  /** Acessor porque a balança é re-instanciada a quente ao salvar config. */
  getScaleService: () => ScaleService;
  /** Reconstrói a balança com a config salva mais recente. */
  reinitScale: () => Promise<void>;
  printerService: PrinterService;
}

export function registerIpcHandlers(
  db: Database.Database,
  services: IpcServices
): void {
  // Dinheiro é tratado em centavos: arredonda a 2 casas para evitar acúmulo de
  // erro de ponto flutuante nos totais e descontos.
  const round2 = (value: number): number => Math.round(value * 100) / 100;

  const recalculateSaleTotals = (saleId: number): void => {
    // Subtotal é bruto (soma de quantidade × preço original); o desconto da
    // venda é a soma dos descontos por linha; total = subtotal − desconto.
    const aggregate = db
      .prepare(
        `
        SELECT
          COALESCE(SUM(quantity * unit_price), 0) AS subtotal,
          COALESCE(SUM(discount_amount), 0) AS discount_amount
        FROM sale_item
        WHERE sale_id = ?
        `
      )
      .get(saleId) as SaleAggregate;

    const subtotal = round2(Number(aggregate.subtotal ?? 0));
    const discount = round2(Number(aggregate.discount_amount ?? 0));
    const total = round2(subtotal - discount);

    db.prepare(
      "UPDATE sale SET subtotal = ?, discount_amount = ?, total = ? WHERE id = ?"
    ).run(subtotal, discount, total, saleId);
  };

  ipcMain.handle("sale:create", () => {
    const info = db
      .prepare(
        "INSERT INTO sale (status, subtotal, discount_amount, total) VALUES ('open', 0, 0, 0)"
      )
      .run();
    return {
      saleId: Number(info.lastInsertRowid)
    } satisfies SaleCreateResponse;
  });

  ipcMain.handle("sale:addItem", (_event, payload: SaleAddItemRequest) => {
    const product = db
      .prepare("SELECT id, price_per_unit FROM product WHERE id = ?")
      .get(payload.productId) as
      | { id: number; price_per_unit: number }
      | undefined;
    if (!product) {
      throw new Error("Product not found.");
    }

    const quantity = Number(payload.quantity);
    if (quantity <= 0) {
      throw new Error("Quantity must be greater than 0.");
    }

    // Só mescla em linhas sem desconto: uma linha com desconto por unidade ou
    // total tem preço efetivo próprio e não deve absorver novas unidades.
    const existing = db
      .prepare(
        "SELECT id, quantity FROM sale_item WHERE sale_id = ? AND product_id = ? AND unit_price = ? AND discount_amount = 0 LIMIT 1"
      )
      .get(payload.saleId, payload.productId, product.price_per_unit) as
      | { id: number; quantity: number }
      | undefined;

    let itemId: number;
    if (existing) {
      const newQuantity = Number(existing.quantity) + quantity;
      const newTotal = round2(newQuantity * Number(product.price_per_unit));
      db.prepare(
        "UPDATE sale_item SET quantity = ?, total = ? WHERE id = ?"
      ).run(newQuantity, newTotal, existing.id);
      itemId = existing.id;
    } else {
      const info = db
        .prepare(
          "INSERT INTO sale_item (sale_id, product_id, quantity, unit_price, discount_amount, discount_basis, total) VALUES (?, ?, ?, ?, 0, NULL, ?)"
        )
        .run(
          payload.saleId,
          payload.productId,
          quantity,
          product.price_per_unit,
          round2(quantity * Number(product.price_per_unit))
        );
      itemId = Number(info.lastInsertRowid);
    }

    recalculateSaleTotals(payload.saleId);

    const item = db
      .prepare("SELECT * FROM sale_item WHERE id = ?")
      .get(itemId) as SaleItem;
    return { item } satisfies SaleAddItemResponse;
  });

  ipcMain.handle(
    "sale:removeItem",
    (_event, payload: SaleRemoveItemRequest) => {
      db.prepare("DELETE FROM sale_item WHERE id = ? AND sale_id = ?").run(
        payload.saleItemId,
        payload.saleId
      );
      recalculateSaleTotals(payload.saleId);
    }
  );

  ipcMain.handle(
    "sale:removeLastItem",
    (_event, payload: SaleRemoveLastItemRequest) => {
      db.prepare("DELETE FROM sale_item WHERE id = (SELECT id FROM sale_item WHERE sale_id = ? ORDER BY id DESC LIMIT 1);").run(
        payload.saleId,
      );
      recalculateSaleTotals(payload.saleId);
    }
  );

  ipcMain.handle(
    "sale:updateItemQuantity",
    (_event, payload: SaleUpdateItemQuantityRequest) => {
      const quantity = Number(payload.quantity);
      if (quantity <= 0) {
        throw new Error("Quantity must be greater than 0.");
      }

      const existing = db
        .prepare(
          "SELECT id, quantity, unit_price, discount_amount, discount_basis FROM sale_item WHERE id = ? AND sale_id = ?"
        )
        .get(payload.saleItemId, payload.saleId) as
        | {
            id: number;
            quantity: number;
            unit_price: number;
            discount_amount: number;
            discount_basis: "unit" | "total" | null;
          }
        | undefined;

      if (!existing) {
        throw new Error("Sale item not found.");
      }

      const unitPrice = Number(existing.unit_price);
      const grossTotal = round2(quantity * unitPrice);
      let discount = Number(existing.discount_amount);

      if (existing.discount_basis === "unit") {
        // Preserva o preço unitário efetivo: recalcula os reais para a nova qtd.
        const previousQuantity = Number(existing.quantity);
        const perUnitDiscount =
          previousQuantity > 0 ? discount / previousQuantity : 0;
        discount = round2(perUnitDiscount * quantity);
      }
      // basis "total" (ou sem desconto): mantém o valor absoluto abatido.
      // Nunca deixa o desconto ultrapassar o bruto (total não fica negativo).
      discount = Math.min(round2(discount), grossTotal);

      const total = round2(grossTotal - discount);
      db.prepare(
        "UPDATE sale_item SET quantity = ?, discount_amount = ?, total = ? WHERE id = ? AND sale_id = ?"
      ).run(quantity, discount, total, payload.saleItemId, payload.saleId);

      recalculateSaleTotals(payload.saleId);

      const item = db
        .prepare("SELECT * FROM sale_item WHERE id = ?")
        .get(payload.saleItemId) as SaleItem;
      return { item } satisfies SaleAddItemResponse;
    }
  );

  ipcMain.handle(
    "sale:setItemDiscount",
    (_event, payload: SaleSetItemDiscountRequest) => {
      const existing = db
        .prepare(
          "SELECT id, quantity, unit_price FROM sale_item WHERE id = ? AND sale_id = ?"
        )
        .get(payload.saleItemId, payload.saleId) as
        | { id: number; quantity: number; unit_price: number }
        | undefined;

      if (!existing) {
        throw new Error("Sale item not found.");
      }

      const quantity = Number(existing.quantity);
      const unitPrice = Number(existing.unit_price);
      const grossTotal = round2(quantity * unitPrice);

      let discountAmount = 0;
      let basis: "unit" | "total" | null = null;

      if (payload.basis !== "none") {
        const newPrice = Number(payload.newPrice);
        if (!Number.isFinite(newPrice) || newPrice <= 0) {
          throw new Error("Novo preço deve ser maior que zero.");
        }

        if (payload.basis === "unit") {
          if (newPrice >= unitPrice) {
            throw new Error("O desconto deve reduzir o preço unitário.");
          }
          discountAmount = round2((unitPrice - newPrice) * quantity);
        } else {
          if (newPrice >= grossTotal) {
            throw new Error("O desconto deve reduzir o total da linha.");
          }
          discountAmount = round2(grossTotal - newPrice);
        }
        basis = payload.basis;
      }

      const total = round2(grossTotal - discountAmount);
      db.prepare(
        "UPDATE sale_item SET discount_amount = ?, discount_basis = ?, total = ? WHERE id = ? AND sale_id = ?"
      ).run(discountAmount, basis, total, payload.saleItemId, payload.saleId);

      recalculateSaleTotals(payload.saleId);

      const item = db
        .prepare("SELECT * FROM sale_item WHERE id = ?")
        .get(payload.saleItemId) as SaleItem;
      return { item } satisfies SaleAddItemResponse;
    }
  );

  ipcMain.handle(
    "sale:complete",
    async (_event, payload: SaleCompleteRequest) => {
      const completeSaleTx = db.transaction((saleId: number) => {
        const sale = db
          .prepare("SELECT id, status FROM sale WHERE id = ?")
          .get(saleId) as
          | { id: number; status: "open" | "completed" | "cancelled" }
          | undefined;

        if (!sale) {
          throw new Error("Sale not found.");
        }

        if (sale.status !== "open") {
          throw new Error("Only open sales can be completed.");
        }

        const items = db
          .prepare(
            "SELECT product_id, quantity, stock_qty FROM sale_item JOIN product ON product.id = product_id WHERE sale_id = ?"
          )
          .all(saleId) as Array<{
          product_id: number;
          quantity: number;
          stock_qty: number;
        }>;

        db.prepare(
          "UPDATE sale SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
        ).run(saleId);

        const updateStock = db.prepare(
          "UPDATE product SET stock_qty = stock_qty - ?, updated_at = datetime('now') WHERE id = ?"
        );
        const insertMovement = db.prepare(
          "INSERT INTO stock_movement (product_id, type, qty_change, reason) VALUES (?, 'sale', ?, ?)"
        );

        for (const item of items) {
          const qty =
            item.quantity > item.stock_qty
              ? Number(item.stock_qty)
              : Number(item.quantity);
          updateStock.run(qty, item.product_id);
          insertMovement.run(item.product_id, -qty, `sale:${saleId}`);
        }
      });

      completeSaleTx(payload.saleId);

      // Healthcheck sob demanda: se a impressora não está disponível, a venda
      // é concluída e a impressão é simplesmente pulada (sem bloquear o fluxo).
      const printerStatus = await services.printerService.getStatus();
      if (!printerStatus.available) {
        return {
          printed: false,
          printerOffline: true
        } satisfies SaleCompleteResponse;
      }

      try {
        await services.printerService.printReceipt(payload.saleId);
        return {
          printed: true,
          printerOffline: false
        } satisfies SaleCompleteResponse;
      } catch (printError) {
        const printMessage =
          printError instanceof Error
            ? printError.message
            : "Erro desconhecido na impressora";
        throw new Error(
          `[PRINTER_OFFLINE] Venda concluída com sucesso, mas a impressão do comprovante falhou: ${printMessage}`
        );
      }
    }
  );

  ipcMain.handle("sale:cancel", (_event, payload: SaleCancelRequest) => {
    db.prepare(
      "UPDATE sale SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status = 'open'"
    ).run(payload.saleId);
  });

  ipcMain.handle("product:list", () => {
    return db
      .prepare("SELECT * FROM product ORDER BY name ASC")
      .all() as Product[];
  });

  ipcMain.handle("category:list", () => {
    return db
      .prepare("SELECT * FROM category ORDER BY name ASC")
      .all() as Category[];
  });

  ipcMain.handle("product:create", (_event, payload: ProductCreateRequest) => {
    try {
      const normalizedBarcode = payload.barcode?.trim()
        ? payload.barcode.trim()
        : null;
      const info = db
        .prepare(
          `
          INSERT INTO product (
            name, barcode, unit_type, price_per_unit, stock_qty, stock_alert_qty, category_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          payload.name,
          normalizedBarcode,
          payload.unit_type,
          payload.price_per_unit,
          payload.stock_qty ?? 0,
          payload.stock_alert_qty ?? 0,
          payload.category_id ?? null
        );

      return {
        productId: Number(info.lastInsertRowid)
      } satisfies ProductCreateResponse;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
      ) {
        throw new Error("Código de barras já cadastrado.");
      }

      throw error;
    }
  });

  ipcMain.handle("product:update", (_event, payload: ProductUpdateRequest) => {
    db.prepare(
      `
      UPDATE product
      SET
        name = ?,
        barcode = ?,
        unit_type = ?,
        price_per_unit = ?,
        stock_qty = ?,
        stock_alert_qty = ?,
        category_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
      `
    ).run(
      payload.name,
      payload.barcode ?? null,
      payload.unit_type,
      payload.price_per_unit,
      payload.stock_qty,
      payload.stock_alert_qty,
      payload.category_id ?? null,
      payload.id
    );
  });

  ipcMain.handle("product:export", async () => {
    const csv = buildCatalogCsv(db);

    const now = new Date();
    const defaultName = `produtos-${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.csv`;

    const options = {
      title: "Exportar produtos",
      defaultPath: defaultName,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    };
    const focused = BrowserWindow.getFocusedWindow();
    const result = focused
      ? await dialog.showSaveDialog(focused, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return { canceled: true } satisfies ProductExportResponse;
    }

    await fs.promises.writeFile(result.filePath, csv, "utf8");
    return {
      canceled: false,
      path: result.filePath
    } satisfies ProductExportResponse;
  });

  ipcMain.handle("product:importValidate", async () => {
    const focused = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Importar produtos",
      filters: [{ name: "CSV", extensions: ["csv"] }],
      properties: ["openFile"]
    };
    const result = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true } satisfies ProductImportValidateResponse;
    }

    const filePath = result.filePaths[0];
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = parseProductsCsv(content);
    if (!parsed.ok) {
      return {
        canceled: false,
        ok: false,
        error: parsed.error
      } satisfies ProductImportValidateResponse;
    }

    const products = db
      .prepare(
        "SELECT id, name, barcode, unit_type, price_per_unit, stock_qty, stock_alert_qty, category_id FROM product"
      )
      .all() as ExistingProductRow[];
    const categories = db
      .prepare("SELECT id, name FROM category")
      .all() as ExistingCategoryRow[];

    const { summary, errors, validRows } = validateImportRows(
      parsed.rows,
      products,
      categories
    );

    return {
      canceled: false,
      ok: true,
      preview: {
        fileName: path.basename(filePath),
        summary,
        errors,
        validRows
      }
    } satisfies ProductImportValidateResponse;
  });

  ipcMain.handle(
    "product:importCommit",
    (_event, payload: ProductImportCommitRequest) => {
      const insertStmt = db.prepare(
        `
        INSERT INTO product (
          name, barcode, unit_type, price_per_unit, stock_qty, stock_alert_qty, category_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      );
      // UPDATE preserva o estoque do produto existente (não toca em stock_qty).
      const updateStmt = db.prepare(
        `
        UPDATE product
        SET
          name = ?,
          barcode = ?,
          unit_type = ?,
          price_per_unit = ?,
          stock_alert_qty = ?,
          category_id = ?,
          updated_at = datetime('now')
        WHERE id = ?
        `
      );

      const applyBatch = db.transaction((rows: ValidatedImportRow[]) => {
        let applied = 0;
        for (const row of rows) {
          if (row.op === "insert") {
            insertStmt.run(
              row.name,
              row.barcode,
              row.unit_type,
              row.price_per_unit,
              row.stock_qty ?? 0,
              row.stock_alert_qty,
              row.category_id
            );
            applied++;
          } else if (row.op === "update") {
            updateStmt.run(
              row.name,
              row.barcode,
              row.unit_type,
              row.price_per_unit,
              row.stock_alert_qty,
              row.category_id,
              row.id
            );
            applied++;
          }
          // op "unchanged": nada a gravar.
        }
        return applied;
      });

      const applied = applyBatch(payload.rows);
      return { applied } satisfies ProductImportCommitResponse;
    }
  );

  ipcMain.handle(
    "reports:dashboard",
    (_event, payload: ReportsDashboardRequest) => {
      const fromDate = payload.fromDate;
      const toDate = payload.toDate;

      const summary = db
        .prepare(
          `
        SELECT
          COUNT(*) AS total_sales,
          COALESCE(SUM(total), 0) AS total_revenue
        FROM sale
        WHERE status = 'completed'
          AND DATE(completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
        `
        )
        .get(fromDate, toDate) as {
        total_sales: number;
        total_revenue: number;
      };

      const totalSales = Number(summary.total_sales ?? 0);
      const totalRevenue = Number(summary.total_revenue ?? 0);
      const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;

      // Determine if we should use hourly granularity (for periods up to 2 days)
      const fromDateTime = new Date(`${fromDate}T00:00:00`);
      const toDateTime = new Date(`${toDate}T23:59:59`);
      const daysDiff =
        (toDateTime.getTime() - fromDateTime.getTime()) / (1000 * 60 * 60 * 24);
      const useHourly = daysDiff <= 2;

      let daily: ReportsDailyPoint[] = [];

      if (useHourly) {
        // Query data in 2-hour periods for the daily revenue chart
        const hourlyPoints = db
          .prepare(
            `
          SELECT
            DATE(completed_at, 'localtime') AS date,
            CAST(STRFTIME('%H', completed_at, 'localtime') AS INTEGER) / 2 AS hour,
            COALESCE(SUM(total), 0) AS revenue,
            COUNT(*) AS sales_count
          FROM sale
          WHERE status = 'completed'
            AND DATE(completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
          GROUP BY DATE(completed_at, 'localtime'), CAST(STRFTIME('%H', completed_at, 'localtime') AS INTEGER) / 2
          ORDER BY DATE(completed_at, 'localtime') ASC, CAST(STRFTIME('%H', completed_at, 'localtime') AS INTEGER) / 2 ASC
          `
          )
          .all(fromDate, toDate) as Array<{
          date: string;
          hour: number;
          revenue: number;
          sales_count: number;
        }>;
        daily = hourlyPoints.map((p) => ({
          date: p.date,
          hour: p.hour,
          revenue: Number(p.revenue),
          sales_count: Number(p.sales_count)
        }));
      } else {
        // Query daily data
        daily = db
          .prepare(
            `
          SELECT
            DATE(completed_at, 'localtime') AS date,
            COALESCE(SUM(total), 0) AS revenue,
            COUNT(*) AS sales_count
          FROM sale
          WHERE status = 'completed'
            AND DATE(completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
          GROUP BY DATE(completed_at, 'localtime')
          ORDER BY DATE(completed_at, 'localtime') ASC
          `
          )
          .all(fromDate, toDate) as ReportsDailyPoint[];
      }

      const topProductsByRevenue = db
        .prepare(
          `
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.unit_type AS unit_type,
          COALESCE(SUM(si.total), 0) AS revenue,
          COALESCE(SUM(si.quantity), 0) AS quantity
        FROM sale_item si
        JOIN sale s ON s.id = si.sale_id
        JOIN product p ON p.id = si.product_id
        WHERE s.status = 'completed'
          AND DATE(s.completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
        GROUP BY p.id, p.name, p.unit_type
        ORDER BY revenue DESC
        LIMIT 10
        `
        )
        .all(fromDate, toDate) as ReportsTopProduct[];

      const topProductsByQuantity = db
        .prepare(
          `
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.unit_type AS unit_type,
          COALESCE(SUM(si.total), 0) AS revenue,
          COALESCE(SUM(si.quantity), 0) AS quantity
        FROM sale_item si
        JOIN sale s ON s.id = si.sale_id
        JOIN product p ON p.id = si.product_id
        WHERE s.status = 'completed'
          AND DATE(s.completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
        GROUP BY p.id, p.name, p.unit_type
        ORDER BY quantity DESC
        LIMIT 10
        `
        )
        .all(fromDate, toDate) as ReportsTopProduct[];

      const paymentRows = db
        .prepare(
          `
        SELECT
          payment.method AS method,
          COUNT(*) AS sales_count,
          COALESCE(SUM(payment.amount), 0) AS revenue
        FROM payment
        JOIN sale ON sale.id = payment.sale_id
        WHERE sale.status = 'completed'
          AND DATE(sale.completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
        GROUP BY payment.method
        `
        )
        .all(fromDate, toDate) as Array<{
        method: "cash" | "pix" | "card";
        sales_count: number;
        revenue: number;
      }>;

      const paymentByMethod = new Map(
        paymentRows.map((row) => [row.method, row])
      );
      const paymentBreakdown = (["cash", "pix", "card"] as const).map(
        (method) => {
          const row = paymentByMethod.get(method);
          const revenue = Number(row?.revenue ?? 0);
          return {
            method,
            sales_count: Number(row?.sales_count ?? 0),
            revenue,
            percent: totalRevenue > 0 ? (revenue / totalRevenue) * 100 : 0
          };
        }
      ) satisfies ReportsPaymentBreakdownItem[];

      const history = db
        .prepare(
          `
        SELECT
          sale.id AS sale_id,
          COALESCE(sale.completed_at, sale.started_at) AS event_at,
          sale.total AS total,
          payment.method AS payment_method,
          sale.status AS status
        FROM sale
        LEFT JOIN payment ON payment.sale_id = sale.id
        WHERE DATE(COALESCE(sale.completed_at, sale.started_at), 'localtime') BETWEEN DATE(?) AND DATE(?)
        ORDER BY COALESCE(sale.completed_at, sale.started_at) DESC
        LIMIT 50
        `
        )
        .all(fromDate, toDate) as ReportsHistoryItem[];

      const stockAlerts = db
        .prepare(
          `
        SELECT
          p.id AS product_id,
          p.name AS product_name,
          p.unit_type AS unit_type,
          p.stock_qty AS stock_qty,
          p.stock_alert_qty AS stock_alert_qty,
          CASE WHEN p.stock_qty = 0 THEN 'out' ELSE 'low' END AS status
        FROM product p
        WHERE p.stock_qty <= p.stock_alert_qty AND p.stock_alert_qty > 0
        ORDER BY status ASC, p.stock_qty ASC, p.name ASC
        LIMIT 10
        `
        )
        .all() as ReportsStockAlertItem[];

      const productOptions = db
        .prepare(
          `
        SELECT
          p.id AS id,
          p.name AS name,
          p.unit_type AS unit_type
        FROM product p
        ORDER BY p.name ASC
        `
        )
        .all() as ReportsProductOption[];

      const selectedProductId = payload.productId ?? productOptions[0]?.id;
      let productSeries: ReportsProductSeries | null = null;

      if (selectedProductId) {
        const productMeta = db
          .prepare("SELECT id, name, unit_type FROM product WHERE id = ?")
          .get(selectedProductId) as
          | { id: number; name: string; unit_type: "unit" | "kg" }
          | undefined;

        if (productMeta) {
          // Determine if we should use hourly granularity (for periods up to 2 days)
          const fromDateTime = new Date(`${fromDate}T00:00:00`);
          const toDateTime = new Date(`${toDate}T23:59:59`);
          const daysDiff =
            (toDateTime.getTime() - fromDateTime.getTime()) /
            (1000 * 60 * 60 * 24);
          const useHourly = daysDiff <= 2;

          let points: ReportsProductSeriesPoint[] = [];

          if (useHourly) {
            // Query data in 2-hour periods
            const hourlyPoints = db
              .prepare(
                `
              SELECT
                DATE(s.completed_at, 'localtime') AS date,
                CAST(STRFTIME('%H', s.completed_at, 'localtime') AS INTEGER) / 2 AS hour,
                COALESCE(SUM(si.quantity), 0) AS quantity,
                COALESCE(SUM(si.total), 0) AS revenue
              FROM sale_item si
              JOIN sale s ON s.id = si.sale_id
              WHERE s.status = 'completed'
                AND si.product_id = ?
                AND DATE(s.completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
              GROUP BY DATE(s.completed_at, 'localtime'), CAST(STRFTIME('%H', s.completed_at, 'localtime') AS INTEGER) / 2
              ORDER BY DATE(s.completed_at, 'localtime') ASC, CAST(STRFTIME('%H', s.completed_at, 'localtime') AS INTEGER) / 2 ASC
              `
              )
              .all(selectedProductId, fromDate, toDate) as Array<{
              date: string;
              hour: number;
              quantity: number;
              revenue: number;
            }>;
            points = hourlyPoints.map((p) => ({
              date: p.date,
              hour: p.hour,
              quantity: Number(p.quantity),
              revenue: Number(p.revenue)
            }));
          } else {
            // Query daily data
            const dailyPoints = db
              .prepare(
                `
              SELECT
                DATE(s.completed_at, 'localtime') AS date,
                COALESCE(SUM(si.quantity), 0) AS quantity,
                COALESCE(SUM(si.total), 0) AS revenue
              FROM sale_item si
              JOIN sale s ON s.id = si.sale_id
              WHERE s.status = 'completed'
                AND si.product_id = ?
                AND DATE(s.completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
              GROUP BY DATE(s.completed_at, 'localtime')
              ORDER BY DATE(s.completed_at, 'localtime') ASC
              `
              )
              .all(selectedProductId, fromDate, toDate) as Array<{
              date: string;
              quantity: number;
              revenue: number;
            }>;
            points = dailyPoints.map((p) => ({
              date: p.date,
              quantity: Number(p.quantity),
              revenue: Number(p.revenue)
            }));
          }

          const totals = db
            .prepare(
              `
            SELECT
              COALESCE(SUM(si.quantity), 0) AS total_quantity,
              COALESCE(SUM(si.total), 0) AS total_revenue
            FROM sale_item si
            JOIN sale s ON s.id = si.sale_id
            WHERE s.status = 'completed'
              AND si.product_id = ?
              AND DATE(s.completed_at, 'localtime') BETWEEN DATE(?) AND DATE(?)
            `
            )
            .get(selectedProductId, fromDate, toDate) as {
            total_quantity: number;
            total_revenue: number;
          };

          productSeries = {
            product_id: productMeta.id,
            product_name: productMeta.name,
            unit_type: productMeta.unit_type,
            total_quantity: Number(totals.total_quantity ?? 0),
            total_revenue: Number(totals.total_revenue ?? 0),
            points
          };
        }
      }

      return {
        total_sales: totalSales,
        total_revenue: totalRevenue,
        average_ticket: averageTicket,
        daily,
        top_products_by_revenue: topProductsByRevenue,
        top_products_by_quantity: topProductsByQuantity,
        payment_breakdown: paymentBreakdown,
        history,
        stock_alerts: stockAlerts,
        product_options: productOptions,
        product_series: productSeries
      } satisfies ReportsDashboardResponse;
    }
  );

  ipcMain.handle(
    "reports:saleDetail",
    (_event, payload: { saleId: number }) => {
      const sale = db
        .prepare(
          `
        SELECT
          sale.id AS sale_id,
          sale.status AS status,
          sale.started_at AS started_at,
          sale.completed_at AS completed_at,
          sale.subtotal AS subtotal,
          sale.discount_amount AS discount_amount,
          sale.total AS total,
          payment.method AS payment_method,
          payment.amount AS payment_amount,
          payment.change_amount AS payment_change_amount,
          payment.status AS payment_status,
          payment.paid_at AS paid_at
        FROM sale
        LEFT JOIN payment ON payment.sale_id = sale.id
        WHERE sale.id = ?
        LIMIT 1
        `
        )
        .get(payload.saleId) as
        | Omit<ReportsSaleDetailResponse, "items">
        | undefined;

      if (!sale) {
        throw new Error("Venda não encontrada.");
      }

      const items = db
        .prepare(
          `
        SELECT
          sale_item.id AS sale_item_id,
          sale_item.product_id AS product_id,
          product.name AS product_name,
          product.unit_type AS unit_type,
          sale_item.quantity AS quantity,
          sale_item.unit_price AS unit_price,
          sale_item.discount_amount AS discount_amount,
          sale_item.total AS total
        FROM sale_item
        JOIN product ON product.id = sale_item.product_id
        WHERE sale_item.sale_id = ?
        ORDER BY sale_item.id ASC
        `
        )
        .all(payload.saleId) as ReportsSaleDetailItem[];

      return {
        ...sale,
        items
      } satisfies ReportsSaleDetailResponse;
    }
  );

  ipcMain.handle(
    "reports:reprintReceipt",
    async (_event, payload: { saleId: number }) => {
      const exists = db
        .prepare("SELECT id FROM sale WHERE id = ? LIMIT 1")
        .get(payload.saleId) as { id: number } | undefined;
      if (!exists) {
        throw new Error("Venda não encontrada para reimpressão.");
      }
      await services.printerService.printReceipt(payload.saleId);
    }
  );

  ipcMain.handle("payment:create", (_event, payload: PaymentCreateRequest) => {
    const info = db
      .prepare(
        `
        INSERT INTO payment (sale_id, method, amount, change_amount, mp_payment_id, status)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        payload.sale_id,
        payload.method,
        payload.amount,
        payload.change_amount ?? 0,
        payload.mp_payment_id ?? null,
        payload.status ?? "confirmed"
      );
    return {
      paymentId: Number(info.lastInsertRowid)
    } satisfies PaymentCreateResponse;
  });

  ipcMain.handle("scale:readStableWeight", async () => {
    return services.getScaleService().readStableWeightKg();
  });

  ipcMain.handle("scale:getStatus", () => {
    return services.getScaleService().getStatus() satisfies ScaleStatus;
  });

  ipcMain.handle("printer:getStatus", async () => {
    return services.printerService.getStatus();
  });

  // ─── Configurações ──────────────────────────────────────────────────────

  ipcMain.handle("settings:getAll", () => {
    return getSettings() satisfies AppSettings;
  });

  ipcMain.handle(
    "settings:update",
    async (_event, payload: SettingsUpdateRequest) => {
      const next = updateSettings(payload);
      if (touchesScale(payload)) {
        await services.reinitScale();
      }
      return next satisfies AppSettings;
    }
  );

  ipcMain.handle("system:listSerialPorts", async () => {
    const ports = await SerialPort.list();
    return ports.map((entry) => ({
      path: entry.path,
      manufacturer: entry.manufacturer ?? null
    })) satisfies SerialPortInfo[];
  });

  ipcMain.handle("printer:testPrint", async () => {
    try {
      await services.printerService.printTest();
      return { ok: true } satisfies PrinterTestResponse;
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Falha ao imprimir cupom de teste."
      } satisfies PrinterTestResponse;
    }
  });

  ipcMain.handle(
    "printer:checkNetwork",
    async (_event, payload: { address: string }) => {
      const reachable = await services.printerService.checkNetwork(
        payload.address
      );
      return { reachable } satisfies NetworkCheckResponse;
    }
  );

  // ─── Backup & dados ─────────────────────────────────────────────────────

  ipcMain.handle("data:backup", async () => {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}-${String(
      now.getHours()
    ).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const options = {
      title: "Backup do banco de dados",
      defaultPath: `market-pos-backup-${stamp}.db`,
      filters: [{ name: "SQLite", extensions: ["db"] }]
    };
    const focused = BrowserWindow.getFocusedWindow();
    const result = focused
      ? await dialog.showSaveDialog(focused, options)
      : await dialog.showSaveDialog(options);

    if (result.canceled || !result.filePath) {
      return { canceled: true } satisfies DataBackupResponse;
    }

    // Garante que o WAL esteja consolidado no arquivo principal antes de copiar.
    db.pragma("wal_checkpoint(TRUNCATE)");
    await fs.promises.copyFile(getDbPath(), result.filePath);
    return {
      canceled: false,
      path: result.filePath
    } satisfies DataBackupResponse;
  });

  ipcMain.handle("data:restore", async () => {
    const focused = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Restaurar backup",
      filters: [{ name: "SQLite", extensions: ["db"] }],
      properties: ["openFile"]
    };
    const result = focused
      ? await dialog.showOpenDialog(focused, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true } satisfies DataRestoreResponse;
    }

    const candidate = result.filePaths[0];

    // Valida que é um sqlite do PDV (tabelas esperadas) antes de trocar.
    const requiredTables = ["product", "sale", "sale_item", "payment"];
    try {
      const check = new Database(candidate, { readonly: true });
      try {
        const names = (
          check
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all() as Array<{ name: string }>
        ).map((row) => row.name);
        const valid = requiredTables.every((table) => names.includes(table));
        if (!valid) {
          return { canceled: false, invalid: true } satisfies DataRestoreResponse;
        }
      } finally {
        check.close();
      }
    } catch {
      return { canceled: false, invalid: true } satisfies DataRestoreResponse;
    }

    const dbPath = getDbPath();
    // Backup automático do banco atual antes de sobrescrever.
    db.pragma("wal_checkpoint(TRUNCATE)");
    await fs.promises.copyFile(dbPath, `${dbPath}.pre-restore`);

    db.close();
    await fs.promises.copyFile(candidate, dbPath);
    // Remove WAL/SHM antigos para não misturar com o banco restaurado.
    for (const suffix of ["-wal", "-shm"]) {
      await fs.promises.rm(`${dbPath}${suffix}`, { force: true });
    }

    app.relaunch();
    app.exit(0);
    return { canceled: false, restored: true } satisfies DataRestoreResponse;
  });

  ipcMain.handle("data:clearStock", () => {
    clearStock(db);
    return { cleared: true } satisfies DataClearStockResponse;
  });
}
