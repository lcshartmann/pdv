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

export interface SaleRemoveLastItemRequest {
  saleId: number;
}

export interface SaleUpdateItemQuantityRequest {
  saleId: number;
  saleItemId: number;
  quantity: number;
}

export interface SaleCompleteRequest {
  saleId: number;
}

export interface SaleCompleteResponse {
  /** true quando o comprovante foi impresso com sucesso. */
  printed: boolean;
  /** true quando a impressão foi pulada por a impressora estar offline. */
  printerOffline: boolean;
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

export interface ProductExportResponse {
  /** true quando o usuário fechou o diálogo de salvar sem escolher destino. */
  canceled: boolean;
  /** Caminho absoluto do arquivo gravado (ausente quando cancelado). */
  path?: string;
}

// ─── Import de produtos (PDV-4 / PDV-5) ──────────────────────────────────────

export interface ProductImportError {
  /** Linha no arquivo (cabeçalho = 1). */
  line: number;
  message: string;
}

/** Linha já validada e normalizada, pronta para o commit (PDV-5). */
export interface ValidatedImportRow {
  line: number;
  op: "insert" | "update" | "unchanged";
  /** id do produto existente (apenas em update); null em insert. */
  id: number | null;
  name: string;
  barcode: string | null;
  unit_type: UnitType;
  /** número em insert; null em update (estoque é ignorado ao atualizar). */
  stock_qty: number | null;
  price_per_unit: number;
  stock_alert_qty: number;
  category_id: number | null;
  /** true quando o CSV trouxe stock_qty diferente do atual num update (ignorado). */
  stockIgnoredWarning: boolean;
}

export interface ProductImportSummary {
  toInsert: number;
  toUpdate: number;
  /** linhas com id cujos valores são idênticos ao produto atual (não gravadas). */
  unchanged: number;
  /** linhas com erro (puladas). */
  ignored: number;
  /** updates cujo stock_qty foi ignorado por ter mudado. */
  warnings: number;
}

export interface ProductImportPreview {
  fileName: string;
  summary: ProductImportSummary;
  errors: ProductImportError[];
  /** lote válido guardado no renderer para a fase de commit (main é stateless). */
  validRows: ValidatedImportRow[];
}

export type ProductImportValidateResponse =
  | { canceled: true }
  | { canceled: false; ok: false; error: string }
  | { canceled: false; ok: true; preview: ProductImportPreview };

export interface ProductImportCommitRequest {
  /** exatamente o lote validado que o renderer recebeu no preview (main stateless). */
  rows: ValidatedImportRow[];
}

export interface ProductImportCommitResponse {
  /** quantas linhas foram efetivamente gravadas (inserts + updates). */
  applied: number;
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
  hour?: number;
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

export type PrinterType = "usb" | "network" | "file";

/** Configuração completa do app, persistida na tabela `setting` (key/value). */
export interface AppSettings {
  // Balança
  scalePort: string;
  scaleBaudRate: number;
  scaleTimeoutMs: number;
  scaleStableFramesRequired: number;
  scaleReconnectDelayMs: number;
  scaleUsbPollIntervalMs: number;
  // Impressora
  printerType: PrinterType;
  printerAddress: string;
  // Identidade & recibo
  storeName: string;
  receiptFooter: string;
  receiptShowQr: boolean;
  storeCnpj: string;
  storeAddress: string;
  storePhone: string;
}

export type SettingsUpdateRequest = Partial<AppSettings>;

export interface SerialPortInfo {
  path: string;
  manufacturer: string | null;
}

export interface PrinterTestResponse {
  ok: boolean;
  /** mensagem de erro quando ok=false. */
  error?: string;
}

export interface NetworkCheckResponse {
  reachable: boolean;
}

export interface DataBackupResponse {
  canceled: boolean;
  path?: string;
}

export interface DataRestoreResponse {
  canceled: boolean;
  /** true quando o arquivo escolhido não é um banco válido do PDV. */
  invalid?: boolean;
  /** quando a restauração foi aplicada; o app reinicia em seguida. */
  restored?: boolean;
}

export interface DataClearStockResponse {
  cleared: boolean;
}

export interface ScaleStatus {
  connected: boolean;
  portPath: string;
  lastWeightKg: number | null;
  lastUpdateAt: string | null;
}

export interface PrinterStatus {
  available: boolean;
  type: "usb" | "network" | "file";
  address: string;
}

export interface RendererApi {
  saleCreate: () => Promise<SaleCreateResponse>;
  saleAddItem: (payload: SaleAddItemRequest) => Promise<SaleAddItemResponse>;
  saleRemoveItem: (payload: SaleRemoveItemRequest) => Promise<void>;
  saleRemoveLastItem: (payload: SaleRemoveLastItemRequest) => Promise<void>;
  saleUpdateItemQuantity: (payload: SaleUpdateItemQuantityRequest) => Promise<SaleAddItemResponse>;
  saleComplete: (payload: SaleCompleteRequest) => Promise<SaleCompleteResponse>;
  saleCancel: (payload: SaleCancelRequest) => Promise<void>;
  productList: () => Promise<Product[]>;
  categoryList: () => Promise<Category[]>;
  productCreate: (payload: ProductCreateRequest) => Promise<ProductCreateResponse>;
  productUpdate: (payload: ProductUpdateRequest) => Promise<void>;
  productExport: () => Promise<ProductExportResponse>;
  productImportValidate: () => Promise<ProductImportValidateResponse>;
  productImportCommit: (
    payload: ProductImportCommitRequest
  ) => Promise<ProductImportCommitResponse>;
  paymentCreate: (payload: PaymentCreateRequest) => Promise<PaymentCreateResponse>;
  reportsDashboard: (payload: ReportsDashboardRequest) => Promise<ReportsDashboardResponse>;
  reportsSaleDetail: (payload: { saleId: number }) => Promise<ReportsSaleDetailResponse>;
  reportsReprintReceipt: (payload: { saleId: number }) => Promise<void>;
  scaleGetStatus: () => Promise<ScaleStatus>;
  scaleReadStableWeight: () => Promise<number>;
  printerGetStatus: () => Promise<PrinterStatus>;
  settingsGetAll: () => Promise<AppSettings>;
  settingsUpdate: (payload: SettingsUpdateRequest) => Promise<AppSettings>;
  listSerialPorts: () => Promise<SerialPortInfo[]>;
  printerTest: () => Promise<PrinterTestResponse>;
  printerCheckNetwork: (payload: { address: string }) => Promise<NetworkCheckResponse>;
  dataBackup: () => Promise<DataBackupResponse>;
  dataRestore: () => Promise<DataRestoreResponse>;
  dataClearStock: () => Promise<DataClearStockResponse>;
}
