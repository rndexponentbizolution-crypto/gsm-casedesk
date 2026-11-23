"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { LogOut, ShieldAlert } from "lucide-react";
import { AUTH_MODE, configureSession, startKeycloak } from "./session";

export type Role = "BACK_OFFICE" | "SUPERVISOR" | "ADMINISTRATOR";
export type Identity = { id: string; name: string; role: Role; title: string };

const TITLES: Record<Role, string> = { BACK_OFFICE: "Back office", SUPERVISOR: "Supervisor", ADMINISTRATOR: "Administrator" };

// Demo personas (AUTH_MODE=demo only). They match the seeded users.
export const IDENTITIES: Identity[] = [
  { id: "demo-supervisor", name: "Chanda Mwansa", role: "SUPERVISOR", title: "Supervisor" },
  { id: "demo-agent-1", name: "Martha Banda", role: "BACK_OFFICE", title: "Back office" },
  { id: "demo-agent-2", name: "Peter Mulenga", role: "BACK_OFFICE", title: "Back office" },
];

type IdentityContextValue = {
  identity: Identity;
  isSupervisor: boolean;
  mode: "keycloak" | "demo";
  /** Demo mode only: act as another persona. */
  setIdentity?: (id: string) => void;
  /** Keycloak mode only: end the Keycloak session. */
  signOut?: () => void;
};

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  return AUTH_MODE === "demo" ? <DemoIdentityProvider>{children}</DemoIdentityProvider> : <KeycloakIdentityProvider>{children}</KeycloakIdentityProvider>;
}

export function useIdentity() {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside IdentityProvider");
  return value;
}

// ---------- Keycloak ----------

type SignInState =
  | { kind: "loading" }
  | { kind: "ready"; identity: Identity; signOut: () => void }
  | { kind: "no-account"; signOut: () => void }
  | { kind: "error"; message: string };

function KeycloakIdentityProvider({ children }: { children: ReactNode }) {
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
        const me = await apiFetch<{ id: string; name: string; role: Role }>("/api/me");
        if (!cancelled) setState({ kind: "ready", identity: { ...me, title: TITLES[me.role] ?? me.role }, signOut });
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

  const value = useMemo<IdentityContextValue | null>(
    () =>
      state.kind === "ready"
        ? { identity: state.identity, isSupervisor: state.identity.role !== "BACK_OFFICE", mode: "keycloak", signOut: state.signOut }
        : null,
    [state],
  );

  if (state.kind === "loading") return <SignInScreen title="Signing you in…" />;
  if (state.kind === "no-account")
    return (
      <SignInScreen
        icon={<ShieldAlert size={22} className="text-amber-600" aria-hidden />}
        title="No CaseDesk account"
        body="You signed in successfully, but your account isn't set up in CaseDesk yet, or it has been deactivated. Ask a supervisor or administrator to add you."
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

// ---------- Demo ----------

const STORAGE_KEY = "casedesk.identity";
const listeners = new Set<() => void>();

function readStored(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? IDENTITIES[0].id;
  } catch {
    return IDENTITIES[0].id;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => event.key === STORAGE_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

if (AUTH_MODE === "demo") configureSession(async () => ({ "x-demo-user": readStored() }), null);

function DemoIdentityProvider({ children }: { children: ReactNode }) {
  const id = useSyncExternalStore(subscribe, readStored, () => IDENTITIES[0].id);
  const identity = IDENTITIES.find((item) => item.id === id) ?? IDENTITIES[0];

  const setIdentity = useCallback((next: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: identity resets on reload */
    }
    listeners.forEach((listener) => listener());
  }, []);

  const value = useMemo<IdentityContextValue>(
    () => ({ identity, setIdentity, isSupervisor: identity.role !== "BACK_OFFICE", mode: "demo" }),
    [identity, setIdentity],
  );
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}
