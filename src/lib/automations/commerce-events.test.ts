import { describe, expect, it } from 'vitest'
import { isCommerceEvent, COMMERCE_EVENTS } from './commerce-events'

describe('commerce event catalog', () => {
  it('contains the store lifecycle events used by quick-start automations', () => {
    expect(COMMERCE_EVENTS).toContain('order.created')
    expect(COMMERCE_EVENTS).toContain('order.paid')
    expect(COMMERCE_EVENTS).toContain('order.shipped')
    expect(COMMERCE_EVENTS).toContain('order.out_for_delivery')
    expect(COMMERCE_EVENTS).toContain('order.delivered')
    expect(COMMERCE_EVENTS).toContain('checkout.abandoned')
  })

  it('rejects arbitrary trigger values', () => {
    expect(isCommerceEvent('something.else')).toBe(false)
    expect(isCommerceEvent(null)).toBe(false)
  })

  it('accepts supported event values', () => {
    expect(isCommerceEvent('order.created')).toBe(true)
    expect(isCommerceEvent('refund.created')).toBe(true)
  })
})
