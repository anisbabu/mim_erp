"use client";
import { Fragment, useEffect, useState, useMemo } from "react";
import { endpoints, fmtDate, type SalesOrder, type Customer, type SoLineView, type Warehouse, type WarehouseStock } from "@/lib/api";
import { beep } from "@/lib/beep";

const PAGE_SIZE = 20;

type FulfillDraft = { warehouseId: string; qty: string };

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [fulfillOpenId, setFulfillOpenId] = useState<string | null>(null);
  const [pendingLines, setPendingLines] = useState<Record<string, SoLineView[]>>({});
  const [stockByProduct, setStockByProduct] = useState<Record<string, WarehouseStock[]>>({});
  const [fulfillDraft, setFulfillDraft] = useState<Record<string, FulfillDraft>>({});
  const [fulfillBusy, setFulfillBusy] = useState(false);
  const [fulfillErr, setFulfillErr] = useState<string | null>(null);

  useEffect(() => {
    endpoints.salesOrders().then(setOrders).catch(() => {});
    endpoints.customers()
        .then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x]))))
        .catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
  }, []);

  const warehouseById = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function toggleFulfill(soId: string) {
    if (fulfillOpenId === soId) { setFulfillOpenId(null); return; }
    setFulfillOpenId(soId);
    setFulfillErr(null);
    if (!pendingLines[soId]) {
      try {
        const lines = await endpoints.orderLines(soId);
        setPendingLines((m) => ({ ...m, [soId]: lines }));
        const pending = lines.filter((l) => l.qtyPending > 0);
        const stocks = await Promise.all(pending.map((l) => endpoints.availability(l.productId)));
        setStockByProduct((m) => {
          const next = { ...m };
          pending.forEach((l, i) => { next[l.productId] = stocks[i]; });
          return next;
        });
        const draft: Record<string, FulfillDraft> = {};
        pending.forEach((l) => { draft[l.id] = { warehouseId: "", qty: String(l.qtyPending) }; });
        setFulfillDraft((m) => ({ ...m, ...draft }));
      } catch (e: any) {
        setFulfillErr(e.message);
      }
    }
  }

  async function confirmFulfill(soId: string) {
    const lines = (pendingLines[soId] ?? []).filter((l) => l.qtyPending > 0);
    const reqLines = lines
      .map((l) => {
        const d = fulfillDraft[l.id];
        return d && d.warehouseId && Number(d.qty) > 0
          ? { soLineId: l.id, warehouseId: d.warehouseId, qty: Number(d.qty) }
          : null;
      })
      .filter((x): x is { soLineId: string; warehouseId: string; qty: number } => x !== null);
    if (!reqLines.length) { setFulfillErr("Choose a warehouse and quantity for at least one line."); return; }
    setFulfillBusy(true);
    setFulfillErr(null);
    try {
      await endpoints.fulfillOrder(soId, { lines: reqLines });
      beep();
      const [freshOrders, freshLines] = await Promise.all([
        endpoints.salesOrders(),
        endpoints.orderLines(soId),
      ]);
      setOrders(freshOrders);
      setPendingLines((m) => ({ ...m, [soId]: freshLines }));
      setFulfillDraft({});
      if (!freshLines.some((l) => l.qtyPending > 0)) setFulfillOpenId(null);
    } catch (e: any) {
      setFulfillErr(e.message);
    } finally {
      setFulfillBusy(false);
    }
  }

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

  type BusyKey = string; // soId + "inv" | soId + "dc" | soId + "wt"
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
          <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>SO no</th><th>Customer</th><th>Workflow</th><th>Date</th><th>Status</th></tr></thead>
            <tbody>
            {pageItems.length === 0 && (
                <tr><td colSpan={5} className="text-[#6b6960]">
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
                  <Fragment key={o.id}>
                    <tr className="border-t border-line">
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
                    </tr>

                    {/* Document actions row — separate section below the order's data row */}
                    <tr className="bg-[#faf9f6]">
                      <td colSpan={5} className="py-2">
                        <div className="flex flex-wrap items-center gap-6">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] text-[#6b6960] w-[110px]">Dispatch token</span>
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

                          <div className="flex items-center gap-2">
                            <span className="text-[12px] text-[#6b6960] w-[70px]">Challan</span>
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

                          <div className="flex items-center gap-2">
                            <span className="text-[12px] text-[#6b6960] w-[60px]">Invoice</span>
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

                          {o.workflow === "SO_FIRST" && o.status !== "DELIVERED" && (
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] text-[#6b6960] w-[60px]">Fulfill</span>
                              <button className="btn btn-sm" onClick={() => toggleFulfill(o.id)}>
                                {fulfillOpenId === o.id ? "Close" : "Fulfill"}
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>

                    {fulfillOpenId === o.id && (
                      <tr className="bg-[#faf9f6] border-t border-line">
                        <td colSpan={5} className="py-3">
                          {!pendingLines[o.id] && !fulfillErr && (
                            <div className="text-[12px] text-[#6b6960]">Loading pending lines…</div>
                          )}
                          {fulfillErr && (
                            <div className="text-[12px] mb-2" style={{ color: "#9a2b22" }}>{fulfillErr}</div>
                          )}
                          {pendingLines[o.id] && (
                            <div className="flex flex-col gap-3">
                              {pendingLines[o.id].filter((l) => l.qtyPending > 0).length === 0 && (
                                <div className="text-[12px] text-[#6b6960]">Nothing pending on this order.</div>
                              )}
                              {pendingLines[o.id].filter((l) => l.qtyPending > 0).map((l) => {
                                const stock = stockByProduct[l.productId] ?? [];
                                const stocked = stock.filter((s) => s.qty > 0);
                                const draft = fulfillDraft[l.id] ?? { warehouseId: "", qty: String(l.qtyPending) };
                                const onHand = draft.warehouseId
                                  ? stock.find((s) => s.warehouseId === draft.warehouseId)?.qty ?? 0
                                  : null;
                                return (
                                  <div key={l.id} className="flex flex-wrap items-center gap-3">
                                    <span className="text-[13px] min-w-[180px]">{l.productName}</span>
                                    <span className="text-[12px] text-[#6b6960]">pending: {l.qtyPending}</span>
                                    <select className="inp" style={{ width: 200 }}
                                      value={draft.warehouseId}
                                      onChange={(e) => setFulfillDraft((m) => ({ ...m, [l.id]: { ...draft, warehouseId: e.target.value } }))}>
                                      <option value="">Select warehouse…</option>
                                      {stocked.map((s) => (
                                        <option key={s.warehouseId} value={s.warehouseId}>
                                          {warehouseById[s.warehouseId]?.name ?? s.warehouseId} ({s.qty})
                                        </option>
                                      ))}
                                    </select>
                                    <input className="inp text-right tabular-nums" style={{ width: 90 }}
                                      type="number" min={0}
                                      max={onHand != null ? Math.min(l.qtyPending, onHand) : l.qtyPending}
                                      value={draft.qty}
                                      onChange={(e) => setFulfillDraft((m) => ({ ...m, [l.id]: { ...draft, qty: e.target.value } }))} />
                                    {stocked.length === 0 && (
                                      <span className="text-[12px]" style={{ color: "#b4690e" }}>still no stock</span>
                                    )}
                                  </div>
                                );
                              })}
                              {pendingLines[o.id].some((l) => l.qtyPending > 0) && (
                                <button className="btn btn-sm w-fit" disabled={fulfillBusy}
                                  onClick={() => confirmFulfill(o.id)}>
                                  {fulfillBusy ? "Fulfilling…" : "Confirm fulfillment"}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
              );
            })}
            </tbody>
          </table>
          </div>
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
