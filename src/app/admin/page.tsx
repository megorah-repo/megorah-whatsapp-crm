import { requirePlatformAdmin } from "@/lib/admin-access";
import { createPlatformAdminClient } from "@/lib/admin/platform-admin-client";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

function money(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function StatCard({ label, value, hint, tone = "default" }: { label: string; value: string; hint: string; tone?: "default" | "good" | "warn" | "danger" }) {
  const toneClass = tone === "good" ? "border-emerald-200 bg-emerald-50" : tone === "warn" ? "border-amber-200 bg-amber-50" : tone === "danger" ? "border-red-200 bg-red-50" : "border-border bg-card";
  return <div className={`rounded-2xl border p-5 shadow-sm ${toneClass}`}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-1 text-xs text-muted-foreground">{hint}</p></div>;
}



async function extendClientSubscription(formData: FormData) {
  "use server";

  await requirePlatformAdmin();
  const accountId = String(formData.get("account_id") || "");
  if (!accountId) return;

  const supabase = createPlatformAdminClient();
  const now = new Date();

  const { data: platformSub } = await supabase
    .from("platform_subscriptions")
    .select("id,next_billing_at,status")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (platformSub?.id) {
    const current = platformSub.next_billing_at ? new Date(platformSub.next_billing_at) : null;
    const base = current && current > now ? current : now;
    const nextBillingAt = new Date(base.getTime() + 30 * 86400000).toISOString();
    await supabase.from("platform_subscriptions").update({ status: "active", next_billing_at: nextBillingAt }).eq("id", platformSub.id);
  }

  const { data: crmSub } = await supabase
    .from("subscriptions")
    .select("id,current_period_end,status,plan_id,started_at")
    .eq("account_id", accountId)
    .order("current_period_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  const existingEnd = crmSub?.current_period_end ? new Date(crmSub.current_period_end) : null;
  const crmBase = existingEnd && existingEnd > now ? existingEnd : now;
  const crmEnd = new Date(crmBase.getTime() + 30 * 86400000).toISOString();

  if (crmSub?.id) {
    await supabase.from("subscriptions").update({
      status: "active",
      plan_id: crmSub.plan_id ?? "starter",
      started_at: crmSub.started_at ?? now.toISOString(),
      current_period_end: crmEnd,
    }).eq("id", crmSub.id);
  } else {
    await supabase.from("subscriptions").insert({
      account_id: accountId,
      plan_id: "starter",
      status: "active",
      started_at: now.toISOString(),
      current_period_end: crmEnd,
    });
  }

  revalidatePath("/admin");
}

async function cancelClientSubscription(formData: FormData) {
  "use server";

  await requirePlatformAdmin();
  const accountId = String(formData.get("account_id") || "");
  if (!accountId) return;

  const supabase = createPlatformAdminClient();
  await supabase.from("platform_subscriptions").update({ status: "cancelled" }).eq("account_id", accountId);
  await supabase.from("subscriptions").update({ status: "cancelled" }).eq("account_id", accountId);

  revalidatePath("/admin");
}

export default async function AdminPage() {
  await requirePlatformAdmin();
  const supabase = createPlatformAdminClient();

  const [profiles, accounts, subscriptions, onboarding, tickets, feedback, whatsapp] = await Promise.all([
    supabase.from("profiles").select("id, user_id, full_name, email, account_id, account_role, created_at").order("created_at", { ascending: false }),
    supabase.from("accounts").select("id, name, owner_user_id, created_at").order("created_at", { ascending: false }),
    supabase.from("platform_subscriptions").select("account_id, plan_name, monthly_charge, currency, status, next_billing_at, started_at").order("created_at", { ascending: false }),
    supabase.from("platform_onboarding").select("account_id, status, owner_assigned, whatsapp_connected, contacts_imported, templates_ready, team_invited, first_message_sent, started_at, completed_at").order("created_at", { ascending: false }),
    supabase.from("platform_tickets").select("id, account_id, ticket_number, subject, status, priority, category, assigned_to, created_at, updated_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("platform_feedback").select("id, account_id, rating, category, message, sentiment, source, created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("whatsapp_config").select("user_id, status, connected_at"),
  ]);

  const customers = profiles.data ?? [];
  const accountRows = accounts.data ?? [];
  const subscriptionRows = subscriptions.data ?? [];
  const onboardingRows = onboarding.data ?? [];
  const ticketRows = tickets.data ?? [];
  const feedbackRows = feedback.data ?? [];
  const whatsappRows = whatsapp.data ?? [];

  const accountMap = new Map(accountRows.map((a) => [a.id, a]));
  const ownerMap = new Map(customers.map((p) => [p.user_id, p]));
  const subMap = new Map(subscriptionRows.map((s) => [s.account_id, s]));
  const onboardingMap = new Map(onboardingRows.map((o) => [o.account_id, o]));

  const activeSubscriptions = subscriptionRows.filter((s) => s.status === "active");
  const mrr = activeSubscriptions.reduce((sum, s) => sum + Number(s.monthly_charge || 0), 0);
  const arr = mrr * 12;
  const openTickets = ticketRows.filter((t) => ["open", "in_progress", "waiting_customer"].includes(t.status)).length;
  const urgentTickets = ticketRows.filter((t) => t.priority === "urgent" && !["resolved", "closed"].includes(t.status)).length;
  const completedOnboarding = onboardingRows.filter((o) => o.status === "completed").length;
  const connectedWhatsApp = whatsappRows.filter((w) => w.status === "connected").length;
  const ratings = feedbackRows.filter((f) => typeof f.rating === "number").map((f) => Number(f.rating));
  const averageRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const newThisMonth = accountRows.filter((a) => a.created_at && new Date(a.created_at) >= monthStart).length;
  const fiveDaysFromNow = new Date(now.getTime() + 5 * 86400000);
  const expiringSubscriptions = subscriptionRows.filter((s) => {
    if (!s.next_billing_at || ["cancelled", "expired"].includes(s.status)) return false;
    const billing = new Date(s.next_billing_at);
    return billing >= now && billing <= fiveDaysFromNow;
  });
  const pastDueSubscriptions = subscriptionRows.filter((s) => s.status === "past_due");
  const stalledOnboarding = onboardingRows.filter((o) => {
    if (!o.started_at || o.status === "completed") return false;
    return new Date(o.started_at).getTime() < now.getTime() - 3 * 86400000;
  });
  const disconnectedWhatsAppAccounts = accountRows.filter((account) => {
    const owner = ownerMap.get(account.owner_user_id);
    if (!owner) return true;
    return !whatsappRows.some((w) => w.user_id === owner.user_id && w.status === "connected");
  });
  const lowFeedback = feedbackRows.filter((f) => Number(f.rating || 0) > 0 && Number(f.rating) <= 2);
  const adminAlerts = [
    ...expiringSubscriptions.map((s) => ({
      type: "Billing",
      tone: "warn",
      title: "Subscription expires within 5 days",
      detail: accountMap.get(s.account_id)?.name || s.account_id,
    })),
    ...pastDueSubscriptions.map((s) => ({
      type: "Billing",
      tone: "danger",
      title: "Subscription is past due",
      detail: accountMap.get(s.account_id)?.name || s.account_id,
    })),
    ...stalledOnboarding.map((o) => ({
      type: "Onboarding",
      tone: "warn",
      title: "Onboarding has been open for more than 3 days",
      detail: accountMap.get(o.account_id)?.name || o.account_id,
    })),
    ...disconnectedWhatsAppAccounts.map((account) => ({
      type: "WhatsApp",
      tone: "danger",
      title: "WhatsApp is not connected",
      detail: account.name || account.id,
    })),
    ...lowFeedback.slice(0, 20).map((f) => ({
      type: "Feedback",
      tone: "danger",
      title: "Low customer rating needs review",
      detail: `${accountMap.get(f.account_id)?.name || "Unknown client"} · ${f.rating}/5`,
    })),
  ];

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-10">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Megorah SaaS · Platform Control</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Admin Dashboard</h1><p className="mt-2 text-sm text-muted-foreground">Clients, billing, onboarding, support, feedback and platform health — all in one view.</p></div>
          <div className="flex items-center gap-4"><a href="/admin" className="text-sm font-medium text-primary hover:underline">Refresh</a><a href="/dashboard" className="text-sm font-medium text-primary hover:underline">← Back to CRM</a></div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard label="Total Clients" value={String(accountRows.length)} hint={`${newThisMonth} joined this month`} />
          <StatCard label="Active Plans" value={String(activeSubscriptions.length)} hint="Currently billable" tone="good" />
          <StatCard label="MRR" value={money(mrr)} hint={`ARR ${money(arr)}`} tone="good" />
          <StatCard label="Open Tickets" value={String(openTickets)} hint={`${urgentTickets} urgent`} tone={urgentTickets ? "danger" : "default"} />
          <StatCard label="Onboarding" value={`${completedOnboarding}/${onboardingRows.length || 0}`} hint="Completed accounts" tone="good" />
          <StatCard label="Avg. Feedback" value={averageRating ? `${averageRating.toFixed(1)}/5` : "—"} hint={`${ratings.length} ratings`} />
        </section>


        <section className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold">Action Center</h2>
                <p className="mt-1 text-xs text-muted-foreground">The platform items that need your attention right now.</p>
              </div>
              <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">{adminAlerts.length} open</span>
            </div>
            <div className="divide-y divide-border">
              {adminAlerts.slice(0, 10).map((alert, index) => (
                <div key={`${alert.type}-${index}-${alert.detail}`} className="flex items-start gap-3 px-5 py-4">
                  <span className={`mt-1 size-2.5 shrink-0 rounded-full ${alert.tone === "danger" ? "bg-red-500" : "bg-amber-500"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{alert.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{alert.type} · {alert.detail}</p>
                  </div>
                </div>
              ))}
              {!adminAlerts.length && (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">No urgent admin actions right now.</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-sm font-semibold">Admin subscription colors</p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 px-3 py-2"><span>19–30 days</span><span className="font-medium text-emerald-700 dark:text-emerald-300">Green</span></div>
              <div className="flex items-center justify-between rounded-xl bg-amber-500/10 px-3 py-2"><span>6–18 days</span><span className="font-medium text-amber-700 dark:text-amber-300">Yellow</span></div>
              <div className="flex items-center justify-between rounded-xl bg-red-500/10 px-3 py-2"><span>0–5 days</span><span className="font-medium text-red-700 dark:text-red-300">Red</span></div>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">Extending a client from this panel updates both the platform billing record and the CRM subscription countdown.</p>
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">WhatsApp Connected</p><p className="mt-2 text-2xl font-semibold">{connectedWhatsApp}</p><p className="mt-1 text-xs text-muted-foreground">of {accountRows.length} platform accounts</p></div>
          <div className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Support Load</p><p className="mt-2 text-2xl font-semibold">{openTickets} open</p><p className="mt-1 text-xs text-muted-foreground">Track SLA and ticket ownership below</p></div>
          <div className="rounded-2xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">Feedback</p><p className="mt-2 text-2xl font-semibold">{feedbackRows.length} responses</p><p className="mt-1 text-xs text-muted-foreground">Latest customer voice</p></div>
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">All Clients</h2><p className="mt-1 text-xs text-muted-foreground">Commercial + onboarding snapshot for every customer account.</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-left text-sm"><thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Client</th><th className="px-5 py-3">Plan</th><th className="px-5 py-3">Monthly</th><th className="px-5 py-3">Billing</th><th className="px-5 py-3">Onboarding</th><th className="px-5 py-3">WhatsApp</th><th className="px-5 py-3">Joined</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-border">
            {accountRows.map((account) => { const owner = ownerMap.get(account.owner_user_id); const sub = subMap.get(account.id); const onboard = onboardingMap.get(account.id); const wa = owner?.user_id ? whatsappRows.find((w) => w.user_id === owner.user_id) : undefined; return <tr key={account.id} className="hover:bg-muted/50"><td className="px-5 py-4"><p className="font-medium">{account.name || "Unnamed account"}</p><p className="text-xs text-muted-foreground">{owner?.email || "No owner email"}</p></td><td className="px-5 py-4">{sub?.plan_name || "Not assigned"}</td><td className="px-5 py-4">{sub ? money(Number(sub.monthly_charge || 0)) : "—"}</td><td className="px-5 py-4"><span className="rounded-full bg-muted px-2.5 py-1 text-xs">{sub?.status || "unbilled"}</span></td><td className="px-5 py-4">{onboard?.status || "not started"}</td><td className="px-5 py-4">{wa?.status === "connected" ? "Connected" : "Not connected"}</td><td className="px-5 py-4 text-muted-foreground">{account.created_at ? new Date(account.created_at).toLocaleDateString("en-IN") : "—"}</td><td className="px-5 py-4 text-right"><div className="flex justify-end gap-2"><form action={extendClientSubscription}><input type="hidden" name="account_id" value={account.id} /><button className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">+30 days</button></form><form action={cancelClientSubscription}><input type="hidden" name="account_id" value={account.id} /><button className="rounded-lg border border-red-500/20 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 dark:text-red-300">Cancel</button></form></div></td></tr>; })}
            {!accountRows.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">No clients found.</td></tr>}
          </tbody></table></div>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Support Tickets</h2><p className="mt-1 text-xs text-muted-foreground">Latest 100 tickets</p></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-muted text-xs text-muted-foreground"><tr><th className="px-5 py-3">Ticket</th><th className="px-5 py-3">Client</th><th className="px-5 py-3">Priority</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Assigned</th></tr></thead><tbody className="divide-y divide-border">{ticketRows.map((t) => <tr key={t.id}><td className="px-5 py-4"><p className="font-medium">#{t.ticket_number} · {t.subject}</p><p className="text-xs text-muted-foreground">{t.category}</p></td><td className="px-5 py-4">{accountMap.get(t.account_id)?.name || "—"}</td><td className="px-5 py-4">{t.priority}</td><td className="px-5 py-4">{t.status}</td><td className="px-5 py-4">{t.assigned_to || "Unassigned"}</td></tr>)}{!ticketRows.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">No tickets yet.</td></tr>}</tbody></table></div></div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Customer Feedback</h2><p className="mt-1 text-xs text-muted-foreground">Latest customer responses and ratings</p></div><div className="divide-y divide-border">{feedbackRows.slice(0, 10).map((f) => <div key={f.id} className="p-5"><div className="flex items-center justify-between gap-4"><div><p className="font-medium">{accountMap.get(f.account_id)?.name || "Unknown client"}</p><p className="text-xs text-muted-foreground">{f.category || "General"} · {f.source}</p></div><span className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold">{f.rating ? `${f.rating}/5` : f.sentiment || "Feedback"}</span></div><p className="mt-3 text-sm text-muted-foreground">{f.message || "No written feedback."}</p></div>)}{!feedbackRows.length && <p className="px-5 py-10 text-center text-muted-foreground">No feedback yet.</p>}</div></div>
        </section>
      </div>
    </main>
  );
}
