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
  if (res.status === 401 || res.status === 403) {
    if (typeof window !== "undefined" && !path.endsWith("/auth/login")) {
      setToken(null);
      if (location.pathname !== "/login") location.href = "/login";
    }
    throw new Error("Not authorised");
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) msg = body.message;   // business-rule message from backend
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
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
  thicknessMm?: number; unit?: string; priceLower?: number; priceUpper?: number;
  supplierId?: string; category?: string; color?: string; fullName?: string; active?: boolean;
};
export type Warehouse = { id: string; code: string; name: string; nameBn?: string; branch?: string; address?: string };
export type Supplier  = { id: string; code: string; name: string; nameBn?: string; mobile?: string; address?: string };
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
  parentId?: string; system?: boolean;
};
export type LedgerRow = {
  id: string; code: string; name: string; name_bn?: string; type: string;
  group_id?: string; party_type?: string; is_system?: boolean;
  opening_debit: number; opening_credit: number;
  period_debit: number; period_credit: number; closing: number;
};
export type FinancialYear = {
  id: string; name: string; startDate: string; middleDate?: string; endDate: string;
  status: "OPEN" | "CLOSED"; current?: boolean;
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
export type ChallanLineView = { dcLineId: string; dcNo: string; productId: string; productName: string; qty: number; unitPrice: number; unitCost: number; discountAmt: number; priceLower?: number; priceUpper?: number };

export type WarehouseStock = { warehouseId: string; qty: number };
export type StockRow = { productId: string; warehouseId: string; qty: number; value: number };
export type SupplierStockRow = { supplierId: string; productId: string; qty: number; value: number };
export type VarianceRow = {
  productId: string; warehouseId: string | null;
  minCost: number; maxCost: number; avgCost: number; qtyOnHand: number;
};

export type PnL = {
  income: { code: string; name: string; amount: number }[];
  expense: { code: string; name: string; amount: number }[];
  totalIncome: number; totalExpense: number; netProfit: number;
};
export type BalanceSheet = {
  assets: { code: string; name: string; amount: number }[];
  liabilities: { code: string; name: string; amount: number }[];
  equity: { code: string; name: string; amount: number }[];
  retainedEarnings: number; totalAssets: number; totalLiabilitiesAndEquity: number; balanced: boolean;
};
export type TrialRow = { code: string; name: string; type: string; total_debit: number; total_credit: number };

export type Role = "SALESPERSON" | "MANAGER" | "ACCOUNTANT" | "ADMIN";
export type Me = { token?: string; username: string; fullName?: string; role: Role; shopIds: string[] };
export type UserView = { id: string; username: string; fullName?: string; role: Role; active: boolean; shopIds: string[] };

export const endpoints = {
  // master
  products:   () => api.get<Product[]>("/api/master/products"),
  warehouses: () => api.get<Warehouse[]>("/api/master/warehouses"),
  suppliers:  () => api.get<Supplier[]>("/api/master/suppliers"),
  shops:      () => api.get<Shop[]>("/api/master/shops"),
  customers:  () => api.get<Customer[]>("/api/master/customers"),
  saveProduct:   (b: Partial<Product>)   => api.post<Product>("/api/master/products", b),
  saveSupplier:  (b: Partial<Supplier>)  => api.post<Supplier>("/api/master/suppliers", b),
  saveCustomer:  (b: Partial<Customer>)  => api.post<Customer>("/api/master/customers", b),
  saveWarehouse: (b: Partial<Warehouse>) => api.post<Warehouse>("/api/master/warehouses", b),
  saveShop:      (b: Partial<Shop>)      => api.post<Shop>("/api/master/shops", b),
  updateProduct:   (id: string, b: Partial<Product>)   => api.put<Product>(`/api/master/products/${id}`, b),
  updateSupplier:  (id: string, b: Partial<Supplier>)  => api.put<Supplier>(`/api/master/suppliers/${id}`, b),
  updateCustomer:  (id: string, b: Partial<Customer>)  => api.put<Customer>(`/api/master/customers/${id}`, b),
  updateWarehouse: (id: string, b: Partial<Warehouse>) => api.put<Warehouse>(`/api/master/warehouses/${id}`, b),
  updateShop:      (id: string, b: Partial<Shop>)      => api.put<Shop>(`/api/master/shops/${id}`, b),
  deleteProduct:   (id: string) => api.del(`/api/master/products/${id}`),
  deleteSupplier:  (id: string) => api.del(`/api/master/suppliers/${id}`),
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
  stockReportPdf: async (): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/inventory/stock-report`, {
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
  openChallans: () => api.get<DeliveryChallan[]>("/api/sales/challans/open"),
  allChallans:  () => api.get<DeliveryChallan[]>("/api/sales/challans"),
  invoiceBlob:  async (soId: string): Promise<Blob> => {
    const token = loadToken();
    const res = await fetch(`${BASE}/api/sales/orders/${soId}/invoice`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("Failed to generate invoice");
    return res.blob();
  },

  // accounting
  accounts:     () => api.get<Account[]>("/api/accounting/accounts"),
  trialBalance: () => api.get<TrialRow[]>("/api/accounting/trial-balance"),
  profitLoss:   () => api.get<PnL>("/api/accounting/profit-loss"),
  balanceSheet: () => api.get<BalanceSheet>("/api/accounting/balance-sheet"),
  payment:      (b: unknown) => api.post("/api/accounting/payments", b),
  pettyCash:    (b: unknown) => api.post("/api/accounting/petty-cash", b),

  // auth + users
  login: (username: string, password: string) =>
    api.post<Me>("/api/auth/login", { username, password }),
  me:    () => api.get<Me>("/api/auth/me"),
  users: () => api.get<UserView[]>("/api/users"),
  createUser: (b: unknown) => api.post<UserView>("/api/users", b),
  updateUser: (id: string, b: { username?: string; password?: string; fullName?: string; role: string; shopIds: string[]; active?: boolean }) =>
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
  journalRegister: (limit = 50) => api.get<JournalEntryView[]>(`/api/accounting/journal?limit=${limit}`),

  // goods-receipt history for a PO
  receipts: (poId: string) => api.get<ReceiptView[]>(`/api/purchase/orders/${poId}/receipts`),
};

export type JournalLineView = { code: string; name: string; debit: number; credit: number };
export type JournalEntryView = { entryNo: string; entryDate: string; narration: string; sourceType: string; lines: JournalLineView[] };
export type ReceiptView = { grnNo: string; receiptDate: string; productName: string; qtyReceived: number };
