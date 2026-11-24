"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import { configureSession, startKeycloak } from "./session";

export type Role = "BACK_OFFICE" | "SUPERVISOR" | "ADMINISTRATOR";

/** Mirrors the API's permission keys (apps/api/src/permissions.ts). */
export type Permission =
  | "tickets.reply"
  | "tickets.view_all"
  | "tickets.reassign"
  | "reports.view"
  | "reports.export"
  | "operations.manage"
  | "field_agents.manage"
  | "audit.verify"
  | "staff.manage";

export type Identity = { id: string; name: string; email: string; role: Role; title: string; permissions: Permission[] };

export const ROLE_TITLE: Record<Role, string> = { BACK_OFFICE: "Back office", SUPERVISOR: "Supervisor", ADMINISTRATOR: "Administrator" };

type IdentityContextValue = {
  identity: Identity;
  /** True when the signed-in person holds the permission. The API enforces the same rules. */
  can: (permission: Permission) => boolean;
  /** Sees the whole desk, not only their own tickets. */
  isSupervisor: boolean;
  signOut: () => void;
};

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function useIdentity() {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside IdentityProvider");
  return value;
}

type SignInState =
  | { kind: "loading" }
  | { kind: "ready"; identity: Identity; signOut: () => void }
  | { kind: "no-account"; signOut: () => void }
  | { kind: "error"; message: string };

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SignInState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kc = await startKeycloak();
      const signOut = () => void kc.logout({ redirectUri: window.location.origin });
      configureSession(
        async (): Promise<Record<string, string>> => {
          await kc.updateToken(30).catch(() => kc.login());
          return kc.token ? { Authorization: `Bearer ${kc.token}` } : {};
        },
        () => void kc.login(),
      );
      // Imported here to avoid a module cycle (api.ts reads the identity context).
      const { apiFetch, ApiError } = await import("./api");
      try {
        const me = await apiFetch<Omit<Identity, "title">>("/api/me");
        if (!cancelled) setState({ kind: "ready", identity: { ...me, title: ROLE_TITLE[me.role] ?? me.role }, signOut });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setState({ kind: "no-account", signOut });
        else setState({ kind: "error", message: error instanceof Error ? error.message : "Sign-in failed." });
      }
    })().catch(() => {
      if (!cancelled) setState({ kind: "error", message: "Cannot reach the sign-in service. Check your connection and try again." });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<IdentityContextValue | null>(() => {
    if (state.kind !== "ready") return null;
    const granted = new Set(state.identity.permissions);
    const can = (permission: Permission) => granted.has(permission);
    return { identity: state.identity, can, isSupervisor: can("tickets.view_all"), signOut: state.signOut };
  }, [state]);

  if (state.kind === "loading") return <SignInScreen title="Signing you in…" />;
  if (state.kind === "no-account")
    return (
      <SignInScreen
        icon={<ShieldAlert size={22} className="text-amber-600" aria-hidden />}
        title="No CaseDesk account"
        body="You signed in successfully, but your account isn't set up in CaseDesk yet, or it has been deactivated. Ask an administrator."
        action={{ label: "Sign out", onClick: state.signOut }}
      />
    );
  if (state.kind === "error")
    return <SignInScreen icon={<ShieldAlert size={22} className="text-red-600" aria-hidden />} title="Couldn't sign you in" body={state.message} action={{ label: "Try again", onClick: () => window.location.reload() }} />;
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

function SignInScreen({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm" role={body ? "alert" : "status"}>
        {icon ?? <span className="mx-auto block h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-amber-500" aria-hidden />}
        <h1 className="mt-3 text-base font-semibold text-slate-900">{title}</h1>
        {body && <p className="mt-2 text-sm text-slate-500">{body}</p>}
        {action && (
          <button onClick={action.onClick} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {action.label === "Sign out" && <LogOut size={14} aria-hidden />}
            {action.label}
          </button>
        )}
      </div>
    </main>
  );
}
