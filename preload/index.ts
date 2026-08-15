import { contextBridge, ipcRenderer } from "electron";
import type { RendererApi } from "../src/shared/types";

const api: RendererApi = {
  saleCreate: () => ipcRenderer.invoke("sale:create"),
  saleAddItem: (payload) => ipcRenderer.invoke("sale:addItem", payload),
  saleRemoveItem: (payload) => ipcRenderer.invoke("sale:removeItem", payload),
  saleRemoveLastItem: (payload) => ipcRenderer.invoke("sale:removeLastItem", payload),
  saleUpdateItemQuantity: (payload) => ipcRenderer.invoke("sale:updateItemQuantity", payload),
  saleComplete: (payload) => ipcRenderer.invoke("sale:complete", payload),
  saleCancel: (payload) => ipcRenderer.invoke("sale:cancel", payload),
  productList: () => ipcRenderer.invoke("product:list"),
  categoryList: () => ipcRenderer.invoke("category:list"),
  productCreate: (payload) => ipcRenderer.invoke("product:create", payload),
  productUpdate: (payload) => ipcRenderer.invoke("product:update", payload),
  productExport: () => ipcRenderer.invoke("product:export"),
  paymentCreate: (payload) => ipcRenderer.invoke("payment:create", payload),
  reportsDashboard: (payload) => ipcRenderer.invoke("reports:dashboard", payload),
  reportsSaleDetail: (payload) => ipcRenderer.invoke("reports:saleDetail", payload),
  reportsReprintReceipt: (payload) => ipcRenderer.invoke("reports:reprintReceipt", payload),
  scaleGetStatus: () => ipcRenderer.invoke("scale:getStatus"),
  scaleReadStableWeight: () => ipcRenderer.invoke("scale:readStableWeight")
};

contextBridge.exposeInMainWorld("api", api);
