"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Mail } from "lucide-react";
import { cn } from "@/lib/utils";

const tools = [
  {
    href: "/calendar",
    label: "Calendar Booking",
    description: "Bookings & availability",
    icon: CalendarDays,
  },
  {
    href: "/email-marketing",
    label: "Email Marketing",
    description: "Campaigns & follow-ups",
    icon: Mail,
  },
] as const;

export function QuickTools() {
  const pathname = usePathname();

  return (
    <div className="border-b border-border bg-card/60 px-3 py-2 sm:px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
        <span className="mr-1 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Quick tools
        </span>
        {tools.map((tool) => {
          const active = pathname === tool.href || pathname.startsWith(`${tool.href}/`);
          const Icon = tool.icon;

          return (
            <Link
              key={tool.href}
              href={tool.href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-background text-foreground hover:border-primary/30 hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="text-xs font-semibold">{tool.label}</span>
              <span className="hidden text-[10px] text-muted-foreground sm:inline">
                {tool.description}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
