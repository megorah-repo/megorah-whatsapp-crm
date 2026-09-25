'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults'
import type { AiProvider } from '@/lib/ai/types'

const MASKED_KEY = '••••••••••••••••'

const providers: Array<{ value: AiProvider; label: string }> = [
  { value:'openai', label:'OpenAI' },
  { value:'anthropic', label:'Anthropic (Claude)' },
  { value:'google-gemini', label:'Google Gemini' },
]

export function CallingAiApiCard() {
  const [provider,setProvider]=useState<AiProvider>('google-gemini')
  const [model,setModel]=useState(AI_PROVIDER_DEFAULT_MODEL['google-gemini'])
  const [apiKey,setApiKey]=useState('')
  const [showKey,setShowKey]=useState(false)
  const [hasKey,setHasKey]=useState(false)
  const [keyEdited,setKeyEdited]=useState(false)
  const [configured,setConfigured]=useState(false)
  const [systemPrompt,setSystemPrompt]=useState('')
  const [autoReplyEnabled,setAutoReplyEnabled]=useState(false)
  const [maxPerConversation,setMaxPerConversation]=useState(3)
  const [handoffAgentId,setHandoffAgentId]=useState<string|null>(null)
  const [saving,setSaving]=useState(false)
  const [testing,setTesting]=useState(false)

  const load=async()=>{
    try{
      const res=await fetch('/api/ai/config',{cache:'no-store'})
      const data=await res.json()
      if(!res.ok) return
      if(data.configured){
        setConfigured(true)
        setProvider(data.provider)
        setModel(data.model||AI_PROVIDER_DEFAULT_MODEL[data.provider as AiProvider])
        setSystemPrompt(data.system_prompt||'')
        setAutoReplyEnabled(Boolean(data.auto_reply_enabled))
        setMaxPerConversation(Number(data.auto_reply_max_per_conversation)||3)
        setHandoffAgentId(data.handoff_agent_id||null)
        setHasKey(Boolean(data.has_key))
        setApiKey(data.has_key ? MASKED_KEY : '')
        setKeyEdited(false)
      }
    }catch{
      // Initial config fetch is best-effort; do not interrupt the AI Agents page.
    }
  }

  useEffect(()=>{void load()},[])

  const save=async()=>{
    if(!keyEdited && !hasKey){toast.error('Paste an AI API key first.');return}
    setSaving(true)
    try{
      const res=await fetch('/api/ai/config',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          provider,
          model:model.trim()||AI_PROVIDER_DEFAULT_MODEL[provider],
          api_key:keyEdited ? apiKey.trim() : undefined,
          system_prompt:systemPrompt.trim()||null,
          is_active:true,
          auto_reply_enabled:autoReplyEnabled,
          auto_reply_max_per_conversation:maxPerConversation,
          handoff_agent_id:handoffAgentId,
        }),
      })
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'Could not save AI API key.')
      setConfigured(true);setHasKey(true);setApiKey(MASKED_KEY);setKeyEdited(false)
      toast.success('AI API connected and enabled for AI Calling.')
    }catch(error){toast.error(error instanceof Error?error.message:'Could not save AI API key.')}
    finally{setSaving(false)}
  }

  const test=async()=>{
    if(!keyEdited && !hasKey){toast.error('Enter an API key to test.');return}
    setTesting(true)
    try{
      const res=await fetch('/api/ai/test',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({provider,model:model.trim(),api_key:keyEdited ? apiKey.trim() : undefined}),
      })
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'AI key test failed.')
      toast.success('AI API test passed.')
    }catch(error){toast.error(error instanceof Error?error.message:'AI key test failed.')}
    finally{setTesting(false)}
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> Direct AI API
        </CardTitle>
        <CardDescription>
          Connect OpenAI, Anthropic or Google Gemini directly. The key is encrypted on the server; this is the AI engine used by Twilio voice calls.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>AI provider</Label>
            <Select value={provider} onValueChange={(value)=>value&&setProvider(value as AiProvider)} disabled={saving}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>{providers.map((item)=><SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="calling-ai-model">Model</Label>
            <Input id="calling-ai-model" value={model} onChange={(e)=>setModel(e.target.value)} disabled={saving} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="calling-ai-key">API key</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input id="calling-ai-key" type={showKey?'text':'password'} value={apiKey} onChange={(e)=>{setApiKey(e.target.value);setKeyEdited(true)}} readOnly={hasKey&&!keyEdited} placeholder={hasKey?'Saved securely — use Replace to change it':'Paste provider API key'} disabled={saving} autoComplete="off"/>
              <button type="button" onClick={()=>setShowKey((v)=>!v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showKey?'Hide API key':'Show API key'}>{showKey?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}</button>
            </div>
            {hasKey && !keyEdited && <Button variant="ghost" onClick={()=>{setApiKey('');setKeyEdited(true);setShowKey(false)}} disabled={saving}>Replace</Button>}
            <Button variant="outline" onClick={test} disabled={testing||saving}>{testing?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<CheckCircle2 className="mr-2 h-4 w-4"/>}Test API</Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="calling-ai-context">AI business context</Label>
          <Textarea id="calling-ai-context" value={systemPrompt} onChange={(e)=>setSystemPrompt(e.target.value)} rows={3} placeholder="e.g. Megorah home decor, Indian D2C brand, product and order support." disabled={saving}/>
        </div>
        {hasKey && !keyEdited && <div className="text-xs text-emerald-600 dark:text-emerald-400">✓ Gemini/API key is securely saved. You do not need to enter it again to test.</div>}
        <Button onClick={save} disabled={saving}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<CheckCircle2 className="mr-2 h-4 w-4"/>}{configured?'Update AI API':'Connect AI API'}</Button>
      </CardContent>
    </Card>
  )
}
