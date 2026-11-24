"use client";

import type Keycloak from "keycloak-js";

/** Staff sign in through Keycloak; every API call carries a bearer token. There is no other way in. */
export const KEYCLOAK_CONFIG = {
  url: (process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080").replace(/\/+$/, ""),
  realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "gsm-casedesk",
  clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "gsm-casedesk-web",
};

type HeaderSource = () => Promise<Record<string, string>>;

let headerSource: HeaderSource = async () => ({});
let onUnauthorized: (() => void) | null = null;

/** Called by the identity provider once it knows how to authenticate requests. */
export function configureSession(source: HeaderSource, unauthorized: (() => void) | null) {
  headerSource = source;
  onUnauthorized = unauthorized;
}

export function authHeaders() {
  return headerSource();
}

export function handleUnauthorized() {
  onUnauthorized?.();
}

let keycloak: Promise<Keycloak> | null = null;

/**
 * Initialise Keycloak once per page load (React may mount providers twice in dev).
 * Redirects to the Keycloak login page when there is no session.
 */
export function startKeycloak(): Promise<Keycloak> {
  keycloak ??= (async () => {
    const { default: Keycloak } = await import("keycloak-js");
    const kc = new Keycloak(KEYCLOAK_CONFIG);
    kc.onTokenExpired = () => void kc.updateToken(30).catch(() => kc.login());
    await kc.init({ onLoad: "login-required", pkceMethod: "S256", checkLoginIframe: false });
    return kc;
  })();
  keycloak.catch(() => (keycloak = null));
  return keycloak;
}
