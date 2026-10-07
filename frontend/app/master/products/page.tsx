"use client";
import { useEffect, useMemo, useState } from "react";
import { endpoints, type Product, type Supplier } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EditIcon, TrashIcon } from "@/components/Icons";

const CATEGORIES  = ["MDF", "PLY", "MELAMINE", "HPL", "ACRYLIC SHEET", "FORMICA", "PVC", "EDGING", "LOOSE VENEER", "VENEER", "ELEGANT"];
const THICKNESSES = [6, 12, 16.3, 18, 19, 25];
const PLY_THICKNESSES = [2, 3, 4, 6, 8, 10, 12, 15, 16, 16.3, 18, 19, 25, 36];
const PVC_THICKNESSES = [1.75, 2.75, 3.75, 4.75, 7.5, 12, 18, 25];
const MDF_THICKNESSES = [3, 6, 9, 12, 18, 25];
const MELAMINE_THICKNESSES = [3, 6, 9, 12, 16, 18, 25];
const VENEER_BOARD_THICKNESSES = [12, 18];
const FORMICA_THICKNESSES = [0.4, 0.5, 0.7];
const CATEGORY_THICKNESSES: Record<string, number[]> = {
  "PLY": PLY_THICKNESSES,
  "PVC": PVC_THICKNESSES,
  "MDF": MDF_THICKNESSES,
  "MELAMINE": MELAMINE_THICKNESSES,
  "VENEER": VENEER_BOARD_THICKNESSES,
  "FORMICA": FORMICA_THICKNESSES,
};
function thicknessOptionsFor(category?: string): number[] {
  return (category && CATEGORY_THICKNESSES[category]) || THICKNESSES;
}
const SIDE_APPLICABLE_THICKNESSES: Record<string, number[]> = {
  "PLY": [12, 18, 19],
  "MDF": [12, 18],
  "VENEER": [12, 18],
};
const EDGING_SIZES = [
  ".5X19", ".5X22", ".5X29", ".5X38",
  "1X19", "1X22", "1X29", "1X38",
  "2X19", "2X22", "2X29", "2X38",
];
const VENEER_THICKNESSES = [2.5, 4, 6];
const MELAMINE_COLORS = [
  "ALBINO OAK", "ALVINO OAK", "AMBER OAK", "AMBER SILK", "AMBER SPECIAL TEAK",
  "AMBER TEAK", "AMERICAN TEAK", "AMERICAN WALNUT", "ANATUR", "ANATURE", "ANTIC",
  "ANTIC EMBER GLOSSY", "ANTIC EMBER MAT", "ARCTIC IVORY GLOSSY", "ARCTIC IVORY LBA",
  "ARCTIC IVORY MAT", "ARIT", "ARKANSAS", "ARTIFACT", "AURORA GLOW GLOSSY",
  "AURORA GLOW MAT", "BASALT ROCK GLOSSY", "BEECH", "BLACK", "BLACK AMBUSH",
  "BLACK OAK", "BLACK OAK 734", "BLACK WENGE", "BLACK WOOD", "BLUE", "BRAWON CARPET",
  "BURMA TEAK", "CANADIAN TEAK", "CARAMEL", "CARTOON-2", "CATANIA OAK", "CEDER",
  "CHEERY", "CHERRY", "CHESSNUT", "CHINA WALNUT", "CHINESE TEAK", "CHOCOLATIC",
  "CHOCOLETIC", "CLASSIC WOOD GLOSSY", "CLASSIC WOOD MAT", "CLOUDY CAMRIC",
  "COAST LINE", "COST LINE", "CRAFT CANVAS", "CROWN OAK", "CRYSTAL MARBLE",
  "CTG TAEK", "CTG TEAK", "DALIYA", "DARK OAK", "DARK WALNUT", "DEEP CHEERY",
  "DEEP CHERRY", "DEEP WALNUT", "EBONY", "ECLIPSE MATTE GLOSSY", "ECLIPSE MATTE MAT",
  "ELEGANCE OAK", "FEBRIC", "FOZIL OAK", "FROZEN STONE", "GARNET GRAIN GLOSSY",
  "GARNET GRAIN MAT", "GOLD WOOD", "GOLDEN FLOWER", "GOLDEN FLOWRRY",
  "GOLDEN FOLLWARY", "GOLDEN OAK", "GOLDEN TEAK", "GOLDEN WOOD", "GRAPHITE",
  "GRAPHITE MAT", "GREEN", "GREY", "GREY GLOSSY", "GREY MARBLE", "GREY MAT",
  "HAVANA OAK", "IMPERIAL TEAK GLOSSY", "JAPANESE SILK", "JAPANIC SLIK",
  "JET BLACK GLOSSY", "KANADIAN PAINE", "KHAN TEAK", "LIGHT CHERRY", "LIGHT WOOD",
  "LUNAR FROST GLOSSY", "LUNAR FROST LBA", "MAPEL", "MAPLE", "MARBLE",
  "MAXCICAN OAK", "MAXICAN OAK", "MEHAGONI", "MEHOGONI", "MEHOGONY", "MEHOGUNI",
  "METALIC", "METALLIC", "MIDNIGHT BLACK GLOSSY", "MIDNIGHT BLACK LBA",
  "MIDNIGHT BLACK MAT", "MILKWAY MAT", "MILKYWAY GLOSSY", "MILKYWAY MAT",
  "MIOST TEAK", "MOIST TEAK", "MONUMENT OAK", "NEBULA MIST GLOSSY",
  "NEBULA MIST MAT", "NEW TEAK", "NIJARIAN TEAK", "NIZERIAN TEAK",
  "NORDIC BIRCH GLOSSY", "OAK", "OAK PATCH", "ORANGE", "ORANGE CIRCLE", "P.GREEN",
  "PAPAI", "PAROT GREEN", "PARROT GREEN", "PEARL MARBLE GREY", "PEARL WHITE",
  "PEOGOUT MARBLE-4", "PEUEOT MARBLE-4", "PINK WAVE", "PINK/GOLAPI", "PLY BLACK",
  "PREMIUM TEAK", "PROME TAEK", "PROME TEAK", "PROME TEAK 3D", "PROVATI -36",
  "PURPLE", "PURPLE PEARL", "QUEEN FOLLOWRY", "QUEEN FOLLWORY", "RED",
  "RED ARTIFACT", "RED MARBLE", "RED OAK", "RED OAK CROWN", "REGULAR WHITE GLOSSY",
  "REGULAR WHITE MAT", "ROCKY OAK", "ROSE WOOD", "ROYAL CROWN", "SANI TEAK",
  "SANTANA OAK", "SHADI TEAK", "SHADY TEAK", "SHAN TAEK", "SHAN TEAK", "SHANI WOOD",
  "SHINE WOOD", "SHOYKAT", "SILK", "SILK LINE", "SILKY BLACK", "SILKY BROWN",
  "SILVER GREY", "SILVER LINE", "SILVER OAK", "SMOKE", "SOIKAT", "SOLAR FLARE GLOSSY",
  "SOLAR FLARE MAT", "SOLIA OAK CLAY", "SONALI", "SONOMA OAK", "SONOMA OAK MAT",
  "SPACE BLACK GLOSSY", "SPACE BLACK MAT", "SPACE GREY GLOSSY", "SPACE GREY LBA",
  "SPACE GREY MAT", "SPAIDER", "SPANISH OAK", "SPECIAL TEAK", "STARLIGHT GLOSSY",
  "STARLIGHT MAT", "SUBORNO", "SUN T/BROWN CARPET", "SUPER", "SUPER OAK",
  "SWICH SILK", "TEAK SPECIAL", "TECTONIC CLAY LBA", "WALNUT", "WENGE", "WHITE",
  "WHITE 22", "WHITE BEECH", "WHITE CAMBRICK", "WHITE CASTLE", "WHITE CEDAR",
  "WHITE CEDER", "WHITE GLOSSY", "WHITE MARBLE", "WHITE MAT", "WHITE OAK",
  "WHITE TEAK", "WHITE WALNUT", "WILLOW", "WOOD BLACK", "WOOD GRAIN WHITE",
  "WOODEN RING", "YELLOW", "ZEBRA LINE", "ZEN TEAK",
];
const PLY_COLORS = [
  "ACRYLIC", "ARTIFICIAL", "ARTIFICIYAL", "ASH", "BEECH", "BROWN", "BURL",
  "BURMATEAK", "BURMA TEAK LINE", "CHAPELI", "CHAPILI", "COMMERCIAL", "CROWNTEAK",
  "EBONI", "EBONY", "ENGINEERING", "FORMICA", "GARJON", "GOLD", "GP", "MARINE",
  "NUT", "OAK", "RETARDANT", "RICON", "RO", "ROYAL", "ROYALE", "SAPELLI",
  "SHATARING", "SHUTERING", "SHUTTERING", "ST", "TEAK", "WALLNUT", "WENGE",
];
const CATEGORY_COLORS: Record<string, string[]> = {
  "MELAMINE": MELAMINE_COLORS,
  "PLY": PLY_COLORS,
};
function colorOptionsFor(category?: string): string[] {
  return (category && CATEGORY_COLORS[category]) || COLORS;
}
const SIDES = [
  { value: "O/S", label: "ONE SIDE" },
  { value: "B/S", label: "BOTH SIDE" },
];
const COLORS = [
  "ASH", "Amble teak", "American Cherry", "BT", "BT Apple", "BT Crown Elite",
  "BT Shady grain", "BT- Lime", "Beech", "Black Chapeli", "Brown Gorjan",
  "Burma Teak Flowery", "CROWN OAK", "CT", "Califonia Ebony", "Cedar", "Champa",
  "Chestnut", "Coco Brown", "Commercial", "Curly Teak", "Fish Ash", "Garjon",
  "Golden Ornate Teak", "Golden Teak", "Marine BT", "Marine CT", "Marine Red Oak",
  "Marine US Walnut", "Marine garjon", "Mehogony Crown", "Pine", "RUSTIC", "Radient",
  "Red Oak", "Royel Crown Teak", "Shuttering", "Super Alien", "Super Sapelli",
  "Super Straight Teak", "Super White Ash", "SuperTeak", "Swiss Walnut",
  "USA Black Walnut", "Urban Teak", "Wenge", "White oak",
];
const HW_UNITS   = ["PCS", "SET", "KG", "MTR", "BOX", "ROLL", "PAIR", "DOZ"];
const CAT_CODE: Record<string, string> = {
  "MDF": "M", "PLY": "P", "MELAMINE": "ML", "HPL": "H",
  "ACRYLIC SHEET": "A", "FORMICA": "F", "PVC": "PV",
};

function genBoardSku(
  f: { thicknessMm?: number; edgingSize?: string; name?: string; category?: string; color?: string; supplierId?: string },
  suppliers: { id: string; name: string }[],
): string {
  const th  = f.category === "EDGING"
    ? (f.edgingSize ?? "")
    : (f.thicknessMm ? String(Math.round(f.thicknessMm)) : "");
  const n   = f.name?.trim()[0]?.toUpperCase() ?? "";
  const c   = CAT_CODE[f.category ?? ""] ?? "";
  const col = f.color?.trim()[0]?.toUpperCase() ?? "";
  const sup = suppliers.find((s) => s.id === f.supplierId)?.name?.trim()[0]?.toUpperCase() ?? "";
  return `${th}${n}${c}${col}${sup}`;
}

function genHardwareSku(
  f: { name?: string; supplierId?: string },
  suppliers: { id: string; name: string }[],
): string {
  const n   = f.name?.trim().slice(0, 2).toUpperCase() ?? "";
  const sup = suppliers.find((s) => s.id === f.supplierId)?.name?.trim().slice(0, 2).toUpperCase() ?? "";
  return `${n}${sup}`;
}

function genFullName(
  f: { type?: string; thicknessMm?: number; edgingSize?: string; name?: string; category?: string; color?: string; supplierId?: string },
  suppliers: { id: string; name: string }[],
): string {
  if (f.type === "BOARD") {
    const supWord = suppliers.find((s) => s.id === f.supplierId)?.name?.trim().split(/\s+/)[0];
    const supPart = supWord ? `(${supWord})` : "";
    const thicknessPart = f.category === "EDGING"
      ? (f.edgingSize ?? "")
      : (f.thicknessMm != null ? `${f.thicknessMm}MM` : "");
    return [
      thicknessPart,
      f.name?.trim() ?? "",
      f.category?.trim() ?? "",
      f.color?.trim() ?? "",
      supPart,
    ].filter(Boolean).join("-");
  }
  return f.name?.trim() ?? "";
}

const R = () => <span className="text-red-500 ml-0.5">*</span>;

export default function ProductsPage() {
  const { t, dn } = useI18n();
  const [rows, setRows]         = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [f, setF]               = useState<Partial<Product>>({ type: "BOARD", unit: "PCS" });
  const [editId, setEditId]     = useState<string | null>(null);
  const [manualSku, setManualSku] = useState(false);
  const [q, setQ]               = useState("");
  const [msg, setMsg]           = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = () => endpoints.products().then(setRows).catch(() => {});
  useEffect(() => { load(); endpoints.suppliers().then(setSuppliers).catch(() => {}); }, []);

  // Auto-generate SKU when creating new
  useEffect(() => {
    if (manualSku) return;
    const sku = f.type === "BOARD"
      ? genBoardSku(f, suppliers)
      : genHardwareSku(f, suppliers);
    if (sku) setF((prev) => ({ ...prev, sku }));
  }, [f.thicknessMm, f.edgingSize, f.name, f.category, f.color, f.supplierId, f.type, manualSku, suppliers]);

  // Auto-generate full name
  useEffect(() => {
    const fn = genFullName(f, suppliers);
    setF((prev) => ({ ...prev, fullName: fn || undefined }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.type, f.thicknessMm, f.edgingSize, f.name, f.category, f.color, f.supplierId, suppliers]);

  function reset() { setF({ type: "BOARD", unit: "PCS" }); setEditId(null); setManualSku(false); }

  function handleType(type: "BOARD" | "HARDWARE") {
    setF({ type, unit: type === "BOARD" ? "PCS" : undefined, thicknessMm: undefined, edgingSize: undefined });
  }

  function unitForCategory(category?: string) {
    if (category === "EDGING") return "FEET";
    if (category === "LOOSE VENEER") return "FEET";
    return "PCS";
  }

  function handleCategory(category: string) {
    setF((prev) => ({
      ...prev, category: category || undefined, thicknessMm: undefined, edgingSize: undefined,
      color: undefined,
      unit: prev.type === "BOARD" ? unitForCategory(category) : prev.unit,
    }));
  }

  async function save() {
    setMsg(null);
    const isBoard = f.type === "BOARD";
    const isEdging = isBoard && f.category === "EDGING";
    const missing: string[] = [];
    if (!f.name)                        missing.push(t("Name"));
    if (!f.nameBn)                      missing.push(t("Name (Bangla)"));
    if (isEdging && !f.edgingSize)      missing.push(t("Thickness"));
    if (isBoard && !isEdging && !f.thicknessMm) missing.push(t("Thickness"));
    if (isBoard && !f.category)         missing.push(t("Category"));
    if (isBoard && !f.supplierId)       missing.push(t("Supplier"));
    if (!f.unit)                        missing.push(t("Unit"));
    if (!f.priceLower)                  missing.push(t("Price (low)"));
    if (!f.priceUpper)                  missing.push(t("Price (high)"));
    if (missing.length) { setMsg({ kind: "err", text: `${t("Required")}: ${missing.join(", ")}` }); return; }
    const body = {
      ...f,
      thicknessMm: isBoard && !isEdging ? f.thicknessMm : undefined,
      edgingSize: isEdging ? f.edgingSize : undefined,
    };
    try {
      if (editId) await endpoints.updateProduct(editId, body);
      else        await endpoints.saveProduct(body);
      setMsg({ kind: "ok", text: t("Saved.") }); reset(); load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  async function remove(id: string) {
    if (!confirm(t("Confirm delete?"))) return;
    setMsg(null);
    try { await endpoints.deleteProduct(id); setMsg({ kind: "ok", text: t("Deleted.") }); load(); }
    catch (e: any) { setMsg({ kind: "err", text: e.message }); }
  }

  function edit(p: Product) { setF(p); setEditId(p.id); setManualSku(false); window.scrollTo({ top: 0, behavior: "smooth" }); }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((p) =>
      [p.sku, p.name, p.nameBn, p.category].filter(Boolean).some((v) => v!.toLowerCase().includes(s)));
  }, [q, rows]);

  const isBoard = f.type === "BOARD";
  const sideApplicable = !!(f.category && SIDE_APPLICABLE_THICKNESSES[f.category]?.includes(f.thicknessMm as number));

  useEffect(() => {
    if (!sideApplicable && f.side) setF((prev) => ({ ...prev, side: undefined }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideApplicable]);

  return (
    <div>
      <h1 className="page-title mb-5">{t("Products")}</h1>

      <div className="card p-5 mb-6">
        {isBoard ? (
          <div className="form-grid cols-3">
            {/* row 1 */}
            <div className="field"><label>{t("Type")} <R /></label>
              <select className="inp" value={f.type} onChange={(e) => handleType(e.target.value as "BOARD" | "HARDWARE")}>
                <option value="BOARD">{t("Board")}</option>
                <option value="HARDWARE">{t("Hardware")}</option>
              </select></div>
            <div className="field"><label>{t("Category")} <R /></label>
              <select className="inp" value={f.category ?? ""} onChange={(e) => handleCategory(e.target.value)}>
                <option value="">— {t("Select")} —</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            {f.category === "EDGING" ? (
              <div className="field"><label>{t("Thickness")} <R /></label>
                <select className="inp" value={f.edgingSize ?? ""} onChange={(e) => setF({ ...f, edgingSize: e.target.value || undefined })}>
                  <option value="">— {t("Select")} —</option>
                  {EDGING_SIZES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select></div>
            ) : f.category === "LOOSE VENEER" ? (
              <div className="field"><label>{t("Thickness")} <R /></label>
                <div className="flex items-center gap-2">
                  <select className="inp flex-1" value={f.thicknessMm ?? ""} onChange={(e) => setF({ ...f, thicknessMm: e.target.value ? Number(e.target.value) : undefined })}>
                    <option value="">— {t("Select")} —</option>
                    {VENEER_THICKNESSES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <span className="text-sm font-semibold muted">INCH</span>
                </div></div>
            ) : (
              <div className="field"><label>{t("Thickness")} <R /></label>
                <div className="flex items-center gap-2">
                  <select className="inp flex-1" value={f.thicknessMm ?? ""} onChange={(e) => setF({ ...f, thicknessMm: e.target.value ? Number(e.target.value) : undefined })}>
                    <option value="">— {t("Select")} —</option>
                    {thicknessOptionsFor(f.category).map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <span className="text-sm font-semibold muted">MM</span>
                </div></div>
            )}
            {/* row 2 */}
            <div className="field"><label>{t("Name")} <R /></label>
              <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label>{t("Name (Bangla)")} <R /></label>
              <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
            <div className="field"><label>{t("Color")}</label>
              <select className="inp" value={f.color ?? ""} onChange={(e) => setF({ ...f, color: e.target.value || undefined })}>
                <option value="">— {t("Select")} —</option>
                {colorOptionsFor(f.category).map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            {sideApplicable && (
              <div className="field"><label>{t("One Side/Both Side")}</label>
                <select className="inp" value={f.side ?? ""} onChange={(e) => setF({ ...f, side: e.target.value || undefined })}>
                  <option value="">— {t("Select")} —</option>
                  {SIDES.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.label})</option>)}
                </select></div>
            )}
            {/* row 3 */}
            <div className="field"><label>{t("Unit")}</label>
              <input className="inp" value={f.unit ?? unitForCategory(f.category)} disabled /></div>
            <div className="field"><label>{t("Supplier")} <R /></label>
              <select className="inp" value={f.supplierId ?? ""} onChange={(e) => setF({ ...f, supplierId: e.target.value || undefined })}>
                <option value="">— {t("Select")} —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="field"><label>{t("Price")} ({t("low")}) <R /></label>
              <input className="inp num" type="number" value={f.priceLower ?? ""}
                onChange={(e) => setF({ ...f, priceLower: e.target.value ? Number(e.target.value) : undefined })} /></div>
            {/* row 4 */}
            <div className="field"><label>{t("Price")} ({t("high")}) <R /></label>
              <input className="inp num" type="number" value={f.priceUpper ?? ""}
                onChange={(e) => setF({ ...f, priceUpper: e.target.value ? Number(e.target.value) : undefined })} /></div>
            <div className="field"><label>{t("Code")} (auto)</label>
              <input className="inp font-mono" value={f.sku ?? ""}
                onChange={(e) => { setManualSku(true); setF((prev) => ({ ...prev, sku: e.target.value })); }} /></div>
            <div className="field"><label>{t("Full Name")} (auto)</label>
              <input className="inp" value={f.fullName ?? ""}
                onChange={(e) => setF((prev) => ({ ...prev, fullName: e.target.value || undefined }))} /></div>
          </div>
        ) : (
          <div className="form-grid cols-3">
            {/* row 1 */}
            <div className="field"><label>{t("Type")} <R /></label>
              <select className="inp" value={f.type} onChange={(e) => handleType(e.target.value as "BOARD" | "HARDWARE")}>
                <option value="BOARD">{t("Board")}</option>
                <option value="HARDWARE">{t("Hardware")}</option>
              </select></div>
            <div className="field"><label>{t("Category")}</label>
              <select className="inp" value={f.category ?? ""} onChange={(e) => handleCategory(e.target.value)}>
                <option value="">— {t("Select")} —</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div className="field"><label>{t("Name")} <R /></label>
              <input className="inp" value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            {/* row 2 */}
            <div className="field"><label>{t("Name (Bangla)")} <R /></label>
              <input className="inp" value={f.nameBn ?? ""} onChange={(e) => setF({ ...f, nameBn: e.target.value })} /></div>
            <div className="field"><label>{t("Supplier")}</label>
              <select className="inp" value={f.supplierId ?? ""} onChange={(e) => setF({ ...f, supplierId: e.target.value || undefined })}>
                <option value="">— {t("None")} —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div className="field"><label>{t("Unit")} <R /></label>
              <select className="inp" value={f.unit ?? ""} onChange={(e) => setF({ ...f, unit: e.target.value || undefined })}>
                <option value="">— {t("Select")} —</option>
                {HW_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select></div>
            <div className="field"><label>{t("Price")} ({t("low")}) <R /></label>
              <input className="inp num" type="number" value={f.priceLower ?? ""}
                onChange={(e) => setF({ ...f, priceLower: e.target.value ? Number(e.target.value) : undefined })} /></div>
            {/* row 3 */}
            <div className="field"><label>{t("Price")} ({t("high")}) <R /></label>
              <input className="inp num" type="number" value={f.priceUpper ?? ""}
                onChange={(e) => setF({ ...f, priceUpper: e.target.value ? Number(e.target.value) : undefined })} /></div>
            <div className="field"><label>{t("Code")} (auto)</label>
              <input className="inp font-mono" value={f.sku ?? ""}
                onChange={(e) => { setManualSku(true); setF((prev) => ({ ...prev, sku: e.target.value })); }} /></div>
            <div className="field"><label>{t("Full Name")} (auto)</label>
              <input className="inp" value={f.fullName ?? ""}
                onChange={(e) => setF((prev) => ({ ...prev, fullName: e.target.value || undefined }))} /></div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button className="btn" onClick={save}>{editId ? t("Update") : t("Add")}</button>
          {editId && <button className="btn-ghost" onClick={reset}>{t("Cancel")}</button>}
          {msg && <span className="text-sm ml-1" style={{ color: msg.kind === "ok" ? "#2f6f5e" : "#b3261e" }}>{msg.text}</span>}
        </div>
      </div>

      <div className="mb-3" style={{ maxWidth: 320 }}>
        <input className="inp" placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card table-wrap">
        <table className="tbl">
          <thead><tr>
            <th>{t("Name")}</th><th>{t("Full Name")}</th><th>{t("Type")}</th>
            <th>{t("Category")}</th><th>{t("Color")}</th><th>{t("Side")}</th><th>{t("Supplier")}</th>
            <th className="text-right">{t("Thickness")}</th>
            <th>{t("Unit")}</th>
            <th className="text-right">{t("Price band")}</th>
            <th className="text-right">{t("Actions")}</th>
          </tr></thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td><div className="font-medium">{dn(p)}</div>
                  {p.sku && <div className="font-mono text-[11px] muted">{p.sku}</div>}</td>
                <td className="text-sm">{p.fullName ?? "—"}</td>
                <td className="text-xs">{p.type === "BOARD" ? t("Board") : t("Hardware")}</td>
                <td className="muted text-sm">{p.category ?? "—"}</td>
                <td className="muted text-sm">{p.color ?? "—"}</td>
                <td className="muted text-sm">{p.side ?? "—"}</td>
                <td className="muted text-sm">{suppliers.find((s) => s.id === p.supplierId)?.name ?? "—"}</td>
                <td className="num">{p.edgingSize ?? p.thicknessMm ?? "—"}</td>
                <td className="text-sm muted">{p.unit ?? "—"}</td>
                <td className="num">{p.priceLower ?? "—"}–{p.priceUpper ?? "—"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn-icon btn-icon-edit mr-1" title="Edit" onClick={() => edit(p)}><EditIcon /></button>
                  <button className="btn-icon btn-icon-del" title="Delete" onClick={() => remove(p.id)}><TrashIcon /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
