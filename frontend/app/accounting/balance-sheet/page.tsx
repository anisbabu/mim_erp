"use client";
import { useEffect, useState } from "react";
import { endpoints, type BalanceSheet } from "@/lib/api";

function Section({ title, rows, extra }: { title: string; rows: { code: string; name: string; amount: number }[]; extra?: { name: string; amount: number } }) {
  return (
    <div className="border border-line rounded-xl bg-white overflow-hidden mb-4">
      <div className="px-4 py-2 text-sm font-medium border-b border-line">{title}</div>
      <table className="tbl">
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}><td className="font-mono text-[13px] w-20">{r.code}</td><td>{r.name}</td>
              <td className="text-right tabular-nums">{Number(r.amount).toFixed(2)}</td></tr>
          ))}
          {extra && <tr><td></td><td>{extra.name}</td><td className="text-right tabular-nums">{extra.amount.toFixed(2)}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default function BalanceSheetPage() {
  const [bs, setBs] = useState<BalanceSheet | null>(null);
  useEffect(() => { endpoints.balanceSheet().then(setBs).catch(() => {}); }, []);
  if (!bs) return <div><h1 className="text-2xl font-medium mb-6">Balance sheet</h1><p className="text-[#6b6960]">Loading…</p></div>;
  return (
    <div>
      <h1 className="text-2xl font-medium mb-6">Balance sheet</h1>
      <Section title="Assets" rows={bs.assets} />
      <div className="text-right text-sm font-medium mb-5 pr-2">
        Total assets <span className="tabular-nums ml-3">{Number(bs.totalAssets).toFixed(2)}</span>
      </div>
      <Section title="Liabilities" rows={bs.liabilities} />
      <Section title="Equity" rows={bs.equity} extra={{ name: "Retained earnings (net profit)", amount: Number(bs.retainedEarnings) }} />
      <div className="text-right text-sm font-medium mb-3 pr-2">
        Total liabilities + equity <span className="tabular-nums ml-3">{Number(bs.totalLiabilitiesAndEquity).toFixed(2)}</span>
      </div>
      <div className="rounded-lg px-4 py-2 text-sm"
        style={{ background: bs.balanced ? "#e6efe9" : "#fbeceb", color: bs.balanced ? "#1d5e4f" : "#9a2b22" }}>
        {bs.balanced ? "Assets = Liabilities + Equity. The sheet balances." : "Sheet does not balance — review postings."}
      </div>
    </div>
  );
}
