"use client";
import { useEffect, useState } from "react";
import { endpoints, type StockRow, type Product, type Warehouse } from "@/lib/api";

export default function StockPage() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse>>({});
  useEffect(() => {
    endpoints.stockOverview().then(setRows).catch(() => {});
    endpoints.products().then((p) => setProducts(Object.fromEntries(p.map((x) => [x.id, x])))).catch(() => {});
    endpoints.warehouses().then((w) => setWarehouses(Object.fromEntries(w.map((x) => [x.id, x])))).catch(() => {});
  }, []);
  const totalValue = rows.reduce((s, r) => s + Number(r.value), 0);
  return (
    <div>
      <h1 className="text-2xl font-medium mb-1">Stock on hand</h1>
      <p className="text-sm text-[#6b6960] mb-6">Live quantity and FIFO value per product and warehouse.</p>
      <div className="border border-line rounded-xl bg-white overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Product</th><th>Warehouse</th><th className="text-right">Qty</th><th className="text-right">Value (cost)</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="text-[#6b6960]">No stock yet — receive goods first.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{products[r.productId]?.name ?? r.productId}</td>
                <td>{warehouses[r.warehouseId]?.name ?? r.warehouseId}</td>
                <td className="text-right tabular-nums">{Number(r.qty)}</td>
                <td className="text-right tabular-nums">{Number(r.value).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr><td colSpan={3} className="text-right font-medium">Total inventory value</td>
              <td className="text-right font-medium tabular-nums">{totalValue.toFixed(2)}</td></tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
