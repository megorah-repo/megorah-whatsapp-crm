"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  Megaphone,
  PhoneCall,
  RefreshCw,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type EventItem = {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  htmlLink: string | null;
  meetLink: string | null;
};

type CalendarItem = {
  id: string;
  name: string;
  primary: boolean;
  selected: boolean;
  timeZone: string | null;
};

export default function CalendarPage() {
  const [configured, setConfigured] = useState(true);
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState("primary");
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("Megorah Meeting");
  const [name, setName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [reminder24h, setReminder24h] = useState(true);
  const [reminder1h, setReminder1h] = useState(true);
  const [createdMeet, setCreatedMeet] = useState("");
  const [pipelineSynced, setPipelineSynced] = useState(false);
  const [mode, setMode] = useState<"meeting" | "calendar" | "marketing">("meeting");

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    [],
  );

  async function loadCalendars() {
    setCalendarLoading(true);
    try {
      const response = await fetch("/api/calendar/google/calendars", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        calendars?: CalendarItem[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to load Google calendars.");
      }
      setCalendars(payload.calendars ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load Google calendars.",
      );
    } finally {
      setCalendarLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    try {
      const statusResponse = await fetch("/api/calendar/google/status", {
        cache: "no-store",
      });
      const status = (await statusResponse.json()) as {
        configured?: boolean;
        connected?: boolean;
        email?: string | null;
        calendarId?: string | null;
        error?: string;
      };

      if (!statusResponse.ok) {
        throw new Error(status.error || "Unable to check Google Calendar.");
      }

      setConfigured(status.configured !== false);
      setConnected(Boolean(status.connected));
      setEmail(status.email ?? null);
      setCalendarId(status.calendarId || "primary");

      if (!status.connected) {
        setEvents([]);
        setCalendars([]);
        return;
      }

      await loadCalendars();

      const from = new Date().toISOString();
      const to = new Date(Date.now() + 60 * 86400000).toISOString();
      const response = await fetch(
        `/api/calendar/google/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        events?: EventItem[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to sync Google Calendar.");
      }
      setEvents(payload.events ?? []);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load calendar.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function selectCalendar(nextId: string) {
    if (!nextId || nextId === calendarId) return;
    setCalendarId(nextId);
    try {
      const response = await fetch("/api/calendar/google/calendars", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendar_id: nextId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to save calendar.");
      toast.success("Calendar selected.");
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save calendar.",
      );
      await refresh();
    }
  }

  async function book() {
    if (!connected) {
      toast.error("Connect Google Calendar first.");
      return;
    }
    if (!title.trim() || !startsAt) {
      toast.error("Add a meeting title and date/time.");
      return;
    }

    const start = new Date(startsAt);
    const end = new Date(start.getTime() + Number(minutes) * 60000);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      toast.error("Invalid meeting time.");
      return;
    }

    setBusy(true);
    setCreatedMeet("");

    try {
      const response = await fetch("/api/calendar/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          client_name: name,
          client_email: clientEmail,
          client_phone: phone,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          timezone,
          send_whatsapp: sendWhatsApp,
          reminder_24h: reminder24h,
          reminder_1h: reminder1h,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        booking?: { google_meet_link?: string | null };
        whatsapp_error?: string | null;
        pipeline?: { synced?: boolean; dealId?: string | null };
      };

      if (!response.ok) {
        throw new Error(payload.error || "Meeting creation failed.");
      }

      const meet = payload.booking?.google_meet_link || "";
      setCreatedMeet(meet);
      setPipelineSynced(Boolean(payload.pipeline?.synced));

      if (payload.whatsapp_error) {
        toast.warning(
          `Meeting created, but WhatsApp reminder failed: ${payload.whatsapp_error}`,
        );
      } else {
        toast.success("Meeting booked. Calendar + Meet + client notification are ready.");
      }

      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Meeting creation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const response = await fetch("/api/calendar/google/disconnect", {
      method: "POST",
    });
    if (!response.ok) {
      toast.error("Unable to disconnect Google Calendar.");
      return;
    }
    setConnected(false);
    setEmail(null);
    setEvents([]);
    setCalendars([]);
    toast.success("Google Calendar disconnected.");
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success("Copied.");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Calendar & Marketing</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Connect one Google account once. Then manage meetings, calendar data and marketing actions from this panel.
          </p>
        </div>

        {!connected ? (
          configured ? (
            <a
              href="/api/calendar/google/connect"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <CalendarDays className="mr-2 h-4 w-4" />
              Sign in with Google
            </a>
          ) : (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
              Google Calendar needs one-time admin setup.
            </div>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border bg-card px-3 py-2 text-xs">
              <div className="font-medium">Google connected</div>
              <div className="text-muted-foreground">{email || "Google account"}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        )}
      </div>

      {!connected ? (
        <Card className={configured ? "border-primary/20 bg-primary/5" : "border-amber-500/20 bg-amber-500/5"}>
          <CardHeader>
            <CardTitle>{configured ? "One simple connection" : "Google Calendar setup is not complete"}</CardTitle>
            <CardDescription>
              {configured
                ? <>Click <b>Sign in with Google</b>, choose the business Google account, allow Calendar access once, and Megorah will fetch the connected calendar automatically.</>
                : <>An account admin needs to add the Google OAuth client ID and secret once in the production environment. After that, users only sign in with Google from this panel.</>}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {[
              ["01", configured ? "Sign in" : "One-time admin setup", configured ? "Google handles the secure login. Your Google password never reaches Megorah." : "Add the Google OAuth credentials once. End users do not need to manage them."],
              ["02", "Choose calendar", "Megorah automatically loads the calendars available to that Google account."],
              ["03", "Work from CRM", "Book meetings, generate Meet links, notify clients, schedule reminders and sync the follow-up lead."],
            ].map(([step, heading, copyText]) => (
              <div key={step} className="rounded-xl border bg-background/70 p-4">
                <div className="text-xs font-semibold text-primary">{step}</div>
                <div className="mt-2 text-sm font-medium">{heading}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{copyText}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <button
              type="button"
              onClick={() => setMode("meeting")}
              className={`rounded-2xl border p-5 text-left transition hover:bg-accent ${mode === "meeting" ? "border-primary bg-primary/5" : ""}`}
            >
              <Video className="h-5 w-5 text-primary" />
              <div className="mt-3 font-semibold">New Meeting</div>
              <div className="mt-1 text-xs text-muted-foreground">Create Google Calendar + Meet + client reminder.</div>
            </button>
            <button
              type="button"
              onClick={() => setMode("calendar")}
              className={`rounded-2xl border p-5 text-left transition hover:bg-accent ${mode === "calendar" ? "border-primary bg-primary/5" : ""}`}
            >
              <CalendarDays className="h-5 w-5 text-primary" />
              <div className="mt-3 font-semibold">Calendar</div>
              <div className="mt-1 text-xs text-muted-foreground">See and manage upcoming meetings synced from Google.</div>
            </button>
            <Link
              href="/broadcasts"
              className={`rounded-2xl border p-5 text-left transition hover:bg-accent ${mode === "marketing" ? "border-primary bg-primary/5" : ""}`}
              onClick={() => setMode("marketing")}
            >
              <Megaphone className="h-5 w-5 text-primary" />
              <div className="mt-3 font-semibold">Bulk Marketing</div>
              <div className="mt-1 text-xs text-muted-foreground">Open WhatsApp campaigns and broadcast marketing tools.</div>
            </Link>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>{mode === "meeting" ? "Book in one click" : mode === "calendar" ? "Upcoming meetings" : "Bulk marketing"}</CardTitle>
                  <CardDescription>
                    {mode === "meeting"
                      ? "Everything is saved to your selected Google Calendar."
                      : mode === "calendar"
                        ? "These events are fetched directly from Google Calendar."
                        : "Use the existing WhatsApp broadcast workspace for bulk customer communication."}
                  </CardDescription>
                </div>

                {calendars.length > 0 && (
                  <div className="flex min-w-[250px] items-center gap-2 rounded-xl border px-3 py-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <select
                      aria-label="Google calendar"
                      value={calendarId}
                      onChange={(e) => void selectCalendar(e.target.value)}
                      disabled={calendarLoading}
                      className="w-full bg-transparent text-sm outline-none"
                    >
                      {calendars.map((calendar) => (
                        <option key={calendar.id} value={calendar.id}>
                          {calendar.name}{calendar.primary ? " (Primary)" : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            </CardHeader>

            {mode === "meeting" && (
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Meeting title</Label>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Product Demo — Megorah" />
                  </div>
                  <div className="space-y-2">
                    <Label>Client name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aman Sharma" />
                  </div>
                  <div className="space-y-2">
                    <Label>Client email</Label>
                    <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="aman@example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Client WhatsApp</Label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98XXXXXXXX" />
                  </div>
                  <div className="space-y-2">
                    <Label>Date & time</Label>
                    <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                    <p className="text-xs text-muted-foreground">{timezone}</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Duration</Label>
                    <select value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                      {["15", "30", "45", "60", "90"].map((v) => (
                        <option value={v} key={v}>{v} minutes</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3 rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <PhoneCall className="mt-0.5 h-4 w-4 text-primary" />
                      <div>
                        <div className="text-sm font-medium">Client WhatsApp confirmation</div>
                        <div className="text-xs text-muted-foreground">Send the meeting time + fresh Google Meet link immediately.</div>
                      </div>
                    </div>
                    <Switch checked={sendWhatsApp} onCheckedChange={setSendWhatsApp} disabled={!phone} />
                  </div>

                  <div className="grid gap-2 border-t pt-3 sm:grid-cols-2">
                    <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                      <span>24-hour reminder</span>
                      <Switch checked={reminder24h} onCheckedChange={setReminder24h} disabled={!sendWhatsApp || !phone} />
                    </label>
                    <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                      <span>1-hour reminder</span>
                      <Switch checked={reminder1h} onCheckedChange={setReminder1h} disabled={!sendWhatsApp || !phone} />
                    </label>
                  </div>
                </div>

                <Button className="w-full" size="lg" onClick={() => void book()} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  {busy ? "Creating..." : "Book Meeting + Meet + Notify"}
                </Button>

                {createdMeet && (
                  <div className="space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Video className="h-4 w-4" />
                      Meeting ready
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pipelineSynced
                        ? "Client added to the active sales pipeline with a Meeting Booked follow-up."
                        : "Meeting created. The calendar event is synced even if no sales pipeline was available."}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void copy(createdMeet)}>
                        <Copy className="mr-2 h-4 w-4" /> Copy Meet link
                      </Button>
                      <a
                        href={createdMeet}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent"
                      >
                        <ExternalLink className="mr-2 h-4 w-4" /> Open Meet
                      </a>
                    </div>
                  </div>
                )}
              </CardContent>
            )}

            {mode === "calendar" && (
              <CardContent>
                {loading ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </div>
                ) : events.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No upcoming meetings found.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {events.map((event) => (
                      <div key={event.id} className="rounded-xl border p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div className="font-medium text-sm">{event.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {event.start
                                ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.start))
                                : "—"}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {event.meetLink && (
                              <a
                                href={event.meetLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent"
                              >
                                <Video className="mr-2 h-4 w-4" /> Join Meet
                              </a>
                            )}
                            {event.htmlLink && (
                              <a
                                href={event.htmlLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium hover:bg-accent"
                              >
                                Open Calendar
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}

            {mode === "marketing" && (
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <Link href="/broadcasts" className="rounded-xl border p-5 transition hover:bg-accent">
                    <Megaphone className="h-5 w-5 text-primary" />
                    <div className="mt-3 text-sm font-semibold">WhatsApp Broadcasts</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">Send bulk campaigns to selected customer audiences.</div>
                  </Link>
                  <Link href="/contacts" className="rounded-xl border p-5 transition hover:bg-accent">
                    <Users className="h-5 w-5 text-primary" />
                    <div className="mt-3 text-sm font-semibold">Customer Data</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">Open contacts, search customers and prepare audiences for outreach.</div>
                  </Link>
                </div>
              </CardContent>
            )}
          </Card>

          {mode === "meeting" && (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border p-4">
                <Mail className="h-4 w-4 text-primary" />
                <div className="mt-2 text-sm font-medium">Google invite</div>
                <div className="mt-1 text-xs text-muted-foreground">Client email is added as the event attendee.</div>
              </div>
              <div className="rounded-xl border p-4">
                <PhoneCall className="h-4 w-4 text-primary" />
                <div className="mt-2 text-sm font-medium">WhatsApp reminder</div>
                <div className="mt-1 text-xs text-muted-foreground">One click sends meeting time and Meet link.</div>
              </div>
              <div className="rounded-xl border p-4">
                <CalendarDays className="h-4 w-4 text-primary" />
                <div className="mt-2 text-sm font-medium">Calendar sync</div>
                <div className="mt-1 text-xs text-muted-foreground">The event stays inside the selected Google Calendar.</div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
