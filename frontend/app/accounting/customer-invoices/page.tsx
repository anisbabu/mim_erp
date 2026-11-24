"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { StatusChip } from "@/components/PoProgressChips";
import { endpoints, fmtDate, type CustomerInvoiceRow } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import TopMessage from "@/components/TopMessage";

type Filter = "ALL" | "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE";

/**
 * Customer invoices (accounts receivable). The delivery is the invoice: every delivery, day-end invoice and
 * opening balance shows what is received and what remains; Receive opens a receipt voucher against it.
 * A sales order closes once everything is delivered and all its invoices are paid.
 */
const FILTER_TONE: Record<string, string> = { ALL: "tone-all", UNPAID: "tone-warn", PARTIAL: "tone-info", PAID: "tone-ok", OVERDUE: "tone-bad" };

export default function CustomerInvoicesPage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<CustomerInvoiceRow[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("UNPAID");
  const [err, setErr] = useState("");

  useEffect(() => { endpoints.customerInvoices().then(setRows).catch((e) => setErr(e.message)); }, []);

  const overdue = (r: CustomerInvoiceRow) => r.open_amount > 0 && !!r.due_date && r.due_date < today();
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (filter === "ALL" || (filter === "OVERDUE" ? overdue(r)
        : filter === "UNPAID" ? r.pay_status !== "PAID" : r.pay_status === filter))
      && (!s || [r.doc_no, r.so_no, r.dc_no, r.customer_code, r.customer_name, r.customer_name_bn]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s))));
  }, [rows, q, filter]);   // eslint-disable-line react-hooks/exhaustive-deps

  const totals = {
    total: shown.reduce((s, r) => s + Number(r.amount), 0),
    paid: shown.reduce((s, r) => s + Number(r.paid), 0),
    open: shown.reduce((s, r) => s + Math.max(0, Number(r.open_amount)), 0),
  };
  const cname = (r: CustomerInvoiceRow) => (lang === "bn" && r.customer_name_bn ? r.customer_name_bn : r.customer_name);
  const owed = rows.reduce((s, r) => s + Math.max(0, Number(r.open_amount)), 0);

  // "Unpaid" here means anything still owed (unpaid or part paid) — what the counter chases
  const chips: { key: Filter; label: string }[] = [
    { key: "UNPAID", label: "Unpaid" }, { key: "PARTIAL", label: "Part paid" }, { key: "OVERDUE", label: "Overdue" },
    { key: "PAID", label: "Paid" }, { key: "ALL", label: "All" },
  ];
  const center = { textAlign: "center" as const };
  const right = { textAlign: "right" as const };

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Transactions"]} title={t("Customer invoices")}
        subtitle={t("What each customer owes, invoice by invoice: paid, part paid or still open.")}
        actions={<Link className="btn" href="/accounting/payments?type=CUSTOMER">{t("Receive")}</Link>} />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="inp" style={{ maxWidth: 260 }} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
        {chips.map((c) => (
          <button key={c.key} className={`filter-btn ${FILTER_TONE[c.key]}${filter === c.key ? " on" : ""}`} onClick={() => setFilter(c.key)}>{t(c.label)}</button>
        ))}
        <span className="ml-auto text-[13px] muted">{t("Total owed")}: <b className="tabular-nums" style={{ color: "var(--text)" }}>{fmtMoney(owed)}</b></span>
      </div>
      <TopMessage err={err} />

      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 1000 }}>
          <thead><tr>
            <th style={center}>{t("Invoice")}</th>
            <th style={center}>{t("Customer")}</th>
            <th style={center}>{t("Sales order / challan")}</th>
            <th style={center}>{t("Date")}</th>
            <th style={center}>{t("Due date")}</th>
            <th style={right}>{t("Amount")}</th>
            <th style={right}>{t("Paid")}</th>
            <th style={right}>{t("Remaining")}</th>
            <th style={center}>{t("Status")}</th>
            <th />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.item_id}>
                <td className="font-mono text-[13px] text-center">{r.doc_no}</td>
                <td className="text-center">{cname(r)} <span className="chip ml-1 bg-slate-100 text-slate-500">{r.customer_code}</span></td>
                <td className="font-mono text-[12px] text-center">
                  {r.source_type === "OPENING" ? <span className="muted">{t("Opening balance")}</span> : (r.so_no ?? "—")}
                  {r.dc_no && <div className="muted text-[11px]">{r.dc_no}</div>}
                </td>
                <td className="text-center">{fmtDate(r.doc_date)}</td>
                <td className="text-center" style={overdue(r) ? { color: "#b91c1c" } : undefined}>{r.due_date ? fmtDate(r.due_date) : "—"}</td>
                <td className="num">{fmtMoney(r.amount)}</td>
                <td className="num">{r.paid > 0 ? fmtMoney(r.paid) : "—"}</td>
                <td className="num font-medium">{r.open_amount > 0 ? fmtMoney(r.open_amount) : "—"}</td>
                <td className="text-center whitespace-nowrap">
                  <StatusChip kind="pay" value={r.pay_status} />
                  {overdue(r) && <span className="chip ml-1 status-fail">{t("Overdue")}</span>}
                </td>
                <td className="text-right whitespace-nowrap">
                  {r.open_amount > 0 && (
                    <Link className="btn btn-sm" href={`/accounting/payments?type=CUSTOMER&party=${r.customer_id}`}>{t("Receive")}</Link>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={10} className="muted text-sm" style={{ padding: 20 }}>{t("No customer invoices.")}</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot><tr>
              <td colSpan={5} className="text-right font-medium">{t("Total")}</td>
              <td className="num font-medium">{fmtMoney(totals.total)}</td>
              <td className="num font-medium">{fmtMoney(totals.paid)}</td>
              <td className="num font-medium">{fmtMoney(totals.open)}</td>
              <td colSpan={2} />
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
