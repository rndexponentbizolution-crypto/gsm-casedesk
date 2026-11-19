"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Send, MoreHorizontal, Inbox, BarChart3, Users, Settings, ShieldCheck, Paperclip, AlertTriangle } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type Message = { id: string; direction: "INBOUND" | "OUTBOUND" | "INTERNAL"; body: string; state: string; simulated: boolean; createdAt: string };
type Ticket = { id: string; reference: string; subject: string; status: string; priority: number; agent: { name: string; phone: string }; assignee: string; messages: Message[]; audit: unknown[]; lastMessageAt: string };

export default function Home() {
  const [role, setRole] = useState("SUPERVISOR");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("My Tickets");
  const [phone, setPhone] = useState("+260970000001");
  const [simText, setSimText] = useState("Customer needs help with a network issue.");
  const [metrics, setMetrics] = useState<Record<string, unknown>>({});
  const [report, setReport] = useState<Record<string, unknown>>({});

  const headers = { "x-demo-role": role, "x-demo-user": role === "SUPERVISOR" ? "demo-supervisor" : "demo-agent-1" };
  const load = async () => {
    const [ticketResponse, dashboardResponse] = await Promise.all([
      fetch(`${API}/api/tickets`, { headers }),
      fetch(`${API}/api/dashboard`, { headers }),
    ]);
    if (ticketResponse.ok) {
      const data = await ticketResponse.json();
      setTickets(data);
      setSelectedId((current) => current && data.some((ticket: Ticket) => ticket.id === current) ? current : data[0]?.id ?? "");
    }
    if (dashboardResponse.ok) setMetrics(await dashboardResponse.json());
    if (role === "SUPERVISOR") {
      const reportResponse = await fetch(`${API}/api/reports`, { headers });
      if (reportResponse.ok) setReport(await reportResponse.json());
    }
  };

  useEffect(() => { load().catch(() => undefined); }, [role]);

  const filtered = useMemo(() => tickets.filter((ticket) =>
    `${ticket.reference} ${ticket.agent.name} ${ticket.subject}`.toLowerCase().includes(query.toLowerCase())
  ), [tickets, query]);
  const selected = tickets.find((ticket) => ticket.id === selectedId);

  const sendReply = async () => {
    if (!selected || !text.trim()) return;
    await fetch(`${API}/api/tickets/${selected.id}/reply`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    setText("");
    await load();
  };

  const simulate = async () => {
    await fetch(`${API}/api/simulator/inbound`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, text: simText }) });
    await load();
  };

  const simulator = (
    <>
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Simulation</h3>
      <select value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-3 w-full rounded-md border border-slate-200 p-2 text-xs"><option value="+260970000001">Joseph Tembo</option><option value="+260970000002">Ruth Phiri</option></select>
      <textarea value={simText} onChange={(event) => setSimText(event.target.value)} className="mt-2 w-full rounded-md border border-slate-200 p-2 text-xs" rows={3}/>
      <button onClick={simulate} className="mt-2 w-full rounded-md border border-slate-300 py-2 text-xs font-bold">Send simulated message</button>
    </>
  );

  return (
    <main className="h-screen overflow-hidden bg-[#f4f5f7] text-slate-950">
      <aside className="fixed inset-y-0 left-0 w-[220px] border-r border-slate-200 bg-[#15171b] px-3 py-5 text-slate-300">
        <div className="mb-7 flex items-center gap-3 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#ffd200] font-black text-slate-950">G</div>
          <div><b className="text-sm text-white">GSM CaseDesk</b><p className="text-[10px] text-slate-500">Zambia Operations</p></div>
        </div>
        {[
          ["Dashboard", BarChart3], ["My Tickets", Inbox], ["All Tickets", Inbox], ["Escalated", AlertTriangle],
          ["Reports", BarChart3], ["Field Agents", Users], ["Staff Management", Users], ["Settings", Settings],
        ].map(([label, Icon]) => (
          <button key={String(label)} onClick={() => setTab(String(label))} className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${tab === label ? "bg-white/10 text-white" : "hover:bg-white/5"}`}>
            <Icon size={17} /><span>{String(label)}</span>
          </button>
        ))}
      </aside>

      <section className="ml-[220px] grid h-screen grid-cols-[340px_1fr]">
        <div className="border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-bold">{tab}</h1>
              <select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
                <option>SUPERVISOR</option><option>BACK_OFFICE</option>
              </select>
            </div>
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3">
              <Search size={15} className="text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="w-full bg-transparent px-2 py-2 text-sm outline-none" />
            </div>
          </div>
          <div className="overflow-y-auto">
            {tab === "Reports" ? (
              <div className="p-5">
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ["Open", report.open],
                    ["Created", report.ticketsCreated],
                    ["Resolved", report.ticketsResolved],
                    ["Failed outbound", report.failedOutboundMessages],
                  ] as Array<[string, unknown]>).map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl border border-slate-200 p-4">
                      <p className="text-xs text-slate-400">{label}</p>
                      <p className="mt-1 text-xl font-bold">{String(value ?? 0)}</p>
                    </div>
                  ))}
                </div>
                <button
                  onClick={async () => {
                    const response = await fetch(`${API}/api/reports.csv`, { headers });
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement("a");
                    anchor.href = url;
                    anchor.download = "gsm-casedesk-report.csv";
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="mt-4 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white"
                >
                  Export authorised CSV
                </button>
              </div>
            ) : filtered.map((ticket) => (
              <button key={ticket.id} onClick={() => setSelectedId(ticket.id)} className={`w-full border-b border-slate-100 px-5 py-4 text-left transition hover:bg-slate-50 ${selectedId === ticket.id ? "bg-amber-50" : ""}`}>
                <div className="flex items-start justify-between"><div><p className="text-sm font-bold">{ticket.agent.name}</p><p className="mt-0.5 text-xs font-semibold text-amber-700">{ticket.reference}</p></div><span className="text-[10px] text-slate-400">{new Date(ticket.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
                <p className="mt-2 truncate text-xs text-slate-500">{ticket.messages.at(-1)?.body ?? ticket.subject}</p>
                <div className="mt-2 flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">{ticket.status}</span><span className="text-[10px] text-slate-400">{ticket.assignee}</span></div>
              </button>
            ))}
            {tab !== "Reports" && !filtered.length && <div className="px-6 py-16 text-center text-sm text-slate-400">No authorised conversations</div>}
          </div>
        </div>

        {selected ? (
          <div className="grid min-w-0 grid-cols-[1fr_280px]">
            <div className="flex min-h-0 flex-col bg-[#f8f9fa]">
              <header className="flex h-[73px] items-center justify-between border-b border-slate-200 bg-white px-6">
                <div><h2 className="font-bold">{selected.agent.name}</h2><p className="text-xs text-slate-400">{selected.agent.phone} · {selected.reference}</p></div>
                <button className="rounded-md p-2 hover:bg-slate-100"><MoreHorizontal size={18} /></button>
              </header>
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {selected.messages.map((message) => (
                  <div key={message.id} className={`mb-3 flex ${message.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${message.direction === "OUTBOUND" ? "rounded-br-md bg-[#ffe681]" : "rounded-bl-md bg-white"}`}>
                      {message.simulated && <div className="mb-1 text-[9px] font-bold uppercase text-slate-400">Simulated WhatsApp</div>}
                      {message.body}<div className="mt-1 text-right text-[9px] text-slate-400">{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {message.state}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-200 bg-white p-4">
                <div className="mb-2 flex items-center gap-2 text-xs text-amber-700"><ShieldCheck size={14} /> 24-hour messaging window is active in simulation mode</div>
                <div className="flex items-end rounded-xl border border-slate-200 px-3 py-2">
                  <button className="mb-1 p-1 text-slate-400"><Paperclip size={18} /></button>
                  <textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendReply(); } }} rows={2} placeholder="Reply to field agent..." className="max-h-28 flex-1 resize-none px-3 py-1 text-sm outline-none" />
                  <button onClick={sendReply} className="mb-1 grid h-9 w-9 place-items-center rounded-full bg-[#ffd200]"><Send size={16} /></button>
                </div>
              </div>
            </div>
            <aside className="border-l border-slate-200 bg-white p-5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Case details</h3>
              <dl className="mt-5 space-y-4 text-sm"><div><dt className="text-xs text-slate-400">Status</dt><dd className="mt-1 font-semibold">{selected.status}</dd></div><div><dt className="text-xs text-slate-400">Assigned to</dt><dd className="mt-1 font-semibold">{selected.assignee}</dd></div><div><dt className="text-xs text-slate-400">Subject</dt><dd className="mt-1">{selected.subject}</dd></div></dl>
              {role === "SUPERVISOR" && <button onClick={async () => { await fetch(`${API}/api/tickets/${selected.id}/status`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ status: "RESOLVED" }) }); await load(); }} className="mt-6 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white">Resolve case</button>}
              <div className="mt-7 border-t border-slate-100 pt-5">{simulator}</div>
              <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500"><b>Metrics:</b> {String(metrics.open ?? 0)} open · {String(metrics.failedOutbound ?? 0)} failed outbound</div>
            </aside>
          </div>
        ) : (
          <div className="grid place-items-center p-6">
            <div className="w-full max-w-sm text-center">
              <p className="text-sm text-slate-400">{tickets.length ? "Select an authorised ticket" : "No tickets yet. Send a simulated WhatsApp message to create one."}</p>
              <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-left">{simulator}</div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
