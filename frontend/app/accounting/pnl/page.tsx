"use client";
import { useEffect, useState } from "react";
import { endpoints, type PnL } from "@/lib/api";

function Section({ title, rows, total }: { title: string; rows: { code: string; name: string; amount: number }[]; total: number }) {
  return (
    <div className="border border-line rounded-xl bg-white overflow-hidden mb-4">
      <div className="px-4 py-2 text-sm font-medium border-b border-line">{title}</div>
      <table className="tbl">
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}><td className="font-mono text-[13px] w-20">{r.code}</td><td>{r.name}</td>
              <td className="text-right tabular-nums">{Number(r.amount).toFixed(2)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2} className="text-right font-medium">Total {title.toLowerCase()}</td>
          <td className="text-right font-medium tabular-nums">{total.toFixed(2)}</td></tr></tfoot>
      </table>
    </div>
  );
}

export default function PnlPage() {
  const [pnl, setPnl] = useState<PnL | null>(null);
  useEffect(() => { endpoints.profitLoss().then(setPnl).catch(() => {}); }, []);
  if (!pnl) return <div><h1 className="text-2xl font-medium mb-6">Profit &amp; loss</h1><p className="text-[#6b6960]">Loading…</p></div>;
  const profit = pnl.netProfit;
  return (
    <div>
      <h1 className="text-2xl font-medium mb-6">Profit &amp; loss</h1>
      <Section title="Income" rows={pnl.income} total={pnl.totalIncome} />
      <Section title="Expenses" rows={pnl.expense} total={pnl.totalExpense} />
      <div className="rounded-xl px-4 py-3 text-sm font-medium flex justify-between"
        style={{ background: profit >= 0 ? "#e6efe9" : "#fbeceb", color: profit >= 0 ? "#1d5e4f" : "#9a2b22" }}>
        <span>{profit >= 0 ? "Net profit" : "Net loss"}</span>
        <span className="tabular-nums">{Math.abs(profit).toFixed(2)}</span>
      </div>
    </div>
  );
}
