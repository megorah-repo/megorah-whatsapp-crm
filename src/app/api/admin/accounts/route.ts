import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin-client'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'

export async function GET() {
  const access = await requirePlatformAdmin()

  if (!access.authorized) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status },
    )
  }

  try {
    const admin = createAdminClient()

    const { data: accounts, error: accountsError } = await admin
      .from('accounts')
      .select('id,name,owner_user_id')
      .order('name', { ascending: true })

    if (accountsError) throw accountsError

    const ids = (accounts ?? []).map((account) => account.id)

    if (!ids.length) {
      return NextResponse.json({ accounts: [], plans: [] })
    }

    const [
      { data: owners, error: ownersError },
      { data: subscriptions, error: subscriptionsError },
      { data: plans, error: plansError },
      { data: platformSubscriptions, error: platformSubscriptionsError },
      { data: onboarding, error: onboardingError },
    ] = await Promise.all([
      admin
        .from('profiles')
        .select('account_id,full_name,email')
        .in('account_id', ids)
        .eq('account_role', 'owner'),
      admin
        .from('subscriptions')
        .select('id,account_id,plan_id,status,started_at,current_period_end')
        .in('account_id', ids)
        .order('current_period_end', { ascending: false }),
      admin
        .from('billing_plans')
        .select('id,name,description,price_inr_monthly,max_users,max_contacts,max_automations')
        .eq('active', true)
        .order('price_inr_monthly', { ascending: true }),
      admin
        .from('platform_subscriptions')
        .select('account_id,plan_name,monthly_charge,currency,status,billing_cycle,started_at,next_billing_at,payment_provider,external_customer_id,external_subscription_id,notes')
        .in('account_id', ids),
      admin
        .from('platform_onboarding')
        .select('account_id,status,owner_assigned,whatsapp_connected,contacts_imported,templates_ready,team_invited,first_message_sent,notes,started_at,completed_at')
        .in('account_id', ids),
    ])

    if (ownersError) throw ownersError
    if (subscriptionsError) throw subscriptionsError
    if (plansError) throw plansError
    if (platformSubscriptionsError) throw platformSubscriptionsError
    if (onboardingError) throw onboardingError

    const ownerByAccount = new Map(
      (owners ?? []).map((owner) => [owner.account_id, owner]),
    )

    const subscriptionByAccount = new Map<string, (typeof subscriptions)[number]>()
    for (const subscription of subscriptions ?? []) {
      if (!subscriptionByAccount.has(subscription.account_id)) {
        subscriptionByAccount.set(subscription.account_id, subscription)
      }
    }

    const platformSubscriptionByAccount = new Map(
      (platformSubscriptions ?? []).map((subscription) => [subscription.account_id, subscription]),
    )

    const onboardingByAccount = new Map(
      (onboarding ?? []).map((item) => [item.account_id, item]),
    )

    return NextResponse.json({
      plans: plans ?? [],
      accounts: (accounts ?? []).map((account) => ({
        ...account,
        owner: ownerByAccount.get(account.id) ?? null,
        subscription: subscriptionByAccount.get(account.id) ?? null,
        platformSubscription: platformSubscriptionByAccount.get(account.id) ?? null,
        onboarding: onboardingByAccount.get(account.id) ?? null,
      })),
    })
  } catch (error) {
    console.error('[admin/accounts] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load accounts' },
      { status: 500 },
    )
  }
}
