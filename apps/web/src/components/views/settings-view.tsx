"use client";

import { CheckCircle2, Circle, Database, LogOut, MessageCircle, Server, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { API_URL, useHealth } from "@/lib/api";
import { cn } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { Avatar, Button, Card, PageHeader } from "../ui";

function StatusRow({ icon, title, detail, state }: { icon: ReactNode; title: string; detail: ReactNode; state: "ok" | "pending" | "error" | "off" }) {
  const label = { ok: "Connected", pending: "Checking…", error: "Unreachable", off: "Not connected" }[state];
  return (
    <div className="flex items-start gap-4 py-4 first:pt-0 last:pb-0">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <div className="mt-0.5 text-xs text-slate-500">{detail}</div>
      </div>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
          state === "ok" && "bg-emerald-50 text-emerald-700",
          state === "pending" && "bg-slate-100 text-slate-600",
          state === "error" && "bg-red-50 text-red-700",
          state === "off" && "bg-amber-50 text-amber-800",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            state === "ok" && "bg-emerald-500",
            state === "pending" && "bg-slate-400",
            state === "error" && "bg-red-500",
            state === "off" && "bg-amber-500",
          )}
          aria-hidden
        />
        {label}
      </span>
    </div>
  );
}

const WHATSAPP_STEPS = [
  "Meta Business account verified",
  "WhatsApp Business phone number registered",
  "Access token and phone number ID added to the API",
  "Webhook URL verified with Meta",
  "Message templates approved",
];

export function SettingsView() {
  const health = useHealth();
  const { identity, signOut } = useIdentity();
  const apiState = health.isError ? "error" : health.data ? "ok" : "pending";
  const dbState = health.isError ? "error" : !health.data ? "pending" : health.data.database === "error" ? "error" : "ok";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Settings" description="System status and workspace preferences." />

      <Card title="System status">
        <div className="divide-y divide-slate-100">
          <StatusRow
            icon={<Server size={18} />}
            title="CaseDesk API"
            detail={
              <>
                <span className="font-mono">{API_URL}</span>
                {health.data && ` · last checked ${new Date(health.data.timestamp).toLocaleTimeString()}`}
              </>
            }
            state={apiState}
          />
          <StatusRow icon={<Database size={18} />} title="Database" detail="PostgreSQL · tickets, messages and audit log" state={dbState} />
          <StatusRow
            icon={<MessageCircle size={18} />}
            title="WhatsApp Cloud API"
            detail={health.data?.mode === "simulation" ? "Not connected. Replies are recorded but not delivered, and no messages come in." : "Live delivery configured."}
            state={health.data?.mode === "simulation" ? "off" : health.data ? "ok" : "pending"}
          />
        </div>
      </Card>

      <Card title="WhatsApp go-live checklist" className="mt-6">
        <ol className="space-y-3">
          {WHATSAPP_STEPS.map((step) => (
            <li key={step} className="flex items-center gap-3 text-sm text-slate-700">
              {health.data?.mode === "simulation" ? <Circle size={16} className="text-slate-300" aria-hidden /> : <CheckCircle2 size={16} className="text-emerald-600" aria-hidden />}
              {step}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Your account" className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar name={identity.name} size={34} />
          <span className="flex-1">
            <span className="block text-sm font-medium text-slate-900">{identity.name}</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck size={13} className="text-emerald-600" aria-hidden />
              {identity.email} · {identity.title} · signed in with Keycloak
            </span>
          </span>
          <Button onClick={() => signOut()}>
            <LogOut size={14} aria-hidden />
            Sign out
          </Button>
        </div>
        <p className="mt-4 text-xs font-medium text-slate-500">What you can do</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {identity.permissions.map((permission) => (
            <li key={permission} className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700">
              {permission}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">To change your password or authenticator, sign out and use the sign-in page, or ask an administrator to reset it.</p>
      </Card>
    </div>
  );
}
