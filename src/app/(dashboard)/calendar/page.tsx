"use client";

import { useState } from "react";
import { CalendarDays, Check, Copy, ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CalendarPage() {
  const [bookingLink, setBookingLink] = useState("");
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!bookingLink) return;
    await navigator.clipboard.writeText(bookingLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Calendar Booking
          </h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Put a booking link directly inside your CRM so customers can book a
          meeting from WhatsApp, email, or your follow-up flows.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">Add your booking link</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Paste your Google Calendar appointment page, Cal.com, Calendly,
                or any booking URL.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <label htmlFor="booking-link" className="text-sm font-medium text-foreground">
              Booking URL
            </label>
            <input
              id="booking-link"
              value={bookingLink}
              onChange={(e) => setBookingLink(e.target.value)}
              placeholder="https://cal.com/your-name/demo"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:border-primary"
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={copyLink} disabled={!bookingLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy booking link"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!bookingLink}
              onClick={() => window.open(bookingLink, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4" /> Open
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <h2 className="font-semibold text-foreground">Use it anywhere</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              ["WhatsApp", "Send the booking link from the inbox or an automation."],
              ["Email", "Add the same link to campaigns and follow-ups."],
              ["AI & Flows", "Let customers reach booking after qualification."],
            ].map(([title, description]) => (
              <div key={title} className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="text-sm font-semibold text-foreground">{title}</div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-xs leading-5 text-muted-foreground">
            Booking providers still control the actual calendar and appointment
            slot. This page gives the CRM one direct place to store and use the
            booking URL.
          </div>
        </section>
      </div>
    </div>
  );
}
