"use client";

import { CheckCircle2, Circle, Database, MessageCircle, Server, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { API_URL, useHealth } from "@/lib/api";
import { cn } from "@/lib/format";
import { IDENTITIES, useIdentity } from "@/lib/identity";
import { Avatar, Card, PageHeader } from "../ui";

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
  const { identity, setIdentity } = useIdentity();
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
          <StatusRow icon={<Database size={18} />} title="Database" detail="PostgreSQL on Supabase · tickets, messages and audit log" state={dbState} />
          <StatusRow
            icon={<MessageCircle size={18} />}
            title="WhatsApp Cloud API"
            detail={health.data?.mode === "simulation" ? "Running in simulation mode. Messages are stored but not delivered to real phones." : "Live delivery configured."}
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

      <Card title="Demo identity" className="mt-6">
        <p className="mb-4 flex items-start gap-2 text-sm text-slate-500">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
          Until Keycloak sign-in is connected, choose who you&apos;re acting as. Permissions in the API follow this choice.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {IDENTITIES.map((item) => (
            <button
              key={item.id}
              onClick={() => setIdentity(item.id)}
              aria-pressed={item.id === identity.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition",
                item.id === identity.id ? "border-amber-300 bg-amber-50 ring-1 ring-amber-300" : "border-slate-200 hover:bg-slate-50",
              )}
            >
              <Avatar name={item.name} size={34} />
              <span>
                <span className="block text-sm font-medium text-slate-900">{item.name}</span>
                <span className="block text-xs text-slate-500">{item.title}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
