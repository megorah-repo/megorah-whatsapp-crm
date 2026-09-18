"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  PhoneCall,
  RefreshCw,
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

export default function CalendarPage() {
  const [connected, setConnected] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
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
  const [createdMeet, setCreatedMeet] = useState("");

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    [],
  );

  async function refresh() {
    setLoading(true);
    try {
      const statusResponse = await fetch("/api/calendar/google/status", {
        cache: "no-store",
      });
      const status = (await statusResponse.json()) as {
        connected?: boolean;
        email?: string | null;
      };
      setConnected(Boolean(status.connected));
      setEmail(status.email ?? null);

      if (!status.connected) {
        setEvents([]);
        return;
      }

      const from = new Date().toISOString();
      const to = new Date(Date.now() + 30 * 86400000).toISOString();
      const response = await fetch(
        `/api/calendar/google/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as { events?: EventItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to sync Google Calendar.");
      setEvents(payload.events ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load calendar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

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
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        booking?: { google_meet_link?: string | null };
        whatsapp_error?: string | null;
      };
      if (!response.ok) throw new Error(payload.error || "Meeting creation failed.");

      const meet = payload.booking?.google_meet_link || "";
      setCreatedMeet(meet);
      if (payload.whatsapp_error) {
        toast.warning(`Meeting created, but WhatsApp reminder failed: ${payload.whatsapp_error}`);
      } else {
        toast.success("Meeting created. Google invite + Meet link are ready.");
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Meeting creation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const response = await fetch("/api/calendar/google/disconnect", { method: "POST" });
    if (!response.ok) {
      toast.error("Unable to disconnect Google Calendar.");
      return;
    }
    setConnected(false);
    setEmail(null);
    setEvents([]);
    toast.success("Google Calendar disconnected.");
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success("Copied.");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Calendar & Meetings</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Connect Google Calendar once, then create meetings directly from Megorah. Every booking creates a Google Calendar event, a fresh Google Meet link, calendar invite and optional WhatsApp confirmation.
          </p>
        </div>
        {!connected ? (
          <a
            href="/api/calendar/google/connect"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <CalendarDays className="mr-2 h-4 w-4" />
            Connect Google Calendar
          </a>
        ) : (
          <div className="flex items-center gap-2">
            <div className="rounded-xl border bg-card px-3 py-2 text-xs">
              <div className="font-medium">Google Calendar connected</div>
              <div className="text-muted-foreground">{email || "Google account"}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        )}
      </div>

      {!connected ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>One-click Google Calendar connection</CardTitle>
            <CardDescription>
              An account admin connects Google once. After that, agents can book meetings from this panel without opening Google Calendar.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border bg-background/70 p-4">
              <div className="text-xs font-semibold text-primary">01</div>
              <div className="mt-2 text-sm font-medium">Connect Google</div>
              <div className="mt-1 text-xs text-muted-foreground">Authorize Calendar access securely through Google OAuth.</div>
            </div>
            <div className="rounded-xl border bg-background/70 p-4">
              <div className="text-xs font-semibold text-primary">02</div>
              <div className="mt-2 text-sm font-medium">Book inside CRM</div>
              <div className="mt-1 text-xs text-muted-foreground">Client, time, duration and reminder are all controlled from one panel.</div>
            </div>
            <div className="rounded-xl border bg-background/70 p-4">
              <div className="text-xs font-semibold text-primary">03</div>
              <div className="mt-2 text-sm font-medium">Client gets the meeting</div>
              <div className="mt-1 text-xs text-muted-foreground">Google sends the calendar invite and Megorah can send the Meet link on WhatsApp.</div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Book a meeting</CardTitle>
                <CardDescription>No need to leave Megorah CRM.</CardDescription>
              </CardHeader>
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
                      {["15","30","45","60","90"].map((v) => <option value={v} key={v}>{v} minutes</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    <PhoneCall className="mt-0.5 h-4 w-4 text-primary" />
                    <div>
                      <div className="text-sm font-medium">Send WhatsApp confirmation</div>
                      <div className="text-xs text-muted-foreground">Time + fresh Google Meet link.</div>
                    </div>
                  </div>
                  <Switch checked={sendWhatsApp} onCheckedChange={setSendWhatsApp} disabled={!phone} />
                </div>

                <Button className="w-full" size="lg" onClick={() => void book()} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  {busy ? "Creating meeting…" : "Book + Generate Meet + Notify"}
                </Button>

                {createdMeet && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Video className="h-4 w-4 text-emerald-600" />
                      Meeting ready
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void copy(createdMeet)}>
                        <Copy className="mr-2 h-4 w-4" /> Copy Meet link
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <a href={createdMeet} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" /> Open Meet
                        </a>
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Upcoming Google Calendar meetings</CardTitle>
                <CardDescription>Synced from your connected Google Calendar.</CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />Loading…</div>
                ) : events.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No upcoming meetings.</div>
                ) : (
                  <div className="space-y-3">
                    {events.map((event) => (
                      <div key={event.id} className="rounded-xl border p-4">
                        <div className="font-medium text-sm">{event.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {event.start ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.start)) : "—"}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {event.meetLink && (
                            <a
                              href={event.meetLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent"
                            >
                              <Video className="mr-2 h-4 w-4" />Join Meet
                            </a>
                          )}
                          {event.htmlLink && (
                            <a
                              href={event.htmlLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium hover:bg-accent"
                            >
                              Google Calendar
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Automatic client reminders</CardTitle>
                <CardDescription>Professional handoff from a single booking action.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="text-xs leading-5 text-muted-foreground">
                    Client email is added as a Google Calendar attendee, so Google sends the calendar invitation/update.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <PhoneCall className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="text-xs leading-5 text-muted-foreground">
                    When WhatsApp is enabled, Megorah sends the meeting time and fresh Meet URL directly from the CRM.
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CalendarDays className="mt-0.5 h-4 w-4 text-primary" />
                  <div className="text-xs leading-5 text-muted-foreground">
                    The Google event is created with email and popup reminders so the meeting remains visible in Calendar too.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
