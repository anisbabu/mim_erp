"use client";
import { useEffect, useState, useMemo } from "react";
import { endpoints, fmtDate, type SalesOrder, type Customer } from "@/lib/api";
import { beep } from "@/lib/beep";

const PAGE_SIZE = 20;

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

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

  type BusyKey = string; // soId + "inv" | soId + "dc"
  async function fetchBlob(fetcher: () => Promise<Blob>, key: BusyKey): Promise<{ blob: Blob; url: string } | null> {
    setBusy(key);
    try {
      const blob = await fetcher();
      const url = URL.createObjectURL(blob);
      beep();
      return { blob, url };
    } catch (e: any) {
      alert(e.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function openDoc(fetcher: () => Promise<Blob>, key: BusyKey) {
    const r = await fetchBlob(fetcher, key);
    if (!r) return;
    window.open(r.url, "_blank");
  }

  async function downloadDoc(fetcher: () => Promise<Blob>, key: BusyKey, filename: string) {
    const r = await fetchBlob(fetcher, key);
    if (!r) return;
    const a = document.createElement("a");
    a.href = r.url; a.download = filename; a.click();
    URL.revokeObjectURL(r.url);
  }

  async function shareDoc(fetcher: () => Promise<Blob>, key: BusyKey, filename: string, title: string) {
    const r = await fetchBlob(fetcher, key);
    if (!r) return;
    const file = new File([r.blob], filename, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title, text: title }); } catch { /* cancelled */ }
      URL.revokeObjectURL(r.url);
    } else {
      window.open(r.url, "_blank");
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
          <thead><tr><th>SO no</th><th>Customer</th><th>Workflow</th><th>Date</th><th>Status</th><th>Dispatch token</th><th>Challan</th><th>Invoice</th></tr></thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr><td colSpan={8} className="text-[#6b6960]">
                {search ? "No matching orders." : "No sales orders yet."}
              </td></tr>
            )}
            {pageItems.map((o) => {
              const cust = customers[o.customerId];
              const wtKey  = o.id + "wt";
              const dcKey  = o.id + "dc";
              const invKey = o.id + "inv";
              const wtBusy  = busy === wtKey;
              const dcBusy  = busy === dcKey;
              const invBusy = busy === invKey;
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

                  {/* Dispatch token column */}
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-ghost btn-sm" disabled={wtBusy} title="Print dispatch token"
                        onClick={() => openDoc(() => endpoints.warehouseTokenBlob(o.id), wtKey)}>
                        {wtBusy ? "…" : "🖨"}
                      </button>
                      <button className="btn-ghost btn-sm" disabled={wtBusy} title="Download dispatch token"
                        onClick={() => downloadDoc(() => endpoints.warehouseTokenBlob(o.id), wtKey, `dispatch-${o.soNo}.pdf`)}>
                        ↓
                      </button>
                      <button className="btn btn-sm" disabled={wtBusy} title="Share dispatch token"
                        onClick={() => shareDoc(() => endpoints.warehouseTokenBlob(o.id), wtKey, `dispatch-${o.soNo}.pdf`, `Dispatch Token ${o.soNo}`)}>
                        ↗
                      </button>
                    </div>
                  </td>

                  {/* Challan column */}
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-ghost btn-sm" disabled={dcBusy} title="Print challan"
                        onClick={() => openDoc(() => endpoints.orderChallanBlob(o.id), dcKey)}>
                        {dcBusy ? "…" : "🖨"}
                      </button>
                      <button className="btn-ghost btn-sm" disabled={dcBusy} title="Download challan"
                        onClick={() => downloadDoc(() => endpoints.orderChallanBlob(o.id), dcKey, `challan-${o.soNo}.pdf`)}>
                        ↓
                      </button>
                      <button className="btn btn-sm" disabled={dcBusy} title="Share challan"
                        onClick={() => shareDoc(() => endpoints.orderChallanBlob(o.id), dcKey, `challan-${o.soNo}.pdf`, `Challan ${o.soNo}`)}>
                        ↗
                      </button>
                    </div>
                  </td>

                  {/* Invoice column */}
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button className="btn-ghost btn-sm" disabled={invBusy} title="Print invoice"
                        onClick={() => openDoc(() => endpoints.invoiceBlob(o.id), invKey)}>
                        {invBusy ? "…" : "🖨"}
                      </button>
                      <button className="btn-ghost btn-sm" disabled={invBusy} title="Download invoice"
                        onClick={() => downloadDoc(() => endpoints.invoiceBlob(o.id), invKey, `${o.soNo}.pdf`)}>
                        ↓
                      </button>
                      <button className="btn btn-sm" disabled={invBusy} title="Share invoice"
                        onClick={() => shareDoc(() => endpoints.invoiceBlob(o.id), invKey, `${o.soNo}.pdf`, `Invoice ${o.soNo}`)}>
                        ↗
                      </button>
                    </div>
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
