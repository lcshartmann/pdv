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

export interface ReportsDashboardRequest {
  fromDate: string;
  toDate: string;
  productId?: number;
}

export interface ReportsDailyPoint {
  date: string;
  revenue: number;
  sales_count: number;
}

export interface ReportsTopProduct {
  product_id: number;
  product_name: string;
  unit_type: UnitType;
  revenue: number;
  quantity: number;
}

export interface ReportsPaymentBreakdownItem {
  method: PaymentMethod;
  sales_count: number;
  revenue: number;
  percent: number;
}

export interface ReportsHistoryItem {
  sale_id: number;
  event_at: string;
  total: number;
  payment_method: PaymentMethod | null;
  status: SaleStatus;
}

export interface ReportsStockAlertItem {
  product_id: number;
  product_name: string;
  unit_type: UnitType;
  stock_qty: number;
  stock_alert_qty: number;
  status: "low" | "out";
}

export interface ReportsProductOption {
  id: number;
  name: string;
  unit_type: UnitType;
}

export interface ReportsProductSeriesPoint {
  date: string;
  hour?: number;
  quantity: number;
  revenue: number;
}

export interface ReportsProductSeries {
  product_id: number;
  product_name: string;
  unit_type: UnitType;
  total_quantity: number;
  total_revenue: number;
  points: ReportsProductSeriesPoint[];
}

export interface ReportsDashboardResponse {
  total_sales: number;
  total_revenue: number;
  average_ticket: number;
  daily: ReportsDailyPoint[];
  top_products_by_revenue: ReportsTopProduct[];
  top_products_by_quantity: ReportsTopProduct[];
  payment_breakdown: ReportsPaymentBreakdownItem[];
  history: ReportsHistoryItem[];
  stock_alerts: ReportsStockAlertItem[];
  product_options: ReportsProductOption[];
  product_series: ReportsProductSeries | null;
}

export interface ReportsSaleDetailItem {
  sale_item_id: number;
  product_id: number;
  product_name: string;
  unit_type: UnitType;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  total: number;
}

export interface ReportsSaleDetailResponse {
  sale_id: number;
  status: SaleStatus;
  started_at: string;
  completed_at: string | null;
  subtotal: number;
  discount_amount: number;
  total: number;
  payment_method: PaymentMethod | null;
  payment_amount: number | null;
  payment_change_amount: number | null;
  payment_status: PaymentStatus | null;
  paid_at: string | null;
  items: ReportsSaleDetailItem[];
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
  reportsDashboard: (payload: ReportsDashboardRequest) => Promise<ReportsDashboardResponse>;
  reportsSaleDetail: (payload: { saleId: number }) => Promise<ReportsSaleDetailResponse>;
  reportsReprintReceipt: (payload: { saleId: number }) => Promise<void>;
  scaleGetStatus: () => Promise<ScaleStatus>;
  scaleReadStableWeight: () => Promise<number>;
}
