"use client";
import { Fragment, useEffect, useState, useMemo } from "react";
import { endpoints, fmtDate, type SalesOrder, type Customer, type SoLineView, type Warehouse, type WarehouseStock, type PickupView } from "@/lib/api";
import { beep } from "@/lib/beep";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import { Download, Loader2, Printer, Share2 } from "lucide-react";

const PAGE_SIZE = 5;

type FulfillDraft = { warehouseId: string; qty: string };

export default function SalesOrdersPage() {
  const { t, dn, lang } = useI18n();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [orderLines, setOrderLines] = useState<Record<string, SoLineView[]>>({});
  const [stockByProduct, setStockByProduct] = useState<Record<string, WarehouseStock[]>>({});
  const [fulfillDraft, setFulfillDraft] = useState<Record<string, FulfillDraft>>({});
  /** soId → challan ids created by the last Fulfill on this page; Token/Challan print just those. */
  const [lastTake, setLastTake] = useState<Record<string, string[]>>({});
  const [fulfillBusy, setFulfillBusy] = useState<string | null>(null);
  const [fulfillErr, setFulfillErr] = useState<Record<string, string>>({});

  const [pickupsOpenId, setPickupsOpenId] = useState<string | null>(null);
  const [pickups, setPickups] = useState<Record<string, PickupView[]>>({});
  const [pickupsErr, setPickupsErr] = useState<string | null>(null);

  useEffect(() => {
    endpoints.salesOrders().then(setOrders).catch(() => {});
    endpoints.customers()
        .then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x]))))
        .catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
  }, []);

  const warehouseById = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);

  /** Default Take now for a pending line: the only stocked warehouse is picked and qty capped at its stock. */
  function defaultDraft(l: SoLineView, stock: WarehouseStock[] | undefined): FulfillDraft {
    const stocked = (stock ?? []).filter((s) => s.qty > 0);
    const only = stocked.length === 1 ? stocked[0] : null;
    return { warehouseId: only?.warehouseId ?? "", qty: "0" };
  }

  /** Loads lines (and stock for pending products) of the given orders; refresh=true reloads even if cached. */
  async function loadLines(soIds: string[], refresh = false) {
    const ids = refresh ? soIds : soIds.filter((id) => !orderLines[id]);
    if (!ids.length) return;
    try {
      const all = await Promise.all(ids.map((id) => endpoints.orderLines(id)));
      const pending = all.flat().filter((l) => l.qtyPending > 0);
      const pids = Array.from(new Set(pending.map((l) => l.productId)))
        .filter((pid) => refresh || !stockByProduct[pid]);
      const stocks = await Promise.all(pids.map((pid) => endpoints.availability(pid)));
      const stockMap = { ...stockByProduct, ...Object.fromEntries(pids.map((pid, i) => [pid, stocks[i]])) };
      setOrderLines((m) => ({ ...m, ...Object.fromEntries(ids.map((id, i) => [id, all[i]])) }));
      setStockByProduct(stockMap);
      setFulfillDraft((m) => {
        const next = { ...m };
        pending.forEach((l) => { if (refresh || !next[l.id]) next[l.id] = defaultDraft(l, stockMap[l.productId]); });
        return next;
      });
    } catch (e: any) {
      setFulfillErr((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, e.message])) }));
    }
  }

  async function confirmFulfill(soId: string) {
    const all = orderLines[soId] ?? [];
    // every Take Now box is typeable; refuse quantities that cannot be delivered instead of silently dropping them
    for (const l of all) {
      const q = Number(fulfillDraft[l.id]?.qty) || 0;
      if (q <= 0) continue;
      const why = q > l.qtyPending ? t("Take Now is more than the balance")
        : !fulfillDraft[l.id]?.warehouseId
          ? ((stockByProduct[l.productId] ?? []).some((s) => s.qty > 0) ? t("Select warehouse…") : t("still no stock"))
          : null;
      if (why) { setFulfillErr((m) => ({ ...m, [soId]: `${l.productName}: ${why}` })); return; }
    }
    const lines = all.filter((l) => l.qtyPending > 0);
    const reqLines = lines
      .map((l) => {
        const d = fulfillDraft[l.id];
        return d && d.warehouseId && Number(d.qty) > 0
          ? { soLineId: l.id, warehouseId: d.warehouseId, qty: Number(d.qty) }
          : null;
      })
      .filter((x): x is { soLineId: string; warehouseId: string; qty: number } => x !== null);
    if (!reqLines.length) { setFulfillErr((m) => ({ ...m, [soId]: t("Choose a warehouse and quantity for at least one line.") })); return; }
    setFulfillBusy(soId);
    setFulfillErr((m) => { const n = { ...m }; delete n[soId]; return n; });
    try {
      // challans that existed before, so the ones this Fulfill creates can be told apart
      const before = new Set((await endpoints.orderPickups(soId)).map((p) => p.dcId));
      await endpoints.fulfillOrder(soId, { lines: reqLines });
      beep();
      const after = await endpoints.orderPickups(soId);
      setPickups((m) => ({ ...m, [soId]: after }));
      // Token / Challan in the row now print only this Take Now pickup
      setLastTake((m) => ({ ...m, [soId]: after.filter((p) => !before.has(p.dcId)).map((p) => p.dcId) }));
      setOrders(await endpoints.salesOrders());
      // stock moved: reload this order and every other visible order sharing its products
      const pids = new Set(lines.map((l) => l.productId));
      const affected = pageItems.map((o) => o.id)
        .filter((id) => id === soId || (orderLines[id] ?? []).some((l) => l.qtyPending > 0 && pids.has(l.productId)));
      await loadLines(affected, true);
    } catch (e: any) {
      setFulfillErr((m) => ({ ...m, [soId]: e.message }));
    } finally {
      setFulfillBusy(null);
    }
  }

  async function togglePickups(soId: string) {
    if (pickupsOpenId === soId) { setPickupsOpenId(null); return; }
    setPickupsOpenId(soId);
    setPickupsErr(null);
    if (!pickups[soId]) {
      try {
        const list = await endpoints.orderPickups(soId);
        setPickups((m) => ({ ...m, [soId]: list }));
      } catch (e: any) {
        setPickupsErr(e.message);
      }
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
  const pageKey = pageItems.map((o) => o.id).join(",");
  useEffect(() => { if (pageKey) loadLines(pageKey.split(",")); }, [pageKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const statusChip = (s: string) =>
    s === "DELIVERED" ? "chip chip-posted" : s === "PARTIALLY_DELIVERED" ? "chip chip-hold" : "chip chip-pending";

  return (
      <div>
        <PageHeader
            crumbs={["Sales"]}
            title={t("Sales orders")}
            subtitle={t("Track deliveries and print the dispatch token, challan and invoice for each order.")}
        />

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
              className="inp max-w-sm"
              placeholder={t("Search SO no, customer, mobile, date…")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="card overflow-hidden">
          <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>{t("SO no")}</th><th>{t("Customer")}</th><th>{t("Workflow")}</th><th>{t("Date")}</th>
              <th>{t("Status")}</th>
              <th className="num">{t("Qty")}</th><th className="num">{t("Take Now")}</th><th className="num">{t("Balance")}</th>
              <th>{t("Documents")}</th><th>{t("Actions")}</th>
            </tr></thead>
            <tbody>
            {pageItems.length === 0 && (
                <tr><td colSpan={10} className="muted">
                  {search ? t("No matching orders.") : t("No sales orders yet.")}
                </td></tr>
            )}
            {pageItems.map((o) => {
              const cust = customers[o.customerId];
              const wtKey  = o.id + "wt";
              const dcKey  = o.id + "dc";
              const invKey = o.id + "inv";
              const notYetFulfilled = o.status === "PENDING"; // SO_FIRST order with zero challans so far
              const offTitle = t("Nothing delivered yet — fulfill the order first");
              const lines = orderLines[o.id];
              const canFulfill = o.workflow === "SO_FIRST" && o.status !== "DELIVERED";
              const lineRow = "h-8 flex items-center justify-end gap-2 whitespace-nowrap";
              return (
                  <Fragment key={o.id}>
                    <tr className="border-t border-line">
                      <td className="font-mono text-[13px] text-center whitespace-nowrap">{o.soNo}</td>
                      <td className="text-center">
                        <div>{cust ? dn(cust) : "—"}</div>
                        {cust?.mobile && <div className="text-[12px] muted">{cust.mobile}</div>}
                      </td>
                      <td className="text-xs text-center">{t(o.workflow)}</td>
                      <td className="text-center whitespace-nowrap">{fmtDate(o.orderDate)}</td>
                      <td className="text-center"><span className={statusChip(o.status)}>{t(o.status)}</span></td>
                      {/* one stacked entry per product line, same height across Qty / Take now / Balance */}
                      <td className="num">
                        {!lines ? <span className="muted">…</span> : lines.map((l) => (
                          <div key={l.id} className={lineRow} title={l.productName}>
                            <span className="text-[11px] muted truncate max-w-[130px]">{l.productName}</span>
                            <span className="tabular-nums">{l.qty}</span>
                          </div>
                        ))}
                      </td>
                      <td className="num">
                        {lines?.map((l) => {
                          const stock = stockByProduct[l.productId] ?? [];
                          const stocked = stock.filter((s) => s.qty > 0);
                          // delivered lines are locked at 0; no-stock lines stay typeable and are checked on Fulfill
                          const delivered = !canFulfill || l.qtyPending <= 0;
                          if (delivered) return (
                            <div key={l.id} className={lineRow} title={t("Nothing left to deliver")}>
                              <input className="inp text-right tabular-nums muted" style={{ width: 70 }}
                                     type="number" value={0} disabled readOnly />
                            </div>
                          );
                          const hint = !stocked.length ? t("still no stock") : null;
                          const draft = fulfillDraft[l.id] ?? { warehouseId: "", qty: "0" };
                          const onHand = draft.warehouseId ? stock.find((s) => s.warehouseId === draft.warehouseId)?.qty ?? 0 : null;
                          const set = (patch: Partial<FulfillDraft>) => setFulfillDraft((m) => ({ ...m, [l.id]: { ...draft, ...patch } }));
                          return (
                            <div key={l.id} className={lineRow}>
                              {stocked.length > 1 && (
                                <select className="inp text-[12px]" style={{ width: 130 }} value={draft.warehouseId}
                                        onChange={(e) => set({ warehouseId: e.target.value })}>
                                  <option value="">{t("Select warehouse…")}</option>
                                  {stocked.map((s) => (
                                    <option key={s.warehouseId} value={s.warehouseId}>
                                      {warehouseById[s.warehouseId] ? dn(warehouseById[s.warehouseId]) : s.warehouseId} ({s.qty})
                                    </option>
                                  ))}
                                </select>
                              )}
                              <input className="inp text-right tabular-nums" style={{ width: 70 }}
                                     type="number" min={0}
                                     title={hint ?? (stocked.length === 1 ? (warehouseById[stocked[0].warehouseId] ? dn(warehouseById[stocked[0].warehouseId]) : "") : undefined)}
                                     max={onHand != null ? Math.min(l.qtyPending, onHand) : Math.max(l.qtyPending, 0)}
                                     onFocus={(e) => e.target.select()}
                                     value={draft.qty}
                                     onKeyDown={(e) => { if (e.key === "Enter") confirmFulfill(o.id); }}
                                     onChange={(e) => set({ qty: e.target.value })} />
                            </div>
                          );
                        })}
                      </td>
                      {/* Balance = still owed − Take now (equals Qty − Take now while nothing has been delivered) */}
                      <td className="num">
                        {lines?.map((l) => {
                          const take = canFulfill && l.qtyPending > 0 ? Math.max(0, Number(fulfillDraft[l.id]?.qty) || 0) : 0;
                          const bal = l.qtyPending - take;
                          return (
                            <div key={l.id} className={lineRow + " tabular-nums" + (bal > 0 ? " font-semibold" : " muted")}
                                 style={bal > 0 ? { color: "#b4690e" } : bal < 0 ? { color: "#c0392b" } : undefined}>{bal}</div>
                          );
                        })}
                      </td>
                      <td>
                        <div className="flex flex-col items-center gap-1">
                          <DocGroup label={t("Token")} busy={busy === wtKey} offTitle={notYetFulfilled ? offTitle : undefined}
                                    titles={[t("Print dispatch token"), t("Download dispatch token"), t("Share dispatch token")]}
                                    onOpen={() => openDoc(() => endpoints.warehouseTokenBlob(o.id, lang, lastTake[o.id]), wtKey)}
                                    onDownload={() => downloadDoc(() => endpoints.warehouseTokenBlob(o.id, lang, lastTake[o.id]), wtKey, `dispatch-${o.soNo}.pdf`)}
                                    onShare={() => shareDoc(() => endpoints.warehouseTokenBlob(o.id, lang, lastTake[o.id]), wtKey, `dispatch-${o.soNo}.pdf`, `Dispatch Token ${o.soNo}`)} />
                          <DocGroup label={t("Challan")} busy={busy === dcKey} offTitle={notYetFulfilled ? offTitle : undefined}
                                    titles={[t("Print challan"), t("Download challan"), t("Share challan")]}
                                    onOpen={() => openDoc(() => endpoints.orderChallanBlob(o.id, lang, lastTake[o.id]), dcKey)}
                                    onDownload={() => downloadDoc(() => endpoints.orderChallanBlob(o.id, lang, lastTake[o.id]), dcKey, `challan-${o.soNo}.pdf`)}
                                    onShare={() => shareDoc(() => endpoints.orderChallanBlob(o.id, lang, lastTake[o.id]), dcKey, `challan-${o.soNo}.pdf`, `Challan ${o.soNo}`)} />
                          <DocGroup label={t("Invoice")} busy={busy === invKey}
                                    titles={[t("Print invoice"), t("Download invoice"), t("Share invoice")]}
                                    onOpen={() => openDoc(() => endpoints.invoiceBlob(o.id, lang), invKey)}
                                    onDownload={() => downloadDoc(() => endpoints.invoiceBlob(o.id, lang), invKey, `${o.soNo}.pdf`)}
                                    onShare={() => shareDoc(() => endpoints.invoiceBlob(o.id, lang), invKey, `${o.soNo}.pdf`, `Invoice ${o.soNo}`)} />
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                          {canFulfill && (
                            <button className="btn btn-sm" disabled={fulfillBusy === o.id || !lines}
                                    title={t("Deliver the Take now quantities")} onClick={() => confirmFulfill(o.id)}>
                              {fulfillBusy === o.id ? t("Fulfilling…") : t("Fulfill")}
                            </button>
                          )}
                          <button className="btn-ghost btn-sm" title={t("Pickups")} onClick={() => togglePickups(o.id)}>
                            {pickupsOpenId === o.id ? t("Close") : t("History")}
                          </button>
                        </div>
                        {fulfillErr[o.id] && (
                          <div className="text-[11px] mt-1 text-center max-w-[200px] mx-auto" style={{ color: "#9a2b22" }}>{fulfillErr[o.id]}</div>
                        )}
                      </td>
                    </tr>

                    {pickupsOpenId === o.id && (
                      <tr className="bg-[#faf9f6] border-t border-line">
                        <td colSpan={10} className="py-3">
                          {!pickups[o.id] && !pickupsErr && (
                            <div className="text-[12px] text-[#6b6960]">{t("Loading pickups…")}</div>
                          )}
                          {pickupsErr && (
                            <div className="text-[12px]" style={{ color: "#9a2b22" }}>{pickupsErr}</div>
                          )}
                          {pickups[o.id] && pickups[o.id].length === 0 && (
                            <div className="text-[12px] text-[#6b6960]">{t("No pickups yet.")}</div>
                          )}
                          {pickups[o.id] && pickups[o.id].length > 0 && (
                            <div className="flex flex-col gap-2">
                              {pickups[o.id].map((p, i) => {
                                const pKey = p.dcId + "pk";
                                const pBusy = busy === pKey;
                                const itemsText = p.lines.map((l) => `${l.productName} × ${l.qty}`).join(", ");
                                return (
                                  <div key={p.dcId} className="flex flex-wrap items-center gap-3">
                                    <span className="text-[12px] text-[#6b6960] w-[20px]">#{i + 1}</span>
                                    <span className="font-mono text-[13px]">{p.dcNo}</span>
                                    <span className="text-[12px] text-[#6b6960]">{fmtDate(p.date)}</span>
                                    <span className="text-[12px] text-[#6b6960]">{p.warehouseName}</span>
                                    <span className="text-[13px]">{itemsText}</span>
                                    <DocGroup label={t("Token")} busy={busy === p.dcId + "tk"}
                                              titles={[t("Print dispatch token"), t("Download dispatch token"), t("Share dispatch token")]}
                                              onOpen={() => openDoc(() => endpoints.challanTokenBlob(p.dcId, lang), p.dcId + "tk")}
                                              onDownload={() => downloadDoc(() => endpoints.challanTokenBlob(p.dcId, lang), p.dcId + "tk", `token-${p.dcNo}.pdf`)}
                                              onShare={() => shareDoc(() => endpoints.challanTokenBlob(p.dcId, lang), p.dcId + "tk", `token-${p.dcNo}.pdf`, `Dispatch Token ${p.dcNo}`)} />
                                    <button className="btn-ghost btn-sm" disabled={pBusy} title={t("Print this pickup's challan")}
                                            onClick={() => openDoc(() => endpoints.challanBlob(p.dcId, lang), pKey)}>
                                      {pBusy ? "…" : "🖨"}
                                    </button>
                                    <button className="btn-ghost btn-sm" disabled={pBusy} title={t("Download this pickup's challan")}
                                            onClick={() => downloadDoc(() => endpoints.challanBlob(p.dcId, lang), pKey, `${p.dcNo}.pdf`)}>
                                      ↓
                                    </button>
                                    <button className="btn btn-sm" disabled={pBusy} title={t("Share this pickup's challan")}
                                            onClick={() => shareDoc(() => endpoints.challanBlob(p.dcId, lang), pKey, `${p.dcNo}.pdf`, `Challan ${p.dcNo}`)}>
                                      ↗
                                    </button>
                                  </div>
                                );
                              })}
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
              <span>{filtered.length} {t("orders")} · {t("page")} {page} {t("of")} {totalPages}</span>
              <div className="flex gap-2">
                <button className="btn-ghost px-3 py-1"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}>← {t("Prev")}</button>
                <button className="btn-ghost px-3 py-1"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}>{t("Next")} →</button>
              </div>
            </div>
        )}
      </div>
  );
}

/** One document's print / download / share buttons as a joined group, label above. */
function DocGroup({ label, busy, offTitle, titles, onOpen, onDownload, onShare }: {
  label: string; busy: boolean; offTitle?: string; titles: [string, string, string];
  onOpen: () => void; onDownload: () => void; onShare: () => void;
}) {
  const off = busy || !!offTitle;
  const cell = "inline-flex items-center justify-center h-7 w-8 transition-colors hover:bg-[var(--tbl-tr-hover)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent";
  const sep = { borderLeft: "1px solid var(--input-border)" };
  return (
    <div className="flex items-center gap-2" title={offTitle}>
      <span className="text-[10px] uppercase tracking-wide muted leading-none whitespace-nowrap w-14 text-right">{label}</span>
      <div className="inline-flex overflow-hidden rounded" style={{ border: "1px solid var(--input-border)", background: "var(--surface)" }}>
        <button className={cell} disabled={off} title={offTitle ?? titles[0]} onClick={onOpen}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
        </button>
        <button className={cell} style={sep} disabled={off} title={offTitle ?? titles[1]} onClick={onDownload}><Download size={14} /></button>
        <button className={cell} style={{ ...sep, color: "var(--brand)" }} disabled={off} title={offTitle ?? titles[2]} onClick={onShare}><Share2 size={14} /></button>
      </div>
    </div>
  );
}
