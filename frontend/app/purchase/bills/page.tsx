"use client";
import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Drawer from "@/components/Drawer";
import { endpoints, fmtDate, type GrnRow } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";

/** Supplier bills: every goods receipt with the supplier's invoice no., dates and value; key or correct bill details. */
export default function SupplierBillsPage() {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<GrnRow[]>([]);
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [edit, setEdit] = useState<GrnRow | null>(null);
  const [f, setF] = useState({ billNo: "", billDate: "", dueDate: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => endpoints.grnList().then(setRows).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!onlyMissing || !r.bill_no) && (!s || [r.grn_no, r.bill_no, r.po_no, r.supplier_code, r.supplier_name]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s))));
  }, [rows, q, onlyMissing]);

  function open(r: GrnRow) {
    setErr(""); setEdit(r);
    setF({ billNo: r.bill_no ?? "", billDate: r.bill_date ?? "", dueDate: r.due_date ?? "" });
  }
  async function save() {
    if (!edit) return;
    if (!f.billNo.trim()) { setErr(t("Enter the supplier's bill number.")); return; }
    setBusy(true); setErr("");
    try {
      await endpoints.updateGrnBill(edit.id, { billNo: f.billNo.trim(), billDate: f.billDate || null, dueDate: f.dueDate || null });
      setEdit(null); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const sname = (r: GrnRow) => (lang === "bn" && r.supplier_name_bn ? r.supplier_name_bn : r.supplier_name);

  return (
    <div>
      <PageHeader crumbs={["Purchase", "Transactions"]} title={t("Supplier bills")}
        subtitle={t("Each goods receipt with the supplier's own bill no. and due date. Key a bill that arrived after the goods.")} />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="inp" style={{ maxWidth: 260 }} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={onlyMissing ? "btn" : "btn-ghost"} onClick={() => setOnlyMissing((v) => !v)}>{t("Bill not keyed")}</button>
      </div>
      {err && !edit && <div className="note note-err mb-3">{err}</div>}
      <div className="card table-wrap">
        <table className="tbl" style={{ minWidth: 980 }}>
          <thead><tr>
            <th style={{ textAlign: "left" }}>GRN</th>
            <th style={{ textAlign: "left" }}>{t("Received")}</th>
            <th style={{ textAlign: "left" }}>{t("Supplier")}</th>
            <th style={{ textAlign: "left" }}>{t("Supplier bill no.")}</th>
            <th style={{ textAlign: "left" }}>{t("Bill date")}</th>
            <th style={{ textAlign: "left" }}>{t("Due date")}</th>
            <th style={{ textAlign: "right" }}>{t("Goods")}</th>
            <th style={{ textAlign: "right" }}>{t("Freight")}</th>
            <th style={{ textAlign: "right" }}>{t("Returned")}</th>
            <th />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[13px]">{r.grn_no}<div className="muted text-[11px]">{r.po_no}</div></td>
                <td>{fmtDate(r.receipt_date)}</td>
                <td>{sname(r)} <span className="chip ml-1 bg-slate-100 text-slate-500">{r.supplier_code}</span></td>
                <td className="font-mono text-[13px]">{r.bill_no ?? <span className="chip bg-amber-50 text-amberwarn">{t("Not keyed")}</span>}</td>
                <td>{r.bill_date ? fmtDate(r.bill_date) : "—"}</td>
                <td style={r.due_date && r.due_date < today() ? { color: "#b91c1c" } : undefined}>{r.due_date ? fmtDate(r.due_date) : "—"}</td>
                <td className="num">{fmtMoney(r.goods_value)}</td>
                <td className="num">{r.freight > 0 ? fmtMoney(r.freight) : "—"}</td>
                <td className="num">{r.returned_value > 0 ? fmtMoney(r.returned_value) : "—"}</td>
                <td className="text-right"><button className="btn-ghost btn-sm" onClick={() => open(r)}>{r.bill_no ? t("Edit") : t("Key bill")}</button></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={10} className="muted text-sm" style={{ padding: 20 }}>{t("No goods receipts.")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={t("Supplier bill")}
        subtitle={edit ? `${edit.grn_no} · ${sname(edit)}` : undefined}
        footer={<>
          <button className="btn-ghost" onClick={() => setEdit(null)}>{t("Cancel")}</button>
          <button className="btn" onClick={save} disabled={busy}>{busy ? "…" : t("Save")}</button>
        </>}>
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-3">
          <div className="field"><label>{t("Supplier bill no.")} *</label>
            <input className="inp" autoFocus value={f.billNo} onChange={(e) => setF({ ...f, billNo: e.target.value })} />
            <div className="h-4 leading-4 text-[11px]" style={{ color: "#b91c1c" }}>{err}</div></div>
          <div className="field"><label>{t("Bill date")}</label>
            <input className="inp" type="date" max={today()} value={f.billDate} onChange={(e) => setF({ ...f, billDate: e.target.value })} /></div>
          <div className="field"><label>{t("Due date")}</label>
            <input className="inp" type="date" min={f.billDate || undefined} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
            <div className="h-4 leading-4 text-[11px] muted">{t("Blank = bill date + supplier credit days")}</div></div>
          <p className="text-[12px] muted">{t("Amounts are already posted and can't change here. Use a purchase return for goods sent back.")}</p>
          <button type="submit" hidden />
        </form>
      </Drawer>
    </div>
  );
}
