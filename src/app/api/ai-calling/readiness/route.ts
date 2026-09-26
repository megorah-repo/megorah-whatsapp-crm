import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadAiConfig } from '@/lib/ai/config'
import { loadTwilioCallingConfig } from '@/lib/ai-calling/twilio-config'
import { isValidE164 } from '@/lib/ai-calling/twilio'

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

type ReadinessCheck = {
  id: string
  label: string
  ready: boolean
  detail: string
  severity: 'ok' | 'error' | 'warning'
}

function basicAuth(accountSid: string, authToken: string): string {
  return 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64')
}

async function twilioGet(accountSid: string, authToken: string, path: string) {
  const response = await fetch(TWILIO_BASE + '/Accounts/' + accountSid + path, {
    headers: { Authorization: basicAuth(accountSid, authToken) },
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : ''
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const destination = clean(new URL(request.url).searchParams.get('to_number'))
    const checks: ReadinessCheck[] = []
    const db = createServiceRoleClient()

    let twilio = null
    try {
      twilio = await loadTwilioCallingConfig(accountId)
    } catch (error) {
      checks.push({
        id: 'twilio-config',
        label: 'Twilio credentials',
        ready: false,
        severity: 'error',
        detail: error instanceof Error ? error.message : 'Saved Twilio credentials could not be read.',
      })
    }

    if (!twilio) {
      checks.push({
        id: 'twilio-config',
        label: 'Twilio credentials',
        ready: false,
        severity: 'error',
        detail: 'Connect and verify the Twilio Account SID + Auth Token in Twilio Voice Center.',
      })
    } else {
      checks.push({
        id: 'twilio-config',
        label: 'Twilio credentials',
        ready: true,
        severity: 'ok',
        detail: 'Twilio account credentials are saved and active.',
      })

      try {
        const account = await twilioGet(twilio.accountSid, twilio.authToken, '.json')
        if (!account.response.ok || !account.payload?.sid) {
          checks.push({
            id: 'twilio-api',
            label: 'Twilio API access',
            ready: false,
            severity: 'error',
            detail: account.payload?.message || 'Twilio rejected the saved credentials.',
          })
        } else {
          checks.push({
            id: 'twilio-api',
            label: 'Twilio API access',
            ready: true,
            severity: 'ok',
            detail: 'CRM can reach the Twilio Voice API with the saved credentials.',
          })
        }
      } catch {
        checks.push({
          id: 'twilio-api',
          label: 'Twilio API access',
          ready: false,
          severity: 'error',
          detail: 'CRM could not reach the Twilio API right now.',
        })
      }

      try {
        const numbers = await twilioGet(
          twilio.accountSid,
          twilio.authToken,
          '/IncomingPhoneNumbers.json?PageSize=100',
        )
        const incoming = Array.isArray(numbers.payload?.incoming_phone_numbers)
          ? numbers.payload.incoming_phone_numbers as Array<{
              phone_number?: string
              capabilities?: { voice?: boolean }
            }>
          : []
        const caller = twilio.callerNumber
        const selected = caller
          ? incoming.find((item) => item.phone_number === caller)
          : null

        if (!caller) {
          checks.push({
            id: 'caller-number',
            label: 'Voice caller number',
            ready: false,
            severity: 'error',
            detail: 'No Twilio caller number is selected. Select a voice-enabled number in Twilio Voice Center.',
          })
        } else if (!selected || selected.capabilities?.voice === false) {
          checks.push({
            id: 'caller-number',
            label: 'Voice caller number',
            ready: false,
            severity: 'error',
            detail: caller + ' is not available as a voice-capable number on the connected Twilio account.',
          })
        } else {
          checks.push({
            id: 'caller-number',
            label: 'Voice caller number',
            ready: true,
            severity: 'ok',
            detail: caller + ' is selected and voice-capable.',
          })
        }
      } catch (error) {
        checks.push({
          id: 'caller-number',
          label: 'Voice caller number',
          ready: false,
          severity: 'error',
          detail: error instanceof Error ? error.message : 'Could not verify the Twilio caller number.',
        })
      }
    }

    if (!destination) {
      checks.push({
        id: 'destination',
        label: 'Customer test number',
        ready: false,
        severity: 'error',
        detail: 'Enter the customer number in E.164 format, for example +9198XXXXXXXX.',
      })
    } else if (!isValidE164(destination)) {
      checks.push({
        id: 'destination',
        label: 'Customer test number',
        ready: false,
        severity: 'error',
        detail: 'Customer number must use E.164 format, for example +9198XXXXXXXX.',
      })
    } else {
      checks.push({
        id: 'destination',
        label: 'Customer test number',
        ready: true,
        severity: 'ok',
        detail: destination + ' is formatted correctly.',
      })
    }

    try {
      const aiConfig = await loadAiConfig(db, accountId)
      if (!aiConfig) {
        checks.push({
          id: 'ai-config',
          label: 'AI agent configuration',
          ready: false,
          severity: 'error',
          detail: 'AI config is missing, has no API key, or the AI master switch is off. Save and activate the AI provider in AI Agent Setup.',
        })
      } else {
        checks.push({
          id: 'ai-config',
          label: 'AI agent configuration',
          ready: true,
          severity: 'ok',
          detail: 'AI provider ' + aiConfig.provider + ' is active with a saved API key.',
        })
      }
    } catch (error) {
      checks.push({
        id: 'ai-config',
        label: 'AI agent configuration',
        ready: false,
        severity: 'error',
        detail: error instanceof Error ? error.message : 'AI configuration could not be decrypted or loaded.',
      })
    }

    const callbackUrl = new URL(request.url)
    const publicCallbackReady =
      callbackUrl.protocol === 'https:' &&
      !['localhost', '127.0.0.1', '0.0.0.0'].includes(callbackUrl.hostname)
    checks.push({
      id: 'callback-url',
      label: 'Public HTTPS callback',
      ready: publicCallbackReady,
      severity: publicCallbackReady ? 'ok' : 'error',
      detail: publicCallbackReady
        ? 'Twilio can receive the CRM webhook URLs over HTTPS.'
        : 'Twilio webhooks need a public HTTPS CRM URL. A localhost HTTP URL will not complete the live call flow.',
    })

    if (destination.startsWith('+91') && twilio?.callerNumber?.startsWith('+91')) {
      checks.push({
        id: 'india-caller-rule',
        label: 'India outbound caller rule',
        ready: false,
        severity: 'error',
        detail: 'For Twilio outbound PSTN calls to India, use an international (non-Indian) Twilio caller number.',
      })
    } else {
      checks.push({
        id: 'india-caller-rule',
        label: 'Region / caller compatibility',
        ready: true,
        severity: 'ok',
        detail: 'No India-specific caller-number conflict was detected for this test destination.',
      })
    }

    const errors = checks.filter((check) => check.severity === 'error')
    const warnings = checks.filter((check) => check.severity === 'warning')
    return NextResponse.json({
      ready: errors.length === 0,
      ready_count: checks.filter((check) => check.ready).length,
      total_count: checks.length,
      checks,
      errors: errors.map((check) => ({ id: check.id, label: check.label, detail: check.detail })),
      warnings: warnings.map((check) => ({ id: check.id, label: check.label, detail: check.detail })),
      checked_at: new Date().toISOString(),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
