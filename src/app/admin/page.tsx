import { requirePlatformAdmin } from "@/lib/admin-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{hint}</p>
    </div>
  );
}

export default async function AdminPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();

  const [profiles, accounts] = await Promise.all([
    supabase.from("profiles").select("id, user_id, full_name, email, account_id, account_role, created_at").order("created_at", { ascending: false }),
    supabase.from("accounts").select("id, name, owner_user_id, created_at").order("created_at", { ascending: false }),
  ]);

  const customers = profiles.data ?? [];
  const accountRows = accounts.data ?? [];
  const activeAccounts = new Set(accountRows.map((account) => account.id)).size;
  const owners = customers.filter((profile) => profile.account_role === "owner").length;

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Megorah SaaS</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">Admin Panel</h1>
            <p className="mt-2 text-sm text-zinc-500">Manage customers, CRM accounts and platform growth from one place.</p>
          </div>
          <a href="/dashboard" className="text-sm font-medium text-zinc-700 hover:text-zinc-950">← Back to CRM</a>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Customers" value={String(customers.length)} hint="Registered CRM profiles" />
          <StatCard label="Accounts" value={String(activeAccounts)} hint="Customer workspaces" />
          <StatCard label="Owners" value={String(owners)} hint="Account owners" />
          <StatCard label="Revenue" value="₹0" hint="Connect billing next" />
        </div>

        <section className="mt-8 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-5 py-4">
            <h2 className="font-semibold text-zinc-950">Customers</h2>
            <p className="mt-1 text-xs text-zinc-500">Every CRM user currently visible to the platform admin.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Account</th>
                  <th className="px-5 py-3 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {customers.map((customer) => {
                  const account = accountRows.find((row) => row.id === customer.account_id);
                  return (
                    <tr key={customer.id} className="hover:bg-zinc-50/70">
                      <td className="px-5 py-4 font-medium text-zinc-900">{customer.full_name || "Unnamed"}</td>
                      <td className="px-5 py-4 text-zinc-600">{customer.email || "—"}</td>
                      <td className="px-5 py-4"><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">{customer.account_role || "user"}</span></td>
                      <td className="px-5 py-4 text-zinc-600">{account?.name || "—"}</td>
                      <td className="px-5 py-4 text-zinc-500">{customer.created_at ? new Date(customer.created_at).toLocaleDateString("en-IN") : "—"}</td>
                    </tr>
                  );
                })}
                {customers.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-zinc-500">No customers found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5"><h3 className="font-semibold text-zinc-950">Plans</h3><p className="mt-2 text-sm text-zinc-500">Starter ₹499 · Growth ₹999 · Pro ₹1,999 · Enterprise ₹4,999</p></div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5"><h3 className="font-semibold text-zinc-950">Subscriptions</h3><p className="mt-2 text-sm text-zinc-500">Billing database and payment gateway can be connected next.</p></div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5"><h3 className="font-semibold text-zinc-950">Platform</h3><p className="mt-2 text-sm text-zinc-500">This panel is protected by the dedicated ADMIN_EMAIL gate.</p></div>
        </section>
      </div>
    </main>
  );
}
