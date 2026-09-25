'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Bot, Sparkles, Settings2, BarChart3, PhoneCall } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
const AiPlayground = dynamic(() => import('@/components/agents/ai-playground').then((mod) => mod.AiPlayground), { loading: () => <PageSkeleton />, ssr: false });
const AiUsageCard = dynamic(() => import('@/components/agents/ai-usage').then((mod) => mod.AiUsageCard), { loading: () => <PageSkeleton />, ssr: false });
const AiCallingPanel = dynamic(() => import('@/components/agents/ai-calling-panel').then((mod) => mod.AiCallingPanel), { loading: () => <PageSkeleton />, ssr: false });
const AiConfig = dynamic(() => import('@/components/settings/ai-config').then((mod) => mod.AiConfig), { loading: () => <PageSkeleton />, ssr: false });
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab = 'playground' | 'setup' | 'calling' | 'usage';

function PageSkeleton() {
  return <div className="min-h-[420px] animate-pulse rounded-xl border border-border bg-card" aria-label="Loading AI Agent" />;
}

export default function AgentsPage() {
  const { accountRole } = useAuth();
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const canEdit = canViewUsage;
  const [tab, setTab] = useState<Tab>('playground');

  // Keep navigation instant: do not wait on an API request to decide which
  // tab to render. Remember the last tab locally instead.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('megorah-ai-agents-tab-v1');
      if (saved === 'playground' || saved === 'setup' || saved === 'calling' || saved === 'usage') {
        setTab(saved);
      }
    } catch {
      // Local preference is optional.
    }
  }, []);

  // Warm the lazy-loaded tabs after first paint so switching between
  // Playground / Setup / AI Calling / Usage feels immediate.
  useEffect(() => {
    const warm = () => {
      void import('@/components/agents/ai-playground');
      void import('@/components/settings/ai-config');
      void import('@/components/agents/ai-calling-panel');
      void import('@/components/agents/ai-usage');
    };

    const w = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm, { timeout: 1200 });
      return () => w.cancelIdleCallback?.(id);
    }

    const timer = window.setTimeout(warm, 300);
    return () => window.clearTimeout(timer);
  }, []);

  const handleTabChange = (value: string) => {
    const next = value as Tab;
    setTab(next);
    try {
      window.localStorage.setItem('megorah-ai-agents-tab-v1', next);
    } catch {
      // Local preference is optional.
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          AI Agents
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Your bring-your-own-key AI agent — set it up, then test it in the
        playground before it replies to customers in the inbox.
      </p>

      {true && (
        <Tabs
          value={tab}
          onValueChange={handleTabChange}
          className="mt-6"
        >
          <TabsList>
            <TabsTrigger value="playground">
              <Sparkles className="mr-1.5 h-4 w-4" /> Playground
            </TabsTrigger>
            <TabsTrigger value="setup">
              <Settings2 className="mr-1.5 h-4 w-4" /> Setup
            </TabsTrigger>
            <TabsTrigger value="calling">
              <PhoneCall className="mr-1.5 h-4 w-4" /> AI Calling
            </TabsTrigger>
            {canViewUsage && (
              <TabsTrigger value="usage">
                <BarChart3 className="mr-1.5 h-4 w-4" /> Usage
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="playground" className="mt-4">
            <AiPlayground onGoToSetup={() => setTab('setup')} />
          </TabsContent>

          <TabsContent value="setup" className="mt-4">
            <AiConfig />
          </TabsContent>

          <TabsContent value="calling" className="mt-4">
            <AiCallingPanel canEdit={canEdit} />
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="usage" className="mt-4">
              <AiUsageCard />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
