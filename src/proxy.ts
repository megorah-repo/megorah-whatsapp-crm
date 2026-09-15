import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const protectedPaths = [
  '/dashboard',
  '/inbox',
  '/contacts',
  '/pipelines',
  '/broadcasts',
  '/automations',
  '/settings',
]

function isProtectedPath(pathname: string) {
  return protectedPaths.some((path) => pathname.startsWith(path))
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Never allow missing deployment configuration to crash the routing layer.
  // Public pages remain reachable, while protected pages fail closed to /login.
  if (!supabaseUrl || !supabaseAnonKey) {
    if (isProtectedPath(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/api/whatsapp/') && !pathname.includes('/webhook')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    })

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie)
      })
      return response
    }

    // Auth pages - redirect to dashboard if already logged in.
    if (
      user &&
      (pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password')
    ) {
      const url = request.nextUrl.clone()
      const inviteToken = request.nextUrl.searchParams.get('invite')

      if (inviteToken && (pathname === '/login' || pathname === '/signup')) {
        url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      } else {
        url.pathname = '/dashboard'
      }
      url.search = ''

      return withRefreshedCookies(NextResponse.redirect(url))
    }

    // Protected pages - redirect to login if not authenticated.
    if (!user && isProtectedPath(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      return withRefreshedCookies(NextResponse.redirect(url))
    }

    // API routes that need auth (not webhooks).
    if (!user && pathname.startsWith('/api/whatsapp/') && !pathname.includes('/webhook')) {
      return withRefreshedCookies(
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      )
    }

    return supabaseResponse
  } catch (error) {
    // The routing boundary must never take the whole site down because of an
    // unexpected auth/session exception. Fail closed for protected resources.
    console.error('[proxy] auth/session check failed', error)

    if (isProtectedPath(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      return NextResponse.redirect(url)
    }

    if (pathname.startsWith('/api/whatsapp/') && !pathname.includes('/webhook')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
