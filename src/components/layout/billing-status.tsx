'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CalendarClock, CreditCard, Plus, QrCode, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type SubscriptionRow = {
  plan_id: string | null;
  started_at: string | null;
  current_period_end: string | null;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
};

function getSubscriptionDays(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const total = Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 86400000,
  );
  return total > 0 ? total : null;
}

function getPlanLabel(totalDays: number | null) {
  if (!totalDays) return 'Subscription';
  if (totalDays <= 31) return '1 month';
  if (totalDays >= 330 && totalDays <= 370) return '1 year';
  return totalDays + '-day plan';
}

function getHeartbeatDuration(daysLeft: number) {
  if (daysLeft <= 0) return '600ms';
  if (daysLeft === 1) return '720ms';
  if (daysLeft === 2) return '980ms';
  if (daysLeft === 3) return '1250ms';
  if (daysLeft === 4) return '1600ms';
  return '2000ms';
}

function getDaysLeft(end: string | null) {
  if (!end) return 0;
  return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000));
}

export function BillingStatus() {
  const { accountId } = useAuth();
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setTick(Date.now());
    const timer = window.setInterval(() => setTick(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from('subscriptions')
        .select('plan_id,started_at,current_period_end,status')
        .eq('account_id', accountId)
        .in('status', ['active', 'trialing', 'past_due'])
        .order('current_period_end', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setSubscription(data ?? null);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [accountId]);

  const daysLeft = useMemo(() => {
    void tick;
    return getDaysLeft(subscription?.current_period_end ?? null);
  }, [subscription?.current_period_end, tick]);

  const tone =
    daysLeft <= 9 ? 'red' : daysLeft <= 18 ? 'yellow' : 'green';

  const toneClass = {
    green:
      'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    yellow:
      'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    red:
      'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
  }[tone];

  const dotClass = {
    green: 'bg-emerald-500',
    yellow: 'bg-amber-500',
    red: 'bg-red-500',
  }[tone];

  const totalDays = getSubscriptionDays(
    subscription?.started_at ?? null,
    subscription?.current_period_end ?? null,
  );
  const planLabel = getPlanLabel(totalDays);
  const isHeartbeat = daysLeft >= 1 && daysLeft <= 5;
  const heartbeatDuration = getHeartbeatDuration(daysLeft);

  if (loading) {
    return (
      <div className="flex h-8 min-w-[112px] shrink-0 items-center rounded-full border border-border bg-muted/40 px-2.5 text-[11px] font-medium text-muted-foreground sm:min-w-[128px] sm:px-3 sm:text-xs">
        Subscription…
      </div>
    );
  }

  return (
    <>
      <style jsx global>{`
        @keyframes megorah-subscription-heartbeat {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
          10% {
            transform: scale(1.018);
            box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12);
          }
          20% {
            transform: scale(1);
            box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.03);
          }
          30% {
            transform: scale(1.012);
            box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.09);
          }
          40%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
          }
        }

        .megorah-subscription-heartbeat {
          animation-name: megorah-subscription-heartbeat;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          transform-origin: center;
        }

        @media (prefers-reduced-motion: reduce) {
          .megorah-subscription-heartbeat {
            animation: none !important;
          }
        }
      `}</style>
      <div
        className={cn(
          'flex h-8 min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tracking-tight transition-shadow sm:gap-2 sm:px-3 sm:text-xs',
          toneClass,
          isHeartbeat && 'megorah-subscription-heartbeat',
        )}
        style={
          isHeartbeat
            ? ({ animationDuration: heartbeatDuration } as CSSProperties)
            : undefined
        }
        title={
          daysLeft > 0
            ? planLabel + ' · ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' remaining'
            : 'Subscription expired'
        }
      >
        <span className={cn('size-2 shrink-0 rounded-full', dotClass, isHeartbeat && 'animate-pulse')} />
        <span className="hidden max-w-[90px] truncate sm:inline">
          {planLabel}
        </span>
        <span className="shrink-0 whitespace-nowrap">
          {daysLeft > 0 ? daysLeft + 'd left' : 'Expired'}
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="ml-0.5 rounded-full"
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
              The countdown above reflects the actual subscription end date stored for this workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-2xl border border-border bg-muted/30 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">{planLabel}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Workspace access is active until{' '}
                  {subscription?.current_period_end
                    ? new Date(subscription.current_period_end).toLocaleDateString('en-IN')
                    : 'the recorded expiry date'}.
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
              On successful payment, the next period follows the purchased subscription duration.
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button disabled>Continue to payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
