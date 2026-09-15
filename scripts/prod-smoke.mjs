const baseUrl = (process.env.PROD_BASE_URL || '').replace(/\/$/, '')
const email = process.env.PROD_SMOKE_EMAIL
const password = process.env.PROD_SMOKE_PASSWORD

if (!baseUrl || !email || !password) {
  throw new Error('PROD_BASE_URL, PROD_SMOKE_EMAIL and PROD_SMOKE_PASSWORD are required')
}

async function expectStatus(name, response, allowed) {
  if (!allowed.includes(response.status)) {
    const text = await response.text()
    throw new Error(`${name} failed: HTTP ${response.status} ${text.slice(0, 300)}`)
  }
  console.log(`PASS ${name}: HTTP ${response.status}`)
}

// 1. Public operational health check.
const health = await fetch(`${baseUrl}/api/health`, { cache: 'no-store' })
await expectStatus('health', health, [200])

// 2. Authenticate through the same-origin login API used by the app.
const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: baseUrl,
    referer: `${baseUrl}/login`,
  },
  body: JSON.stringify({ email, password }),
})
await expectStatus('auth', login, [200])

// Node's fetch does not maintain a browser cookie jar. Carry Supabase's
// auth cookies into the authenticated core-route check.
const setCookie = login.headers.getSetCookie?.() || []
if (setCookie.length === 0) {
  throw new Error('auth passed but no session cookies were returned')
}
const cookieHeader = setCookie.map((value) => value.split(';', 1)[0]).join('; ')

// 3. Authenticated core application route.
const dashboard = await fetch(`${baseUrl}/dashboard`, {
  headers: { cookie: cookieHeader },
  redirect: 'manual',
  cache: 'no-store',
})
await expectStatus('authenticated dashboard', dashboard, [200])

console.log('PRODUCTION SMOKE TEST PASSED')
