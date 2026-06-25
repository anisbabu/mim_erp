"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { endpoints, fmtDate, type PurchaseOrder, type Supplier } from "@/lib/api";
import { ReceiveIcon } from "@/components/Icons";

const PAGE_SIZE = 20;

export default function PoListPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Record<string, Supplier>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "OPEN" | "CLOSED">("ALL");
  const [page, setPage] = useState(1);
  const router = useRouter();

  useEffect(() => {
    endpoints.allPos().then(setPos).catch(() => {});
    endpoints.suppliers()
      .then((s) => setSuppliers(Object.fromEntries(s.map((x) => [x.id, x]))))
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pos;
    return pos.filter((p) => {
      const sup = suppliers[p.supplierId];
      return (
        p.poNo.toLowerCase().includes(q) ||
        (sup?.name ?? "").toLowerCase().includes(q) ||
        (sup?.mobile ?? "").includes(q) ||
        p.orderDate.includes(q)
      );
    });
  }, [pos, suppliers, search]);

  useEffect(() => { setPage(1); }, [search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="page-title">Purchase orders</h1>
        <Link href="/purchase/orders/new" className="btn">New purchase order</Link>
      </div>

      <input
        className="inp mb-4 max-w-sm"
        placeholder="Search PO no, supplier, mobile, date…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="border border-line rounded-xl bg-surface overflow-hidden">
        <table className="tbl">
          <thead><tr>
            <th style={{ textAlign: "center" }}>PO no</th>
            <th style={{ textAlign: "center" }}>Supplier</th>
            <th style={{ textAlign: "center" }}>Date</th>
            <th style={{ textAlign: "center" }}>Status</th>
            <th style={{ textAlign: "center" }}>Receive</th>
          </tr></thead>
          <tbody>
            {pageItems.length === 0 && (
              <tr><td colSpan={5} className="text-[var(--muted)]">
                {search ? "No matching orders." : "No purchase orders yet."}
              </td></tr>
            )}
            {pageItems.map((p) => {
              const sup = suppliers[p.supplierId];
              return (
                <tr key={p.id} className="cursor-pointer"
                    onClick={() => router.push(`/purchase/orders/${p.id}`)}>
                  <td className="font-mono text-[13px] text-brand text-center">{p.poNo}</td>
                  <td className="text-center">
                    <div>{sup?.name ?? "—"}</div>
                    {sup?.mobile && (
                      <div className="text-[12px] text-[var(--muted)]">{sup.mobile}</div>
                    )}
                  </td>
                  <td className="text-center">{fmtDate(p.orderDate)}</td>
                  <td className="text-center">
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: p.status === "OPEN" ? "var(--chip-open-bg)" : "var(--chip-other-bg)",
                               color:      p.status === "OPEN" ? "var(--chip-open-fg)" : "var(--chip-other-fg)" }}>
                      {p.status}
                    </span>
                  </td>
                  <td className="text-center">
                    {p.status === "OPEN" && (
                      <Link className="btn-icon btn-icon-edit" title="Receive"
                        href={`/purchase/receive?poId=${p.id}`}
                        onClick={(e) => e.stopPropagation()}>
                        <ReceiveIcon size={16} />
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-[var(--muted)]">
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