"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Inbox as InboxIcon,
  MapPin,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  Phone,
  Search,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  useChangeStatus,
  useDashboard,
  useReassign,
  useReply,
  useTickets,
  type Message,
  type Ticket,
  type TicketStatus,
} from "@/lib/api";
import {
  awaitingReply,
  cn,
  dayLabel,
  describeAudit,
  formatDuration,
  isOpen,
  listTime,
  serviceWindow,
  shortTime,
  STATUS_LABEL,
  STATUS_TRANSITIONS,
  timeAgo,
} from "@/lib/format";
import { IDENTITIES, useIdentity } from "@/lib/identity";
import { useNow } from "@/lib/use-now";
import { useSimulator } from "./simulator";
import { Avatar, Button, EmptyState, ErrorNotice, Skeleton, StatusBadge, inputClass } from "./ui";

export type InboxView = "mine" | "all" | "escalated";

const VIEW_TITLE: Record<InboxView, string> = { mine: "My tickets", all: "All tickets", escalated: "Escalated" };

type Filter = "needs-reply" | "open" | "closed" | "all";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "open", label: "Open" },
  { id: "needs-reply", label: "Needs reply" },
  { id: "closed", label: "Resolved" },
  { id: "all", label: "All" },
];

const QUICK_REPLIES = [
  "Thanks, we've received your message and are looking into it.",
  "Could you share a photo or screenshot of the issue?",
  "Please confirm your site ID and exact location.",
  "This has been resolved on our side. Please confirm it's working now.",
];

function useNames() {
  const dashboard = useDashboard();
  return useMemo(() => {
    const names = new Map<string, string>(IDENTITIES.map((item) => [item.id, item.name]));
    dashboard.data?.workload.forEach((item) => names.set(item.id, item.name));
    names.set("system", "System");
    return names;
  }, [dashboard.data]);
}


export function InboxPage({ view }: { view: InboxView }) {
  const { identity, isSupervisor } = useIdentity();
  const tickets = useTickets();
  const simulator = useSimulator();
  // Null until mounted (no clock reads during prerender); tickets only render after mount.
  const now = useNow() ?? 0;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(view === "escalated" ? "all" : "open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Details sit beside the chat on wide screens; elsewhere they're an overlay opened on demand.
  useEffect(() => {
    setShowDetails(window.matchMedia("(min-width: 1280px)").matches);
  }, []);

  const scoped = useMemo(() => {
    const all = tickets.data ?? [];
    if (view === "mine") return all.filter((ticket) => ticket.assignedUserId === identity.id);
    if (view === "escalated") return all.filter((ticket) => ticket.status === "ESCALATED");
    return all;
  }, [tickets.data, view, identity.id]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scoped
      .filter((ticket) => {
        if (filter === "open") return isOpen(ticket);
        if (filter === "closed") return !isOpen(ticket);
        if (filter === "needs-reply") return awaitingReply(ticket);
        return true;
      })
      .filter(
        (ticket) =>
          !needle ||
          `${ticket.reference} ${ticket.agent.name} ${ticket.agent.phone} ${ticket.subject} ${ticket.region}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }, [scoped, filter, query]);

  // On wide screens, keep a ticket open; on narrow screens the list is the starting point.
  useEffect(() => {
    if (selectedId && scoped.some((ticket) => ticket.id === selectedId)) return;
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    setSelectedId(wide ? filtered[0]?.id ?? null : null);
  }, [filtered, scoped, selectedId]);

  const selected = scoped.find((ticket) => ticket.id === selectedId) ?? null;
  const counts = {
    open: scoped.filter(isOpen).length,
    "needs-reply": scoped.filter(awaitingReply).length,
    closed: scoped.filter((ticket) => !isOpen(ticket)).length,
    all: scoped.length,
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0">
      {/* ---------- list ---------- */}
      <section
        className={cn(
          "flex w-full min-w-0 flex-col border-r border-slate-200 bg-white lg:w-[360px] lg:shrink-0",
          selected && "hidden lg:flex",
        )}
        aria-label="Tickets"
      >
        <div className="space-y-3 border-b border-slate-200 px-4 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-950">{VIEW_TITLE[view]}</h1>
            <span className="text-xs text-slate-400">{tickets.isFetching ? "Updating…" : `${filtered.length} shown`}</span>
          </div>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone, reference…"
              aria-label="Search tickets"
              className={cn(inputClass, "bg-slate-50 pl-9")}
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter tickets">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={filter === item.id}
                onClick={() => setFilter(item.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
                  filter === item.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                {item.label}
                <span className={cn("tabular-nums", filter === item.id ? "text-slate-300" : "text-slate-400")}>{counts[item.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {tickets.isPending ? (
            <ListSkeleton />
          ) : tickets.isError ? (
            <div className="p-4">
              <ErrorNotice error={tickets.error} onRetry={() => tickets.refetch()} />
            </div>
          ) : filtered.length === 0 ? (
            <ListEmpty view={view} isSupervisor={isSupervisor} hasAny={scoped.length > 0} onSimulate={() => simulator.open()} />
          ) : (
            <ul>
              {filtered.map((ticket) => (
                <li key={ticket.id}>
                  <TicketRow ticket={ticket} active={ticket.id === selectedId} onSelect={() => setSelectedId(ticket.id)} now={now} showAssignee={view !== "mine"} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---------- conversation + details ---------- */}
      {selected ? (
        <>
          <Conversation
            key={selected.id}
            ticket={selected}
            now={now}
            onBack={() => setSelectedId(null)}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((value) => !value)}
          />
          {showDetails && <Details ticket={selected} now={now} onClose={() => setShowDetails(false)} />}
        </>
      ) : tickets.isPending ? (
        <div className="hidden flex-1 lg:block" aria-busy="true" />
      ) : (
        <div className="hidden flex-1 items-center justify-center lg:flex">
          <EmptyState
            icon={<InboxIcon size={20} />}
            title={scoped.length ? "Select a ticket" : "No conversations yet"}
            description={scoped.length ? "Choose a conversation from the list to read and reply." : "Incoming WhatsApp messages from field agents will appear here."}
            action={
              !scoped.length && (
                <Button variant="primary" onClick={() => simulator.open()}>
                  <MessageSquarePlus size={16} aria-hidden /> Simulate a message
                </Button>
              )
            }
          />
        </div>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex gap-3 rounded-lg p-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListEmpty({ view, isSupervisor, hasAny, onSimulate }: { view: InboxView; isSupervisor: boolean; hasAny: boolean; onSimulate: () => void }) {
  if (hasAny) return <EmptyState title="Nothing matches" description="Try a different filter or search term." />;
  if (view === "mine" && isSupervisor)
    return (
      <EmptyState
        icon={<InboxIcon size={20} />}
        title="Supervisors don't hold tickets"
        description="New tickets are routed to back-office staff. Monitor every case from All tickets."
        action={
          <Link href="/tickets/all" className="text-sm font-medium text-slate-900 underline underline-offset-2">
            Go to All tickets
          </Link>
        }
      />
    );
  if (view === "escalated") return <EmptyState icon={<ShieldCheck size={20} />} title="No escalations" description="Escalated cases will be listed here." />;
  return (
    <EmptyState
      icon={<InboxIcon size={20} />}
      title="Inbox zero"
      description="No tickets yet. Messages from field agents create tickets automatically."
      action={
        <Button size="sm" onClick={onSimulate}>
          <MessageSquarePlus size={14} aria-hidden /> Simulate a message
        </Button>
      }
    />
  );
}

function TicketRow({ ticket, active, onSelect, now, showAssignee }: { ticket: Ticket; active: boolean; onSelect: () => void; now: number; showAssignee: boolean }) {
  const last = ticket.messages.at(-1);
  const waiting = awaitingReply(ticket);
  return (
    <button
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full gap-3 border-b border-slate-100 px-4 py-3.5 text-left transition",
        active ? "bg-amber-50/70" : "hover:bg-slate-50",
      )}
    >
      <div className="relative">
        <Avatar name={ticket.agent.name} size={40} />
        {waiting && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" aria-label="Awaiting reply" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("truncate text-sm text-slate-900", waiting ? "font-semibold" : "font-medium")}>{ticket.agent.name}</p>
          <span className={cn("shrink-0 text-[11px]", waiting ? "font-medium text-emerald-700" : "text-slate-400")}>{listTime(ticket.lastMessageAt)}</span>
        </div>
        <p className={cn("mt-0.5 truncate text-[13px]", waiting ? "text-slate-700" : "text-slate-500")}>
          {last?.direction === "OUTBOUND" && <span className="text-slate-400">You: </span>}
          {last?.body ?? ticket.subject}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[11px] font-medium text-amber-700">{ticket.reference}</span>
          <StatusBadge status={ticket.status} />
          {showAssignee && <span className="ml-auto truncate text-[11px] text-slate-400">{ticket.assignee}</span>}
          {!showAssignee && isOpen(ticket) && <span className="ml-auto text-[11px] text-slate-400">{timeAgo(ticket.createdAt, now)}</span>}
        </div>
      </div>
    </button>
  );
}

/* ---------------- conversation ---------------- */

type TimelineItem = { kind: "message"; at: string; message: Message } | { kind: "event"; at: string; id: string; text: string };

const TIMELINE_EVENTS = new Set(["TICKET_CREATED", "TICKET_ASSIGNED", "TICKET_REASSIGNED", "TICKET_STATUS_CHANGED", "TICKET_RESOLVED"]);

function Conversation({ ticket, now, onBack, showDetails, onToggleDetails }: { ticket: Ticket; now: number; onBack: () => void; showDetails: boolean; onToggleDetails: () => void }) {
  const { identity, isSupervisor } = useIdentity();
  const names = useNames();
  const reply = useReply(ticket.id);
  const changeStatus = useChangeStatus(ticket.id);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const window24 = serviceWindow(ticket, now);
  const canAct = isSupervisor || ticket.assignedUserId === identity.id;
  const closed = !isOpen(ticket);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...ticket.messages.map((message) => ({ kind: "message" as const, at: message.createdAt, message })),
      ...ticket.audit
        .filter((event) => TIMELINE_EVENTS.has(event.type))
        .map((event) => ({ kind: "event" as const, at: event.createdAt, id: event.id, text: describeAudit(event.type, event.metadata, names) })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [ticket.messages, ticket.audit, names]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [timeline.length, reply.isPending]);

  useEffect(() => {
    const area = textRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
  }, [text]);

  const send = () => {
    const body = text.trim();
    if (!body || reply.isPending) return;
    setText(""); // clear immediately; the pending bubble shows until the API confirms
    reply.mutate(body, { onError: () => setText(body) });
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={`Conversation with ${ticket.agent.name}`}>
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-5">
        <button onClick={onBack} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Back to list">
          <ArrowLeft size={18} />
        </button>
        <Avatar name={ticket.agent.name} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-slate-950">{ticket.agent.name}</h2>
            <StatusBadge status={ticket.status} className="hidden sm:inline-flex" />
          </div>
          <p className="truncate text-xs text-slate-500">
            {ticket.agent.phone} · <span className="font-mono">{ticket.reference}</span>
            {ticket.region && ` · ${ticket.region}`}
          </p>
        </div>
        {canAct && !closed && STATUS_TRANSITIONS[ticket.status].includes("RESOLVED") && (
          <Button size="sm" variant="dark" onClick={() => changeStatus.mutate("RESOLVED")} loading={changeStatus.isPending} className="hidden sm:inline-flex">
            <CheckCircle2 size={14} aria-hidden /> Resolve
          </Button>
        )}
        <button
          onClick={onToggleDetails}
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
          aria-label={showDetails ? "Hide case details" : "Show case details"}
          aria-pressed={showDetails}
        >
          {showDetails ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
        </button>
      </header>

      <div ref={scrollRef} className="chat-wallpaper scrollbar-thin flex-1 overflow-y-auto px-3 py-4 sm:px-8">
        <div className="mx-auto max-w-3xl space-y-1.5">
          {timeline.map((item, index) => {
            const previous = timeline[index - 1];
            const newDay = !previous || new Date(previous.at).toDateString() !== new Date(item.at).toDateString();
            return (
              <Fragment key={item.kind === "message" ? item.message.id : item.id}>
                {newDay && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-500 shadow-sm">{dayLabel(item.at)}</span>
                  </div>
                )}
                {item.kind === "event" ? (
                  <div className="flex justify-center py-1">
                    <span className="rounded-full bg-slate-900/5 px-3 py-1 text-[11px] text-slate-600">
                      {item.text} · {shortTime(item.at)}
                    </span>
                  </div>
                ) : (
                  <Bubble message={item.message} />
                )}
              </Fragment>
            );
          })}
          {reply.isPending && reply.variables && (
            <Bubble
              message={{ id: "pending", direction: "OUTBOUND", body: reply.variables, state: "PENDING", simulated: false, createdAt: new Date(now || 0).toISOString() }}
            />
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-200 bg-white px-3 pb-3 pt-2.5 sm:px-5">
        <WindowBanner open={window24.open} remainingMs={window24.remainingMs} />
        {!canAct ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">This ticket is assigned to {ticket.assignee}. Only they or a supervisor can reply.</p>
        ) : closed ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            <span>This case is {STATUS_LABEL[ticket.status].toLowerCase()}.</span>
            <Button size="sm" onClick={() => changeStatus.mutate("IN_PROGRESS")} loading={changeStatus.isPending}>
              Reopen case
            </Button>
          </div>
        ) : (
          <>
            <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
              {QUICK_REPLIES.map((quick) => (
                <button
                  key={quick}
                  onClick={() => {
                    setText(quick);
                    textRef.current?.focus();
                  }}
                  className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                >
                  {quick.length > 34 ? `${quick.slice(0, 34)}…` : quick}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-1.5 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-200">
              <textarea
                ref={textRef}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={`Reply to ${ticket.agent.name.split(" ")[0]}…`}
                aria-label="Reply message"
                className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-slate-400"
              />
              <button
                onClick={send}
                disabled={!text.trim() || reply.isPending}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-slate-950 transition hover:bg-brand-strong disabled:opacity-40"
                aria-label="Send reply"
              >
                <SendHorizontal size={17} />
              </button>
            </div>
            <p className="mt-1.5 hidden text-[11px] text-slate-400 sm:block">Enter to send · Shift + Enter for a new line</p>
          </>
        )}
        {(reply.error || changeStatus.error) && (
          <div className="mt-2">
            <ErrorNotice error={reply.error ?? changeStatus.error} />
          </div>
        )}
      </footer>
    </section>
  );
}

function WindowBanner({ open, remainingMs }: { open: boolean; remainingMs: number }) {
  return open ? (
    <p className="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-700">
      <ShieldCheck size={13} aria-hidden /> 24-hour reply window open · {formatDuration(remainingMs)} left
    </p>
  ) : (
    <p className="mb-2 flex items-center gap-1.5 text-[11px] text-amber-700">
      <ShieldAlert size={13} aria-hidden /> Outside the 24-hour window. Once WhatsApp is live, an approved template will be needed to reply.
    </p>
  );
}

function Bubble({ message }: { message: Message }) {
  const outbound = message.direction === "OUTBOUND";
  const internal = message.direction === "INTERNAL";
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[85%] rounded-xl px-3 pb-1.5 pt-2 text-sm shadow-[0_1px_0.5px_rgba(15,23,42,0.13)] sm:max-w-[70%]",
          outbound ? "rounded-tr-sm bg-bubble-out" : internal ? "bg-violet-50 ring-1 ring-violet-200" : "rounded-tl-sm bg-white",
        )}
      >
        {internal && <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">Internal note</p>}
        <p className="whitespace-pre-wrap break-words text-slate-900">{message.body}</p>
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">
          {message.simulated && <span className="mr-1 rounded bg-slate-900/5 px-1 font-medium uppercase tracking-wide">Sim</span>}
          <time dateTime={message.createdAt}>{shortTime(message.createdAt)}</time>
          {outbound && <DeliveryState state={message.state} />}
        </div>
      </div>
    </div>
  );
}

function DeliveryState({ state }: { state: string }) {
  if (state === "FAILED")
    return (
      <span className="flex items-center gap-0.5 text-red-600">
        <AlertTriangle size={12} aria-hidden /> Failed
      </span>
    );
  if (state === "PENDING") return <Clock size={12} aria-label="Pending" />;
  if (state === "SENT") return <Check size={13} aria-label="Sent" />;
  return <CheckCheck size={13} aria-label={state === "READ" ? "Read" : "Delivered"} className={state === "READ" ? "text-sky-600" : ""} />;
}

/* ---------------- details ---------------- */

function Details({ ticket, now, onClose }: { ticket: Ticket; now: number; onClose: () => void }) {
  const { identity, isSupervisor } = useIdentity();
  const dashboard = useDashboard();
  const tickets = useTickets();
  const names = useNames();
  const changeStatus = useChangeStatus(ticket.id);
  const reassign = useReassign(ticket.id);
  const canAct = isSupervisor || ticket.assignedUserId === identity.id;
  const transitions = STATUS_TRANSITIONS[ticket.status];
  const agentTickets = (tickets.data ?? []).filter((item) => item.agent.phone === ticket.agent.phone);
  const firstResponse = ticket.firstResponseAt ? new Date(ticket.firstResponseAt).getTime() - new Date(ticket.createdAt).getTime() : null;
  const staff = dashboard.data?.workload ?? [];

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-[min(340px,100vw)] flex-col border-l border-slate-200 bg-white shadow-xl xl:static xl:z-auto xl:shadow-none">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-5">
        <h2 className="text-sm font-semibold text-slate-900">Case details</h2>
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 xl:hidden" aria-label="Close details">
          <X size={18} />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto p-5">
        <section>
          <p className="text-xs font-medium text-slate-400">Subject</p>
          <p className="mt-1 text-sm text-slate-900">{ticket.subject}</p>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-400">Status</p>
            <div className="mt-1.5">
              <StatusBadge status={ticket.status} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">Reference</p>
            <p className="mt-1.5 font-mono text-sm text-slate-900">{ticket.reference}</p>
          </div>
        </section>

        {canAct && (
          <section>
            <label className="text-xs font-medium text-slate-400" htmlFor="status-change">
              Move to
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {transitions.map((status) => (
                <button
                  key={status}
                  id={status === transitions[0] ? "status-change" : undefined}
                  disabled={changeStatus.isPending}
                  onClick={() => changeStatus.mutate(status as TicketStatus)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50",
                    status === "ESCALATED"
                      ? "border-red-200 text-red-700 hover:bg-red-50"
                      : status === "RESOLVED"
                        ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50",
                  )}
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
            {changeStatus.error && (
              <div className="mt-2">
                <ErrorNotice error={changeStatus.error} />
              </div>
            )}
          </section>
        )}

        <section>
          <p className="text-xs font-medium text-slate-400">Assigned to</p>
          <div className="mt-2 flex items-center gap-2.5">
            {ticket.assignedUserId ? <Avatar name={ticket.assignee} size={28} /> : <span className="h-7 w-7 rounded-full border border-dashed border-slate-300" />}
            <span className="text-sm text-slate-900">{ticket.assignee}</span>
          </div>
          {isSupervisor && (
            <div className="mt-3">
              <select
                aria-label="Reassign ticket"
                value=""
                disabled={reassign.isPending}
                onChange={(event) => event.target.value && reassign.mutate(event.target.value)}
                className={cn(inputClass, "py-1.5 text-xs")}
              >
                <option value="">Reassign to…</option>
                {staff
                  .filter((member) => member.id !== ticket.assignedUserId)
                  .map((member) => (
                    <option key={member.id} value={member.id} disabled={!member.available}>
                      {member.name} · {member.activeTickets} open{member.available ? "" : " (unavailable)"}
                    </option>
                  ))}
              </select>
              {reassign.error && (
                <div className="mt-2">
                  <ErrorNotice error={reassign.error} />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={ticket.agent.name} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{ticket.agent.name}</p>
              <p className="text-xs text-slate-500">Field agent</p>
            </div>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <Phone size={14} className="text-slate-400" aria-hidden />
              <dt className="sr-only">Phone</dt>
              <dd>{ticket.agent.phone}</dd>
            </div>
            {ticket.region && (
              <div className="flex items-center gap-2 text-slate-600">
                <MapPin size={14} className="text-slate-400" aria-hidden />
                <dt className="sr-only">Region</dt>
                <dd>{ticket.region}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {agentTickets.length} ticket{agentTickets.length === 1 ? "" : "s"} · {agentTickets.filter(isOpen).length} open
          </p>
        </section>

        <section>
          <p className="mb-2 text-xs font-medium text-slate-400">Service levels</p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-[11px] text-slate-500">First response</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{firstResponse === null ? "Awaiting" : formatDuration(firstResponse)}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <dt className="text-[11px] text-slate-500">{isOpen(ticket) ? "Open for" : "Resolved after"}</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {formatDuration((ticket.resolvedAt && !isOpen(ticket) ? new Date(ticket.resolvedAt).getTime() : now) - new Date(ticket.createdAt).getTime())}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <p className="mb-3 text-xs font-medium text-slate-400">Activity</p>
          <ol className="relative space-y-3 border-l border-slate-200 pl-4">
            {[...ticket.audit].reverse().map((event) => (
              <li key={event.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border-2 border-white bg-slate-300" aria-hidden />
                <p className="text-[13px] text-slate-800">{describeAudit(event.type, event.metadata, names)}</p>
                <p className="text-[11px] text-slate-400">
                  {names.get(event.actor) ?? event.actor} · {timeAgo(event.createdAt, now)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </aside>
  );
}
