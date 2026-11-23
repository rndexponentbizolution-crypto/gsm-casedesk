"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdentity } from "./identity";
import { authHeaders, handleUnauthorized } from "./session";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

export type TicketStatus =
  | "NEW"
  | "UNASSIGNED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "PENDING_INFORMATION"
  | "ESCALATED"
  | "RESOLVED"
  | "CLOSED";

export type Message = {
  id: string;
  direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
  body: string;
  state: string;
  simulated: boolean;
  /** "bot", "system", or the staff member's id */
  sender?: string | null;
  templateId?: string | null;
  interactive?: { type?: "list"; button?: string; options?: MenuOption[]; replyId?: string } | null;
  mediaType?: string | null;
  createdAt: string;
  attachments?: Attachment[];
};

export type Attachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** CLEAN, NOT_SCANNED, INFECTED or SCAN_FAILED */
  scanStatus: string;
  available: boolean;
};

export type MenuOption = { id: string; title: string };

export type BotState = "IDLE" | "MENU" | "OTHER_MENU" | "AWAITING_PIN_DETAILS" | "WITH_AGENT";

export type CaseDetails = {
  msisdn?: string;
  nrcNumber?: string;
  region?: string;
  locationName?: string;
  shopType?: string;
  balanceZmw?: number | null;
  validation?: Record<string, boolean>;
  verification?: Record<string, boolean>;
  resolved?: boolean;
  executedAt?: string;
  escalation?: { subject: string; attachments: string[]; email: string; escalatedAt: string; dueAt: string; queryType?: string };
};

export type ResponseEffect =
  | { kind: "acknowledge" }
  | { kind: "resolve"; outcome: string }
  | { kind: "close"; outcome: string }
  | { kind: "pending"; outcome: string }
  | { kind: "escalate"; subject: string; attachments: string[]; queryType?: string; slaHours: number }
  | { kind: "redirect_email" }
  | { kind: "info" };

export type StandardResponse = {
  id: string;
  title: string;
  category: string;
  body: string;
  effect: ResponseEffect;
  queryTypes?: string[];
};

export type QueryType = { key: string; label: string; handledOnWhatsApp: boolean; slaMinutes: number | null; level: "FIRST" | "ESCALATED" };

export type AuditEvent = {
  id: string;
  type: string;
  actor: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type Ticket = {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  priority: number;
  assignedUserId: string | null;
  assignee: string;
  team: string;
  region: string;
  queryType: string | null;
  queryTypeLabel: string | null;
  tags: string[];
  slaDueAt: string | null;
  acknowledgedAt: string | null;
  outcome: string | null;
  details: CaseDetails;
  botState: BotState;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt?: string | null;
  createdAt: string;
  lastMessageAt: string;
  agent: { id: string; name: string; phone: string; region?: string | null; storeName?: string | null; shopType?: string | null };
  messages: Message[];
  audit: AuditEvent[];
};

export type Workload = { id: string; name: string; available: boolean; capacity?: number; activeTickets: number };

export type Dashboard = {
  total: number;
  new: number;
  open: number;
  unassigned: number;
  assigned: number;
  escalated: number;
  resolved: number;
  withBot?: number;
  slaBreached?: number;
  failedOutbound: number;
  stuckInbound: number;
  workload: Workload[];
};

export type Report = {
  ticketsCreated: number;
  ticketsResolved: number;
  ticketsOpen: number;
  inboundMessages: number;
  outboundMessages: number;
  failedOutboundMessages: number;
  averageFirstResponseMinutes: number;
  averageResolutionMinutes: number;
  escalations: number;
  unassignedCases: number;
  slaBreachedOpen?: number;
  pinResetsHandled?: number;
  pinResetsWithinSla?: number;
  byQueryType?: Record<string, number>;
  outcomes?: Record<string, number>;
  assignmentDistribution: Array<{ name: string; tickets: number }>;
  casesByRegion: Record<string, number>;
  inboundByDate: Record<string, number>;
  outboundByDate: Record<string, number>;
};

export type FieldAgent = {
  id: string;
  name: string;
  phone: string;
  region: string | null;
  employeeId: string | null;
  storeName?: string | null;
  shopType?: string | null;
  active: boolean;
};

export type Health = { status: string; database?: "ok" | "error"; mode: string; timestamp: string };

export type OutboundIssue = {
  id: string;
  /** FAILED, AMBIGUOUS (delivery unknown) or PENDING (retrying) */
  status: string;
  attempts: number;
  error: string | null;
  nextAttemptAt: string | null;
  updatedAt: string;
  to: string | null;
  preview: string;
  ticketId: string | null;
  reference: string | null;
};

export type InboundIssue = {
  id: string;
  status: string;
  attempts: number;
  error: string | null;
  from: string | null;
  type: string | null;
  preview: string;
  receivedAt: string;
};

export type Operations = { mode: "simulation" | "live"; outbound: OutboundIssue[]; inbound: InboundIssue[] };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = await authHeaders();
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...auth,
        // FormData sets its own multipart boundary; only JSON strings need this.
        ...(typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot reach the CaseDesk API. It may be waking up — try again in a moment.", 0);
  }
  if (response.status === 401) handleUnauthorized();
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.message === "string") message = body.message;
      else if (Array.isArray(body?.message)) message = body.message.join(", ");
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, response.status);
  }
  const type = response.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? response.json() : response.text()) as Promise<T>;
}

// ---------- queries ----------

export function useTickets() {
  const { identity } = useIdentity();
  return useQuery({
    queryKey: ["tickets", identity.id],
    queryFn: () => apiFetch<Ticket[]>("/api/tickets"),
    // PIN resets carry a 5-minute SLA, so keep the queue fresh.
    refetchInterval: 8_000,
  });
}

export function useDashboard() {
  const { identity } = useIdentity();
  return useQuery({
    queryKey: ["dashboard", identity.id],
    queryFn: () => apiFetch<Dashboard>("/api/dashboard"),
    refetchInterval: 30_000,
  });
}

export function useReports() {
  const { identity } = useIdentity();
  return useQuery({
    queryKey: ["reports", identity.id],
    queryFn: () => apiFetch<Report>("/api/reports"),
    enabled: identity.role !== "BACK_OFFICE",
    refetchInterval: 60_000,
  });
}

export function useFieldAgents() {
  return useQuery({
    queryKey: ["field-agents"],
    queryFn: () => apiFetch<FieldAgent[]>("/api/field-agents"),
    staleTime: 60_000,
  });
}

export function useResponses() {
  return useQuery({
    queryKey: ["responses"],
    queryFn: () => apiFetch<StandardResponse[]>("/api/responses"),
    staleTime: Infinity,
  });
}

export function useQueryTypes() {
  return useQuery({
    queryKey: ["query-types"],
    queryFn: () => apiFetch<QueryType[]>("/api/query-types"),
    staleTime: Infinity,
  });
}

export function useOperations() {
  const { identity } = useIdentity();
  return useQuery({
    queryKey: ["operations", identity.id],
    queryFn: () => apiFetch<Operations>("/api/operations"),
    enabled: identity.role !== "BACK_OFFICE",
    refetchInterval: 15_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<Health>("/health"),
    refetchInterval: 60_000,
    retry: 1,
  });
}

// ---------- mutations ----------

/**
 * After a write: patch the ticket list with the ticket the API returned (instant),
 * then refresh lists and stats in the background without blocking the UI.
 */
function useAfterWrite() {
  const client = useQueryClient();
  const { identity } = useIdentity();
  return (updated?: Omit<Ticket, "assignee"> & { assignee?: string }) => {
    if (updated?.id) {
      client.setQueryData<Ticket[]>(["tickets", identity.id], (list) =>
        list?.map((ticket) =>
          ticket.id === updated.id
            ? {
                ...ticket,
                ...updated,
                assignee:
                  updated.assignee ??
                  (updated.assignedUserId === ticket.assignedUserId
                    ? ticket.assignee
                    : client
                        .getQueryData<Dashboard>(["dashboard", identity.id])
                        ?.workload.find((member) => member.id === updated.assignedUserId)?.name ?? "Unassigned"),
              }
            : ticket,
        ),
      );
    }
    for (const key of ["tickets", "dashboard", "reports", "operations"]) void client.invalidateQueries({ queryKey: [key] });
  };
}

export function useReply(ticketId: string) {
  const { identity } = useIdentity();
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (input: { text: string; templateId?: string }) =>
      apiFetch<Ticket>(`/api/tickets/${ticketId}/reply`, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (ticket) => afterWrite(ticket),
  });
}

export function useChangeStatus(ticketId: string) {
  const { identity } = useIdentity();
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (status: TicketStatus) =>
      apiFetch<Ticket>(`/api/tickets/${ticketId}/status`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: (ticket) => afterWrite(ticket),
  });
}

export function useReassign(ticketId: string) {
  const { identity } = useIdentity();
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<Ticket>(`/api/tickets/${ticketId}/reassign`, { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: (ticket) => afterWrite(ticket),
  });
}

export function useUpdateCase(ticketId: string) {
  const { identity } = useIdentity();
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (patch: { queryType?: string; details?: Partial<CaseDetails> }) =>
      apiFetch<Ticket>(`/api/tickets/${ticketId}/case`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: (ticket) => afterWrite(ticket),
  });
}

/** Send a file (with an optional caption) to the field agent on WhatsApp. */
export function useSendMedia(ticketId: string) {
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (input: { file: File; caption?: string }) => {
      const form = new FormData();
      form.append("file", input.file);
      if (input.caption) form.append("caption", input.caption);
      return apiFetch<Ticket>(`/api/tickets/${ticketId}/media`, { method: "POST", body: form });
    },
    onSuccess: (ticket) => afterWrite(ticket),
  });
}

/** Supervisor actions on failed or stuck messages. */
export function useOperationAction() {
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (input: { kind: "outbound" | "inbound"; id: string; action: "retry" | "dismiss" }) =>
      apiFetch<{ id: string; status: string }>(`/api/operations/${input.kind}/${input.id}/${input.action}`, { method: "POST" }),
    onSuccess: () => afterWrite(),
  });
}

export type InboundInput = { phone: string; text?: string; replyId?: string; mediaType?: string; file?: File };

export function useSimulateInbound() {
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: ({ file, ...input }: InboundInput) => {
      let body: string | FormData = JSON.stringify(input);
      if (file) {
        body = new FormData();
        for (const [key, value] of Object.entries(input)) if (value) body.append(key, value);
        body.append("file", file);
      }
      return apiFetch<{ ticketId: string | null; reference: string | null; duplicate: boolean; botState?: BotState }>("/api/simulator/inbound", {
        method: "POST",
        body,
      });
    },
    onSuccess: () => afterWrite(),
  });
}

/** Downloads an attachment with the signed-in user's credentials. */
export async function downloadAttachment(attachment: Pick<Attachment, "id" | "name">) {
  const response = await fetch(`${API_URL}/api/attachments/${attachment.id}`, { headers: await authHeaders() });
  if (response.status === 401) handleUnauthorized();
  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.message === "string") message = body.message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, response.status);
  }
  saveBlob(await response.blob(), attachment.name);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function saveCsv(csv: string, filename: string) {
  saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

export async function downloadReportCsv() {
  saveCsv(await apiFetch<string>("/api/reports.csv"), `gsm-casedesk-report-${new Date().toISOString().slice(0, 10)}.csv`);
}

/** SOP Step 6 daily log for one day (YYYY-MM-DD). */
export async function downloadDailyLog(day: string) {
  saveCsv(await apiFetch<string>(`/api/reports/daily-log.csv?date=${encodeURIComponent(day)}`), `gsm-daily-log-${day}.csv`);
}
