'use client'

import { useEffect, useState } from 'react'
import { Loader2, Pause, Play, PhoneCall, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

type Campaign = {
  id:string
  name:string
  status:string
  max_concurrent:number
  calls_per_run:number
  max_attempts:number
  retry_delay_minutes:number
  business_hours_only:boolean
  queued:number
  completed:number
  failed:number
}

export function AutoCallCampaigns(props:{
  callerName:string
  greeting:string
  instructions:string
  language:string
  transferNumber:string
  transferOnHandoff:boolean
  maxCallMinutes:string
  canEdit:boolean
}) {
  const [campaigns,setCampaigns]=useState<Campaign[]>([])
  const [loading,setLoading]=useState(false)
  const [creating,setCreating]=useState(false)
  const [name,setName]=useState('AI Outbound Campaign')
  const [recipients,setRecipients]=useState('')
  const [maxConcurrent,setMaxConcurrent]=useState('2')
  const [callsPerRun,setCallsPerRun]=useState('2')
  const [maxAttempts,setMaxAttempts]=useState('2')
  const [retryDelay,setRetryDelay]=useState('30')
  const [hoursOnly,setHoursOnly]=useState(true)

  const load=async()=>{
    setLoading(true)
    try{
      const res=await fetch('/api/ai-calling/campaigns',{cache:'no-store'})
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'Could not load auto-call campaigns.')
      setCampaigns(data.campaigns||[])
    }catch(error){toast.error(error instanceof Error?error.message:'Could not load auto-call campaigns.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[])

  const createAndStart=async()=>{
    if(!props.canEdit||creating) return
    if(!name.trim()){toast.error('Enter a campaign name.');return}
    const cleaned=recipients.split(/[\n,;]+/).map(v=>v.trim()).filter(Boolean)
    if(!cleaned.length){toast.error('Add at least one recipient number.');return}
    setCreating(true)
    try{
      const res=await fetch('/api/ai-calling/campaigns',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          name:name.trim(),
          recipients:cleaned,
          max_concurrent:Number(maxConcurrent)||2,
          calls_per_run:Number(callsPerRun)||2,
          max_attempts:Number(maxAttempts)||2,
          retry_delay_minutes:Number(retryDelay)||30,
          business_hours_only:hoursOnly,
          business_hours_start:'09:00',
          business_hours_end:'19:00',
          timezone:'Asia/Kolkata',
          start_now:true,
          settings:{
            callerName:props.callerName,
            greeting:props.greeting,
            instructions:props.instructions,
            language:props.language==='hinglish-IN'?'en-IN':props.language,
            transferNumber:props.transferNumber,
            transferOnHandoff:props.transferOnHandoff,
            maxCallMinutes:Number(props.maxCallMinutes)||12,
          },
        }),
      })
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'Could not create auto-call campaign.')
      const runRes=await fetch('/api/ai-calling/campaigns/'+encodeURIComponent(data.campaign_id),{
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({status:'running',run_now:true}),
      })
      const runData=await runRes.json()
      if(!runRes.ok) throw new Error(runData.error||'Campaign created but could not start calls.')
      toast.success('Auto-call campaign started. Calls will continue automatically every minute.')
      setRecipients('')
      await load()
      if(runData.run?.results?.length) await load()
    }catch(error){toast.error(error instanceof Error?error.message:'Could not start auto-call campaign.')}
    finally{setCreating(false)}
  }

  const updateStatus=async(id:string,status:'running'|'paused',runNow=false)=>{
    try{
      const res=await fetch('/api/ai-calling/campaigns/'+encodeURIComponent(id),{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({status,run_now:runNow}),
      })
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'Could not update campaign.')
      toast.success(status==='running'?'Campaign resumed.':'Campaign paused.')
      await load()
    }catch(error){toast.error(error instanceof Error?error.message:'Could not update campaign.')}
  }

  const remove=async(id:string)=>{
    if(!window.confirm('Delete this auto-call campaign and its queue?')) return
    try{
      const res=await fetch('/api/ai-calling/campaigns/'+encodeURIComponent(id),{method:'DELETE'})
      const data=await res.json()
      if(!res.ok) throw new Error(data.error||'Could not delete campaign.')
      await load();toast.success('Campaign deleted.')
    }catch(error){toast.error(error instanceof Error?error.message:'Could not delete campaign.')}
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><PhoneCall className="h-4 w-4 text-primary"/> Auto Calling</CardTitle>
        <CardDescription>Paste lead/customer numbers and let the CRM dial automatically. The campaign uses your saved AI Calling settings and retries temporary failures.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="auto-call-name">Campaign name</Label><Input id="auto-call-name" value={name} onChange={e=>setName(e.target.value)} disabled={!props.canEdit||creating}/></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Concurrent calls</Label><Input type="number" min={1} max={20} value={maxConcurrent} onChange={e=>setMaxConcurrent(e.target.value)} disabled={!props.canEdit||creating}/></div>
            <div className="space-y-2"><Label>Calls / run</Label><Input type="number" min={1} max={20} value={callsPerRun} onChange={e=>setCallsPerRun(e.target.value)} disabled={!props.canEdit||creating}/></div>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="auto-call-recipients">Recipient numbers</Label>
          <Textarea id="auto-call-recipients" value={recipients} onChange={e=>setRecipients(e.target.value)} rows={5} placeholder="+9198XXXXXXXX\n+9187XXXXXXXX\n+14155550123"/>
          <p className="text-xs text-muted-foreground">One number per line, or comma-separated. E.164 format only.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2"><Label>Max attempts</Label><Input type="number" min={1} max={10} value={maxAttempts} onChange={e=>setMaxAttempts(e.target.value)} disabled={!props.canEdit||creating}/></div>
          <div className="space-y-2"><Label>Retry delay (minutes)</Label><Input type="number" min={1} max={1440} value={retryDelay} onChange={e=>setRetryDelay(e.target.value)} disabled={!props.canEdit||creating}/></div>
          <div className="flex items-end justify-between rounded-lg border px-3 py-2"><div><p className="text-sm font-medium">Business hours only</p><p className="text-xs text-muted-foreground">09:00–19:00 IST</p></div><Switch checked={hoursOnly} onCheckedChange={setHoursOnly} disabled={!props.canEdit||creating}/></div>
        </div>
        <Button className="w-full" size="lg" onClick={createAndStart} disabled={!props.canEdit||creating||!recipients.trim()}>
          {creating?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Play className="mr-2 h-4 w-4"/>}
          {creating?'Starting…':'Start Auto Calls'}
        </Button>

        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm font-medium">Campaigns</p>
          <Button variant="ghost" size="sm" onClick={()=>void load()} disabled={loading}>{loading?<Loader2 className="h-4 w-4 animate-spin"/>:<RefreshCw className="h-4 w-4"/>}</Button>
        </div>
        {campaigns.length===0?(
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No auto-call campaigns yet.</div>
        ):(
          <div className="space-y-3">
            {campaigns.map((campaign)=>(
              <div key={campaign.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground">{campaign.queued} queued · {campaign.completed} completed · {campaign.failed} failed · {campaign.max_concurrent} concurrent</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {campaign.status==='running'?(
                      <Button variant="outline" size="sm" onClick={()=>void updateStatus(campaign.id,'paused')}><Pause className="mr-1.5 h-3.5 w-3.5"/>Pause</Button>
                    ):campaign.status==='paused'?(
                      <Button variant="outline" size="sm" onClick={()=>void updateStatus(campaign.id,'running',true)}><Play className="mr-1.5 h-3.5 w-3.5"/>Resume</Button>
                    ):null}
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize">{campaign.status}</span>
                    {(campaign.status==='draft'||campaign.status==='paused'||campaign.status==='completed')&&<Button variant="ghost" size="sm" onClick={()=>void remove(campaign.id)}><Trash2 className="h-3.5 w-3.5"/></Button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
