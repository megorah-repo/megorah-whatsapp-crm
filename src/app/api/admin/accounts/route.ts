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
      return NextResponse.json({ accounts: [] })
    }

    const [{ data: owners, error: ownersError }, { data: subscriptions, error: subscriptionsError }] =
      await Promise.all([
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
      ])

    if (ownersError) throw ownersError
    if (subscriptionsError) throw subscriptionsError

    const ownerByAccount = new Map(
      (owners ?? []).map((owner) => [owner.account_id, owner]),
    )

    const subscriptionByAccount = new Map<string, (typeof subscriptions)[number]>()

    for (const subscription of subscriptions ?? []) {
      if (!subscriptionByAccount.has(subscription.account_id)) {
        subscriptionByAccount.set(subscription.account_id, subscription)
      }
    }

    return NextResponse.json({
      accounts: (accounts ?? []).map((account) => ({
        ...account,
        owner: ownerByAccount.get(account.id) ?? null,
        subscription: subscriptionByAccount.get(account.id) ?? null,
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
