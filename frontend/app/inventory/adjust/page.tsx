"use client";
import { useEffect, useState } from "react";
import { endpoints, type Product, type Warehouse } from "@/lib/api";

export default function AdjustPage() {
  const [type, setType] = useState<"DAMAGE" | "COUNT" | "TRANSFER">("DAMAGE");
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [productId, setProductId] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
  }, []);

  const isTransfer = type === "TRANSFER";

  async function submit() {
    setMsg(null);
    if (!productId || !fromWarehouseId || !(Number(qty) > 0)) {
      setMsg({ kind: "err", text: "Product, source warehouse and quantity are required." }); return;
    }
    if (isTransfer && !toWarehouseId) { setMsg({ kind: "err", text: "Choose a destination warehouse." }); return; }
    setBusy(true);
    try {
      const a: any = await endpoints.adjust({
        type, productId, fromWarehouseId,
        toWarehouseId: isTransfer ? toWarehouseId : null,
        qty: Number(qty), reason,
      });
      setMsg({ kind: "ok", text: `Adjustment ${a.adjNo} posted.` });
      setQty(""); setReason("");
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-lg">
      <h1 className="page-title mb-1">Stock adjustment</h1>
      <p className="text-sm text-[#6b6960] mb-6">
        Write off damaged stock, correct a count, or transfer stock between warehouses. Damage and count
        post a loss at FIFO cost; transfer just moves cost layers (no profit impact).
      </p>
      <div className="flex gap-1 mb-5 text-sm">
        {(["DAMAGE", "COUNT", "TRANSFER"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className="px-3 py-1.5 rounded-lg"
            style={{ background: type === t ? "#1d5e4f" : "#fff", color: type === t ? "#fff" : "#1c1b19", border: "1px solid #d8d4ca" }}>
            {t[0] + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-[#6b6960]">Product</label>
          <select className="inp mt-1" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.thicknessMm ? ` (${p.thicknessMm}mm)` : ""}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#6b6960]">{isTransfer ? "From warehouse" : "Warehouse"}</label>
            <select className="inp mt-1" value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          {isTransfer && (
            <div>
              <label className="text-xs text-[#6b6960]">To warehouse</label>
              <select className="inp mt-1" value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
                <option value="">Select…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">Quantity</label>
          <input className="inp mt-1 text-right tabular-nums" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">Reason</label>
          <input className="inp mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "Posting…" : "Post adjustment"}</button>
      </div>
      {msg && (
        <div className="mt-4 text-sm rounded-lg px-4 py-3"
             style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb", color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
