"use client";
import { useEffect, useState } from "react";
import { endpoints, type VarianceRow, type Product, type Warehouse } from "@/lib/api";

export default function VariancePage() {
  const [scope, setScope] = useState<"warehouse" | "company">("warehouse");
  const [rows, setRows] = useState<VarianceRow[]>([]);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [warehouses, setWarehouses] = useState<Record<string, Warehouse>>({});
  useEffect(() => {
    endpoints.products().then((p) => setProducts(Object.fromEntries(p.map((x) => [x.id, x])))).catch(() => {});
    endpoints.warehouses().then((w) => setWarehouses(Object.fromEntries(w.map((x) => [x.id, x])))).catch(() => {});
  }, []);
  useEffect(() => { endpoints.priceVariance(scope).then(setRows).catch(() => {}); }, [scope]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="page-title">Price variance</h1>
        <div className="flex gap-1 text-sm">
          {(["warehouse", "company"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className="px-3 py-1.5 rounded-lg"
              style={{ background: scope === s ? "#1d5e4f" : "#fff", color: scope === s ? "#fff" : "#1c1b19",
                       border: "1px solid #d8d4ca" }}>
              {s === "warehouse" ? "Per warehouse" : "Company-wide"}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-[#6b6960] mb-6">
        Spread between the cheapest and dearest open cost layer per product — the purchase-price drift you carry in stock.
      </p>
      <div className="border border-line rounded-xl bg-white overflow-hidden">
        <table className="tbl">
          <thead><tr>
            <th>Product</th>{scope === "warehouse" && <th>Warehouse</th>}
            <th className="text-right">Min cost</th><th className="text-right">Max cost</th>
            <th className="text-right">Avg cost</th><th className="text-right">Spread</th><th className="text-right">Qty on hand</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="text-[#6b6960]">No stock layers yet.</td></tr>}
            {rows.map((r, i) => {
              const spread = Number(r.maxCost) - Number(r.minCost);
              return (
                <tr key={i}>
                  <td>{products[r.productId]?.fullName ?? products[r.productId]?.name ?? r.productId}</td>
                  {scope === "warehouse" && <td>{warehouses[r.warehouseId ?? ""]?.name ?? "—"}</td>}
                  <td className="text-right tabular-nums">{Number(r.minCost).toFixed(2)}</td>
                  <td className="text-right tabular-nums">{Number(r.maxCost).toFixed(2)}</td>
                  <td className="text-right tabular-nums">{Number(r.avgCost).toFixed(2)}</td>
                  <td className="text-right tabular-nums" style={{ color: spread > 0 ? "#b4690e" : undefined }}>
                    {spread.toFixed(2)}
                  </td>
                  <td className="text-right tabular-nums">{Number(r.qtyOnHand)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
