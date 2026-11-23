import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ResponseEffect, StandardResponse, Ticket, TicketStatus } from "./api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: "New",
  UNASSIGNED: "Unassigned",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  PENDING_INFORMATION: "Pending info",
  ESCALATED: "Escalated",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

// Mirrors the API's allowed transitions so the UI only offers valid moves.
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "ESCALATED", "CLOSED"],
  UNASSIGNED: ["ASSIGNED", "ESCALATED", "CLOSED"],
  ASSIGNED: ["IN_PROGRESS", "PENDING_INFORMATION", "ESCALATED", "RESOLVED"],
  IN_PROGRESS: ["PENDING_INFORMATION", "ESCALATED", "RESOLVED", "CLOSED"],
  PENDING_INFORMATION: ["IN_PROGRESS", "ESCALATED", "RESOLVED", "CLOSED"],
  ESCALATED: ["IN_PROGRESS", "PENDING_INFORMATION", "RESOLVED", "CLOSED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: ["IN_PROGRESS"],
};

export const OPEN_STATUSES: TicketStatus[] = ["NEW", "UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "PENDING_INFORMATION", "ESCALATED"];

export const isOpen = (ticket: Pick<Ticket, "status">) => OPEN_STATUSES.includes(ticket.status);

/** The WhatsApp bot (not a person) is still handling the conversation. */
export const withBot = (ticket: Pick<Ticket, "botState" | "status">) =>
  isOpen(ticket) && ["MENU", "OTHER_MENU", "AWAITING_PIN_DETAILS"].includes(ticket.botState);

/** Ticket is waiting on us: the last message came from the field agent and the bot isn't handling it. */
export const awaitingReply = (ticket: Ticket) => isOpen(ticket) && !withBot(ticket) && ticket.messages.at(-1)?.direction === "INBOUND";

export const BOT_STATE_LABEL: Record<string, string> = {
  MENU: "Choosing query type",
  OTHER_MENU: "Choosing query type",
  AWAITING_PIN_DETAILS: "Sending PIN reset details",
};

export type SlaState = { level: "none" | "ok" | "soon" | "breached"; remainingMs: number; label: string };

/** SLA countdown for open tickets. "soon" = last 20% of the window (min 1 minute). */
export function slaState(ticket: Pick<Ticket, "slaDueAt" | "status" | "createdAt">, now: number): SlaState {
  if (!ticket.slaDueAt || !isOpen(ticket) || !now) return { level: "none", remainingMs: 0, label: "" };
  const due = new Date(ticket.slaDueAt).getTime();
  const remainingMs = due - now;
  if (remainingMs <= 0) return { level: "breached", remainingMs, label: `Overdue ${formatClock(-remainingMs)}` };
  const windowMs = Math.max(60_000, due - new Date(ticket.createdAt).getTime());
  return {
    level: remainingMs < Math.max(60_000, windowMs * 0.2) ? "soon" : "ok",
    remainingMs,
    label: `${formatClock(remainingMs)} left`,
  };
}

/** m:ss under an hour, otherwise the coarse duration. */
export function formatClock(ms: number) {
  if (ms >= 3600_000) return formatDuration(ms);
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function describeEffect(effect: ResponseEffect): { label: string; tone: "good" | "bad" | "warn" | "info" | "esc" } {
  switch (effect.kind) {
    case "acknowledge":
      return { label: "Acknowledges · moves to In progress", tone: "info" };
    case "resolve":
      return { label: `Resolves · ${effect.outcome}`, tone: "good" };
    case "close":
      return { label: `Closes unresolved · ${effect.outcome}`, tone: "bad" };
    case "pending":
      return { label: `Waits on agent · ${effect.outcome}`, tone: "warn" };
    case "escalate":
      return { label: `Escalates · "${effect.subject}" · ${effect.slaHours}h`, tone: "esc" };
    case "redirect_email":
      return { label: "Closes · redirected to email", tone: "bad" };
    default:
      return { label: "No status change", tone: "info" };
  }
}

export function fillResponse(response: Pick<StandardResponse, "body">, agentName: string) {
  return response.body.replace(/{name}/g, agentName.split(" ")[0] ?? "").replace(/ ,/g, ",");
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** WhatsApp's 24-hour customer-service window, measured from the last inbound message. */
export function serviceWindow(ticket: Ticket, now = Date.now()) {
  const lastInbound = [...ticket.messages].reverse().find((message) => message.direction === "INBOUND");
  if (!lastInbound) return { open: false, remainingMs: 0 };
  const remainingMs = new Date(lastInbound.createdAt).getTime() + WINDOW_MS - now;
  return { open: remainingMs > 0, remainingMs: Math.max(0, remainingMs) };
}

export function formatDuration(ms: number) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatMinutes(minutes: number) {
  if (!minutes) return "—";
  return formatDuration(minutes * 60000);
}

export function timeAgo(iso: string, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  return `${formatDuration(diff)} ago`.replace(/ \d+m ago$/, " ago").replace(/ \d+h ago$/, " ago");
}

export function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function listTime(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return shortTime(iso);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

export function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export const compact = (value: number) => new Intl.NumberFormat("en", { notation: "compact" }).format(value);

const AUDIT_LABEL: Record<string, string> = {
  TICKET_CREATED: "Ticket created",
  TICKET_ASSIGNED: "Assigned",
  TICKET_REASSIGNED: "Reassigned",
  MESSAGE_RECEIVED: "Message received",
  REPLY_SUBMITTED: "Reply submitted",
  MESSAGE_SENT: "Reply sent",
  TICKET_RESOLVED: "Resolved",
  TICKET_STATUS_CHANGED: "Status changed",
  DUPLICATE_WEBHOOK_IGNORED: "Duplicate message ignored",
  BOT_QUERY_SELECTED: "Bot: query type selected",
  PIN_RESET_ROUTED: "PIN reset routed · high priority · 5 min SLA",
  BOT_REDIRECTED_TO_EMAIL: "Bot redirected to email",
  TICKET_ESCALATED: "Escalated",
  CASE_UPDATED: "Case details updated",
  MESSAGE_QUEUED: "Reply queued for WhatsApp",
  MESSAGE_FAILED: "WhatsApp delivery failed",
  MESSAGE_AMBIGUOUS: "WhatsApp delivery unconfirmed",
  MEDIA_SENT: "File sent",
  MEDIA_QUEUED: "File queued for WhatsApp",
  ATTACHMENT_DOWNLOADED: "Attachment downloaded",
  ATTACHMENT_REJECTED: "Attachment rejected by virus scan",
  ACCESS_DENIED: "Access refused",
  OUTBOUND_RETRIED: "Failed message retried",
  OUTBOUND_DISMISSED: "Failed message dismissed",
  REPORT_EXPORTED: "Report exported",
};

export function describeAudit(type: string, metadata: Record<string, unknown>, names: Map<string, string>) {
  const label = AUDIT_LABEL[type] ?? type.toLowerCase().replaceAll("_", " ");
  const name = (id: unknown) => (typeof id === "string" ? names.get(id) ?? id : "—");
  if (type === "TICKET_ASSIGNED") return `${label} to ${name(metadata.userId)}`;
  if (type === "TICKET_REASSIGNED") return `${label} from ${name(metadata.from)} to ${name(metadata.to)}`;
  if (type === "TICKET_ESCALATED" && typeof metadata.subject === "string") return `${label}: ${metadata.subject}`;
  if (type === "BOT_QUERY_SELECTED" && typeof metadata.queryType === "string") return `Bot: ${metadata.queryType === "PIN_RESET" ? "PIN reset" : metadata.queryType} selected`;
  if (type === "TICKET_STATUS_CHANGED" && typeof metadata.to === "string")
    return `${label} to ${STATUS_LABEL[metadata.to as TicketStatus] ?? metadata.to}`;
  if (type === "MESSAGE_FAILED" && typeof metadata.error === "string") return `${label}: ${metadata.error}`;
  if ((type === "ATTACHMENT_DOWNLOADED" || type === "MEDIA_SENT" || type === "MEDIA_QUEUED") && typeof metadata.name === "string")
    return `${label}: ${metadata.name}`;
  return label;
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
