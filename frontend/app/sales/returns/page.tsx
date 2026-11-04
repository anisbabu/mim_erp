"use client";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { savePdf } from "@/components/reports/ReportKit";
import {
  endpoints, fmtDate, type Customer, type Returnable, type SalesOrder, type SalesReturnRow,
} from "@/lib/api";

const money = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DELIVERED = ["DELIVERED", "PARTIALLY_DELIVERED", "INVOICED"];

export default function SalesReturnsPage() {
  const { t, dn, lang } = useI18n();
  const [rows, setRows] = useState<SalesReturnRow[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const [soId, setSoId] = useState("");
  const [data, setData] = useState<Returnable | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [settlement, setSettlement] = useState<"CREDIT_NOTE" | "CASH_REFUND">("CREDIT_NOTE");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = () => endpoints.salesReturns().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    loadList();
    endpoints.salesOrders().then(setOrders).catch(() => {});
    endpoints.customers().then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x])))).catch(() => {});
  }, []);

  const orderOpts: Option[] = useMemo(
    () => orders.filter((o) => DELIVERED.includes(o.status)).map((o) => ({
      value: o.id, label: `${o.soNo} · ${customers[o.customerId] ? dn(customers[o.customerId]) : ""}`,
      sublabel: fmtDate(o.orderDate),
    })), [orders, customers, dn]);

  useEffect(() => {
    setData(null); setQty({}); setMsg(null);
    if (!soId) return;
    endpoints.returnable(soId).then((r) => {
      setData(r);
      setSettlement(r.order.payment_mode === "CASH" ? "CASH_REFUND" : "CREDIT_NOTE");
    }).catch((e) => setMsg({ kind: "err", text: e.message }));
  }, [soId]);

  const total = (data?.lines ?? []).reduce((s, l) => s + (Number(qty[l.dc_line_id]) || 0) * l.net_unit_price, 0);
  const cash = data?.order.payment_mode === "CASH";

  async function submit() {
    if (!data) return;
    setMsg(null);
    const lines = data.lines.filter((l) => Number(qty[l.dc_line_id]) > 0)
      .map((l) => ({ dcLineId: l.dc_line_id, qty: Number(qty[l.dc_line_id]) }));
    if (lines.length === 0) { setMsg({ kind: "err", text: t("Enter a return quantity for at least one line.") }); return; }
    if (!reason.trim()) { setMsg({ kind: "err", text: t("Give the reason for the return.") }); return; }
    setBusy(true);
    try {
      const r = await endpoints.createSalesReturn({ soId, reason: reason.trim(), settlement, lines });
      setMsg({ kind: "ok", id: r.id, text: `${r.creditNoteNo ?? r.returnNo} ${t("recorded.")}` });
      setReason(""); setQty({});
      endpoints.returnable(soId).then(setData).catch(() => {});
      loadList();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => [r.return_no, r.credit_note_no, r.so_no, r.customer_code, r.customer_name, r.reason]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(s)));
  }, [rows, q]);

  const pdf = (id: string, no: string) =>
    savePdf(() => endpoints.creditNotePdf(id, lang), `${no}${lang === "bn" ? "-bn" : ""}.pdf`, (m) => setMsg({ kind: "err", text: m }));
  const pname = (l: { product_name: string; product_name_bn?: string }) => (lang === "bn" && l.product_name_bn ? l.product_name_bn : l.product_name);

  return (
    <div>
      <PageHeader crumbs={["Sales", "Transactions"]} title={t("Sales returns & credit notes")}
        subtitle={t("Take goods back from a delivered order. Stock returns to its original cost layer and the sale is reversed.")}
        actions={<button className="btn" onClick={() => setOpen((v) => !v)}>{open ? t("Close") : t("New return")}</button>} />

      {open && (
        <div className="card p-5 mb-6">
          <div className="section-label mb-3">{t("New return")}</div>
          <div className="form-grid cols-4">
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>{t("Sales order")} *</label>
              <SearchSelect options={orderOpts} value={soId} onChange={setSoId} placeholder={t("Select…")} />
            </div>
            {data && (
              <div className="field" style={{ gridColumn: "span 2" }}>
                <label>{t("Customer")}</label>
                <div className="inp" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {lang === "bn" && data.order.customer_name_bn ? data.order.customer_name_bn : data.order.customer_name}
                  <span className="chip bg-slate-100 text-slate-500">{data.order.customer_code}</span>
                  <span className="chip bg-slate-100 text-slate-600">{cash ? t("Cash sale") : t("Credit sale")}</span>
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
                    <th style={{ textAlign: "left" }}>{t("Challan")}</th>
                    <th style={{ textAlign: "right" }}>{t("Delivered")}</th>
                    <th style={{ textAlign: "right" }}>{t("Returned")}</th>
                    <th style={{ textAlign: "right" }}>{t("Available")}</th>
                    <th style={{ textAlign: "right" }}>{t("Unit price")}</th>
                    <th style={{ textAlign: "right", width: 120 }}>{t("Return qty")}</th>
                    <th style={{ textAlign: "right" }}>{t("Amount")}</th>
                  </tr></thead>
                  <tbody>
                    {data.lines.map((l) => {
                      const v = Number(qty[l.dc_line_id]) || 0;
                      const bad = v > l.qty_available || v < 0;
                      return (
                        <tr key={l.dc_line_id}>
                          <td>{pname(l)}</td>
                          <td className="font-mono text-[13px]">{l.dc_no}</td>
                          <td className="num">{l.qty_delivered}</td>
                          <td className="num">{l.qty_returned}</td>
                          <td className="num">{l.qty_available}</td>
                          <td className="num">{money(l.net_unit_price)}</td>
                          <td><input className="inp num" type="number" min={0} max={l.qty_available}
                            disabled={l.qty_available <= 0} value={qty[l.dc_line_id] ?? ""}
                            style={bad ? { borderColor: "#b91c1c" } : undefined}
                            onChange={(e) => setQty({ ...qty, [l.dc_line_id]: e.target.value })} /></td>
                          <td className="num">{money(v * l.net_unit_price)}</td>
                        </tr>
                      );
                    })}
                    {data.lines.length === 0 && (
                      <tr><td colSpan={8} className="muted text-sm" style={{ padding: 20 }}>{t("Nothing delivered on this order yet.")}</td></tr>
                    )}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={7} className="text-right font-medium">{t("Total to credit")}</td>
                    <td className="num font-semibold">{money(total)}</td>
                  </tr></tfoot>
                </table>
              </div>

              <div className="form-grid cols-4 mt-4">
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>{t("Reason for return")} *</label>
                  <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
                <div className="field" style={{ gridColumn: "span 2" }}>
                  <label>{t("Settle by")}</label>
                  <select className="inp" value={settlement} disabled={!cash}
                    onChange={(e) => setSettlement(e.target.value as "CREDIT_NOTE" | "CASH_REFUND")}>
                    <option value="CREDIT_NOTE">{t("Credit note (reduces customer balance)")}</option>
                    {cash && <option value="CASH_REFUND">{t("Cash refund")}</option>}
                  </select>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button className="btn" onClick={submit} disabled={busy}>{busy ? t("Recording…") : t("Record return")}</button>
                <span className="text-[12px] muted">
                  {settlement === "CREDIT_NOTE"
                    ? t("Dr Sales · Cr Customer ledger; Dr Inventory · Cr Cost of sales")
                    : t("Dr Sales · Cr Cash; Dr Inventory · Cr Cost of sales")}
                </span>
              </div>
            </>
          )}
          {msg && (
            <div className={`note mt-4 ${msg.kind === "ok" ? "note-ok" : "note-err"}`}>
              {msg.text}
              {msg.id && <button className="btn-ghost btn-sm ml-3" onClick={() => pdf(msg.id!, "credit-note")}>{t("Download PDF")}</button>}
            </div>
          )}
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
            <th style={{ textAlign: "left" }}>{t("Credit note")}</th>
            <th style={{ textAlign: "left" }}>{t("Date")}</th>
            <th style={{ textAlign: "left" }}>{t("Customer")}</th>
            <th style={{ textAlign: "left" }}>{t("Order")}</th>
            <th style={{ textAlign: "left" }}>{t("Reason")}</th>
            <th style={{ textAlign: "right" }}>{t("Amount")}</th>
            <th />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[13px]">{r.return_no}</td>
                <td className="font-mono text-[13px]">
                  {r.credit_note_no ?? <span className="chip bg-slate-100 text-slate-600">{t("Cash refund")}</span>}
                </td>
                <td>{fmtDate(r.return_date)}</td>
                <td>{lang === "bn" && r.customer_name_bn ? r.customer_name_bn : r.customer_name}
                  <span className="chip ml-2 bg-slate-100 text-slate-500">{r.customer_code}</span></td>
                <td className="font-mono text-[13px]">{r.so_no}</td>
                <td className="muted">{r.reason}</td>
                <td className="num font-medium">{money(r.goods_value)}</td>
                <td><button className="btn-ghost btn-sm" onClick={() => pdf(r.id, r.credit_note_no ?? r.return_no)}>{t("PDF")}</button></td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={8} className="muted text-sm" style={{ padding: 20 }}>{t("No returns yet.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
