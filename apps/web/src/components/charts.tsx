"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/format";

/*
 * Chart primitives. Colours come from the validated categorical palette
 * (slot 1 blue, slot 2 orange — passes CVD/contrast checks on the light surface).
 * Text always uses text tokens, never the series colour.
 */
export const SERIES = ["var(--series-1)", "var(--series-2)"] as const;

/* ---------- Stat tile ---------- */

export function StatTile({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "warning" | "critical" | "good" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        {tone && (
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 rounded-full",
              tone === "warning" && "bg-amber-500",
              tone === "critical" && "bg-red-500",
              tone === "good" && "bg-emerald-500",
            )}
          />
        )}
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/* ---------- Horizontal bar list (single series: one colour for every bar) ---------- */

export function BarList({ data, emptyLabel = "No data yet", valueSuffix = "" }: { data: Array<{ label: string; value: number }>; emptyLabel?: string; valueSuffix?: string }) {
  const max = Math.max(1, ...data.map((item) => item.value));
  if (!data.length) return <p className="py-6 text-center text-sm text-slate-400">{emptyLabel}</p>;
  return (
    <ul className="space-y-3">
      {data.map((item) => (
        <li key={item.label} className="group" title={`${item.label}: ${item.value}${valueSuffix}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{item.label}</span>
            <span className="tabular-nums font-medium text-slate-900">
              {item.value}
              {valueSuffix}
            </span>
          </div>
          <div className="h-2.5 rounded-r bg-slate-100">
            <div
              className="h-full rounded-r transition-[width,filter] group-hover:brightness-110"
              style={{ width: `${(item.value / max) * 100}%`, background: SERIES[0], minWidth: item.value ? 4 : 0 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Meter (fill = severity, track = lighter step of the same ramp) ---------- */

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max ? Math.min(1, value / max) : 0;
  const severity = ratio >= 0.9 ? "critical" : ratio >= 0.7 ? "warning" : "ok";
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        "h-2 w-full rounded-full",
        severity === "ok" && "bg-blue-100",
        severity === "warning" && "bg-amber-100",
        severity === "critical" && "bg-red-100",
      )}
    >
      <div
        className={cn(
          "h-full rounded-full",
          severity === "ok" && "bg-[var(--series-1)]",
          severity === "warning" && "bg-amber-500",
          severity === "critical" && "bg-red-500",
        )}
        style={{ width: `${ratio * 100}%`, minWidth: value ? 6 : 0 }}
      />
    </div>
  );
}

/* ---------- Grouped column chart over dates (≤2 series) with hover tooltip + table view ---------- */

type Series = { name: string; values: number[] };

export function DateColumns({ dates, series, height = 200 }: { dates: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  const step = niceStep(Math.max(1, ...series.flatMap((item) => item.values)) / 4);
  const max = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((index) => index * step);
  const padLeft = 32;
  const padBottom = 22;
  const width = 640;
  const plotWidth = width - padLeft;
  const plotHeight = height - padBottom;
  const band = plotWidth / Math.max(1, dates.length);
  const bar = Math.min(12, (band - 6) / series.length - 2);
  const groupWidth = series.length * bar + (series.length - 1) * 2;
  const labelEvery = Math.ceil(dates.length / 7);
  const label = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-4 text-xs text-slate-600" aria-label="Legend">
          {series.map((item, index) => (
            <li key={item.name} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[index] }} aria-hidden />
              {item.name}
            </li>
          ))}
        </ul>
        <button onClick={() => setAsTable((value) => !value)} className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-64 overflow-auto rounded-lg border border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                {series.map((item) => (
                  <th key={item.name} className="px-3 py-2 text-right font-medium">
                    {item.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {dates.map((date, index) => (
                <tr key={date} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-600">{label(date)}</td>
                  {series.map((item) => (
                    <td key={item.name} className="px-3 py-1.5 text-right text-slate-900">
                      {item.values[index]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full overflow-visible" role="img" aria-labelledby={titleId} onPointerLeave={() => setHover(null)}>
            <title id={titleId}>{series.map((item) => item.name).join(" and ")} per day</title>
            {ticks.map((tick) => {
              const y = plotHeight - (tick / max) * plotHeight;
              return (
                <g key={tick}>
                  <line x1={padLeft} x2={width} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
                  <text x={padLeft - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px] tabular-nums">
                    {tick.toLocaleString()}
                  </text>
                </g>
              );
            })}
            {dates.map((date, index) => {
              const x0 = padLeft + index * band + (band - groupWidth) / 2;
              return (
                <g key={date}>
                  {hover === index && <rect x={padLeft + index * band} y={0} width={band} height={plotHeight} fill="var(--hover-band)" />}
                  {series.map((item, s) => {
                    const value = item.values[index];
                    const h = (value / max) * plotHeight;
                    const x = x0 + s * (bar + 2);
                    const y = plotHeight - h;
                    const r = Math.min(4, h, bar / 2);
                    return value > 0 ? (
                      <path
                        key={item.name}
                        d={`M${x},${plotHeight} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${plotHeight} Z`}
                        fill={SERIES[s]}
                      />
                    ) : null;
                  })}
                  {index % labelEvery === 0 && (
                    <text x={padLeft + index * band + band / 2} y={height - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">
                      {label(date)}
                    </text>
                  )}
                  <rect
                    x={padLeft + index * band}
                    y={0}
                    width={band}
                    height={plotHeight}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${label(date)}: ${series.map((item) => `${item.name} ${item.values[index]}`).join(", ")}`}
                    onPointerEnter={() => setHover(index)}
                    onFocus={() => setHover(index)}
                    onBlur={() => setHover(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
            <line x1={padLeft} x2={width} y1={plotHeight} y2={plotHeight} stroke="var(--axis)" strokeWidth={1} />
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-36 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
              style={{ left: `${((padLeft + hover * band + band / 2) / width) * 100}%` }}
            >
              <p className="mb-1 font-medium text-slate-500">{label(dates[hover])}</p>
              {series.map((item, index) => (
                <p key={item.name} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <span className="h-0.5 w-3 rounded" style={{ background: SERIES[index] }} aria-hidden />
                    {item.name}
                  </span>
                  <b className="tabular-nums text-slate-950">{item.values[hover]}</b>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Smallest whole-number step from the 1-2-5 series that is >= raw, so every tick is an integer. */
function niceStep(raw: number) {
  if (raw <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= raw) ?? magnitude * 10;
}

/** Fills the last `days` calendar days so gaps show as zero rather than disappearing. */
export function lastNDays(days: number, nowMs: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(nowMs);
    date.setDate(date.getDate() - (days - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}
