"use client";

import { MessageSquarePlus, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFieldAgents, useSimulateInbound } from "@/lib/api";
import { Button, ErrorNotice, Field, inputClass } from "./ui";

const SAMPLES = [
  "Hi, the tower at my site has been down since morning. Customers can't make calls.",
  "Please help, my float balance is not updating after the last top-up.",
  "Need approval to replace a damaged SIM registration kit.",
  "Network is very slow in Kabwata market area, can you check?",
];

type SimulatorContextValue = { open: (phone?: string) => void };
const SimulatorContext = createContext<SimulatorContextValue | null>(null);

export function useSimulator() {
  const value = useContext(SimulatorContext);
  if (!value) throw new Error("useSimulator must be used inside SimulatorProvider");
  return value;
}

export function SimulatorProvider({ children }: { children: ReactNode }) {
  const [phone, setPhone] = useState<string | null>(null);
  const open = useCallback((initial?: string) => setPhone(initial ?? ""), []);
  return (
    <SimulatorContext.Provider value={{ open }}>
      {children}
      {phone !== null && <SimulatorDialog initialPhone={phone} onClose={() => setPhone(null)} />}
    </SimulatorContext.Provider>
  );
}

function SimulatorDialog({ initialPhone, onClose }: { initialPhone: string; onClose: () => void }) {
  const agents = useFieldAgents();
  const simulate = useSimulateInbound();
  const [phone, setPhone] = useState(initialPhone);
  const [text, setText] = useState(SAMPLES[0]);
  const [result, setResult] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedPhone = phone || agents.data?.[0]?.phone || "";

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const submit = async () => {
    if (!selectedPhone || !text.trim()) return;
    const response = await simulate.mutateAsync({ phone: selectedPhone, text: text.trim() });
    setResult(response.duplicate ? "Duplicate message ignored." : `Delivered to ${response.reference}.`);
    setText(SAMPLES[Math.floor(Math.random() * SAMPLES.length)]);
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => event.target === dialogRef.current && onClose()}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <MessageSquarePlus size={18} aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Simulate inbound WhatsApp</h2>
            <p className="text-xs text-slate-500">Sends a message as if a field agent wrote in.</p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <Field label="From field agent">
          <select value={selectedPhone} onChange={(event) => setPhone(event.target.value)} className={inputClass}>
            {(agents.data ?? []).map((agent) => (
              <option key={agent.id} value={agent.phone}>
                {agent.name} · {agent.phone}
                {agent.region ? ` · ${agent.region}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Message">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            className={`${inputClass} resize-none`}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((sample) => (
            <button
              key={sample}
              onClick={() => setText(sample)}
              className="max-w-full truncate rounded-full border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            >
              {sample.slice(0, 38)}…
            </button>
          ))}
        </div>
        {simulate.error && <ErrorNotice error={simulate.error} />}
        {result && !simulate.error && (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {result}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" onClick={submit} loading={simulate.isPending} disabled={!selectedPhone || !text.trim()}>
          Send message
        </Button>
      </div>
    </dialog>
  );
}
