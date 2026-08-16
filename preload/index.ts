import { contextBridge, ipcRenderer } from "electron";
import type { RendererApi } from "../src/shared/types";

const api: RendererApi = {
  saleCreate: () => ipcRenderer.invoke("sale:create"),
  saleAddItem: (payload) => ipcRenderer.invoke("sale:addItem", payload),
  saleRemoveItem: (payload) => ipcRenderer.invoke("sale:removeItem", payload),
  saleRemoveLastItem: (payload) => ipcRenderer.invoke("sale:removeLastItem", payload),
  saleUpdateItemQuantity: (payload) => ipcRenderer.invoke("sale:updateItemQuantity", payload),
  saleSetItemDiscount: (payload) => ipcRenderer.invoke("sale:setItemDiscount", payload),
  saleComplete: (payload) => ipcRenderer.invoke("sale:complete", payload),
  saleCancel: (payload) => ipcRenderer.invoke("sale:cancel", payload),
  productList: () => ipcRenderer.invoke("product:list"),
  categoryList: () => ipcRenderer.invoke("category:list"),
  productCreate: (payload) => ipcRenderer.invoke("product:create", payload),
  productUpdate: (payload) => ipcRenderer.invoke("product:update", payload),
  productExport: () => ipcRenderer.invoke("product:export"),
  productImportValidate: () => ipcRenderer.invoke("product:importValidate"),
  productImportCommit: (payload) => ipcRenderer.invoke("product:importCommit", payload),
  paymentCreate: (payload) => ipcRenderer.invoke("payment:create", payload),
  reportsDashboard: (payload) => ipcRenderer.invoke("reports:dashboard", payload),
  reportsSaleDetail: (payload) => ipcRenderer.invoke("reports:saleDetail", payload),
  reportsReprintReceipt: (payload) => ipcRenderer.invoke("reports:reprintReceipt", payload),
  scaleGetStatus: () => ipcRenderer.invoke("scale:getStatus"),
  scaleReadStableWeight: () => ipcRenderer.invoke("scale:readStableWeight"),
  printerGetStatus: () => ipcRenderer.invoke("printer:getStatus"),
  settingsGetAll: () => ipcRenderer.invoke("settings:getAll"),
  settingsUpdate: (payload) => ipcRenderer.invoke("settings:update", payload),
  listSerialPorts: () => ipcRenderer.invoke("system:listSerialPorts"),
  printerTest: () => ipcRenderer.invoke("printer:testPrint"),
  printerCheckNetwork: (payload) =>
    ipcRenderer.invoke("printer:checkNetwork", payload),
  dataBackup: () => ipcRenderer.invoke("data:backup"),
  dataRestore: () => ipcRenderer.invoke("data:restore"),
  dataClearStock: () => ipcRenderer.invoke("data:clearStock")
};

contextBridge.exposeInMainWorld("api", api);
