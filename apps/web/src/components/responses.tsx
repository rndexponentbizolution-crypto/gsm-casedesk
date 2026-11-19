"use client";

import { BookOpenText, CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StandardResponse, Ticket } from "@/lib/api";
import { cn, describeEffect } from "@/lib/format";

export const EFFECT_TONE = {
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  bad: "bg-slate-100 text-slate-700 ring-slate-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  esc: "bg-red-50 text-red-800 ring-red-200",
} as const;

export function EffectPill({ response, className }: { response: StandardResponse; className?: string }) {
  const { label, tone } = describeEffect(response.effect);
  return (
    <span className={cn("inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset", EFFECT_TONE[tone], className)}>
      {label}
    </span>
  );
}

const CATEGORY_ORDER = ["Acknowledge", "Successful", "Call outcome", "Escalation required", "Documents & ID", "Number & account", "Follow-up", "Redirect"];

/** Which standard responses fit where a case currently is (SOP steps 2–5). */
export function suggestedResponseIds(ticket: Ticket): string[] {
  if (ticket.status === "PENDING_INFORMATION") return ["follow-reprocessing", "follow-working-on-it", "success-pin-reset"];
  if (ticket.status === "ESCALATED") return ["follow-working-on-it", "escalated-partners"];
  if (ticket.queryType === "PIN_RESET") {
    const balance = ticket.details.balanceZmw;
    if (typeof balance === "number" && balance > 5000) return ["esc-above-threshold", "follow-working-on-it"];
    return ["success-pin-reset", "call-not-answering", "doc-missing-live-nrc", "esc-above-threshold"];
  }
  if (!ticket.queryType) return ["follow-specify-query", "redirect-email"];
  return ["redirect-email", "follow-working-on-it"];
}

export function ResponsePicker({
  responses,
  queryType,
  initialQuery = "",
  onPick,
  onClose,
}: {
  responses: StandardResponse[];
  queryType: string | null;
  initialQuery?: string;
  onPick: (response: StandardResponse) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return responses
      .filter((response) => !needle || `${response.title} ${response.category} ${response.body}`.toLowerCase().includes(needle))
      .map((response) => ({
        response,
        // Responses scoped to this query type first, generic ones next, other types last.
        rank: !response.queryTypes ? 1 : queryType && response.queryTypes.includes(queryType) ? 0 : 2,
      }))
      .sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.response.category) - CATEGORY_ORDER.indexOf(b.response.category) || a.rank - b.rank,
      )
      .map((item) => item.response);
  }, [responses, query, queryType]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const current = filtered[active];
  let lastCategory = "";

  return (
    <div
      role="dialog"
      aria-label="Standard responses"
      className="absolute inset-x-0 bottom-full z-30 mb-2 flex max-h-[min(70vh,520px)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((index) => Math.min(filtered.length - 1, index + 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((index) => Math.max(0, index - 1));
        } else if (event.key === "Enter" && current) {
          event.preventDefault();
          onPick(current);
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <Search size={15} className="text-slate-400" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search standard responses…"
          aria-label="Search standard responses"
          className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
        <span className="hidden text-[11px] text-slate-400 sm:inline">{filtered.length} responses</span>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close responses">
          <X size={15} />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div ref={listRef} className="scrollbar-thin min-h-0 overflow-y-auto py-1" role="listbox" aria-label="Responses">
          {filtered.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">No responses match.</p>}
          {filtered.map((response, index) => {
            const header = response.category !== lastCategory;
            lastCategory = response.category;
            return (
              <div key={response.id}>
                {header && <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{response.category}</p>}
                <button
                  data-index={index}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onPick(response)}
                  className={cn("flex w-full flex-col items-start gap-1 px-3 py-2 text-left", index === active ? "bg-amber-50" : "hover:bg-slate-50")}
                >
                  <span className="text-sm text-slate-900">{response.title}</span>
                  <EffectPill response={response} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="hidden min-h-0 flex-col border-l border-slate-100 bg-slate-50/60 md:flex">
          {current ? (
            <>
              <p className="whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{current.body}</p>
              <div className="mt-auto flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
                <CornerDownLeft size={12} aria-hidden /> Enter to insert · edit before sending
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-slate-300">
              <BookOpenText size={28} aria-hidden />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
