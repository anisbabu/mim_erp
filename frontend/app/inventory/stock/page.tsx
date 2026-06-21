"use client";
import { useEffect, useState, useMemo } from "react";
import { endpoints, type StockRow, type SupplierStockRow, type Product, type Warehouse, type Supplier } from "@/lib/api";

const PAGE_SIZE = 20;
type View = "all" | "product" | "warehouse" | "supplier";

export default function StockPage() {
  const [rows, setRows]           = useState<StockRow[]>([]);
  const [supplierRows, setSupplierRows] = useState<SupplierStockRow[]>([]);
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
    endpoints.products().then((p) => setProducts(Object.fromEntries(p.map((x) => [x.id, x])))).catch(() => {});
    endpoints.warehouses().then((w) => setWarehouses(Object.fromEntries(w.map((x) => [x.id, x])))).catch(() => {});
    endpoints.suppliers().then((s) => setSuppliers(Object.fromEntries(s.map((x) => [x.id, x])))).catch(() => {});
  }, []);

  useEffect(() => { setPage(1); setSearch(""); }, [view]);
  useEffect(() => { setPage(1); }, [search]);

  // By-product: collapse warehouseId, sum qty+value per product
  const byProduct = useMemo(() => {
    const m = new Map<string, { qty: number; value: number }>();
    for (const r of rows) {
      const e = m.get(r.productId) ?? { qty: 0, value: 0 };
      m.set(r.productId, { qty: e.qty + Number(r.qty), value: e.value + Number(r.value) });
    }
    return Array.from(m.entries()).map(([productId, v]) => ({ productId, ...v }));
  }, [rows]);

  // By-warehouse: collapse productId, sum qty+value per warehouse
  const byWarehouse = useMemo(() => {
    const m = new Map<string, { qty: number; value: number }>();
    for (const r of rows) {
      const e = m.get(r.warehouseId) ?? { qty: 0, value: 0 };
      m.set(r.warehouseId, { qty: e.qty + Number(r.qty), value: e.value + Number(r.value) });
    }
    return Array.from(m.entries()).map(([warehouseId, v]) => ({ warehouseId, ...v }));
  }, [rows]);

  const pName = (id: string) => products[id]?.name ?? id;
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
    // supplier
    return !q ? supplierRows : supplierRows.filter((r) =>
      sName(r.supplierId).toLowerCase().includes(q) || pName(r.productId).toLowerCase().includes(q));
  }, [view, search, rows, byProduct, byWarehouse, supplierRows, products, warehouses, suppliers]);

  const totalValue  = (filtered as any[]).reduce((s: number, r: any) => s + Number(r.value), 0);
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
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-medium">Stock on hand</h1>
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

      <input
        className="inp mb-4 max-w-sm"
        placeholder={
          view === "all"       ? "Search product or warehouse…" :
          view === "product"   ? "Search product…" :
          view === "warehouse" ? "Search warehouse…" :
                                 "Search supplier or product…"
        }
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="border border-line rounded-xl bg-white overflow-hidden">
        {/* ALL view */}
        {view === "all" && (
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
        )}

        {/* BY PRODUCT view */}
        {view === "product" && (
          <table className="tbl">
            <thead><tr><th>Product</th><th className="text-right">Total Qty</th><th className="text-right">Total Value (cost)</th></tr></thead>
            <tbody>
              {pageItems.length === 0 && <tr><td colSpan={3} className="text-[#6b6960]">{search ? "No matching products." : "No stock yet."}</td></tr>}
              {(pageItems as { productId: string; qty: number; value: number }[]).map((r, i) => (
                <tr key={i}>
                  <td>{pName(r.productId)}</td>
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
        )}

        {/* BY WAREHOUSE view */}
        {view === "warehouse" && (
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
        )}

        {/* BY SUPPLIER view */}
        {view === "supplier" && (
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