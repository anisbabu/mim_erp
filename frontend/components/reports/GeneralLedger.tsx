"use client";

import { useEffect, useMemo, useState } from "react";
import { endpoints, fmtDate, type GeneralLedger, type LedgerRow } from "@/lib/api";
import { fmtDrCr, fmtMoney, today } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import SearchSelect, { type Option } from "@/components/SearchSelect";
import { ReportTitle, Toolbar, readSaved, savePdf, useSaved } from "./ReportKit";

export default function GeneralLedgerReport() {
  const { t, lang } = useI18n();
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [accountId, setAccountId] = useSaved("ledger", "");
  const [from, setFrom, setFromDefault] = useSaved("from", "");
  const [to, setTo] = useSaved("to", today());
  const [gl, setGl] = useState<GeneralLedger | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    endpoints.coaLedgers().then(setLedgers).catch(() => {});
    if (readSaved("from") !== null) return;
    endpoints.currentYear().then((y) => setFromDefault(y.startDate)).catch(() => setFromDefault(today().slice(0, 4) + "-01-01"));
  }, [setFromDefault]);

  const opts: Option[] = useMemo(
    () => ledgers.map((l) => ({ value: l.id, label: `${l.code} · ${lang === "bn" && l.name_bn ? l.name_bn : l.name}`, sublabel: l.type })),
    [ledgers, lang]);

  useEffect(() => {
    if (!accountId || !from || !to) return;
    setErr(""); setGl(null);
    endpoints.generalLedger(accountId, from, to).then(setGl).catch((e) => setErr(e.message));
  }, [accountId, from, to]);

  const name = gl ? (lang === "bn" && gl.account.name_bn ? gl.account.name_bn : gl.account.name) : "";

  return (
    <div>
      <Toolbar onPdf={gl ? () => savePdf(() => endpoints.reportPdfQuery("reports/ledger", `accountId=${accountId}&from=${from}&to=${to}`, lang), `general-ledger-${gl.account.code}${lang === "bn" ? "-bn" : ""}.pdf`, setErr) : undefined}>
        <div className="field" style={{ minWidth: 300 }}><label>{t("Ledger")}</label>
          <SearchSelect options={opts} value={accountId} onChange={setAccountId} placeholder={t("Search…")} /></div>
        <div className="field"><label>{t("From")}</label>
          <input className="inp" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>{t("To")}</label>
          <input className="inp" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {err && <div className="note note-err mb-3">{err}</div>}
      {!accountId && <p className="muted text-sm">{t("Pick a ledger to see its account statement.")}</p>}

      {gl && (
        <div className="report-sheet">
          <ReportTitle name={`${t("General ledger")}: ${gl.account.code} · ${name}`}
            period={`${fmtDate(gl.from)} – ${fmtDate(gl.to)}`} sub={t("Amounts in BDT")} />
          <div className="table-wrap">
            <table className="rpt" style={{ minWidth: 760 }}>
              <colgroup><col style={{ width: 94 }} /><col style={{ width: 130 }} /><col />
                <col style={{ width: 112 }} /><col style={{ width: 112 }} /><col style={{ width: 130 }} /></colgroup>
              <thead><tr>
                <th className="l">{t("Date")}</th><th className="l">{t("Voucher")}</th><th className="l">{t("Narration")}</th>
                <th className="n">{t("Debit")}</th><th className="n">{t("Credit")}</th><th className="n">{t("Balance")}</th>
              </tr></thead>
              <tbody>
                <tr className="grp">
                  <td colSpan={5} className="l">{t("Opening balance")}</td>
                  <td className="n">{fmtDrCr(gl.openingBalance)}</td>
                </tr>
                {gl.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="l">{fmtDate(r.date)}</td>
                    <td className="l font-mono text-[12px]">{r.entryNo}</td>
                    <td className="l" title={r.narration}>{r.narration}</td>
                    <td className="n">{fmtMoney(r.debit)}</td><td className="n">{fmtMoney(r.credit)}</td>
                    <td className="n">{fmtDrCr(r.balance)}</td>
                  </tr>
                ))}
                {gl.rows.length === 0 && <tr><td colSpan={6} className="l muted">{t("No transactions in this period.")}</td></tr>}
              </tbody>
              <tfoot><tr>
                <td colSpan={3} className="l">{t("Total / closing balance")}</td>
                <td className="n">{fmtMoney(gl.totalDebit)}</td><td className="n">{fmtMoney(gl.totalCredit)}</td>
                <td className="n">{fmtDrCr(gl.closingBalance)}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
