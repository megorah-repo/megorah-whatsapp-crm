import { logger } from '@/lib/observability/logger'

export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: {
    routerKind?: string
    routePath?: string
    routeType?: string
    renderSource?: string
  }
) {
  const normalized = error instanceof Error ? error : new Error(String(error))

  logger.error('unhandled_request_error', {
    error_name: normalized.name,
    error_message: normalized.message,
    path: request.path,
    method: request.method,
    router_kind: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
    render_source: context.renderSource,
  })
}
