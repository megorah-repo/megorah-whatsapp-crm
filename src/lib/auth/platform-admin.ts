import { createClient } from '@/lib/supabase/server'

function parseEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false

  const configured = parseEmails(process.env.PLATFORM_ADMIN_EMAILS)
  return configured.has(email.trim().toLowerCase())
}

export async function requirePlatformAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { authorized: false as const, user: null, status: 401 as const }
  }

  if (!isPlatformAdminEmail(user.email)) {
    return { authorized: false as const, user, status: 403 as const }
  }

  return { authorized: true as const, user, status: 200 as const }
}
