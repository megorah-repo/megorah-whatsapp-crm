-- 040_template_catalog.sql
-- Central, platform-managed pre-built WhatsApp template library.
-- Phase 1: Website Orders only.

CREATE TABLE IF NOT EXISTS public.template_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  meta_category TEXT NOT NULL DEFAULT 'UTILITY',
  language TEXT NOT NULL DEFAULT 'en_US',
  description TEXT NOT NULL,
  meta_name TEXT NOT NULL UNIQUE,
  header_type TEXT,
  body_template TEXT NOT NULL,
  footer_text TEXT,
  buttons JSONB,
  variable_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.template_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS template_catalog_select_active ON public.template_catalog;
CREATE POLICY template_catalog_select_active
  ON public.template_catalog
  FOR SELECT TO authenticated
  USING (is_active = TRUE);

DROP TRIGGER IF EXISTS set_updated_at ON public.template_catalog;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.template_catalog
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS catalog_template_id UUID REFERENCES public.template_catalog(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS catalog_version INTEGER,
  ADD COLUMN IF NOT EXISTS library_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS brand_config JSONB;

CREATE INDEX IF NOT EXISTS idx_message_templates_catalog_template
  ON public.message_templates(account_id, catalog_template_id)
  WHERE catalog_template_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_templates_one_library_activation
  ON public.message_templates(account_id, catalog_template_id, language)
  WHERE catalog_template_id IS NOT NULL;

DROP POLICY IF EXISTS message_templates_update ON public.message_templates;
CREATE POLICY message_templates_update
  ON public.message_templates
  FOR UPDATE
  USING (
    is_account_member(account_id, 'admin')
    AND COALESCE(library_locked, FALSE) = FALSE
  );

DROP POLICY IF EXISTS message_templates_delete ON public.message_templates;
CREATE POLICY message_templates_delete
  ON public.message_templates
  FOR DELETE
  USING (
    is_account_member(account_id, 'admin')
    AND COALESCE(library_locked, FALSE) = FALSE
  );

CREATE INDEX IF NOT EXISTS idx_template_catalog_category_active
  ON public.template_catalog(category, is_active, name);

INSERT INTO public.template_catalog (
  slug, name, category, meta_category, language, description, meta_name,
  header_type, body_template, footer_text, buttons, variable_schema, version, is_active
) VALUES
('website_order_placed','Order Placed','Website Orders','UTILITY','en_US','Confirmation that the order request was received.','website_order_placed',NULL,
 'Hi {{customer_name}}, we’ve received your order {{order_id}} with {{brand_name}}. We’re reviewing the order details and will keep you updated here.',
 'Thank you for choosing {{brand_name}}.',NULL,
 '[{"key":"customer_name","label":"Customer name","source":"runtime","required":true,"example":"Rahul"},{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"}]'::jsonb,1,TRUE),
('website_order_confirmation','Order Confirmation','Website Orders','UTILITY','en_US','Order confirmed with amount and branded media.','website_order_confirmation','image',
 'Hi {{customer_name}}, your order {{order_id}} with {{brand_name}} is confirmed. Order amount: {{amount}} {{currency}}. Thank you for choosing us.',NULL,NULL,
 '[{"key":"customer_name","label":"Customer name","source":"runtime","required":true,"example":"Rahul"},{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"},{"key":"amount","label":"Order amount","source":"runtime","required":true,"example":"1599"},{"key":"currency","label":"Currency","source":"runtime","required":true,"example":"INR"}]'::jsonb,1,TRUE),
('website_order_processing','Order Processing','Website Orders','UTILITY','en_US','Lets the customer know the order has entered processing.','website_order_processing',NULL,
 'Hi {{customer_name}}, your order {{order_id}} from {{brand_name}} is now being processed. We’ll share the next update soon.',NULL,NULL,
 '[{"key":"customer_name","label":"Customer name","source":"runtime","required":true,"example":"Rahul"},{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"}]'::jsonb,1,TRUE),
('website_order_packed','Order Packed','Website Orders','UTILITY','en_US','Packed and ready for dispatch notification.','website_order_packed',NULL,
 'Good news, {{customer_name}} — order {{order_id}} from {{brand_name}} has been packed and is ready for dispatch.',NULL,NULL,
 '[{"key":"customer_name","label":"Customer name","source":"runtime","required":true,"example":"Rahul"},{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"}]'::jsonb,1,TRUE),
('website_order_shipped','Order Shipped','Website Orders','UTILITY','en_US','Shipment confirmation with tracking link.','website_order_shipped','image',
 'Your order {{order_id}} from {{brand_name}} has been shipped. Track it here: {{tracking_link}}',NULL,NULL,
 '[{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"},{"key":"tracking_link","label":"Tracking link","source":"runtime","required":true,"example":"https://tracking.example/abc123"}]'::jsonb,1,TRUE),
('website_order_out_for_delivery','Out for Delivery','Website Orders','UTILITY','en_US','Delivery-day alert.','website_order_out_for_delivery',NULL,
 'Your order {{order_id}} from {{brand_name}} is out for delivery today. Please keep your phone available for the delivery partner.',NULL,NULL,
 '[{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"}]'::jsonb,1,TRUE),
('website_order_delivered','Order Delivered','Website Orders','UTILITY','en_US','Successful delivery confirmation with branded media.','website_order_delivered','image',
 'Hi {{customer_name}}, your order {{order_id}} from {{brand_name}} has been delivered successfully. We hope you enjoy your purchase.',
 'Thank you for choosing {{brand_name}}.',NULL,
 '[{"key":"customer_name","label":"Customer name","source":"runtime","required":true,"example":"Rahul"},{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"}]'::jsonb,1,TRUE),
('website_order_failed_delivery','Failed Delivery','Website Orders','UTILITY','en_US','Failed delivery alert with support contact.','website_order_failed_delivery',NULL,
 'We couldn’t complete delivery of order {{order_id}} from {{brand_name}}. Please contact support if you need help: {{support_phone}}',NULL,NULL,
 '[{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"},{"key":"support_phone","label":"Support phone","source":"brand","required":true,"example":"+919876543210"}]'::jsonb,1,TRUE),
('website_order_cancelled','Order Cancelled','Website Orders','UTILITY','en_US','Order cancellation notification.','website_order_cancelled',NULL,
 'Your order {{order_id}} from {{brand_name}} has been cancelled. If you need assistance, contact support: {{support_phone}}',NULL,NULL,
 '[{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"},{"key":"support_phone","label":"Support phone","source":"brand","required":true,"example":"+919876543210"}]'::jsonb,1,TRUE),
('website_order_rto_returned','RTO / Returned','Website Orders','UTILITY','en_US','Return-to-origin notification when delivery could not be completed.','website_order_rto_returned',NULL,
 'Your order {{order_id}} from {{brand_name}} is being returned to the sender because delivery could not be completed. Contact support: {{support_phone}}',NULL,NULL,
 '[{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"},{"key":"support_phone","label":"Support phone","source":"brand","required":true,"example":"+919876543210"}]'::jsonb,1,TRUE),
('website_order_refund','Refund Initiated','Website Orders','UTILITY','en_US','Refund initiation confirmation.','website_order_refund',NULL,
 'Your refund for order {{order_id}} from {{brand_name}} has been initiated. Refund amount: {{amount}} {{currency}}. Processing time depends on your payment method.',NULL,NULL,
 '[{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"},{"key":"amount","label":"Refund amount","source":"runtime","required":true,"example":"1599"},{"key":"currency","label":"Currency","source":"runtime","required":true,"example":"INR"}]'::jsonb,1,TRUE),
('website_order_payment_failed','Payment Failed','Website Orders','UTILITY','en_US','Payment failure notification with retry link.','website_order_payment_failed',NULL,
 'Payment for order {{order_id}} from {{brand_name}} was not completed. Please retry using the payment link: {{payment_link}}',NULL,NULL,
 '[{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"},{"key":"payment_link","label":"Payment link","source":"runtime","required":true,"example":"https://pay.example/abc123"}]'::jsonb,1,TRUE),
('website_order_cod_confirmation','COD Confirmation','Website Orders','UTILITY','en_US','Cash-on-delivery confirmation with quick replies.','website_order_cod_confirmation',NULL,
 'Hi {{customer_name}}, please confirm your Cash on Delivery order {{order_id}} from {{brand_name}} for {{amount}} {{currency}}.',
 'Reply with one of the buttons to confirm or cancel.',
 '[{"type":"QUICK_REPLY","text":"Confirm order"},{"type":"QUICK_REPLY","text":"Cancel order"}]'::jsonb,
 '[{"key":"customer_name","label":"Customer name","source":"runtime","required":true,"example":"Rahul"},{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"},{"key":"amount","label":"Order amount","source":"runtime","required":true,"example":"1599"},{"key":"currency","label":"Currency","source":"runtime","required":true,"example":"INR"}]'::jsonb,1,TRUE),
('website_order_delayed','Order Delayed','Website Orders','UTILITY','en_US','Delay notification that can be triggered when fulfillment misses its expected milestone.','website_order_delayed',NULL,
 'Your order {{order_id}} from {{brand_name}} is taking a little longer than expected. We’re working to get it to you as soon as possible. Thank you for your patience.',NULL,NULL,
 '[{"key":"order_id","label":"Order ID","source":"runtime","required":true,"example":"MG10283"},{"key":"brand_name","label":"Brand name","source":"brand","required":true,"example":"Megorah"}]'::jsonb,1,TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  meta_category = EXCLUDED.meta_category,
  language = EXCLUDED.language,
  description = EXCLUDED.description,
  meta_name = EXCLUDED.meta_name,
  header_type = EXCLUDED.header_type,
  body_template = EXCLUDED.body_template,
  footer_text = EXCLUDED.footer_text,
  buttons = EXCLUDED.buttons,
  variable_schema = EXCLUDED.variable_schema,
  version = EXCLUDED.version,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
