import { createClient } from '@/lib/supabase/server';

type AdminAllowed = {
  authorized: true;
  user: { id: string; email: string | null };
};

type AdminDenied = {
  authorized: false;
  status: 401 | 403;
  reason: string;
};

export type AdminCheck = AdminAllowed | AdminDenied;

function csv(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin(): Promise<AdminCheck> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { authorized: false, status: 401, reason: 'Authentication required.' };
  }

  const allowedEmails = csv(process.env.MEGORAH_ADMIN_EMAILS);
  const allowedUserIds = csv(process.env.MEGORAH_ADMIN_USER_IDS);
  const email = user.email?.toLowerCase() ?? '';

  if (
    allowedEmails.length === 0 &&
    allowedUserIds.length === 0
  ) {
    return {
      authorized: false,
      status: 403,
      reason:
        'Admin access is not configured. Set MEGORAH_ADMIN_EMAILS or MEGORAH_ADMIN_USER_IDS in the server environment.',
    };
  }

  const authorized =
    allowedUserIds.includes(user.id.toLowerCase()) ||
    (!!email && allowedEmails.includes(email));

  if (!authorized) {
    return {
      authorized: false,
      status: 403,
      reason: 'Your account is authenticated but is not allowlisted for the global admin panel.',
    };
  }

  return {
    authorized: true,
    user: { id: user.id, email: user.email ?? null },
  };
}
