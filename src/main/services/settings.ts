import { getDb } from "../db";
import type { AppSettings, PrinterType } from "../../shared/types";

/**
 * Defaults hardcoded — antes vinham de env vars (SCALE_PORT, MARKET_POS_*),
 * hoje removidas. São semeados no primeiro boot e servem de fallback para
 * qualquer chave ausente na tabela `setting`.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  scalePort: "/dev/ttyUSB0",
  scaleBaudRate: 9600,
  scaleTimeoutMs: 4000,
  scaleStableFramesRequired: 2,
  scaleReconnectDelayMs: 1500,
  scaleUsbPollIntervalMs: 1000,
  printerType: "file",
  printerAddress: "",
  storeName: "Mercado Familiar",
  receiptFooter: "Obrigado pela preferência!\nVolte sempre!",
  receiptShowQr: true,
  storeCnpj: "",
  storeAddress: "",
  storePhone: ""
};

/** Chaves cuja mudança exige re-init a quente da balança. */
export const SCALE_KEYS: ReadonlyArray<keyof AppSettings> = [
  "scalePort",
  "scaleBaudRate",
  "scaleTimeoutMs",
  "scaleStableFramesRequired",
  "scaleReconnectDelayMs",
  "scaleUsbPollIntervalMs"
];

const PRINTER_TYPES: ReadonlyArray<PrinterType> = ["usb", "network", "file"];

const KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>;

function isKnownKey(key: string): key is keyof AppSettings {
  return (KEYS as string[]).includes(key);
}

/** Lê todas as configs mesclando o que está no banco sobre os defaults. */
export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM setting").all() as Array<{
    key: string;
    value: string;
  }>;

  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!isKnownKey(row.key)) {
      continue;
    }
    try {
      (merged as unknown as Record<string, unknown>)[row.key] = JSON.parse(
        row.value
      );
    } catch {
      // valor corrompido: mantém o default já em `merged`.
    }
  }
  return merged;
}

/** Grava os defaults no primeiro boot (quando a tabela ainda está vazia). */
export function seedSettingsIfEmpty(): void {
  const db = getDb();
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM setting")
    .get() as { count: number };
  if (count > 0) {
    return;
  }
  const insert = db.prepare(
    "INSERT INTO setting (key, value) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const key of KEYS) {
      insert.run(key, JSON.stringify(DEFAULT_SETTINGS[key]));
    }
  });
  tx();
}

function coerceValue(key: keyof AppSettings, value: unknown): unknown {
  const expected = typeof DEFAULT_SETTINGS[key];

  if (key === "printerType") {
    if (!PRINTER_TYPES.includes(value as PrinterType)) {
      throw new Error(`Tipo de impressora inválido: ${String(value)}`);
    }
    return value;
  }

  if (expected === "number") {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`Valor numérico inválido para ${key}.`);
    }
    // Todos os números de config são positivos (porta, baud, timeouts...).
    if (key !== "scaleStableFramesRequired" && num <= 0) {
      throw new Error(`${key} deve ser maior que zero.`);
    }
    if (key === "scaleStableFramesRequired" && num < 1) {
      throw new Error("Frames estáveis deve ser ao menos 1.");
    }
    return num;
  }

  if (expected === "boolean") {
    return Boolean(value);
  }

  // string
  return String(value ?? "");
}

/**
 * Grava as chaves alteradas numa transação (upsert) e devolve o estado final.
 * Ignora chaves desconhecidas e valida/normaliza tipos.
 */
export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO setting (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  const entries = Object.entries(partial).filter(([key]) => isKnownKey(key));

  const tx = db.transaction(() => {
    for (const [key, rawValue] of entries) {
      const typedKey = key as keyof AppSettings;
      const value = coerceValue(typedKey, rawValue);
      upsert.run(typedKey, JSON.stringify(value));
    }
  });
  tx();

  return getSettings();
}

/** true se `partial` mexe em alguma chave que afeta a balança. */
export function touchesScale(partial: Partial<AppSettings>): boolean {
  return SCALE_KEYS.some((key) => key in partial);
}
