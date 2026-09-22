"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  WalletCards,
  XCircle,
} from "lucide-react";

type Client = {
  id: string;
  name: string;
  ownerEmail: string | null;
  ownerName: string | null;
  ownerRole: string | null;
  subscription: {
    id: string;
    planId: string | null;
    status: string;
    startedAt: string | null;
    currentPeriodEnd: string | null;
    daysLeft: number;
  } | null;
};

type AlertItem = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  accountId: string;
};

type Overview = {
  generatedAt: string;
  admin: { email: string | null };
  metrics: {
    totalClients: number;
    activeSubscriptions: number;
    expiringSoon: number;
    expired: number;
    pastDue: number;
    openAlerts: number;
  };
  clients: Client[];
  alerts: AlertItem[];
};

type Tab = "overview" | "clients" | "alerts" | "settings";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function subscriptionTone(days: number, status: string) {
  if (status === "past_due") {
    return {
      label: "Past due",
      className:
        "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  if (days <= 0 || status === "expired" || status === "cancelled") {
    return {
      label: "Expired",
      className:
        "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    };
  }
  if (days <= 5) {
    return {
      label: `${days}d left`,
      className:
        "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
    };
  }
  if (days <= 18) {
    return {
      label: `${days}d left`,
      className:
        "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  return {
    label: `${days}d left`,
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  };
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <div className="mt-5 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [busyAccount, setBusyAccount] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch("/api/admin/overview", {
        cache: "no-store",
      });
      const payload = (await response.json()) as Overview & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load admin overview.");
      }

      setData(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to load admin overview.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function subscriptionAction(
    accountId: string,
    action: "extend_30" | "restore_30" | "cancel",
  ) {
    setBusyAccount(accountId);
    setNotice(null);
    setMenuOpen(null);

    try {
      const response = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, action }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Subscription action failed.");
      }

      setNotice(
        action === "cancel"
          ? "Subscription cancelled."
          : "Subscription updated successfully.",
      );
      await load(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Subscription action failed.");
    } finally {
      setBusyAccount(null);
    }
  }

  const filteredClients = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return data.clients;

    return data.clients.filter((client) =>
      [
        client.name,
        client.ownerEmail,
        client.ownerName,
        client.subscription?.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [data, query]);

  if (loading) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="mx-auto flex min-h-[70vh] max-w-7xl items-center justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-sm shadow-sm">
            <RefreshCw className="size-4 animate-spin text-primary" />
            Loading Megora Global Admin…
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-xl rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
          <div className="flex items-center gap-3 text-red-700 dark:text-red-300">
            <AlertCircle className="size-5" />
            <h1 className="font-semibold">Admin panel could not load</h1>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {notice ?? "Check your admin allowlist and Supabase service-role configuration."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/20">
      <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
                <ShieldCheck className="size-4" />
                Megora Global Admin
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  SaaS control center
                </h1>
                <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Admin access
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Monitor every client workspace, subscription health and the items that need your attention.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {data.admin.email ?? "Admin"}
              </span>
              <span className="rounded-full border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                Updated {formatDate(data.generatedAt)}
              </span>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={refreshing}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-medium transition hover:bg-muted disabled:opacity-60"
              >
                <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            {([
              ["overview", "Overview"],
              ["clients", "Clients"],
              ["alerts", "Alerts"],
              ["settings", "Admin setup"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={
                  tab === key
                    ? "rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    : "rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              >
                {label}
                {key === "alerts" && data.metrics.openAlerts > 0 ? (
                  <span className="ml-2 rounded-full bg-background/20 px-1.5 py-0.5 text-[10px]">
                    {data.metrics.openAlerts}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </header>

        {notice ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
            <Bell className="size-4 text-primary" />
            <span className="flex-1">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
            >
              <XCircle className="size-4" />
            </button>
          </div>
        ) : null}

        {tab === "overview" ? (
          <section className="mt-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                icon={Users}
                label="Total client workspaces"
                value={data.metrics.totalClients}
                hint="All accounts"
              />
              <MetricCard
                icon={CheckCircle2}
                label="Active subscriptions"
                value={data.metrics.activeSubscriptions}
                hint="Healthy"
              />
              <MetricCard
                icon={Clock3}
                label="Expiring in 5 days"
                value={data.metrics.expiringSoon}
                hint="Needs follow-up"
              />
              <MetricCard
                icon={XCircle}
                label="Expired / missing"
                value={data.metrics.expired}
                hint="Action required"
              />
              <MetricCard
                icon={CreditCard}
                label="Past due"
                value={data.metrics.pastDue}
                hint="Billing review"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Action center</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      These are the items you should review first.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab("alerts")}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    View all
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  {data.alerts.slice(0, 6).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 p-3"
                    >
                      <span
                        className={
                          alert.severity === "critical"
                            ? "mt-1 size-2.5 shrink-0 rounded-full bg-red-500"
                            : alert.severity === "warning"
                              ? "mt-1 size-2.5 shrink-0 rounded-full bg-amber-500"
                              : "mt-1 size-2.5 shrink-0 rounded-full bg-sky-500"
                        }
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{alert.title}</div>
                        <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                          {alert.message}
                        </div>
                      </div>
                    </div>
                  ))}
                  {data.alerts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                      Nothing needs attention right now.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <WalletCards className="size-4 text-primary" />
                  <h2 className="font-semibold">Subscription rules</h2>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/10 px-3 py-2.5">
                    <span>19–30 days</span>
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">Green</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-500/10 px-3 py-2.5">
                    <span>6–18 days</span>
                    <span className="font-medium text-amber-700 dark:text-amber-300">Yellow</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-red-500/10 px-3 py-2.5">
                    <span>0–5 days</span>
                    <span className="font-medium text-red-700 dark:text-red-300">Red</span>
                  </div>
                </div>
                <div className="mt-4 text-xs leading-5 text-muted-foreground">
                  Use the client action menu to extend, restore or cancel a subscription. Extension is stored in Supabase and immediately reflected in the client countdown.
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {tab === "clients" ? (
          <section className="mt-5 rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Client workspaces</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  One control surface for all future SaaS clients.
                </p>
              </div>
              <div className="relative w-full sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search client, owner or status…"
                  className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px]">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Workspace</th>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Plan</th>
                    <th className="px-4 py-3 font-medium">Renewal</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client) => {
                    const subscription = client.subscription;
                    const tone = subscription
                      ? subscriptionTone(subscription.daysLeft, subscription.status)
                      : {
                          label: "Missing",
                          className:
                            "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
                        };

                    return (
                      <tr key={client.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-4">
                          <div className="font-medium">{client.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {client.id}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm">{client.ownerName || "—"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {client.ownerEmail || "No email"}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm">
                          {subscription?.planId || "starter"}
                        </td>
                        <td className="px-4 py-4 text-sm">
                          {formatDate(subscription?.currentPeriodEnd ?? null)}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${tone.className}`}>
                            {tone.label}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="relative inline-block">
                            <button
                              type="button"
                              onClick={() =>
                                setMenuOpen(menuOpen === client.id ? null : client.id)
                              }
                              className="inline-flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                              disabled={busyAccount === client.id}
                            >
                              {busyAccount === client.id ? (
                                <RefreshCw className="size-3.5 animate-spin" />
                              ) : (
                                "Manage"
                              )}
                              <ChevronDown className="size-3.5" />
                            </button>

                            {menuOpen === client.id ? (
                              <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border border-border bg-popover p-1.5 text-left shadow-xl">
                                <button
                                  type="button"
                                  onClick={() => void subscriptionAction(client.id, "extend_30")}
                                  className="flex w-full items-center rounded-lg px-3 py-2 text-xs hover:bg-muted"
                                >
                                  Extend +30 days
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void subscriptionAction(client.id, "restore_30")}
                                  className="flex w-full items-center rounded-lg px-3 py-2 text-xs hover:bg-muted"
                                >
                                  Restore 30 days
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void subscriptionAction(client.id, "cancel")}
                                  className="flex w-full items-center rounded-lg px-3 py-2 text-xs text-red-600 hover:bg-red-500/10 dark:text-red-300"
                                >
                                  Cancel subscription
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredClients.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  No clients match your search.
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "alerts" ? (
          <section className="mt-5 rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-5">
              <h2 className="font-semibold">Alerts & updates</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The panel automatically derives operational attention items from your client and subscription data.
              </p>
            </div>
            <div className="divide-y divide-border">
              {data.alerts.map((alert) => (
                <div key={alert.id} className="flex gap-4 p-5">
                  <div
                    className={
                      alert.severity === "critical"
                        ? "mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-300"
                        : alert.severity === "warning"
                          ? "mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300"
                    }
                  >
                    <AlertCircle className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{alert.title}</div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">
                      {alert.message}
                    </div>
                  </div>
                </div>
              ))}
              {data.alerts.length === 0 ? (
                <div className="p-10 text-center">
                  <CheckCircle2 className="mx-auto size-8 text-emerald-500" />
                  <div className="mt-3 font-medium">All clear</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    No generated admin alerts right now.
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "settings" ? (
          <section className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="font-semibold">Required environment setup</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These values stay on the server and are never exposed to client browsers.
              </p>
              <div className="mt-4 space-y-3">
                {[
                  [
                    "MEGORAH_ADMIN_EMAILS",
                    "Your admin login email(s), comma-separated.",
                  ],
                  [
                    "SUPABASE_SERVICE_ROLE_KEY",
                    "Supabase server key used only by admin API routes.",
                  ],
                  [
                    "SUPABASE_URL",
                    "Already supported by the current CRM configuration.",
                  ],
                ].map(([name, description]) => (
                  <div key={name} className="rounded-xl border border-border bg-muted/20 p-3">
                    <div className="font-mono text-xs font-semibold">{name}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      {description}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                Never paste the Supabase service-role key into the browser, chat, GitHub, or a public env variable.
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="font-semibold">Admin responsibilities</h2>
              <div className="mt-4 space-y-3">
                {[
                  ["Review red alerts", "Expired or missing subscriptions should be handled first."],
                  ["Review yellow alerts", "Follow up with clients whose subscription is approaching expiry."],
                  ["Keep access controlled", "Only allow your own admin email(s) in the server environment."],
                  ["Connect proactive email alerts", "Add RESEND_API_KEY and an admin recipient later if you want automatic email digests."],
                ].map(([title, description]) => (
                  <div key={title} className="flex gap-3 rounded-xl border border-border p-3">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <div className="text-sm font-medium">{title}</div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
                    </div>
                  </div>
                ))}
              </div>
              <a
                href="https://supabase.com/dashboard/project/mjkfokcjtkmkvlippbew"
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
              >
                Open Supabase project
                <ExternalLink className="size-4" />
              </a>
            </div>
          </section>
        ) : null}

        <footer className="mt-5 flex flex-col gap-2 border-t border-border/70 px-1 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Megora Global Admin · internal control surface</span>
          <span>Live data: Supabase · Current snapshot: {new Date(data.generatedAt).toLocaleTimeString("en-IN")}</span>
        </footer>
      </div>
    </main>
  );
}
