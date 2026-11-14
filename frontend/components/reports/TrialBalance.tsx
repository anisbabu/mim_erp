"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, fmtDate, type TrialBalanceReport } from "@/lib/api";
import { fmtMoney } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import { ClosedBanner, ReportTitle, Toolbar, YearSelect, savePdf, useSaved, useYears } from "./ReportKit";

export default function TrialBalance() {
  const { t, lang } = useI18n();
  const { years, yearId, setYearId } = useYears();
  const [tb, setTb] = useState<TrialBalanceReport | null>(null);
  const [hideZeroS, setHideZeroS] = useSaved("tbHideZero", "1");
  const hideZero = hideZeroS === "1";
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!yearId) return;
    setTb(null); setErr("");
    endpoints.trialBalance(yearId).then(setTb).catch((e) => setErr(e.message));
  }, [yearId]);

  const rows = useMemo(() => (tb?.rows ?? []).filter((r) => !hideZero ||
    [r.opening_debit, r.opening_credit, r.period_debit, r.period_credit, r.closing_debit, r.closing_credit].some((v) => Number(v) !== 0)),
    [tb, hideZero]);
  const nm = (r: { name: string; name_bn?: string }) => (lang === "bn" && r.name_bn ? r.name_bn : r.name);

  const num = (v: number) => fmtMoney(v);
  return (
    <div>
      <Toolbar onPdf={() => savePdf(() => endpoints.reportPdf("trial-balance", yearId, lang), `trial-balance-${tb?.yearName ?? ""}${lang === "bn" ? "-bn" : ""}.pdf`, setErr)}>
        <YearSelect years={years} value={yearId} onChange={setYearId} />
        <label className="h-10 flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZeroS(e.target.checked ? "1" : "0")} />
          {t("Hide ledgers with no balance")}
        </label>
      </Toolbar>
      <ClosedBanner status={tb?.yearStatus} />
      {err && <div className="note note-err mb-3">{err}</div>}
      <div className="report-sheet">
        {tb && (
          <>
            <ReportTitle name={t("Trial balance")} period={`${t("For the year ended")} ${fmtDate(tb.to)}`} sub={t("Amounts in BDT")} />
            <div className="table-wrap">
              <table className="rpt" style={{ minWidth: 860 }}>
                <colgroup>
                  <col style={{ width: 86 }} /><col />
                  <col style={{ width: 108 }} /><col style={{ width: 108 }} />
                  <col style={{ width: 108 }} /><col style={{ width: 108 }} />
                  <col style={{ width: 108 }} /><col style={{ width: 108 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} className="l">{t("Code")}</th><th rowSpan={2} className="l">{t("Ledger")}</th>
                    <th colSpan={2} className="n" style={{ textAlign: "center" }}>{t("Opening")}</th>
                    <th colSpan={2} className="n" style={{ textAlign: "center" }}>{t("Movement")}</th>
                    <th colSpan={2} className="n" style={{ textAlign: "center" }}>{t("Closing")}</th>
                  </tr>
                  <tr>
                    {[0, 1, 2].map((i) => <><th key={`d${i}`} className="n">{t("Debit")}</th><th key={`c${i}`} className="n">{t("Credit")}</th></>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code}>
                      <td className="l font-mono text-[12px]">{r.code}</td>
                      <td className="l" title={nm(r)}>{nm(r)}</td>
                      <td className="n">{num(r.opening_debit)}</td><td className="n">{num(r.opening_credit)}</td>
                      <td className="n">{num(r.period_debit)}</td><td className="n">{num(r.period_credit)}</td>
                      <td className="n">{num(r.closing_debit)}</td><td className="n">{num(r.closing_credit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="l">{t("Total")}</td>
                    <td className="n">{num(tb.openingDebit)}</td><td className="n">{num(tb.openingCredit)}</td>
                    <td className="n">{num(tb.periodDebit)}</td><td className="n">{num(tb.periodCredit)}</td>
                    <td className="n">{num(tb.closingDebit)}</td><td className="n">{num(tb.closingCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[13px] mt-3 no-print" style={{ color: tb.balanced ? "#166534" : "#991b1b" }}>
              {tb.balanced ? t("Debits equal credits - the ledger balances.") : t("Out of balance - check postings.")}
            </p>
          </>
        )}
        {!tb && !err && <p className="muted text-sm">{t("Loading…")}</p>}
      </div>
    </div>
  );
}
