type LogLevel = 'info' | 'warn' | 'error'

type LogContext = Record<string, unknown>

function write(level: LogLevel, event: string, context: LogContext = {}) {
  // JSON logs are intentionally single-line and secret-safe. Never pass
  // access tokens, cookies, authorization headers, passwords or request bodies
  // into context. Vercel/other log drains can parse these fields directly.
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'megorah-whatsapp-crm',
    event,
    ...context,
  }

  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (event: string, context?: LogContext) => write('info', event, context),
  warn: (event: string, context?: LogContext) => write('warn', event, context),
  error: (event: string, context?: LogContext) => write('error', event, context),
}
