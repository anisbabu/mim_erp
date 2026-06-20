"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { endpoints, setToken, loadToken, type Me } from "@/lib/api";

type AuthState = {
  user: Me | null;
  ready: boolean;
  activeShopId: string | null;
  setActiveShopId: (id: string) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthCtx = createContext<AuthState | null>(null);

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [activeShopId, setActiveShopId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // default the active shop to the user's first assigned shop
  function applyUser(m: Me | null) {
    setUser(m);
    setActiveShopId(m && m.shopIds.length > 0 ? m.shopIds[0] : null);
  }

  // on mount, if we have a stored token, fetch the profile
  useEffect(() => {
    const t = loadToken();
    if (!t) { setReady(true); return; }
    endpoints.me()
      .then((m) => applyUser(m))
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  // gate: bounce unauthenticated users to /login (except the login page itself)
  useEffect(() => {
    if (!ready) return;
    if (!user && pathname !== "/login") router.replace("/login");
    if (user && pathname === "/login") router.replace("/");
  }, [ready, user, pathname, router]);

  async function login(username: string, password: string) {
    const m = await endpoints.login(username, password);
    if (m.token) setToken(m.token);
    applyUser(m);
    router.replace("/");
  }

  function logout() {
    setToken(null);
    applyUser(null);
    router.replace("/login");
  }

  return (
    <AuthCtx.Provider value={{ user, ready, activeShopId, setActiveShopId, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}
