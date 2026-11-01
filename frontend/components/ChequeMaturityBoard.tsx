"use client";
import { fmtDate, type Cheque, type ChequeStatus, type ChequeEventType } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// "overdue" or a local ISO date "yyyy-mm-dd"; null = no day filter
export type MaturityPick = string | null;

/** Cheques still waiting on the bank or the accountant. */
export const isOpenCheque = (c: Cheque) => c.status === "PENDING" || c.status === "HOLD" || c.status === "CASHED";

/** Local-time ISO date (toISOString would shift to UTC and lose a day in Dhaka). */
export function isoDay(offset = 0): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysUntil(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + "T00:00:00").getTime() - today.getTime()) / 86400000);
}

export const STATUS_CHIP: Record<ChequeStatus, string> = {
  PENDING: "chip-pending", HOLD: "chip-hold", CASHED: "chip-cashed", POSTED: "chip-posted", BOUNCED: "chip-bounced",
  CANCELLED: "chip-cancelled",
};
export const STATUS_LABEL: Record<ChequeStatus, string> = {
  PENDING: "Pending", HOLD: "On hold", CASHED: "Cashed", POSTED: "Posted", BOUNCED: "Bounced", CANCELLED: "Cancelled",
};
export const EVENT_CHIP: Record<ChequeEventType, string> = {
  RECEIVED: "chip-pending", DATE_CHANGED: "chip-soon", HOLD: "chip-hold", RESUMED: "chip-pending",
  CASHED: "chip-cashed", POSTED: "chip-posted", BOUNCED: "chip-bounced",
  EDITED: "chip-later", CANCELLED: "chip-cancelled",
};
export const EVENT_LABEL: Record<ChequeEventType, string> = {
  RECEIVED: "Received", DATE_CHANGED: "Maturity date changed", HOLD: "Requested not to submit",
  RESUMED: "Resumed", CASHED: "Cashed", POSTED: "Posted", BOUNCED: "Bounced",
  EDITED: "Edited", CANCELLED: "Cancelled",
};

/** Maturity urgency chip for an open cheque. */
export function urgency(days: number): { cls: string; label: string } {
  if (days < 0) return { cls: "chip-overdue", label: `Overdue ${-days}d` };
  if (days === 0) return { cls: "chip-today", label: "Today" };
  if (days === 1) return { cls: "chip-soon", label: "Tomorrow" };
  if (days <= 6) return { cls: "chip-soon", label: `${days} days` };
  return { cls: "chip-later", label: `${days} days` };
}

const tk = (n: number) => "৳" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Seven-day maturity strip: Overdue, Today, Tomorrow, +2 … +6, and a date picker
 * for any later day. Each tile shows count and total of open cheques due that day.
 */
export default function ChequeMaturityBoard({
  cheques, selected, onSelect,
}: {
  cheques: Cheque[];
  selected: MaturityPick;
  onSelect: (p: MaturityPick) => void;
}) {
  const { t } = useI18n();
  const open = cheques.filter(isOpenCheque);
  const today = isoDay(0);

  const sum = (rows: Cheque[]) => ({ n: rows.length, amt: rows.reduce((s, c) => s + Number(c.amount), 0) });
  const overdue = sum(open.filter((c) => c.maturityDate < today));
  const days = Array.from({ length: 7 }, (_, i) => {
    const iso = isoDay(i);
    const d = new Date(iso + "T00:00:00");
    const label = i === 0 ? t("Today") : i === 1 ? t("Tomorrow") : `${i} ${t("days")}`;
    return { iso, label, sub: `${WEEKDAY[d.getDay()]} ${fmtDate(iso).slice(0, 5)}`, i, ...sum(open.filter((c) => c.maturityDate === iso)) };
  });
  const pickedLater = selected && selected !== "overdue" && !days.some((d) => d.iso === selected) ? selected : "";
  const later = pickedLater ? sum(open.filter((c) => c.maturityDate === pickedLater)) : null;

  const toggle = (p: string) => onSelect(selected === p ? null : p);
  const tone = (i: number, n: number) => (n === 0 ? "" : i === 0 ? "mat-today" : i === 1 ? "mat-soon" : "mat-later");

  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))" }}>
      <button type="button" onClick={() => toggle("overdue")}
        className={`mat-tile ${overdue.n ? "mat-overdue" : ""} ${selected === "overdue" ? "is-active" : ""}`}>
        <div className="text-[11px] font-semibold uppercase tracking-wide">{t("Overdue")}</div>
        <div className="text-[11px] opacity-75 h-4 leading-4">{t("before today")}</div>
        <div className="text-lg font-semibold tabular-nums mt-1">{overdue.n}</div>
        <div className="text-[12px] tabular-nums opacity-80">{tk(overdue.amt)}</div>
      </button>

      {days.map((d) => (
        <button key={d.iso} type="button" onClick={() => toggle(d.iso)}
          className={`mat-tile ${tone(d.i, d.n)} ${selected === d.iso ? "is-active" : ""}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide">{d.label}</div>
          <div className="text-[11px] opacity-75 h-4 leading-4">{d.sub}</div>
          <div className="text-lg font-semibold tabular-nums mt-1">{d.n}</div>
          <div className="text-[12px] tabular-nums opacity-80">{tk(d.amt)}</div>
        </button>
      ))}

      <label className={`mat-tile ${later?.n ? "mat-later" : ""} ${pickedLater ? "is-active" : ""}`}>
        <div className="text-[11px] font-semibold uppercase tracking-wide">{t("Pick date")}</div>
        <input type="date" className="inp mt-1 !h-7 !py-0 !text-[12px]" min={today} value={pickedLater}
          onChange={(e) => onSelect(e.target.value || null)} />
        <div className="text-[12px] tabular-nums opacity-80 mt-1 h-4 leading-4">
          {later ? `${later.n} · ${tk(later.amt)}` : ""}
        </div>
      </label>
    </div>
  );
}
