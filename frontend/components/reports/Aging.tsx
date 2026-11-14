"use client";

import { useEffect, useState } from "react";
import { endpoints, fmtDate, type AgingReport } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import { ReportTitle, Toolbar, savePdf, useSaved } from "./ReportKit";

export default function Aging({ type }: { type: "CUSTOMER" | "SUPPLIER" }) {
  const { t, lang } = useI18n();
  const [asOf, setAsOf] = useSaved("asOf", today());
  const [rep, setRep] = useState<AgingReport | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!asOf) return;
    setRep(null); setErr("");
    endpoints.aging(type, asOf).then(setRep).catch((e) => setErr(e.message));
  }, [type, asOf]);

  const cust = type === "CUSTOMER";
  const title = cust ? t("Receivables aging") : t("Payables aging");
  const nm = (r: { name: string; nameBn?: string }) => (lang === "bn" && r.nameBn ? r.nameBn : r.name);

  return (
    <div>
      <Toolbar onPdf={rep ? () => savePdf(() => endpoints.reportPdfQuery("reports/aging", `type=${type}&asOf=${asOf}`, lang), `aging-${type.toLowerCase()}-${asOf}${lang === "bn" ? "-bn" : ""}.pdf`, setErr) : undefined}>
        <div className="field"><label>{t("As at")}</label>
          <input className="inp" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
      </Toolbar>
      {err && <div className="note note-err mb-3">{err}</div>}
      <div className="report-sheet">
        <ReportTitle name={title} period={`${t("As at")} ${fmtDate(asOf)}`} sub={t("Amounts in BDT. Aged bill-wise from each bill's due date; unapplied = advances not yet set against a bill.")} />
        {!rep && !err && <p className="muted text-sm">{t("Loading…")}</p>}
        {rep && (
          <div className="table-wrap">
            <table className="rpt" style={{ minWidth: 820 }}>
              <colgroup><col style={{ width: 110 }} /><col />
                {[0, 1, 2, 3, 4, 5].map((i) => <col key={i} style={{ width: 112 }} />)}</colgroup>
              <thead><tr>
                <th className="l">{t("Code")}</th><th className="l">{cust ? t("Customer") : t("Supplier")}</th>
                <th className="n">0–30 {t("days")}</th><th className="n">31–60</th><th className="n">61–90</th><th className="n">90+</th>
                <th className="n">{t("Advance")}</th><th className="n">{t("Outstanding")}</th>
              </tr></thead>
              <tbody>
                {rep.rows.map((r) => (
                  <tr key={r.accountId}>
                    <td className="l font-mono text-[12px]">{r.code}</td>
                    <td className="l" title={nm(r)}>{nm(r)}</td>
                    <td className="n">{fmtMoney(r.current)}</td><td className="n">{fmtMoney(r.d31_60)}</td>
                    <td className="n">{fmtMoney(r.d61_90)}</td>
                    <td className="n" style={r.over90 > 0 ? { color: "#b91c1c", fontWeight: 600 } : undefined}>{fmtMoney(r.over90)}</td>
                    <td className="n">{fmtMoney(r.unapplied)}</td><td className="n" style={{ fontWeight: 600 }}>{fmtMoney(r.total)}</td>
                  </tr>
                ))}
                {rep.rows.length === 0 && <tr><td colSpan={8} className="l muted">{t("Nothing outstanding.")}</td></tr>}
              </tbody>
              <tfoot><tr>
                <td colSpan={2} className="l">{t("Total")}</td>
                <td className="n">{fmtMoney(rep.totals.current)}</td><td className="n">{fmtMoney(rep.totals.d31_60)}</td>
                <td className="n">{fmtMoney(rep.totals.d61_90)}</td><td className="n">{fmtMoney(rep.totals.over90)}</td>
                <td className="n">{fmtMoney(rep.totals.unapplied)}</td><td className="n">{fmtMoney(rep.totals.total)}</td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
