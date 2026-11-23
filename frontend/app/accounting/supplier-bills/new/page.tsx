"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DateInput from "@/components/DateInput";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { endpoints, fmtDate, type UnbilledGrn } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Enter a supplier's bill against goods already received (one PO per bill). The receipts' value moves from
 * "Goods received, not billed" to the supplier; a billed amount above / below the receipt is a price variance.
 */
export default function NewSupplierBillPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [grns, setGrns] = useState<UnbilledGrn[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});   // grnId -> billed amount
  const [invoice, setInvoice] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    endpoints.unbilledGrns().then((rows) => {
      setGrns(rows);
      const want = new URLSearchParams(window.location.search).get("grn");
      const g = want ? rows.find((r) => r.grn_id === want) : undefined;
      if (g) {
        setSupplierId(g.supplier_id);
        setPicked({ [g.grn_id]: String(g.to_bill) });
        if (g.bill_no) setInvoice(g.bill_no);
        if (g.bill_date) setBillDate(g.bill_date);
      }
    }).catch((e) => setErr(e.message));
  }, []);

  const sname = (g: UnbilledGrn) => (lang === "bn" && g.supplier_name_bn ? g.supplier_name_bn : g.supplier_name);
  const supplierOpts: Option[] = useMemo(() => {
    const seen = new Map<string, Option>();
    for (const g of grns) if (!seen.has(g.supplier_id)) seen.set(g.supplier_id, { value: g.supplier_id, label: sname(g), sublabel: g.supplier_code });
    return Array.from(seen.values());
  }, [grns, lang]);   // eslint-disable-line react-hooks/exhaustive-deps

  const mine = grns.filter((g) => g.supplier_id === supplierId);
  const byPo = useMemo(() => {
    const m = new Map<string, UnbilledGrn[]>();
    for (const g of mine) m.set(g.po_no, [...(m.get(g.po_no) ?? []), g]);
    return Array.from(m.entries());
  }, [mine]);
  const pickedPo = mine.find((g) => picked[g.grn_id] !== undefined)?.po_id;

  function toggle(g: UnbilledGrn) {
    setErr("");
    setPicked((p) => {
      if (p[g.grn_id] !== undefined) { const n = { ...p }; delete n[g.grn_id]; return n; }
      const base = pickedPo && pickedPo !== g.po_id ? {} : p;   // one bill = one PO
      return { ...base, [g.grn_id]: String(g.to_bill) };
    });
    if (!invoice && g.bill_no) setInvoice(g.bill_no);
  }

  const lines = mine.filter((g) => picked[g.grn_id] !== undefined);
  const received = r2(lines.reduce((s, g) => s + Number(g.to_bill), 0));
  const billed = r2(lines.reduce((s, g) => s + (Number(picked[g.grn_id]) || 0), 0));
  const variance = r2(billed - received);

  async function save() {
    if (!supplierId) { setErr(t("Pick a supplier")); return; }
    if (lines.length === 0) { setErr(t("Pick at least one goods receipt to bill")); return; }
    if (!invoice.trim()) { setErr(t("Enter the supplier's bill number")); return; }
    if (lines.some((g) => !(Number(picked[g.grn_id]) > 0))) { setErr(t("Every billed amount must be more than zero")); return; }
    setBusy(true); setErr("");
    try {
      await endpoints.createSupplierBill({
        supplierInvoiceNo: invoice.trim(), billDate: billDate || null, dueDate: dueDate || null, note: note.trim() || null,
        lines: lines.map((g) => ({ grnId: g.grn_id, amount: Number(picked[g.grn_id]) })),
      });
      router.push("/accounting/supplier-bills");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader crumbs={["Accounting", "Supplier bills"]} title={t("New bill")}
        subtitle={t("Enter the supplier's invoice against goods already received. It becomes what we owe the supplier.")}
        actions={<>
          <Link className="btn-ghost" href="/accounting/supplier-bills">{t("Cancel")}</Link>
          <button className="btn" onClick={save} disabled={busy}>{busy ? "…" : t("Post bill")}</button>
        </>} />

      <form className="card p-5 mb-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Supplier")} <span className="req">*</span></label>
            <SearchSelect options={supplierOpts} value={supplierId} onChange={(v) => { setSupplierId(v); setPicked({}); setErr(""); }}
              placeholder={t("Suppliers with goods not billed…")} />
            <div className="h-4 leading-4 text-[11px] muted">{supplierId ? `${mine.length} ${t("receipts not billed")}` : ""}</div></div>
          <div className="field"><label>{t("Supplier bill no.")} <span className="req">*</span></label>
            <input className="inp" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
            <div className="h-4 leading-4" /></div>
          <div className="field"><label>{t("Bill date")}</label>
            <DateInput className="inp" max={today()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            <div className="h-4 leading-4" /></div>
          <div className="field"><label>{t("Due date")}</label>
            <DateInput className="inp" min={billDate || undefined} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <div className="h-4 leading-4 text-[11px] muted">{t("Blank = bill date + supplier credit days")}</div></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label>{t("Note")}</label>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="h-4 leading-4" /></div>
        </div>
        <button type="submit" hidden />
      </form>

      {err && <div className="note note-err mb-3">{err}</div>}

      {supplierId && (
        <div className="card table-wrap mb-4">
          <table className="tbl">
            <thead><tr>
              <th style={{ width: 36 }} />
              <th style={{ textAlign: "left" }}>{t("Goods receipt")}</th>
              <th style={{ textAlign: "left" }}>{t("Received")}</th>
              <th style={{ textAlign: "left" }}>{t("Bill no. on receipt")}</th>
              <th style={{ textAlign: "right" }}>{t("Value received")}</th>
              <th style={{ textAlign: "right" }}>{t("Billed amount")}</th>
            </tr></thead>
            <tbody>
              {byPo.map(([po, list]) => (
                <Fragment key={po}>
                  <tr><td colSpan={6} className="font-mono text-[12px] muted" style={{ background: "var(--bg)" }}>PO {po}</td></tr>
                  {list.map((g) => {
                    const on = picked[g.grn_id] !== undefined;
                    return (
                      <tr key={g.grn_id}>
                        <td><input type="checkbox" checked={on} onChange={() => toggle(g)} /></td>
                        <td className="font-mono text-[13px]">{g.grn_no}</td>
                        <td>{fmtDate(g.receipt_date)}</td>
                        <td className="font-mono text-[13px]">{g.bill_no ?? "—"}</td>
                        <td className="num">{fmtMoney(g.to_bill)}</td>
                        <td className="num">
                          {on ? <input className="inp num" style={{ width: 120 }} type="number" step="0.01" min="0"
                                       value={picked[g.grn_id]} onChange={(e) => setPicked({ ...picked, [g.grn_id]: e.target.value })} />
                              : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
              {mine.length === 0 && <tr><td colSpan={6} className="muted text-sm" style={{ padding: 20 }}>{t("Nothing left to bill for this supplier.")}</td></tr>}
            </tbody>
            {lines.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-right font-medium">{t("Total")}</td>
                  <td className="num font-medium">{fmtMoney(received)}</td>
                  <td className="num font-medium">{fmtMoney(billed)}</td>
                </tr>
                {variance !== 0 && (
                  <tr><td colSpan={6} className="text-right text-[12px]" style={{ color: "#b45309" }}>
                    {t("Price difference")} {variance > 0 ? "+" : ""}{fmtMoney(variance)} — {t("posted to cost of goods sold")}
                  </td></tr>
                )}
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="text-[12px] muted">{t("One bill covers receipts of one purchase order. Goods sent back before the bill are already taken off the value received.")}</p>
    </div>
  );
}
