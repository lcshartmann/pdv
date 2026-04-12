export type UnitType = "unit" | "kg";
export type SaleStatus = "open" | "completed" | "cancelled";
export type PaymentMethod = "cash" | "pix" | "card";
export type PaymentStatus = "confirmed" | "pending";

export interface Product {
  id: number;
  name: string;
  barcode: string | null;
  unit_type: UnitType;
  price_per_unit: number;
  stock_qty: number;
  stock_alert_qty: number;
  category_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  total: number;
}

export interface Payment {
  id: number;
  sale_id: number;
  method: PaymentMethod;
  amount: number;
  change_amount: number;
  mp_payment_id: string | null;
  status: PaymentStatus;
  paid_at: string;
}

export interface SaleCreateResponse {
  saleId: number;
}

export interface SaleAddItemRequest {
  saleId: number;
  productId: number;
  quantity: number;
}

export interface SaleAddItemResponse {
  item: SaleItem;
}

export interface SaleRemoveItemRequest {
  saleId: number;
  saleItemId: number;
}

export interface SaleUpdateItemQuantityRequest {
  saleId: number;
  saleItemId: number;
  quantity: number;
}

export interface SaleCompleteRequest {
  saleId: number;
}

export interface SaleCancelRequest {
  saleId: number;
}

export interface ProductCreateRequest {
  name: string;
  barcode?: string;
  unit_type: UnitType;
  price_per_unit: number;
  stock_qty?: number;
  stock_alert_qty?: number;
  category_id?: number;
}

export interface ProductCreateResponse {
  productId: number;
}

export interface ProductUpdateRequest {
  id: number;
  name: string;
  barcode?: string;
  unit_type: UnitType;
  price_per_unit: number;
  stock_qty: number;
  stock_alert_qty: number;
  category_id?: number;
}

export interface PaymentCreateRequest {
  sale_id: number;
  method: PaymentMethod;
  amount: number;
  change_amount?: number;
  mp_payment_id?: string;
  status?: PaymentStatus;
}

export interface PaymentCreateResponse {
  paymentId: number;
}

export interface ScaleStatus {
  connected: boolean;
  portPath: string;
  lastWeightKg: number | null;
  lastUpdateAt: string | null;
}

export interface RendererApi {
  saleCreate: () => Promise<SaleCreateResponse>;
  saleAddItem: (payload: SaleAddItemRequest) => Promise<SaleAddItemResponse>;
  saleRemoveItem: (payload: SaleRemoveItemRequest) => Promise<void>;
  saleUpdateItemQuantity: (payload: SaleUpdateItemQuantityRequest) => Promise<SaleAddItemResponse>;
  saleComplete: (payload: SaleCompleteRequest) => Promise<void>;
  saleCancel: (payload: SaleCancelRequest) => Promise<void>;
  productList: () => Promise<Product[]>;
  categoryList: () => Promise<Category[]>;
  productCreate: (payload: ProductCreateRequest) => Promise<ProductCreateResponse>;
  productUpdate: (payload: ProductUpdateRequest) => Promise<void>;
  paymentCreate: (payload: PaymentCreateRequest) => Promise<PaymentCreateResponse>;
  scaleGetStatus: () => Promise<ScaleStatus>;
  scaleReadStableWeight: () => Promise<number>;
}
