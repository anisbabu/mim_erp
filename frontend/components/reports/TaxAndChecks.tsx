"use client";

import { useEffect, useState } from "react";
import { endpoints, fmtDate, type ChecksReport, type TaxSummary } from "@/lib/api";
import { fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import { ReportTitle, StatusChip, Toolbar, readSaved, savePdf, useSaved } from "./ReportKit";

export function TaxReport() {
  const { t, lang } = useI18n();
  const [from, setFrom, setFromDefault] = useSaved("from", "");
  const [to, setTo] = useSaved("to", today());
  const [tax, setTax] = useState<TaxSummary | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (readSaved("from") !== null) return;
    endpoints.currentYear().then((y) => setFromDefault(y.startDate)).catch(() => setFromDefault(today().slice(0, 4) + "-01-01"));
  }, [setFromDefault]);
  useEffect(() => {
    if (!from || !to) return;
    setTax(null); setErr("");
    endpoints.taxSummary(from, to).then(setTax).catch((e) => setErr(e.message));
  }, [from, to]);

  const rows: [string, number, boolean][] = tax ? [
    ["Output VAT collected (ledger 2100)", tax.outputVat, false],
    ["Less: input VAT paid on purchases (ledger 1450)", tax.inputVat, false],
    ["Less: VAT deducted at source by customers (ledger 1470)", tax.vdsCredit ?? 0, false],
    ["Net VAT payable / (refundable)", tax.netVatPayable, true],
    ["VAT deducted at source from suppliers, payable to NBR (ledger 2110)", tax.vdsWithheld ?? 0, false],
    ["AIT / TDS withheld from payees, payable to NBR (ledger 2120)", tax.aitWithheld, false],
    ["Advance income tax suffered on our sales (ledger 1460)", tax.aitPaid, false],
  ] : [];

  return (
    <div>
      <Toolbar onPdf={tax ? () => savePdf(() => endpoints.reportPdfQuery("reports/tax", `from=${from}&to=${to}`, lang), `vat-ait-${from}-${to}${lang === "bn" ? "-bn" : ""}.pdf`, setErr) : undefined}>
        <div className="field"><label>{t("From")}</label>
          <input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>{t("To")}</label>
          <input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {err && <div className="note note-err mb-3">{err}</div>}
      <div className="report-sheet">
        <ReportTitle name={t("VAT and AIT summary")} period={`${fmtDate(from)} – ${fmtDate(to)}`} sub={t("Amounts in BDT")} />
        {tax && (
          <table className="stmt">
            <thead><tr><th>{t("Particulars")}</th><th className="n">{t("Amount")}</th></tr></thead>
            <tbody>
              {rows.map(([label, v, strong]) => (
                <tr key={label} className={strong ? "t" : "l"}><td>{t(label)}</td><td className="n">{fmtMoney(v)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-[12px] muted mt-4">
          {t("These figures come from postings to the VAT and AIT ledgers. The sales module does not add VAT to invoices automatically - record VAT and AIT with a journal entry against these ledgers.")}
        </p>
      </div>
    </div>
  );
}

export function ChecksReport() {
  const { t, lang } = useI18n();
  const [rep, setRep] = useState<ChecksReport | null>(null);
  const [err, setErr] = useState("");
  const load = () => { setRep(null); setErr(""); endpoints.checks().then(setRep).catch((e) => setErr(e.message)); };
  useEffect(load, []);

  return (
    <div>
      <Toolbar onPdf={rep ? () => savePdf(() => endpoints.reportPdfQuery("reports/checks", "", lang), `control-checks${lang === "bn" ? "-bn" : ""}.pdf`, setErr) : undefined}>
        <button className="btn-ghost btn-sm" onClick={load}>{t("Run checks again")}</button>
      </Toolbar>
      {err && <div className="note note-err mb-3">{err}</div>}
      <div className="report-sheet">
        <ReportTitle name={t("Accounting control checks")} period={rep ? `${t("As at")} ${fmtDate(rep.asOf)}` : ""} />
        {!rep && !err && <p className="muted text-sm">{t("Loading…")}</p>}
        {rep && (
          <>
            <div className={`note mb-4 ${rep.ok ? "note-ok" : "note-err"}`}>
              {rep.ok ? t("All integrity checks passed.") : t("Some checks failed - review the items marked FAIL.")}
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
              {rep.checks.map((c) => (
                <div key={c.code} className="py-3 flex gap-3 items-start">
                  <div style={{ width: 52 }}><StatusChip status={c.status} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold">{t(c.title)}</div>
                    <div className="text-[12px] muted">{c.detail}</div>
                    {Object.keys(c.figures).length > 0 && (
                      <div className="text-[12px] mt-1 flex flex-wrap gap-x-5 gap-y-0.5">
                        {Object.entries(c.figures).map(([k, v]) => (
                          <span key={k}><span className="muted">{k}: </span><span className="tabular-nums">{typeof v === "number" ? fmtMoney(v, "0.00") : String(v)}</span></span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
