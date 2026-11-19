"use client";
import { useEffect, useRef, useState } from "react";
import { Calendar } from "lucide-react";

/**
 * Date field that always shows dd/mm/yyyy, whatever the browser locale
 * (a native <input type="date"> follows the browser language, e.g. mm/dd/yyyy).
 * Drop-in for the native input: `value` and `onChange(e.target.value)` stay ISO yyyy-mm-dd.
 * Type the date (slashes are added automatically) or pick it from the calendar button.
 */
type Props = {
  value?: string | null;
  onChange: (e: { target: { value: string } }) => void;
  className?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  id?: string;
  title?: string;
};

const toText = (iso?: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

/** "dd/mm/yyyy" (also d/m/yyyy, dd-mm-yyyy, dd.mm.yyyy) → ISO, or null if not a real date. */
function toIso(text: string): string | null {
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function DateInput({ value, onChange, className = "inp", min, max, disabled, ...rest }: Props) {
  const [text, setText] = useState(toText(value));
  const picker = useRef<HTMLInputElement>(null);

  // Follow the value when the parent changes it (reset, load, picker).
  useEffect(() => {
    setText((cur) => (toIso(cur) === (value || null) ? cur : toText(value)));
  }, [value]);

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  function typed(raw: string) {
    let v = raw.replace(/[^\d/.\-]/g, "").slice(0, 10);
    // Typing forward with digits only: add the slashes (16112026 → 16/11/2026).
    if (v.length > text.length && /^\d+$/.test(v)) {
      if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4, 8)}`;
      else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
    }
    setText(v);
    if (v === "") { if (value) onChange({ target: { value: "" } }); return; }
    const iso = toIso(v);
    if (iso && inRange(iso) && iso !== value) onChange({ target: { value: iso } });
  }

  function openPicker() {
    const el = picker.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); }
  }

  return (
    <span className="relative block w-full">
      <input
        {...rest}
        className={className}
        style={{ paddingRight: 26 }}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        autoComplete="off"
        disabled={disabled}
        value={text}
        onChange={(e) => typed(e.target.value)}
        onBlur={() => setText(toText(value))}
      />
      <button type="button" tabIndex={-1} disabled={disabled} aria-label="Calendar" onClick={openPicker}
        className="absolute right-1 bottom-0 flex h-full max-h-8 items-center disabled:opacity-40"
        style={{ color: "var(--muted)" }}>
        <Calendar size={14} />
      </button>
      {/* Hidden native input: only used for its calendar popup. */}
      <input ref={picker} type="date" tabIndex={-1} aria-hidden="true" min={min} max={max}
        value={value ?? ""} onChange={(e) => onChange({ target: { value: e.target.value } })}
        className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0" />
    </span>
  );
}
