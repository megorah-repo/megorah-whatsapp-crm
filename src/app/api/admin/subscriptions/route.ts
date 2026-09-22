import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

export const dynamic = 'force-dynamic';

type Body = {
  accountId?: string;
  action?: 'extend_30' | 'restore_30' | 'cancel';
};

export async function POST(request: Request) {
  const auth = await requireAdmin();

  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!body.accountId || !body.action) {
    return NextResponse.json(
      { error: 'accountId and action are required.' },
      { status: 400 },
    );
  }

  try {
    const supabase = createServiceRoleClient();
    const { data: existing, error: existingError } = await supabase
      .from('subscriptions')
      .select('id,current_period_end,status,plan_id,started_at')
      .eq('account_id', body.accountId)
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;

    if (body.action === 'cancel') {
      if (!existing?.id) {
        return NextResponse.json(
          { error: 'No subscription exists for this account.' },
          { status: 404 },
        );
      }

      const { error } = await supabase
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', existing.id);

      if (error) throw error;

      return NextResponse.json({
        ok: true,
        action: body.action,
        currentPeriodEnd: existing.current_period_end,
      });
    }

    const now = new Date();
    const existingEnd = existing?.current_period_end
      ? new Date(existing.current_period_end)
      : null;

    const base =
      body.action === 'extend_30' && existingEnd && existingEnd > now
        ? existingEnd
        : now;

    const nextEnd = new Date(base.getTime() + 30 * 86400000).toISOString();

    if (existing?.id) {
      const { error } = await supabase
        .from('subscriptions')
        .update({
          plan_id: existing.plan_id ?? 'starter',
          status: 'active',
          started_at: existing.started_at ?? now.toISOString(),
          current_period_end: nextEnd,
        })
        .eq('id', existing.id);

      if (error) throw error;
    } else {
      const { error } = await supabase.from('subscriptions').insert({
        account_id: body.accountId,
        plan_id: 'starter',
        status: 'active',
        started_at: now.toISOString(),
        current_period_end: nextEnd,
      });

      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      action: body.action,
      currentPeriodEnd: nextEnd,
    });
  } catch (error) {
    console.error('[admin/subscriptions]', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Subscription action failed.',
      },
      { status: 500 },
    );
  }
}
