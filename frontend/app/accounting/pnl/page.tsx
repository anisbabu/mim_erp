"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { endpoints, type PnL } from "@/lib/api";

function Section({ title, totalLabel, rows, total }: { title: string; totalLabel: string; rows: { code: string; name: string; amount: number }[]; total: number }) {
  return (
    <div className="border border-line rounded-xl bg-white overflow-hidden mb-4">
      <div className="px-4 py-2 text-sm font-medium border-b border-line">{title}</div>
      <div className="table-wrap">
      <table className="tbl">
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}><td className="font-mono text-[13px] w-20">{r.code}</td><td>{r.name}</td>
              <td className="text-right tabular-nums">{Number(r.amount).toFixed(2)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2} className="text-right font-medium">{totalLabel}</td>
          <td className="text-right font-medium tabular-nums">{total.toFixed(2)}</td></tr></tfoot>
      </table>
      </div>
    </div>
  );
}

export default function PnlPage() {
  const { t } = useI18n();
  const [pnl, setPnl] = useState<PnL | null>(null);
  useEffect(() => { endpoints.profitLoss().then(setPnl).catch(() => {}); }, []);
  if (!pnl) return <div><h1 className="page-title mb-6">{t("Profit & loss")}</h1><p className="text-[#6b6960]">{t("Loading…")}</p></div>;
  const profit = pnl.netProfit;
  return (
    <div>
      <h1 className="page-title mb-6">{t("Profit & loss")}</h1>
      <Section title={t("Income")} totalLabel={t("Total income")} rows={pnl.income} total={pnl.totalIncome} />
      <Section title={t("Expenses")} totalLabel={t("Total expenses")} rows={pnl.expense} total={pnl.totalExpense} />
      <div className="rounded-xl px-4 py-3 text-sm font-medium flex justify-between"
        style={{ background: profit >= 0 ? "#e6efe9" : "#fbeceb", color: profit >= 0 ? "#1d5e4f" : "#9a2b22" }}>
        <span>{profit >= 0 ? t("Net profit") : t("Net loss")}</span>
        <span className="tabular-nums">{Math.abs(profit).toFixed(2)}</span>
      </div>
    </div>
  );
}
