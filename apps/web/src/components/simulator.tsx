"use client";

import { Bot, Camera, IdCard, SendHorizontal, Smartphone, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFieldAgents, useSimulateInbound, useTickets, type InboundInput, type MenuOption } from "@/lib/api";
import { cn, shortTime } from "@/lib/format";
import { useIdentity } from "@/lib/identity";
import { ErrorNotice, inputClass } from "./ui";

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
      {phone !== null && <AgentPhone initialPhone={phone} onClose={() => setPhone(null)} />}
    </SimulatorContext.Provider>
  );
}

const STARTERS = ["Hi", "PIN reset", "Customer forgot pin"];

/**
 * A field agent's WhatsApp, simulated: shows the conversation from the
 * Connect Store side so the bot menu, details request and staff replies can
 * be exercised end to end before Meta credentials are connected.
 */
function AgentPhone({ initialPhone, onClose }: { initialPhone: string; onClose: () => void }) {
  const agents = useFieldAgents();
  const tickets = useTickets();
  const simulate = useSimulateInbound();
  const { isSupervisor } = useIdentity();
  const [phone, setPhone] = useState(initialPhone);
  const [text, setText] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedPhone = phone || agents.data?.[0]?.phone || "";
  const agent = agents.data?.find((item) => item.phone === selectedPhone);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  // The agent's most recent conversation (back-office users only see their own tickets).
  const ticket = useMemo(
    () =>
      (tickets.data ?? [])
        .filter((item) => item.agent.phone === selectedPhone)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0],
    [tickets.data, selectedPhone],
  );
  const messages = ticket?.messages ?? [];
  const lastBot = [...messages].reverse().find((message) => message.direction === "OUTBOUND");
  const menu: MenuOption[] = lastBot?.sender === "bot" && ticket && ["MENU", "OTHER_MENU"].includes(ticket.botState) ? (lastBot.interactive?.options ?? []) : [];
  const awaitingDetails = ticket?.botState === "AWAITING_PIN_DETAILS";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, simulate.isPending]);

  const send = (input: Omit<InboundInput, "phone">) => {
    if (!selectedPhone) return;
    simulate.mutate({ phone: selectedPhone, ...input }, { onSuccess: () => tickets.refetch() });
  };
  const sendText = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    send({ text: body });
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => event.target === dialogRef.current && onClose()}
      className="m-auto h-[min(760px,calc(100dvh-2rem))] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-[1.75rem] border-[6px] border-slate-900 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
          <Smartphone size={18} aria-hidden className="opacity-80" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">GSM Support</p>
            <p className="truncate text-[11px] opacity-80">Simulated WhatsApp · as a field agent</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 opacity-80 hover:bg-white/10 hover:opacity-100" aria-label="Close simulator">
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
          <select value={selectedPhone} onChange={(event) => setPhone(event.target.value)} aria-label="Field agent" className={cn(inputClass, "py-1.5 text-xs")}>
            {(agents.data ?? []).map((item) => (
              <option key={item.id} value={item.phone}>
                {item.name} · {item.storeName ?? item.region ?? item.phone}
              </option>
            ))}
          </select>
          {agent && <p className="mt-1 px-1 text-[11px] text-slate-500">{agent.phone}{agent.shopType ? ` · ${agent.shopType}` : ""}</p>}
        </div>

        <div ref={scrollRef} className="chat-wallpaper scrollbar-thin flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
          {!isSupervisor && (
            <p className="rounded-lg bg-white/90 px-3 py-2 text-center text-[11px] text-slate-500 shadow-sm">
              Switch to the Supervisor view to see the full conversation here; back-office staff only see tickets assigned to them.
            </p>
          )}
          {messages.length === 0 && isSupervisor && (
            <p className="rounded-lg bg-white/90 px-3 py-2 text-center text-[11px] text-slate-500 shadow-sm">Send a message to start a conversation with GSM Support.</p>
          )}
          {messages.map((message) => {
            // Mirror image of the desk: the agent's messages are on the right here.
            const mine = message.direction === "INBOUND";
            return (
              <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[85%] rounded-xl px-3 pb-1 pt-1.5 text-[13px] shadow-[0_1px_0.5px_rgba(15,23,42,0.13)]", mine ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white")}>
                  {message.sender === "bot" && (
                    <p className="flex items-center gap-1 text-[10px] font-semibold text-violet-700">
                      <Bot size={10} aria-hidden /> GSM Bot
                    </p>
                  )}
                  {message.mediaType && <p className="mb-1 flex items-center gap-1 text-[11px] text-slate-500"><Camera size={12} aria-hidden /> Photo</p>}
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  {(message.interactive?.options?.length ?? 0) > 0 && <p className="mt-1 border-t border-slate-100 pt-1 text-center text-[11px] font-medium text-sky-700">☰ {message.interactive?.button ?? "Select"}</p>}
                  <p className="text-right text-[10px] text-slate-400">{shortTime(message.createdAt)}</p>
                </div>
              </div>
            );
          })}
          {simulate.isPending && (
            <div className="flex justify-end">
              <div className="rounded-xl bg-[#d9fdd3]/70 px-3 py-1.5 text-[13px] text-slate-500">Sending…</div>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-3 pb-3 pt-2">
          {menu.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-slate-500">Tap an option</p>
              <div className="grid grid-cols-2 gap-1.5">
                {menu.map((option) => (
                  <button
                    key={option.id}
                    disabled={simulate.isPending}
                    onClick={() => send({ replyId: option.id, text: option.title })}
                    className="rounded-lg border border-sky-200 bg-white px-2 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                  >
                    {option.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          {awaitingDetails && (
            <div className="flex flex-wrap gap-1.5">
              <button
                disabled={simulate.isPending}
                onClick={() => send({ text: `Customer MSISDN 0971234567, ${agent?.storeName ?? "store"}. NRC front & back and live photo attached.` })}
                className="rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-50"
              >
                Send customer details
              </button>
            </div>
          )}
          {ticket && !menu.length && (
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Live photo", icon: Camera, caption: "Live photo of customer in store" },
                { label: "NRC front", icon: IdCard, caption: "NRC front" },
                { label: "NRC back", icon: IdCard, caption: "NRC back" },
              ].map((item) => (
                <button
                  key={item.label}
                  disabled={simulate.isPending}
                  onClick={() => send({ text: item.caption, mediaType: "image" })}
                  className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                >
                  <item.icon size={12} aria-hidden /> {item.label}
                </button>
              ))}
            </div>
          )}
          {!ticket && (
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((starter) => (
                <button key={starter} onClick={() => send({ text: starter })} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50">
                  {starter}
                </button>
              ))}
            </div>
          )}
          {simulate.error && <ErrorNotice error={simulate.error} />}
          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && sendText()}
              placeholder="Message"
              aria-label="Message as field agent"
              className="h-10 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm outline-none focus:border-emerald-400"
            />
            <button
              onClick={sendText}
              disabled={!text.trim() || simulate.isPending || !selectedPhone}
              className="grid h-10 w-10 place-items-center rounded-full bg-[#00a884] text-white disabled:opacity-40"
              aria-label="Send"
            >
              <SendHorizontal size={17} />
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
