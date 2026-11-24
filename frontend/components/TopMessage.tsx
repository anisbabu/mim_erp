"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/** step = from useStepCheck: that hook hides it when its own field is filled, so typing elsewhere keeps it. */
export type Msg = { kind: "ok" | "err"; text: string; step?: boolean } | null | undefined;

/**
 * The message of a form (saved / not saved and why), shown as a coloured bar fixed at the top of the
 * screen, just under the navbar, so it is seen whatever the scroll position.
 * Errors go away when the user changes any field (types, ticks, picks), is closed, or is replaced;
 * a step-check error (msg.step) instead goes when its own field is filled. Success hides after 6 s.
 * Pass `msg` ({kind, text}, from state), `err` (error text) or `ok` (success text).
 * A new `msg` object always shows again, even with the same text as before (Save clicked twice).
 * `children` = extra actions (Print, Download…).
 */
export default function TopMessage({ msg, err, ok: okText, children }:
  { msg?: Msg; err?: string | null; ok?: string | null; children?: ReactNode }) {
  const { t } = useI18n();
  const m: Msg = msg ?? (err ? { kind: "err", text: err } : okText ? { kind: "ok", text: okText } : null);
  const [hidden, setHidden] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // a new message always shows again
  useEffect(() => {
    setHidden(false);
    if (m?.kind !== "ok") return;
    const id = setTimeout(() => setHidden(true), 6000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg ?? null, err, okText]);

  // the user edits the form -> an error has done its job; Save shows it again if still wrong
  useEffect(() => {
    if (!m || hidden || m.kind !== "err" || m.step) return;
    const onEdit = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest && el.closest(".top-msg")) return;
      setHidden(true);
    };
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    window.addEventListener("mim:edit", onEdit);
    return () => {
      document.removeEventListener("input", onEdit, true);
      document.removeEventListener("change", onEdit, true);
      window.removeEventListener("mim:edit", onEdit);
    };
  }, [m, hidden]);

  // Esc closes an error
  useEffect(() => {
    if (!m || hidden) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHidden(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m, hidden]);

  if (!m || !m.text || hidden || !mounted) return null;
  const ok = m.kind === "ok";
  return createPortal(
    <div className={`top-msg ${ok ? "is-ok" : "is-err"}`} role={ok ? "status" : "alert"} aria-live={ok ? "polite" : "assertive"}>
      {ok ? <CheckCircle2 size={20} className="shrink-0" /> : <AlertCircle size={20} className="shrink-0" />}
      <span className="flex-1 min-w-0">
        {m.text}
      </span>
      {children}
      <button type="button" className="top-msg-close" onClick={() => setHidden(true)} aria-label={t("Close")} title={t("Close")}>
        <X size={18} />
      </button>
    </div>,
    document.body,
  );
}
