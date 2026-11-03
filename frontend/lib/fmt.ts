// Number and date formatting shared by every accounting screen.

const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Accounting format: lakh/crore grouping, two decimals, negatives in brackets, zero as an en dash.
 * @param zero what to show for exactly zero ("–" by default; pass "0.00" where a zero must be visible)
 */
export function fmtMoney(n: number | string | null | undefined, zero = "–"): string {
  if (n === null || n === undefined || n === "") return "";
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  if (Math.abs(v) < 0.005) return zero;
  const s = money.format(Math.abs(v));
  return v < 0 ? `(${s})` : s;
}

/** Signed balance with Dr / Cr suffix (debit-positive input), e.g. "1,250.00 Dr". */
export function fmtDrCr(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || Math.abs(v) < 0.005) return "–";
  return `${money.format(Math.abs(v))} ${v > 0 ? "Dr" : "Cr"}`;
}

/** Download a CSV (opens correctly in Excel, including Bangla text). */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (c: string | number | null | undefined) => {
    const s = c === null || c === undefined ? "" : String(c);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export const today = () => new Date().toISOString().slice(0, 10);
