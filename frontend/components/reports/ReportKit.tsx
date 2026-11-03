"use client";

import { useEffect, useState, type ReactNode } from "react";
import { endpoints, fmtDate, type FinancialYear } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

/** Financial years for a report's year selector (defaults to the current year). */
export function useYears() {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [yearId, setYearId] = useState<string>("");
  useEffect(() => {
    endpoints.financialYears().then((ys) => {
      setYears(ys);
      const cur = ys.find((y) => y.current) ?? ys[0];
      if (cur) setYearId(cur.id);
    }).catch(() => {});
  }, []);
  return { years, yearId, setYearId, year: years.find((y) => y.id === yearId) };
}

/** Fetch a PDF blob and save it as a file. */
export async function savePdf(getBlob: () => Promise<Blob>, filename: string, onError: (m: string) => void) {
  try {
    const url = URL.createObjectURL(await getBlob());
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (e: any) { onError(e.message); }
}

export function YearSelect({ years, value, onChange }: {
  years: FinancialYear[]; value: string; onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="field" style={{ minWidth: 190 }}>
      <label>{t("Financial year")}</label>
      <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        {years.map((y) => (
          <option key={y.id} value={y.id}>{y.name}{y.status === "CLOSED" ? ` (${t("Closed")})` : ""}</option>
        ))}
      </select>
    </div>
  );
}

/** Filter bar above a report: controls on the left, Print / Export on the right. */
export function Toolbar({ children, onExport, onPdf }: { children: ReactNode; onExport?: () => void; onPdf?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="no-print flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="flex flex-wrap items-end gap-3">{children}</div>
      <div className="flex gap-2">
        {onPdf && <button className="btn btn-sm" onClick={onPdf}>{t("Download PDF")}</button>}
        {onExport && <button className="btn-ghost btn-sm" onClick={onExport}>{t("Export CSV")}</button>}
        <button className="btn-ghost btn-sm" onClick={() => window.print()}>{t("Print")}</button>
      </div>
    </div>
  );
}

/** Centered heading block: company, report name and period - printed with the report. */
export function ReportTitle({ name, period, sub }: { name: string; period: string; sub?: string }) {
  const { t } = useI18n();
  return (
    <div className="report-title">
      <div className="co">{t("MIM Enterprise")}</div>
      <div className="nm">{name}</div>
      <div className="pd">{period}</div>
      {sub && <div className="pd">{sub}</div>}
    </div>
  );
}

export const periodText = (from: string, to: string, t: (k: string) => string) =>
  `${t("For the period")} ${fmtDate(from)} ${t("to")} ${fmtDate(to)}`;

export function StatusChip({ status }: { status: "OK" | "FAIL" | "INFO" }) {
  const cls = status === "OK" ? "status-ok" : status === "FAIL" ? "status-fail" : "status-info";
  return <span className={`status-chip ${cls}`}>{status}</span>;
}

export function ClosedBanner({ status }: { status?: string }) {
  const { t } = useI18n();
  if (status !== "CLOSED") return null;
  return <div className="note note-ok mb-3 no-print">{t("This financial year is closed. Figures are final.")}</div>;
}
