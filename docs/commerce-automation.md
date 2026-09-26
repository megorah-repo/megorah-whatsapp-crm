# Commerce → WhatsApp Automations

Megorah can accept ecommerce lifecycle events from Shopify, Shopdeck, WooCommerce, n8n, or any backend that can make an HTTPS POST.

## Endpoint

\`POST /api/v1/automation-events\`

Authenticate with a Megorah API key that has the \`messages:send\` scope:

\`Authorization: Bearer wacrm_live_...\`

## Supported events

- \`order.created\`
- \`order.paid\`
- \`order.shipped\`
- \`order.out_for_delivery\`
- \`order.delivered\`
- \`order.cancelled\`
- \`checkout.abandoned\`
- \`payment.failed\`
- \`refund.created\`

## Example event

\`\`\`json
{
  "event_id": "order_12345_created",
  "event_type": "order.created",
  "phone": "+919876543210",
  "customer_name": "Rahul",
  "customer_email": "rahul@example.com",
  "order_id": "12345",
  "order_number": "#10045",
  "total": "1999",
  "currency": "INR",
  "items": [
    { "name": "Megorah Wall Clock", "quantity": 1 }
  ]
}
\`\`\`

## Variables available to automation templates

Use these inside a Send Template step:

- \`{{vars.customer_name}}\`
- \`{{vars.customer_email}}\`
- \`{{vars.order_id}}\`
- \`{{vars.order_number}}\`
- \`{{vars.checkout_id}}\`
- \`{{vars.total}}\`
- \`{{vars.currency}}\`
- \`{{vars.payment_status}}\`
- \`{{vars.fulfillment_status}}\`
- \`{{vars.tracking_number}}\`
- \`{{vars.courier}}\`
- \`{{vars.tracking_url}}\`
- \`{{vars.delivery_date}}\`
- \`{{vars.checkout_url}}\`
- \`{{vars.discount_code}}\`

## Abandoned-cart recovery

The built-in Abandoned Cart Rescue template waits before sending. When the same \`checkout_id\` later arrives on \`order.created\` or \`order.paid\`, Megorah cancels the pending recovery wait so a converted customer is not sent the recovery message.

For this to work, your checkout-abandoned event and converted-order event must carry the same \`checkout_id\`.

## n8n

Use n8n as the source/bridge when the store platform cannot post directly to Megorah. The n8n workflow should normalize the store payload, then POST the normalized event to the endpoint above.

The WhatsApp send itself stays inside Megorah, so templates, message history, contact records, delivery status and automation logs remain in one CRM.
