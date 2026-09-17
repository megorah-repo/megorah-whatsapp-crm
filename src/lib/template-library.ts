import { extractVariableIndices, type TemplatePayload } from '@/lib/whatsapp/template-validators'

export type TemplateLibrarySource = 'brand' | 'runtime'

export interface TemplateLibraryVariable {
  key: string
  label: string
  source: TemplateLibrarySource
  required: boolean
  example: string
}

export interface TemplateLibraryItem {
  id: string
  slug: string
  name: string
  category: string
  meta_category: string
  language: string
  description: string
  meta_name: string
  header_type: TemplatePayload['header_type'] | null
  body_template: string
  footer_text: string | null
  buttons: TemplatePayload['buttons'] | null
  variable_schema: TemplateLibraryVariable[]
  version: number
  is_active: boolean
}

export interface TemplateBrandConfig {
  brand_name: string
  support_phone?: string
}

export interface CatalogActivationInput {
  brandConfig: TemplateBrandConfig
  headerMediaUrl?: string
}

function schema(item: TemplateLibraryItem): TemplateLibraryVariable[] {
  return Array.isArray(item.variable_schema) ? item.variable_schema : []
}

function resolveBrandTokens(text: string, config: TemplateBrandConfig): string {
  return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    if (key === 'brand_name') {
      const value = config.brand_name?.trim()
      if (!value) throw new Error('Brand name is required.')
      return value
    }
    if (key === 'support_phone') {
      const value = config.support_phone?.trim()
      if (!value) throw new Error('Support phone is required for this template.')
      return value
    }
    return `{{${key}}}`
  })
}

export function buildLibraryMetaPayload(
  item: TemplateLibraryItem,
  input: CatalogActivationInput,
): { payload: TemplatePayload; runtimeKeys: string[] } {
  const vars = schema(item)
  const requiredBrand = vars.filter((variable) => variable.source === 'brand' && variable.required)
  for (const variable of requiredBrand) {
    const configured = variable.key === 'brand_name'
      ? input.brandConfig.brand_name
      : input.brandConfig[variable.key as keyof TemplateBrandConfig]
    if (typeof configured !== 'string' || !configured.trim()) {
      throw new Error(`${variable.label} is required before activation.`)
    }
  }

  const known = new Map(vars.map((variable) => [variable.key, variable]))
  const runtimeKeys: string[] = []
  const runtimeIndex = new Map<string, number>()

  const transform = (text: string): string => {
    const branded = resolveBrandTokens(text, input.brandConfig)
    return branded.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
      const variable = known.get(key)
      if (!variable) throw new Error(`Template library variable "${key}" is not defined.`)
      if (variable.source === 'brand') throw new Error(`Brand variable "${key}" is not configured.`)
      let position = runtimeIndex.get(key)
      if (!position) {
        position = runtimeKeys.length + 1
        runtimeKeys.push(key)
        runtimeIndex.set(key, position)
      }
      return `{{${position}}}`
    })
  }

  const headerType = item.header_type ?? undefined
  const headerMediaUrl = headerType && headerType !== 'text'
    ? input.headerMediaUrl?.trim() || undefined
    : undefined

  if (headerType && headerType !== 'text' && !headerMediaUrl) {
    throw new Error('This template requires a branded media/header image before activation.')
  }

  const bodyText = transform(item.body_template)
  const runtimeSamples = runtimeKeys.map((key) => known.get(key)?.example?.trim() || key)

  const payload: TemplatePayload = {
    name: item.meta_name,
    category: 'Utility',
    language: item.language,
    header_type: headerType,
    header_media_url: headerMediaUrl,
    body_text: bodyText,
    footer_text: item.footer_text ? resolveBrandTokens(item.footer_text, input.brandConfig) : undefined,
    buttons: item.buttons ?? undefined,
    sample_values: runtimeSamples.length > 0 ? { body: runtimeSamples } : undefined,
  }

  extractVariableIndices(payload.body_text)
  return { payload, runtimeKeys }
}

export function renderLibraryPreview(
  item: TemplateLibraryItem,
  brandConfig: TemplateBrandConfig,
): string {
  const values = new Map(schema(item).map((variable) => [
    variable.key,
    variable.source === 'brand'
      ? variable.key === 'brand_name'
        ? brandConfig.brand_name
        : brandConfig.support_phone ?? variable.example
      : variable.example,
  ]))

  return item.body_template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => values.get(key) ?? `{{${key}}}`)
}

export function requiredBrandVariables(item: TemplateLibraryItem): TemplateLibraryVariable[] {
  return schema(item).filter((variable) => variable.source === 'brand' && variable.required)
}

export function runtimeVariableKeys(item: TemplateLibraryItem): string[] {
  return schema(item)
    .filter((variable) => variable.source === 'runtime')
    .map((variable) => variable.key)
}
