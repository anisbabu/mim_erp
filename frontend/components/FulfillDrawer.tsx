"use client";

import { useEffect, useState } from "react";
import Drawer from "@/components/Drawer";
import TopMessage from "@/components/TopMessage";
import { useStepCheck, type Problem } from "@/lib/useStepCheck";
import { beep } from "@/lib/beep";
import { endpoints, type SoLineView, type WarehouseStock, type Warehouse } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ArrowDownNarrowWide } from "lucide-react";

type Draft = { warehouseId: string; qty: string };

/** The one stocked warehouse for a product, picked automatically; null when the user must choose. */
function onlyStocked(stock: WarehouseStock[] | undefined): WarehouseStock | null {
  const stocked = (stock ?? []).filter((s) => s.qty > 0);
  return stocked.length === 1 ? stocked[0] : null;
}

/** Take Now up to the full balance, capped by whatever a single stocked warehouse actually has. */
function maxDraft(l: SoLineView, stock: WarehouseStock[] | undefined): Draft {
  const only = onlyStocked(stock);
  return only ? { warehouseId: only.warehouseId, qty: String(Math.min(l.qtyPending, only.qty)) } : { warehouseId: "", qty: "0" };
}

/**
 * Right-hand drawer to deliver part or all of a sales order's open balance. Take Now defaults to the
 * full deliverable amount (capped by stock), not zero — the rest of each line stays as Balance.
 */
export default function FulfillDrawer({ open, soId, soNo, customerName, warehouseById, onClose, onDelivered }: {
  open: boolean; soId: string | null; soNo: string; customerName: string;
  warehouseById: Record<string, Warehouse>;
  onClose: () => void;
  onDelivered: (soId: string, newDcIds: string[]) => void;
}) {
  const { t, dn } = useI18n();
  const [lines, setLines] = useState<SoLineView[] | null>(null);
  const [stockByProduct, setStockByProduct] = useState<Record<string, WarehouseStock[]>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !soId) { setLines(null); setStockByProduct({}); setDrafts({}); setLoadErr(null); setErr(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const ls = await endpoints.orderLines(soId);
        const pending = ls.filter((l) => l.qtyPending > 0);
        const pids = Array.from(new Set(pending.map((l) => l.productId)));
        const stocks = await Promise.all(pids.map((pid) => endpoints.availability(pid)));
        if (cancelled) return;
        const stockMap = Object.fromEntries(pids.map((pid, i) => [pid, stocks[i]]));
        setStockByProduct(stockMap);
        setDrafts(Object.fromEntries(pending.map((l) => [l.id, maxDraft(l, stockMap[l.productId])])));
        setLines(ls);
      } catch (e: any) {
        if (!cancelled) setLoadErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [open, soId]);

  const pending = (lines ?? []).filter((l) => l.qtyPending > 0);
  const set = (lineId: string, patch: Partial<Draft>) =>
    setDrafts((m) => ({ ...m, [lineId]: { ...(m[lineId] ?? { warehouseId: "", qty: "0" }), ...patch } }));

  function fillAll() {
    setDrafts((m) => {
      const next = { ...m };
      for (const l of pending) {
        const stock = stockByProduct[l.productId] ?? [];
        const cur = next[l.id] ?? { warehouseId: "", qty: "0" };
        const warehouseId = cur.warehouseId || onlyStocked(stock)?.warehouseId || "";
        if (!warehouseId) continue; // ambiguous — leave for manual pick
        const onHand = stock.find((s) => s.warehouseId === warehouseId)?.qty ?? 0;
        next[l.id] = { warehouseId, qty: String(Math.min(l.qtyPending, onHand)) };
      }
      return next;
    });
  }

  // first thing missing, in line order: warehouse, then qty vs balance, then qty vs stock on hand
  let problem: Problem = null;
  let anyTake = false;
  for (const l of pending) {
    const d = drafts[l.id] ?? { warehouseId: "", qty: "0" };
    const take = Number(d.qty) || 0;
    if (take <= 0) continue;
    anyTake = true;
    if (!d.warehouseId) { problem = { key: `wh-${l.id}`, text: `${l.productName}: ${t("Select the warehouse.")}` }; break; }
    if (take > l.qtyPending) { problem = { key: `qty-${l.id}`, text: `${l.productName}: ${t("Take Now is more than the balance")}` }; break; }
    const onHand = (stockByProduct[l.productId] ?? []).find((s) => s.warehouseId === d.warehouseId)?.qty ?? 0;
    if (take > onHand) { problem = { key: `qty-${l.id}`, text: `${l.productName}: ${t("More than the stock on hand.")}` }; break; }
  }
  if (!problem && lines && !anyTake) problem = { key: "any", text: t("Choose a warehouse and quantity for at least one line.") };
  const check = useStepCheck(problem);

  async function submit() {
    if (!soId || check.stop()) return;
    const reqLines = pending
      .map((l) => {
        const d = drafts[l.id];
        const take = Number(d?.qty) || 0;
        return d?.warehouseId && take > 0 ? { soLineId: l.id, warehouseId: d.warehouseId, qty: take } : null;
      })
      .filter((x): x is { soLineId: string; warehouseId: string; qty: number } => x !== null);
    setBusy(true);
    setErr(null);
    try {
      // challans that existed before, so the ones this delivery creates can be told apart for print
      const before = new Set((await endpoints.orderPickups(soId)).map((p) => p.dcId));
      await endpoints.fulfillOrder(soId, { lines: reqLines });
      beep();
      const after = await endpoints.orderPickups(soId);
      onDelivered(soId, after.filter((p) => !before.has(p.dcId)).map((p) => p.dcId));
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} title={`${t("Fulfill order")} — ${soNo}`} subtitle={customerName} onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>{t("Cancel")}</button>
        <button className="btn" onClick={submit} disabled={busy || !lines}>{busy ? t("Fulfilling…") : t("Confirm fulfillment")}</button>
      </>}>
      <div onKeyDown={(e) => { if (e.key === "Enter" && !busy) submit(); }}>
        {loadErr && <div className="text-[13px]" style={{ color: "#9a2b22" }}>{loadErr}</div>}
        {!lines && !loadErr && <div className="text-[13px] muted">{t("Loading pending lines…")}</div>}
        {lines && pending.length === 0 && <div className="text-[13px] muted">{t("Nothing pending on this order.")}</div>}

        {pending.length > 0 && (
          <button className="btn-ghost btn-sm mb-3" onClick={fillAll}>
            <ArrowDownNarrowWide size={13} className="mr-1" />{t("Fill all")}
          </button>
        )}

        {pending.map((l) => {
          const stock = stockByProduct[l.productId] ?? [];
          const stocked = stock.filter((s) => s.qty > 0);
          const draft = drafts[l.id] ?? { warehouseId: "", qty: "0" };
          const take = Number(draft.qty) || 0;
          const bal = l.qtyPending - take;
          return (
            <div key={l.id} className="field mb-4">
              <div className="text-[13px] font-medium">{l.productName}</div>
              <div className="text-[11px] muted mt-0.5">
                {t("Ordered")} {l.qty} · {t("Delivered")} {l.qty - l.qtyPending} · {t("Balance")} {l.qtyPending}
              </div>
              <div className="flex items-end gap-2 mt-2">
                {stocked.length > 1 ? (
                  <select className={`inp text-[12px] ${check.bad(`wh-${l.id}`)}`} value={draft.warehouseId}
                          onChange={(e) => set(l.id, { warehouseId: e.target.value })}>
                    <option value="">{t("Select warehouse…")}</option>
                    {stocked.map((s) => (
                      <option key={s.warehouseId} value={s.warehouseId}>
                        {warehouseById[s.warehouseId] ? dn(warehouseById[s.warehouseId]) : s.warehouseId} ({s.qty})
                      </option>
                    ))}
                  </select>
                ) : stocked.length === 1 ? (
                  <span className="text-[12px] muted">{warehouseById[stocked[0].warehouseId] ? dn(warehouseById[stocked[0].warehouseId]) : stocked[0].warehouseId} ({stocked[0].qty})</span>
                ) : (
                  <span className="text-[12px]" style={{ color: "#9a2b22" }}>{t("still no stock")}</span>
                )}
                <input className={`inp text-right tabular-nums ${check.bad(`qty-${l.id}`)}`} style={{ width: 70, marginLeft: "auto" }}
                       type="number" min={0} disabled={!stocked.length}
                       value={draft.qty} onFocus={(e) => e.target.select()}
                       onChange={(e) => set(l.id, { qty: e.target.value })} />
              </div>
              <div className="text-[11px] mt-1 text-right tabular-nums"
                   style={bal > 0 ? { color: "#b4690e" } : bal < 0 ? { color: "#c0392b" } : undefined}>
                {t("Balance")}: {bal}
              </div>
            </div>
          );
        })}

        <TopMessage msg={check.msg} err={err} />
      </div>
    </Drawer>
  );
}
