"use client";

import {
  AlertTriangle,
  BookOpenText,
  BarChart3,
  ChevronDown,
  Inbox,
  LayoutDashboard,
  Menu,
  MessageSquarePlus,
  Settings,
  UserCog,
  Users,
  X,
  type LucideIcon,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHealth, useTickets } from "@/lib/api";
import { awaitingReply, cn } from "@/lib/format";
import { IDENTITIES, useIdentity } from "@/lib/identity";
import { NewTicketAlerts } from "./alerts";
import { useSimulator } from "./simulator";
import { Avatar, Button } from "./ui";

type NavItem = { href: string; label: string; icon: LucideIcon; supervisorOnly?: boolean; badge?: "mine" | "escalated" | "all" };

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/tickets", label: "My tickets", icon: Inbox, badge: "mine" },
      { href: "/tickets/all", label: "All tickets", icon: Inbox, badge: "all", supervisorOnly: true },
      { href: "/tickets/escalated", label: "Escalated", icon: AlertTriangle, badge: "escalated" },
    ],
  },
  {
    section: "Manage",
    items: [
      { href: "/reports", label: "Reports", icon: BarChart3, supervisorOnly: true },
      { href: "/responses", label: "Responses", icon: BookOpenText },
      { href: "/field-agents", label: "Field agents", icon: Users },
      { href: "/staff", label: "Staff", icon: UserCog, supervisorOnly: true },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="min-h-dvh bg-canvas">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-slate-300 transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar onClose={() => setMobileOpen(false)} />
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex min-h-dvh flex-col lg:pl-64">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex flex-1 flex-col">{children}</main>
        <NewTicketAlerts />
      </div>
    </div>
  );
}

function Sidebar({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const { identity, isSupervisor } = useIdentity();
  const tickets = useTickets();
  const health = useHealth();

  const counts = {
    mine: (tickets.data ?? []).filter((ticket) => ticket.assignedUserId === identity.id && awaitingReply(ticket)).length,
    all: (tickets.data ?? []).filter(awaitingReply).length,
    escalated: (tickets.data ?? []).filter((ticket) => ticket.status === "ESCALATED").length,
  };

  return (
    <>
      <div className="flex items-center justify-between px-5 pb-6 pt-5">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand text-base font-black text-slate-950">G</span>
          <span>
            <span className="block text-sm font-semibold text-white">GSM CaseDesk</span>
            <span className="block text-[11px] text-slate-500">Zambia Operations</span>
          </span>
        </Link>
        <button onClick={onClose} className="rounded-md p-1 text-slate-500 hover:text-white lg:hidden" aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3">
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{group.section}</p>
            <ul className="space-y-0.5">
              {group.items
                .filter((item) => isSupervisor || !item.supervisorOnly)
                .map((item) => {
                  const active = pathname === item.href;
                  const count = item.badge ? counts[item.badge] : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                          active ? "bg-white/10 text-white" : "hover:bg-white/5 hover:text-white",
                        )}
                      >
                        <item.icon size={17} aria-hidden className={active ? "text-brand" : ""} />
                        <span className="flex-1">{item.label}</span>
                        {count > 0 && (
                          <span
                            className={cn(
                              "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold",
                              item.badge === "escalated" ? "bg-red-500/20 text-red-300" : "bg-brand/20 text-brand",
                            )}
                            aria-label={`${count} ${item.badge === "escalated" ? "escalated" : "awaiting reply"}`}
                          >
                            {count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/5 px-5 py-4 text-[11px] text-slate-500">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              health.isError || health.data?.database === "error" ? "bg-red-500" : health.data ? "bg-emerald-500" : "bg-slate-500",
            )}
            aria-hidden
          />
          {health.isError ? "API unreachable" : health.data?.database === "error" ? "Database unreachable" : health.data ? "API connected" : "Connecting…"}
        </div>
        {health.data?.mode === "simulation" && <p className="mt-1 pl-4">WhatsApp: simulation mode</p>}
      </div>
    </>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const simulator = useSimulator();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="-ml-1 rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className="flex-1" />
      <Button size="sm" variant="secondary" onClick={() => simulator.open()}>
        <MessageSquarePlus size={15} aria-hidden />
        <span className="hidden sm:inline">Field agent phone</span>
      </Button>
      <IdentityMenu />
    </header>
  );
}

function IdentityMenu() {
  const { identity, setIdentity, signOut } = useIdentity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100"
      >
        <Avatar name={identity.name} size={30} />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight text-slate-900">{identity.name}</span>
          <span className="block text-[11px] leading-tight text-slate-500">{identity.title}</span>
        </span>
        <ChevronDown size={14} className="text-slate-400" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {setIdentity ? (
            <>
              <p className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-slate-400">Demo: view the desk as…</p>
              {IDENTITIES.map((item) => (
                <button
                  key={item.id}
                  role="menuitemradio"
                  aria-checked={item.id === identity.id}
                  onClick={() => {
                    setIdentity(item.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-slate-50",
                    item.id === identity.id && "bg-amber-50",
                  )}
                >
                  <Avatar name={item.name} size={28} />
                  <span className="flex-1">
                    <span className="block text-sm text-slate-900">{item.name}</span>
                    <span className="block text-[11px] text-slate-500">{item.title}</span>
                  </span>
                </button>
              ))}
            </>
          ) : (
            <button
              role="menuitem"
              onClick={() => signOut?.()}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={16} className="text-slate-400" aria-hidden />
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
