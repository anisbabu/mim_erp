"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product, type Warehouse, type Shop, type Customer, type WarehouseStock } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import SearchSelect, { type Option } from "@/components/SearchSelect";

// Issue delivery challan (DC_FIRST workflow).
// A challan ships from ONE warehouse. Pick the warehouse, then add product lines
// drawn from that warehouse's stock. Stock deducts immediately (FIFO) on issue.
// At day end, a customer's challans get consolidated into one invoice.
type Line = { productId: string; qty: string; unitPrice: string };

export default function ChallanPage() {
  const { activeShopId } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stock, setStock] = useState<Record<string, WarehouseStock[]>>({});
  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "", unitPrice: "" }]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
  }, []);

  const productOpts: Option[] = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.fullName || p.name, sublabel: p.sku })),
    [products]);

  async function loadStock(productId: string) {
    if (!productId || stock[productId]) return;
    const s = await endpoints.availability(productId);
    setStock((m) => ({ ...m, [productId]: s }));
  }

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: "", qty: "", unitPrice: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const grandGross = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);

  function availHere(productId: string): number | null {
    if (!warehouseId) return null;
    const s = (stock[productId] ?? []).find((x) => x.warehouseId === warehouseId);
    return s ? s.qty : 0;
  }

  async function submit() {
    setMsg(null);
    if (!activeShopId || !customerId || !warehouseId) { setMsg({ kind: "err", text: "Select customer and warehouse." }); return; }
    const allocations = lines
      .filter((l) => l.productId && Number(l.qty) > 0)
      .map((l) => ({ productId: l.productId, warehouseId, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountAmt: 0 }));
    if (allocations.length === 0) { setMsg({ kind: "err", text: "Add at least one line with quantity." }); return; }
    setBusy(true);
    try {
      const dc: any = await endpoints.issueChallan({
        shopId: activeShopId, customerId, warehouseId, allocations,
        priceOverrideBy: null,
        discountBy: null,
      });
      setMsg({ kind: "ok", text: `Challan ${dc.dcNo} issued. Stock deducted. Consolidate at day end to invoice.` });
      setLines([{ productId: "", qty: "", unitPrice: "" }]);
      const used = new Set(allocations.map((a) => a.productId));
      for (const pid of used) { const s = await endpoints.availability(pid); setStock((m) => ({ ...m, [pid]: s })); }
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="text-2xl font-medium mb-1">Issue challan</h1>
      <p className="text-sm text-[#6b6960] mb-6">
        Delivery-first workflow. One challan ships from a single warehouse; stock deducts on issue.
        Roll these up per customer at day end on the consolidate screen.
      </p>

      <div className="form-grid cols-2 mb-5">
        <div className="field">
          <label>Customer</label>
          <select className="inp mt-1" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">Ship from warehouse</label>
          <select className="inp mt-1" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Select…</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      <div className="border border-line rounded-xl bg-white overflow-hidden mb-4">
        <table className="tbl">
          <thead>
            <tr>
              <th>Product</th>
              <th className="text-right">Avail here</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Unit price</th>
              <th className="text-right">Gross total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const a = availHere(l.productId);
              const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
              return (
                <tr key={i}>
                  <td>
                    <SearchSelect options={productOpts} value={l.productId}
                      onChange={(v) => { update(i, { productId: v }); loadStock(v); }}
                      placeholder="Search product…" />
                  </td>
                  <td className="text-right tabular-nums" style={{ color: a === 0 ? "#b4690e" : undefined }}>
                    {l.productId ? (a ?? "—") : ""}
                  </td>
                  <td className="text-right">
                    <input className="inp text-right tabular-nums" style={{ width: 80, marginLeft: "auto" }}
                      type="number" min={0} value={l.qty} onChange={(e) => update(i, { qty: e.target.value })} />
                  </td>
                  <td className="text-right">
                    <input className="inp text-right tabular-nums"
                      style={{ width: 100, marginLeft: "auto" }}
                      type="number" min={0} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
                  </td>
                  <td className="text-right tabular-nums">
                    {grossTotal > 0 ? grossTotal.toFixed(2) : ""}
                  </td>
                  <td className="text-right">{lines.length > 1 && <button className="text-[#9a2b22] text-sm" onClick={() => removeLine(i)}>remove</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-line"><button className="btn-ghost" onClick={addLine}>+ Add line</button></div>
      </div>

      {grandGross > 0 && (
        <div className="mb-4 flex justify-end">
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", rowGap: 6, columnGap: 24, alignItems: "center" }}>
            <span className="text-xs text-[#6b6960] text-right font-semibold">Total</span>
            <span className="tabular-nums text-right font-semibold">{grandGross.toFixed(2)}</span>
          </div>
        </div>
      )}

      <button className="btn" onClick={submit} disabled={busy}>{busy ? "Issuing…" : "Issue challan"}</button>

      {msg && (
        <div className="mt-4 text-sm rounded-lg px-4 py-3"
             style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb", color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}