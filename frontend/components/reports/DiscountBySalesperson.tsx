"use client";

import { useEffect, useState } from "react";
import { endpoints, fmtDate, type DiscountBySalesperson } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import { ReportTitle, Toolbar, readSaved, useSaved } from "./ReportKit";

/** Trade discount (Sales Discount 4010) given in a period, per salesperson, net of returns. */
export function DiscountBySalespersonReport() {
  const { t, lang } = useI18n();
  const [from, setFrom, setFromDefault] = useSaved("from", "");
  const [to, setTo] = useSaved("to", today());
  const [rep, setRep] = useState<DiscountBySalesperson | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (readSaved("from") !== null) return;
    endpoints.currentYear().then((y) => setFromDefault(y.startDate)).catch(() => setFromDefault(today().slice(0, 4) + "-01-01"));
  }, [setFromDefault]);
  useEffect(() => {
    if (!from || !to) return;
    setRep(null); setErr("");
    endpoints.discountBySalesperson(from, to).then(setRep).catch((e) => setErr(e.message));
  }, [from, to]);

  const who = (r: DiscountBySalesperson["rows"][number]) =>
    (lang === "bn" && r.full_name_bn ? r.full_name_bn : r.full_name || r.username) || t("Not recorded");

  return (
    <div>
      <Toolbar>
        <div className="field"><label>{t("From")}</label>
          <input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>{t("To")}</label>
          <input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {err && <div className="note note-err mb-3">{err}</div>}
      <div className="report-sheet">
        <ReportTitle name={t("Discount by salesperson")} period={`${fmtDate(from)} – ${fmtDate(to)}`} sub={t("Amounts in BDT")} />
        {rep && (
          <table className="stmt">
            <thead><tr>
              <th>{t("Salesperson")}</th><th className="n">{t("Orders / challans")}</th>
              <th className="n">{t("Discount")}</th><th className="n">{t("Share")}</th>
            </tr></thead>
            <tbody>
              {rep.rows.map((r) => (
                <tr key={r.user_id ?? "none"} className="l">
                  <td>{who(r)}</td><td className="n">{r.documents}</td>
                  <td className="n">{fmtMoney(r.discount)}</td>
                  <td className="n">{Number(rep.total) ? `${((Number(r.discount) / Number(rep.total)) * 100).toFixed(1)}%` : ""}</td>
                </tr>
              ))}
              {rep.rows.length === 0 && <tr><td colSpan={4} className="muted">{t("No discount given in this period.")}</td></tr>}
              <tr className="t"><td>{t("Total")}</td><td /><td className="n">{fmtMoney(rep.total)}</td><td /></tr>
            </tbody>
          </table>
        )}
        <p className="text-[12px] muted mt-4">{t("From postings to Sales Discount (4010); returns reduce the salesperson who made the sale.")}</p>
      </div>
    </div>
  );
}
