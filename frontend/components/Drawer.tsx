"use client";

import { useEffect, type ReactNode } from "react";

/** Right-hand slide-over panel for entry forms. Esc or a click on the backdrop closes it. */
export default function Drawer({ open, title, subtitle, onClose, footer, children }: {
  open: boolean; title: string; subtitle?: string; onClose: () => void; footer?: ReactNode; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative h-full w-full max-w-[460px] flex flex-col shadow-2xl"
        style={{ background: "var(--surface)", color: "var(--text)", borderLeft: "1px solid var(--border)" }}>
        <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="text-base font-semibold">{title}</div>
            {subtitle && <div className="text-[12px] muted mt-0.5">{subtitle}</div>}
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 flex gap-2 justify-end" style={{ borderTop: "1px solid var(--border)" }}>{footer}</div>}
      </div>
    </div>
  );
}
