"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { endpoints, fmtDate, type PoDetails, type Product } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ReceiveIcon } from "@/components/Icons";

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
    }).catch((e) => setErr(e?.message || t("Failed to load purchase order")))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="muted">{t("Loading…")}</div>;
  if (err) return (
    <div>
      <div className="note note-err mb-4">{err}</div>
      <Link className="btn-ghost btn-sm" href="/purchase/orders">{t("← Back")}</Link>
    </div>
  );
  if (!data) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="page-title">{t("Purchase order")}</h1>
          <span className="text-xs px-2 py-0.5 rounded-full font-mono"
            style={{ background: "var(--chip-other-bg)", color: "var(--chip-other-fg)" }}>{data.poNo}</span>
        </div>
        <Link href="/purchase/orders" className="btn-ghost btn-sm">{t("← Back to list")}</Link>
      </div>

      <div className="card p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
          <div><span className="muted">{t("Supplier")}:</span> <span className="font-medium">{data.supplierName}</span></div>
          <div><span className="muted">{t("Date")}:</span> <span>{fmtDate(data.orderDate)}</span></div>
          <div><span className="muted">{t("Status")}:</span>{" "}
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: data.status === "OPEN" ? "var(--chip-open-bg)" : "var(--chip-other-bg)",
                       color:      data.status === "OPEN" ? "var(--chip-open-fg)" : "var(--chip-other-fg)" }}>{t(data.status)}</span>
          </div>
          {data.note && <div className="sm:col-span-2"><span className="muted">{t("Note")}:</span> {data.note}</div>}
        </div>
      </div>

      <div className="card table-wrap mb-4">
        <table className="tbl">
          <thead><tr>
            <th>{t("Product")}</th>
            <th className="text-right">{t("Qty ordered")}</th>
            <th className="text-right">{t("Qty balance")}</th>
            <th className="text-right">{t("Unit price")}</th>
            <th className="text-right">{t("Line total")}</th>
          </tr></thead>
          <tbody>
            {data.lines.length === 0 && <tr><td colSpan={5} className="muted">{t("No lines.")}</td></tr>}
            {data.lines.map((l) => {
              const p = products[l.productId];
              const name = l.productName || p?.fullName || p?.name || "—";
              const sku  = p?.sku;
              const lineTotal = (l.qtyOrdered || 0) * (l.unitPrice || 0);
              return (
                <tr key={l.poLineId}>
                  <td>
                    <div className="flex items-center gap-2">
                      {name}
                      {l.freeProduct && (
                        <span className="chip" style={{ background: "var(--chip-open-bg)", color: "var(--chip-open-fg)" }}>{t("Free")}</span>
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
              <td className="text-right font-medium">{t("Total")}</td>
              <td className="num font-medium">{data.totalQty}</td>
              <td></td><td></td>
              <td className="num font-medium">{data.totalValue.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.status === "OPEN" && (
        <Link className="btn inline-flex items-center gap-1.5" href={`/purchase/receive?poId=${id}`}>
          <ReceiveIcon /> {t("Receive")}
        </Link>
      )}
    </div>
  );
}
