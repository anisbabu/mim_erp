"use client";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { today } from "@/lib/fmt";
import {
  endpoints, fmtDate, type Account, type GrnRow, type PurchaseReturnable, type PurchaseReturnRow,
} from "@/lib/api";

const money = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Purchase returns: send goods back out of the receipt they came on; settle by debit note or a refund. */
export default function PurchaseReturnsPage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<PurchaseReturnRow[]>([]);
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [banks, setBanks] = useState<Account[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const [grnId, setGrnId] = useState("");
  const [data, setData] = useState<PurchaseReturnable | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [settlement, setSettlement] = useState<"DEBIT_NOTE" | "CASH_REFUND">("DEBIT_NOTE");
  const [returnDate, setReturnDate] = useState(today());
  const [refundTo, setRefundTo] = useState("1000");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = () => endpoints.purchaseReturns().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    loadList();
    endpoints.grnList().then(setGrns).catch(() => {});
    endpoints.chequeBankAccounts().then(setBanks).catch(() => {});
  }, []);

  const grnOpts: Option[] = useMemo(() => grns.map((g) => ({
    value: g.id, label: `${g.grn_no} · ${lang === "bn" && g.supplier_name_bn ? g.supplier_name_bn : g.supplier_name}`,
    sublabel: `${fmtDate(g.receipt_date)}${g.bill_no ? " · " + g.bill_no : ""}`,
  })), [grns, lang]);

  useEffect(() => {
    setData(null); setQty({}); setMsg(null);
    if (!grnId) return;
    endpoints.purchaseReturnable(grnId).then(setData).catch((e) => setMsg({ kind: "err", text: e.message }));
  }, [grnId]);

  const lines = data?.lines ?? [];
  const goods = lines.reduce((s, l) => s + (Number(qty[l.grn_line_id]) || 0) * l.unit_price, 0);

  async function submit() {
    if (!data) return;
    setMsg(null);
    const picked = lines.filter((l) => Number(qty[l.grn_line_id]) > 0)
      .map((l) => ({ grnLineId: l.grn_line_id, qty: Number(qty[l.grn_line_id]) }));
    if (picked.length === 0) { setMsg({ kind: "err", text: t("Enter a return quantity for at least one line.") }); return; }
    if (!reason.trim()) { setMsg({ kind: "err", text: t("Give the reason for the return.") }); return; }
    setBusy(true);
    try {
      const r = await endpoints.createPurchaseReturn({
        grnId, reason: reason.trim(), settlement, returnDate, lines: picked,
        refundAccount: settlement === "CASH_REFUND" ? refundTo : null,
      });
      setMsg({ kind: "ok", text: `${r.debitNoteNo ?? r.returnNo} ${t("recorded.")}` });
      setReason(""); setQty({});
      endpoints.purchaseReturnable(grnId).then(setData).catch(() => {});
      loadList();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.return_no, r.debit_note_no, r.grn_no, r.bill_no, r.supplier_code, r.supplier_name, r.reason]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)));
  }, [rows, q]);
  const pname = (l: { product_name: string; product_name_bn?: string }) => (lang === "bn" && l.product_name_bn ? l.product_name_bn : l.product_name);

  return (
    <div>
      <PageHeader crumbs={["Purchase", "Transactions"]} title={t("Purchase returns & debit notes")}
        subtitle={t("Send goods back to the supplier from the receipt they came on. Stock leaves that receipt's cost layer.")}
        actions={<button className="btn" onClick={() => setOpen((v) => !v)}>{open ? t("Close") : t("New return")}</button>} />

      {open && (
        <div className="card p-5 mb-6">
          <div className="section-label mb-3">{t("New return")}</div>
          <div className="form-grid cols-4">
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>{t("Goods receipt")} *</label>
              <SearchSelect options={grnOpts} value={grnId} onChange={setGrnId} placeholder={t("Select…")} />
            </div>
            {data && (
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>{t("Supplier")}</label>
                <div className="inp" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {lang === "bn" && data.receipt.supplier_name_bn ? data.receipt.supplier_name_bn : data.receipt.supplier_name}
                  <span className="chip bg-slate-100 text-slate-500">{data.receipt.supplier_code}</span>
                  {data.receipt.bill_no && <span className="chip bg-slate-100 text-slate-600">{t("Bill")} {data.receipt.bill_no}</span>}
                </div>
              </div>
            )}
          </div>

          {data && (
            <>
              <div className="card table-wrap mt-4">
                <table className="tbl" style={{ minWidth: 820 }}>
                  <thead><tr>
                    <th style={{ textAlign: "left" }}>{t("Product")}</th>
                    <th style={{ textAlign: "right" }}>{t("Received")}</th>
                    <th style={{ textAlign: "right" }}>{t("Returned")}</th>
                    <th style={{ textAlign: "right" }}>{t("In stock")}</th>
                    <th style={{ textAlign: "right" }}>{t("Available")}</th>
                    <th style={{ textAlign: "right" }}>{t("Billed price")}</th>
                    <th style={{ textAlign: "right", width: 120 }}>{t("Return qty")}</th>
                    <th style={{ textAlign: "right" }}>{t("Amount")}</th>
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const v = Number(qty[l.grn_line_id]) || 0;
                      const bad = v > l.qty_available || v < 0;
                      return (
                        <tr key={l.grn_line_id}>
                          <td>{pname(l)}</td>
                          <td className="num">{l.qty_received}</td>
                          <td className="num">{l.qty_returned}</td>
                          <td className="num">{l.qty_in_stock}</td>
                          <td className="num">{l.qty_available}</td>
                          <td className="num">{money(l.unit_price)}</td>
                          <td><input className="inp num" type="number" min={0} max={l.qty_available}
                            disabled={l.qty_available <= 0} value={qty[l.grn_line_id] ?? ""}
                            style={bad ? { borderColor: "#b91c1c" } : undefined}
                            onChange={(e) => setQty({ ...qty, [l.grn_line_id]: e.target.value })} /></td>
                          <td className="num">{money(v * l.unit_price)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={7} className="text-right font-medium">{t("Total to claim from supplier")}</td>
                    <td className="num font-semibold">{money(goods)}</td>
                  </tr></tfoot>
                </table>
              </div>

              <div className="form-grid cols-4 mt-4">
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>{t("Reason for return")} *</label>
                  <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div className="field">
                  <label>{t("Return date")} *</label>
                  <input className="inp" type="date" value={returnDate} max={today()}
                    min={String(data.receipt.receipt_date).slice(0, 10)} onChange={(e) => setReturnDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>{t("Settle by")}</label>
                  <select className="inp" value={settlement} onChange={(e) => setSettlement(e.target.value as "DEBIT_NOTE" | "CASH_REFUND")}>
                    <option value="DEBIT_NOTE">{t("Debit note (reduces what we owe)")}</option>
                    <option value="CASH_REFUND">{t("Refund received from supplier")}</option>
                  </select>
                </div>
                {settlement === "CASH_REFUND" && (
                  <div className="field" style={{ gridColumn: "span 2" }}>
                    <label>{t("Refund received into")}</label>
                    <select className="inp" value={refundTo} onChange={(e) => setRefundTo(e.target.value)}>
                      <option value="1000">{t("Cash")} (1000)</option>
                      {banks.map((b) => <option key={b.code} value={b.code}>{(lang === "bn" && b.nameBn) || b.name} ({b.code})</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button className="btn" onClick={submit} disabled={busy}>{busy ? t("Recording…") : t("Record return")}</button>
                <span className="text-[12px] muted">
                  {settlement === "DEBIT_NOTE" ? t("Dr Supplier ledger · Cr Inventory") : t("Dr Cash/Bank · Cr Inventory")}
                </span>
              </div>
            </>
          )}
          {msg && <div className={`note mt-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>{msg.text}</div>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="section-label">{t("Past returns")}</div>
        <div className="flex-1" />
        <input className="inp" style={{ maxWidth: 260 }} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 900 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("Return no.")}</th>
            <th style={{ textAlign: "left" }}>{t("Debit note")}</th>
            <th style={{ textAlign: "left" }}>{t("Date")}</th>
            <th style={{ textAlign: "left" }}>{t("Supplier")}</th>
            <th style={{ textAlign: "left" }}>GRN</th>
            <th style={{ textAlign: "left" }}>{t("Reason")}</th>
            <th style={{ textAlign: "right" }}>{t("Amount")}</th>
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[13px]">{r.return_no}</td>
                <td className="font-mono text-[13px]">
                  {r.debit_note_no ?? <span className="chip bg-slate-100 text-slate-600">{t("Refund")}</span>}
                </td>
                <td>{fmtDate(r.return_date)}</td>
                <td>{lang === "bn" && r.supplier_name_bn ? r.supplier_name_bn : r.supplier_name}
                  <span className="chip ml-2 bg-slate-100 text-slate-500">{r.supplier_code}</span></td>
                <td className="font-mono text-[13px]">{r.grn_no}{r.bill_no && <div className="muted text-[11px]">{r.bill_no}</div>}</td>
                <td className="muted">{r.reason}</td>
                <td className="num font-medium">{money(r.goods_value)}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={7} className="muted text-sm" style={{ padding: 20 }}>{t("No returns yet.")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
