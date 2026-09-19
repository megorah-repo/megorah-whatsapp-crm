'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
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
    const checks = [
      {
        label: 'AI agent configured',
        ready: true,
      },
      {
        label: 'Caller identity',
        ready: Boolean(settings.callerName.trim()),
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
  }, [settings]);

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

  const runReadinessCheck = () => {
    if (!readiness.complete) {
      toast.error('Complete the highlighted calling setup items first.');
      return;
    }
    toast.success('AI Calling setup is ready for voice-provider connection.');
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
                  onChange={(event) => update('businessNumber', event.target.value)}
                  placeholder="+91 98XXXXXXXX"
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">
                  Store the number you plan to connect to your telephony provider.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4 text-primary" />
                AI provider
              </CardTitle>
              <CardDescription>
                Select which AI provider the voice agent will use. This is a provider-selection UI only; no provider API is connected or called from this setting.
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
                  Google Gemini is included as a free-test provider option. Actual provider/API connection can be added separately later.
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
                Final pre-connection checks for the calling setup.
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
                Set practical limits before the voice integration is connected.
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
                    Your AI Agent already handles the intelligence layer. The remaining
                    step is connecting this calling configuration to your preferred
                    telephony/voice provider.
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
