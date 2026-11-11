// Thin typed client for the MIM ERP backend.
// In dev, /api is proxied to Spring Boot (see next.config.js).
// For Flutter, point at the same /api endpoints with a base URL.

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

/** Format ISO date string "yyyy-mm-dd" → "dd/mm/yyyy" for display. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

let authToken: string | null = null;
export function setToken(t: string | null) {
  authToken = t;
  if (typeof window !== "undefined") {
    if (t) localStorage.setItem("mim_token", t);
    else localStorage.removeItem("mim_token");
  }
}
export function loadToken(): string | null {
  if (authToken) return authToken;
  if (typeof window !== "undefined") authToken = localStorage.getItem("mim_token");
  return authToken;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = loadToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...init,
  });
  if (res.status === 401) {
    if (typeof window !== "undefined" && !path.endsWith("/auth/login")) {
      setToken(null);
      if (location.pathname !== "/login") location.href = "/login";
    }
    throw new Error("Not authorised");
  }
  if (res.status === 403) {
    throw new Error("You don't have permission for this.");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;   // business-rule message from backend
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  // DELETE handlers return 200 with an empty body; avoid res.json() throwing on it
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get:  <T>(p: string) => req<T>(p),
  post: <T>(p: string, body: unknown) =>
    req<T>(p, { method: "POST", body: JSON.stringify(body) }),
  put:  <T>(p: string, body: unknown) =>
    req<T>(p, { method: "PUT", body: JSON.stringify(body) }),
  del:  (p: string) => req<void>(p, { method: "DELETE" }),
};

// ---- shared types (mirror backend DTOs) ----
export type Product = {
  id: string; sku: string; name: string; nameBn?: string; type: "BOARD" | "HARDWARE";
  thicknessMm?: number; thicknessLabel?: string; unit?: string; priceLower?: number; priceUpper?: number;
  supplierId?: string; category?: string; productGroup?: string; productGroupId?: string; supplierTag?: string; edgingSize?: string; color?: string; side?: string; fullName?: string; comments?: string; active?: boolean;
};
export type Warehouse = { id: string; code: string; name: string; nameBn?: string; branch?: string; address?: string };
export type Supplier  = { id: string; code: string; name: string; nameBn?: string; mobile?: string; address?: string; groupId?: string };
export type ProductGroup = { id: string; name: string };
export type SupplierGroup = { id: string; code: string; name: string; nameBn?: string };
export type Shop      = {
  id: string; code: string; name: string; nameBn?: string; primaryLine: string;
  mobile?: string; location?: string; monthlyTarget?: number; pettyCashFloat?: number;
};
export type Customer  = {
  id: string; code: string; name: string; nameBn?: string; type: "INDIVIDUAL" | "PARTY";
  mobile?: string; address?: string; creditLimit?: number; creditDays?: number;
  deliveryAddress?: string; deliveryLandmark?: string; deliveryContactName?: string;
  deliveryContactPhone?: string; deliveryNote?: string; deliveryMapLink?: string;
};
export type Account = { id: string; code: string; name: string; nameBn?: string; type: string };

export type AccountGroup = {
  id: string; code: string; name: string; nameBn?: string;
  nature: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
  parentId?: string; system?: boolean; description?: string; active?: boolean;
};
export type LedgerRow = {
  id: string; code: string; name: string; name_bn?: string; type: string;
  group_id?: string; party_type?: string; is_system?: boolean; default_deposit?: boolean;
  description?: string; active?: boolean;
  opening_debit: number; opening_credit: number;
  period_debit: number; period_credit: number; closing: number;
};
export type PaymentRow = {
  id: string; payment_no: string; direction: "IN" | "OUT"; party_type: string; party_id: string;
  amount: number; method: string; note?: string; payment_date: string;
  bank_account_no?: string; bank_branch?: string;
  party_code?: string; party_name?: string; party_name_bn?: string;
};
export type FinancialYear = {
  id: string; name: string; startDate: string; endDate: string;
  status: "OPEN" | "CLOSED"; current?: boolean; closedAt?: string | null;
};
export type OpeningBalance = { id?: string; financialYearId?: string; accountId: string; debit: number; credit: number; };

export type Employee = {
  id: string; code: string; name: string; nameBn?: string;
  designation?: string; designationBn?: string; shopId?: string;
  mobile?: string; address?: string; joiningDate?: string;
  salaryType: "MONTHLY" | "DAILY";
  basicSalary: number; houseRent: number; medical: number; transport: number;
  otherAllowance: number; overtimeRate: number; active: boolean;
  grossSalary?: number;
};

export type PoLineView = {
  poLineId: string; productId: string; productName: string;
  qtyOrdered: number; qtyBalance: number; unitPrice: number; freeProduct: boolean;
};
export type PoView = { poId: string; poNo: string; status: string; lines: PoLineView[] };
export type PoDetails = {
  poId: string; poNo: string;
  supplierId?: string; supplierName: string;
  orderDate: string; status: string; note?: string;
  lines: PoLineView[];
  totalQty: number; totalValue: number;
};
export type PurchaseOrder = { id: string; poNo: string; supplierId: string; status: string; orderDate: string; note?: string };
export type SalesOrder = { id: string; soNo: string; customerId: string; shopId: string; workflow: string; status: string; orderDate: string };
export type DeliveryChallan = { id: string; dcNo: string; customerId: string; warehouseId: string; status: string; challanDate: string };
export type ChallanLineView = { dcLineId: string; dcNo: string; productId: string; productName: string; warehouseId?: string; qty: number; unitPrice: number; unitCost: number; discountAmt: number; priceLower?: number; priceUpper?: number };
export type SoLineView = { id: string; productId: string; productName: string; qty: number; qtyPending: number; unitPrice: number };
export type SalesReturnRow = {
  id: string; return_no: string; credit_note_no?: string; return_date: string; reason: string;
  settlement: "CREDIT_NOTE" | "CASH_REFUND"; goods_value: number; created_by?: string; so_no: string;
  customer_code: string; customer_name: string; customer_name_bn?: string;
};
export type ReturnableLine = {
  dc_line_id: string; dc_no: string; warehouse_name?: string; product_id: string; product_name: string;
  product_name_bn?: string; unit?: string; qty_delivered: number; qty_returned: number; qty_available: number;
  net_unit_price: number; unit_cost: number;
};
export type Returnable = {
  order: { id: string; so_no: string; payment_mode: "CASH" | "CREDIT"; status: string; order_date: string;
           customer_code: string; customer_name: string; customer_name_bn?: string };
  lines: ReturnableLine[];
};
export type PickupLine = { productId: string; productName: string; qty: number };
export type PickupView = { dcId: string; dcNo: string; date: string; warehouseName: string; lines: PickupLine[] };

export type WarehouseStock = { warehouseId: string; qty: number; unitCost?: number | null };
export type StockRow = { productId: string; warehouseId: string; qty: number; value: number };
export type SupplierStockRow = { supplierId: string | null; productId: string; qty: number; value: number };
export type StockStatusRow = { productId: string; onHand: number; committed: number; available: number; onOrder: number; value: number };
export type CommittedRow = { soId: string; soNo: string; orderDate: string; customerId: string; customerName: string; qtyPending: number };
export type StockSummaryRow = {
  productId: string; productGroup: string | null;
  openingQty: number; openingValue: number; inwardQty: number; inwardValue: number;
  outwardQty: number; outwardValue: number; closingQty: number; closingValue: number;
};
export type VarianceRow = {
  productId: string; warehouseId: string | null;
  minCost: number; maxCost: number; avgCost: number; qtyOnHand: number;
};

export type StmtRow = {
  kind: "heading" | "line" | "subtotal" | "total" | "gap";
  label: string; labelBn?: string; amount: number | null; prior: number | null; note: number | null;
};
export type StmtNote = {
  no: number; title: string; titleBn?: string;
  accounts: { code: string; name: string; nameBn?: string; amount: number; prior: number }[];
};
export type Statement = {
  title: string; yearName: string; yearStatus: "OPEN" | "CLOSED"; from: string; to: string;
  priorYearName: string | null; priorTo: string | null;
  rows: StmtRow[]; notes: StmtNote[];
  balanced?: boolean; difference?: number; reconciles?: boolean; netProfit?: number; bookCashClosing?: number;
};
export type EquityStatement = {
  title: string; yearName: string; yearStatus: string; from: string; to: string;
  columns: string[]; columnsBn: string[];
  rows: { kind: "line" | "total"; label: string; labelBn?: string; values: number[] }[];
};
export type TbRow = {
  code: string; name: string; name_bn?: string; type: string; group_name?: string;
  opening_debit: number; opening_credit: number; period_debit: number; period_credit: number;
  closing_debit: number; closing_credit: number;
};
export type TrialBalanceReport = {
  yearId: string; yearName: string; yearStatus: string; from: string; to: string; rows: TbRow[];
  openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number;
  closingDebit: number; closingCredit: number; balanced: boolean;
};
export type GlRow = { date: string; entryNo: string; narration?: string; sourceType?: string; debit: number; credit: number; balance: number };
export type GeneralLedger = {
  account: { id: string; code: string; name: string; name_bn?: string; type: string };
  from: string; to: string; openingBalance: number; rows: GlRow[];
  totalDebit: number; totalCredit: number; closingBalance: number;
};
export type AgingRow = {
  accountId: string; code: string; name: string; nameBn?: string;
  current: number; d31_60: number; d61_90: number; over90: number; unapplied: number; total: number;
};
export type AgingReport = {
  partyType: "CUSTOMER" | "SUPPLIER"; asOf: string; rows: AgingRow[];
  totals: { current: number; d31_60: number; d61_90: number; over90: number; unapplied: number; total: number };
};
export type CheckItem = { code: string; title: string; status: "OK" | "FAIL" | "INFO"; detail: string; figures: Record<string, number> };
export type ChecksReport = { ok: boolean; asOf: string; checks: CheckItem[] };
export type TaxSummary = {
  from: string; to: string; outputVat: number; inputVat: number; netVatPayable: number; aitWithheld: number; aitPaid: number;
};
export type BankAccountRow = { id: string; code: string; name: string; name_bn?: string; last_reconciled?: string | null; uncleared: number };
export type BankOpenLine = { id: string; entry_date: string; entry_no: string; narration?: string; debit: number; credit: number };
export type BankOpen = { asOf: string; bookBalance: number; lines: BankOpenLine[] };
export type BankHistoryRow = { id: string; statement_date: string; statement_balance: number; book_balance: number; note?: string; created_by?: string; lines: number };
export type FixedAsset = {
  id: string; code: string; name: string; category?: string; purchase_date: string; cost: number; residual_value: number;
  useful_life_months: number; status: "ACTIVE" | "DISPOSED"; disposal_date?: string; disposal_proceeds?: number;
  accumulated: number; net_book_value: number; months_charged: number;
};

export type ChequeStatus = "PENDING" | "HOLD" | "CASHED" | "POSTED" | "BOUNCED" | "CANCELLED";
export type Cheque = {
  id: string; paymentId?: string; chequeNo: string; bankName?: string; branchName?: string; customerId: string;
  amount: number; receiveDate: string; maturityDate: string;
  status: ChequeStatus; note?: string; depositAccount?: string;
  reminderForDate?: string; reminderSentAt?: string; reminderStatus?: "SENT" | "FAILED" | "SKIPPED"; reminderError?: string;
};
export type ChequeReminderSettings = { enabled: boolean; lang: "en" | "bn"; configured: boolean };
export type BounceReason = "INSUFFICIENT_FUNDS" | "SIGNATURE_MISMATCH" | "OTHER";

export type ChequeEventType = "RECEIVED" | "DATE_CHANGED" | "HOLD" | "RESUMED" | "CASHED" | "POSTED" | "BOUNCED" | "EDITED" | "CANCELLED" | "RESUBMITTED";
export type ChequeEvent = {
  id: string; chequeId: string; eventType: ChequeEventType; eventDate: string;
  oldMaturityDate?: string; newMaturityDate?: string; requestedBy?: string; note?: string; changes?: string; reason?: BounceReason;
  userName?: string; createdAt: string;
};

export type Role = "SALESPERSON" | "MANAGER" | "ACCOUNTANT" | "ADMIN";
export type Me = { token?: string; username: string; fullName?: string; role: Role; shopIds: string[] };
export type DemoInvoiceRow = { id: string; code: string; demo_date: string; customer_name?: string; customer_mobile?: string; salesperson?: string; total: number; so_id?: string | null; so_no?: string | null; created_at: string };
export type DemoInvoiceSaved = { id: string; code: string; demoDate: string; request: { customerId?: string; customerName?: string; customerMobile?: string; customerAddress?: string; salesperson?: string; salespersonBn?: string; note?: string; lines: { productId?: string; name: string; unit?: string; qty: number; unitPrice: number; discount: number }[] } };
export type AuditAction = "create" | "update" | "delete" | "restore" | "role_change" | "login" | "logout" | "login_failed";
export type AuditEntry = {
  id: number; at: string; userId?: string | null; login: string; userName: string; userRole: string;
  action: AuditAction; module: string; tableName?: string | null; recordId?: string | null;
  ipAddress?: string | null; userAgent?: string | null; fields?: string | null;
};
export type AuditDetail = AuditEntry & { oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null };
export type AuditPage = { items: AuditEntry[]; total: number; page: number; size: number };
export type AuditFacets = { modules: string[]; actions: string[]; users: { id: string; name: string; username: string }[] };
export type AuditFilter = { user?: string; module?: string; action?: string; from?: string; to?: string; recordId?: string; q?: string };
function auditQuery(f: AuditFilter): string {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v && v.trim()) p.set(k, v.trim()); });
  return p.toString();
}
export type UserView = { id: string; username: string; fullName?: string; fullNameBn?: string; mobile?: string; role: Role; active: boolean; shopIds: string[] };

export const endpoints = {
  // master
  products:   () => api.get<Product[]>("/api/master/products"),
  productGroups: () => api.get<ProductGroup[]>("/api/master/product-groups"),
  createProductGroup: (name: string) => api.post<ProductGroup>("/api/master/product-groups", { name }),
  warehouses: () => api.get<Warehouse[]>("/api/master/warehouses"),
  suppliers:  () => api.get<Supplier[]>("/api/master/suppliers"),
  supplierGroups: () => api.get<SupplierGroup[]>("/api/master/supplier-groups"),
  shops:      () => api.get<Shop[]>("/api/master/shops"),
  customers:  () => api.get<Customer[]>("/api/master/customers"),
  saveProduct:   (b: Partial<Product>)   => api.post<Product>("/api/master/products", b),
  saveSupplier:  (b: Partial<Supplier>)  => api.post<Supplier>("/api/master/suppliers", b),
  createSupplierGroup: (b: Partial<SupplierGroup>) => api.post<SupplierGroup>("/api/master/supplier-groups", b),
  saveCustomer:  (b: Partial<Customer>)  => api.post<Customer>("/api/master/customers", b),
  saveWarehouse: (b: Partial<Warehouse>) => api.post<Warehouse>("/api/master/warehouses", b),
  saveShop:      (b: Partial<Shop>)      => api.post<Shop>("/api/master/shops", b),
  updateProduct:   (id: string, b: Partial<Product>)   => api.put<Product>(`/api/master/products/${id}`, b),
  updateSupplier:  (id: string, b: Partial<Supplier>)  => api.put<Supplier>(`/api/master/suppliers/${id}`, b),
  updateSupplierGroup: (id: string, b: Partial<SupplierGroup>) => api.put<SupplierGroup>(`/api/master/supplier-groups/${id}`, b),
  updateCustomer:  (id: string, b: Partial<Customer>)  => api.put<Customer>(`/api/master/customers/${id}`, b),
  updateWarehouse: (id: string, b: Partial<Warehouse>) => api.put<Warehouse>(`/api/master/warehouses/${id}`, b),
  updateShop:      (id: string, b: Partial<Shop>)      => api.put<Shop>(`/api/master/shops/${id}`, b),
  deleteProduct:   (id: string) => api.del(`/api/master/products/${id}`),
  deleteSupplier:  (id: string) => api.del(`/api/master/suppliers/${id}`),
  deleteSupplierGroup: (id: string) => api.del(`/api/master/supplier-groups/${id}`),
  deleteCustomer:  (id: string) => api.del(`/api/master/customers/${id}`),
  deleteWarehouse: (id: string) => api.del(`/api/master/warehouses/${id}`),
  deleteShop:      (id: string) => api.del(`/api/master/shops/${id}`),

  // purchase
  createPo:    (b: unknown) => api.post<PurchaseOrder>("/api/purchase/orders", b),
  allPos:      () => api.get<PurchaseOrder[]>("/api/purchase/orders"),
  openPos:     () => api.get<PurchaseOrder[]>("/api/purchase/orders/open"),
  poDetails:   (poId: string) => api.get<PoDetails>(`/api/purchase/orders/${poId}`),
  receiveView: (poId: string) => api.get<PoView>(`/api/purchase/orders/${poId}/receive-view`),
  receive:     (poId: string, b: unknown) => api.post(`/api/purchase/orders/${poId}/receive`, b),

  // inventory
  availability: (productId: string) =>
    api.get<WarehouseStock[]>(`/api/inventory/availability?productId=${productId}`),
  stockOverview:    () => api.get<StockRow[]>("/api/inventory/overview"),
  stockBySupplier:  () => api.get<SupplierStockRow[]>("/api/inventory/overview/by-supplier"),
  stockStatus:      () => api.get<StockStatusRow[]>("/api/inventory/status"),
  committed:        (productId: string) => api.get<CommittedRow[]>(`/api/inventory/committed?productId=${productId}`),
  stockSummary:     (from: string, to: string, warehouseId?: string) =>
    api.get<StockSummaryRow[]>(`/api/inventory/stock-summary?from=${from}&to=${to}${warehouseId ? `&warehouseId=${warehouseId}` : ""}`),
  stockReportPdf: async (lang: "en" | "bn" = "en"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/inventory/stock-report?lang=${lang}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to generate stock report");
    return res.blob();
  },
  priceVariance: (scope: "warehouse" | "company") =>
    api.get<VarianceRow[]>(`/api/inventory/price-variance?scope=${scope}`),
  adjust: (b: unknown) => api.post("/api/inventory/adjustments", b),

  // sales
  createOrder:  (b: unknown) => api.post("/api/sales/orders", b),
  issueChallan: (b: unknown) => api.post("/api/sales/challans", b),
  consolidate:      (b: unknown) => api.post("/api/sales/consolidate", b),
  openChallanLines: (customerId: string) => api.get<ChallanLineView[]>(`/api/sales/challans/open/lines?customerId=${customerId}`),
  salesOrders:  () => api.get<SalesOrder[]>("/api/sales/orders"),
  salesReturns:  () => api.get<SalesReturnRow[]>("/api/sales/returns"),
  returnable:    (soId: string) => api.get<Returnable>(`/api/sales/returns/returnable/${soId}`),
  createSalesReturn: (b: unknown) => api.post<{ id: string; returnNo: string; creditNoteNo?: string; settlement: string; goodsValue: number }>("/api/sales/returns", b),
  demoInvoices: () => api.get<DemoInvoiceRow[]>("/api/sales/demo-invoice"),
  demoInvoice: (id: string) => api.get<DemoInvoiceSaved>(`/api/sales/demo-invoice/${id}`),
  linkDemoInvoice: (id: string, soId: string) => api.post<{ soNo: string }>(`/api/sales/demo-invoice/${id}/link`, { soId }),
  saveDemoInvoice: (b: unknown) => api.post<{ id: string; code: string; total: number }>("/api/sales/demo-invoice", b),
  demoInvoicePdf: async (id: string, lang: "en" | "bn" = "en"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/sales/demo-invoice/${id}/pdf?lang=${lang}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { let m = "Failed to generate the PDF"; try { m = (await res.json()).message ?? m; } catch {} throw new Error(m); }
    return res.blob();
  },
  creditNotePdf: async (id: string, lang: "en" | "bn" = "en"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/sales/returns/${id}/pdf?lang=${lang}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error("Failed to generate the PDF");
    return res.blob();
  },
  orderLines:   (soId: string) => api.get<SoLineView[]>(`/api/sales/orders/${soId}/lines`),
  fulfillOrder: (soId: string, b: unknown) => api.post<SalesOrder>(`/api/sales/orders/${soId}/fulfill`, b),
  orderPickups:  (soId: string) => api.get<PickupView[]>(`/api/sales/orders/${soId}/pickups`),
  openChallans: () => api.get<DeliveryChallan[]>("/api/sales/challans/open"),
  allChallans:  () => api.get<DeliveryChallan[]>("/api/sales/challans"),
  invoiceBlob:  async (soId: string, lang: "en" | "bn" = "en"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/sales/orders/${soId}/invoice?lang=${lang}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to generate invoice");
    return res.blob();
  },
  warehouseTokenBlob: async (soId: string, lang: "en" | "bn" = "en"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/sales/orders/${soId}/warehouse-token?lang=${lang}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { const b = await res.json(); if (b?.message) msg = b.message; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.blob();
  },
  orderChallanBlob: async (soId: string, lang: "en" | "bn" = "en"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/sales/orders/${soId}/challan?lang=${lang}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { const b = await res.json(); if (b?.message) msg = b.message; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.blob();
  },
  challanBlob: async (dcId: string, lang: "en" | "bn" = "en"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/sales/challans/${dcId}/pdf?lang=${lang}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try { const b = await res.json(); if (b?.message) msg = b.message; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.blob();
  },

  // accounting
  accounts:     () => api.get<Account[]>("/api/accounting/accounts"),
  trialBalance: (yearId?: string) => api.get<TrialBalanceReport>(`/api/accounting/trial-balance${yearId ? "?yearId=" + yearId : ""}`),
  statement:    (kind: "financial-position" | "profit-or-loss" | "cash-flows", yearId?: string) =>
                  api.get<Statement>(`/api/accounting/statements/${kind}${yearId ? "?yearId=" + yearId : ""}`),
  equityStatement: (yearId?: string) =>
                  api.get<EquityStatement>(`/api/accounting/statements/changes-in-equity${yearId ? "?yearId=" + yearId : ""}`),
  generalLedger: (accountId: string, from: string, to: string) =>
                  api.get<GeneralLedger>(`/api/accounting/reports/ledger?accountId=${accountId}&from=${from}&to=${to}`),
  aging:        (type: "CUSTOMER" | "SUPPLIER", asOf: string) =>
                  api.get<AgingReport>(`/api/accounting/reports/aging?type=${type}&asOf=${asOf}`),
  checks:       () => api.get<ChecksReport>("/api/accounting/reports/checks"),
  taxSummary:   (from: string, to: string) => api.get<TaxSummary>(`/api/accounting/reports/tax?from=${from}&to=${to}`),
  bankAccounts: () => api.get<BankAccountRow[]>("/api/accounting/bank-recon/accounts"),
  bankOpen:     (id: string, upTo: string) => api.get<BankOpen>(`/api/accounting/bank-recon/${id}/open?upTo=${upTo}`),
  bankHistory:  (id: string) => api.get<BankHistoryRow[]>(`/api/accounting/bank-recon/${id}/history`),
  bankReconcile: (id: string, b: { statementDate: string; statementBalance: number; lineIds: string[]; note?: string }) =>
                  api.post<{ id: string; cleared: number }>(`/api/accounting/bank-recon/${id}`, b),
  fixedAssets:  () => api.get<FixedAsset[]>("/api/accounting/fixed-assets"),
  createAsset:  (b: Record<string, unknown>) => api.post<{ id: string; code: string }>("/api/accounting/fixed-assets", b),
  depreciate:   (period: string) =>
                  api.post<{ period: string; assets: number; total: number; entryNo?: string }>("/api/accounting/fixed-assets/depreciate", { period }),
  disposeAsset: (id: string, b: Record<string, unknown>) =>
                  api.post<{ entryNo: string; gainLoss: number }>(`/api/accounting/fixed-assets/${id}/dispose`, b),
  closeYear:    (id: string) => api.post<FinancialYear>(`/api/accounting/financial-year/${id}/close`, {}),
  reopenYear:   (id: string) => api.post<FinancialYear>(`/api/accounting/financial-year/${id}/reopen`, {}),
  reverseJournal: (id: string, b: { reason: string; date?: string }) =>
                  api.post<{ entryNo: string; id: string }>(`/api/accounting/journal/${id}/reverse`, b),
  payment:      (b: unknown) => api.post("/api/accounting/payments", b),
  paymentList:  (direction: "IN" | "OUT", limit = 200) =>
                  api.get<PaymentRow[]>(`/api/accounting/payments?direction=${direction}&limit=${limit}`),
  pettyCash:    (b: unknown) => api.post("/api/accounting/petty-cash", b),
  cheques:      () => api.get<Cheque[]>("/api/accounting/cheques"),
  recordCheque: (b: unknown) => api.post<Cheque>("/api/accounting/cheques", b),
  editCheque:   (id: string, b: unknown) => api.put<Cheque>(`/api/accounting/cheques/${id}`, b),
  chequeDate:   (id: string, b: unknown) => api.post<Cheque>(`/api/accounting/cheques/${id}/date`, b),
  chequeStep:   (id: string, step: "hold" | "resume" | "cash" | "post" | "bounce" | "cancel", b: unknown) =>
    api.post<Cheque>(`/api/accounting/cheques/${id}/${step}`, b),
  chequeReminderSettings: () => api.get<ChequeReminderSettings>("/api/accounting/cheques/reminder-settings"),
  saveChequeReminderSettings: (b: { enabled: boolean; lang: "en" | "bn" }) =>
    api.put<ChequeReminderSettings>("/api/accounting/cheques/reminder-settings", b),
  remindCheque: (id: string) => api.post<Cheque>(`/api/accounting/cheques/${id}/remind`, {}),
  chequeHistory: (id: string) => api.get<ChequeEvent[]>(`/api/accounting/cheques/${id}/history`),
  chequeResubmit: (id: string, b: unknown) => api.post<Cheque>(`/api/accounting/cheques/${id}/resubmit`, b),
  chequeBankAccounts: () => api.get<Account[]>("/api/accounting/cheques/bank-accounts"),
  customerBalance: (customerId: string) =>
    api.get<{ balance: number }>(`/api/accounting/cheques/customer-balance/${customerId}`),
  reportPdf: async (path: "statements/financial-position" | "statements/profit-or-loss" | "statements/cash-flows"
                    | "statements/changes-in-equity" | "trial-balance", yearId: string, lang: "en" | "bn"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/accounting/${path}/pdf?yearId=${yearId}&lang=${lang}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to generate the PDF");
    return res.blob();
  },
  /** PDF of a non-year report; `query` is the already-encoded query string without lang. */
  reportPdfQuery: async (path: "reports/ledger" | "reports/aging" | "reports/tax" | "reports/checks", query: string, lang: "en" | "bn"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/accounting/${path}/pdf?${query}${query ? "&" : ""}lang=${lang}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to generate the PDF");
    return res.blob();
  },
  chequeReceiptBlob: async (id: string, lang: "en" | "bn" = "en"): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/accounting/cheques/${id}/receipt?lang=${lang}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to generate cheque receipt");
    return res.blob();
  },

  // auth + users
  login: (username: string, password: string) =>
    api.post<Me>("/api/auth/login", { username, password }),
  me:    () => api.get<Me>("/api/auth/me"),
  users: () => api.get<UserView[]>("/api/users"),
  logout: () => api.post<void>("/api/auth/logout", {}),

  // activity log (admin only, read only)
  auditLog:    (f: AuditFilter, page: number, size: number) =>
    api.get<AuditPage>(`/api/audit-log?${auditQuery(f)}&page=${page}&size=${size}`),
  auditEntry:  (id: number) => api.get<AuditDetail>(`/api/audit-log/${id}`),
  auditFacets: () => api.get<AuditFacets>("/api/audit-log/facets"),
  auditExport: async (f: AuditFilter): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/audit-log/export?${auditQuery(f)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 403) throw new Error("You don't have permission for this.");
    if (!res.ok) throw new Error("Failed to export the activity log");
    return res.blob();
  },
  createUser: (b: unknown) => api.post<UserView>("/api/users", b),
  updateUser: (id: string, b: { username?: string; password?: string; fullName?: string; fullNameBn?: string; mobile?: string; role: string; shopIds: string[]; active?: boolean }) =>
    api.put<UserView>(`/api/users/${id}`, b),

  // employees / payroll master
  employees:      () => api.get<Employee[]>("/api/hr/employees"),
  saveEmployee:   (b: Partial<Employee>) => api.post<Employee>("/api/hr/employees", b),
  updateEmployee: (id: string, b: Partial<Employee>) => api.put<Employee>(`/api/hr/employees/${id}`, b),
  deleteEmployee: (id: string) => api.del(`/api/hr/employees/${id}`),

  // chart of accounts
  coaGroups:    () => api.get<AccountGroup[]>("/api/accounting/coa/groups"),
  coaLedgers:   () => api.get<LedgerRow[]>("/api/accounting/coa/ledgers"),
  createGroup:  (b: Partial<AccountGroup>) => api.post<AccountGroup>("/api/accounting/coa/groups", b),
  updateGroup:  (id: string, b: Partial<AccountGroup>) => api.put<AccountGroup>(`/api/accounting/coa/groups/${id}`, b),
  deleteGroup:  (id: string) => api.del(`/api/accounting/coa/groups/${id}`),
  nextLedgerCode: (groupId: string) => api.get<{ code: string }>(`/api/accounting/coa/next-code?groupId=${groupId}`),
  createLedger: (b: Record<string, unknown>) => api.post("/api/accounting/coa/ledgers", b),
  updateLedger: (id: string, b: Record<string, unknown>) => api.put(`/api/accounting/coa/ledgers/${id}`, b),
  deleteLedger: (id: string) => api.del(`/api/accounting/coa/ledgers/${id}`),

  // financial year + opening balances
  financialYears: () => api.get<FinancialYear[]>("/api/accounting/financial-year"),
  currentYear:    () => api.get<FinancialYear>("/api/accounting/financial-year/current"),
  createYear:     (b: Partial<FinancialYear>) => api.post<FinancialYear>("/api/accounting/financial-year", b),
  setCurrentYear: (id: string) => api.post(`/api/accounting/financial-year/${id}/set-current`, {}),
  openings:       (id: string) => api.get<OpeningBalance[]>(`/api/accounting/financial-year/${id}/openings`),
  setOpening:     (id: string, b: { accountId: string; debit: number; credit: number }) =>
                    api.post(`/api/accounting/financial-year/${id}/openings`, b),

  // manual journal voucher + register
  postJournal:     (b: { entryDate: string; narration: string; lines: { accountId: string; debit: number; credit: number }[] }) =>
                     api.post<{ entryNo: string; id: string }>("/api/accounting/journal", b),
  journalRegister: (limit = 100, from = "", to = "") =>
                     api.get<JournalEntryView[]>(`/api/accounting/journal?limit=${limit}${from ? "&from=" + from : ""}${to ? "&to=" + to : ""}`),

  // goods-receipt history for a PO
  receipts: (poId: string) => api.get<ReceiptView[]>(`/api/purchase/orders/${poId}/receipts`),
};

export type JournalLineView = { code: string; name: string; debit: number; credit: number };
export type JournalEntryView = {
  id: string; entryNo: string; entryDate: string; narration: string; sourceType: string;
  createdBy?: string | null; createdAt?: string; reversalOfNo?: string | null; reversedByNo?: string | null;
  lines: JournalLineView[];
};
export type ReceiptView = { grnNo: string; receiptDate: string; productName: string; warehouseId?: string; qtyReceived: number };
