import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import type {
  Category,
  PaymentCreateRequest,
  PaymentCreateResponse,
  Product,
  ProductCreateRequest,
  ProductCreateResponse,
  ProductReceiveStockRequest,
  ProductUpdateRequest,
  SaleAddItemRequest,
  SaleAddItemResponse,
  SaleCancelRequest,
  SaleCompleteRequest,
  SaleCreateResponse,
  SaleItem,
  SaleRemoveItemRequest,
  ScaleStatus,
  SaleUpdateItemQuantityRequest
} from "../shared/types";
import { PrinterService } from "./services/printer";
import { ScaleService } from "./services/scale";

interface SaleAggregate {
  subtotal: number;
  discount_amount: number;
}

interface IpcServices {
  scaleService: ScaleService;
  printerService: PrinterService;
}

export function registerIpcHandlers(db: Database.Database, services: IpcServices): void {
  const recalculateSaleTotals = (saleId: number): void => {
    const aggregate = db
      .prepare(
        `
        SELECT
          COALESCE(SUM(sale_item.total), 0) AS subtotal,
          COALESCE(MAX(sale.discount_amount), 0) AS discount_amount
        FROM sale_item
        JOIN sale ON sale.id = sale_item.sale_id
        WHERE sale_item.sale_id = ?
        `
      )
      .get(saleId) as SaleAggregate;

    const subtotal = Number(aggregate.subtotal ?? 0);
    const discount = Number(aggregate.discount_amount ?? 0);
    const total = subtotal - discount;

    db.prepare("UPDATE sale SET subtotal = ?, total = ? WHERE id = ?").run(subtotal, total, saleId);
  };

  ipcMain.handle("sale:create", () => {
    const info = db.prepare("INSERT INTO sale (status, subtotal, discount_amount, total) VALUES ('open', 0, 0, 0)").run();
    return { saleId: Number(info.lastInsertRowid) } satisfies SaleCreateResponse;
  });

  ipcMain.handle("sale:addItem", (_event, payload: SaleAddItemRequest) => {
    const product = db
      .prepare("SELECT id, price_per_unit FROM product WHERE id = ?")
      .get(payload.productId) as { id: number; price_per_unit: number } | undefined;
    if (!product) {
      throw new Error("Product not found.");
    }

    const quantity = Number(payload.quantity);
    if (quantity <= 0) {
      throw new Error("Quantity must be greater than 0.");
    }

    const existing = db
      .prepare(
        "SELECT id, quantity, discount_amount FROM sale_item WHERE sale_id = ? AND product_id = ? AND unit_price = ? LIMIT 1"
      )
      .get(payload.saleId, payload.productId, product.price_per_unit) as
      | { id: number; quantity: number; discount_amount: number }
      | undefined;

    let itemId: number;
    if (existing) {
      const newQuantity = Number(existing.quantity) + quantity;
      const newTotal = newQuantity * Number(product.price_per_unit) - Number(existing.discount_amount);
      db.prepare("UPDATE sale_item SET quantity = ?, total = ? WHERE id = ?").run(newQuantity, newTotal, existing.id);
      itemId = existing.id;
    } else {
      const info = db
        .prepare(
          "INSERT INTO sale_item (sale_id, product_id, quantity, unit_price, discount_amount, total) VALUES (?, ?, ?, ?, 0, ?)"
        )
        .run(payload.saleId, payload.productId, quantity, product.price_per_unit, quantity * Number(product.price_per_unit));
      itemId = Number(info.lastInsertRowid);
    }

    recalculateSaleTotals(payload.saleId);

    const item = db.prepare("SELECT * FROM sale_item WHERE id = ?").get(itemId) as SaleItem;
    return { item } satisfies SaleAddItemResponse;
  });

  ipcMain.handle("sale:removeItem", (_event, payload: SaleRemoveItemRequest) => {
    db.prepare("DELETE FROM sale_item WHERE id = ? AND sale_id = ?").run(payload.saleItemId, payload.saleId);
    recalculateSaleTotals(payload.saleId);
  });

  ipcMain.handle("sale:updateItemQuantity", (_event, payload: SaleUpdateItemQuantityRequest) => {
    const quantity = Number(payload.quantity);
    if (quantity <= 0) {
      throw new Error("Quantity must be greater than 0.");
    }

    const existing = db
      .prepare("SELECT id, unit_price, discount_amount FROM sale_item WHERE id = ? AND sale_id = ?")
      .get(payload.saleItemId, payload.saleId) as { id: number; unit_price: number; discount_amount: number } | undefined;

    if (!existing) {
      throw new Error("Sale item not found.");
    }

    const total = quantity * Number(existing.unit_price) - Number(existing.discount_amount);
    db.prepare("UPDATE sale_item SET quantity = ?, total = ? WHERE id = ? AND sale_id = ?").run(
      quantity,
      total,
      payload.saleItemId,
      payload.saleId
    );

    recalculateSaleTotals(payload.saleId);

    const item = db.prepare("SELECT * FROM sale_item WHERE id = ?").get(payload.saleItemId) as SaleItem;
    return { item } satisfies SaleAddItemResponse;
  });

  ipcMain.handle("sale:complete", async (_event, payload: SaleCompleteRequest) => {
    const completeSaleTx = db.transaction((saleId: number) => {
      const sale = db
        .prepare("SELECT id, status FROM sale WHERE id = ?")
        .get(saleId) as { id: number; status: "open" | "completed" | "cancelled" } | undefined;

      if (!sale) {
        throw new Error("Sale not found.");
      }

      if (sale.status !== "open") {
        throw new Error("Only open sales can be completed.");
      }

      const items = db
        .prepare("SELECT product_id, quantity FROM sale_item WHERE sale_id = ?")
        .all(saleId) as Array<{ product_id: number; quantity: number }>;

      db.prepare("UPDATE sale SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(saleId);

      const updateStock = db.prepare("UPDATE product SET stock_qty = stock_qty - ?, updated_at = datetime('now') WHERE id = ?");
      const insertMovement = db.prepare(
        "INSERT INTO stock_movement (product_id, type, qty_change, reason) VALUES (?, 'sale', ?, ?)"
      );

      for (const item of items) {
        const qty = Number(item.quantity);
        updateStock.run(qty, item.product_id);
        insertMovement.run(item.product_id, -qty, `sale:${saleId}`);
      }
    });

    completeSaleTx(payload.saleId);
    await services.printerService.printReceipt(payload.saleId);
  });

  ipcMain.handle("sale:cancel", (_event, payload: SaleCancelRequest) => {
    db.prepare("UPDATE sale SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status = 'open'").run(
      payload.saleId
    );
  });

  ipcMain.handle("product:list", () => {
    return db.prepare("SELECT * FROM product ORDER BY name ASC").all() as Product[];
  });

  ipcMain.handle("category:list", () => {
    return db.prepare("SELECT * FROM category ORDER BY name ASC").all() as Category[];
  });

  ipcMain.handle("product:create", (_event, payload: ProductCreateRequest) => {
    try {
      const normalizedBarcode = payload.barcode?.trim() ? payload.barcode.trim() : null;
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

      return { productId: Number(info.lastInsertRowid) } satisfies ProductCreateResponse;
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

  ipcMain.handle("product:receiveStock", (_event, payload: ProductReceiveStockRequest) => {
    const quantity = Number(payload.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Quantidade de entrada deve ser maior que zero.");
    }

    const tx = db.transaction(() => {
      const product = db
        .prepare("SELECT id FROM product WHERE id = ?")
        .get(payload.product_id) as { id: number } | undefined;

      if (!product) {
        throw new Error("Produto não encontrado.");
      }

      db.prepare("UPDATE product SET stock_qty = stock_qty + ?, updated_at = datetime('now') WHERE id = ?").run(
        quantity,
        payload.product_id
      );
      db.prepare("INSERT INTO stock_movement (product_id, type, qty_change, reason) VALUES (?, 'restock', ?, ?)").run(
        payload.product_id,
        quantity,
        "catalog:manual_restock"
      );
    });

    tx();
  });

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
    return { paymentId: Number(info.lastInsertRowid) } satisfies PaymentCreateResponse;
  });

  ipcMain.handle("scale:readStableWeight", async () => {
    return services.scaleService.readStableWeightKg();
  });

  ipcMain.handle("scale:getStatus", () => {
    return services.scaleService.getStatus() satisfies ScaleStatus;
  });
}
