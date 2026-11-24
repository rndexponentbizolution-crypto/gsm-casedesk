"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  BookOpenText,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  ImageIcon,
  Paperclip,
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
  Store,
  Timer,
  X,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  downloadAttachment,
  useChangeStatus,
  useDashboard,
  useQueryTypes,
  useReassign,
  useReply,
  useResponses,
  useSendMedia,
  useTickets,
  useUpdateCase,
  type Attachment,
  type Message,
  type StandardResponse,
  type Ticket,
  type TicketStatus,
} from "@/lib/api";
import {
  awaitingReply,
  BOT_STATE_LABEL,
  cn,
  dayLabel,
  describeAudit,
  fileSize,
  fillResponse,
  formatDuration,
  isOpen,
  listTime,
  serviceWindow,
  shortTime,
  slaState,
  STATUS_LABEL,
  STATUS_TRANSITIONS,
  timeAgo,
  withBot,
} from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { useNow } from "@/lib/use-now";
import { EscalationCard, LogFields, PinResetWorkspace, SlaCard } from "./casework";
import { EffectPill, ResponsePicker, suggestedResponseIds } from "./responses";
import { Avatar, Button, EmptyState, ErrorNotice, Skeleton, StatusBadge, inputClass } from "./ui";

export type InboxView = "mine" | "all" | "escalated";

const VIEW_TITLE: Record<InboxView, string> = { mine: "My tickets", all: "All tickets", escalated: "Escalated" };

type Filter = "open" | "needs-reply" | "bot" | "closed" | "all";
const FILTERS: Array<{ id: Filter; label: string; supervisorOnly?: boolean }> = [
  { id: "open", label: "Open" },
  { id: "needs-reply", label: "Needs reply" },
  { id: "bot", label: "With bot", supervisorOnly: true },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

type Draft = { text: string; templateId?: string };

function useNames() {
  const dashboard = useDashboard();
  const { identity } = useIdentity();
  return useMemo(() => {
    const names = new Map<string, string>();
    names.set(identity.id, identity.name);
    dashboard.data?.workload.forEach((item) => names.set(item.id, item.name));
    names.set("system", "System");
    names.set("bot", "GSM Bot");
    return names;
  }, [dashboard.data, identity.id, identity.name]);
}

/** Open work sorted by SLA urgency (soonest due first), then most recent activity. */
function byUrgency(a: Ticket, b: Ticket) {
  const due = (ticket: Ticket) => (ticket.slaDueAt && isOpen(ticket) ? new Date(ticket.slaDueAt).getTime() : Infinity);
  return due(a) - due(b) || b.lastMessageAt.localeCompare(a.lastMessageAt);
}

export function InboxPage({ view }: { view: InboxView }) {
  const { identity, isSupervisor } = useIdentity();
  const tickets = useTickets();
  const queryTypes = useQueryTypes();
  const responses = useResponses();
  // Null until mounted (no clock reads during prerender); tickets only render after mount.
  const now = useNow(1_000) ?? 0;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(view === "escalated" ? "all" : "open");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

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

  const matchesFilter = (ticket: Ticket, value: Filter) => {
    if (value === "open") return isOpen(ticket) && !withBot(ticket);
    if (value === "needs-reply") return awaitingReply(ticket);
    if (value === "bot") return withBot(ticket);
    if (value === "closed") return !isOpen(ticket);
    return true;
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scoped
      .filter((ticket) => matchesFilter(ticket, filter))
      .filter((ticket) => !typeFilter || ticket.queryType === typeFilter)
      .filter(
        (ticket) =>
          !needle ||
          `${ticket.reference} ${ticket.agent.name} ${ticket.agent.phone} ${ticket.agent.storeName ?? ""} ${ticket.details.msisdn ?? ""} ${ticket.subject} ${ticket.region} ${ticket.queryTypeLabel ?? ""}`
            .toLowerCase()
            .includes(needle),
      )
      .sort(filter === "closed" || filter === "all" ? (a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) : byUrgency);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matchesFilter is pure
  }, [scoped, filter, typeFilter, query]);

  // A link such as /tickets/all?ticket=<id> (e.g. from Operations) opens that ticket
  // once the list has loaded, whatever the current filter.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    requested.current = new URLSearchParams(window.location.search).get("ticket");
    if (requested.current) setFilter("all");
  }, []);

  // On wide screens, keep a ticket open; on narrow screens the list is the starting point.
  useEffect(() => {
    if (requested.current && scoped.some((ticket) => ticket.id === requested.current)) {
      setSelectedId(requested.current);
      requested.current = null;
      return;
    }
    if (selectedId && scoped.some((ticket) => ticket.id === selectedId)) return;
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    setSelectedId(wide ? filtered[0]?.id ?? null : null);
  }, [filtered, scoped, selectedId]);

  const selected = scoped.find((ticket) => ticket.id === selectedId) ?? null;
  const responseById = useMemo(() => new Map((responses.data ?? []).map((response) => [response.id, response])), [responses.data]);

  const loadResponse = (responseId: string) => {
    const response = responseById.get(responseId);
    if (!selected || !response) return;
    setDrafts((current) => ({ ...current, [selected.id]: { text: fillResponse(response, selected.agent.name), templateId: response.id } }));
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0">
      {/* ---------- list ---------- */}
      <section
        className={cn("flex w-full min-w-0 flex-col border-r border-slate-200 bg-white lg:w-[380px] lg:shrink-0", selected && "hidden lg:flex")}
        aria-label="Tickets"
      >
        <div className="space-y-3 border-b border-slate-200 px-4 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-950">{VIEW_TITLE[view]}</h1>
            <span className="text-xs text-slate-400">{tickets.isFetching ? "Updating…" : `${filtered.length} shown`}</span>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, MSISDN, store, ref…"
                aria-label="Search tickets"
                className={cn(inputClass, "bg-slate-50 pl-9")}
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              aria-label="Filter by query type"
              className={cn(inputClass, "w-32 bg-slate-50 px-2 text-xs")}
            >
              <option value="">All types</option>
              {(queryTypes.data ?? []).map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="no-scrollbar flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter tickets">
            {FILTERS.filter((item) => isSupervisor || !item.supervisorOnly).map((item) => {
              const count = scoped.filter((ticket) => matchesFilter(ticket, item.id)).length;
              return (
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
                  <span className={cn("tabular-nums", filter === item.id ? "text-slate-300" : "text-slate-400")}>{count}</span>
                </button>
              );
            })}
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
            <ListEmpty view={view} isSupervisor={isSupervisor} hasAny={scoped.length > 0} />
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
            responses={responses.data ?? []}
            draft={drafts[selected.id] ?? { text: "" }}
            setDraft={(draft) => setDrafts((current) => ({ ...current, [selected.id]: draft }))}
            onUseResponse={loadResponse}
            onBack={() => setSelectedId(null)}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails((value) => !value)}
          />
          {showDetails && <Details ticket={selected} now={now} onClose={() => setShowDetails(false)} onUseResponse={loadResponse} />}
        </>
      ) : tickets.isPending ? (
        <div className="hidden flex-1 lg:block" aria-busy="true" />
      ) : (
        <div className="hidden flex-1 items-center justify-center lg:flex">
          <EmptyState
            icon={<InboxIcon size={20} />}
            title={scoped.length ? "Select a ticket" : "No conversations yet"}
            description={scoped.length ? "Choose a conversation from the list to read and reply." : "Messages from registered field agents will appear here once WhatsApp is connected."}
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

function ListEmpty({ view, isSupervisor, hasAny }: { view: InboxView; isSupervisor: boolean; hasAny: boolean }) {
  if (hasAny) return <EmptyState title="Nothing matches" description="Try a different filter or search term." />;
  if (view === "mine" && isSupervisor)
    return (
      <EmptyState
        icon={<InboxIcon size={20} />}
        title="Supervisors don't hold tickets"
        description="PIN resets are routed to back-office staff. Monitor every case from All tickets."
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
      description="New PIN resets are routed here automatically after the bot collects the details."
    />
  );
}

export function SlaBadge({ ticket, now }: { ticket: Ticket; now: number }) {
  const sla = slaState(ticket, now);
  if (sla.level === "none") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
        sla.level === "ok" && "bg-emerald-50 text-emerald-700",
        sla.level === "soon" && "bg-amber-100 text-amber-800",
        sla.level === "breached" && "animate-pulse bg-red-100 text-red-700",
      )}
    >
      {sla.level === "breached" ? <AlertTriangle size={10} aria-hidden /> : <Timer size={10} aria-hidden />}
      {sla.label}
    </span>
  );
}

function TicketRow({ ticket, active, onSelect, now, showAssignee }: { ticket: Ticket; active: boolean; onSelect: () => void; now: number; showAssignee: boolean }) {
  const last = ticket.messages.at(-1);
  const waiting = awaitingReply(ticket);
  const bot = withBot(ticket);
  return (
    <button
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn("flex w-full gap-3 border-b border-slate-100 px-4 py-3.5 text-left transition", active ? "bg-amber-50/70" : "hover:bg-slate-50")}
    >
      <div className="relative">
        <Avatar name={ticket.agent.name} size={40} />
        {waiting && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" aria-label="Awaiting reply" />}
        {ticket.priority === 1 && isOpen(ticket) && (
          <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border-2 border-white bg-red-500 text-[8px] font-bold text-white" aria-label="High priority">
            !
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("truncate text-sm text-slate-900", waiting ? "font-semibold" : "font-medium")}>{ticket.agent.name}</p>
          <span className={cn("shrink-0 text-[11px]", waiting ? "font-medium text-emerald-700" : "text-slate-400")}>{listTime(ticket.lastMessageAt)}</span>
        </div>
        <p className="truncate text-[11px] text-slate-400">{ticket.agent.storeName ?? ticket.agent.phone}</p>
        <p className={cn("mt-0.5 truncate text-[13px]", waiting ? "text-slate-700" : "text-slate-500")}>
          {last?.sender === "bot" ? <span className="text-slate-400">Bot: </span> : last?.direction === "OUTBOUND" ? <span className="text-slate-400">You: </span> : null}
          {last?.mediaType ? `📷 ${last.body}` : (last?.body ?? ticket.subject)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] font-medium text-amber-700">{ticket.reference}</span>
          {ticket.queryTypeLabel && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{ticket.queryTypeLabel}</span>}
          {bot ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
              <Bot size={10} aria-hidden /> {BOT_STATE_LABEL[ticket.botState] ?? "With bot"}
            </span>
          ) : (
            <StatusBadge status={ticket.status} />
          )}
          <SlaBadge ticket={ticket} now={now} />
          {showAssignee && !bot && <span className="ml-auto truncate text-[11px] text-slate-400">{ticket.assignee}</span>}
        </div>
      </div>
    </button>
  );
}

/* ---------------- conversation ---------------- */

type TimelineItem = { kind: "message"; at: string; message: Message } | { kind: "event"; at: string; id: string; text: string };

const TIMELINE_EVENTS = new Set([
  "TICKET_ASSIGNED",
  "TICKET_REASSIGNED",
  "TICKET_STATUS_CHANGED",
  "TICKET_RESOLVED",
  "TICKET_ESCALATED",
  "PIN_RESET_ROUTED",
  "BOT_REDIRECTED_TO_EMAIL",
  "MESSAGE_FAILED",
  "OUTBOUND_RETRIED",
]);

/** File types staff can send on WhatsApp (mirrors the API's list). */
const SENDABLE_TYPES = ".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx,.txt,.mp3,.ogg,.mp4";

function Conversation({
  ticket,
  now,
  responses,
  draft,
  setDraft,
  onUseResponse,
  onBack,
  showDetails,
  onToggleDetails,
}: {
  ticket: Ticket;
  now: number;
  responses: StandardResponse[];
  draft: Draft;
  setDraft: (draft: Draft) => void;
  onUseResponse: (responseId: string) => void;
  onBack: () => void;
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  const { identity, isSupervisor, can } = useIdentity();
  const names = useNames();
  const reply = useReply(ticket.id);
  const sendMedia = useSendMedia(ticket.id);
  const changeStatus = useChangeStatus(ticket.id);
  const [picker, setPicker] = useState<{ query: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const window24 = serviceWindow(ticket, now);
  const canAct = can("tickets.reply") && (isSupervisor || ticket.assignedUserId === identity.id);
  const closed = !isOpen(ticket);
  const bot = withBot(ticket);
  const responseById = useMemo(() => new Map(responses.map((response) => [response.id, response])), [responses]);
  const template = draft.templateId ? responseById.get(draft.templateId) : undefined;
  const suggestions = suggestedResponseIds(ticket)
    .map((id) => responseById.get(id))
    .filter((response): response is StandardResponse => Boolean(response));

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
    area.style.height = `${Math.min(area.scrollHeight, 220)}px`;
  }, [draft.text]);

  // A response loaded from the details panel should be ready to review.
  useEffect(() => {
    if (draft.templateId) textRef.current?.focus();
  }, [draft.templateId]);

  const send = () => {
    const body = draft.text.trim();
    if (!body || reply.isPending) return;
    const sent = draft;
    setDraft({ text: "" }); // clear immediately; the pending bubble shows until the API confirms
    reply.mutate({ text: body, templateId: draft.templateId }, { onError: () => setDraft(sent) });
  };

  /** Sends a file; any typed text goes with it as the caption. */
  const attach = (file: File | undefined) => {
    if (!file || sendMedia.isPending) return;
    const sent = draft;
    setDraft({ text: "" });
    sendMedia.mutate({ file, caption: draft.text.trim() || undefined }, { onError: () => setDraft(sent) });
  };

  const pick = (response: StandardResponse) => {
    setPicker(null);
    setDraft({ text: fillResponse(response, ticket.agent.name), templateId: response.id });
    textRef.current?.focus();
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
            {ticket.queryTypeLabel && <span className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 sm:inline">{ticket.queryTypeLabel}</span>}
            <SlaBadge ticket={ticket} now={now} />
          </div>
          <p className="truncate text-xs text-slate-500">
            {ticket.agent.storeName ? `${ticket.agent.storeName} · ` : ""}
            {ticket.agent.phone} · <span className="font-mono">{ticket.reference}</span>
          </p>
        </div>
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
                  <Bubble message={item.message} templateTitle={item.message.templateId ? responseById.get(item.message.templateId)?.title : undefined} senderName={item.message.sender ? names.get(item.message.sender) : undefined} />
                )}
              </Fragment>
            );
          })}
          {reply.isPending && reply.variables && (
            <Bubble message={{ id: "pending", direction: "OUTBOUND", body: reply.variables.text, state: "PENDING", simulated: false, createdAt: new Date(now || 0).toISOString() }} />
          )}
          {sendMedia.isPending && sendMedia.variables && (
            <Bubble
              message={{
                id: "pending-media",
                direction: "OUTBOUND",
                body: sendMedia.variables.caption ?? "",
                state: "PENDING",
                simulated: false,
                createdAt: new Date(now || 0).toISOString(),
                attachments: [{ id: "", name: sendMedia.variables.file.name, mimeType: sendMedia.variables.file.type, size: sendMedia.variables.file.size, scanStatus: "PENDING", available: false }],
              }}
            />
          )}
        </div>
      </div>

      <footer className="relative shrink-0 border-t border-slate-200 bg-white px-3 pb-3 pt-2.5 sm:px-5">
        {bot ? (
          <p className="mb-2 flex items-center gap-1.5 text-[11px] text-violet-700">
            <Bot size={13} aria-hidden /> The bot is handling this ({BOT_STATE_LABEL[ticket.botState]?.toLowerCase()}). Replying takes the conversation over.
          </p>
        ) : (
          <WindowBanner open={window24.open} remainingMs={window24.remainingMs} />
        )}
        {!canAct ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">This ticket is assigned to {ticket.assignee}. Only they or a supervisor can reply.</p>
        ) : closed ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            <span>
              {STATUS_LABEL[ticket.status]}
              {ticket.outcome ? `: ${ticket.outcome}` : ""}.
            </span>
            <Button size="sm" onClick={() => changeStatus.mutate("IN_PROGRESS")} loading={changeStatus.isPending}>
              Reopen case
            </Button>
          </div>
        ) : (
          <>
            {picker && <ResponsePicker responses={responses} queryType={ticket.queryType} initialQuery={picker.query} onPick={pick} onClose={() => setPicker(null)} />}
            {!draft.text && suggestions.length > 0 && (
              <div className="no-scrollbar mb-2 flex items-center gap-1.5 overflow-x-auto">
                <span className="shrink-0 text-[11px] font-medium text-slate-400">Suggested</span>
                {suggestions.map((response) => (
                  <button
                    key={response.id}
                    onClick={() => onUseResponse(response.id)}
                    className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-700 hover:border-amber-300 hover:bg-amber-50"
                  >
                    {response.title}
                  </button>
                ))}
              </div>
            )}
            {template && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                <BookOpenText size={13} className="shrink-0 text-slate-400" aria-hidden />
                <span className="truncate text-[11px] font-medium text-slate-700">{template.title}</span>
                <EffectPill response={template} className="min-w-0" />
                <button onClick={() => setDraft({ text: draft.text })} className="ml-auto shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Send as a plain message (no status change)" title="Send as a plain message (no status change)">
                  <X size={13} />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-1.5 focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-200">
              <button
                onClick={() => setPicker({ query: "" })}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                aria-label="Standard responses"
                title="Standard responses ( / )"
              >
                <BookOpenText size={18} />
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={sendMedia.isPending}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
                aria-label="Attach a file"
                title="Attach a file (typed text is sent as its caption)"
              >
                <Paperclip size={18} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={SENDABLE_TYPES}
                className="hidden"
                onChange={(event) => {
                  attach(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <textarea
                ref={textRef}
                value={draft.text}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.startsWith("/") && !draft.text) {
                    setPicker({ query: value.slice(1) });
                    return;
                  }
                  setDraft({ ...draft, text: value });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={`Reply to ${ticket.agent.name.split(" ")[0]}… type / for standard responses`}
                aria-label="Reply message"
                className="max-h-56 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-slate-400"
              />
              <button
                onClick={send}
                disabled={!draft.text.trim() || reply.isPending}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-slate-950 transition hover:bg-brand-strong disabled:opacity-40"
                aria-label="Send reply"
              >
                <SendHorizontal size={17} />
              </button>
            </div>
            <p className="mt-1.5 hidden text-[11px] text-slate-400 sm:block">Enter to send · Shift + Enter for a new line · / for standard responses</p>
          </>
        )}
        {(reply.error || sendMedia.error || changeStatus.error) && (
          <div className="mt-2">
            <ErrorNotice error={reply.error ?? sendMedia.error ?? changeStatus.error} />
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

function Bubble({ message, templateTitle, senderName }: { message: Message; templateTitle?: string; senderName?: string }) {
  const outbound = message.direction === "OUTBOUND";
  const fromBot = message.sender === "bot";
  const options = message.interactive?.options ?? [];
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[85%] rounded-xl px-3 pb-1.5 pt-2 text-sm shadow-[0_1px_0.5px_rgba(15,23,42,0.13)] sm:max-w-[70%]",
          fromBot ? "rounded-tr-sm bg-violet-50 ring-1 ring-violet-100" : outbound ? "rounded-tr-sm bg-bubble-out" : "rounded-tl-sm bg-white",
        )}
      >
        {fromBot ? (
          <p className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            <Bot size={11} aria-hidden /> GSM Bot
          </p>
        ) : outbound && senderName ? (
          <p className="mb-0.5 text-[10px] font-semibold text-amber-800">{senderName}</p>
        ) : null}
        {message.attachments?.length ? (
          <div className="mb-1.5 space-y-1">
            {message.attachments.map((file) => (
              <AttachmentChip key={file.id || file.name} file={file} />
            ))}
          </div>
        ) : (
          message.mediaType && (
            <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-4 text-xs text-slate-500">
              <ImageIcon size={18} aria-hidden /> {message.mediaType === "image" ? "Photo" : message.mediaType}
            </div>
          )
        )}
        {/* Attachment-only messages carry a placeholder body; the chip says it all. */}
        {!(message.attachments?.length && /^\[\w+ ATTACHMENT\]$/.test(message.body)) && message.body && (
          <p className="whitespace-pre-wrap break-words text-slate-900">{message.body}</p>
        )}
        {options.length > 0 && (
          <ul className="mt-2 space-y-1 border-t border-violet-200/70 pt-2" aria-label="Menu options sent">
            {options.map((option, index) => (
              <li key={option.id} className="rounded-md bg-white/80 px-2 py-1 text-center text-xs font-medium text-sky-700">
                {index + 1}. {option.title}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">
          {templateTitle && !fromBot && (
            <span className="mr-1 flex min-w-0 max-w-[11rem] items-center gap-0.5 rounded bg-slate-900/5 px-1 font-medium" title={`Standard response: ${templateTitle}`}>
              <BookOpenText size={9} className="shrink-0" aria-hidden /> <span className="truncate">{templateTitle}</span>
            </span>
          )}
          {message.simulated && <span className="mr-1 rounded bg-slate-900/5 px-1 font-medium uppercase tracking-wide">Sim</span>}
          <time dateTime={message.createdAt}>{shortTime(message.createdAt)}</time>
          {outbound && <DeliveryState state={message.state} />}
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({ file }: { file: Attachment }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = file.mimeType.startsWith("image/") ? ImageIcon : FileText;
  const blocked = file.scanStatus === "INFECTED" ? "Blocked by virus scan" : file.scanStatus === "SCAN_FAILED" ? "Could not be scanned" : null;
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadAttachment(file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button
        onClick={download}
        disabled={!file.available || busy}
        className="flex w-full min-w-[12rem] items-center gap-2 rounded-lg bg-slate-900/5 px-2.5 py-2 text-left text-xs text-slate-700 enabled:hover:bg-slate-900/10 disabled:cursor-default"
        title={file.available ? `Download ${file.name}` : (blocked ?? "Not available yet")}
      >
        <Icon size={18} className="shrink-0 text-slate-500" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{file.name}</span>
          <span className={cn("block text-[10px]", blocked ? "text-red-600" : "text-slate-500")}>
            {blocked ?? `${fileSize(file.size)}${file.scanStatus === "NOT_SCANNED" ? " · not virus-scanned" : ""}`}
          </span>
        </span>
        {file.available && <Download size={14} className="shrink-0 text-slate-500" aria-hidden />}
      </button>
      {error && <p className="mt-0.5 text-[10px] text-red-600">{error}</p>}
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
  if (state === "AMBIGUOUS")
    return (
      <span className="flex items-center gap-0.5 text-amber-700" title="Sending was interrupted; WhatsApp may or may not have delivered it. A supervisor can retry it from Operations.">
        <AlertTriangle size={12} aria-hidden /> Unconfirmed
      </span>
    );
  if (state === "PENDING") return <Clock size={12} aria-label="Pending" />;
  if (state === "SENT") return <Check size={13} aria-label="Sent" />;
  return <CheckCheck size={13} aria-label={state === "READ" ? "Read" : "Delivered"} className={state === "READ" ? "text-sky-600" : ""} />;
}

/* ---------------- details ---------------- */

function Details({ ticket, now, onClose, onUseResponse }: { ticket: Ticket; now: number; onClose: () => void; onUseResponse: (responseId: string) => void }) {
  const { identity, isSupervisor, can } = useIdentity();
  const dashboard = useDashboard();
  const tickets = useTickets();
  const queryTypes = useQueryTypes();
  const names = useNames();
  const changeStatus = useChangeStatus(ticket.id);
  const reassign = useReassign(ticket.id);
  const updateCase = useUpdateCase(ticket.id);
  const canAct = can("tickets.reply") && (isSupervisor || ticket.assignedUserId === identity.id);
  const transitions = STATUS_TRANSITIONS[ticket.status];
  const agentTickets = (tickets.data ?? []).filter((item) => item.agent.phone === ticket.agent.phone);
  const firstResponse = ticket.firstResponseAt ? new Date(ticket.firstResponseAt).getTime() - new Date(ticket.createdAt).getTime() : null;
  const staff = dashboard.data?.workload ?? [];
  const pinReset = ticket.queryType === "PIN_RESET";

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-[min(380px,100vw)] flex-col border-l border-slate-200 bg-white shadow-xl xl:static xl:z-auto xl:shadow-none">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Case details</h2>
          <p className="font-mono text-[11px] text-slate-400">{ticket.reference}</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 xl:hidden" aria-label="Close details">
          <X size={18} />
        </button>
      </div>

      <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto p-5">
        <SlaCard ticket={ticket} now={now} />

        <section className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-slate-400">Status</p>
            <div className="mt-1.5">
              {withBot(ticket) ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200">
                  <Bot size={11} aria-hidden /> With bot
                </span>
              ) : (
                <StatusBadge status={ticket.status} />
              )}
            </div>
          </div>
          <div>
            <label htmlFor="query-type" className="text-xs font-medium text-slate-400">
              Query type
            </label>
            {canAct && isOpen(ticket) ? (
              <select
                id="query-type"
                value={ticket.queryType ?? ""}
                disabled={updateCase.isPending}
                onChange={(event) => event.target.value && updateCase.mutate({ queryType: event.target.value })}
                className={cn(inputClass, "mt-1 px-2 py-1 text-xs")}
              >
                <option value="">Not set</option>
                {(queryTypes.data ?? []).map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-1.5 text-sm text-slate-900">{ticket.queryTypeLabel ?? "Not set"}</p>
            )}
          </div>
        </section>

        {ticket.outcome && (
          <section className={cn("rounded-lg px-3 py-2 text-[13px]", ticket.status === "RESOLVED" ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-700")}>
            <p className="text-[11px] font-medium opacity-70">Outcome</p>
            <p className="flex items-center gap-1.5 font-medium">
              {ticket.status === "RESOLVED" && <CheckCircle2 size={14} aria-hidden />} {ticket.outcome}
            </p>
          </section>
        )}

        {ticket.status === "ESCALATED" && <EscalationCard ticket={ticket} />}

        {pinReset && !withBot(ticket) && <PinResetWorkspace ticket={ticket} canAct={canAct} onUseResponse={onUseResponse} />}

        {(pinReset || ticket.details.msisdn) && (
          <section>
            <p className="mb-2 text-xs font-medium text-slate-400">Daily log fields</p>
            <LogFields ticket={ticket} canAct={canAct} />
          </section>
        )}

        <section>
          <p className="text-xs font-medium text-slate-400">Assigned to</p>
          <div className="mt-2 flex items-center gap-2.5">
            {ticket.assignedUserId ? <Avatar name={ticket.assignee} size={28} /> : <span className="h-7 w-7 rounded-full border border-dashed border-slate-300" />}
            <span className="text-sm text-slate-900">{ticket.assignee}</span>
          </div>
          {can("tickets.reassign") && isOpen(ticket) && (
            <div className="mt-3">
              <select
                aria-label="Reassign ticket"
                value=""
                disabled={reassign.isPending}
                onChange={(event) => event.target.value && reassign.mutate(event.target.value)}
                className={cn(inputClass, "py-1.5 text-xs")}
              >
                <option value="">{ticket.assignedUserId ? "Reassign to…" : "Assign to…"}</option>
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

        {canAct && !withBot(ticket) && (
          <details className="group">
            <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 hover:text-slate-600">
              Change status manually <span className="text-slate-300 group-open:hidden">▸</span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {transitions.map((status) => (
                <button
                  key={status}
                  disabled={changeStatus.isPending}
                  onClick={() => changeStatus.mutate(status as TicketStatus)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {STATUS_LABEL[status]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">Prefer standard responses: they record the outcome for the daily log.</p>
            {changeStatus.error && (
              <div className="mt-2">
                <ErrorNotice error={changeStatus.error} />
              </div>
            )}
          </details>
        )}

        <section className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={ticket.agent.name} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{ticket.agent.name}</p>
              <p className="text-xs text-slate-500">{ticket.agent.shopType ?? "Field"} agent</p>
            </div>
          </div>
          <dl className="mt-3 space-y-2 text-sm">
            {ticket.agent.storeName && (
              <div className="flex items-center gap-2 text-slate-600">
                <Store size={14} className="text-slate-400" aria-hidden />
                <dt className="sr-only">Store</dt>
                <dd>{ticket.agent.storeName}</dd>
              </div>
            )}
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
              <dt className="text-[11px] text-slate-500">{isOpen(ticket) ? "Open for" : "Handled in"}</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {formatDuration(
                  (isOpen(ticket) ? now : new Date(ticket.details.executedAt ?? ticket.resolvedAt ?? ticket.closedAt ?? ticket.lastMessageAt).getTime()) -
                    new Date(ticket.createdAt).getTime(),
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <p className="mb-3 text-xs font-medium text-slate-400">Activity</p>
          <ol className="relative space-y-3 border-l border-slate-200 pl-4">
            {[...ticket.audit]
              .filter((event) => event.type !== "MESSAGE_SENT")
              .reverse()
              .map((event) => (
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
