"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { endpoints, fmtDate, type PoView, type Warehouse, type Product, type ReceiptView, type PurchaseOrder } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ReceiveIcon } from "@/components/Icons";
import SearchSelect, { type Option } from "@/components/SearchSelect";

export default function ReceivePage() {
  const { t, dn } = useI18n();
  const searchParams = useSearchParams();
  const [allPosList, setAllPosList] = useState<PurchaseOrder[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [poId, setPoId] = useState(searchParams.get("poId") ?? "");
  const [warehouseId, setWarehouseId] = useState("");
  const [po, setPo] = useState<PoView | null>(null);
  const [history, setHistory] = useState<ReceiptView[]>([]);
  const [recv, setRecv] = useState<Record<string, string>>({});
  const [recvProduct, setRecvProduct] = useState<Record<string, string>>({});
  const [received, setReceived] = useState<Record<string, boolean>>({});  // per-line received flag
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.allPos().then(setAllPosList).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
    endpoints.products().then(setProducts).catch(() => {});
  }, []);

  const productOpts: Option[] = useMemo(
    () => products.map((p) => ({ value: p.id, label: p.fullName || (dn(p) + (p.thicknessMm ? ` (${p.thicknessMm}mm)` : "")), sublabel: p.sku })),
    [products, dn]);

  function seed(v: PoView) {
    const sq: Record<string, string> = {}, sp: Record<string, string> = {}, sr: Record<string, boolean> = {};
    v.lines.forEach((l) => { sq[l.poLineId] = String(l.qtyBalance); sp[l.poLineId] = l.productId; sr[l.poLineId] = l.qtyBalance > 0; });
    setRecv(sq); setRecvProduct(sp); setReceived(sr);
  }
  function loadPo(id: string) {
    if (!id) { setPo(null); setHistory([]); return; }
    endpoints.receiveView(id).then((v) => { setPo(v); seed(v); });
    endpoints.receipts(id).then(setHistory).catch(() => {});
  }
  useEffect(() => { loadPo(poId); }, [poId]);

  const isClosed = po?.status === "CLOSED";

  const setQty = (id: string, val: string) => setRecv((r) => ({ ...r, [id]: val }));
  const setProd = (id: string, val: string) => setRecvProduct((r) => ({ ...r, [id]: val }));
  const toggle = (id: string, on: boolean, bal: number) => {
    setReceived((r) => ({ ...r, [id]: on }));
    setRecv((r) => ({ ...r, [id]: on ? String(bal) : "0" }));
  };

  async function submit() {
    if (!warehouseId) { setMsg({ kind: "err", text: "Select a warehouse to receive into." }); return; }
    // only checked ("received") lines with qty > 0 are sent; unchecked = not received
    const lines = (po?.lines ?? [])
      .filter((l) => received[l.poLineId])
      .map((l) => ({ poLineId: l.poLineId, qtyReceived: Number(recv[l.poLineId] || 0), receivedProductId: recvProduct[l.poLineId] || l.productId }))
      .filter((l) => l.qtyReceived > 0);
    if (lines.length === 0) { setMsg({ kind: "err", text: "Tick at least one line as received with a quantity." }); return; }
    setBusy(true); setMsg(null);
    try {
      await endpoints.receive(poId, { warehouseId, lines });
      setMsg({ kind: "ok", text: "Goods received. Stock created and PO balance updated." });
      const v = await endpoints.receiveView(poId); setPo(v); seed(v);
      endpoints.receipts(poId).then(setHistory);
      endpoints.allPos().then(setAllPosList).catch(() => {});
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div>
      <h1 className="page-title mb-1">{t("Receive")}</h1>
      <p className="text-sm muted mb-6">
        Tick the lines the supplier actually delivered. Untick a line if it wasn’t received — only ticked lines are taken in.
        A line can arrive as a different colour/SKU; price and balance stay tied to the order.
      </p>

      <div className="form-grid cols-2 mb-6">
        <div className="field"><label>{t("Purchase orders")}</label>
          <SearchSelect
            options={allPosList.map((p) => ({ value: p.id, label: p.poNo, sublabel: p.status }))}
            value={poId}
            onChange={setPoId}
            placeholder={t("Search…")}
          /></div>
        <div className="field"><label>{t("Warehouse")}</label>
          <select className="inp" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={isClosed}>
            <option value="">—</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{dn(w)}</option>)}
          </select></div>
      </div>

      {po && (
        <div className="card table-wrap mb-6">
          <table className="tbl">
            <thead><tr>
              <th className="text-center" style={{ width: 90 }}>{t("Received")}</th>
              <th style={{ maxWidth: 180 }}>{t("Product")}</th>
              <th className="text-right">{t("Ordered")}</th>
              <th className="text-right">{t("Unit price")}</th>
              <th className="text-right">{t("Balance")}</th>
              <th>{t("Receiving")} ↔</th>
              <th className="text-right">{t("Qty")}</th>
              <th className="text-right">New bal.</th>
            </tr></thead>
            <tbody>
              {po.lines.map((l) => {
                const on = !!received[l.poLineId];
                const r = on ? Number(recv[l.poLineId] || 0) : 0;
                const newBal = l.qtyBalance - r;
                const invalid = on && (r < 0 || r > l.qtyBalance);
                const sub = (recvProduct[l.poLineId] || l.productId) !== l.productId;
                return (
                  <tr key={l.poLineId} style={{ opacity: on ? 1 : 0.45 }}>
                    <td className="text-center">
                      <input type="checkbox" checked={on} disabled={isClosed || l.qtyBalance === 0}
                        onChange={(e) => toggle(l.poLineId, e.target.checked, l.qtyBalance)} /></td>
                    <td style={{ maxWidth: 180 }}>
                      <div className="truncate" title={l.productName}>{l.productName}</div>
                      {sub && <span className="chip bg-amber-50 text-amberwarn">sub</span>}
                    </td>
                    <td className="num">{l.qtyOrdered}</td>
                    <td className="num">{l.unitPrice.toFixed(2)}</td>
                    <td className="num">{l.qtyBalance}</td>
                    <td>
                      <SearchSelect options={productOpts} value={recvProduct[l.poLineId] || l.productId}
                        onChange={(v) => setProd(l.poLineId, v)} placeholder={t("Search…")} disabled={!on} /></td>
                    <td className="text-right">
                      <input className="inp num" style={{ width: 90, marginLeft: "auto", borderColor: invalid ? "#b45309" : undefined }}
                        type="number" min={0} max={l.qtyBalance} disabled={!on}
                        value={on ? (recv[l.poLineId] ?? "") : "0"} onChange={(e) => setQty(l.poLineId, e.target.value)} /></td>
                    <td className="num" style={{ color: newBal === 0 ? "#0f766e" : undefined }}>{newBal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
            <span className="text-xs muted">PO {po.poNo} · {po.status}</span>
            {!isClosed && (
              <button className="btn inline-flex items-center gap-1.5" onClick={submit} disabled={busy}>
                {busy ? "…" : <><ReceiveIcon /> {t("Receive")}</>}
              </button>
            )}
          </div>
        </div>
      )}

      {msg && <div className={`note mb-6 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}

      {po && (
        <>
          <div className="section-label mb-3">{t("Receipt history")}</div>
          <div className="card table-wrap">
            <table className="tbl">
              <thead><tr><th>{t("Date")}</th><th>GRN</th><th>{t("Product")}</th><th>{t("Warehouse")}</th><th className="text-right">{t("Qty")}</th></tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td>{fmtDate(h.receiptDate)}</td>
                    <td className="font-mono text-[13px]">{h.grnNo}</td>
                    <td>{h.productName}</td>
                    <td>{h.warehouseId ? (warehouses.find((w) => w.id === h.warehouseId)?.name ?? "—") : "—"}</td>
                    <td className="num">{h.qtyReceived}</td>
                  </tr>
                ))}
                {history.length === 0 && <tr><td colSpan={4} className="muted text-sm">No receipts yet against this PO.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
