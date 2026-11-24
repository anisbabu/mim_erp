"use client";
import { Fragment, useEffect, useState, useMemo } from "react";
import { StatusChip } from "@/components/PoProgressChips";
import { fmtMoney } from "@/lib/fmt";
import { endpoints, fmtDate, type SalesOrder, type SoProgress, type Customer, type Warehouse } from "@/lib/api";
import { beep } from "@/lib/beep";
import { useI18n } from "@/lib/i18n";
import PageHeader from "@/components/PageHeader";
import { Download, Loader2, Printer, Share2 } from "lucide-react";
import TopMessage, { type Msg } from "@/components/TopMessage";
import FulfillDrawer from "@/components/FulfillDrawer";

const PAGE_SIZE = 5;

export default function SalesOrdersPage() {
  const { t, dn, lang } = useI18n();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [progress, setProgress] = useState<Record<string, SoProgress>>({});
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [topMsg, setTopMsg] = useState<Msg>(null);   // shown in the top message bar

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  /** soId → challan ids created by the last Fulfill on this order; Token/Challan print just those. */
  const [lastTake, setLastTake] = useState<Record<string, string[]>>({});
  const [fulfillSoId, setFulfillSoId] = useState<string | null>(null);

  useEffect(() => {
    endpoints.salesOrders().then(setOrders).catch(() => {});
    endpoints.soProgress().then((p) => setProgress(Object.fromEntries(p.map((x) => [x.soId, x])))).catch(() => {});
    endpoints.customers()
        .then((c) => setCustomers(Object.fromEntries(c.map((x) => [x.id, x]))))
        .catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
  }, []);

  const warehouseById = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);

  /** After the drawer delivers part/all of an order: remember its new challans for Token/Challan print, refresh the list. */
  async function handleDelivered(soId: string, newDcIds: string[]) {
    setLastTake((m) => ({ ...m, [soId]: newDcIds }));
    endpoints.salesOrders().then(setOrders).catch(() => {});
    endpoints.soProgress().then((p) => setProgress(Object.fromEntries(p.map((x) => [x.soId, x])))).catch(() => {});
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
    setTopMsg(null);
    try {
      const blob = await fetcher();
      const url = URL.createObjectURL(blob);
      beep();
      return { blob, url };
    } catch (e: any) {
      setTopMsg({ kind: "err", text: e.message });
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

  /** One click: sends the PDF straight to the customer's WhatsApp (Meta Cloud API) — no OS share sheet. */
  async function shareViaWhatsApp(sender: () => Promise<{ sentTo: string }>, key: BusyKey) {
    setBusy(key);
    setTopMsg(null);
    try {
      const r = await sender();
      beep();
      setTopMsg({ kind: "ok", text: `${t("Sent to WhatsApp")} ${r.sentTo}` });
    } catch (e: any) {
      setTopMsg({ kind: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  const statusChip = (s: string) =>
    s === "DELIVERED" || s === "CLOSED" || s === "INVOICED" ? "chip chip-posted" : s === "PARTIALLY_DELIVERED" ? "chip chip-hold" : "chip chip-pending";

  return (
      <div>
        <TopMessage msg={topMsg} />
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
              <th>{t("Status")}</th><th>{t("Delivery")}</th><th>{t("Payment")}</th>
              <th>{t("Documents")}</th><th>{t("Actions")}</th>
            </tr></thead>
            <tbody>
            {pageItems.length === 0 && (
                <tr><td colSpan={9} className="muted">
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
              const canFulfill = o.workflow === "SO_FIRST" && o.status !== "DELIVERED" && o.status !== "CLOSED";
              const pr = progress[o.id];
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
                      <td className="text-center whitespace-nowrap">
                        {pr ? <StatusChip kind="delivery" value={pr.deliveryStatus} /> : "—"}
                      </td>
                      <td className="text-center whitespace-nowrap">
                        {pr ? <>
                          <StatusChip kind="pay" value={pr.payStatus} />
                          {pr.remaining > 0 && <div className="text-[11px] muted tabular-nums mt-0.5">{t("Remaining")} {fmtMoney(pr.remaining)}</div>}
                        </> : "—"}
                      </td>
                      <td>
                        <div className="flex flex-col items-center gap-1">
                          <DocGroup label={t("Token")} busy={busy === wtKey} offTitle={notYetFulfilled ? offTitle : undefined}
                                    titles={[t("Print dispatch token"), t("Download dispatch token"), t("Share dispatch token")]}
                                    onOpen={() => openDoc(() => endpoints.warehouseTokenBlob(o.id, lang, lastTake[o.id]), wtKey)}
                                    onDownload={() => downloadDoc(() => endpoints.warehouseTokenBlob(o.id, lang, lastTake[o.id]), wtKey, `dispatch-${o.soNo}.pdf`)}
                                    onShare={() => shareViaWhatsApp(() => endpoints.shareOrderTokenWhatsApp(o.id, lang, lastTake[o.id]), wtKey)} />
                          <DocGroup label={t("Challan")} busy={busy === dcKey} offTitle={notYetFulfilled ? offTitle : undefined}
                                    titles={[t("Print challan"), t("Download challan"), t("Share challan")]}
                                    onOpen={() => openDoc(() => endpoints.orderChallanBlob(o.id, lang, lastTake[o.id]), dcKey)}
                                    onDownload={() => downloadDoc(() => endpoints.orderChallanBlob(o.id, lang, lastTake[o.id]), dcKey, `challan-${o.soNo}.pdf`)}
                                    onShare={() => shareViaWhatsApp(() => endpoints.shareOrderChallanWhatsApp(o.id, lang, lastTake[o.id]), dcKey)} />
                          <DocGroup label={t("Invoice")} busy={busy === invKey}
                                    titles={[t("Print invoice"), t("Download invoice"), t("Share invoice")]}
                                    onOpen={() => openDoc(() => endpoints.invoiceBlob(o.id, lang), invKey)}
                                    onDownload={() => downloadDoc(() => endpoints.invoiceBlob(o.id, lang), invKey, `${o.soNo}.pdf`)}
                                    onShare={() => shareViaWhatsApp(() => endpoints.shareOrderInvoiceWhatsApp(o.id, lang), invKey)} />
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                          {canFulfill && (
                            <button className="btn btn-sm" title={t("Deliver the Take now quantities")} onClick={() => setFulfillSoId(o.id)}>
                              {t("Fulfill")}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
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

        <FulfillDrawer
            open={!!fulfillSoId}
            soId={fulfillSoId}
            soNo={orders.find((o) => o.id === fulfillSoId)?.soNo ?? ""}
            customerName={(() => {
              const o = orders.find((x) => x.id === fulfillSoId);
              const cust = o ? customers[o.customerId] : undefined;
              return cust ? dn(cust) : "";
            })()}
            warehouseById={warehouseById}
            onClose={() => setFulfillSoId(null)}
            onDelivered={handleDelivered}
        />
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
        <button className={cell} style={{ color: "var(--role-print)" }} disabled={off} title={offTitle ?? titles[0]} onClick={onOpen}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
        </button>
        <button className={cell} style={{ ...sep, color: "var(--role-print)" }} disabled={off} title={offTitle ?? titles[1]} onClick={onDownload}><Download size={14} /></button>
        <button className={cell} style={{ ...sep, color: "var(--role-share)" }} disabled={off} title={offTitle ?? titles[2]} onClick={onShare}><Share2 size={14} /></button>
      </div>
    </div>
  );
}
