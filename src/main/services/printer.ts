import * as fs from "node:fs";
import { getDb } from "../db";

let escpos: typeof import("escpos") | null = null;
try {
  escpos = require("escpos");
} catch {
  escpos = null;
}

let UsbAdapter: typeof import("escpos-usb") | null = null;
try {
  UsbAdapter = require("escpos-usb");
} catch {
  UsbAdapter = null;
}

let NetworkAdapter: typeof import("escpos-network") | null = null;
try {
  NetworkAdapter = require("escpos-network");
} catch {
  NetworkAdapter = null;
}

interface PrinterAdapter {
  open(callback: (err?: Error) => void): void;
  write(data: Buffer, callback: (err?: Error) => void): void;
  close(callback?: (err?: Error) => void): void;
}

function getPrinterConfig(): {
  type: "usb" | "network" | "file";
  address: string;
} {
  const type = (process.env.MARKET_POS_PRINTER_TYPE ?? "file") as
    | "usb"
    | "network"
    | "file";
  const address = process.env.MARKET_POS_PRINTER_ADDRESS ?? "";
  return { type, address };
}

function getStoreName(): string {
  return process.env.MARKET_POS_STORE_NAME ?? "Mercado Familiar";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function formatDateTime(dateStr: string): string {
  const date = new Date(
    dateStr.includes("T") ? dateStr : dateStr.replace(" ", "T")
  );
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function padEnd(str: string, len: number): string {
  if (str.length >= len) {
    return str.substring(0, len);
  }
  return str + " ".repeat(len - str.length);
}

class FileAdapter implements PrinterAdapter {
  private fd: number | null = null;
  private resolvedPath: string | null = null;
  

  constructor(private basePath: string) {}

  open(callback: (err?: Error) => void): void {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const filePath = fs.existsSync(this.basePath) && fs.statSync(this.basePath).isDirectory()
      ? `${this.basePath}/receipt-${timestamp}.txt`
      : this.basePath;
    this.resolvedPath = filePath;
    fs.open(filePath, "w", (err: Error | null, fd: number) => {
      if (err) {
        callback(err);
        return;
      }
      this.fd = fd;
      callback();
    });
  }

  write(data: Buffer, callback: (err?: Error) => void): void {
    if (this.fd === null) {
      callback(new Error("Impressora desconectada."));
      return;
    }
    fs.write(this.fd, data, 0, data.length, null, (err: Error | null) => {
      callback(err ?? undefined);
    });
  }

  close(callback?: (err?: Error) => void): void {
    if (this.fd !== null) {
      fs.close(this.fd, (err: Error | null) => {
        this.fd = null;
        if (callback) callback(err ?? undefined);
      });
    } else if (callback) {
      callback();
    }
  }
}

function createAdapter(config: {
  type: "usb" | "network" | "file";
  address: string;
}): PrinterAdapter {
  if (config.type === "network") {
    if (!NetworkAdapter) {
      throw new Error(
        "Adaptador de rede não disponível. Instale 'escpos-network'."
      );
    }
    const parts = config.address.split(":");
    const host = parts[0];
    const port = parts[1] ? Number(parts[1]) : 9100;
    if (!host) {
      throw new Error(
        "Endereço de rede da impressora não configurado. Defina MARKET_POS_PRINTER_ADDRESS."
      );
    }
    return new NetworkAdapter(host, port) as unknown as PrinterAdapter;
  }

  if (config.type === "file") {
    const devicePath = config.address || "/dev/usb/lp0";
    return new FileAdapter(devicePath);
  }

  // USB
  if (!UsbAdapter) {
    throw new Error("Adaptador USB não disponível. Instale 'escpos-usb'.");
  }
  try {
    if (config.address) {
      const parts = config.address.split(":");
      if (parts.length === 2) {
        const vid = Number(parts[0]);
        const pid = Number(parts[1]);
        return new UsbAdapter(vid, pid) as unknown as PrinterAdapter;
      }
    }
    return new UsbAdapter() as unknown as PrinterAdapter;
  } catch {
    throw new Error("Impressora USB não encontrada. Verifique a conexão.");
  }
}

function openAdapter(adapter: PrinterAdapter): Promise<void> {
  return new Promise((resolve, reject) => {
    adapter.open((err?: Error) => {
      if (err) {
        reject(
          new Error(`Não foi possível conectar à impressora: ${err.message}`)
        );
        return;
      }
      resolve();
    });
  });
}

interface ClosablePrinter {
  close(callback?: (err?: Error) => void): unknown;
}

function safeClose(
  printer: ClosablePrinter,
  adapter: PrinterAdapter
): Promise<void> {
  return new Promise((resolve) => {
    try {
      printer.close(() => {
        adapter.close(() => {
          resolve();
        });
      });
    } catch {
      try {
        adapter.close(() => {
          resolve();
        });
      } catch {
        resolve();
      }
    }
  });
}

export class PrinterService {
  async printReceipt(saleId: number): Promise<void> {
    if (!escpos) {
      throw new Error("Biblioteca de impressão não disponível.");
    }

    const db = getDb();
    const config = getPrinterConfig();

    const sale = db
      .prepare(
        `
        SELECT
          s.id,
          s.subtotal,
          s.discount_amount,
          s.total,
          s.completed_at,
          p.method AS payment_method,
          p.amount AS payment_amount,
          p.change_amount AS payment_change_amount
        FROM sale s
        LEFT JOIN payment p ON p.sale_id = s.id
        WHERE s.id = ?
        LIMIT 1
        `
      )
      .get(saleId) as
      | {
          id: number;
          subtotal: number;
          discount_amount: number;
          total: number;
          completed_at: string;
          payment_method: string | null;
          payment_amount: number | null;
          payment_change_amount: number | null;
        }
      | undefined;

    if (!sale) {
      throw new Error("Venda não encontrada para impressão.");
    }

    const items = db
      .prepare(
        `
        SELECT
          si.quantity,
          si.unit_price,
          si.discount_amount,
          si.total,
          pr.name AS product_name,
          pr.unit_type
        FROM sale_item si
        JOIN product pr ON pr.id = si.product_id
        WHERE si.sale_id = ?
        ORDER BY si.id ASC
        `
      )
      .all(saleId) as Array<{
      quantity: number;
      unit_price: number;
      discount_amount: number;
      total: number;
      product_name: string;
      unit_type: "unit" | "kg";
    }>;
    
    const adapter = createAdapter(config);
    const printer = await escpos.Printer.create(adapter);

    await openAdapter(adapter);

    const paymentMethodLabel: Record<string, string> = {
      cash: "Dinheiro",
      pix: "PIX",
      card: "Cartão"
    };

    try {
      printer
        .font("a")
        .align("ct")
        .style("b")
        .size(2, 2)
        .text(getStoreName())
        .style("normal")
        .size(1, 1)
        .newLine()
        .text(`Venda #${String(sale.id).padStart(4, "0")}`)
        .text(formatDateTime(sale.completed_at))
        .drawLine();

      printer.align("lt").text("Item                     Qtd   Un.      Total");
      printer.drawLine();

      for (const item of items) {
        const qtyLabel =
          item.unit_type === "kg"
            ? item.quantity.toFixed(3).replace(".", ",")
            : String(Math.round(item.quantity));
        const unitLabel = item.unit_type === "kg" ? "kg" : "un";
        const itemLine = `${padEnd(item.product_name, 24)} ${padEnd(qtyLabel, 5)} ${padEnd(unitLabel, 3)} ${padEnd(formatCurrency(item.total), 12)}`;
        printer.text(itemLine);
      }

      printer.drawLine();

      printer.align("rt");
      printer.text(`Subtotal: ${formatCurrency(sale.subtotal)}`);
      if (sale.discount_amount > 0) {
        printer.text(`Desconto: -${formatCurrency(sale.discount_amount)}`);
      }
      printer
        .style("b")
        .size(1, 1)
        .text(`TOTAL: ${formatCurrency(sale.total)}`)
        .style("normal")
        .size(1, 1);
      printer.drawLine();

      printer.align("lt");
      printer.text(
        `Pagamento: ${sale.payment_method ? (paymentMethodLabel[sale.payment_method] ?? sale.payment_method) : "—"}`
      );
      if (sale.payment_amount !== null && sale.payment_amount !== undefined) {
        printer.text(`Recebido: ${formatCurrency(sale.payment_amount)}`);
      }
      if (
        sale.payment_change_amount !== null &&
        sale.payment_change_amount !== undefined &&
        Number(sale.payment_change_amount) > 0
      ) {
        printer.text(`Troco: ${formatCurrency(sale.payment_change_amount)}`);
      }
      printer.drawLine();

      printer.align("ct").text("Consulte esta venda pelo QR Code");

      await new Promise<void>((resolve, reject) => {
        printer.qrimage(
          `market-pos://sale/${sale.id}`,
          { type: "png", mode: "dhdw" },
          (err: Error | null) => {
            if (err) {
              reject(new Error(`Falha ao gerar QR Code: ${err.message}`));
              return;
            }
            resolve();
          }
        );
      });

      printer
        .newLine()
        .text("Obrigado pela preferência!")
        .text("Volte sempre!");
      printer.cut();
      await printer.close();
    } catch (error) {
      await safeClose(printer, adapter);
      throw error;
    }
  }
}
