"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(null); setBusy(true);
    try { await login(username.trim(), password); }
    catch (e: any) { setErr(e.message || "Login failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ash">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="font-mono text-brand text-lg">MIM</div>
          <div className="text-xs muted">{t("Plywood & Hardware")}</div>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-medium mb-4">{t("Sign in")}</h1>
          <div className="space-y-3">
            <div className="field"><label>{t("Username")}</label>
              <input className="inp" value={username} autoFocus
                onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
            <div className="field"><label>{t("Password")}</label>
              <input className="inp" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
            <button className="btn w-full" onClick={submit} disabled={busy}>
              {busy ? "…" : t("Sign in")}
            </button>
            {err && <div className="text-sm" style={{ color: "#b3261e" }}>{err}</div>}
          </div>
        </div>
        <p className="text-[11px] text-[#8b929b] text-center mt-4">
          admin / admin123
        </p>
      </div>
    </div>
  );
}
