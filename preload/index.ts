import { contextBridge, ipcRenderer } from "electron";
import type { RendererApi } from "../src/shared/types";

const api: RendererApi = {
  saleCreate: () => ipcRenderer.invoke("sale:create"),
  saleAddItem: (payload) => ipcRenderer.invoke("sale:addItem", payload),
  saleRemoveItem: (payload) => ipcRenderer.invoke("sale:removeItem", payload),
  saleUpdateItemQuantity: (payload) => ipcRenderer.invoke("sale:updateItemQuantity", payload),
  saleComplete: (payload) => ipcRenderer.invoke("sale:complete", payload),
  saleCancel: (payload) => ipcRenderer.invoke("sale:cancel", payload),
  productList: () => ipcRenderer.invoke("product:list"),
  categoryList: () => ipcRenderer.invoke("category:list"),
  productCreate: (payload) => ipcRenderer.invoke("product:create", payload),
  productUpdate: (payload) => ipcRenderer.invoke("product:update", payload),
  paymentCreate: (payload) => ipcRenderer.invoke("payment:create", payload),
  scaleGetStatus: () => ipcRenderer.invoke("scale:getStatus"),
  scaleReadStableWeight: () => ipcRenderer.invoke("scale:readStableWeight")
};

contextBridge.exposeInMainWorld("api", api);
