"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type Role = "BACK_OFFICE" | "SUPERVISOR" | "ADMINISTRATOR";
export type Identity = { id: string; name: string; role: Role; title: string };

// Demo identities until Keycloak sign-in is wired up. They match the seeded users.
export const IDENTITIES: Identity[] = [
  { id: "demo-supervisor", name: "Chanda Mwansa", role: "SUPERVISOR", title: "Supervisor" },
  { id: "demo-agent-1", name: "Martha Banda", role: "BACK_OFFICE", title: "Back office" },
  { id: "demo-agent-2", name: "Peter Mulenga", role: "BACK_OFFICE", title: "Back office" },
];

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

type IdentityContextValue = {
  identity: Identity;
  setIdentity: (id: string) => void;
  isSupervisor: boolean;
};

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo(
    () => ({ identity, setIdentity, isSupervisor: identity.role !== "BACK_OFFICE" }),
    [identity, setIdentity],
  );
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside IdentityProvider");
  return value;
}
