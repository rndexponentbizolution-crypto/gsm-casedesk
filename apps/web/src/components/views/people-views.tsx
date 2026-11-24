"use client";

import { Check, Copy, KeyRound, Lock, Pencil, Plus, Search, ShieldCheck, UserMinus, UserPlus, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import {
  useCreateStaff,
  useDashboard,
  useFieldAgents,
  usePermissionCatalog,
  useResetPassword,
  useSaveFieldAgent,
  useStaff,
  useTickets,
  useUpdateStaff,
  type FieldAgentInput,
  type PermissionCatalog,
  type StaffMember,
} from "@/lib/api";
import { awaitingReply, cn, isOpen, listTime } from "@/lib/format";
import { ROLE_TITLE, useIdentity, type Permission, type Role } from "@/lib/identity";
import { Meter } from "../charts";
import { Avatar, Button, Card, EmptyState, ErrorNotice, Field, inputClass, PageHeader, Skeleton } from "../ui";

const ROLES: Role[] = ["BACK_OFFICE", "SUPERVISOR", "ADMINISTRATOR"];

const PERMISSION_LABEL: Record<Permission, string> = {
  "tickets.reply": "Work tickets",
  "tickets.view_all": "See all tickets",
  "tickets.reassign": "Reassign tickets",
  "reports.view": "View reports",
  "reports.export": "Export reports",
  "operations.manage": "Message operations",
  "field_agents.manage": "Manage field agents",
  "audit.verify": "Verify audit trail",
  "staff.manage": "Manage staff & access",
};

function NoAccess({ title }: { title: string }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={<Lock size={20} />} title="You don't have access to this page" description="Ask an administrator if you need it." />
      </Card>
    </div>
  );
}

/* ---------------- field agents ---------------- */

const EMPTY_AGENT: FieldAgentInput = { name: "", phone: "", employeeId: "", region: "", storeName: "", shopType: "" };

export function FieldAgentsView() {
  const { can } = useIdentity();
  const agents = useFieldAgents();
  const tickets = useTickets();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<(FieldAgentInput & { id?: string }) | null>(null);
  const manage = can("field_agents.manage");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (agents.data ?? [])
      .filter((agent) => !needle || `${agent.name} ${agent.phone} ${agent.region ?? ""} ${agent.employeeId ?? ""} ${agent.storeName ?? ""}`.toLowerCase().includes(needle))
      .map((agent) => {
        const theirs = (tickets.data ?? []).filter((ticket) => ticket.agent.phone === agent.phone);
        const last = theirs.map((ticket) => ticket.lastMessageAt).sort().at(-1);
        return { agent, total: theirs.length, open: theirs.filter(isOpen).length, waiting: theirs.filter(awaitingReply).length, last };
      });
  }, [agents.data, tickets.data, query]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Field agents"
        description="Agents registered to contact GSM Back Office on WhatsApp. Messages from any other number are ignored."
        actions={
          manage && (
            <Button variant="primary" size="sm" onClick={() => setEditing({ ...EMPTY_AGENT })}>
              <Plus size={15} aria-hidden /> Add field agent
            </Button>
          )
        }
      />
      {editing && <FieldAgentForm initial={editing} onClose={() => setEditing(null)} />}
      <Card bodyClassName="p-0">
        <div className="border-b border-slate-100 p-4">
          <div className="relative max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents" aria-label="Search agents" className={cn(inputClass, "pl-9")} />
          </div>
        </div>
        {agents.isError ? (
          <div className="p-4">
            <ErrorNotice error={agents.error} onRetry={() => agents.refetch()} />
          </div>
        ) : agents.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title={query ? "No agents match" : "No field agents yet"} description={!query && manage ? "Add the agents who will message GSM Back Office." : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Agent</th>
                  <th className="px-5 py-2.5 font-medium">Store / container</th>
                  <th className="px-5 py-2.5 font-medium">Employee ID</th>
                  <th className="px-5 py-2.5 font-medium">Region</th>
                  <th className="px-5 py-2.5 text-right font-medium">Open / total</th>
                  <th className="px-5 py-2.5 font-medium">Last contact</th>
                  {manage && <th className="px-5 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ agent, total, open, waiting, last }) => (
                  <tr key={agent.id} className={cn("hover:bg-slate-50/60", !agent.active && "opacity-60")}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={agent.name} size={34} />
                        <div>
                          <p className="font-medium text-slate-900">
                            {agent.name}
                            {!agent.active && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Inactive</span>}
                          </p>
                          <p className="text-xs text-slate-500">{agent.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {agent.storeName ?? "—"}
                      {agent.shopType && <span className="block text-[11px] text-slate-400">{agent.shopType}</span>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{agent.employeeId ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-600">{agent.region ?? "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-900">
                      {open} / {total}
                      {waiting > 0 && <span className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">{waiting} waiting</span>}
                    </td>
                    <td className="px-5 py-3 text-slate-500">{last ? listTime(last) : "Never"}</td>
                    {manage && (
                      <td className="px-5 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(agent)}>
                          <Pencil size={14} aria-hidden /> Edit
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function FieldAgentForm({ initial, onClose }: { initial: FieldAgentInput & { id?: string }; onClose: () => void }) {
  const save = useSaveFieldAgent();
  const [form, setForm] = useState(initial);
  const set = (key: keyof FieldAgentInput) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(form, { onSuccess: onClose });
  };
  return (
    <Card title={initial.id ? `Edit ${initial.name}` : "Add field agent"} className="mb-6" action={<CloseButton onClick={onClose} />}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Full name">
          <input required value={form.name ?? ""} onChange={set("name")} className={inputClass} />
        </Field>
        <Field label="WhatsApp number" hint="International format, e.g. +260971234567">
          <input required value={form.phone ?? ""} onChange={set("phone")} inputMode="tel" placeholder="+260…" className={inputClass} />
        </Field>
        <Field label="Employee ID">
          <input value={form.employeeId ?? ""} onChange={set("employeeId")} className={inputClass} />
        </Field>
        <Field label="Region / province">
          <input value={form.region ?? ""} onChange={set("region")} className={inputClass} />
        </Field>
        <Field label="Store or container name">
          <input value={form.storeName ?? ""} onChange={set("storeName")} className={inputClass} />
        </Field>
        <Field label="Shop type">
          <input value={form.shopType ?? ""} onChange={set("shopType")} placeholder="Connect Store, Container…" className={inputClass} />
        </Field>
        {initial.id && (
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2 lg:col-span-3">
            <input type="checkbox" checked={form.active ?? true} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
            Active (inactive agents' messages are ignored)
          </label>
        )}
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {initial.id ? "Save changes" : "Add agent"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {save.error && (
          <div className="sm:col-span-2 lg:col-span-3">
            <ErrorNotice error={save.error} />
          </div>
        )}
      </form>
    </Card>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
      <X size={16} />
    </button>
  );
}

/* ---------------- staff & access ---------------- */

export function StaffView() {
  const { identity, can } = useIdentity();
  const staff = useStaff();
  const catalog = usePermissionCatalog();
  const dashboard = useDashboard();
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string; reason: string } | null>(null);

  if (!can("staff.manage")) return <NoAccess title="Staff & access" />;

  const workload = new Map((dashboard.data?.workload ?? []).map((item) => [item.id, item.activeTickets]));
  const accounts = catalog.data?.accountManagement ?? true;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Staff & access"
        description="Create sign-in accounts and decide what each person can do. A role sets the defaults; tick or untick individual permissions per person."
        actions={
          <Button variant="primary" size="sm" disabled={!accounts} onClick={() => setAdding(true)}>
            <UserPlus size={15} aria-hidden /> Add staff member
          </Button>
        }
      />
      {!accounts && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Account creation is switched off: the API has no Keycloak account-management secret (KEYCLOAK_ADMIN_CLIENT_SECRET).
        </div>
      )}
      {secret && <OneTimePassword {...secret} onClose={() => setSecret(null)} />}
      {adding && catalog.data && (
        <AddStaff
          catalog={catalog.data}
          onClose={() => setAdding(false)}
          onCreated={(member, password) => {
            setAdding(false);
            setSecret({ email: member.email, password, reason: `Account created for ${member.name}.` });
          }}
        />
      )}
      {(staff.isError || catalog.isError) && (
        <div className="mb-4">
          <ErrorNotice error={staff.error ?? catalog.error} onRetry={() => void Promise.all([staff.refetch(), catalog.refetch()])} />
        </div>
      )}
      <div className="space-y-3">
        {staff.isPending || catalog.isPending
          ? Array.from({ length: 2 }, (_, index) => <Skeleton key={index} className="h-24" />)
          : (staff.data ?? []).map((member) => (
              <StaffCard
                key={member.id}
                member={member}
                catalog={catalog.data!}
                isSelf={member.id === identity.id}
                openTickets={workload.get(member.id)}
                onPassword={(password) => setSecret({ email: member.email, password, reason: `Password reset for ${member.name}.` })}
              />
            ))}
      </div>
    </div>
  );
}

function OneTimePassword({ email, password, reason, onClose }: { email: string; password: string; reason: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card className="mb-6 border-amber-300 ring-1 ring-amber-200" title={reason} action={<CloseButton onClick={onClose} />}>
      <p className="text-sm text-slate-600">
        Give these to the person privately. The temporary password works once: at first sign-in they choose their own password and set up an authenticator app.{" "}
        <strong className="font-medium text-slate-900">It is not stored and won&apos;t be shown again.</strong>
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Sign-in</dt>
          <dd className="font-mono text-sm text-slate-900">{email}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Temporary password</dt>
          <dd className="flex items-center gap-2">
            <code className="rounded bg-slate-100 px-2 py-1 font-mono text-sm text-slate-900">{password}</code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(password).then(() => setCopied(true));
              }}
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? "Copied" : "Copy"}
            </Button>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/** Splits a wanted permission set into grants and revokes relative to the role. */
function diffFromRole(role: Role, wanted: Set<Permission>, catalog: PermissionCatalog) {
  const defaults = new Set(catalog.roles.find((item) => item.key === role)?.defaults ?? []);
  return {
    grantedPermissions: [...wanted].filter((permission) => !defaults.has(permission)),
    revokedPermissions: [...defaults].filter((permission) => !wanted.has(permission)),
  };
}

const roleDefaults = (role: Role, catalog: PermissionCatalog) => new Set(catalog.roles.find((item) => item.key === role)?.defaults ?? []);

function PermissionPicker({ role, value, onChange, catalog, locked = [] }: { role: Role; value: Set<Permission>; onChange: (next: Set<Permission>) => void; catalog: PermissionCatalog; locked?: Permission[] }) {
  const defaults = roleDefaults(role, catalog);
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {catalog.permissions.map(({ key, description }) => {
        const checked = value.has(key);
        const differs = checked !== defaults.has(key);
        const isLocked = locked.includes(key);
        return (
          <li key={key}>
            <label className={cn("flex items-start gap-2.5 rounded-lg border p-2.5 text-sm", differs ? "border-amber-300 bg-amber-50/60" : "border-slate-200", isLocked && "opacity-60")}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checked}
                disabled={isLocked}
                onChange={(event) => {
                  const next = new Set(value);
                  if (event.target.checked) next.add(key);
                  else next.delete(key);
                  onChange(next);
                }}
              />
              <span>
                <span className="block font-medium text-slate-900">
                  {PERMISSION_LABEL[key] ?? key}
                  {differs && <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">{checked ? "Granted" : "Removed"}</span>}
                </span>
                <span className="block text-xs text-slate-500">{description}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function AddStaff({ catalog, onClose, onCreated }: { catalog: PermissionCatalog; onClose: () => void; onCreated: (member: StaffMember, password: string) => void }) {
  const create = useCreateStaff();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("BACK_OFFICE");
  const [permissions, setPermissions] = useState(() => roleDefaults("BACK_OFFICE", catalog));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name, email, role, ...diffFromRole(role, permissions, catalog) },
      { onSuccess: (result) => onCreated(result.staff, result.temporaryPassword) },
    );
  };
  return (
    <Card title="Add staff member" className="mb-6" action={<CloseButton onClick={onClose} />}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Full name">
            <input required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Email" hint="They sign in with this">
            <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(event) => {
                const next = event.target.value as Role;
                setRole(next);
                setPermissions(roleDefaults(next, catalog));
              }}
              className={inputClass}
            >
              {ROLES.map((item) => (
                <option key={item} value={item}>
                  {ROLE_TITLE[item]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-900">Permissions</p>
          <PermissionPicker role={role} value={permissions} onChange={setPermissions} catalog={catalog} />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create account
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
        {create.error && <ErrorNotice error={create.error} />}
      </form>
    </Card>
  );
}

function StaffCard({ member, catalog, isSelf, openTickets, onPassword }: { member: StaffMember; catalog: PermissionCatalog; isSelf: boolean; openTickets?: number; onPassword: (password: string) => void }) {
  const update = useUpdateStaff();
  const reset = useResetPassword();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(member.role);
  const [permissions, setPermissions] = useState(() => new Set(member.permissions));
  const [notice, setNotice] = useState<string | null>(null);
  const error = update.error ?? reset.error;

  const startEdit = () => {
    setRole(member.role);
    setPermissions(new Set(member.permissions));
    setEditing(true);
  };
  const save = () =>
    update.mutate({ id: member.id, role, ...diffFromRole(role, permissions, catalog) }, { onSuccess: () => setEditing(false) });
  const setActive = (active: boolean) =>
    update.mutate(
      { id: member.id, active },
      { onSuccess: (result) => setNotice(result.openTicketsToReassign ? `${member.name} still holds ${result.openTicketsToReassign} open ticket(s). Reassign them from All tickets.` : null) },
    );

  return (
    <Card className={cn(!member.active && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={member.name} size={42} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">
            {member.name}
            {isSelf && <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>}
          </p>
          <p className="truncate text-xs text-slate-500">
            {member.email} · {ROLE_TITLE[member.role]}
            {member.grantedPermissions.length + member.revokedPermissions.length > 0 && " · customised"}
            {member.permissions.includes("tickets.reply") && openTickets !== undefined && ` · ${openTickets} open`}
          </p>
        </div>
        <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium", member.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", member.active ? "bg-emerald-500" : "bg-slate-400")} aria-hidden />
          {member.active ? "Active" : "Deactivated"}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => (editing ? setEditing(false) : startEdit())}>
            <ShieldCheck size={14} aria-hidden /> Access
          </Button>
          <Button size="sm" variant="ghost" loading={reset.isPending} disabled={!member.active} onClick={() => reset.mutate(member.id, { onSuccess: (result) => onPassword(result.temporaryPassword) })}>
            <KeyRound size={14} aria-hidden /> Reset password
          </Button>
          {!isSelf && (
            <Button size="sm" variant="ghost" loading={update.isPending && update.variables?.active !== undefined} onClick={() => setActive(!member.active)}>
              <UserMinus size={14} aria-hidden /> {member.active ? "Deactivate" : "Reactivate"}
            </Button>
          )}
        </div>
      </div>

      {member.permissions.includes("tickets.reply") && member.active && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={member.availability} onChange={(event) => update.mutate({ id: member.id, availability: event.target.checked })} />
            Receives new tickets
          </label>
          {openTickets !== undefined && <Meter value={openTickets} max={member.capacity || 1} label={`${member.name} workload`} />}
        </div>
      )}

      {editing && (
        <div className="mt-5 space-y-4 border-t border-slate-100 pt-4">
          <Field label="Role">
            <select
              value={role}
              disabled={isSelf}
              onChange={(event) => {
                const next = event.target.value as Role;
                setRole(next);
                setPermissions(roleDefaults(next, catalog));
              }}
              className={cn(inputClass, "max-w-xs")}
            >
              {ROLES.map((item) => (
                <option key={item} value={item}>
                  {ROLE_TITLE[item]}
                </option>
              ))}
            </select>
          </Field>
          <PermissionPicker role={role} value={permissions} onChange={setPermissions} catalog={catalog} locked={isSelf ? ["staff.manage"] : []} />
          {isSelf && <p className="text-xs text-slate-500">You can't change your own role or remove your own staff access; another administrator can.</p>}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={update.isPending} onClick={save}>
              Save access
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {notice && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{notice}</p>}
      {error && (
        <div className="mt-3">
          <ErrorNotice error={error} />
        </div>
      )}
    </Card>
  );
}

