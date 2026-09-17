"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Copy, ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "megorah.calendar.bookingLink";

function isValidBookingUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function CalendarPage() {
  const [bookingLink, setBookingLink] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setBookingLink(stored);
    } catch {
      // Storage can be disabled by the browser; the page remains usable.
    }
  }, []);

  function saveLink() {
    if (!isValidBookingUrl(bookingLink.trim())) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, bookingLink.trim());
      setBookingLink(bookingLink.trim());
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch {
      setSaved(false);
    }
  }

  async function copyLink() {
    if (!isValidBookingUrl(bookingLink.trim())) return;
    try {
      await navigator.clipboard.writeText(bookingLink.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const validLink = isValidBookingUrl(bookingLink.trim());

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
          Keep one validated booking link in your CRM workspace so customers can book a meeting from WhatsApp, email, or follow-up flows.
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
                Paste your Google Calendar appointment page, Cal.com, Calendly, or any HTTPS/HTTP booking URL.
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
              onChange={(e) => {
                setBookingLink(e.target.value);
                setSaved(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveLink();
              }}
              placeholder="https://cal.com/your-name/demo"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:border-primary"
            />
            {bookingLink && !validLink && (
              <p className="text-xs text-destructive">
                Enter a valid booking URL beginning with http:// or https://
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" onClick={saveLink} disabled={!validLink}>
              {saved ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {saved ? "Saved" : "Save booking link"}
            </Button>
            <Button type="button" variant="outline" onClick={copyLink} disabled={!validLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy booking link"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!validLink}
              onClick={() => window.open(bookingLink.trim(), "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-4 w-4" /> Open
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            This keeps the link on this browser/device. The external calendar provider still controls slots, availability, and bookings.
          </p>
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
            This page stores and validates the booking URL for quick reuse. Actual calendar availability and appointment creation remain with the connected booking provider.
          </div>
        </section>
      </div>
    </div>
  );
}
