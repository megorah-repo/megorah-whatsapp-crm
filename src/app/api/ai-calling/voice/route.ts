import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import type { ChatMessage } from '@/lib/ai/types'
import { escapeXml, twimlResponse, verifyTwilioSignature } from '@/lib/ai-calling/twilio'

export const dynamic = 'force-dynamic'

function formDataToParams(form: FormData): URLSearchParams {
  const params = new URLSearchParams()
  form.forEach((value, key) => params.append(key, String(value)))
  return params
}

function sayAndGather(args: {
  text: string
  actionUrl: string
  language: string
}): string {
  return [
    `<Gather input="speech" speechTimeout="auto" action="${escapeXml(args.actionUrl)}" method="POST" language="${escapeXml(args.language)}" timeout="6">`,
    `<Say language="${escapeXml(args.language)}">${escapeXml(args.text)}</Say>`,
    '</Gather>',
    `<Say language="${escapeXml(args.language)}">I didn't hear anything. Let's try again. Please tell me how I can help.</Say>`,
    `<Redirect method="POST">${escapeXml(args.actionUrl)}</Redirect>`,
  ].join('')
}

function stopCall(message: string, language: string): string {
  return `<Say language="${escapeXml(language)}">${escapeXml(message)}</Say><Hangup/>`
}

export async function POST(request: Request) {
  const params = formDataToParams(await request.formData())

  try {
    const valid = await verifyTwilioSignature(request, params)
    if (!valid) return new NextResponse('Forbidden', { status: 403 })

    const sessionId = new URL(request.url).searchParams.get('session_id')?.trim()
    if (!sessionId) return new NextResponse('Missing session_id', { status: 400 })

    const db = createServiceRoleClient()
    const { data: session, error: sessionError } = await db
      .from('ai_call_sessions')
      .select('id, account_id, provider_call_sid, settings, history, status')
      .eq('id', sessionId)
      .maybeSingle()

    if (sessionError || !session) {
      return new NextResponse('Call session not found', { status: 404 })
    }

    const settings = (session.settings ?? {}) as {
      callerName?: string
      greeting?: string
      instructions?: string
      language?: string
      transferNumber?: string
      transferOnHandoff?: boolean
      maxCallMinutes?: number
    }

    const language = settings.language || 'en-IN'
    const history = Array.isArray(session.history)
      ? (session.history as ChatMessage[])
      : []

    const speech = (params.get('SpeechResult') || '').trim()
    const actionUrl = request.url

    if (!speech) {
      const firstGreeting =
        settings.greeting || `Hi, this is ${settings.callerName || 'Megorah AI'}. How can I help you today?`
      return twimlResponse(
        sayAndGather({
          text: firstGreeting,
          actionUrl,
          language,
        }),
      )
    }

    const aiConfig = await loadAiConfig(db, session.account_id)
    if (!aiConfig) {
      return twimlResponse(
        stopCall('The AI configuration is currently unavailable. Please try again later.', language),
      )
    }

    const systemPrompt = [
      `You are ${settings.callerName || 'Megorah AI'}, a natural phone support agent.`,
      settings.instructions || '',
      'This is a live phone conversation. Keep replies short, conversational and easy to understand when spoken aloud.',
      'Do not use markdown, emojis, bullet points, or long paragraphs.',
      'Never claim you completed an action unless you actually did it.',
      'If the caller asks for a human and a handoff route is configured, output the exact sentinel [HANDOFF] at the end of your response.',
      aiConfig.systemPrompt || '',
    ]
      .filter(Boolean)
      .join('\\n\\n')

    const result = await generateReply({
      config: aiConfig,
      systemPrompt,
      messages: [...history, { role: 'user', content: speech }],
    })

    const nextHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: speech },
      { role: 'assistant', content: result.text },
    ].slice(-12)

    await db
      .from('ai_call_sessions')
      .update({
        history: nextHistory,
        status: 'in-progress',
      })
      .eq('id', sessionId)

    if (result.handoff) {
      if (settings.transferOnHandoff && settings.transferNumber) {
        const message = result.text || 'I am connecting you with a human team member now.'
        return twimlResponse(
          `<Say language="${escapeXml(language)}">${escapeXml(message)}</Say><Dial timeout="25">${escapeXml(settings.transferNumber)}</Dial><Hangup/>`,
        )
      }

      return twimlResponse(
        stopCall(
          result.text || 'I understand. A human team member will take over from here.',
          language,
        ),
      )
    }

    if (!result.text) {
      return twimlResponse(
        sayAndGather({
          text: 'Please say that one more time.',
          actionUrl,
          language,
        }),
      )
    }

    return twimlResponse(
      sayAndGather({
        text: result.text,
        actionUrl,
        language,
      }),
    )
  } catch (err) {
    console.error('[ai-calling/voice] error:', err)
    return twimlResponse(
      '<Say language="en-IN">Sorry, there was a temporary problem. Please try again later.</Say><Hangup/>',
    )
  }
}
