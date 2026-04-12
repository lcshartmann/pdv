import path from "node:path";
import { app, BrowserWindow } from "electron";
import { initializeDatabase } from "./db";
import { registerIpcHandlers } from "./ipc";
import { PaymentService } from "./services/payment";
import { PrinterService } from "./services/printer";
import { ScaleService } from "./services/scale";

let scaleService: ScaleService | null = null;

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

  scaleService = new ScaleService();
  scaleService.start();
  const printerService = new PrinterService();
  const paymentService = new PaymentService();
  registerIpcHandlers(db, { scaleService, printerService });
  void [scaleService, printerService, paymentService];

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
