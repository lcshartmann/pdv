import path from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { initializeDatabase } from "./db";
import { registerIpcHandlers } from "./ipc";
import { PaymentService } from "./services/payment";
import { PrinterService } from "./services/printer";
import type { PrinterConfig } from "./services/printer";
import { ScaleService } from "./services/scale";
import { getSettings, seedSettingsIfEmpty } from "./services/settings";
import type { AppSettings } from "../shared/types";

let scaleService: ScaleService | null = null;

function scaleOptionsFromSettings(settings: AppSettings) {
  return {
    portPath: settings.scalePort,
    baudRate: settings.scaleBaudRate,
    timeoutMs: settings.scaleTimeoutMs,
    stableFramesRequired: settings.scaleStableFramesRequired,
    reconnectDelayMs: settings.scaleReconnectDelayMs,
    usbPollIntervalMs: settings.scaleUsbPollIntervalMs
  };
}

function printerConfigFromSettings(settings: AppSettings): PrinterConfig {
  return {
    type: settings.printerType,
    address: settings.printerAddress,
    storeName: settings.storeName,
    receiptFooter: settings.receiptFooter,
    receiptShowQr: settings.receiptShowQr,
    storeCnpj: settings.storeCnpj,
    storeAddress: settings.storeAddress,
    storePhone: settings.storePhone
  };
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "../../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, "../../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  const db = initializeDatabase(app.getPath("userData"));
  seedSettingsIfEmpty();

  scaleService = new ScaleService(scaleOptionsFromSettings(getSettings()));
  scaleService.start();
  const printerService = new PrinterService(() =>
    printerConfigFromSettings(getSettings())
  );
  const paymentService = new PaymentService();

  // Re-init a quente da balança quando o usuário salva porta/baud/etc.
  const reinitScale = async (): Promise<void> => {
    if (scaleService) {
      await scaleService.stop();
    }
    scaleService = new ScaleService(scaleOptionsFromSettings(getSettings()));
    scaleService.start();
  };

  registerIpcHandlers(db, {
    getScaleService: () => scaleService as ScaleService,
    reinitScale,
    printerService
  });
  void [printerService, paymentService];

  Menu.setApplicationMenu(null);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (scaleService) {
    void scaleService.stop();
  }
});
