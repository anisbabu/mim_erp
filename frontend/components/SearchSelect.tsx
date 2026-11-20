"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";

// keywords: extra hidden text to search on (e.g. supplier, colour, thickness) - not displayed
export type Option = { value: string; label: string; sublabel?: string; keywords?: string };

// lowercase words, split at punctuation and at letter/number boundaries: "P5126" -> p, 5126; "12mela" -> 12, mela.
// \p{M} keeps Bangla vowel signs inside their word.
// A lone "x" between two numbers is a size separator and is dropped: "4x25", "4 X 25", "4*25" -> 4, 25.
function searchTokens(s: string): string[] {
  const t = s.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).flatMap((x) => x.match(/\p{N}+|[\p{L}\p{M}]+/gu) ?? []);
  return t.filter((w, i) => !(w === "x" && isNum(t[i - 1]) && isNum(t[i + 1])));
}
const isNum = (w?: string) => !!w && /^\p{N}+$/u.test(w);

// true if word w is within one edit (insert/delete/replace) of the start of token tk
function nearPrefix(w: string, tk: string): boolean {
  for (const len of [w.length - 1, w.length, w.length + 1]) {
    if (len < 1 || len > tk.length) continue;
    if (editDistance(w, tk.slice(0, len)) <= 1) return true;
  }
  return false;
}
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Searchable dropdown ("select to search"). Keyboard + click, filters as you type.
// Dropdown is portalled to document.body so it is never clipped by overflow:auto parents.
// The list is virtualized: only the rows in view are in the DOM, so thousands of products open instantly.
export default function SearchSelect({
  options, value, onChange, placeholder: placeholderProp, disabled, className,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const placeholder = placeholderProp ?? t("Search…");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) || null, [options, value]);

  // split every option into search words once per options list, not on every keystroke
  const tokens = useMemo(
    () => options.map((o) => searchTokens(`${o.label} ${o.sublabel ?? ""} ${o.keywords ?? ""}`)),
    [options]);

  // typing updates the box at once; the (heavier) filtering follows a moment later
  const dq = useDeferredValue(q);

  const filtered = useMemo(() => {
    const words = searchTokens(dq);
    if (words.length === 0) return options;
    // every typed word must start some word of the option (label, sublabel or keywords), in any order:
    // "18 ahmed ply" / "12mela" / "12 mela" - numbers match whole-number starts, so "12" never hits SKU "P5126"
    // Ranked in tiers, list order kept within a tier:
    //   1 exact - numbers equal ("handle 12" -> 12MM before 128MM), words by start
    //   2 number prefix - "12" also finds 128 / 1200
    //   3 typo - one-letter slip in a 4+ letter word ("ahamed" finds "Ahmed"); never for numbers
    const exact: Option[] = [], numPrefix: Option[] = [], fuzzy: Option[] = [];
    options.forEach((o, i) => {
      const toks = tokens[i];
      const hit = (w: string) => toks.some((tk) => tk.startsWith(w));
      const hitExact = (w: string) => (isNum(w) ? toks.includes(w) : hit(w));
      if (words.every(hitExact)) exact.push(o);
      else if (words.every(hit)) numPrefix.push(o);
      else if (words.every((w) => hit(w) || (w.length >= 4 && !/\p{N}/u.test(w) && toks.some((tk) => nearPrefix(w, tk))))) fuzzy.push(o);
    });
    return [...exact, ...numPrefix, ...fuzzy];
  }, [dq, options, tokens]);

  const hic = Math.min(hi, Math.max(filtered.length - 1, 0));

  const virt = useVirtualizer({
    count: open ? filtered.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => (filtered[i]?.sublabel ? 44 : 36),
    overscan: 8,
  });

  // keep the highlighted row in view while arrowing through the list
  useEffect(() => {
    if (open && filtered.length) virt.scrollToIndex(hic, { align: "auto" });
  }, [hic, open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const inBox  = boxRef.current?.contains(e.target as Node);
      const inDrop = dropRef.current?.contains(e.target as Node);
      if (!inBox && !inDrop) { setOpen(false); setQ(""); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function toggle() {
    if (disabled) return;
    if (!open && boxRef.current) {
      const r = boxRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + window.scrollY + 4, left: r.left + window.scrollX, width: r.width });
    }
    setOpen((o) => !o);
  }

  // closing hands focus back to the field, so Tab carries on to the next field of the form
  function close() { setOpen(false); setQ(""); btnRef.current?.focus(); }
  function pick(v: string) { onChange(v); close(); }

  const row = (o: Option, i: number) => (
    <button type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)}
      className={`w-full text-left px-3 py-2 text-sm transition-colors ${
        i === hic ? "bg-brand-soft" : o.value === value ? "bg-slate-50" : "bg-white"
      }`}>
      <div className="truncate">{o.label}</div>
      {o.sublabel && <div className="text-[12px] muted truncate">{o.sublabel}</div>}
    </button>
  );

  return (
    <div className={`relative ${className ?? ""}`} ref={boxRef}>
      <button type="button" ref={btnRef} disabled={disabled} onClick={toggle}
        onKeyDown={(e) => {
          // start typing on the focused field to search straight away
          if (open || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === " ") return;
          e.preventDefault();
          setQ(e.key); setHi(0);
          toggle();
        }}
        className="inp text-left flex items-center justify-between" style={{ width: "100%" }}>
        <span className={selected ? "" : "text-[#8b929b]"}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="text-[#8b929b] ml-2">▾</span>
      </button>

      {open && pos && createPortal(
        <div ref={dropRef} className="card shadow-pop"
             style={{ position: "absolute", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}>
          <div className="p-2 border-b border-slate-200">
            <input autoFocus className="inp" placeholder={placeholder} value={q}
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setHi(Math.min(hic + 1, filtered.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHi(Math.max(hic - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); if (filtered[hic]) pick(filtered[hic].value); }
                else if (e.key === "Escape") close();
                // the list lives at the end of <body>: go back to the field first so Tab moves on from there
                else if (e.key === "Tab") close();
              }} />
          </div>
          <div ref={listRef} style={{ maxHeight: 240, overflowY: "auto" }}>
            {filtered.length === 0 && <div className="px-3 py-2 text-sm muted">{t("No matches")}</div>}
            <div style={{ height: virt.getTotalSize(), position: "relative" }}>
              {virt.getVirtualItems().map((v) => (
                <div key={filtered[v.index].value} data-index={v.index} ref={virt.measureElement}
                     style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}>
                  {row(filtered[v.index], v.index)}
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
