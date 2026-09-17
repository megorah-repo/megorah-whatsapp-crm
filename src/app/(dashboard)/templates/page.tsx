'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, ImagePlus, Loader2, Search, ShieldCheck, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { uploadAccountMedia } from '@/lib/storage/upload-media'
import {
  renderLibraryPreview,
  requiredBrandVariables,
  runtimeVariableKeys,
  type TemplateBrandConfig,
  type TemplateLibraryItem,
} from '@/lib/template-library'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const CATEGORY = 'Website Orders'

type ActivationRow = {
  id: string
  catalog_template_id: string | null
  status: string
  meta_template_id: string | null
  catalog_version: number | null
  brand_config: TemplateBrandConfig | null
}

export default function TemplateLibraryPage() {
  const supabase = createClient()
  const { account, profile, loading: authLoading } = useAuth()
  const [items, setItems] = useState<TemplateLibraryItem[]>([])
  const [activations, setActivations] = useState<ActivationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [brandConfig, setBrandConfig] = useState<TemplateBrandConfig>({ brand_name: '' })
  const [mediaUrl, setMediaUrl] = useState('')
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [activating, setActivating] = useState(false)
  const mediaInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (authLoading || !account?.id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: catalog, error: catalogError }, { data: activeTemplates, error: activationError }] = await Promise.all([
        supabase
          .from('template_catalog')
          .select('*')
          .eq('category', CATEGORY)
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('message_templates')
          .select('id,catalog_template_id,status,meta_template_id,catalog_version,brand_config')
          .eq('account_id', account.id)
          .not('catalog_template_id', 'is', null),
      ])

      if (cancelled) return
      if (catalogError) toast.error('Could not load the template library.')
      else {
        const rows = (catalog ?? []) as TemplateLibraryItem[]
        setItems(rows)
        setSelectedId((current) => current ?? rows[0]?.id ?? null)
      }
      if (activationError) console.error('Template activation load failed:', activationError)
      else setActivations((activeTemplates ?? []) as ActivationRow[])
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [account?.id, authLoading, supabase])

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => `${item.name} ${item.description} ${item.slug}`.toLowerCase().includes(needle))
  }, [items, query])

  const selected = items.find((item) => item.id === selectedId) ?? filteredItems[0] ?? items[0]
  const activation = selected ? activations.find((row) => row.catalog_template_id === selected.id) : undefined
  const requiredBrand = selected ? requiredBrandVariables(selected) : []
  const runtimeKeys = selected ? runtimeVariableKeys(selected) : []
  const preview = selected
    ? renderLibraryPreview(selected, {
        brand_name: brandConfig.brand_name || account?.name || profile?.full_name || 'Your Brand',
        support_phone: brandConfig.support_phone,
      })
    : ''

  useEffect(() => {
    if (!selected) return
    const saved = activation?.brand_config
    setBrandConfig({
      brand_name: saved?.brand_name || account?.name || profile?.full_name || '',
      support_phone: saved?.support_phone || '',
    })
    setMediaUrl('')
  }, [activation?.id, selected?.id, account?.name, profile?.full_name])

  async function uploadHeader(file: File) {
    setUploadingMedia(true)
    try {
      const result = await uploadAccountMedia('chat-media', file)
      setMediaUrl(result.publicUrl)
      toast.success('Brand media uploaded.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed.')
    } finally {
      setUploadingMedia(false)
    }
  }

  async function activateTemplate() {
    if (!selected || activating) return
    setActivating(true)
    try {
      const response = await fetch('/api/template-library/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalog_template_id: selected.id,
          brand_config: brandConfig,
          header_media_url: mediaUrl || undefined,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Activation failed.')

      if (data.already_active) toast.success('This template is already active for this workspace.')
      else if (data.submitted_to_meta) toast.success('Template activated and submitted to WhatsApp for review.')
      else if (!data.connected) toast.success('Template saved as a draft. Connect WhatsApp to submit it to Meta.')
      else if (data.submission_error) toast.error(`Saved as draft: ${data.submission_error}`)
      else toast.success('Template activated.')

      const { data: fresh } = await supabase
        .from('message_templates')
        .select('id,catalog_template_id,status,meta_template_id,catalog_version,brand_config')
        .eq('account_id', account?.id ?? '')
        .not('catalog_template_id', 'is', null)
      setActivations((fresh ?? []) as ActivationRow[])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Activation failed.')
    } finally {
      setActivating(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading template library…</div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge className="border-primary/20 bg-primary/10 text-primary">Template Library</Badge>
            <Badge variant="outline">{CATEGORY}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Website Order Templates</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Professionally structured WhatsApp utility templates. Clients configure branding and business details; the message structure stays centrally managed.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Approval-ready structure</div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="overflow-hidden border-border/70 bg-card/80 shadow-sm">
          <CardHeader className="border-b border-border/60 pb-4">
            <CardTitle className="text-sm font-semibold">Website Orders</CardTitle>
            <div className="relative mt-3"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates…" className="pl-9" /></div>
          </CardHeader>
          <CardContent className="p-2">
            <div className="max-h-[680px] space-y-1 overflow-y-auto pr-1">
              {filteredItems.map((item) => {
                const active = activations.find((row) => row.catalog_template_id === item.id)
                const selectedRow = item.id === selected?.id
                return (
                  <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-xl border px-3 py-3 text-left transition-all ${selectedRow ? 'border-primary/30 bg-primary/8 shadow-sm' : 'border-transparent hover:border-border hover:bg-muted/40'}`}>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{active ? <Check className="size-4" /> : <Sparkles className="size-4" />}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{item.name}</span>{active ? <Badge variant="outline" className="text-[10px]">{active.status}</Badge> : null}</div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/70 bg-card/80 shadow-sm">
          {selected ? (
            <>
              <CardHeader className="border-b border-border/60 pb-5">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-lg">{selected.name}</CardTitle><Badge variant="outline">Utility</Badge>{activation ? <Badge className="border-primary/20 bg-primary/10 text-primary">Active</Badge> : null}</div><p className="mt-1 text-sm text-muted-foreground">{selected.description}</p></div>
                  <code className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">{selected.meta_name}</code>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-6">
                  <section>
                    <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">Preview</h2><p className="text-xs text-muted-foreground">Live sample using the library variables.</p></div><Badge variant="outline">{selected.language}</Badge></div>
                    <div className="rounded-2xl border border-border/70 bg-[#0b1417] p-4">
                      {selected.header_type === 'image' && mediaUrl ? <div className="mb-3 overflow-hidden rounded-xl border border-white/10">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={mediaUrl} alt="Template header" className="max-h-56 w-full object-cover" /></div> : selected.header_type === 'image' ? <div className="mb-3 flex h-32 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] text-xs text-slate-500">Brand media preview</div> : null}
                      <div className="max-w-[36rem] rounded-2xl rounded-tl-md bg-[#e7ffd9] px-4 py-3 text-sm leading-6 text-slate-900 shadow-sm">{preview}</div>
                      {selected.footer_text ? <div className="mt-2 px-2 text-[11px] text-slate-500">{selected.footer_text.replace('{{brand_name}}', brandConfig.brand_name || 'Your Brand')}</div> : null}
                    </div>
                  </section>

                  <section className="grid gap-4 sm:grid-cols-2">
                    <Card className="border-border/60 bg-background/35">
                      <CardHeader className="pb-3"><CardTitle className="text-sm">Client configuration</CardTitle></CardHeader>
                      <CardContent className="space-y-4">
                        {requiredBrand.map((variable) => <div key={variable.key} className="space-y-2"><Label htmlFor={`library-${variable.key}`}>{variable.label}</Label><Input id={`library-${variable.key}`} value={variable.key === 'brand_name' ? brandConfig.brand_name : brandConfig.support_phone ?? ''} onChange={(event) => setBrandConfig((current) => ({ ...current, [variable.key]: event.target.value }))} placeholder={variable.example} /></div>)}
                        {selected.header_type === 'image' ? <div className="space-y-2"><Label>Brand media / logo</Label><input ref={mediaInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadHeader(file); event.currentTarget.value = '' }} /><Button type="button" variant="outline" className="w-full justify-start" onClick={() => mediaInputRef.current?.click()} disabled={uploadingMedia}>{uploadingMedia ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ImagePlus className="mr-2 size-4" />}{mediaUrl ? 'Replace uploaded media' : 'Upload brand media'}</Button>{mediaUrl ? <p className="truncate text-[11px] text-muted-foreground">{mediaUrl}</p> : null}</div> : null}
                      </CardContent>
                    </Card>
                    <Card className="border-border/60 bg-background/35">
                      <CardHeader className="pb-3"><CardTitle className="text-sm">Runtime mapping</CardTitle></CardHeader>
                      <CardContent><p className="mb-3 text-xs leading-5 text-muted-foreground">These variables are populated automatically when a matching website-order event triggers the template.</p><div className="flex flex-wrap gap-2">{runtimeKeys.map((key) => <span key={key} className="rounded-lg border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-foreground">{'{{'}{key}{'}}'}</span>)}</div></CardContent>
                    </Card>
                  </section>

                  <div className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">Template structure is centrally managed</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Clients configure brand-specific values only. The message copy, Meta category and variable contract come from the central library.</p></div><Button type="button" className="shrink-0" onClick={() => void activateTemplate()} disabled={activating || Boolean(activation)}>{activating ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Check className="mr-2 size-4" />}{activation ? 'Already active' : 'Activate template'}</Button></div>
                  {activation ? <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">Active version {activation.catalog_version ?? selected.version} · status <span className="font-medium text-foreground">{activation.status}</span></div> : null}
                </div>

                <aside className="space-y-4"><div className="rounded-2xl border border-border/60 bg-background/40 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Activation flow</p><div className="mt-4 space-y-4">{['Template Library','Preview','Brand configuration','Activate'].map((step, index) => <div key={step} className="flex items-center gap-3"><div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-semibold text-primary">{index + 1}</div><div className="text-sm font-medium">{step}</div></div>)}</div></div><div className="rounded-2xl border border-border/60 bg-background/40 p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Approval posture</p><ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground"><li>• Utility category</li><li>• Contiguous Meta variables</li><li>• Approval samples generated automatically</li><li>• Account branding stays isolated</li><li>• Existing Meta send pipeline reused</li></ul></div></aside>
              </CardContent>
            </>
          ) : <CardContent className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">No Website Order templates found.</CardContent>}
        </Card>
      </div>
    </div>
  )
}
