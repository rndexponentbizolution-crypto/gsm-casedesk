"use client";

import { AlertTriangle, Check, CheckCircle2, ClipboardCopy, Flag, Mail, PhoneCall, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { useUpdateCase, type CaseDetails, type Ticket } from "@/lib/api";
import { cn, formatDuration, isOpen, slaState } from "@/lib/format";
import { ErrorNotice, inputClass } from "./ui";

const THRESHOLD = 5000;

/* SOP Step 2: completeness check before any system verification. */
const VALIDATION: Array<{ key: string; label: string; fix?: string }> = [
  { key: "livePhoto", label: "Live photo taken in store, background visible", fix: "doc-not-in-store" },
  { key: "msisdn", label: "Customer MSISDN clearly stated", fix: "num-incorrect" },
  { key: "requestStated", label: "Request clearly stated (PIN reset)", fix: "follow-specify-query" },
  { key: "nrcFront", label: "NRC front: original hard copy, clear", fix: "doc-original-nrc" },
  { key: "nrcBack", label: "NRC back: original hard copy, clear", fix: "doc-original-nrc" },
  { key: "storeName", label: "Store / container named", fix: "doc-missing-live-nrc" },
  { key: "validId", label: "ID is a valid NRC or passport", fix: "doc-invalid-id" },
  { key: "notForwarded", label: "Sent directly, not a forwarded message", fix: "follow-forwarded" },
];

/* SOP Step 3: system verification. `flag` = the standard response for a failed check. */
const VERIFICATION: Array<{ system: string; items: Array<{ key: string; label: string; flag: string }> }> = [
  {
    system: "Web Care & DCLM",
    items: [
      { key: "wcPhoto", label: "Live photo matches photo on record", flag: "esc-live-picture-mismatch" },
      { key: "wcMsisdn", label: "MSISDN registered, active and linked", flag: "num-incorrect" },
      { key: "wcNrc", label: "NRC details match registration", flag: "esc-affidavit-nrc" },
      { key: "wcSimSwap", label: "No recent or suspicious SIM swap", flag: "esc-sim-swap" },
      { key: "wcActive", label: "Account active, not terminated", flag: "num-terminated" },
    ],
  },
  {
    system: "ECW",
    items: [
      { key: "ecwOwner", label: "MoMo account exists, ownership verified", flag: "esc-no-momo" },
      { key: "ecwFraud", label: "No fraud-prevention profile", flag: "esc-fraud-profile" },
      { key: "ecwBlocked", label: "Account not blocked", flag: "esc-blocked" },
      { key: "ecwDob", label: "Date of birth matches MoMo profile", flag: "esc-affidavit-dob" },
      { key: "ecwConsistent", label: "MoMo and SIM registration consistent", flag: "esc-affidavit-sim-momo" },
    ],
  },
];

const CALL_OUTCOMES = [
  { id: "success-pin-reset", label: "Reset successful", tone: "good" },
  { id: "call-not-answering", label: "Not answering" },
  { id: "call-no-response", label: "Answered, no response" },
  { id: "call-security-questions", label: "Failed security questions" },
  { id: "call-info-mismatch", label: "Details mismatch" },
  { id: "call-unreachable", label: "Unreachable" },
  { id: "call-phone-off", label: "Phone off" },
  { id: "call-language-barrier", label: "Language barrier" },
  { id: "call-microphone", label: "Microphone issue" },
  { id: "prompt-already-sent", label: "Prompt already sent" },
  { id: "prompt-three-times", label: "Prompt sent 3+ times" },
] as const;

function Section({ step, title, done, children }: { step: string; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold", done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600")}>
          {done ? <Check size={12} aria-label="Complete" /> : step}
        </span>
        <h3 className="text-xs font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function SlaCard({ ticket, now }: { ticket: Ticket; now: number }) {
  const sla = slaState(ticket, now);
  if (sla.level === "none") {
    if (ticket.slaDueAt && ticket.details.executedAt) {
      const met = new Date(ticket.details.executedAt).getTime() <= new Date(ticket.slaDueAt).getTime();
      return (
        <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs", met ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>
          <Timer size={14} aria-hidden /> SLA {met ? "met" : "missed"} · handled in {formatDuration(new Date(ticket.details.executedAt).getTime() - new Date(ticket.createdAt).getTime())}
        </div>
      );
    }
    return null;
  }
  const escalated = ticket.status === "ESCALATED";
  return (
    <div
      role="timer"
      className={cn(
        "rounded-lg px-3 py-2.5",
        sla.level === "ok" && "bg-emerald-50 text-emerald-900",
        sla.level === "soon" && "bg-amber-50 text-amber-900",
        sla.level === "breached" && "bg-red-50 text-red-900",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          {sla.level === "breached" ? <AlertTriangle size={14} aria-hidden /> : <Timer size={14} aria-hidden />}
          {escalated ? "Escalation feedback due" : ticket.queryType === "PIN_RESET" ? "PIN reset SLA (5 min)" : "SLA"}
        </span>
        <span className="font-mono text-lg font-semibold tabular-nums">{sla.label}</span>
      </div>
      {ticket.queryType === "PIN_RESET" && !escalated && (
        <p className="mt-1 text-[11px] opacity-80">Call the customer within 3 minutes of acknowledgement.</p>
      )}
    </div>
  );
}

function useCaseDetails(ticket: Ticket) {
  const update = useUpdateCase(ticket.id);
  const [local, setLocal] = useState<CaseDetails>(ticket.details);
  // Server data wins whenever it changes (another agent, or our own save landing).
  useEffect(() => setLocal(ticket.details), [ticket.details]);
  const save = (patch: Partial<CaseDetails>) => {
    setLocal((current) => ({
      ...current,
      ...patch,
      validation: { ...current.validation, ...patch.validation },
      verification: { ...current.verification, ...patch.verification },
    }));
    update.mutate({ details: patch });
  };
  return { local, save, update };
}

function Checklist({
  items,
  values,
  disabled,
  onToggle,
  onFlag,
}: {
  items: Array<{ key: string; label: string; fix?: string; flag?: string }>;
  values: Record<string, boolean> | undefined;
  disabled: boolean;
  onToggle: (key: string, value: boolean) => void;
  onFlag: (responseId: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const checked = Boolean(values?.[item.key]);
        const responseId = item.flag ?? item.fix;
        return (
          <li key={item.key} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-slate-50">
            <input
              id={`chk-${item.key}`}
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(event) => onToggle(item.key, event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600"
            />
            <label htmlFor={`chk-${item.key}`} className={cn("flex-1 text-[13px] leading-snug", checked ? "text-slate-500" : "text-slate-800")}>
              {item.label}
            </label>
            {!checked && responseId && !disabled && (
              <button
                onClick={() => onFlag(responseId)}
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-red-700 opacity-70 hover:bg-red-50 hover:opacity-100 group-hover:opacity-100"
                title="Load the standard response for this problem"
              >
                <Flag size={11} aria-hidden /> Flag
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** PIN reset casework: SOP steps 2 (validate), 3 (verify), 4 (call) and log fields. */
export function PinResetWorkspace({
  ticket,
  canAct,
  onUseResponse,
}: {
  ticket: Ticket;
  canAct: boolean;
  onUseResponse: (responseId: string) => void;
}) {
  const { local, save, update } = useCaseDetails(ticket);
  const open = isOpen(ticket) && ticket.status !== "ESCALATED";
  const disabled = !canAct || !open;
  const validated = VALIDATION.every((item) => local.validation?.[item.key]);
  const verifyItems = VERIFICATION.flatMap((group) => group.items);
  const verified = verifyItems.every((item) => local.verification?.[item.key]);
  const balance = local.balanceZmw;
  const overThreshold = typeof balance === "number" && balance > THRESHOLD;
  const balanceOk = typeof balance === "number" && balance <= THRESHOLD;
  const readyToCall = validated && verified && balanceOk;
  const [balanceText, setBalanceText] = useState(balance === null || balance === undefined ? "" : String(balance));
  useEffect(() => setBalanceText(balance === null || balance === undefined ? "" : String(balance)), [balance]);

  return (
    <div className="space-y-5">
      <Section step="2" title="Validate the submission" done={validated}>
        <Checklist
          items={VALIDATION}
          values={local.validation}
          disabled={disabled}
          onToggle={(key, value) => save({ validation: { [key]: value } })}
          onFlag={onUseResponse}
        />
      </Section>

      <Section step="3" title="Verify in systems" done={verified && balanceOk}>
        <div className="space-y-3">
          {VERIFICATION.map((group) => (
            <div key={group.system}>
              <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">{group.system}</p>
              <Checklist
                items={group.items}
                values={local.verification}
                disabled={disabled}
                onToggle={(key, value) => save({ verification: { [key]: value } })}
                onFlag={onUseResponse}
              />
            </div>
          ))}
          <div className="px-1">
            <label htmlFor="balance" className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              MoMo balance (ZMW)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="balance"
                inputMode="decimal"
                value={balanceText}
                disabled={disabled}
                onChange={(event) => setBalanceText(event.target.value.replace(/[^\d.]/g, ""))}
                onBlur={() => {
                  const next = balanceText === "" ? null : Number(balanceText);
                  if (next !== (balance ?? null)) save({ balanceZmw: next });
                }}
                placeholder="From ECW"
                className={cn(inputClass, "py-1.5 tabular-nums", overThreshold && "border-red-300 bg-red-50")}
              />
              <span className="shrink-0 text-[11px] text-slate-400">limit K{THRESHOLD.toLocaleString()}</span>
            </div>
            {overThreshold && (
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                <div className="flex-1">
                  Above the K{THRESHOLD.toLocaleString()} threshold: this must be escalated.
                  {!disabled && (
                    <button onClick={() => onUseResponse("esc-above-threshold")} className="ml-1 font-semibold underline underline-offset-2">
                      Load escalation response
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section step="4" title="Call the customer and record the outcome" done={!isOpen(ticket)}>
        {readyToCall && open && (
          <p className="mb-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <PhoneCall size={14} aria-hidden /> All checks passed. Call {local.msisdn || "the customer"} from Ameyo/CUG (115).
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {CALL_OUTCOMES.map((outcome) => (
            <button
              key={outcome.id}
              disabled={disabled}
              onClick={() => onUseResponse(outcome.id)}
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40",
                "tone" in outcome ? "border-emerald-200 text-emerald-800 hover:bg-emerald-50" : "border-slate-200 text-slate-700 hover:bg-slate-50",
              )}
            >
              {outcome.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Each outcome loads the standard response; review it, then send.</p>
      </Section>

      {update.error && <ErrorNotice error={update.error} />}
    </div>
  );
}

/** SOP Step 6 log fields. */
export function LogFields({ ticket, canAct }: { ticket: Ticket; canAct: boolean }) {
  const { local, save, update } = useCaseDetails(ticket);
  const fields: Array<{ key: "msisdn" | "nrcNumber" | "locationName" | "shopType" | "region"; label: string; fallback?: string | null }> = [
    { key: "msisdn", label: "Customer MSISDN" },
    { key: "nrcNumber", label: "NRC number" },
    { key: "locationName", label: "Store / container", fallback: ticket.agent.storeName },
    { key: "shopType", label: "Shop type", fallback: ticket.agent.shopType },
    { key: "region", label: "Region / province", fallback: ticket.agent.region },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {fields.map((field) => (
        <LogField
          key={field.key}
          label={field.label}
          value={local[field.key] ?? ""}
          placeholder={field.fallback ?? "—"}
          disabled={!canAct}
          wide={field.key === "locationName"}
          onSave={(value) => save({ [field.key]: value })}
        />
      ))}
      {update.error && (
        <div className="col-span-2">
          <ErrorNotice error={update.error} />
        </div>
      )}
    </div>
  );
}

function LogField({ label, value, placeholder, disabled, wide, onSave }: { label: string; value: string; placeholder: string; disabled: boolean; wide?: boolean; onSave: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className={cn("block", wide && "col-span-2")}>
      <span className="text-[11px] text-slate-500">{label}</span>
      <input
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => text.trim() !== value && onSave(text.trim())}
        onKeyDown={(event) => event.key === "Enter" && (event.target as HTMLInputElement).blur()}
        className={cn(inputClass, "mt-0.5 px-2 py-1.5 text-[13px]")}
      />
    </label>
  );
}

/** SOP Step 5: what the field agent must email, with a ready-made email. */
export function EscalationCard({ ticket }: { ticket: Ticket }) {
  const escalation = ticket.details.escalation;
  const [copied, setCopied] = useState(false);
  if (!escalation) return null;
  const subject = `${escalation.subject} — ${ticket.reference}`;
  const body = [
    `Reference: ${ticket.reference}`,
    `Customer MSISDN: ${ticket.details.msisdn ?? ""}`,
    `NRC number: ${ticket.details.nrcNumber ?? ""}`,
    `Store: ${ticket.details.locationName || ticket.agent.storeName || ""}`,
    `Escalated by: ${ticket.agent.name} (${ticket.agent.phone})`,
    "",
    "Attachments:",
    ...escalation.attachments.map((item) => `- ${item}`),
  ].join("\n");
  return (
    <section className="rounded-xl border border-red-200 bg-red-50/50 p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-red-800">
        <AlertTriangle size={14} aria-hidden /> Escalated by email
      </p>
      <dl className="mt-3 space-y-2 text-[13px]">
        <div>
          <dt className="text-[11px] text-slate-500">Subject</dt>
          <dd className="font-medium text-slate-900">{escalation.subject}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Send to</dt>
          <dd className="font-mono text-xs text-slate-800 [overflow-wrap:anywhere]">{escalation.email}</dd>
        </div>
        {escalation.attachments.length > 0 && (
          <div>
            <dt className="text-[11px] text-slate-500">Required attachments</dt>
            <dd>
              <ul className="mt-1 space-y-0.5">
                {escalation.attachments.map((item) => (
                  <li key={item} className="flex items-center gap-1.5 text-slate-700">
                    <CheckCircle2 size={12} className="text-slate-400" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt className="text-[11px] text-slate-500">Feedback due</dt>
          <dd className="text-slate-800">{new Date(escalation.dueAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={`mailto:${escalation.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800"
        >
          <Mail size={13} aria-hidden /> Draft email
        </a>
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${subject}\n\n${body}`);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked: the mail draft still works */
            }
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <ClipboardCopy size={13} aria-hidden /> {copied ? "Copied" : "Copy details"}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Per SOP, follow-up for this case now happens by email, not WhatsApp.</p>
    </section>
  );
}
