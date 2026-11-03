"use client";

import { useEffect, useState } from "react";
import { endpoints, fmtDate, type EquityStatement, type Statement } from "@/lib/api";
import { downloadCsv, fmtMoney } from "@/lib/fmt";
import { useI18n } from "@/lib/i18n";
import { ClosedBanner, ReportTitle, Toolbar, YearSelect, useYears } from "./ReportKit";

export type StatementKind = "financial-position" | "profit-or-loss" | "changes-in-equity" | "cash-flows";

const NAMES: Record<StatementKind, string> = {
  "financial-position": "Statement of financial position",
  "profit-or-loss": "Statement of profit or loss",
  "changes-in-equity": "Statement of changes in equity",
  "cash-flows": "Statement of cash flows",
};

const ACCOUNTING_POLICIES = [
  "Basis of preparation: these statements are prepared on the accrual basis in accordance with IFRS presentation requirements (IAS 1) and a double-entry ledger.",
  "Inventories are measured at cost on a first-in, first-out (FIFO) basis (IAS 2).",
  "Property, plant and equipment is carried at cost less accumulated depreciation; depreciation is straight-line over the useful life (IAS 16).",
  "The cash flow statement uses the indirect method (IAS 7). Cash and cash equivalents are cash in hand, petty cash and bank balances.",
  "Amounts are stated in Bangladeshi Taka (BDT). Figures in brackets are deductions or negative balances.",
];

export default function Statements({ kind }: { kind: StatementKind }) {
  const { t, lang } = useI18n();
  const { years, yearId, setYearId, year } = useYears();
  const [stmt, setStmt] = useState<Statement | null>(null);
  const [eq, setEq] = useState<EquityStatement | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!yearId) return;
    setErr(""); setStmt(null); setEq(null);
    if (kind === "changes-in-equity") endpoints.equityStatement(yearId).then(setEq).catch((e) => setErr(e.message));
    else endpoints.statement(kind, yearId).then(setStmt).catch((e) => setErr(e.message));
  }, [kind, yearId]);

  const pick = (en?: string, bn?: string) => (lang === "bn" && bn ? bn : en ?? "");
  const isPosition = kind === "financial-position";
  const dateLine = (to: string, from: string) =>
    isPosition ? `${t("As at")} ${fmtDate(to)}` : `${t("For the year ended")} ${fmtDate(to)}  (${fmtDate(from)} – ${fmtDate(to)})`;

  function exportCsv() {
    if (stmt) {
      const cmp = stmt.priorYearName !== null;
      downloadCsv(`${kind}-${stmt.yearName}.csv`, [
        [t(NAMES[kind]), stmt.yearName, cmp ? stmt.priorYearName : ""],
        ...stmt.rows.filter((r) => r.kind !== "gap").map((r) =>
          [pick(r.label, r.labelBn), r.amount ?? "", cmp ? r.prior ?? "" : ""]),
      ]);
    } else if (eq) {
      downloadCsv(`${kind}-${eq.yearName}.csv`, [
        ["", ...eq.columns], ...eq.rows.map((r) => [pick(r.label, r.labelBn), ...r.values]),
      ]);
    }
  }

  return (
    <div>
      <Toolbar onExport={exportCsv}>
        <YearSelect years={years} value={yearId} onChange={setYearId} />
      </Toolbar>
      <ClosedBanner status={(stmt?.yearStatus ?? eq?.yearStatus) as string | undefined} />
      {err && <div className="note note-err mb-3">{err}</div>}

      <div className="report-sheet">
        {!stmt && !eq && !err && <p className="muted text-sm">{t("Loading…")}</p>}

        {stmt && (
          <>
            <ReportTitle name={t(NAMES[kind])} period={dateLine(stmt.to, stmt.from)} sub={t("Amounts in BDT")} />
            <div className="table-wrap">
              <table className="stmt">
                <thead>
                  <tr>
                    <th>{t("Particulars")}</th>
                    <th className="ref">{t("Note")}</th>
                    <th className="n">{stmt.yearName}</th>
                    {stmt.priorYearName && <th className="n">{stmt.priorYearName}</th>}
                  </tr>
                </thead>
                <tbody>
                  {stmt.rows.map((r, i) => {
                    if (r.kind === "gap") return <tr key={i} className="g"><td colSpan={4} /></tr>;
                    const cls = r.kind === "heading" ? "h" : r.kind === "subtotal" ? "s" : r.kind === "total" ? "t" : "l";
                    return (
                      <tr key={i} className={cls}>
                        <td>{pick(r.label, r.labelBn)}</td>
                        <td className="ref">{r.note ?? ""}</td>
                        <td className="n">{r.kind === "heading" ? "" : fmtMoney(r.amount)}</td>
                        {stmt.priorYearName && <td className="n">{r.kind === "heading" ? "" : fmtMoney(r.prior)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {isPosition && (
              <p className="text-[13px] mt-3 no-print" style={{ color: stmt.balanced ? "#166534" : "#991b1b" }}>
                {stmt.balanced ? t("Assets = Equity + Liabilities. The statement balances.")
                  : `${t("Statement does not balance. Difference:")} ${fmtMoney(stmt.difference, "0.00")}`}
              </p>
            )}
            {kind === "cash-flows" && (
              <p className="text-[13px] mt-3 no-print" style={{ color: stmt.reconciles ? "#166534" : "#991b1b" }}>
                {stmt.reconciles ? t("Agrees to the movement in cash and bank ledgers.")
                  : `${t("Does not agree to the cash and bank ledgers. Difference:")} ${fmtMoney(stmt.difference, "0.00")}`}
              </p>
            )}

            {stmt.notes.length > 0 && (
              <div className="mt-8">
                <div className="font-bold text-[13px] mb-2">{t("Notes to the financial statements")}</div>
                {stmt.notes.map((n) => (
                  <div key={n.no} className="mb-4" style={{ breakInside: "avoid" }}>
                    <div className="text-[13px] font-semibold mb-1">{n.no}. {pick(n.title, n.titleBn)}</div>
                    <table className="stmt">
                      <tbody>
                        {n.accounts.map((a, i) => (
                          <tr key={i} className="l">
                            <td>{a.code && <span className="font-mono text-[12px] muted mr-2">{a.code}</span>}{pick(a.name, a.nameBn)}</td>
                            <td className="n">{fmtMoney(a.amount)}</td>
                            {stmt.priorYearName && <td className="n">{fmtMoney(a.prior)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 text-[12px] muted">
              <div className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("Significant accounting policies")}</div>
              <ol className="list-decimal pl-5 space-y-0.5">
                {ACCOUNTING_POLICIES.map((p) => <li key={p}>{t(p)}</li>)}
              </ol>
            </div>
          </>
        )}

        {eq && (
          <>
            <ReportTitle name={t(NAMES[kind])} period={dateLine(eq.to, eq.from)} sub={t("Amounts in BDT")} />
            <div className="table-wrap">
              <table className="stmt">
                <thead>
                  <tr>
                    <th>{t("Particulars")}</th>
                    {(lang === "bn" ? eq.columnsBn : eq.columns).map((c) => <th key={c} className="n">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {eq.rows.map((r, i) => (
                    <tr key={i} className={r.kind === "total" ? "t" : "l"}>
                      <td>{pick(r.label, r.labelBn)}</td>
                      {r.values.map((v, j) => <td key={j} className="n">{fmtMoney(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
