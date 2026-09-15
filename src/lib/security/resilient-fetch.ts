const DEFAULT_TIMEOUT_MS = 8_000
const MAX_ATTEMPTS = 2
const BASE_BACKOFF_MS = 250

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

export async function resilientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; maxAttempts?: number } = {},
): Promise<Response> {
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const maxAttempts = Math.min(2, Math.max(1, options.maxAttempts ?? MAX_ATTEMPTS))

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await globalThis.fetch(input, {
        ...init,
        signal: controller.signal,
      })

      if (response.ok || !isRetryableStatus(response.status) || attempt >= maxAttempts) {
        return response
      }
    } catch (error) {
      if (attempt >= maxAttempts) {
        const message = isAbortError(error)
          ? 'Upstream request timed out.'
          : 'Upstream request failed.'
        return new Response(JSON.stringify({ error: { message } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } finally {
      clearTimeout(timer)
    }

    await new Promise((resolve) => setTimeout(resolve, BASE_BACKOFF_MS * 2 ** (attempt - 1)))
  }

  return new Response(JSON.stringify({ error: { message: 'Upstream request failed.' } }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })
}
