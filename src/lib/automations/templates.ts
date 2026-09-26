import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | 'order_confirmation'
  | 'payment_confirmation'
  | 'shipment_tracking'
  | 'out_for_delivery'
  | 'delivery_confirmation'
  | 'abandoned_cart_rescue'
  | 'post_purchase_winback'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Welcome Message',
    description: 'Auto-reply to first-time contacts with a greeting.',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! 👋 Thanks for reaching out. We'll get back to you shortly.",
        },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: 'Out of Office',
    description: 'Auto-reply during off-hours so nobody is left waiting.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Thanks for your message! Our team is offline right now (9am–6pm) and will reply first thing tomorrow.",
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Ask qualification questions to filter inbound leads.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Great — happy to help with pricing! Quick question: roughly how many seats are you looking for?",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Follow-up Reminder',
    description: 'Send a nudge if a contact has not replied within 24 hours.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Just circling back — did you have any other questions for us? Happy to help!",
        },
      },
    ],
  },
  order_confirmation: {
    slug: 'order_confirmation',
    name: 'Order Confirmation',
    description: 'Send a WhatsApp order confirmation when a new order is created.',
    trigger_type: 'commerce_event',
    trigger_config: { event: 'order.created' },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'YOUR_APPROVED_ORDER_CONFIRMATION_TEMPLATE',
          language: 'en_US',
          variables: {
            '1': '{{vars.customer_name}}',
            '2': '{{vars.order_number}}',
            '3': '{{vars.total}}',
          },
        },
      },
    ],
  },
  payment_confirmation: {
    slug: 'payment_confirmation',
    name: 'Payment Confirmation',
    description: 'Confirm successful payment on WhatsApp using your approved template.',
    trigger_type: 'commerce_event',
    trigger_config: { event: 'order.paid' },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'YOUR_APPROVED_PAYMENT_TEMPLATE',
          language: 'en_US',
          variables: {
            '1': '{{vars.customer_name}}',
            '2': '{{vars.order_number}}',
            '3': '{{vars.total}}',
          },
        },
      },
    ],
  },
  shipment_tracking: {
    slug: 'shipment_tracking',
    name: 'Shipment Tracking',
    description: 'Send courier, tracking number and tracking link when an order ships.',
    trigger_type: 'commerce_event',
    trigger_config: { event: 'order.shipped' },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'YOUR_APPROVED_SHIPMENT_TEMPLATE',
          language: 'en_US',
          variables: {
            '1': '{{vars.customer_name}}',
            '2': '{{vars.order_number}}',
            '3': '{{vars.courier}}',
            '4': '{{vars.tracking_number}}',
            '5': '{{vars.tracking_url}}',
          },
        },
      },
    ],
  },
  out_for_delivery: {
    slug: 'out_for_delivery',
    name: 'Out for Delivery',
    description: 'Notify the customer when the package is out for delivery.',
    trigger_type: 'commerce_event',
    trigger_config: { event: 'order.out_for_delivery' },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'YOUR_APPROVED_OUT_FOR_DELIVERY_TEMPLATE',
          language: 'en_US',
          variables: {
            '1': '{{vars.customer_name}}',
            '2': '{{vars.order_number}}',
            '3': '{{vars.tracking_url}}',
          },
        },
      },
    ],
  },
  delivery_confirmation: {
    slug: 'delivery_confirmation',
    name: 'Delivery Confirmation',
    description: 'Thank the customer when the order is delivered.',
    trigger_type: 'commerce_event',
    trigger_config: { event: 'order.delivered' },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'YOUR_APPROVED_DELIVERY_TEMPLATE',
          language: 'en_US',
          variables: {
            '1': '{{vars.customer_name}}',
            '2': '{{vars.order_number}}',
          },
        },
      },
    ],
  },
  abandoned_cart_rescue: {
    slug: 'abandoned_cart_rescue',
    name: 'Abandoned Cart Rescue',
    description: 'Wait before sending a recovery template; the wait is cancelled when the same checkout converts.',
    trigger_type: 'commerce_event',
    trigger_config: { event: 'checkout.abandoned' },
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'hours' },
      },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'YOUR_APPROVED_ABANDONED_CART_TEMPLATE',
          language: 'en_US',
          variables: {
            '1': '{{vars.customer_name}}',
            '2': '{{vars.checkout_url}}',
            '3': '{{vars.discount_code}}',
          },
        },
      },
    ],
  },
  post_purchase_winback: {
    slug: 'post_purchase_winback',
    name: 'Post-Purchase Winback',
    description: 'Re-engage customers after delivery with a marketing template.',
    trigger_type: 'commerce_event',
    trigger_config: { event: 'order.delivered' },
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 7, unit: 'days' },
      },
      {
        step_type: 'send_template',
        step_config: {
          template_name: 'YOUR_APPROVED_WINBACK_TEMPLATE',
          language: 'en_US',
          variables: {
            '1': '{{vars.customer_name}}',
            '2': '{{vars.order_number}}',
          },
        },
      },
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}
