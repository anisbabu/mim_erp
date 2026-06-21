"use client";
import { useEffect, useState, useMemo } from "react";
import { endpoints, fmtDate, type DeliveryChallan, type Customer } from "@/lib/api";

const PAGE_SIZE = 20;

export default function ChallanListPage() {
  const [challans, setChallans] = useState<DeliveryChallan[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    endpoints.allChallans().then(setChallans).catch(() => {});
    endpoints.customers()
      .then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x]))))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return challans;
    return challans.filter((dc) => {
      const cust = customers[dc.customerId];
      return (
        dc.dcNo.toLowerCase().includes(q) ||
        (cust?.name ?? "").toLowerCase().includes(q) ||
        (cust?.mobile ?? "").includes(q) ||
        dc.challanDate.includes(q)
      );
    });
  }, [challans, customers, search]);

  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <h1 className="page-title mb-4">Challans</h1>

      <input
        className="inp mb-4 max-w-sm"
        placeholder="Search DC no, customer, mobile, date…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="border border-line rounded-xl bg-surface overflow-hidden">
        <table className="tbl">
          <thead><tr><th>DC no</th><th>Customer</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr><td colSpan={4} className="text-[var(--muted)]">
                {search ? "No matching challans." : "No challans yet."}
              </td></tr>
            )}
            {pageItems.map((dc) => {
              const cust = customers[dc.customerId];
              return (
                <tr key={dc.id}>
                  <td className="font-mono text-[13px] text-brand">{dc.dcNo}</td>
                  <td>
                    <div>{cust?.name ?? "—"}</div>
                    {cust?.mobile && (
                      <div className="text-[12px] text-[var(--muted)]">{cust.mobile}</div>
                    )}
                  </td>
                  <td>{fmtDate(dc.challanDate)}</td>
                  <td>
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: dc.status === "ISSUED" ? "var(--chip-open-bg)" : "var(--chip-other-bg)",
                        color:      dc.status === "ISSUED" ? "var(--chip-open-fg)" : "var(--chip-other-fg)",
                      }}>
                      {dc.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-[var(--muted)]">
          <span>{filtered.length} challans · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button className="btn-ghost px-3 py-1"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}>← Prev</button>
            <button className="btn-ghost px-3 py-1"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}