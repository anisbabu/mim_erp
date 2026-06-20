"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product, type Warehouse, type Shop, type Customer, type WarehouseStock, type UserView } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Issue delivery challan (DC_FIRST workflow).
// A challan ships from ONE warehouse. Pick the warehouse, then add product lines
// drawn from that warehouse's stock. Stock deducts immediately (FIFO) on issue.
// At day end, a customer's challans get consolidated into one invoice.
type Line = { productId: string; qty: string; unitPrice: string; discountAmt: string };

export default function ChallanPage() {
  const { activeShopId } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stock, setStock] = useState<Record<string, WarehouseStock[]>>({});
  const [authorisers, setAuthorisers] = useState<UserView[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "", unitPrice: "", discountAmt: "" }]);
  const [overrideBy, setOverrideBy] = useState("");
  const [discountBy, setDiscountBy] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
    endpoints.shops().then(setShops).catch(() => {});
    endpoints.customers().then(setCustomers).catch(() => {});
    endpoints.users().then((u) => setAuthorisers(u.filter((x) => x.active && (x.role === "MANAGER" || x.role === "ADMIN")))).catch(() => {});
  }, []);

  const productById = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);

  async function loadStock(productId: string) {
    if (!productId || stock[productId]) return;
    const s = await endpoints.availability(productId);
    setStock((m) => ({ ...m, [productId]: s }));
  }

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { productId: "", qty: "", unitPrice: "", discountAmt: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  // band check uses GROSS unit price
  function bandOut(l: Line): boolean {
    const p = productById[l.productId];
    const price = Number(l.unitPrice);
    if (!p || !l.unitPrice) return false;
    return (p.priceLower != null && price < p.priceLower) || (p.priceUpper != null && price > p.priceUpper);
  }
  const anyOut = lines.some(bandOut);
  const anyDiscount = lines.some((l) => Number(l.discountAmt) > 0);

  const grandGross    = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
  const totalDiscount = lines.reduce((s, l) => s + (Number(l.discountAmt) || 0), 0);
  const netTotal      = grandGross - totalDiscount;

  function applyNetTotal(newNet: number) {
    if (grandGross <= 0) return;
    const newTotalDisc = Math.max(0, grandGross - newNet);
    setLines((ls) => {
      const grosses = ls.map((l) => Number(l.qty) * Number(l.unitPrice));
      const sumGross = grosses.reduce((a, b) => a + b, 0);
      if (sumGross === 0) return ls;
      let assigned = 0;
      return ls.map((l, i) => {
        const isLast = i === ls.length - 1;
        const disc = isLast
          ? Math.round((newTotalDisc - assigned) * 100) / 100
          : Math.round((newTotalDisc * grosses[i] / sumGross) * 100) / 100;
        if (!isLast) assigned += disc;
        return { ...l, discountAmt: disc > 0 ? String(disc) : "" };
      });
    });
  }

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
      .map((l) => ({ productId: l.productId, warehouseId, qty: Number(l.qty), unitPrice: Number(l.unitPrice), discountAmt: Number(l.discountAmt) || 0 }));
    if (allocations.length === 0) { setMsg({ kind: "err", text: "Add at least one line with quantity." }); return; }
    if (anyOut && !overrideBy.trim()) { setMsg({ kind: "err", text: "A price is out of band — enter authoriser to override." }); return; }
    if (anyDiscount && !discountBy.trim()) { setMsg({ kind: "err", text: "Discount requires an authoriser — enter their name." }); return; }
    setBusy(true);
    try {
      const dc: any = await endpoints.issueChallan({
        shopId: activeShopId, customerId, warehouseId, allocations,
        priceOverrideBy: anyOut ? overrideBy : null,
        discountBy: anyDiscount ? discountBy : null,
      });
      setMsg({ kind: "ok", text: `Challan ${dc.dcNo} issued. Stock deducted. Consolidate at day end to invoice.` });
      setLines([
          { productId: "", qty: "", unitPrice: "", discountAmt: "" }]);
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
              <th className="text-right">Discount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const a = availHere(l.productId);
              const grossTotal = (Number(l.qty) * Number(l.unitPrice)) || 0;
              const discAmt = Number(l.discountAmt) || 0;
              return (
                <tr key={i}>
                  <td>
                    <select className="inp" value={l.productId}
                      onChange={(e) => { update(i, { productId: e.target.value }); loadStock(e.target.value); }}>
                      <option value="">Select…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.thicknessMm ? ` (${p.thicknessMm}mm)` : ""}</option>)}
                    </select>
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
                      style={{ width: 100, marginLeft: "auto", borderColor: bandOut(l) ? "#b4690e" : undefined }}
                      type="number" min={0} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
                  </td>
                  <td className="text-right tabular-nums">
                    {grossTotal > 0 ? grossTotal.toFixed(2) : ""}
                  </td>
                  <td className="text-right">
                    <input className="inp text-right tabular-nums" style={{ width: 96, marginLeft: "auto" }}
                      type="number" min={0} value={l.discountAmt}
                      onChange={(e) => update(i, { discountAmt: e.target.value })} placeholder="0.00" />
                    {discAmt > 0 && grossTotal > 0 && (
                      <div className="text-[11px] text-[#6b6960] mt-1">net {(grossTotal - discAmt).toFixed(2)}</div>
                    )}
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
            <span className="text-xs text-[#6b6960] text-right">Gross</span>
            <span className="tabular-nums text-right">{grandGross.toFixed(2)}</span>
            {totalDiscount > 0 && <>
              <span className="text-xs text-[#6b6960] text-right">Discount</span>
              <span className="tabular-nums text-right text-[#b4690e]">− {totalDiscount.toFixed(2)}</span>
            </>}
            <span className="text-xs text-[#6b6960] font-semibold text-right">Net total (customer pays)</span>
            <input
              className="inp text-right tabular-nums font-semibold"
              style={{ width: 150 }}
              type="number" min={0}
              value={netTotal > 0 ? netTotal.toFixed(2) : ""}
              onChange={(e) => applyNetTotal(Number(e.target.value))}
              placeholder="0.00"
            />
          </div>
        </div>
      )}

      {anyDiscount && (
        <div className="mb-4">
          <label className="text-xs text-[#6b6960]">Discount authorised by <span className="text-[#9a2b22]">*</span></label>
          <select className="inp mt-1" style={{ maxWidth: 320, borderColor: !discountBy ? "#b4690e" : undefined }}
            value={discountBy} onChange={(e) => setDiscountBy(e.target.value)}>
            <option value="">Select authoriser…</option>
            {authorisers.map((u) => (
              <option key={u.id} value={u.fullName || u.username}>
                {u.fullName || u.username} ({u.role})
              </option>
            ))}
          </select>
          {!discountBy && (
            <p className="text-xs mt-1" style={{ color: "#b4690e" }}>
              Discount entered — select an authorised person before saving.
            </p>
          )}
        </div>
      )}

      {anyOut && (
        <div className="mb-4">
          <label className="text-xs text-[#6b6960]">Authoriser (out-of-band price)</label>
          <input className="inp mt-1" style={{ maxWidth: 320 }} value={overrideBy} onChange={(e) => setOverrideBy(e.target.value)} />
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