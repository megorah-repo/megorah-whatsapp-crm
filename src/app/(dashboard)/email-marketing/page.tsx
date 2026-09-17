"use client";

import { useState } from "react";
import { Check, Mail, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function EmailMarketingPage() {
  const [saved, setSaved] = useState(false);

  function saveDraft() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
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
          Create simple email campaigns and follow-ups from the same CRM where
          you manage your WhatsApp leads.
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
                placeholder="September follow-up"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Audience</span>
              <select className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary">
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
              placeholder="A quick follow-up from Megorah CRM"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </label>

          <label className="mt-4 block space-y-2">
            <span className="text-sm font-medium text-foreground">Message</span>
            <textarea
              rows={8}
              placeholder="Write your email here..."
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </label>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" onClick={saveDraft}>
              {saved ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
              {saved ? "Draft saved" : "Save draft"}
            </Button>
            <Button type="button" variant="outline">
              Connect sending provider
            </Button>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">What this gives you</h2>
            <div className="mt-4 space-y-3">
              {[
                "Campaigns to CRM contacts",
                "Lead follow-up sequences",
                "Email + WhatsApp journeys",
                "Personalized messages with contact data",
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
              The CRM UI is ready for campaigns. Actual delivery requires a
              connected email provider such as Resend, Amazon SES, SMTP, or
              another transactional/marketing sender.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
