import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Ticket, TicketStatus } from "./api";

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
  PENDING_INFORMATION: ["IN_PROGRESS", "ESCALATED", "RESOLVED"],
  ESCALATED: ["IN_PROGRESS", "PENDING_INFORMATION", "RESOLVED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: ["IN_PROGRESS"],
};

export const OPEN_STATUSES: TicketStatus[] = ["NEW", "UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "PENDING_INFORMATION", "ESCALATED"];

export const isOpen = (ticket: Pick<Ticket, "status">) => OPEN_STATUSES.includes(ticket.status);

/** Ticket is waiting on us: the last message came from the field agent. */
export const awaitingReply = (ticket: Ticket) => isOpen(ticket) && ticket.messages.at(-1)?.direction === "INBOUND";

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
};

export function describeAudit(type: string, metadata: Record<string, unknown>, names: Map<string, string>) {
  const label = AUDIT_LABEL[type] ?? type.toLowerCase().replaceAll("_", " ");
  const name = (id: unknown) => (typeof id === "string" ? names.get(id) ?? id : "—");
  if (type === "TICKET_ASSIGNED") return `${label} to ${name(metadata.userId)}`;
  if (type === "TICKET_REASSIGNED") return `${label} from ${name(metadata.from)} to ${name(metadata.to)}`;
  if (type === "TICKET_STATUS_CHANGED" && typeof metadata.to === "string")
    return `${label} to ${STATUS_LABEL[metadata.to as TicketStatus] ?? metadata.to}`;
  return label;
}
