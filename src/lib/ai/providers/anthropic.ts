import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import { mergeConsecutive, normalizeUsage, providerHttpError, toNetworkError, type ProviderArgs } from './shared'
import { resilientFetch } from '@/lib/security/resilient-fetch'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
interface AnthropicResponse { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] { const merged = mergeConsecutive(messages); while (merged.length > 0 && merged[0].role === 'assistant') merged.shift(); return merged.length ? merged : [{ role: 'user', content: '(The customer has not sent a message yet.)' }] }

export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  let res: Response
  try {
    res = await resilientFetch(ANTHROPIC_URL, { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, system: systemPrompt, max_tokens: MAX_OUTPUT_TOKENS, messages: normalizeForAnthropic(messages) }) }, { timeoutMs, maxAttempts: 2 })
  } catch (err) { throw toNetworkError(err) }
  if (!res.ok) throw await providerHttpError('Anthropic', res)
  const data = (await res.json().catch(() => null)) as AnthropicResponse | null
  const text = data?.content?.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('').trim()
  if (!text) throw new AiError('Anthropic returned an empty response.', { code: 'empty_response' })
  return { text, usage: normalizeUsage({ prompt: data?.usage?.input_tokens, completion: data?.usage?.output_tokens }) }
}
