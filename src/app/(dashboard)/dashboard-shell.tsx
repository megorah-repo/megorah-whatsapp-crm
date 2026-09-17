"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { QuickTools } from "@/components/layout/quick-tools";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import styles from "@/components/layout/premium-surface.module.css";
import workspaceStyles from "@/components/layout/premium-redesign.module.css";
import inboxStyles from "@/components/layout/inbox-premium.module.css";

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="brand-loading min-h-screen">
        <div className="brand-loading-orb" />
        <div className="brand-loader" aria-hidden="true" />
        <p>Preparing your workspace…</p>
      </div>
    );
  }

  if (!user) return null;

  const isInbox = pathname === "/inbox";

  return (
    <div
      className={`brand-shell ${styles.shell} ${workspaceStyles.workspace} flex h-screen min-w-0 w-full max-w-full overflow-hidden bg-background`}
    >
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="brand-main flex min-w-0 w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <QuickTools />
        <main
          className={`brand-content min-w-0 w-full max-w-full flex-1 overflow-x-auto overflow-y-auto overscroll-x-contain p-3 sm:p-4 md:p-6${isInbox ? ` ${inboxStyles.page}` : ""}`}
        >
          <div className="brand-page-in min-w-0 w-full max-w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}
