"use client";
import { useEffect, useState, useMemo } from "react";
import { endpoints, fmtDate, type SalesOrder, type Customer } from "@/lib/api";

const PAGE_SIZE = 20;

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    endpoints.salesOrders().then(setOrders).catch(() => {});
    endpoints.customers()
      .then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x]))))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const cust = customers[o.customerId];
      return (
        o.soNo.toLowerCase().includes(q) ||
        (cust?.name ?? "").toLowerCase().includes(q) ||
        (cust?.mobile ?? "").includes(q) ||
        o.orderDate.includes(q)
      );
    });
  }, [orders, customers, search]);

  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function downloadInvoice(soId: string, soNo: string) {
    setDownloading(soId);
    try {
      const blob = await endpoints.invoiceBlob(soId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${soNo}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="page-title">Sales orders</h1>
      </div>

      <input
        className="inp mb-4 max-w-sm"
        placeholder="Search SO no, customer, mobile, date…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="border border-line rounded-xl bg-surface overflow-hidden">
        <table className="tbl">
          <thead><tr><th>SO no</th><th>Customer</th><th>Workflow</th><th>Date</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr><td colSpan={6} className="text-[#6b6960]">
                {search ? "No matching orders." : "No sales orders yet."}
              </td></tr>
            )}
            {pageItems.map((o) => {
              const cust = customers[o.customerId];
              return (
                <tr key={o.id}>
                  <td className="font-mono text-[13px]">{o.soNo}</td>
                  <td>
                    <div>{cust?.name ?? "—"}</div>
                    {cust?.mobile && (
                      <div className="text-[12px] text-[#6b6960]">{cust.mobile}</div>
                    )}
                  </td>
                  <td className="text-xs">{o.workflow}</td>
                  <td>{fmtDate(o.orderDate)}</td>
                  <td>{o.status}</td>
                  <td className="text-right">
                    <button
                      className="text-brand text-sm disabled:opacity-40"
                      disabled={downloading === o.id}
                      onClick={() => downloadInvoice(o.id, o.soNo)}>
                      {downloading === o.id ? "…" : "Invoice ↓"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-[#6b6960]">
          <span>{filtered.length} orders · page {page} of {totalPages}</span>
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