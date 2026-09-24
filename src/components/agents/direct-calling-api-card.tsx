'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Phone, RefreshCw, Webhook } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

type DirectCall = {
  id: string
  provider_call_sid?: string | null
  from_number?: string | null
  to_number?: string | null
  status?: string | null
  duration_seconds?: number | null
  cost?: number | null
  cost_currency?: string | null
  created_at?: string | null
}

function todayIndia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  return (parts.find((p) => p.type === 'year')?.value || '1970') + '-' +
    (parts.find((p) => p.type === 'month')?.value || '01') + '-' +
    (parts.find((p) => p.type === 'day')?.value || '01')
}

function formatDuration(seconds = 0): string {
  const value = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(value / 60)
  const remainder = Math.floor(value % 60)
  return minutes ? minutes + 'm ' + remainder + 's' : remainder + 's'
}

function formatTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export function DirectCallingApiCard({
  canEdit,
  callerNumber,
  onCallerNumberChange,
  onConnected,
}: {
  canEdit: boolean
  callerNumber: string
  onCallerNumberChange: (value: string) => void
  onConnected?: () => void
}) {
  const [providerName, setProviderName] = useState('Direct Calls API')
  const [apiUrl, setApiUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [authType, setAuthType] = useState<'bearer' | 'x-api-key' | 'authorization'>('bearer')
  const [connected, setConnected] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [date, setDate] = useState(todayIndia())
  const [totals, setTotals] = useState<{
    calls: number
    answered: number
    minutes: number
    cost: number
    currency: string
  } | null>(null)
  const [calls, setCalls] = useState<DirectCall[]>([])

  const callerChangeRef = useRef(onCallerNumberChange)
  callerChangeRef.current = onCallerNumberChange

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-calling/direct-api/config', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load Direct Calls API settings.')
      setConnected(Boolean(data.configured))
      if (data.configured) onConnected?.()
      setProviderName(data.provider_name || 'Direct Calls API')
      setApiUrl(data.api_url || '')
      setAuthType(data.auth_type || 'bearer')
      if (data.caller_number && data.caller_number !== callerNumber) {
        callerChangeRef.current(data.caller_number)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load Direct Calls API settings.')
    }
  }, [callerNumber])

  const loadHistory = useCallback(async () => {
    if (!connected) return
    setHistoryLoading(true)
    try {
      const response = await fetch(
        '/api/ai-calling/direct-api/summary?date=' + encodeURIComponent(date),
        { cache: 'no-store' },
      )
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load calling history.')
      setTotals(data.totals || null)
      setCalls(data.calls || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load calling history.')
    } finally {
      setHistoryLoading(false)
    }
  }, [connected, date])

  const connect = async () => {
    if (!canEdit || loading) return
    const url = apiUrl.trim()
    const key = apiKey.trim()
    if (!/^https:\/\//i.test(url)) {
      toast.error('Use the HTTPS endpoint supplied by your calling provider.')
      return
    }
    if (!key) {
      toast.error('Paste the calling provider API key.')
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/ai-calling/direct-api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_name: providerName.trim() || 'Direct Calls API',
          api_url: url,
          api_key: key,
          auth_type: authType,
          caller_number: callerNumber || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save calling API connection.')
      setConnected(true)
      onConnected?.()
      setApiKey('')
      if (data.caller_number && data.caller_number !== callerNumber) {
        callerChangeRef.current(data.caller_number)
      }
      toast.success('Calling API connected. Test calls can now start from this CRM.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save calling API connection.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  useEffect(() => {
    if (!connected) return
    void loadHistory()
    const interval = window.setInterval(() => void loadHistory(), 60_000)
    return () => window.clearInterval(interval)
  }, [connected, loadHistory])

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-primary" />
          Third-party Calls API
        </CardTitle>
        <CardDescription>
          Fastest setup: paste your provider&apos;s Make Calls API endpoint, API key and caller number. Provider-managed calling does not require OpenAI, Anthropic or Gemini.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="direct-call-provider">Provider name</Label>
            <Input id="direct-call-provider" value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="Your Calls Provider" disabled={!canEdit || loading} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="direct-call-api-url">Make Calls API endpoint</Label>
            <Input id="direct-call-api-url" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} placeholder="https://provider.com/api/calls" disabled={!canEdit || loading} autoComplete="off" />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="direct-call-api-key">API key</Label>
            <div className="relative">
              <Input id="direct-call-api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={connected ? 'Saved securely — enter only to replace' : 'Paste provider API key'} disabled={!canEdit || loading} autoComplete="off" className="pr-10" />
              <button type="button" onClick={() => setShowKey((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1} aria-label={showKey ? 'Hide API key' : 'Show API key'}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>API authentication</Label>
            <Select value={authType} onValueChange={(value) => value && setAuthType(value as typeof authType)} disabled={!canEdit || loading}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bearer">Authorization: Bearer</SelectItem>
                <SelectItem value="x-api-key">X-API-Key</SelectItem>
                <SelectItem value="authorization">Authorization: raw key</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-2">
            <Label htmlFor="direct-call-caller">Caller number</Label>
            <Input id="direct-call-caller" value={callerNumber} onChange={(event) => callerChangeRef.current(event.target.value)} placeholder="+9198XXXXXXXX" disabled={!canEdit || loading} inputMode="tel" />
            <p className="text-xs text-muted-foreground">E.164 format. Sent as the <code>from</code> value.</p>
          </div>
          <div className="flex items-end">
            <Button onClick={connect} disabled={!canEdit || loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {connected ? 'Update Connection' : 'Connect API'}
            </Button>
          </div>
        </div>

        {connected && (
          <>
            <Separator />
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> API connected</span>
              <span className="truncate text-xs text-muted-foreground">{apiUrl}</span>
              {callerNumber && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3.5 w-3.5" />{callerNumber}</span>}
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Today calls</p><p className="mt-1 text-xl font-semibold">{totals?.calls ?? 0}</p></div>
              <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Answered</p><p className="mt-1 text-xl font-semibold">{totals?.answered ?? 0}</p></div>
              <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Today minutes</p><p className="mt-1 text-xl font-semibold">{totals?.minutes ?? 0}</p></div>
              <div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Today cost</p><p className="mt-1 text-xl font-semibold">{totals?.currency || 'USD'} {Number(totals?.cost ?? 0).toFixed(4)}</p></div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium"><Webhook className="h-4 w-4 text-primary" /> CRM call history</div>
              <div className="flex items-center gap-2">
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 w-auto" />
                <Button variant="ghost" size="sm" onClick={loadHistory} disabled={historyLoading}>{historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Time</th>
                    <th className="px-3 py-2 text-left font-medium">From</th>
                    <th className="px-3 py-2 text-left font-medium">To</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Duration</th>
                    <th className="px-3 py-2 text-left font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.length ? calls.map((call) => (
                    <tr key={call.id} className="border-t">
                      <td className="px-3 py-2">{formatTime(call.created_at)}</td>
                      <td className="px-3 py-2">{call.from_number || '—'}</td>
                      <td className="px-3 py-2">{call.to_number || '—'}</td>
                      <td className="px-3 py-2">{call.status || 'unknown'}</td>
                      <td className="px-3 py-2">{formatDuration(call.duration_seconds || 0)}</td>
                      <td className="px-3 py-2">{call.cost_currency || totals?.currency || 'USD'} {Number(call.cost || 0).toFixed(4)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No CRM calls recorded for this date yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
