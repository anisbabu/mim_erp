import type { Product, Supplier } from "@/lib/api";

// Hidden search text for a product option in SearchSelect: lets users type
// "18 ahmed ply" or "18 ply gray" and match on thickness, colour, group or supplier.
export function productKeywords(p: Product, s?: Supplier): string {
  return [
    p.name, p.nameBn, p.fullName, p.sku,
    p.thicknessMm != null ? `${p.thicknessMm}mm` : "", p.thicknessLabel,
    p.color, p.category, p.productGroup, p.supplierTag, p.edgingSize, p.side,
    s?.name, s?.nameBn, s?.code,
  ].filter(Boolean).join(" ");
}
