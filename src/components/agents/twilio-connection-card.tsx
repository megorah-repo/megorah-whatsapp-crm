import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Phone,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type TwilioNumber = {
  phone_number: string
  friendly_name?: string | null
}

type UsageRecord = {
  usage?: string
  usage_unit?: string
  count?: string
  count_unit?: string
  price?: number
  price_unit?: string
}

export function TwilioConnectionCard({
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
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usage, setUsage] = useState<{
    calls: UsageRecord | null
    outbound_calls: UsageRecord | null
    total_price: UsageRecord | null
  } | null>(null)

  const refreshUsage = async () => {
    setUsageLoading(true)
    try {
      const res = await fetch('/api/ai-calling/twilio/usage', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load usage.')
      if (data.configured) {
        setUsage({
          calls: data.calls || null,
          outbound_calls: data.outbound_calls || null,
          total_price: data.total_price || null,
        })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load Twilio usage.')
    } finally {
      setUsageLoading(false)
    }
  }

  const syncNumbers = async () => {
    if (!canEdit || syncing) return
    setSyncing(true)
    try {
      const res = await fetch('/api/ai-calling/twilio/numbers', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not sync Twilio numbers.')
      setNumbers(data.numbers || [])
      if (data.caller_number) onCallerNumberChange(data.caller_number)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sync Twilio numbers.')
    } finally {
      setSyncing(false)
    }
  }

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/ai-calling/twilio/config', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load Twilio connection.')
      if (data.configured) {
        setConnected(true)
        setAccountSid(data.account_sid || '')
        setVerifiedAt(data.last_verified_at || null)
        if (data.caller_number) onCallerNumberChange(data.caller_number)
        await syncNumbers()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load Twilio connection.')
    }
  }

  const connect = async () => {
    if (!canEdit || connecting) return

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

    setConnecting(true)
    try {
      const res = await fetch('/api/ai-calling/twilio/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_sid: sid,
          auth_token: token,
          caller_number: callerNumber || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not connect Twilio.')

      setConnected(true)
      setVerifiedAt(data.verified_at || null)
      setNumbers(data.numbers || [])
      if (data.caller_number) onCallerNumberChange(data.caller_number)
      setAuthToken('')
      toast.success('Twilio connected. Voice number synced automatically.')
      await refreshUsage()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not connect Twilio.')
    } finally {
      setConnecting(false)
    }
  }

  useEffect(() => {
    void loadConfig()
  }, [])

  useEffect(() => {
    if (connected) void refreshUsage()
  }, [connected])

  const totalMinutes = usage?.calls?.usage ?? '0'
  const totalCalls = usage?.calls?.count ?? '0'
  const outboundCalls = usage?.outbound_calls?.count ?? '0'
  const totalPrice = usage?.total_price?.price ?? 0
  const currency = usage?.total_price?.price_unit?.toUpperCase() || 'USD'

  return (
    <div className="space-y-6">
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Twilio Voice Connection
          </CardTitle>
          <CardDescription>
            Connect Twilio once. After this, test calls and voice usage stay inside this CRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="twilio-account-sid">Twilio Account SID</Label>
              <Input
                id="twilio-account-sid"
                value={accountSid}
                onChange={(event) => setAccountSid(event.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                disabled={!canEdit || connecting}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="twilio-auth-token">Twilio Auth Token</Label>
              <div className="relative">
                <Input
                  id="twilio-auth-token"
                  type={showToken ? 'text' : 'password'}
                  value={authToken}
                  onChange={(event) => setAuthToken(event.target.value)}
                  placeholder={connected ? 'Saved securely — enter only to replace' : 'Enter Auth Token'}
                  disabled={!canEdit || connecting}
                  autoComplete="off"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {connected && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  Auth Token is already saved securely. Re-enter only when replacing it.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={connect} disabled={!canEdit || connecting}>
              {connecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              {connected ? 'Re-verify & Sync Twilio' : 'Connect & Verify Twilio'}
            </Button>
            {connected && (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </span>
            )}
            {verifiedAt && (
              <span className="text-xs text-muted-foreground">
                Verified {new Date(verifiedAt).toLocaleString()}
              </span>
            )}
          </div>

          {connected && (
            <>
              <div className="grid gap-4 border-t pt-5 sm:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <Label>Twilio caller number</Label>
                  <Select
                    value={callerNumber || undefined}
                    onValueChange={onCallerNumberChange}
                    disabled={!canEdit || numbers.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="No Voice number synced" />
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
                    Test Call will automatically use this number as the caller ID.
                  </p>
                </div>

                <div className="flex items-end">
                  <Button
                    variant="outline"
                    onClick={syncNumbers}
                    disabled={!canEdit || syncing}
                  >
                    {syncing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Sync Numbers
                  </Button>
                </div>
              </div>

              {numbers.length === 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                  <p className="font-medium">No Twilio Voice number found yet.</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    On a Twilio Trial, open Products → Voice → Overview → Try out Voice once to provision the trial Voice resource. Then return here and press Sync Numbers.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {connected && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="h-4 w-4 text-primary" />
                Twilio Voice Usage
              </CardTitle>
              <CardDescription>Last 30 days from the connected Twilio account.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={refreshUsage} disabled={usageLoading}>
              {usageLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Voice calls</p>
              <p className="mt-1 text-xl font-semibold">{totalCalls}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Outbound calls</p>
              <p className="mt-1 text-xl font-semibold">{outboundCalls}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Minutes</p>
              <p className="mt-1 text-xl font-semibold">{totalMinutes}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Twilio usage cost</p>
              <p className="mt-1 text-xl font-semibold">
                {currency} {Number(totalPrice).toFixed(2)}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
