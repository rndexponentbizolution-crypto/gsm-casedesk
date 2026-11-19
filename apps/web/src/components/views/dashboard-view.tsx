"use client";

import { ArrowRight, Inbox } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useDashboard, useReports, useTickets } from "@/lib/api";
import { awaitingReply, formatDuration, isOpen, slaState, STATUS_LABEL, withBot } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { useNow } from "@/lib/use-now";
import { BarList, DateColumns, lastNDays, Meter, StatTile } from "../charts";
import { SlaBadge } from "../inbox";
import { Avatar, Card, EmptyState, ErrorNotice, PageHeader, Skeleton, StatusBadge } from "../ui";

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function DashboardView() {
  const { identity, isSupervisor } = useIdentity();
  const tickets = useTickets();
  const dashboard = useDashboard();
  const reports = useReports();
  const now = useNow(1_000);

  const all = useMemo(() => tickets.data ?? [], [tickets.data]);
  const mine = isSupervisor ? all : all.filter((ticket) => ticket.assignedUserId === identity.id);
  const waiting = useMemo(
    () =>
      mine
        .filter(awaitingReply)
        .sort((a, b) => a.lastMessageAt.localeCompare(b.lastMessageAt))
        .slice(0, 6),
    [mine],
  );
  const open = mine.filter(isOpen);
  const byStatus = (Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>)
    .map((status) => ({ label: STATUS_LABEL[status], value: mine.filter((ticket) => ticket.status === status).length }))
    .filter((item) => item.value > 0);

  const today = now ? new Date(now).toDateString() : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when the calendar day changes
  const days = useMemo(() => (now ? lastNDays(14, now) : []), [today]);
  const inbound = days.map((day) => reports.data?.inboundByDate[day] ?? 0);
  const outbound = days.map((day) => reports.data?.outboundByDate[day] ?? 0);

  // Computed from timestamps here: the API's report rounds to whole minutes, which hides fast replies.
  const responded = mine.filter((ticket) => ticket.firstResponseAt);
  const avgFirstResponseMs = responded.length
    ? responded.reduce((sum, ticket) => sum + (new Date(ticket.firstResponseAt!).getTime() - new Date(ticket.createdAt).getTime()), 0) / responded.length
    : null;

  const breached = now ? mine.filter((ticket) => slaState(ticket, now).level === "breached").length : 0;

  const firstName = identity.name.split(" ")[0];
  const loading = tickets.isPending || dashboard.isPending;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={`${now ? greeting(new Date(now).getHours()) : "Welcome"}, ${firstName}`}
        description={isSupervisor ? "Here's how the Zambia field-support desk is doing." : "Here's what's waiting for you."}
        actions={
          <>
            <Link
              href={isSupervisor ? "/tickets/all" : "/tickets"}
              className="inline-flex h-8 items-center gap-2 rounded-lg bg-brand px-3 text-xs font-medium text-slate-950 transition hover:bg-brand-strong"
            >
              <Inbox size={15} aria-hidden /> Open inbox
            </Link>
          </>
        }
      />

      {(tickets.isError || dashboard.isError) && (
        <div className="mb-6">
          <ErrorNotice
            error={tickets.error ?? dashboard.error}
            onRetry={() => {
              tickets.refetch();
              dashboard.refetch();
            }}
          />
        </div>
      )}

      {/* Headline + tiles */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <div className="flex flex-col justify-between rounded-xl bg-sidebar p-6 text-white">
          <p className="text-sm text-slate-400">{isSupervisor ? "Open cases across the desk" : "Your open cases"}</p>
          {loading ? <Skeleton className="my-3 h-14 w-24 bg-white/10" /> : <p className="my-2 text-6xl font-semibold tracking-tight">{open.length}</p>}
          <p className="text-sm text-slate-400">
            {waiting.length ? (
              <>
                <span className="font-medium text-brand">{mine.filter(awaitingReply).length} awaiting a reply</span>
                {now && waiting[0] && ` · oldest waiting ${formatDuration(now - new Date(waiting[0].lastMessageAt).getTime())}`}
              </>
            ) : (
              "Nothing waiting on a reply."
            )}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Needs reply" value={loading ? "…" : mine.filter(awaitingReply).length} hint="Last message from agent" />
          <StatTile
            label="SLA breached"
            value={loading ? "…" : breached}
            tone={breached ? "critical" : "good"}
            hint={breached ? "Open cases past their SLA" : "All open cases within SLA"}
          />
          <StatTile
            label={isSupervisor ? "With the bot" : "Escalated"}
            value={loading ? "…" : isSupervisor ? mine.filter(withBot).length : mine.filter((ticket) => ticket.status === "ESCALATED").length}
            hint={isSupervisor ? "Agents choosing a query type" : "Awaiting email feedback"}
          />
          <StatTile
            label="Avg first response"
            value={loading ? "…" : avgFirstResponseMs === null ? "—" : formatDuration(avgFirstResponseMs)}
            hint={responded.length ? `Across ${responded.length} answered ticket${responded.length === 1 ? "" : "s"}` : "No replies yet"}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Waiting for a reply"
          action={
            <Link href={isSupervisor ? "/tickets/all" : "/tickets"} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
              View inbox <ArrowRight size={13} aria-hidden />
            </Link>
          }
          bodyClassName="p-0"
        >
          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-10" />
              ))}
            </div>
          ) : waiting.length === 0 ? (
            <EmptyState title="All caught up" description="Every open conversation has a reply." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {waiting.map((ticket) => (
                <li key={ticket.id}>
                  <Link href={isSupervisor ? "/tickets/all" : "/tickets"} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <Avatar name={ticket.agent.name} size={34} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {ticket.agent.name} <span className="font-mono text-xs font-normal text-amber-700">{ticket.reference}</span>
                      </p>
                      <p className="truncate text-xs text-slate-500">{ticket.messages.at(-1)?.body ?? ticket.subject}</p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="flex items-center justify-end gap-1.5">
                        {now ? <SlaBadge ticket={ticket} now={now} /> : null}
                        <StatusBadge status={ticket.status} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">{ticket.assignee}</p>
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs font-medium text-amber-700">
                      {now ? formatDuration(now - new Date(ticket.lastMessageAt).getTime()) : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Tickets by status">
          {loading ? <Skeleton className="h-32" /> : <BarList data={byStatus} emptyLabel="No tickets yet" />}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {isSupervisor && (
          <Card className="lg:col-span-2" title="Messages, last 14 days">
            {reports.isPending || !days.length ? (
              <Skeleton className="h-52" />
            ) : reports.isError ? (
              <ErrorNotice error={reports.error} onRetry={() => reports.refetch()} />
            ) : (
              <DateColumns
                dates={days}
                series={[
                  { name: "Inbound", values: inbound },
                  { name: "Outbound", values: outbound },
                ]}
              />
            )}
          </Card>
        )}

        <Card title="Team workload" className={isSupervisor ? "" : "lg:col-span-3"}>
          {dashboard.isPending ? (
            <Skeleton className="h-32" />
          ) : (
            <ul className="space-y-4">
              {(dashboard.data?.workload ?? []).map((member) => {
                const capacity = member.capacity ?? 20;
                return (
                  <li key={member.id}>
                    <div className="mb-1.5 flex items-center gap-2.5">
                      <Avatar name={member.name} size={26} />
                      <span className="flex-1 truncate text-sm text-slate-800">{member.name}</span>
                      <span className="text-xs tabular-nums text-slate-500">
                        {member.activeTickets}/{capacity}
                      </span>
                    </div>
                    <Meter value={member.activeTickets} max={capacity} label={`${member.name} workload`} />
                    {!member.available && <p className="mt-1 text-[11px] text-slate-400">Unavailable</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
