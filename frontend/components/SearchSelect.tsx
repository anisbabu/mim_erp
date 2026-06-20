"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type Option = { value: string; label: string; sublabel?: string };

// Searchable dropdown ("select to search"). Keyboard + click, filters as you type.
// Dropdown is portalled to document.body so it is never clipped by overflow:auto parents.
export default function SearchSelect({
  options, value, onChange, placeholder = "Search…", disabled, className,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(s) || (o.sublabel ?? "").toLowerCase().includes(s)
    );
  }, [q, options]);

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

  function pick(v: string) { onChange(v); setOpen(false); setQ(""); }

  return (
    <div className={`relative ${className ?? ""}`} ref={boxRef}>
      <button type="button" disabled={disabled} onClick={toggle}
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
                if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); if (filtered[hi]) pick(filtered[hi].value); }
                else if (e.key === "Escape") { setOpen(false); setQ(""); }
              }} />
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {filtered.length === 0 && <div className="px-3 py-2 text-sm muted">No matches</div>}
            {filtered.map((o, i) => (
              <button key={o.value} type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  i === hi ? "bg-brand-soft" : o.value === value ? "bg-slate-50" : "bg-white"
                }`}>
                <div className="truncate">{o.label}</div>
                {o.sublabel && <div className="text-[12px] muted truncate">{o.sublabel}</div>}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}