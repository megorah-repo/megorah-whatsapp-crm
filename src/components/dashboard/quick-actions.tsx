"use client"

import Link from 'next/link'
import { UserPlus, Briefcase, Radio, Zap } from 'lucide-react'
import type { ComponentType } from 'react'

import { useTranslations } from 'next-intl'

interface Action {
  labelKey: string
  href: string
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { labelKey: 'newContact', href: '/contacts', icon: UserPlus, tint: 'text-primary' },
  { labelKey: 'newDeal', href: '/pipelines', icon: Briefcase, tint: 'text-blue-400' },
  { labelKey: 'newBroadcast', href: '/broadcasts/new', icon: Radio, tint: 'text-amber-400' },
  { labelKey: 'newAutomation', href: '/automations/new', icon: Zap, tint: 'text-primary' },
]

export function QuickActions() {
  const t = useTranslations('Dashboard.quickActions')

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="quick-action group flex min-h-16 items-center gap-3 px-4 py-3"
          >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/45 ${a.tint}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium tracking-[-0.01em] text-foreground">{t(a.labelKey as string)}</span>
          </Link>
        )
      })}
    </div>
  )
}
