"use client";
import { useEffect, useState, useMemo } from "react";
import { endpoints, type StockRow, type Product, type Warehouse } from "@/lib/api";

const PAGE_SIZE = 20;

export default function StockPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    endpoints.stockOverview().then(setRows).catch(() => {});
    endpoints.products().then((p) => setProducts(Object.fromEntries(p.map((x) => [x.id, x])))).catch(() => {});
    endpoints.warehouses().then((w) => setWarehouses(Object.fromEntries(w.map((x) => [x.id, x])))).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const pName = (products[r.productId]?.name ?? "").toLowerCase();
      const wName = (warehouses[r.warehouseId]?.name ?? "").toLowerCase();
      return pName.includes(q) || wName.includes(q);
    });
  }, [rows, products, warehouses, search]);

  useEffect(() => { setPage(1); }, [search]);

  const totalValue = filtered.reduce((s, r) => s + Number(r.value), 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-medium">Stock on hand</h1>
        <button className="btn" onClick={downloadPdf} disabled={downloading}>
          {downloading ? "Generating…" : "Download PDF"}
        </button>
      </div>
      <p className="text-sm text-[#6b6960] mb-4">Live quantity and FIFO value per product and warehouse.</p>

      <input
        className="inp mb-4 max-w-sm"
        placeholder="Search product or warehouse…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="border border-line rounded-xl bg-white overflow-hidden">
        <table className="tbl">
          <thead>
            <tr>
              <th>Product</th>
              <th>Warehouse</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Value (cost)</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr><td colSpan={4} className="text-[#6b6960]">
                {search ? "No matching stock." : "No stock yet — receive goods first."}
              </td></tr>
            )}
            {pageItems.map((r, i) => (
              <tr key={i}>
                <td>{products[r.productId]?.name ?? r.productId}</td>
                <td>{warehouses[r.warehouseId]?.name ?? r.warehouseId}</td>
                <td className="text-right tabular-nums">{Number(r.qty)}</td>
                <td className="text-right tabular-nums">{Number(r.value).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} className="text-right font-medium">
                  {search ? "Filtered total" : "Total inventory value"}
                </td>
                <td className="text-right font-medium tabular-nums">{totalValue.toFixed(2)}</td>
              </tr>
            </tfoot>
          )}
        </table>
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