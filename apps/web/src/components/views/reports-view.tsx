"use client";

import { Download, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { downloadReportCsv, useReports } from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { useNow } from "@/lib/use-now";
import { BarList, DateColumns, lastNDays, StatTile } from "../charts";
import { Button, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from "../ui";

const RANGES = [7, 14, 30] as const;

export function ReportsView() {
  const { identity, isSupervisor } = useIdentity();
  const reports = useReports();
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const now = useNow(60_000);
  const today = now ? new Date(now).toDateString() : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when the range or calendar day changes
  const days = useMemo(() => (now ? lastNDays(range, now) : []), [range, today]);

  if (!isSupervisor)
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="Reports" />
        <Card>
          <EmptyState icon={<Lock size={20} />} title="Supervisor access required" description="Reports cover the whole desk, so they're limited to supervisors and administrators." />
        </Card>
      </div>
    );

  const data = reports.data;
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadReportCsv(identity);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Reports"
        description="Volume, responsiveness and distribution across the desk."
        actions={
          <Button size="sm" onClick={exportCsv} loading={exporting}>
            <Download size={15} aria-hidden /> Export CSV
          </Button>
        }
      />
      {exportError ? (
        <div className="mb-4">
          <ErrorNotice error={exportError} />
        </div>
      ) : null}
      {reports.isError && (
        <div className="mb-4">
          <ErrorNotice error={reports.error} onRetry={() => reports.refetch()} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {reports.isPending ? (
          Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24" />)
        ) : (
          <>
            <StatTile label="Tickets created" value={data?.ticketsCreated ?? 0} hint={`${data?.ticketsOpen ?? 0} still open`} />
            <StatTile label="Resolved or closed" value={data?.ticketsResolved ?? 0} tone="good" />
            <StatTile label="Avg first response" value={formatMinutes(data?.averageFirstResponseMinutes ?? 0)} />
            <StatTile label="Avg resolution time" value={formatMinutes(data?.averageResolutionMinutes ?? 0)} />
            <StatTile label="Inbound messages" value={data?.inboundMessages ?? 0} />
            <StatTile label="Outbound messages" value={data?.outboundMessages ?? 0} hint={`${data?.failedOutboundMessages ?? 0} failed`} tone={data?.failedOutboundMessages ? "critical" : undefined} />
            <StatTile label="Escalations" value={data?.escalations ?? 0} tone={data?.escalations ? "critical" : undefined} />
            <StatTile label="Unassigned" value={data?.unassignedCases ?? 0} tone={data?.unassignedCases ? "warning" : undefined} />
          </>
        )}
      </div>

      <Card
        className="mt-6"
        title="Message volume"
        action={
          <div className="flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Date range">
            {RANGES.map((value) => (
              <button
                key={value}
                onClick={() => setRange(value)}
                aria-pressed={range === value}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${range === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
              >
                {value}d
              </button>
            ))}
          </div>
        }
      >
        {reports.isPending || !days.length ? (
          <Skeleton className="h-52" />
        ) : (
          <DateColumns
            dates={days}
            series={[
              { name: "Inbound", values: days.map((day) => data?.inboundByDate[day] ?? 0) },
              { name: "Outbound", values: days.map((day) => data?.outboundByDate[day] ?? 0) },
            ]}
          />
        )}
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card title="Tickets per staff member">
          {reports.isPending ? (
            <Skeleton className="h-32" />
          ) : (
            <BarList data={(data?.assignmentDistribution ?? []).map((item) => ({ label: item.name, value: item.tickets }))} />
          )}
        </Card>
        <Card title="Cases by region">
          {reports.isPending ? (
            <Skeleton className="h-32" />
          ) : (
            <BarList
              data={Object.entries(data?.casesByRegion ?? {})
                .map(([label, value]) => ({ label: label || "Unknown", value }))
                .sort((a, b) => b.value - a.value)}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
