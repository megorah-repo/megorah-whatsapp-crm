"use client";

import { useEffect, useState } from "react";
import { Check, Mail, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const DRAFT_KEY = "megorah.emailMarketing.draft";

interface Draft {
  campaignName: string;
  audience: string;
  subject: string;
  message: string;
}

const EMPTY_DRAFT: Draft = {
  campaignName: "",
  audience: "All contacts",
  subject: "",
  message: "",
};

export default function EmailMarketingPage() {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DRAFT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Draft>;
        queueMicrotask(() => setDraft({ ...EMPTY_DRAFT, ...parsed }));
      }
    } catch {
      // Keep the composer usable if browser storage is unavailable/corrupt.
    }
  }, []);

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch {
      setSaved(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Mail className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Email Marketing
          </h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Draft email campaigns alongside your WhatsApp CRM data. Drafts are saved on this browser until a sending provider is connected.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Quick campaign</h2>
              <p className="text-xs text-muted-foreground">Draft your first email in one place.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Campaign name</span>
              <input
                value={draft.campaignName}
                onChange={(e) => updateDraft("campaignName", e.target.value)}
                placeholder="September follow-up"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Audience</span>
              <select
                value={draft.audience}
                onChange={(e) => updateDraft("audience", e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option>All contacts</option>
                <option>Leads</option>
                <option>Customers</option>
                <option>Unanswered leads</option>
              </select>
            </label>
          </div>

          <label className="mt-4 block space-y-2">
            <span className="text-sm font-medium text-foreground">Subject</span>
            <input
              value={draft.subject}
              onChange={(e) => updateDraft("subject", e.target.value)}
              placeholder="A quick follow-up from Megorah CRM"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </label>

          <label className="mt-4 block space-y-2">
            <span className="text-sm font-medium text-foreground">Message</span>
            <textarea
              rows={8}
              value={draft.message}
              onChange={(e) => updateDraft("message", e.target.value)}
              placeholder="Write your email here..."
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </label>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={saveDraft}>
              {saved ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {saved ? "Draft saved" : "Save draft"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled
              title="Email sending provider integration is not connected yet"
            >
              Connect sending provider
            </Button>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">What this gives you</h2>
            <div className="mt-4 space-y-3">
              {[
                "Campaign drafts beside your CRM contacts",
                "Lead follow-up audience presets",
                "Email + WhatsApp journey planning",
                "Saved campaign copy for later sending",
              ].map((item) => (
                <div key={item} className="flex gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-5">
            <p className="text-sm font-semibold text-foreground">Sending setup</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Drafting is available now. Actual delivery requires a connected provider such as Resend, Amazon SES, SMTP, or another supported sender.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
