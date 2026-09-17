import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  icon: ComponentType<{ className?: string }>
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
}

export function MetricCard({ title, value, icon: Icon, delta, subtitle }: MetricCardProps) {
  return (
    <div className="metric-card p-5 sm:p-5.5">
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/85">
            {title}
          </p>
          <p className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-foreground sm:text-[32px]">
            {value}
          </p>
        </div>
        <div className="metric-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary">
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>

      {delta ? (
        <div className="relative z-10 mt-5">
          <DeltaRow sign={delta.sign} label={delta.label} />
        </div>
      ) : subtitle ? (
        <p className="relative z-10 mt-4 text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-emerald-400'
      : sign < 0
      ? 'text-red-400'
      : 'text-muted-foreground'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/35 px-2.5 py-1 text-xs font-medium', tone)}>
      <Arrow className="h-3.5 w-3.5" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}
