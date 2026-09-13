import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/currency";

const PLANS = [
  {
    name: "Starter",
    price: 499,
    description: "For solo businesses getting started on WhatsApp",
    features: ["1 user", "Shared inbox", "Contacts & deals", "Basic automations"],
  },
  {
    name: "Growth",
    price: 999,
    description: "For growing teams that need more automation",
    features: ["3 users", "WhatsApp workflows", "Broadcasts", "Advanced automations"],
  },
  {
    name: "Pro",
    price: 1999,
    description: "For teams running WhatsApp as a sales channel",
    features: ["10 users", "AI features", "Advanced workflows", "Priority support"],
  },
  {
    name: "Enterprise",
    price: 4999,
    description: "For larger teams and custom requirements",
    features: ["Unlimited users", "Custom onboarding", "Priority support", "Custom limits"],
  },
];

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const adminEmail = process.env.MEGORAH_ADMIN_EMAIL?.trim().toLowerCase();
  const currentEmail = user.email?.trim().toLowerCase();

  if (!adminEmail || !currentEmail || currentEmail !== adminEmail) {
    redirect("/dashboard");
  }

  const [{ count: accountCount }, { count: userCount }, { data: accounts }] = await Promise.all([
    supabase.from("accounts").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("accounts")
      .select("id, name, default_currency, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const safeAccounts = accounts ?? [];
  const displayCurrency = "INR";

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Megorah Platform</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Admin Console</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage customers, pricing and the SaaS platform from one place.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Customers" value={String(accountCount ?? 0)} />
        <Stat label="Users" value={String(userCount ?? 0)} />
        <Stat label="Plans" value={String(PLANS.length)} />
        <Stat label="Base currency" value="₹ INR" />
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Pricing</h2>
          <p className="text-sm text-muted-foreground">
            Low-entry pricing designed to undercut larger WhatsApp CRM tools.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => (
            <article key={plan.name} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-sm font-medium text-muted-foreground">{plan.name}</p>
              <p className="mt-2 text-3xl font-bold text-foreground">
                {formatCurrency(plan.price, displayCurrency)}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/month</span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>
              <ul className="mt-4 space-y-2 text-sm text-foreground">
                {plan.features.map((feature) => (
                  <li key={feature}>✓ {feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Customer accounts</h2>
          <p className="text-sm text-muted-foreground">Latest accounts currently present in Supabase.</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 border-b border-border px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Account</span>
            <span>Currency</span>
            <span>Created</span>
          </div>

          {safeAccounts.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">No customer accounts yet.</div>
          ) : (
            safeAccounts.map((account) => (
              <div
                key={account.id}
                className="grid grid-cols-[1.4fr_1fr_1fr] gap-4 border-b border-border/70 px-5 py-4 text-sm last:border-b-0"
              >
                <div className="font-medium text-foreground">{account.name}</div>
                <div className="text-muted-foreground">{account.default_currency ?? "INR"}</div>
                <div className="text-muted-foreground">
                  {account.created_at ? new Date(account.created_at).toLocaleDateString("en-IN") : "—"}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-sm text-muted-foreground">
        Next: connect Razorpay subscriptions/webhooks so successful payments automatically activate a customer plan, record the payment, and set renewal dates.
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
