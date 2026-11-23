"use client";
import type { PoProgress } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const TONE = {
  done: "bg-emerald-50 text-emerald-700",
  part: "bg-amber-50 text-amberwarn",
  none: "bg-slate-100 text-slate-600",
};

/** One status pill: received / billed / paid. */
export function StatusChip({ kind, value }: { kind: "receipt" | "delivery" | "bill" | "pay"; value: string }) {
  const { t } = useI18n();
  const label: Record<string, string> = kind === "receipt"
    ? { PENDING: "Not received", PARTIAL: "Part received", DONE: "Received" }
    : kind === "delivery"
    ? { PENDING: "Not delivered", PARTIAL: "Part delivered", DONE: "Delivered" }
    : kind === "bill"
    ? { NONE: "Not billed", PARTIAL: "Part billed", BILLED: "Billed" }
    : { UNPAID: "Unpaid", PARTIAL: "Part paid", PAID: "Paid", CANCELLED: "Cancelled" };
  const tone = ["DONE", "BILLED", "PAID"].includes(value) ? TONE.done : value === "PARTIAL" ? TONE.part : TONE.none;
  return <span className={`chip ${tone}`}>{t(label[value] ?? value)}</span>;
}

/** Receipt, bill and payment status of a PO side by side. */
export default function PoProgressChips({ p }: { p?: PoProgress }) {
  if (!p) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      <StatusChip kind="receipt" value={p.receiptStatus} />
      <StatusChip kind="bill" value={p.billStatus} />
      {p.billed > 0 && <StatusChip kind="pay" value={p.payStatus} />}
    </span>
  );
}
