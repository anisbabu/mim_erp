"use client";
import { useEffect, useState } from "react";
import { endpoints, type TrialRow } from "@/lib/api";

export default function TrialBalancePage() {
  const [rows, setRows] = useState<TrialRow[]>([]);
  useEffect(() => { endpoints.trialBalance().then(setRows).catch(() => {}); }, []);
  const td = rows.reduce((s, r) => s + Number(r.total_debit), 0);
  const tc = rows.reduce((s, r) => s + Number(r.total_credit), 0);
  return (
    <div>
      <h1 className="page-title mb-6">Trial balance</h1>
      <div className="border border-line rounded-xl bg-white overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code}>
                <td className="font-mono text-[13px]">{r.code}</td>
                <td>{r.name}</td>
                <td className="text-xs text-[#6b6960]">{r.type}</td>
                <td className="text-right tabular-nums">{Number(r.total_debit).toFixed(2)}</td>
                <td className="text-right tabular-nums">{Number(r.total_credit).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr>
            <td colSpan={3} className="text-right font-medium">Totals</td>
            <td className="text-right font-medium tabular-nums">{td.toFixed(2)}</td>
            <td className="text-right font-medium tabular-nums">{tc.toFixed(2)}</td>
          </tr></tfoot>
        </table>
      </div>
      <p className="text-sm mt-3" style={{ color: Math.abs(td - tc) < 0.01 ? "#1d5e4f" : "#9a2b22" }}>
        {Math.abs(td - tc) < 0.01 ? "Debits equal credits — the ledger balances." : "Out of balance — check postings."}
      </p>
    </div>
  );
}
