"use client";

import { ClipboardList, Download, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { downloadDailyLog, downloadReportCsv, useReports } from "@/lib/api";
import { formatMinutes } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { useNow } from "@/lib/use-now";
import { BarList, DateColumns, lastNDays, StatTile } from "../charts";
import { Button, Card, EmptyState, ErrorNotice, inputClass, PageHeader, Skeleton } from "../ui";

/** Today's date in Lusaka (UTC+2, no DST) as YYYY-MM-DD. */
const lusakaDay = (nowMs: number) => new Date(nowMs + 2 * 3600_000).toISOString().slice(0, 10);

const RANGES = [7, 14, 30] as const;

export function ReportsView() {
  const { identity, can } = useIdentity();
  const canExport = can("reports.export");
  const reports = useReports();
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const now = useNow(60_000);
  const today = now ? new Date(now).toDateString() : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when the range or calendar day changes
  const days = useMemo(() => (now ? lastNDays(range, now) : []), [range, today]);
  const [logDay, setLogDay] = useState("");
  const [logBusy, setLogBusy] = useState(false);
  useEffect(() => {
    if (now && !logDay) setLogDay(lusakaDay(now));
  }, [now, logDay]);

  if (!can("reports.view"))
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader title="Reports" />
        <Card>
          <EmptyState icon={<Lock size={20} />} title="You don't have access to this page" description="Ask an administrator for the view reports permission." />
        </Card>
      </div>
    );

  const data = reports.data;
  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadReportCsv();
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  const exportDailyLog = async () => {
    if (!logDay) return;
    setLogBusy(true);
    setExportError(null);
    try {
      await downloadDailyLog(logDay);
    } catch (error) {
      setExportError(error);
    } finally {
      setLogBusy(false);
    }
  };

  const handled = data?.pinResetsHandled ?? 0;
  const withinSla = data?.pinResetsWithinSla ?? 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Reports"
        description="Volume, responsiveness and distribution across the desk."
        actions={
          canExport && (
            <Button size="sm" onClick={exportCsv} loading={exporting}>
              <Download size={15} aria-hidden /> Export CSV
            </Button>
          )
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

      {canExport && (
      <section className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
          <ClipboardList size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">Daily log</h2>
          <p className="text-xs text-slate-500">
            The SOP Step 6 log: pickup and execution times, MSISDN, NRC, request type, location, shop type, resolved and reason.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={logDay} onChange={(event) => setLogDay(event.target.value)} aria-label="Log date" className={inputClass + " w-40 py-1.5"} />
          <Button size="sm" variant="primary" onClick={exportDailyLog} loading={logBusy} disabled={!logDay}>
            <Download size={14} aria-hidden /> Download
          </Button>
        </div>
      </section>
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
            <StatTile
              label="PIN resets within SLA"
              value={handled ? `${Math.round((withinSla / handled) * 100)}%` : "—"}
              hint={handled ? `${withinSla} of ${handled} handled within 5 min` : "No PIN resets handled yet"}
              tone={handled ? (withinSla / handled >= 0.9 ? "good" : "warning") : undefined}
            />
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
        <Card title="Tickets by query type">
          {reports.isPending ? (
            <Skeleton className="h-32" />
          ) : (
            <BarList data={Object.entries(data?.byQueryType ?? {}).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)} />
          )}
        </Card>
        <Card title="Outcomes">
          {reports.isPending ? (
            <Skeleton className="h-32" />
          ) : (
            <BarList
              data={Object.entries(data?.outcomes ?? {})
                .map(([label, value]) => ({ label, value }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 10)}
              emptyLabel="No outcomes recorded yet"
            />
          )}
        </Card>
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
