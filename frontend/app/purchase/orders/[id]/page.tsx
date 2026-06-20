"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { endpoints, type PoDetails, type Product } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function PoDetailsPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<PoDetails | null>(null);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true); setErr(null);
    Promise.all([
      endpoints.poDetails(id),
      endpoints.products().catch(() => [] as Product[]),
    ]).then(([d, ps]) => {
      setData(d);
      setProducts(Object.fromEntries(ps.map((p) => [p.id, p])));
    }).catch((e) => setErr(e?.message || "Failed to load purchase order"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="muted">Loading…</div>;
  if (err) return (
    <div>
      <div className="note note-err mb-4">{err}</div>
      <Link className="btn-ghost btn-sm" href="/purchase/orders">← Back</Link>
    </div>
  );
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-medium">Purchase order</h1>
          <span className="text-xs px-2 py-0.5 rounded-full font-mono"
            style={{ background: "var(--chip-other-bg)", color: "var(--chip-other-fg)" }}>{data.poNo}</span>
        </div>
        <Link href="/purchase/orders" className="btn-ghost btn-sm">← Back to list</Link>
      </div>

      <div className="card p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <div><span className="muted">Supplier:</span> <span className="font-medium">{data.supplierName}</span></div>
          <div><span className="muted">Date:</span> <span>{data.orderDate}</span></div>
          <div><span className="muted">Status:</span>{" "}
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: data.status === "OPEN" ? "var(--chip-open-bg)" : "var(--chip-other-bg)",
                       color:      data.status === "OPEN" ? "var(--chip-open-fg)" : "var(--chip-other-fg)" }}>{data.status}</span>
          </div>
          {data.note && <div className="sm:col-span-2"><span className="muted">Note:</span> {data.note}</div>}
        </div>
      </div>

      <div className="card table-wrap mb-4">
        <table className="tbl">
          <thead><tr>
            <th>Product</th>
            <th className="text-right">Qty ordered</th>
            <th className="text-right">Qty balance</th>
            <th className="text-right">Unit price</th>
            <th className="text-right">Line total</th>
          </tr></thead>
          <tbody>
            {data.lines.length === 0 && <tr><td colSpan={5} className="muted">No lines.</td></tr>}
            {data.lines.map((l) => {
              const p = products[l.productId];
              const name = l.productName || p?.name || "—";
              const sku  = p?.sku;
              const lineTotal = (l.qtyOrdered || 0) * (l.unitPrice || 0);
              return (
                <tr key={l.poLineId}>
                  <td>
                    <div className="flex items-center gap-2">
                      {name}
                      {l.freeProduct && (
                        <span className="chip" style={{ background: "var(--chip-open-bg)", color: "var(--chip-open-fg)" }}>Free</span>
                      )}
                    </div>
                    {sku && <div className="text-[11px] muted font-mono">{sku}</div>}
                  </td>
                  <td className="num">{l.qtyOrdered}</td>
                  <td className="num">{l.qtyBalance}</td>
                  <td className="num">{l.freeProduct ? "—" : (l.unitPrice || 0).toFixed(2)}</td>
                  <td className="num">{l.freeProduct ? "—" : lineTotal.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="text-right font-medium">Total</td>
              <td className="num font-medium">{data.totalQty}</td>
              <td></td><td></td>
              <td className="num font-medium">{data.totalValue.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.status === "OPEN" && (
        <Link className="btn" href={`/purchase/receive?poId=${id}`}>Receive goods →</Link>
      )}
    </div>
  );
}
