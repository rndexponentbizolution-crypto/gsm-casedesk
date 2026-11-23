"use client";

import { CheckCircle2, Lock, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useOperationAction, useOperations, type InboundIssue, type OutboundIssue } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { useNow } from "@/lib/use-now";
import { Button, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from "../ui";

const OUTBOUND_STATUS: Record<string, { label: string; tone: string; explain: string }> = {
  FAILED: {
    label: "Failed",
    tone: "bg-red-50 text-red-700 ring-red-200",
    explain: "WhatsApp refused it or every retry failed. Fix the cause, then retry or dismiss.",
  },
  AMBIGUOUS: {
    label: "Unconfirmed",
    tone: "bg-amber-50 text-amber-800 ring-amber-200",
    explain: "Sending was interrupted, so it may already have arrived. Check with the field agent before retrying, or it could arrive twice.",
  },
  PENDING: {
    label: "Retrying",
    tone: "bg-sky-50 text-sky-700 ring-sky-200",
    explain: "A temporary error; CaseDesk will try again automatically.",
  },
};

export function OperationsView() {
  const { isSupervisor } = useIdentity();
  const operations = useOperations();
  const action = useOperationAction();
  const now = useNow(30_000);

  if (!isSupervisor)
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="Operations" />
        <Card>
          <EmptyState icon={<Lock size={20} />} title="Supervisor access required" />
        </Card>
      </div>
    );

  const data = operations.data;
  const act = (kind: "outbound" | "inbound", id: string, verb: "retry" | "dismiss") => action.mutate({ kind, id, action: verb });

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Operations"
        description={
          data?.mode === "live"
            ? "WhatsApp messages that didn't go through, and incoming messages that couldn't be processed."
            : "Simulation mode: nothing is sent to WhatsApp, so this stays empty until live messaging is switched on."
        }
      />
      {(operations.isError || action.isError) && (
        <div className="mb-4">
          <ErrorNotice error={operations.error ?? action.error} onRetry={operations.isError ? () => operations.refetch() : undefined} />
        </div>
      )}

      <div className="space-y-6">
        <Card title={`Outgoing messages${data ? ` (${data.outbound.length})` : ""}`}>
          {operations.isPending ? (
            <Skeleton className="h-24" />
          ) : !data?.outbound.length ? (
            <EmptyState icon={<CheckCircle2 size={20} />} title="Everything sent" description="No failed, unconfirmed or retrying messages." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.outbound.map((item) => (
                <OutboundRow key={item.id} item={item} now={now} busy={action.isPending && action.variables?.id === item.id} onAct={(verb) => act("outbound", item.id, verb)} />
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Incoming messages${data ? ` (${data.inbound.length})` : ""}`}>
          {operations.isPending ? (
            <Skeleton className="h-24" />
          ) : !data?.inbound.length ? (
            <EmptyState icon={<CheckCircle2 size={20} />} title="Nothing stuck" description="Every incoming WhatsApp message has been processed." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.inbound.map((item) => (
                <InboundRow key={item.id} item={item} now={now} busy={action.isPending && action.variables?.id === item.id} onRetry={() => act("inbound", item.id, "retry")} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function OutboundRow({ item, now, busy, onAct }: { item: OutboundIssue; now: number | null; busy: boolean; onAct: (verb: "retry" | "dismiss") => void }) {
  const status = OUTBOUND_STATUS[item.status] ?? OUTBOUND_STATUS.FAILED;
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded px-1.5 py-0.5 font-medium ring-1 ${status.tone}`}>{status.label}</span>
          {item.ticketId && (
            <Link href={`/tickets/all?ticket=${item.ticketId}`} className="font-mono text-slate-700 underline-offset-2 hover:underline">
              {item.reference}
            </Link>
          )}
          <span className="text-slate-500">to {item.to ?? "unknown"}</span>
          <span className="text-slate-400">
            · {item.attempts} attempt{item.attempts === 1 ? "" : "s"} · {now ? timeAgo(item.updatedAt, now) : ""}
          </span>
        </div>
        <p className="mt-1 truncate text-sm text-slate-900">{item.preview || <em className="text-slate-400">(no text)</em>}</p>
        {item.error && <p className="mt-0.5 break-words text-xs text-red-700">{item.error}</p>}
        <p className="mt-0.5 text-xs text-slate-500">{status.explain}</p>
      </div>
      {item.status !== "PENDING" && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => onAct("retry")} loading={busy}>
            <RotateCcw size={14} aria-hidden /> Retry
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onAct("dismiss")} disabled={busy}>
            <X size={14} aria-hidden /> Dismiss
          </Button>
        </div>
      )}
    </li>
  );
}

function InboundRow({ item, now, busy, onRetry }: { item: InboundIssue; now: number | null; busy: boolean; onRetry: () => void }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700 ring-1 ring-red-200">{item.status === "FAILED" ? "Failed" : "Stuck"}</span>
          <span className="text-slate-700">from {item.from ?? "unknown"}</span>
          <span className="text-slate-400">
            · {item.type} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"} · {now ? timeAgo(item.receivedAt, now) : ""}
          </span>
        </div>
        <p className="mt-1 truncate text-sm text-slate-900">{item.preview || <em className="text-slate-400">(no text)</em>}</p>
        {item.error && <p className="mt-0.5 break-words text-xs text-red-700">{item.error}</p>}
      </div>
      <Button size="sm" onClick={onRetry} loading={busy} className="shrink-0">
        <RotateCcw size={14} aria-hidden /> Retry
      </Button>
    </li>
  );
}
