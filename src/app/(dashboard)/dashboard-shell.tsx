"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
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
    <div className={`brand-shell ${styles.shell} ${workspaceStyles.workspace} flex h-screen overflow-hidden bg-background`}>
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="brand-main flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main className={`brand-content flex-1 overflow-y-auto p-4 sm:p-6${isInbox ? ` ${inboxStyles.page}` : ""}`}>
          <AccountAccessAlert />
          <div className="brand-page-in">{children}</div>
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
