import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

type AccountRow = {
  id: string;
  name: string | null;
  owner_user_id: string | null;
};

type ProfileRow = {
  account_id: string | null;
  user_id: string;
  full_name: string | null;
  email: string | null;
  account_role: string | null;
};

type SubscriptionRow = {
  id: string;
  account_id: string;
  plan_id: string | null;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired' | string;
  started_at: string | null;
  current_period_end: string | null;
};

function daysLeft(end: string | null) {
  if (!end) return 0;
  return Math.ceil((new Date(end).getTime() - Date.now()) / 86400000);
}

export async function GET() {
  const auth = await requireAdmin();

  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.reason },
      { status: auth.status },
    );
  }

  try {
    const supabase = createServiceRoleClient();

    const [accountsResult, profilesResult, subscriptionsResult] =
      await Promise.all([
        supabase
          .from('accounts')
          .select('id,name,owner_user_id')
          .order('name', { ascending: true }),
        supabase
          .from('profiles')
          .select('account_id,user_id,full_name,email,account_role'),
        supabase
          .from('subscriptions')
          .select(
            'id,account_id,plan_id,status,started_at,current_period_end',
          )
          .in('status', ['trialing', 'active', 'past_due', 'cancelled', 'expired']),
      ]);

    if (accountsResult.error) throw accountsResult.error;
    if (profilesResult.error) throw profilesResult.error;
    if (subscriptionsResult.error) throw subscriptionsResult.error;

    const accounts = (accountsResult.data ?? []) as AccountRow[];
    const profiles = (profilesResult.data ?? []) as ProfileRow[];
    const subscriptions = (subscriptionsResult.data ?? []) as SubscriptionRow[];

    const profileByAccount = new Map<string, ProfileRow>();
    for (const profile of profiles) {
      const existing = profile.account_id
        ? profileByAccount.get(profile.account_id)
        : undefined;
      if (
        profile.account_id &&
        (!existing || profile.account_role === 'owner')
      ) {
        profileByAccount.set(profile.account_id, profile);
      }
    }

    const subscriptionByAccount = new Map<string, SubscriptionRow>();
    for (const subscription of subscriptions) {
      const existing = subscriptionByAccount.get(subscription.account_id);
      if (
        !existing ||
        new Date(subscription.current_period_end ?? 0).getTime() >
          new Date(existing.current_period_end ?? 0).getTime()
      ) {
        subscriptionByAccount.set(subscription.account_id, subscription);
      }
    }

    const clients = accounts.map((account) => {
      const owner = profileByAccount.get(account.id);
      const subscription = subscriptionByAccount.get(account.id);
      const days = daysLeft(subscription?.current_period_end ?? null);

      return {
        id: account.id,
        name: account.name || 'Unnamed workspace',
        ownerEmail: owner?.email ?? null,
        ownerName: owner?.full_name ?? null,
        ownerRole: owner?.account_role ?? null,
        subscription: subscription
          ? {
              id: subscription.id,
              planId: subscription.plan_id,
              status: subscription.status,
              startedAt: subscription.started_at,
              currentPeriodEnd: subscription.current_period_end,
              daysLeft: Math.max(0, days),
            }
          : null,
      };
    });

    const alerts = clients
      .flatMap((client) => {
        const items: Array<{
          id: string;
          severity: 'critical' | 'warning' | 'info';
          title: string;
          message: string;
          accountId: string;
        }> = [];

        if (!client.subscription) {
          items.push({
            id: `missing-subscription:${client.id}`,
            severity: 'critical',
            title: 'Subscription missing',
            message: `${client.name} has no active subscription record.`,
            accountId: client.id,
          });
          return items;
        }

        const days = client.subscription.daysLeft;

        if (client.subscription.status === 'past_due') {
          items.push({
            id: `past-due:${client.id}`,
            severity: 'warning',
            title: 'Payment/subscription attention',
            message: `${client.name} is marked past_due. Review the account before access is affected.`,
            accountId: client.id,
          });
        }

        if (
          ['cancelled', 'expired'].includes(client.subscription.status) ||
          days <= 0
        ) {
          items.push({
            id: `expired:${client.id}`,
            severity: 'critical',
            title: 'Subscription expired',
            message: `${client.name} needs a subscription extension before normal access should continue.`,
            accountId: client.id,
          });
        } else if (days <= 5) {
          items.push({
            id: `expiring:${client.id}`,
            severity: 'warning',
            title: 'Subscription expiring soon',
            message: `${client.name} has ${days} day${days === 1 ? '' : 's'} remaining.`,
            accountId: client.id,
          });
        }

        if (!client.ownerEmail) {
          items.push({
            id: `missing-owner-email:${client.id}`,
            severity: 'info',
            title: 'Owner email missing',
            message: `${client.name} has no owner email in the profile data.`,
            accountId: client.id,
          });
        }

        return items;
      })
      .slice(0, 100);

    const activeSubscriptions = clients.filter(
      (client) =>
        client.subscription &&
        ['trialing', 'active'].includes(client.subscription.status) &&
        client.subscription.daysLeft > 0,
    ).length;

    const pastDue = clients.filter(
      (client) => client.subscription?.status === 'past_due',
    ).length;

    const expiringSoon = clients.filter(
      (client) =>
        client.subscription &&
        client.subscription.daysLeft > 0 &&
        client.subscription.daysLeft <= 5,
    ).length;

    const expired = clients.filter(
      (client) =>
        !client.subscription ||
        client.subscription.daysLeft <= 0 ||
        ['expired', 'cancelled'].includes(client.subscription.status),
    ).length;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      admin: {
        email: auth.user.email,
      },
      metrics: {
        totalClients: clients.length,
        activeSubscriptions,
        expiringSoon,
        expired,
        pastDue,
        openAlerts: alerts.length,
      },
      clients,
      alerts,
    });
  } catch (error) {
    console.error('[admin/overview]', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load admin overview.',
      },
      { status: 500 },
    );
  }
}
