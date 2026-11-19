"use client";

import { Check, ClipboardCopy, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useResponses } from "@/lib/api";
import { cn } from "@/lib/format";
import { EffectPill } from "../responses";
import { Card, EmptyState, ErrorNotice, inputClass, PageHeader, Skeleton } from "../ui";

const ORDER = ["Acknowledge", "Successful", "Call outcome", "Escalation required", "Documents & ID", "Number & account", "Follow-up", "Redirect"];

export function ResponsesView() {
  const responses = useResponses();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const categories = useMemo(
    () => ORDER.filter((name) => (responses.data ?? []).some((response) => response.category === name)),
    [responses.data],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (responses.data ?? [])
      .filter((response) => !category || response.category === category)
      .filter((response) => !needle || `${response.title} ${response.body}`.toLowerCase().includes(needle))
      .sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));
  }, [responses.data, query, category]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Standard responses"
        description="The GSM back-office WhatsApp templates. In a conversation, type / to insert one; sending it also records the outcome on the case."
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search responses" aria-label="Search responses" className={cn(inputClass, "pl-9")} />
        </div>
        <div className="no-scrollbar flex gap-1 overflow-x-auto">
          {["", ...categories].map((name) => (
            <button
              key={name || "all"}
              onClick={() => setCategory(name)}
              aria-pressed={category === name}
              className={cn("shrink-0 rounded-full px-3 py-1 text-xs font-medium", category === name ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}
            >
              {name || "All"}
            </button>
          ))}
        </div>
      </div>

      {responses.isError && <ErrorNotice error={responses.error} onRetry={() => responses.refetch()} />}
      {responses.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState title="No responses match" />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((response) => (
            <article key={response.id} className="flex flex-col rounded-xl border border-slate-200 bg-white">
              <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{response.category}</p>
                  <h2 className="text-sm font-semibold text-slate-900">{response.title}</h2>
                  <EffectPill response={response} className="mt-1.5" />
                </div>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(response.body);
                      setCopied(response.id);
                      window.setTimeout(() => setCopied(null), 1500);
                    } catch {
                      /* clipboard blocked */
                    }
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  {copied === response.id ? <Check size={12} aria-hidden /> : <ClipboardCopy size={12} aria-hidden />}
                  {copied === response.id ? "Copied" : "Copy"}
                </button>
              </header>
              <p className="whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-slate-700 [overflow-wrap:anywhere]">{response.body}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
