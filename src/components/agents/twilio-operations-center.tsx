'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Phone,
  PhoneCall,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

type TwilioNumber = {
  phone_number: string
  friendly_name?: string | null
  locality?: string | null
  region?: string | null
  address_requirements?: string | null
}

type CallRecord = {
  sid: string
  crm_session_id?: string | null
  direction?: string | null
  status?: string | null
  from?: string | null
  to?: string | null
  start_time?: string | null
  end_time?: string | null
  duration_seconds?: number
  price?: string | null
  price_unit?: string | null
}

type UsageRecord = { usage?: string; count?: string; price?: number; price_unit?: string }
type UsageData = {
  calls?: UsageRecord | null
  outbound_calls?: UsageRecord | null
}

function todayIndia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  const day = parts.find((part) => part.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}`
}

function dateMinusDays(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function formatDuration(seconds = 0): string {
  if (!seconds) return '0s'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function statusClass(status?: string | null): string {
  if (status === 'completed' || status === 'answered' || status === 'in-progress') {
    return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
  }
  if (status === 'busy' || status === 'no-answer' || status === 'queued' || status === 'ringing') {
    return 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
  }
  return 'bg-red-500/10 text-red-700 dark:text-red-400'
}

function primaryUsageRecord(data: UsageData | null): UsageRecord | null {
  return data?.outbound_calls ?? data?.calls ?? null
}

function usageMinutes(data: UsageData | null): string {
  const value = Number(primaryUsageRecord(data)?.usage ?? 0)
  return Number.isFinite(value) ? value.toFixed(value % 1 ? 2 : 0) : '0'
}

function usageCount(data: UsageData | null): number {
  return Number(primaryUsageRecord(data)?.count ?? 0) || 0
}

function usagePrice(data: UsageData | null): string {
  const value = Number(primaryUsageRecord(data)?.price ?? 0)
  return Number.isFinite(value) ? Math.abs(value).toFixed(4) : '0.0000'
}

function usageCurrency(data: UsageData | null): string {
  return (primaryUsageRecord(data)?.price_unit || 'USD').toUpperCase()
}

export function TwilioOperationsCenter({
  canEdit,
  callerNumber,
  onCallerNumberChange,
}: {
  canEdit: boolean
  callerNumber: string
  onCallerNumberChange: (value: string) => void
}) {
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [connected, setConnected] = useState(false)
  const [verifiedAt, setVerifiedAt] = useState<string | null>(null)
  const [numbers, setNumbers] = useState<TwilioNumber[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const [country, setCountry] = useState('IN')
  const [contains, setContains] = useState('')
  const [searchingNumbers, setSearchingNumbers] = useState(false)
  const [availableNumbers, setAvailableNumbers] = useState<TwilioNumber[]>([])
  const [buyingNumber, setBuyingNumber] = useState<string | null>(null)

  const [callDate, setCallDate] = useState(todayIndia())
  const [callStatus, setCallStatus] = useState('all')
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [callsLoading, setCallsLoading] = useState(false)

  const [todayUsage, setTodayUsage] = useState<UsageData | null>(null)
  const [thirtyDayUsage, setThirtyDayUsage] = useState<UsageData | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)

  const callerNumberChangeRef = useRef(onCallerNumberChange)
  callerNumberChangeRef.current = onCallerNumberChange

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-calling/twilio/config', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load Twilio connection.')

      const isConfigured = Boolean(data.configured)
      setConnected(isConfigured)
      setAccountSid(data.account_sid || '')
      setVerifiedAt(data.last_verified_at || null)
      if (data.caller_number && data.caller_number !== callerNumber) callerNumberChangeRef.current(data.caller_number)

      if (isConfigured) {
        const syncResponse = await fetch('/api/ai-calling/twilio/numbers', { method: 'POST' })
        const syncData = await syncResponse.json().catch(() => ({}))
        if (syncResponse.ok) {
          setNumbers(syncData.numbers || [])
          if (syncData.caller_number && syncData.caller_number !== callerNumber) callerNumberChangeRef.current(syncData.caller_number)
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load Twilio connection.')
    }
  }, [callerNumber])

  const refreshNumbers = useCallback(async () => {
    if (!connected) return
    setSyncing(true)
    try {
      const response = await fetch('/api/ai-calling/twilio/numbers', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not sync Twilio numbers.')
      setNumbers(data.numbers || [])
      if (data.caller_number && data.caller_number !== callerNumber) callerNumberChangeRef.current(data.caller_number)
      toast.success('Twilio numbers synced.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sync Twilio numbers.')
    } finally {
      setSyncing(false)
    }
  }, [connected, onCallerNumberChange])

  const connect = async () => {
    if (!canEdit || loading) return

    const sid = accountSid.trim()
    const token = authToken.trim()

    if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) {
      toast.error('Enter a valid Twilio Account SID.')
      return
    }
    if (!token) {
      toast.error('Enter your Twilio Auth Token.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/ai-calling/twilio/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_sid: sid,
          auth_token: token,
          caller_number: callerNumber || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not connect Twilio.')

      setConnected(true)
      setVerifiedAt(data.verified_at || null)
      setNumbers(data.numbers || [])
      if (data.caller_number && data.caller_number !== callerNumber) callerNumberChangeRef.current(data.caller_number)
      setAuthToken('')
      toast.success('Twilio connected and verified.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not connect Twilio.')
    } finally {
      setLoading(false)
    }
  }

  const searchNumbers = async () => {
    if (!connected || searchingNumbers) return
    const normalizedCountry = country.trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(normalizedCountry)) {
      toast.error('Enter a 2-letter country code such as IN or US.')
      return
    }

    setSearchingNumbers(true)
    try {
      const query = new URLSearchParams({
        country: normalizedCountry,
        type: 'local',
      })
      if (contains.trim()) query.set('contains', contains.trim())

      const response = await fetch(`/api/ai-calling/twilio/available-numbers?${query.toString()}`, {
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not search available numbers.')
      setAvailableNumbers(data.numbers || [])
      if (!data.numbers?.length) {
        toast.message(`No voice numbers were returned for ${normalizedCountry}.`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not search available numbers.')
    } finally {
      setSearchingNumbers(false)
    }
  }

  const buyNumber = async (phoneNumber: string) => {
    if (!canEdit || buyingNumber) return
    const confirmed = window.confirm(
      `Buy ${phoneNumber} from Twilio? Twilio will bill this purchase directly to your connected account.`,
    )
    if (!confirmed) return

    setBuyingNumber(phoneNumber)
    try {
      const response = await fetch('/api/ai-calling/twilio/available-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not purchase the number.')

      onCallerNumberChange(data.number.phone_number)
      setAvailableNumbers([])
      await refreshNumbers()
      toast.success(`${data.number.phone_number} is now connected as the CRM caller number.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not purchase the number.')
    } finally {
      setBuyingNumber(null)
    }
  }

  const loadCalls = useCallback(async () => {
    if (!connected) {
      setCalls([])
      return
    }

    setCallsLoading(true)
    try {
      const query = new URLSearchParams({
        start_date: callDate,
        end_date: callDate,
        scope: 'crm',
        limit: '500',
      })
      if (callStatus !== 'all') query.set('status', callStatus)

      const response = await fetch(`/api/ai-calling/twilio/calls?${query.toString()}`, {
        cache: 'no-store',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load call history.')
      setCalls(data.calls || [])
      if (data.fetched_at) setLastSyncedAt(data.fetched_at)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load call history.')
    } finally {
      setCallsLoading(false)
    }
  }, [callDate, callStatus, connected])

  const loadUsage = useCallback(async () => {
    if (!connected) return
    setUsageLoading(true)
    try {
      const [todayResponse, thirtyResponse] = await Promise.all([
        fetch(`/api/ai-calling/twilio/usage?start_date=${todayIndia()}`, { cache: 'no-store' }),
        fetch(`/api/ai-calling/twilio/usage?start_date=${dateMinusDays(30)}`, { cache: 'no-store' }),
      ])
      const todayData = await todayResponse.json()
      const thirtyData = await thirtyResponse.json()
      if (!todayResponse.ok) throw new Error(todayData.error || 'Could not load today usage.')
      if (!thirtyResponse.ok) throw new Error(thirtyData.error || 'Could not load 30-day usage.')
      setTodayUsage(todayData)
      setThirtyDayUsage(thirtyData)
      setLastSyncedAt(
        [todayData.fetched_at, thirtyData.fetched_at]
          .filter(Boolean)
          .sort()
          .pop() || null,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load Twilio usage.')
    } finally {
      setUsageLoading(false)
    }
  }, [connected])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (!connected) return
    void loadUsage()
    void loadCalls()

    const interval = window.setInterval(() => {
      void loadUsage()
      void loadCalls()
    }, 60_000)

    return () => window.clearInterval(interval)
  }, [connected, loadUsage, loadCalls])

  const currency = usageCurrency(todayUsage || thirtyDayUsage)

  const summary = useMemo(
    () => ({
      todayCalls: usageCount(todayUsage),
      todayMinutes: usageMinutes(todayUsage),
      todayPrice: usagePrice(todayUsage),
      thirtyCalls: usageCount(thirtyDayUsage),
      thirtyMinutes: usageMinutes(thirtyDayUsage),
      thirtyPrice: usagePrice(thirtyDayUsage),
    }),
    [todayUsage, thirtyDayUsage],
  )

  return (
    <div className="space-y-6">
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Twilio Voice Center
          </CardTitle>
          <CardDescription>
            One place for Twilio API connection, phone numbers, live calling usage and CRM call history. Twilio remains the billing provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="twilio-account-sid-new">Twilio Account SID</Label>
              <Input
                id="twilio-account-sid-new"
                value={accountSid}
                onChange={(event) => setAccountSid(event.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                disabled={!canEdit || loading}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="twilio-auth-token-new">Twilio Auth Token</Label>
              <div className="relative">
                <Input
                  id="twilio-auth-token-new"
                  type={showToken ? 'text' : 'password'}
                  value={authToken}
                  onChange={(event) => setAuthToken(event.target.value)}
                  placeholder={connected ? 'Saved securely — enter only to replace' : 'Enter Auth Token'}
                  disabled={!canEdit || loading}
                  autoComplete="off"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showToken ? 'Hide Auth Token' : 'Show Auth Token'}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={connect} disabled={!canEdit || loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {connected ? 'Re-verify & Sync' : 'Connect & Verify Twilio'}
            </Button>

            {connected && (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                API Connected
              </span>
            )}

            {verifiedAt && (
              <span className="text-xs text-muted-foreground">
                Verified {new Date(verifiedAt).toLocaleString('en-IN')}
              </span>
            )}
          </div>

          {connected && (
            <>
              <Separator />

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-2">
                  <Label>Active Twilio caller number</Label>
                  <Select
                    value={callerNumber || undefined}
                    onValueChange={onCallerNumberChange}
                    disabled={!canEdit || numbers.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No Twilio Voice number connected" />
                    </SelectTrigger>
                    <SelectContent>
                      {numbers.map((number) => (
                        <SelectItem key={number.phone_number} value={number.phone_number}>
                          {number.friendly_name
                            ? `${number.friendly_name} — ${number.phone_number}`
                            : number.phone_number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    New CRM outbound calls use this number as the caller ID.
                  </p>
                </div>

                <div className="flex items-end gap-2">
                  <Button variant="outline" onClick={refreshNumbers} disabled={!canEdit || syncing}>
                    {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Sync
                  </Button>
                </div>
              </div>

              {numbers.length === 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <ShoppingCart className="h-4 w-4" />
                    No Twilio Voice number found
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Search and purchase a voice-capable number below. The purchase is billed directly by Twilio and the new number is automatically saved as the CRM caller number.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {connected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingCart className="h-4 w-4 text-primary" />
                Get a Twilio Voice Number
              </CardTitle>
              <CardDescription>
                Search Twilio's live inventory and purchase a number without leaving the CRM.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)_auto]">
                <div className="space-y-2">
                  <Label htmlFor="twilio-country">Country</Label>
                  <Input
                    id="twilio-country"
                    value={country}
                    onChange={(event) => setCountry(event.target.value.toUpperCase())}
                    placeholder="IN"
                    maxLength={2}
                    disabled={!canEdit || searchingNumbers}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilio-contains">Search digits / pattern (optional)</Label>
                  <Input
                    id="twilio-contains"
                    value={contains}
                    onChange={(event) => setContains(event.target.value)}
                    placeholder="e.g. 98, 1234, MYBRAND"
                    disabled={!canEdit || searchingNumbers}
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={searchNumbers} disabled={!canEdit || searchingNumbers}>
                    {searchingNumbers ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Search
                  </Button>
                </div>
              </div>

              {availableNumbers.length > 0 && (
                <div className="rounded-xl border">
                  <div className="border-b px-4 py-3 text-xs font-medium text-muted-foreground">
                    Available voice-capable numbers — select Buy to provision one.
                  </div>
                  <div className="divide-y">
                    {availableNumbers.map((number) => (
                      <div key={number.phone_number} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">{number.phone_number}</p>
                          <p className="text-xs text-muted-foreground">
                            {[number.locality, number.region].filter(Boolean).join(', ') || 'Location not provided'}
                            {number.address_requirements ? ` · Requirements: ${number.address_requirements}` : ''}
                          </p>
                        </div>
                        <Button
                          onClick={() => void buyNumber(number.phone_number)}
                          disabled={!canEdit || buyingNumber !== null}
                        >
                          {buyingNumber === number.phone_number ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-2 h-4 w-4" />}
                          Buy Number
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PhoneCall className="h-4 w-4 text-primary" />
                  Voice Usage
                </CardTitle>
                <CardDescription>
                  Live outbound voice usage pulled directly from the connected Twilio account. Counts, minutes and voice cost update automatically every 60 seconds.
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void loadUsage()} disabled={usageLoading}>
                {usageLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {[
                  ['Today', 'Calls', String(summary.todayCalls)],
                  ['Today', 'Minutes', summary.todayMinutes],
                  ['Today', 'Voice cost', `${currency} ${summary.todayPrice}`],
                  ['Last 30 days', 'Calls', String(summary.thirtyCalls)],
                  ['Last 30 days', 'Minutes', summary.thirtyMinutes],
                  ['Last 30 days', 'Voice cost', `${currency} ${summary.thirtyPrice}`],
                ].map(([period, label, value]) => (
                  <div key={`${period}-${label}`} className="rounded-xl border p-4">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{period}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              {lastSyncedAt && (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Last provider sync: {formatDateTime(lastSyncedAt)}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Phone className="h-4 w-4 text-primary" />
                    CRM Call History
                  </CardTitle>
                  <CardDescription>
                    Calls made from the active CRM Twilio number. Every row is read directly from the Twilio Calls API and linked back to its CRM session when available.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    value={callDate}
                    onChange={(event) => setCallDate(event.target.value)}
                    className="w-[160px]"
                    aria-label="Call history date"
                  />
                  <Select value={callStatus} onValueChange={setCallStatus}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="in-progress">In progress</SelectItem>
                      <SelectItem value="ringing">Ringing</SelectItem>
                      <SelectItem value="queued">Queued</SelectItem>
                      <SelectItem value="busy">Busy</SelectItem>
                      <SelectItem value="no-answer">No answer</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={() => void loadCalls()} disabled={callsLoading}>
                    {callsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {callsLoading ? (
                <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading calls…
                </div>
              ) : calls.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center">
                  <PhoneCall className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">No CRM calls found for this date.</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Place a test call from the panel above, then refresh this history.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Time</th>
                        <th className="px-4 py-3 font-medium">From</th>
                        <th className="px-4 py-3 font-medium">To</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Duration</th>
                        <th className="px-4 py-3 font-medium">Cost</th>
                        <th className="px-4 py-3 font-medium">CRM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {calls.map((call) => (
                        <tr key={call.sid} className="hover:bg-muted/20">
                          <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(call.start_time)}</td>
                          <td className="px-4 py-3">{call.from || '—'}</td>
                          <td className="px-4 py-3">{call.to || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium capitalize ${statusClass(call.status)}`}>
                              {(call.status || 'unknown').replaceAll('-', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3">{formatDuration(call.duration_seconds)}</td>
                          <td className="px-4 py-3">
                            {call.price != null
                              ? `${(call.price_unit || currency).toUpperCase()} ${call.price}`
                              : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {call.crm_session_id ? (
                              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Linked</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Provider only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Server-side credentials
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The Auth Token is saved encrypted and is never returned to the browser after connection.
              </p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CalendarDays className="h-4 w-4 text-primary" />
                Live provider data
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Usage and call history are fetched from Twilio APIs instead of relying only on local counters.
              </p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <PhoneCall className="h-4 w-4 text-primary" />
                Billing stays at Twilio
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Megorah uses your connected Twilio account; CRM does not replace Twilio's underlying carrier billing.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
