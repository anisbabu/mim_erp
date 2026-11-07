"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { endpoints, type Product, type Warehouse } from "@/lib/api";
import SearchSelect from "@/components/SearchSelect";

export default function AdjustPage() {
  const { t, lang, dn } = useI18n();
  const [type, setType] = useState<"DAMAGE" | "COUNT" | "TRANSFER">("DAMAGE");
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [productId, setProductId] = useState("");
  const [fromWarehouseId, setFromWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<Record<string, number>>({});

  useEffect(() => {
    endpoints.products().then(setProducts).catch(() => {});
    endpoints.warehouses().then(setWarehouses).catch(() => {});
  }, []);

  function refreshAvailability(pid = productId) {
    if (!pid) { setAvailability({}); return; }
    endpoints.availability(pid)
      .then((rows) => {
        const map: Record<string, number> = {};
        rows.forEach((r) => { map[r.warehouseId] = r.qty; });
        setAvailability(map);
      })
      .catch(() => {});
  }

  useEffect(() => {
    setAvailability({});
    refreshAvailability();
  }, [productId]);

  const isTransfer = type === "TRANSFER";

  async function submit() {
    setMsg(null);
    if (!productId || !fromWarehouseId || !(Number(qty) > 0)) {
      setMsg({ kind: "err", text: t("Product, source warehouse and quantity are required.") }); return;
    }
    if (isTransfer && !toWarehouseId) { setMsg({ kind: "err", text: t("Choose a destination warehouse.") }); return; }
    setBusy(true);
    try {
      const a: any = await endpoints.adjust({
        type, productId, fromWarehouseId,
        toWarehouseId: isTransfer ? toWarehouseId : null,
        qty: Number(qty), reason,
      });
      setMsg({ kind: "ok", text: `${t("Adjustment")} ${a.adjNo} ${t("posted.")}` });
      setQty(""); setReason("");
      refreshAvailability();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-lg">
      <h1 className="page-title mb-1">{t("Stock adjustment")}</h1>
      <p className="text-sm text-[#6b6960] mb-6">
        {t("Write off damaged stock, correct a count, or transfer stock between warehouses. Damage and count post a loss at FIFO cost; transfer just moves cost layers (no profit impact).")}
      </p>
      <div className="flex gap-1 mb-5 text-sm">
        {(["DAMAGE", "COUNT", "TRANSFER"] as const).map((k) => (
          <button key={k} onClick={() => setType(k)} className="px-3 py-1.5 rounded-lg"
            style={{ background: type === k ? "#1d5e4f" : "#fff", color: type === k ? "#fff" : "#1c1b19", border: "1px solid #d8d4ca" }}>
            {t(k[0] + k.slice(1).toLowerCase())}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-[#6b6960]">{t("Product")}</label>
          <div className="mt-1">
            <SearchSelect
              value={productId}
              onChange={setProductId}
              placeholder={t("Select…")}
              options={products.map((p) => {
                const en = p.fullName ?? p.name;
                const main = lang === "bn" && p.nameBn ? p.nameBn : en;
                const other = main === en ? p.nameBn : en;
                return {
                  value: String(p.id),
                  label: `${main}${p.thicknessMm ? ` (${p.thicknessMm}mm)` : ""}`,
                  sublabel: other && other !== main ? other : undefined,
                };
              })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#6b6960]">{isTransfer ? t("From warehouse") : t("Warehouse")}</label>
            <select className="inp mt-1" value={fromWarehouseId} onChange={(e) => { setFromWarehouseId(e.target.value); setToWarehouseId(""); }}>
              <option value="">{t("Select…")}</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{dn(w)}</option>)}
            </select>
            <div className="h-4 leading-4 mt-0.5 text-xs text-[#6b6960]">
              {productId && fromWarehouseId
                ? `${t("On hand:")} ${availability[fromWarehouseId] ?? 0}`
                : ""}
            </div>
          </div>
          {isTransfer && (
            <div>
              <label className="text-xs text-[#6b6960]">{t("To warehouse")}</label>
              <select className="inp mt-1" value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)}>
                <option value="">{t("Select…")}</option>
                {warehouses.filter((w) => w.id !== fromWarehouseId).map((w) => <option key={w.id} value={w.id}>{dn(w)}</option>)}
              </select>
              <div className="h-4 leading-4 mt-0.5 text-xs text-[#6b6960]">
                {productId && toWarehouseId
                  ? `${t("On hand:")} ${availability[toWarehouseId] ?? 0}`
                  : ""}
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">{t("Quantity")}</label>
          <input className="inp mt-1 text-right tabular-nums" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[#6b6960]">{t("Reason")}</label>
          <input className="inp mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? t("Posting…") : t("Post adjustment")}</button>
      </div>
      {msg && (
        <div className="mt-4 text-sm rounded-lg px-4 py-3"
             style={{ background: msg.kind === "ok" ? "#e6efe9" : "#fbeceb", color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
