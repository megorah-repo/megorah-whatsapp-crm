'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CreditCard, Plus, QrCode, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type SubscriptionRow = {
  current_period_end: string | null
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
}

function getDaysLeft(end: string | null) {
  if (!end) return 0
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000))
}

export function BillingStatus() {
  const { accountId } = useAuth()
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!accountId) return

    let cancelled = false

    const load = async () => {
      setLoading(true)
      const supabase = createClient()
      const { data } = await supabase
        .from('subscriptions')
        .select('current_period_end,status')
        .eq('account_id', accountId)
        .in('status', ['active', 'trialing', 'past_due'])
        .order('current_period_end', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!cancelled) {
        setSubscription(data ?? null)
        setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [accountId])

  const daysLeft = useMemo(() => {
    void tick
    return getDaysLeft(subscription?.current_period_end ?? null)
  }, [subscription?.current_period_end, tick])

  // 30-day plan:
  // 19–30 days left = green (roughly first 12 days)
  // 6–18 days left = yellow (middle 12–13 days)
  // 0–5 days left = red with increasingly fast attention pulse
  const tone = daysLeft <= 5 ? 'red' : daysLeft <= 18 ? 'yellow' : 'green'

  const toneClass = {
    green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    yellow: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    red: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
  }[tone]

  const dotClass = {
    green: 'bg-emerald-500',
    yellow: 'bg-amber-500',
    red: 'bg-red-500',
  }[tone]

  const pulseDuration =
    daysLeft <= 0
      ? 0.45
      : Math.max(0.55, Math.min(1.5, daysLeft * 0.3))

  if (loading) {
    return (
      <div className="flex h-8 min-w-0 items-center rounded-full border border-border bg-muted/40 px-2.5 text-[11px] text-muted-foreground sm:text-xs">
        Subscription…
      </div>
    )
  }

  const attentionStyle =
    tone === 'red'
      ? { animationDuration: `${pulseDuration}s` }
      : undefined

  return (
    <>
      <div
        className={cn(
          'flex h-8 min-w-0 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium sm:gap-2 sm:px-2.5 sm:text-xs',
          toneClass,
          tone === 'red' && 'animate-pulse',
        )}
        style={attentionStyle}
        title="Subscription remaining"
      >
        <span className={cn('size-2 shrink-0 rounded-full', dotClass)} />
        <span className="whitespace-nowrap">
          {daysLeft > 0 ? `${daysLeft} days left` : 'Subscription expired'}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="ml-0 rounded-full"
          aria-label="Recharge subscription"
          onClick={() => setOpen(true)}
        >
          <Plus />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="size-4 text-primary" />
              Recharge subscription
            </DialogTitle>
            <DialogDescription>
              Renew your workspace for another 30 days. Payment gateway integration can be connected here without changing the subscription countdown UI.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-2xl border border-border bg-muted/30 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">30-day plan</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Full workspace access for the next 30 days.
                </div>
              </div>
              <Sparkles className="size-5 text-primary" />
            </div>

            <div className="mt-5 flex min-h-44 items-center justify-center rounded-xl border border-dashed border-border bg-background">
              <div className="text-center">
                <QrCode className="mx-auto size-12 text-muted-foreground" />
                <div className="mt-2 text-sm font-medium">Payment QR / gateway</div>
                <div className="mt-1 max-w-xs text-xs text-muted-foreground">
                  QR/UPI/card checkout will appear here when the payment gateway is connected.
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarClock className="size-4" />
              On successful payment, the next period will add 30 days.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button disabled>Continue to payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
