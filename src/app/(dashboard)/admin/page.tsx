'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, CheckCircle2, Loader2, PauseCircle, Plus, RefreshCw, Search, ShieldAlert, UserRound } from 'lucide-react'

type Subscription = {
  id: string
  account_id: string
  plan_id: string
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
  started_at: string | null
  current_period_end: string | null
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
}

function daysLeft(end: string | null) {
  if (!end) return 0
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000))
}

function tone(days: number) {
  if (days <= 5) return 'text-red-600 bg-red-500/10 border-red-500/20'
  if (days <= 18) return 'text-amber-600 bg-amber-500/10 border-amber-500/20'
  return 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20'
}

export default function PlatformAdminPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/accounts', { cache: 'no-store' })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to load client accounts')
      }

      setAccounts(payload.accounts ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load client accounts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filteredAccounts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return accounts

    return accounts.filter((account) => {
      const owner = account.owner?.email ?? ''
      return (
        account.name.toLowerCase().includes(needle) ||
        owner.toLowerCase().includes(needle)
      )
    })
  }, [accounts, query])

  async function runAction(accountId: string, action: 'extend' | 'replace' | 'activate' | 'suspend', days = 30) {
    setWorking(`${accountId}:${action}`)
    setError(null)

    try {
      const response = await fetch('/api/admin/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, action, days }),
      })

      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error ?? 'Subscription update failed')
      }

      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subscription update failed')
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
            <ShieldAlert className="size-3.5" />
            Platform control
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Client Admin Panel
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Manage every Megorah AI CRM client from one place. Subscription changes apply to the client workspace automatically.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          <RefreshCw className="size-4" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
          {error.toLowerCase().includes('forbidden') ? (
            <div className="mt-1 text-xs opacity-80">
              Add the platform admin email to PLATFORM_ADMIN_EMAILS before using this panel.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="premium-panel p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clients</div>
          <div className="mt-2 text-3xl font-semibold">{accounts.length}</div>
        </div>
        <div className="premium-panel p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active</div>
          <div className="mt-2 text-3xl font-semibold">{accounts.filter((a) => a.subscription?.status === 'active').length}</div>
        </div>
        <div className="premium-panel p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Expiring ≤ 5 days</div>
          <div className="mt-2 text-3xl font-semibold">{accounts.filter((a) => daysLeft(a.subscription?.current_period_end ?? null) <= 5).length}</div>
        </div>
      </div>

      <div className="premium-panel p-4 sm:p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search client or owner email"
            className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-4 text-sm outline-none ring-primary/20 transition focus:ring-4"
          />
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
            const actionBusy = working?.startsWith(account.id)

            return (
              <div key={account.id} className="premium-panel overflow-hidden">
                <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Building2 className="size-4 text-primary" />
                      <h2 className="truncate text-base font-semibold text-foreground">{account.name}</h2>
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
                      {account.subscription?.current_period_end ? (
                        <span>
                          Ends {new Date(account.subscription.current_period_end).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void runAction(account.id, 'extend', 30)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                      {actionBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                      30 days
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(actionBusy)}
                      onClick={() => void runAction(account.id, 'extend', 7)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
                    >
                      +7 days
                    </button>
                    {status === 'cancelled' ? (
                      <button
                        type="button"
                        disabled={Boolean(actionBusy)}
                        onClick={() => void runAction(account.id, 'activate', 30)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-500/15 disabled:opacity-50 dark:text-emerald-300"
                      >
                        <CheckCircle2 className="size-3.5" />
                        Activate
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(actionBusy)}
                        onClick={() => void runAction(account.id, 'suspend', 0)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/5 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-500/10 disabled:opacity-50 dark:text-red-300"
                      >
                        <PauseCircle className="size-3.5" />
                        Suspend
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
