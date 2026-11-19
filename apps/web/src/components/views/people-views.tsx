"use client";

import { Lock, MessageSquarePlus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useDashboard, useFieldAgents, useTickets } from "@/lib/api";
import { awaitingReply, cn, isOpen, listTime } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { Meter } from "../charts";
import { useSimulator } from "../simulator";
import { Avatar, Button, Card, EmptyState, ErrorNotice, inputClass, PageHeader, Skeleton } from "../ui";

export function FieldAgentsView() {
  const agents = useFieldAgents();
  const tickets = useTickets();
  const simulator = useSimulator();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (agents.data ?? [])
      .filter((agent) => !needle || `${agent.name} ${agent.phone} ${agent.region ?? ""} ${agent.employeeId ?? ""} ${agent.storeName ?? ""}`.toLowerCase().includes(needle))
      .map((agent) => {
        const theirs = (tickets.data ?? []).filter((ticket) => ticket.agent.phone === agent.phone);
        const last = theirs.map((ticket) => ticket.lastMessageAt).sort().at(-1);
        return { agent, total: theirs.length, open: theirs.filter(isOpen).length, waiting: theirs.filter(awaitingReply).length, last };
      });
  }, [agents.data, tickets.data, query]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Field agents" description="Connect Store and Container agents registered to raise PIN resets over WhatsApp." />
      <Card bodyClassName="p-0">
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents" aria-label="Search agents" className={cn(inputClass, "pl-9")} />
          </div>
        </div>
        {agents.isError ? (
          <div className="p-4">
            <ErrorNotice error={agents.error} onRetry={() => agents.refetch()} />
          </div>
        ) : agents.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No agents found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Agent</th>
                  <th className="px-5 py-2.5 font-medium">Store / container</th>
                  <th className="px-5 py-2.5 font-medium">Employee ID</th>
                  <th className="px-5 py-2.5 font-medium">Region</th>
                  <th className="px-5 py-2.5 text-right font-medium">Open / total</th>
                  <th className="px-5 py-2.5 font-medium">Last contact</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ agent, total, open, waiting, last }) => (
                  <tr key={agent.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={agent.name} size={34} />
                        <div>
                          <p className="font-medium text-slate-900">{agent.name}</p>
                          <p className="text-xs text-slate-500">{agent.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {agent.storeName ?? "—"}
                      {agent.shopType && <span className="block text-[11px] text-slate-400">{agent.shopType}</span>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{agent.employeeId ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{agent.region ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-900">
                      {open} / {total}
                      {waiting > 0 && <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">{waiting} waiting</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{last ? listTime(last) : "Never"}</td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => simulator.open(agent.phone)}>
                        <MessageSquarePlus size={14} aria-hidden /> Open phone
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-400">Adding and editing agents will arrive with the admin tools. For now agents are managed through the seed data.</p>
    </div>
  );
}

export function StaffView() {
  const { isSupervisor } = useIdentity();
  const dashboard = useDashboard();

  if (!isSupervisor)
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="Staff" />
        <Card>
          <EmptyState icon={<Lock size={20} />} title="Supervisor access required" />
        </Card>
      </div>
    );

  const staff = dashboard.data?.workload ?? [];
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Staff" description="Back-office staff who receive routed tickets. New tickets go to whoever has the fewest open cases." />
      {dashboard.isError && (
        <div className="mb-4">
          <ErrorNotice error={dashboard.error} onRetry={() => dashboard.refetch()} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {dashboard.isPending
          ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-40" />)
          : staff.map((member) => {
              const capacity = member.capacity ?? 20;
              return (
                <Card key={member.id}>
                  <div className="flex items-center gap-3">
                    <Avatar name={member.name} size={44} />
                    <div className="flex-1">
                      <p className="font-medium text-slate-900">{member.name}</p>
                      <p className="text-xs text-slate-500">Back office · Zambia Field Support</p>
                    </div>
                    <span
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        member.available ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", member.available ? "bg-emerald-500" : "bg-slate-400")} aria-hidden />
                      {member.available ? "Available" : "Away"}
                    </span>
                  </div>
                  <div className="mt-5">
                    <div className="mb-1.5 flex justify-between text-xs text-slate-500">
                      <span>Open tickets</span>
                      <span className="tabular-nums text-slate-900">
                        {member.activeTickets} of {capacity}
                      </span>
                    </div>
                    <Meter value={member.activeTickets} max={capacity} label={`${member.name} workload`} />
                  </div>
                </Card>
              );
            })}
      </div>
      <p className="mt-3 text-xs text-slate-400">Availability and capacity editing will arrive with Keycloak sign-in and the admin tools.</p>
    </div>
  );
}
