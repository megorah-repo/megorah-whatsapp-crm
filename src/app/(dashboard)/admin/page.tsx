'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'

type Subscription = {
  id: string
  account_id: string
  plan_id: string
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
  started_at: string | null
  current_period_end: string | null
}

type Plan = {
  id: string
  name: string
  description: string
  price_inr_monthly: number
  max_users: number | null
  max_contacts: number | null
  max_automations: number | null
}

type PlatformSubscription = {
  plan_name: string
  monthly_charge: number
  currency: string
  status: 'trial' | 'active' | 'past_due' | 'paused' | 'cancelled'
  billing_cycle: 'monthly' | 'yearly'
  started_at: string | null
  next_billing_at: string | null
  payment_provider: string | null
  external_customer_id: string | null
  external_subscription_id: string | null
  notes: string | null
}

type Onboarding = {
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked'
  owner_assigned: string | null
  whatsapp_connected: boolean
  contacts_imported: boolean
  templates_ready: boolean
  team_invited: boolean
  first_message_sent: boolean
  notes: string | null
  started_at: string | null
  completed_at: string | null
}

type Account = {
  id: string
  name: string
  owner_user_id: string | null
  owner: {
    full_name: string | null
    email: string
  } | null
  subscription: Subscription | null
  platformSubscription: PlatformSubscription | null
  onboarding: Onboarding | null
}

type Filter = 'all' | 'active' | 'expiring' | 'expired' | 'suspended'

const onboardingSteps: Array<[keyof Onboarding, string]> = [
  ['whatsapp_connected', 'WhatsApp connected'],
  ['contacts_imported', 'Contacts imported'],
  ['templates_ready', 'Templates ready'],
  ['team_invited', 'Team invited'],
  ['first_message_sent', 'First message sent'],
]

function daysLeft(end: string | null) {
  if (!end) return 0
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000))
}

function tone(days: number) {
  if (days <= 5) return 'text-red-600 bg-red-500/10 border-red-500/20'
  if (days <= 18) return 'text-amber-600 bg-amber-500/10 border-amber-500/20'
  return 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20'
}

function dateLabel(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function PlatformAdminPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [customDays, setCustomDays] = useState('30')
  const [selectedPlan, setSelectedPlan] = useState('starter')
  const [ownerAssigned, setOwnerAssigned] = useState('')
  const [onboardingStatus, setOnboardingStatus] = useState<Onboarding['status']>('not_started')
  const [onboardingFlags, setOnboardingFlags] = useState<Record<string, boolean>>({})
  const [onboardingNotes, setOnboardingNotes] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/accounts', { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) throw new Error(payload.error ?? 'Unable to load client accounts')

      setAccounts(payload.accounts ?? [])
      setPlans(payload.plans ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load client accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openAccount(account: Account) {
    setSelected(account)
    setSelectedPlan(account.subscription?.plan_id ?? 'starter')
    setCustomDays('30')
    setOwnerAssigned(account.onboarding?.owner_assigned ?? '')
    setOnboardingStatus(account.onboarding?.status ?? 'not_started')
    setOnboardingNotes(account.onboarding?.notes ?? '')
    setOnboardingFlags(
      Object.fromEntries(
        onboardingSteps.map(([key]) => [String(key), Boolean(account.onboarding?.[key])]),
      ),
    )
  }

  const counts = useMemo(() => {
    let active = 0
    let expiring = 0
    let expired = 0
    let suspended = 0

    for (const account of accounts) {
      const status = account.subscription?.status
      const days = daysLeft(account.subscription?.current_period_end ?? null)
      if (['active', 'trialing', 'past_due'].includes(status ?? '')) active++
      if (status === 'cancelled' || account.platformSubscription?.status === 'paused') suspended++
      if (days > 0 && days <= 5 && !['cancelled', 'expired'].includes(status ?? '')) expiring++
      if (days === 0 || status === 'expired') expired++
    }

    return { active, expiring, expired, suspended }
  }, [accounts])

  const filteredAccounts = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return accounts.filter((account) => {
      const status = account.subscription?.status
      const days = daysLeft(account.subscription?.current_period_end ?? null)

      const matchesQuery =
        !needle ||
        account.name.toLowerCase().includes(needle) ||
        (account.owner?.email ?? '').toLowerCase().includes(needle)

      const matchesFilter =
        filter === 'all' ||
        (filter === 'active' && ['active', 'trialing', 'past_due'].includes(status ?? '')) ||
        (filter === 'expiring' && days > 0 && days <= 5) ||
        (filter === 'expired' && (days === 0 || status === 'expired')) ||
        (filter === 'suspended' && (status === 'cancelled' || account.platformSubscription?.status === 'paused'))

      return matchesQuery && matchesFilter
    })
  }, [accounts, filter, query])

  async function subscriptionAction(
    accountId: string,
    action: 'extend' | 'replace' | 'activate' | 'suspend',
    days: number,
  ) {
    setWorking(`subscription:${accountId}`)
    setError(null)

    try {
      const response = await fetch('/api/admin/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: accountId,
          action,
          days,
          plan_id: action === 'replace' || action === 'activate' ? selectedPlan : undefined,
        }),
      })

      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Subscription update failed')

      setAccounts((current) =>
        current.map((account) =>
          account.id === accountId
            ? { ...account, subscription: payload.subscription }
            : account,
        ),
      )
      setSelected((current) =>
        current?.id === accountId
          ? { ...current, subscription: payload.subscription }
          : current,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subscription update failed')
    } finally {
      setWorking(null)
    }
  }

  async function saveClientSettings() {
    if (!selected) return

    setWorking(`settings:${selected.id}`)
    setError(null)

    try {
      const response = await fetch(`/api/admin/accounts/${selected.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onboarding: {
            status: onboardingStatus,
            owner_assigned: ownerAssigned.trim() || null,
            whatsapp_connected: Boolean(onboardingFlags.whatsapp_connected),
            contacts_imported: Boolean(onboardingFlags.contacts_imported),
            templates_ready: Boolean(onboardingFlags.templates_ready),
            team_invited: Boolean(onboardingFlags.team_invited),
            first_message_sent: Boolean(onboardingFlags.first_message_sent),
            notes: onboardingNotes.trim() || null,
          },
        }),
      })

      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'Client settings update failed')

      setAccounts((current) =>
        current.map((account) =>
          account.id === selected.id
            ? { ...account, onboarding: payload.onboarding }
            : account,
        ),
      )
      setSelected((current) =>
        current ? { ...current, onboarding: payload.onboarding } : current,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Client settings update failed')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            <ShieldCheck className="size-3.5" />
            Platform control
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Client Admin Panel</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Manage client access, subscriptions, plans and onboarding from one secure console.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium transition hover:bg-muted"
        >
          <RefreshCw className="size-4" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="premium-panel p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clients</div>
          <div className="mt-2 text-3xl font-semibold">{accounts.length}</div>
        </div>
        <div className="premium-panel p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active</div>
          <div className="mt-2 text-3xl font-semibold">{counts.active}</div>
        </div>
        <div className="premium-panel p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expiring ≤ 5 days</div>
          <div className="mt-2 text-3xl font-semibold">{counts.expiring}</div>
        </div>
        <div className="premium-panel p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Suspended / expired</div>
          <div className="mt-2 text-3xl font-semibold">{counts.suspended + counts.expired}</div>
        </div>
      </div>

      <div className="premium-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search client or owner email"
              className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-4 text-sm outline-none transition focus:ring-4 focus:ring-primary/20"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              ['all', `All · ${accounts.length}`],
              ['active', `Active · ${counts.active}`],
              ['expiring', `Expiring · ${counts.expiring}`],
              ['expired', `Expired · ${counts.expired}`],
              ['suspended', `Suspended · ${counts.suspended}`],
            ] as Array<[Filter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${filter === value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="premium-panel flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading client accounts…
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="premium-panel p-10 text-center text-sm text-muted-foreground">
            No client accounts found.
          </div>
        ) : (
          filteredAccounts.map((account) => {
            const days = daysLeft(account.subscription?.current_period_end ?? null)
            const status = account.subscription?.status ?? 'expired'

            return (
              <div key={account.id} className="premium-panel overflow-hidden">
                <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="size-4 text-primary" />
                      <h2 className="truncate text-base font-semibold">{account.name}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone(days)}`}>
                        {days > 0 ? `${days} days left` : 'Expired'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <UserRound className="size-3.5" />
                        {account.owner?.full_name || 'Owner'}
                      </span>
                      <span>{account.owner?.email || 'No owner email'}</span>
                      <span className="uppercase">{status}</span>
                      <span>Plan: {account.subscription?.plan_id ?? 'starter'}</span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Ends {dateLabel(account.subscription?.current_period_end ?? null)}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openAccount(account)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-semibold transition hover:bg-muted"
                  >
                    Manage client
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm">
          <div className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Building2 className="size-4 text-primary" />
                  <h2 className="truncate text-lg font-semibold">{selected.name}</h2>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tone(daysLeft(selected.subscription?.current_period_end ?? null))}`}>
                    {daysLeft(selected.subscription?.current_period_end ?? null)} days left
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{selected.owner?.email ?? 'No owner email'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close client manager"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              <section className="space-y-3">
                <div>
                  <div className="text-sm font-semibold">Subscription control</div>
                  <div className="text-xs text-muted-foreground">Extend, replace, activate or suspend access.</div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Plan
                    <select
                      value={selectedPlan}
                      onChange={(event) => setSelectedPlan(event.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    >
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} · ₹{Number(plan.price_inr_monthly).toLocaleString('en-IN')}/mo
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs font-medium text-muted-foreground">
                    Custom days
                    <input
                      type="number"
                      min="1"
                      max="3650"
                      value={customDays}
                      onChange={(event) => setCustomDays(event.target.value)}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={working !== null}
                    onClick={() => void subscriptionAction(selected.id, 'extend', Number(customDays) || 30)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {working === `subscription:${selected.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    Add days
                  </button>
                  <button
                    type="button"
                    disabled={working !== null}
                    onClick={() => void subscriptionAction(selected.id, 'extend', 7)}
                    className="rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    +7
                  </button>
                  <button
                    type="button"
                    disabled={working !== null}
                    onClick={() => void subscriptionAction(selected.id, 'extend', 30)}
                    className="rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    +30
                  </button>
                  <button
                    type="button"
                    disabled={working !== null}
                    onClick={() => void subscriptionAction(selected.id, 'replace', Number(customDays) || 30)}
                    className="rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-semibold text-primary disabled:opacity-50"
                  >
                    Replace
                  </button>
                  {['cancelled', 'expired'].includes(selected.subscription?.status ?? 'expired') ? (
                    <button
                      type="button"
                      disabled={working !== null}
                      onClick={() => void subscriptionAction(selected.id, 'activate', Number(customDays) || 30)}
                      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
                    >
                      Activate
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={working !== null}
                      onClick={() => void subscriptionAction(selected.id, 'suspend', 0)}
                      className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 text-xs font-semibold text-red-700 disabled:opacity-50 dark:text-red-300"
                    >
                      Suspend
                    </button>
                  )}
                </div>

                <div className="grid gap-2 rounded-xl border border-border bg-background p-3 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-3"><span>Status</span><span className="font-medium text-foreground">{selected.subscription?.status ?? 'expired'}</span></div>
                  <div className="flex justify-between gap-3"><span>Started</span><span>{dateLabel(selected.subscription?.started_at ?? null)}</span></div>
                  <div className="flex justify-between gap-3"><span>Ends</span><span>{dateLabel(selected.subscription?.current_period_end ?? null)}</span></div>
                </div>
              </section>

              <section className="space-y-3 border-t border-border pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Client onboarding controls</div>
                    <div className="text-xs text-muted-foreground">Stored per client workspace in the platform control layer.</div>
                  </div>
                  {working === `settings:${selected.id}` ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Onboarding status
                    <select
                      value={onboardingStatus}
                      onChange={(event) => setOnboardingStatus(event.target.value as Onboarding['status'])}
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    >
                      <option value="not_started">Not started</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </label>

                  <label className="text-xs font-medium text-muted-foreground">
                    Assigned manager
                    <input
                      value={ownerAssigned}
                      onChange={(event) => setOwnerAssigned(event.target.value)}
                      placeholder="Team member name"
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                    />
                  </label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {onboardingSteps.map(([key, label]) => (
                    <label key={String(key)} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(onboardingFlags[String(key)])}
                        onChange={(event) =>
                          setOnboardingFlags((current) => ({
                            ...current,
                            [String(key)]: event.target.checked,
                          }))
                        }
                        className="size-4 accent-primary"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <label className="text-xs font-medium text-muted-foreground">
                  Internal client notes
                  <textarea
                    value={onboardingNotes}
                    onChange={(event) => setOnboardingNotes(event.target.value)}
                    rows={4}
                    placeholder="Add onboarding, support or commercial notes…"
                    className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground outline-none transition focus:ring-4 focus:ring-primary/20"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void saveClientSettings()}
                  disabled={working !== null}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {working === `settings:${selected.id}` ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Save client controls
                </button>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
