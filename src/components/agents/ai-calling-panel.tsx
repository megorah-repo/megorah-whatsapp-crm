'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  PhoneOutgoing,
  Headphones,
  PhoneCall,
  PhoneForwarded,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  Volume2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { TwilioOperationsCenter } from './twilio-operations-center';
import { DirectCallingApiCard } from './direct-calling-api-card';

const STORAGE_KEY = 'megorah-ai-calling-settings-v1';

interface CallingSettings {
  enabled: boolean;
  callerName: string;
  businessNumber: string;
  voice: string;
  language: string;
  greeting: string;
  instructions: string;
  transferNumber: string;
  transferOnHandoff: boolean;
  businessHoursOnly: boolean;
  maxCallMinutes: string;
  aiProvider: string;
}

const DEFAULTS: CallingSettings = {
  enabled: false,
  callerName: 'Megorah AI',
  businessNumber: '',
  voice: 'warm-female',
  language: 'en-IN',
  greeting: 'Hi, this is Megorah AI. How can I help you today?',
  instructions:
    'Be concise, helpful and natural. Answer questions about products, orders and support. Escalate to a human when the caller asks for one or the issue needs human attention.',
  transferNumber: '',
  transferOnHandoff: true,
  businessHoursOnly: true,
  maxCallMinutes: '12',
  aiProvider: 'google-gemini',
};

const VOICES = [
  { value: 'warm-female', label: 'Warm Female', hint: 'Natural, friendly' },
  { value: 'professional-male', label: 'Professional Male', hint: 'Clear, confident' },
  { value: 'calm-female', label: 'Calm Female', hint: 'Soft, reassuring' },
  { value: 'neutral-male', label: 'Neutral Male', hint: 'Direct, balanced' },
] as const;

const AI_PROVIDERS = [
  { value: 'openai', label: 'OpenAI', hint: 'Provider option' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Provider option' },
  { value: 'google-gemini', label: 'Google Gemini', hint: 'Free test option' },
] as const;

const LANGUAGES = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'hi-IN', label: 'Hindi (India)' },
  { value: 'pa-IN', label: 'Punjabi (India)' },
  { value: 'hinglish-IN', label: 'Hinglish' },
] as const;

function loadSettings(): CallingSettings {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<CallingSettings>) };
  } catch {
    return DEFAULTS;
  }
}

export function AiCallingPanel({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<CallingSettings>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testNumber, setTestNumber] = useState('');
  const [testCallLoading, setTestCallLoading] = useState(false);
  const [testCallStatus, setTestCallStatus] = useState<string | null>(null);
  const [testSessionId, setTestSessionId] = useState<string | null>(null);
  const [directApiConnected, setDirectApiConnected] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setSettings(loadSettings());
      setHydrated(true);
    });
  }, []);

  const update = <K extends keyof CallingSettings>(
    key: K,
    value: CallingSettings[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const readiness = useMemo(() => {
    const normalize = (value: string) => value.replace(/\s+/g, '');
    const validPhone = (value: string) => /^\+[1-9]\d{7,14}$/.test(normalize(value));
    const checks = [
      {
        label: 'Calling provider connected',
        ready: Boolean(settings.businessNumber.trim()),
      },
      {
        label: 'Caller identity',
        ready: Boolean(settings.callerName.trim()) && validPhone(settings.businessNumber),
      },
      {
        label: 'Test destination number',
        ready: validPhone(testNumber),
      },
      {
        label: 'Voice & language',
        ready: Boolean(settings.voice && settings.language),
      },
      {
        label: 'Human handoff route',
        ready: !settings.transferOnHandoff || Boolean(settings.transferNumber.trim()),
      },
      {
        label: 'Call behavior',
        ready: Boolean(settings.greeting.trim() && settings.instructions.trim()),
      },
    ];
    return {
      checks,
      readyCount: checks.filter((item) => item.ready).length,
      complete: checks.every((item) => item.ready),
    };
  }, [settings, testNumber]);

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      toast.success('AI Calling configuration saved.');
    } finally {
      setSaving(false);
    }
  };

  const testCall = async () => {
    if (!canEdit || testCallLoading) return;

    const destination = testNumber.trim().replace(/\s+/g, '');
    const caller = settings.businessNumber.trim().replace(/\s+/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(destination)) {
      toast.error('Enter the customer test number in E.164 format, e.g. +9198XXXXXXXX.');
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(caller)) {
      toast.error('Enter your business/caller number in E.164 format, e.g. +9198XXXXXXXX.');
      return;
    }
    const testReady =
      Boolean(settings.callerName.trim()) &&
      /^\+[1-9]\d{7,14}$/.test(caller) &&
      /^\+[1-9]\d{7,14}$/.test(destination) &&
      Boolean(settings.voice && settings.language) &&
      Boolean(settings.greeting.trim() && settings.instructions.trim());

    if (!testReady) {
      toast.error('Complete the caller number, customer number, voice/language and call behavior first.');
      return;
    }

    setTestCallLoading(true);
    setTestCallStatus('starting');
    try {
      const response = await fetch('/api/ai-calling/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_number: destination,
          from_number: caller,
          caller_name: settings.callerName,
          greeting: settings.greeting,
          instructions: settings.instructions,
          language: settings.language === 'hinglish-IN' ? 'en-IN' : settings.language,
          transfer_number: settings.transferNumber,
          transfer_on_handoff: settings.transferOnHandoff,
          max_call_minutes: settings.maxCallMinutes,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        session_id?: string;
        status?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Could not start the test call.');
      }
      setTestSessionId(data.session_id ?? null);
      setTestCallStatus(data.status ?? 'queued');
      toast.success('Test call started. Your customer number should ring shortly.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start the test call.';
      setTestCallStatus('failed');
      toast.error(message);
    } finally {
      setTestCallLoading(false);
    }
  };

  useEffect(() => {
    if (!testSessionId) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/ai-calling/test?session_id=${encodeURIComponent(testSessionId)}`,
          { cache: 'no-store' },
        );
        if (!response.ok || !active) return;
        const data = (await response.json()) as { status?: string };
        if (data.status) setTestCallStatus(data.status);
      } catch {
        // Status polling is best-effort; the provider call continues independently.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [testSessionId]);

  const runReadinessCheck = () => {
    if (!readiness.complete) {
      toast.error('Complete the highlighted calling setup items first.');
      return;
    }
    toast.success('AI Calling is ready. You can place a real test call.');
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-[460px] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        Loading AI Calling…
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-border/70">
        <CardContent className="p-0">
          <div className="bg-gradient-to-br from-primary/10 via-transparent to-transparent p-6 sm:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  AI Calling ready workspace
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  Turn your AI Agent into a phone agent.
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Define the caller experience, voice, language, handoff rules and
                  call limits here. This section is ready for your voice/telephony
                  provider connection without changing your existing AI Agent setup.
                </p>
                <div className="mt-5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 rounded-md border bg-background/70 px-2.5 py-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Secure handoff
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md border bg-background/70 px-2.5 py-1.5">
                    <Volume2 className="h-3.5 w-3.5" />
                    Voice profile
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-md border bg-background/70 px-2.5 py-1.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    Call limits
                  </span>
                </div>
              </div>

              <div className="w-full max-w-sm rounded-xl border bg-background/90 p-4 shadow-sm backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">AI Calling</p>
                    <p className="text-xs text-muted-foreground">
                      {settings.enabled ? 'Enabled for the configured experience' : 'Setup mode'}
                    </p>
                  </div>
                  <Switch
                    checked={settings.enabled}
                    onCheckedChange={(value) => update('enabled', value)}
                    disabled={disabled}
                    aria-label="Enable AI Calling"
                  />
                </div>
                <Separator className="my-4" />
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-semibold">
                      {readiness.readyCount}/{readiness.checks.length}
                    </p>
                    <p className="text-xs text-muted-foreground">readiness checks complete</p>
                  </div>
                  <div
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium',
                      readiness.complete
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {readiness.complete ? 'Ready' : 'Needs setup'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PhoneCall className="h-4 w-4 text-primary" />
                Caller identity
              </CardTitle>
              <CardDescription>
                Give the voice agent a clear identity before connecting a phone provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="calling-name">AI caller name</Label>
                <Input
                  id="calling-name"
                  value={settings.callerName}
                  onChange={(event) => update('callerName', event.target.value)}
                  placeholder="Megorah AI"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="calling-number">Business number</Label>
                <Input
                  id="calling-number"
                  value={settings.businessNumber}
                  placeholder="Connect your calling provider to sync caller number"
                  disabled
                />
                <p className="text-xs text-muted-foreground">
                  Use the connected provider number or a verified caller ID. Use E.164 format, e.g. +9198XXXXXXXX.
                </p>
              </div>
            </CardContent>
          </Card>

          <DirectCallingApiCard
            canEdit={canEdit}
            callerNumber={settings.businessNumber}
            onCallerNumberChange={(value) => update('businessNumber', value)}
            onConnected={() => setDirectApiConnected(true)}
          />

          {!directApiConnected && (
            <TwilioOperationsCenter
              canEdit={canEdit}
              callerNumber={settings.businessNumber}
              onCallerNumberChange={(value) => update('businessNumber', value)}
            />
          )}

          <Card className="border-primary/25 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PhoneOutgoing className="h-4 w-4 text-primary" />
                Test AI Call
              </CardTitle>
              <CardDescription>
                Enter a customer number and place a real outbound test call from your configured caller number.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="test-customer-number">Customer test number</Label>
                <Input
                  id="test-customer-number"
                  value={testNumber}
                  onChange={(event) => setTestNumber(event.target.value)}
                  placeholder="+91 98XXXXXXXX"
                  inputMode="tel"
                  disabled={disabled || testCallLoading}
                />
                <p className="text-xs text-muted-foreground">
                  The number entered here will actually ring when you press Start Test Call.
                </p>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={testCall}
                disabled={disabled || testCallLoading || !testNumber.trim()}
              >
                {testCallLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PhoneOutgoing className="mr-2 h-4 w-4" />
                )}
                {testCallLoading ? 'Starting Call…' : 'Start Test Call'}
              </Button>

              {testCallStatus && (
                <div className="rounded-lg border bg-background/70 p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Call status</span>
                    <span className="font-medium capitalize">{testCallStatus.replaceAll('-', ' ')}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {testCallStatus === 'completed'
                      ? 'Test call finished.'
                      : testCallStatus === 'in-progress' || testCallStatus === 'answered'
                        ? 'The call is connected. Speak naturally and test the AI response.'
                        : testCallStatus === 'failed' || testCallStatus === 'busy' || testCallStatus === 'no-answer'
                          ? 'The provider could not complete the call. Check the caller ID and telephony settings.'
                          : 'Call request is being processed.'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4 text-primary" />
                AI provider
              </CardTitle>
              <CardDescription>
                Select which AI provider the phone agent will use for the test conversation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label>AI provider</Label>
                <Select
                  value={settings.aiProvider}
                  onValueChange={(value) => update('aiProvider', value ?? DEFAULTS.aiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        <span className="flex items-center gap-2">
                          <span>{provider.label}</span>
                          <span className="text-xs text-muted-foreground">— {provider.hint}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The test call uses the saved provider/API key and sends spoken customer replies through the selected AI provider.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Headphones className="h-4 w-4 text-primary" />
                Voice & language
              </CardTitle>
              <CardDescription>
                Choose the personality your callers should hear.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Voice profile</Label>
                <Select
                  value={settings.voice}
                  onValueChange={(value) => update('voice', value ?? DEFAULTS.voice)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICES.map((voice) => (
                      <SelectItem key={voice.value} value={voice.value}>
                        <span className="flex items-center gap-2">
                          <span>{voice.label}</span>
                          <span className="text-xs text-muted-foreground">— {voice.hint}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select
                  value={settings.language}
                  onValueChange={(value) => update('language', value ?? DEFAULTS.language)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((language) => (
                      <SelectItem key={language.value} value={language.value}>
                        {language.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Call behavior
              </CardTitle>
              <CardDescription>
                Keep the phone experience consistent with your existing AI Agent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="calling-greeting">Opening greeting</Label>
                <Textarea
                  id="calling-greeting"
                  value={settings.greeting}
                  onChange={(event) => update('greeting', event.target.value)}
                  rows={3}
                  placeholder="Hi, this is Megorah AI. How can I help you today?"
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="calling-instructions">Agent instructions</Label>
                <Textarea
                  id="calling-instructions"
                  value={settings.instructions}
                  onChange={(event) => update('instructions', event.target.value)}
                  rows={6}
                  placeholder="Describe how the voice agent should behave…"
                  disabled={disabled}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PhoneForwarded className="h-4 w-4 text-primary" />
                Human handoff
              </CardTitle>
              <CardDescription>
                Decide exactly what happens when AI should stop and a person should take over.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Transfer on AI handoff</p>
                  <p className="text-xs text-muted-foreground">
                    Route the call to a human when the agent signals a handoff.
                  </p>
                </div>
                <Switch
                  checked={settings.transferOnHandoff}
                  onCheckedChange={(value) => update('transferOnHandoff', value)}
                  disabled={disabled}
                />
              </div>

              {settings.transferOnHandoff && (
                <div className="space-y-2">
                  <Label htmlFor="transfer-number">Human transfer number</Label>
                  <Input
                    id="transfer-number"
                    value={settings.transferNumber}
                    onChange={(event) => update('transferNumber', event.target.value)}
                    placeholder="+91 98XXXXXXXX"
                    disabled={disabled}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Readiness checklist</CardTitle>
              <CardDescription>
                Checks before placing a real test call.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {readiness.checks.map((check) => (
                <div key={check.label} className="flex items-center gap-3">
                  <div
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full',
                      check.ready
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                    )}
                  >
                    {check.ready ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </div>
                  <p className="text-sm">{check.label}</p>
                </div>
              ))}
              <Separator className="my-4" />
              <Button
                className="w-full"
                variant={readiness.complete ? 'default' : 'outline'}
                onClick={runReadinessCheck}
                disabled={!canEdit}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Run readiness check
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock3 className="h-4 w-4 text-primary" />
                Call controls
              </CardTitle>
              <CardDescription>
                Set limits for the real test call.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="max-call">Maximum call duration</Label>
                <Select
                  value={settings.maxCallMinutes}
                  onValueChange={(value) => update('maxCallMinutes', value ?? DEFAULTS.maxCallMinutes)}
                  disabled={disabled}
                >
                  <SelectTrigger id="max-call">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['5', '8', '12', '15', '20'].map((minute) => (
                      <SelectItem key={minute} value={minute}>
                        {minute} minutes
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Business hours only</p>
                  <p className="text-xs text-muted-foreground">
                    Keep AI calls inside your configured business hours.
                  </p>
                </div>
                <Switch
                  checked={settings.businessHoursOnly}
                  onCheckedChange={(value) => update('businessHoursOnly', value)}
                  disabled={disabled}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-background p-2">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">Provider connection</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    When a Direct Calls API is connected, Test Call sends the request there and does not require OpenAI, Anthropic or Gemini. Twilio remains the fallback path when no Direct Calls API is connected.
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-xs font-medium text-primary">
                    <UserRound className="h-3.5 w-3.5" />
                    Human handoff supported
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {!canEdit && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-xs leading-5 text-muted-foreground">
              You can view the AI Calling setup, but an admin is required to change it.
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-4 z-20 flex justify-end">
        <div className="flex items-center gap-3 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur">
          <span className="hidden px-2 text-xs text-muted-foreground sm:inline">
            {settings.enabled ? 'AI Calling is configured' : 'Setup mode'}
          </span>
          <Button onClick={save} disabled={disabled}>
            {saving ? (
              <span className="mr-2 inline-flex h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Calling Setup
          </Button>
        </div>
      </div>
    </div>
  );
}
