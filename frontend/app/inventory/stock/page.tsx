"use client";
import { useEffect, useState, useMemo } from "react";
import { endpoints, type StockRow, type SupplierStockRow, type StockStatusRow, type StockSummaryRow,
  type Product, type Warehouse, type Supplier } from "@/lib/api";

const PAGE_SIZE = 20;
type View = "all" | "product" | "warehouse" | "supplier" | "summary";

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => today().slice(0, 8) + "01";

export default function StockPage() {
  const [rows, setRows]           = useState<StockRow[]>([]);
  const [supplierRows, setSupplierRows] = useState<SupplierStockRow[]>([]);
  const [statusRows, setStatusRows] = useState<StockStatusRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<StockSummaryRow[]>([]);
  const [sumFrom, setSumFrom]     = useState(monthStart());
  const [sumTo, setSumTo]         = useState(today());
  const [sumWh, setSumWh]         = useState("");
  const [sumErr, setSumErr]       = useState<string | null>(null);
  const [products, setProducts]   = useState<Record<string, Product>>({});
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse>>({});
  const [suppliers, setSuppliers] = useState<Record<string, Supplier>>({});
  const [view, setView]           = useState<View>("all");
  const [search, setSearch]       = useState("");
  const [page, setPage]           = useState(1);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    endpoints.stockOverview().then(setRows).catch(() => {});
    endpoints.stockBySupplier().then(setSupplierRows).catch(() => {});
    endpoints.stockStatus().then(setStatusRows).catch(() => {});
    endpoints.products().then((p) => setProducts(Object.fromEntries(p.map((x) => [x.id, x])))).catch(() => {});
    endpoints.warehouses().then((w) => setWarehouses(Object.fromEntries(w.map((x) => [x.id, x])))).catch(() => {});
    endpoints.suppliers().then((s) => setSuppliers(Object.fromEntries(s.map((x) => [x.id, x])))).catch(() => {});
  }, []);

  useEffect(() => { setPage(1); setSearch(""); }, [view]);
  useEffect(() => { setPage(1); }, [search]);

  useEffect(() => {
    if (view !== "summary") return;
    setSumErr(null);
    endpoints.stockSummary(sumFrom, sumTo, sumWh || undefined)
      .then(setSummaryRows)
      .catch((e) => setSumErr(e.message));
  }, [view, sumFrom, sumTo, sumWh]);

  // By-product: on hand, committed (sold, not picked up), available, on order (due from suppliers)
  const byProduct = statusRows;

  // By-warehouse: collapse productId, sum qty+value per warehouse
  const byWarehouse = useMemo(() => {
    const m = new Map<string, { qty: number; value: number }>();
    for (const r of rows) {
      const e = m.get(r.warehouseId) ?? { qty: 0, value: 0 };
      m.set(r.warehouseId, { qty: e.qty + Number(r.qty), value: e.value + Number(r.value) });
    }
    return Array.from(m.entries()).map(([warehouseId, v]) => ({ warehouseId, ...v }));
  }, [rows]);

  const pName = (id: string) => products[id]?.fullName ?? products[id]?.name ?? id;
  const wName = (id: string) => warehouses[id]?.name ?? id;
  const sName = (id: string) => suppliers[id]?.name ?? id;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (view === "all") {
      const src = !q ? rows : rows.filter((r) =>
        pName(r.productId).toLowerCase().includes(q) || wName(r.warehouseId).toLowerCase().includes(q));
      return src;
    }
    if (view === "product") {
      return !q ? byProduct : byProduct.filter((r) => pName(r.productId).toLowerCase().includes(q));
    }
    if (view === "warehouse") {
      return !q ? byWarehouse : byWarehouse.filter((r) => wName(r.warehouseId).toLowerCase().includes(q));
    }
    if (view === "summary") {
      return !q ? summaryRows : summaryRows.filter((r) =>
        pName(r.productId).toLowerCase().includes(q) || (r.productGroup ?? "").toLowerCase().includes(q));
    }
    // supplier
    return !q ? supplierRows : supplierRows.filter((r) =>
      sName(r.supplierId).toLowerCase().includes(q) || pName(r.productId).toLowerCase().includes(q));
  }, [view, search, rows, byProduct, byWarehouse, supplierRows, summaryRows, products, warehouses, suppliers]);

  const totalValue  = (filtered as any[]).reduce((s: number, r: any) => s + Number(r.value ?? r.closingValue ?? 0), 0);
  const sumTotals = useMemo(() => {
    const t = { openingValue: 0, inwardValue: 0, outwardValue: 0, closingValue: 0 };
    for (const r of filtered as StockSummaryRow[]) {
      t.openingValue += Number(r.openingValue); t.inwardValue += Number(r.inwardValue);
      t.outwardValue += Number(r.outwardValue); t.closingValue += Number(r.closingValue);
    }
    return t;
  }, [filtered]);
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const blob = await endpoints.stockReportPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stock-on-hand-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { alert(e.message); }
    finally { setDownloading(false); }
  }

  const tabs: { key: View; label: string }[] = [
    { key: "all",       label: "All" },
    { key: "product",   label: "By Product" },
    { key: "warehouse", label: "By Warehouse" },
    { key: "supplier",  label: "By Supplier" },
    { key: "summary",   label: "Summary" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="page-title">Stock on hand</h1>
        <button className="btn" onClick={downloadPdf} disabled={downloading}>
          {downloading ? "Generating…" : "Download PDF"}
        </button>
      </div>
      <p className="text-sm text-[#6b6960] mb-4">Live quantity and FIFO value per product and warehouse.</p>

      {/* view tabs */}
      <div className="flex gap-1 mb-4">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setView(t.key)}
            className="px-3 py-1.5 rounded-lg text-sm border"
            style={{
              background:   view === t.key ? "#1d5e4f" : "#fff",
              color:        view === t.key ? "#fff"    : "#1c1b19",
              borderColor:  view === t.key ? "#1d5e4f" : "#d8d4ca",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {view === "summary" && (
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <label className="field"><span>From</span>
            <input type="date" className="inp" value={sumFrom} onChange={(e) => setSumFrom(e.target.value)} /></label>
          <label className="field"><span>To</span>
            <input type="date" className="inp" value={sumTo} onChange={(e) => setSumTo(e.target.value)} /></label>
          <label className="field"><span>Warehouse</span>
            <select className="inp" value={sumWh} onChange={(e) => setSumWh(e.target.value)}>
              <option value="">All warehouses</option>
              {Object.values(warehouses).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          {sumErr && <span className="text-sm text-red-700">{sumErr}</span>}
        </div>
      )}

      <input
        className="inp mb-4 max-w-sm"
        placeholder={
          view === "all"       ? "Search product or warehouse…" :
          view === "product"   ? "Search product…" :
          view === "warehouse" ? "Search warehouse…" :
          view === "summary"   ? "Search product or group…" :
                                 "Search supplier or product…"
        }
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="border border-line rounded-xl bg-white overflow-hidden">
        {/* ALL view */}
        {view === "all" && (
          <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Product</th><th>Warehouse</th><th className="text-right">Qty</th><th className="text-right">Value (cost)</th></tr></thead>
            <tbody>
              {pageItems.length === 0 && <tr><td colSpan={4} className="text-[#6b6960]">{search ? "No matching stock." : "No stock yet."}</td></tr>}
              {(pageItems as StockRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{pName(r.productId)}</td>
                  <td>{wName(r.warehouseId)}</td>
                  <td className="text-right tabular-nums">{Number(r.qty)}</td>
                  <td className="text-right tabular-nums">{Number(r.value).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td colSpan={3} className="text-right font-medium">{search ? "Filtered total" : "Total"}</td>
              <td className="text-right font-medium tabular-nums">{totalValue.toFixed(2)}</td>
            </tr></tfoot>}
          </table>
          </div>
        )}

        {/* BY PRODUCT view */}
        {view === "product" && (
          <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Product</th>
              <th className="text-right">On hand</th>
              <th className="text-right" title="Sold but not yet picked up by the customer">Committed</th>
              <th className="text-right" title="On hand minus committed">Available</th>
              <th className="text-right" title="Still due from suppliers on open purchase orders">On order</th>
              <th className="text-right">Value (cost)</th>
            </tr></thead>
            <tbody>
              {pageItems.length === 0 && <tr><td colSpan={6} className="text-[#6b6960]">{search ? "No matching products." : "No stock yet."}</td></tr>}
              {(pageItems as StockStatusRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{pName(r.productId)}</td>
                  <td className="text-right tabular-nums">{Number(r.onHand)}</td>
                  <td className="text-right tabular-nums">{Number(r.committed) || ""}</td>
                  <td className="text-right tabular-nums" style={Number(r.available) < 0 ? { color: "#b91c1c", fontWeight: 600 } : undefined}>
                    {Number(r.available)}
                  </td>
                  <td className="text-right tabular-nums">{Number(r.onOrder) || ""}</td>
                  <td className="text-right tabular-nums">{Number(r.value).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td colSpan={5} className="text-right font-medium">{search ? "Filtered total" : "Total"}</td>
              <td className="text-right font-medium tabular-nums">{totalValue.toFixed(2)}</td>
            </tr></tfoot>}
          </table>
          </div>
        )}

        {/* BY WAREHOUSE view */}
        {view === "warehouse" && (
          <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Warehouse</th><th className="text-right">Total Qty</th><th className="text-right">Total Value (cost)</th></tr></thead>
            <tbody>
              {pageItems.length === 0 && <tr><td colSpan={3} className="text-[#6b6960]">{search ? "No matching warehouses." : "No stock yet."}</td></tr>}
              {(pageItems as { warehouseId: string; qty: number; value: number }[]).map((r, i) => (
                <tr key={i}>
                  <td>{wName(r.warehouseId)}</td>
                  <td className="text-right tabular-nums">{r.qty}</td>
                  <td className="text-right tabular-nums">{r.value.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td className="text-right font-medium">{search ? "Filtered total" : "Total"}</td>
              <td colSpan={2} className="text-right font-medium tabular-nums">{totalValue.toFixed(2)}</td>
            </tr></tfoot>}
          </table>
          </div>
        )}

        {/* BY SUPPLIER view */}
        {view === "supplier" && (
          <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Supplier</th><th>Product</th><th className="text-right">Qty</th><th className="text-right">Value (cost)</th></tr></thead>
            <tbody>
              {pageItems.length === 0 && <tr><td colSpan={4} className="text-[#6b6960]">{search ? "No matching results." : "No stock yet."}</td></tr>}
              {(pageItems as SupplierStockRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{sName(r.supplierId)}</td>
                  <td>{pName(r.productId)}</td>
                  <td className="text-right tabular-nums">{Number(r.qty)}</td>
                  <td className="text-right tabular-nums">{Number(r.value).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td colSpan={3} className="text-right font-medium">{search ? "Filtered total" : "Total"}</td>
              <td className="text-right font-medium tabular-nums">{totalValue.toFixed(2)}</td>
            </tr></tfoot>}
          </table>
          </div>
        )}

        {/* SUMMARY view: opening / inward / outward / closing for the period */}
        {view === "summary" && (
          <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th rowSpan={2}>Product</th><th rowSpan={2}>Group</th>
                <th colSpan={2} className="text-center">Opening</th>
                <th colSpan={2} className="text-center">Inward</th>
                <th colSpan={2} className="text-center">Outward</th>
                <th colSpan={2} className="text-center">Closing</th>
              </tr>
              <tr>
                {["Qty", "Value", "Qty", "Value", "Qty", "Value", "Qty", "Value"].map((h, i) =>
                  <th key={i} className="text-right">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && <tr><td colSpan={10} className="text-[#6b6960]">{search ? "No matching products." : "No stock movements in this period."}</td></tr>}
              {(pageItems as StockSummaryRow[]).map((r, i) => (
                <tr key={i}>
                  <td>{pName(r.productId)}</td>
                  <td>{r.productGroup ?? ""}</td>
                  <td className="text-right tabular-nums">{Number(r.openingQty)}</td>
                  <td className="text-right tabular-nums">{Number(r.openingValue).toFixed(2)}</td>
                  <td className="text-right tabular-nums">{Number(r.inwardQty)}</td>
                  <td className="text-right tabular-nums">{Number(r.inwardValue).toFixed(2)}</td>
                  <td className="text-right tabular-nums">{Number(r.outwardQty)}</td>
                  <td className="text-right tabular-nums">{Number(r.outwardValue).toFixed(2)}</td>
                  <td className="text-right tabular-nums">{Number(r.closingQty)}</td>
                  <td className="text-right tabular-nums">{Number(r.closingValue).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && <tfoot><tr>
              <td colSpan={2} className="text-right font-medium">{search ? "Filtered total" : "Total"}</td>
              <td /><td className="text-right font-medium tabular-nums">{sumTotals.openingValue.toFixed(2)}</td>
              <td /><td className="text-right font-medium tabular-nums">{sumTotals.inwardValue.toFixed(2)}</td>
              <td /><td className="text-right font-medium tabular-nums">{sumTotals.outwardValue.toFixed(2)}</td>
              <td /><td className="text-right font-medium tabular-nums">{sumTotals.closingValue.toFixed(2)}</td>
            </tr></tfoot>}
          </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-[#6b6960]">
          <span>{filtered.length} rows · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost px-3 py-1"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}>← Prev</button>
            <button className="btn-ghost px-3 py-1"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}