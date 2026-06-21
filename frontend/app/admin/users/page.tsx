"use client";

import { useEffect, useState } from "react";
import { endpoints, type UserView, type Shop, type Role } from "@/lib/api";

export default function UsersPage() {
  const [users, setUsers] = useState<UserView[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);

  // create form
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Role>("SALESPERSON");
  const [shopIds, setShopIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // edit state
  const [editUser, setEditUser] = useState<UserView | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editFullName, setEditFullName] = useState("");
  const [editRole, setEditRole] = useState<Role>("SALESPERSON");
  const [editShopIds, setEditShopIds] = useState<string[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [editMsg, setEditMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const load = () => endpoints.users().then(setUsers).catch(() => {});
  useEffect(() => {
    load();
    endpoints.shops()
      .then((s) => setShops([...s].sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""))))
      .catch(() => {});
  }, []);

  const bindsShops = role === "SALESPERSON" || role === "MANAGER";
  const single = role === "SALESPERSON";
  const editBindsShops = editRole === "SALESPERSON" || editRole === "MANAGER";
  const editSingle = editRole === "SALESPERSON";

  function toggleShop(id: string) {
    if (single) { setShopIds([id]); return; }
    setShopIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleEditShop(id: string) {
    if (editSingle) { setEditShopIds([id]); return; }
    setEditShopIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function openEdit(u: UserView) {
    setEditUser(u);
    setEditUsername(u.username);
    setEditPassword("");
    setEditFullName(u.fullName ?? "");
    setEditRole(u.role);
    setEditShopIds([...u.shopIds]);
    setEditActive(u.active);
    setEditMsg(null);
  }

  function cancelEdit() {
    setEditUser(null);
    setEditMsg(null);
  }

  async function submit() {
    setMsg(null);
    if (!username.trim() || password.length < 6) {
      setMsg({ kind: "err", text: "Username required and password at least 6 characters." }); return;
    }
    if (role === "SALESPERSON" && shopIds.length !== 1) {
      setMsg({ kind: "err", text: "A salesperson needs exactly one shop." }); return;
    }
    if (role === "MANAGER" && shopIds.length === 0) {
      setMsg({ kind: "err", text: "A manager needs at least one shop." }); return;
    }
    setBusy(true);
    try {
      await endpoints.createUser({
        username: username.trim(), password, fullName, role,
        shopIds: bindsShops ? shopIds : [],
      });
      setMsg({ kind: "ok", text: `User ${username} created.` });
      setUsername(""); setPassword(""); setFullName(""); setShopIds([]);
      load();
    } catch (e: any) { setMsg({ kind: "err", text: e.message }); } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!editUser) return;
    setEditMsg(null);
    if (editRole === "SALESPERSON" && editShopIds.length !== 1) {
      setEditMsg({ kind: "err", text: "A salesperson needs exactly one shop." }); return;
    }
    if (editRole === "MANAGER" && editShopIds.length === 0) {
      setEditMsg({ kind: "err", text: "A manager needs at least one shop." }); return;
    }
    setEditBusy(true);
    try {
      await endpoints.updateUser(editUser.id, {
        username: editUsername.trim() || undefined,
        password: editPassword || undefined,
        fullName: editFullName,
        role: editRole,
        shopIds: editBindsShops ? editShopIds : [],
        active: editActive,
      });
      setEditMsg({ kind: "ok", text: "Saved." });
      load();
      setTimeout(() => { setEditUser(null); setEditMsg(null); }, 800);
    } catch (e: any) { setEditMsg({ kind: "err", text: e.message }); } finally { setEditBusy(false); }
  }

  const shopName = (id: string) => shops.find((s) => s.id === id)?.name ?? id;

  return (
    <div>
      <h1 className="text-2xl font-medium mb-1">Users</h1>
      <p className="text-sm text-[#6b6960] mb-6">
        Create accounts and bind them to shops. A salesperson is locked to one shop; managers can cover several;
        admins and accountants work company-wide.
      </p>

      {/* create form */}
      <div className="border border-line rounded-xl bg-white p-4 mb-6">
        <p className="text-xs font-medium text-[#6b6960] uppercase tracking-wide mb-3">New user</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#6b6960]">Username</label>
            <input className="inp mt-1" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#6b6960]">Full name</label>
            <input className="inp mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#6b6960]">Password</label>
            <input className="inp mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#6b6960]">Role</label>
            <select className="inp mt-1" value={role}
              onChange={(e) => { setRole(e.target.value as Role); setShopIds([]); }}>
              <option value="SALESPERSON">Salesperson</option>
              <option value="MANAGER">Manager</option>
              <option value="ACCOUNTANT">Accountant</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
        </div>

        {bindsShops && (
          <div className="mt-4">
            <label className="text-xs text-[#6b6960]">
              {single ? "Assigned shop (pick one)" : "Assigned shops (pick one or more)"}
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {shops.map((s) => {
                const on = shopIds.includes(s.id);
                return (
                  <button key={s.id} onClick={() => toggleShop(s.id)} type="button"
                    className="px-3 py-1.5 rounded-lg text-sm border"
                    style={{ background: on ? "#1d5e4f" : "#fff", color: on ? "#fff" : "#1c1b19",
                             borderColor: on ? "#1d5e4f" : "#d8d4ca" }}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {!bindsShops && (
          <div className="mt-3 text-[12px] text-[#6b6960]">
            {role === "ADMIN" ? "Admins" : "Accountants"} have company-wide access — no shop binding.
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button className="btn" onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create user"}</button>
          {msg && (
            <span className="text-sm" style={{ color: msg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>{msg.text}</span>
          )}
        </div>
      </div>

      {/* edit panel */}
      {editUser && (
        <div className="border border-brand rounded-xl bg-white p-4 mb-6">
          <p className="text-xs font-medium text-[#6b6960] uppercase tracking-wide mb-3">
            Editing <span className="font-mono text-[#1c1b19]">{editUser.username}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#6b6960]">Username</label>
              <input className="inp mt-1 font-mono" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[#6b6960]">Full name</label>
              <input className="inp mt-1" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-[#6b6960]">New password <span className="text-[#aaa]">(leave blank to keep)</span></label>
              <input className="inp mt-1" type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="••••••" />
            </div>
            <div>
              <label className="text-xs text-[#6b6960]">Role</label>
              <select className="inp mt-1" value={editRole}
                onChange={(e) => { setEditRole(e.target.value as Role); setEditShopIds([]); }}>
                <option value="SALESPERSON">Salesperson</option>
                <option value="MANAGER">Manager</option>
                <option value="ACCOUNTANT">Accountant</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="flex items-center gap-2 pt-4">
              <input id="editActive" type="checkbox" checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)} className="w-4 h-4" />
              <label htmlFor="editActive" className="text-sm">Active</label>
            </div>
          </div>

          {editBindsShops && (
            <div className="mt-4">
              <label className="text-xs text-[#6b6960]">
                {editSingle ? "Assigned shop (pick one)" : "Assigned shops (pick one or more)"}
              </label>
              <div className="flex flex-wrap gap-2 mt-2">
                {shops.map((s) => {
                  const on = editShopIds.includes(s.id);
                  return (
                    <button key={s.id} onClick={() => toggleEditShop(s.id)} type="button"
                      className="px-3 py-1.5 rounded-lg text-sm border"
                      style={{ background: on ? "#1d5e4f" : "#fff", color: on ? "#fff" : "#1c1b19",
                               borderColor: on ? "#1d5e4f" : "#d8d4ca" }}>
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!editBindsShops && (
            <div className="mt-3 text-[12px] text-[#6b6960]">
              {editRole === "ADMIN" ? "Admins" : "Accountants"} have company-wide access — no shop binding.
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button className="btn" onClick={saveEdit} disabled={editBusy}>{editBusy ? "Saving…" : "Save"}</button>
            <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
            {editMsg && (
              <span className="text-sm" style={{ color: editMsg.kind === "ok" ? "#1d5e4f" : "#9a2b22" }}>{editMsg.text}</span>
            )}
          </div>
        </div>
      )}

      {/* user list */}
      <div className="border border-line rounded-xl bg-white overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Shops</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={editUser?.id === u.id ? "bg-teal-50" : ""}>
                <td className="font-mono text-[13px]">{u.username}</td>
                <td>{u.fullName ?? "—"}</td>
                <td className="text-xs">{u.role}</td>
                <td className="text-[13px]">
                  {u.shopIds.length === 0
                    ? <span className="text-[#6b6960]">company-wide</span>
                    : u.shopIds.map(shopName).join(", ")}
                </td>
                <td>
                  <span className={u.active ? "text-[#1d5e4f]" : "text-[#9a2b22]"}>
                    {u.active ? "active" : "disabled"}
                  </span>
                </td>
                <td>
                  <button className="btn-ghost text-xs py-1 px-2" onClick={() => openEdit(u)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}