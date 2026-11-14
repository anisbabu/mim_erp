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
  const [price, setPrice] = useState<Record<string, string>>({});        // supplier's billed unit price per line
  const [bill, setBill] = useState({ billNo: "", billDate: "", dueDate: "", freight: "", freightOnBill: true, priceApprovedBy: "", vat: "" });
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
    const sq: Record<string, string> = {}, sp: Record<string, string> = {}, sr: Record<string, boolean> = {}, pr: Record<string, string> = {};
    v.lines.forEach((l) => {
      sq[l.poLineId] = String(l.qtyBalance); sp[l.poLineId] = l.productId; sr[l.poLineId] = l.qtyBalance > 0;
      pr[l.poLineId] = String(l.unitPrice);
    });
    setRecv(sq); setRecvProduct(sp); setReceived(sr); setPrice(pr);
    setBill({ billNo: "", billDate: "", dueDate: "", freight: "", freightOnBill: true, priceApprovedBy: "", vat: "" });
  }
  function loadPo(id: string) {
    if (!id) { setPo(null); setHistory([]); return; }
    endpoints.receiveView(id).then((v) => { setPo(v); seed(v); });
    endpoints.receipts(id).then(setHistory).catch(() => {});
  }
  useEffect(() => { loadPo(poId); }, [poId]);

  const isClosed = po?.status === "CLOSED";
  const priceOf = (l: PoView["lines"][number]) => (l.freeProduct ? 0 : Number(price[l.poLineId] ?? l.unitPrice) || 0);
  const priceChanged = (po?.lines ?? []).some((l) => received[l.poLineId] && !l.freeProduct && priceOf(l) !== l.unitPrice);
  const goodsValue = (po?.lines ?? []).reduce((s, l) => s + (received[l.poLineId] ? Number(recv[l.poLineId] || 0) * priceOf(l) : 0), 0);
  const freight = Number(bill.freight) || 0;
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
      .map((l) => ({
        poLineId: l.poLineId, qtyReceived: Number(recv[l.poLineId] || 0), receivedProductId: recvProduct[l.poLineId] || l.productId,
        billPrice: l.freeProduct ? null : Number(price[l.poLineId] ?? l.unitPrice),
      }))
      .filter((l) => l.qtyReceived > 0);
    if (lines.length === 0) { setMsg({ kind: "err", text: t("Tick at least one line as received with a quantity.") }); return; }
    if (priceChanged && !bill.priceApprovedBy.trim()) { setMsg({ kind: "err", text: t("The billed price differs from the PO price - name who approved it.") }); return; }
    setBusy(true); setMsg(null);
    try {
      await endpoints.receive(poId, {
        warehouseId, lines,
        billNo: bill.billNo.trim() || null, billDate: bill.billDate || null, dueDate: bill.dueDate || null,
        freight: Number(bill.freight) || 0, freightOnBill: bill.freightOnBill,
        priceApprovedBy: bill.priceApprovedBy.trim() || null,
        vat: Number(bill.vat) || 0,
      });
      setMsg({ kind: "ok", text: t("Goods received. Stock created, PO balance updated and the supplier bill posted.") });
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
              <th className="text-center" style={{ width: 90 }} title={t("Received")}>
                <ReceiveIcon size={16} className="inline-block" />
              </th>
              <th style={{ maxWidth: 180 }}>{t("Product")}</th>
              <th>{t("Receiving")} ↔</th>
              <th className="text-center">{t("Ordered")}</th>
              <th className="text-center">{t("Balance")}</th>
              <th className="text-center">{t("Qty")}</th>
              <th className="text-center">{t("New bal.")}</th>
              <th className="text-right">{t("PO price")}</th>
              <th className="text-center">{t("Billed price")}</th>
              <th className="text-right">{t("Amount")}</th>
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
                    <td>
                      <SearchSelect options={productOpts} value={recvProduct[l.poLineId] || l.productId}
                        onChange={(v) => setProd(l.poLineId, v)} placeholder={t("Search…")} disabled={!on} /></td>
                    <td className="num text-center">{l.qtyOrdered}</td>
                    <td className="num text-center">{l.qtyBalance}</td>
                    <td className="text-center" style={{ verticalAlign: "middle" }}>
                      <input className="inp num text-center" style={{ width: 90, marginLeft: "auto", marginRight: "auto", borderColor: invalid ? "#b45309" : undefined }}
                        type="text" inputMode="numeric" disabled={!on}
                        value={on ? (recv[l.poLineId] ?? "") : "0"}
                        onChange={(e) => setQty(l.poLineId, e.target.value.replace(/[^0-9]/g, ""))} /></td>
                    <td className="num text-center">
                      <div style={{ width: 90, marginLeft: "auto", marginRight: "auto", color: newBal === 0 ? "var(--brand)" : undefined }}>{newBal}</div>
                    </td>
                    <td className="num">{l.freeProduct ? t("Free") : money(l.unitPrice)}</td>
                    <td className="text-center">
                      <input className="inp num text-center" style={{ width: 100, marginLeft: "auto", marginRight: "auto",
                        borderColor: !l.freeProduct && priceOf(l) !== l.unitPrice ? "#b45309" : undefined }}
                        type="text" inputMode="decimal" disabled={!on || l.freeProduct}
                        value={l.freeProduct ? "0" : (price[l.poLineId] ?? "")}
                        onChange={(e) => setPrice((p) => ({ ...p, [l.poLineId]: e.target.value.replace(/[^0-9.]/g, "") }))} /></td>
                    <td className="num">{money(r * priceOf(l))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!isClosed && (
            <div className="px-4 py-4 border-t border-slate-200">
              <div className="section-label mb-3">{t("Supplier bill")}</div>
              <div className="form-grid cols-4">
                <div className="field"><label>{t("Supplier bill no.")}</label>
                  <input className="inp" value={bill.billNo} onChange={(e) => setBill({ ...bill, billNo: e.target.value })}
                    placeholder={t("Can be keyed later")} /></div>
                <div className="field"><label>{t("Bill date")}</label>
                  <input className="inp" type="date" value={bill.billDate} max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setBill({ ...bill, billDate: e.target.value })} /></div>
                <div className="field"><label>{t("Due date")}</label>
                  <input className="inp" type="date" value={bill.dueDate} min={bill.billDate || undefined}
                    onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} />
                  <div className="h-4 leading-4 text-[11px] muted">{t("Blank = bill date + supplier credit days")}</div></div>
                <div className="field"><label>{t("Freight / carriage")}</label>
                  <input className="inp num" type="text" inputMode="decimal" value={bill.freight}
                    onChange={(e) => setBill({ ...bill, freight: e.target.value.replace(/[^0-9.]/g, "") })} />
                  <div className="h-4 leading-4 text-[11px] muted">{t("Added to the stock cost")}</div></div>
                <div className="field"><label>{t("Input VAT on bill")}</label>
                  <input className="inp num" type="text" inputMode="decimal" value={bill.vat}
                    onChange={(e) => setBill({ ...bill, vat: e.target.value.replace(/[^0-9.]/g, "") })} />
                  <div className="h-4 leading-4 text-[11px] muted">{t("From Mushak 6.3; inside the billed prices")}</div></div>
                {freight > 0 && (
                  <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Freight paid")}</label>
                    <select className="inp" value={bill.freightOnBill ? "BILL" : "CASH"}
                      onChange={(e) => setBill({ ...bill, freightOnBill: e.target.value === "BILL" })}>
                      <option value="BILL">{t("Charged by the supplier on this bill")}</option>
                      <option value="CASH">{t("Paid to the carrier in cash")}</option>
                    </select></div>
                )}
                {priceChanged && (
                  <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Price change approved by")} *</label>
                    <input className="inp" value={bill.priceApprovedBy} onChange={(e) => setBill({ ...bill, priceApprovedBy: e.target.value })} />
                    <div className="h-4 leading-4 text-[11px]" style={{ color: "#b45309" }}>{t("A billed price differs from the PO price")}</div></div>
                )}
              </div>
              <div className="flex justify-end gap-6 text-sm mt-2">
                <span className="muted">{t("Goods")}: <b className="num">{money(goodsValue)}</b></span>
                {freight > 0 && <span className="muted">{t("Freight")}: <b className="num">{money(freight)}</b></span>}
                <span>{t("Payable to supplier")}: <b className="num">{money(goodsValue + (bill.freightOnBill ? freight : 0))}</b></span>
              </div>
            </div>
          )}
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
