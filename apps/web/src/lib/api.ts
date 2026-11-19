"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdentity, type Identity } from "./identity";

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
  createdAt: string;
};

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
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  lastMessageAt: string;
  agent: { id: string; name: string; phone: string };
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
  active: boolean;
};

export type Health = { status: string; database?: "ok" | "error"; mode: string; timestamp: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function identityHeaders(identity: Identity): Record<string, string> {
  return { "x-demo-role": identity.role, "x-demo-user": identity.id };
}

export async function apiFetch<T>(path: string, identity: Identity | null, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(identity ? identityHeaders(identity) : {}),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("Cannot reach the CaseDesk API. It may be waking up — try again in a moment.", 0);
  }
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
    queryFn: () => apiFetch<Ticket[]>("/api/tickets", identity),
    refetchInterval: 15_000,
  });
}

export function useDashboard() {
  const { identity } = useIdentity();
  return useQuery({
    queryKey: ["dashboard", identity.id],
    queryFn: () => apiFetch<Dashboard>("/api/dashboard", identity),
    refetchInterval: 30_000,
  });
}

export function useReports() {
  const { identity } = useIdentity();
  return useQuery({
    queryKey: ["reports", identity.id],
    queryFn: () => apiFetch<Report>("/api/reports", identity),
    enabled: identity.role !== "BACK_OFFICE",
    refetchInterval: 60_000,
  });
}

export function useFieldAgents() {
  return useQuery({
    queryKey: ["field-agents"],
    queryFn: () => apiFetch<FieldAgent[]>("/api/field-agents", null),
    staleTime: 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<Health>("/health", null),
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
    for (const key of ["tickets", "dashboard", "reports"]) void client.invalidateQueries({ queryKey: [key] });
  };
}

export function useReply(ticketId: string) {
  const { identity } = useIdentity();
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (text: string) =>
      apiFetch<Ticket>(`/api/tickets/${ticketId}/reply`, identity, { method: "POST", body: JSON.stringify({ text }) }),
    onSuccess: (ticket) => afterWrite(ticket),
  });
}

export function useChangeStatus(ticketId: string) {
  const { identity } = useIdentity();
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (status: TicketStatus) =>
      apiFetch<Ticket>(`/api/tickets/${ticketId}/status`, identity, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: (ticket) => afterWrite(ticket),
  });
}

export function useReassign(ticketId: string) {
  const { identity } = useIdentity();
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<Ticket>(`/api/tickets/${ticketId}/reassign`, identity, { method: "POST", body: JSON.stringify({ userId }) }),
    onSuccess: (ticket) => afterWrite(ticket),
  });
}

export function useSimulateInbound() {
  const afterWrite = useAfterWrite();
  return useMutation({
    mutationFn: (input: { phone: string; text: string }) =>
      apiFetch<{ ticketId: string | null; reference: string | null; duplicate: boolean }>("/api/simulator/inbound", null, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => afterWrite(),
  });
}

export async function downloadReportCsv(identity: Identity) {
  const csv = await apiFetch<string>("/api/reports.csv", identity);
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `gsm-casedesk-report-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
