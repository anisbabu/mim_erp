"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

/** The first thing missing on a form: `key` names the field (e.g. "customer", "qty-2"), `text` the message. */
export type Problem = { key: string; text: string } | null;

/**
 * Step-by-step form check. The page works out `problem` live (the first missing field, in the
 * order of the form). On Save, `stop()` flags that field and returns true; the message shows in the
 * top bar and the field turns red (`bad(key)` -> "is-invalid"). As soon as the field gets its value,
 * the message disappears. The next missing field shows on the next Save.
 *
 *   const check = useStepCheck(problem);
 *   <TopMessage msg={check.msg ?? msg} />
 *   <div className={check.bad("customer")}>…</div>
 *   async function submit() { if (check.stop()) return; … }
 */
export function useStepCheck(problem: Problem) {
  const [flagged, setFlagged] = useState<string | null>(null);

  // the flagged field got its value (problem moved on or is gone) -> hide
  useEffect(() => { if (flagged && problem?.key !== flagged) setFlagged(null); }, [flagged, problem?.key]);

  const msg = useMemo(() => (flagged && problem ? { kind: "err" as const, text: problem.text, step: true } : null),
    [flagged, problem?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    if (!problem) return false;
    setFlagged(problem.key);
    return true;
  }, [problem]);

  const bad = useCallback((key: string) => (flagged === key ? "is-invalid" : ""), [flagged]);
  const reset = useCallback(() => setFlagged(null), []);
  return { msg, stop, bad, reset, flagged };
}
