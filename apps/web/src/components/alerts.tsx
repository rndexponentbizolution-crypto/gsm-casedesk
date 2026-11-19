"use client";

import { Siren, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTickets, type Ticket } from "@/lib/api";
import { awaitingReply, isOpen } from "@/lib/format";
import { useIdentity } from "@/lib/identity";

type Toast = { id: string; reference: string; agent: string; store: string | null | undefined; href: string };

/**
 * "pin reset end" flow: notify the assigned operator of a new PIN reset with
 * its 5-minute SLA. Supervisors are told about every routed PIN reset.
 */
export function NewTicketAlerts() {
  const { identity, isSupervisor } = useIdentity();
  const tickets = useTickets();
  const seen = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Reset what counts as "already seen" when switching identity.
  useEffect(() => {
    seen.current = null;
    setToasts([]);
  }, [identity.id]);

  useEffect(() => {
    if (!tickets.data) return;
    const relevant = (ticket: Ticket) =>
      ticket.queryType === "PIN_RESET" && isOpen(ticket) && ticket.botState === "WITH_AGENT" && (isSupervisor || ticket.assignedUserId === identity.id);
    const current = tickets.data.filter(relevant);
    if (seen.current === null) {
      // First load: everything already in the queue counts as seen.
      seen.current = new Set(current.map((ticket) => ticket.id));
      return;
    }
    const fresh = current.filter((ticket) => !seen.current!.has(ticket.id));
    fresh.forEach((ticket) => seen.current!.add(ticket.id));
    if (!fresh.length) return;
    setToasts((list) => [
      ...fresh.map((ticket) => ({
        id: ticket.id,
        reference: ticket.reference,
        agent: ticket.agent.name,
        store: ticket.agent.storeName,
        href: isSupervisor ? "/tickets/all" : "/tickets",
      })),
      ...list,
    ].slice(0, 3));
  }, [tickets.data, identity.id, isSupervisor]);

  // Waiting count in the tab title, so it's visible from other tabs.
  useEffect(() => {
    const waiting = (tickets.data ?? []).filter((ticket) => awaitingReply(ticket) && (isSupervisor || ticket.assignedUserId === identity.id)).length;
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = waiting ? `(${waiting}) ${base}` : base;
  }, [tickets.data, identity.id, isSupervisor]);

  useEffect(() => {
    if (!toasts.length) return;
    const id = window.setTimeout(() => setToasts((list) => list.slice(0, -1)), 15_000);
    return () => window.clearTimeout(id);
  }, [toasts]);

  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto flex gap-3 rounded-xl border border-red-200 bg-white p-3.5 shadow-xl">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-50 text-red-600">
            <Siren size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">New PIN reset request</p>
            <p className="truncate text-xs text-slate-600">
              {toast.agent}
              {toast.store ? ` · ${toast.store}` : ""} · <span className="font-mono">{toast.reference}</span>
            </p>
            <p className="mt-1 text-[11px] font-medium text-red-700">Process within 5 minutes. Check MSISDN, NRC and live photo, then call.</p>
            <Link href={toast.href} onClick={() => setToasts((list) => list.filter((item) => item.id !== toast.id))} className="mt-2 inline-block text-xs font-semibold text-slate-900 underline underline-offset-2">
              Open queue
            </Link>
          </div>
          <button onClick={() => setToasts((list) => list.filter((item) => item.id !== toast.id))} className="self-start rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
