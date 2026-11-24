"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import Drawer from "@/components/Drawer";
import { StatusChip } from "@/components/PoProgressChips";
import { endpoints, fmtDate, type SupplierBillRow } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import TopMessage from "@/components/TopMessage";

type Filter = "ALL" | "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";

/**
 * Supplier bills (accounts payable). A goods receipt only adds stock; the supplier's bill is what we owe.
 * Each bill shows what is paid and what remains; Pay opens a payment voucher against it.
 */
const FILTER_TONE: Record<string, string> = { ALL: "tone-all", UNPAID: "tone-warn", PARTIAL: "tone-info", PAID: "tone-ok", OVERDUE: "tone-bad" };

export default function SupplierBillsPage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<SupplierBillRow[]>([]);
  const [unbilled, setUnbilled] = useState(0);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [showCancelled, setShowCancelled] = useState(false);
  const [err, setErr] = useState("");
  const [cancel, setCancel] = useState<SupplierBillRow | null>(null);
  const [reason, setReason] = useState("");
  const [cErr, setCErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    endpoints.supplierBills().then(setRows).catch((e) => setErr(e.message));
    endpoints.unbilledGrns().then((r) => setUnbilled(r.length)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const overdue = (r: SupplierBillRow) => r.status === "POSTED" && r.open_amount > 0 && r.due_date < today();
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (showCancelled || r.status !== "CANCELLED")
      && (filter === "ALL" || (filter === "OVERDUE" ? overdue(r) : r.pay_status === filter))
      && (!s || [r.bill_no, r.supplier_invoice_no, r.po_no, r.grn_nos, r.supplier_code, r.supplier_name, r.supplier_name_bn]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s))));
  }, [rows, q, filter, showCancelled]);   // eslint-disable-line react-hooks/exhaustive-deps

  const live = shown.filter((r) => r.status === "POSTED");
  const totals = {
    total: live.reduce((s, r) => s + Number(r.amount), 0),
    paid: live.reduce((s, r) => s + Number(r.paid), 0),
    open: live.reduce((s, r) => s + Math.max(0, Number(r.open_amount)), 0),
  };
  const sname = (r: SupplierBillRow) => (lang === "bn" && r.supplier_name_bn ? r.supplier_name_bn : r.supplier_name);

  async function doCancel() {
    if (!cancel) return;
    if (!reason.trim()) { setCErr(t("Give the reason for cancelling the bill")); return; }
    setBusy(true); setCErr("");
    try { await endpoints.cancelSupplierBill(cancel.id, reason.trim()); setCancel(null); load(); }
    catch (e: any) { setCErr(e.message); } finally { setBusy(false); }
  }

  const chips: { key: Filter; label: string }[] = [
    { key: "ALL", label: "All" }, { key: "UNPAID", label: "Unpaid" }, { key: "PARTIAL", label: "Part paid" },
    { key: "PAID", label: "Paid" }, { key: "OVERDUE", label: "Overdue" },
  ];

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Supplier bills")}
        subtitle={t("What we owe each supplier, bill by bill: paid, part paid or still open.")}
        actions={<Link className="btn" href="/accounting/supplier-bills/new">{t("New bill")}</Link>} />

      {unbilled > 0 && (
        <div className="note mb-3">
          {t("Goods received but not billed yet")}: <b>{unbilled}</b>{" "}
          <Link className="text-brand" href="/accounting/supplier-bills/new">{t("Enter bill")} →</Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="inp" style={{ maxWidth: 260 }} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
        {chips.map((c) => (
          <button key={c.key} className={`filter-btn ${FILTER_TONE[c.key]}${filter === c.key ? " on" : ""}`} onClick={() => setFilter(c.key)}>{t(c.label)}</button>
        ))}
        <label className="flex items-center gap-1.5 text-[13px] muted ml-auto">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> {t("Show cancelled")}
        </label>
      </div>
      <TopMessage err={err} />

      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 1100 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>{t("Bill")}</th>
            <th style={{ textAlign: "left" }}>{t("Supplier bill no.")}</th>
            <th style={{ textAlign: "left" }}>{t("Supplier")}</th>
            <th style={{ textAlign: "left" }}>{t("PO / receipts")}</th>
            <th style={{ textAlign: "left" }}>{t("Bill date")}</th>
            <th style={{ textAlign: "left" }}>{t("Due date")}</th>
            <th style={{ textAlign: "right" }}>{t("Amount")}</th>
            <th style={{ textAlign: "right" }}>{t("Paid")}</th>
            <th style={{ textAlign: "right" }}>{t("Remaining")}</th>
            <th style={{ textAlign: "left" }}>{t("Status")}</th>
            <th />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} style={r.status === "CANCELLED" ? { opacity: 0.55 } : undefined}>
                <td className="font-mono text-[13px]">{r.bill_no}{r.legacy && <div className="muted text-[11px]">{t("with receipt")}</div>}</td>
                <td className="font-mono text-[13px]">{r.supplier_invoice_no ?? "—"}</td>
                <td>{sname(r)} <span className="chip ml-1 bg-slate-100 text-slate-500">{r.supplier_code}</span></td>
                <td className="font-mono text-[12px]">{r.po_no}<div className="muted text-[11px]">{r.grn_nos}</div></td>
                <td>{fmtDate(r.bill_date)}</td>
                <td style={overdue(r) ? { color: "#b91c1c" } : undefined}>{fmtDate(r.due_date)}</td>
                <td className="num">{fmtMoney(r.status === "CANCELLED" ? r.total : r.amount)}</td>
                <td className="num">{r.paid > 0 ? fmtMoney(r.paid) : "—"}</td>
                <td className="num font-medium">{r.status === "POSTED" && r.open_amount > 0 ? fmtMoney(r.open_amount) : "—"}</td>
                <td>
                  <StatusChip kind="pay" value={r.pay_status} />
                  {overdue(r) && <span className="chip ml-1 status-fail">{t("Overdue")}</span>}
                  {r.status === "CANCELLED" && r.cancel_reason && <div className="muted text-[11px]">{r.cancel_reason}</div>}
                </td>
                <td className="text-right whitespace-nowrap">
                  {r.status === "POSTED" && r.open_amount > 0 && (
                    <Link className="btn btn-sm" href={`/accounting/payments?type=SUPPLIER&party=${r.supplier_id}`}>{t("Pay")}</Link>
                  )}
                  {r.status === "POSTED" && !r.legacy && r.paid === 0 && (
                    <button className="btn-ghost btn-sm ml-1" onClick={() => { setCancel(r); setReason(""); setCErr(""); }}>{t("Cancel")}</button>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={11} className="muted text-sm" style={{ padding: 20 }}>{t("No supplier bills.")}</td></tr>}
          </tbody>
          {live.length > 0 && (
            <tfoot><tr>
              <td colSpan={6} className="text-right font-medium">{t("Total")}</td>
              <td className="num font-medium">{fmtMoney(totals.total)}</td>
              <td className="num font-medium">{fmtMoney(totals.paid)}</td>
              <td className="num font-medium">{fmtMoney(totals.open)}</td>
              <td colSpan={2} />
            </tr></tfoot>
          )}
        </table>
      </div>

      <Drawer open={!!cancel} onClose={() => setCancel(null)} title={t("Cancel supplier bill")}
        subtitle={cancel ? `${cancel.bill_no} · ${cancel.supplier_invoice_no ?? ""}` : undefined}
        footer={<>
          <button className="btn-ghost" onClick={() => setCancel(null)}>{t("Close")}</button>
          <button className="btn btn-danger" onClick={doCancel} disabled={busy}>{busy ? "…" : t("Cancel bill")}</button>
        </>}>
        <form onSubmit={(e) => { e.preventDefault(); doCancel(); }} className="flex flex-col gap-3">
          <p className="text-[13px] muted">{t("The bill's entry is reversed and its goods receipts can be billed again.")}</p>
          <div className="field"><label>{t("Reason")} <span className="req">*</span></label>
            <input className="inp" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="h-4 leading-4 text-[11px]" style={{ color: "#b91c1c" }}>{cErr}</div></div>
          <button type="submit" hidden />
        </form>
      </Drawer>
    </div>
  );
}
