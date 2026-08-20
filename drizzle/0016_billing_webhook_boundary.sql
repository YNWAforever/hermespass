CREATE UNIQUE INDEX "organizations_stripe_customer_key" ON "organizations" USING btree ("stripe_customer_id") WHERE "organizations"."stripe_customer_id" IS NOT NULL;
--> statement-breakpoint
CREATE POLICY organizations_billing_system_update ON public.organizations FOR UPDATE TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.organizations'::pg_catalog.regclass
  ))
  AND pg_catalog.current_setting('hermes.productization_actor', true) = 'system:billing'
)
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.organizations'::pg_catalog.regclass
  ))
  AND pg_catalog.current_setting('hermes.productization_actor', true) = 'system:billing'
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_apply_billing_event(
  p_customer_id text,
  p_provider_event_id text,
  p_event_type text,
  p_subscription_id text,
  p_tier text,
  p_digest bytea
)
RETURNS TABLE(organization_id uuid, inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  organization_row public.organizations;
  was_inserted boolean;
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'hermes_app'
    OR pg_catalog.current_setting('hermes.productization_actor', true) IS DISTINCT FROM 'system:billing' THEN
    RAISE EXCEPTION 'billing claim denied' USING ERRCODE = '42501';
  END IF;
  IF p_tier NOT IN ('pilot', 'starter', 'growth', 'scale') THEN
    RAISE EXCEPTION 'BILLING_PRICE_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT *
  INTO organization_row
  FROM public.organizations
  WHERE stripe_customer_id = btrim(p_customer_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BILLING_CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT public.hermes_record_billing_event(
    organization_row.id,
    btrim(p_provider_event_id),
    btrim(p_customer_id),
    btrim(p_event_type),
    p_digest
  )
  INTO was_inserted;
  IF was_inserted THEN
    UPDATE public.organizations
    SET tier = p_tier::public.organization_tier,
        stripe_subscription_id = nullif(btrim(p_subscription_id), ''),
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = organization_row.id;
  END IF;
  RETURN QUERY SELECT organization_row.id, was_inserted;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_apply_billing_event(text, text, text, text, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_apply_billing_event(text, text, text, text, text, bytea) TO hermes_app;
--> statement-breakpoint
CREATE POLICY organizations_billing_owner_update ON public.organizations FOR UPDATE TO PUBLIC
USING (
  EXISTS (
    SELECT 1
    FROM public.org_members AS member
    WHERE member.organization_id = organizations.id
      AND member.user_id = public.hermes_current_user_id()
      AND member.role = 'owner'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.org_members AS member
    WHERE member.organization_id = organizations.id
      AND member.user_id = public.hermes_current_user_id()
      AND member.role = 'owner'
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_store_stripe_customer(
  p_organization_id uuid,
  p_customer_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  stored_customer_id text;
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'hermes_app' THEN
    RAISE EXCEPTION 'billing actor denied' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id !~ '^cus_[A-Za-z0-9_]+$' OR length(p_customer_id) > 255 THEN
    RAISE EXCEPTION 'BILLING_PROVIDER_RESPONSE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.org_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = public.hermes_current_user_id()
      AND member.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'billing owner required' USING ERRCODE = '42501';
  END IF;
  SELECT stripe_customer_id
  INTO stored_customer_id
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;
  IF stored_customer_id IS NOT NULL AND stored_customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'BILLING_CUSTOMER_CONFLICT' USING ERRCODE = '23505';
  END IF;
  UPDATE public.organizations
  SET stripe_customer_id = p_customer_id,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_organization_id;
  RETURN p_customer_id;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_store_stripe_customer(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_store_stripe_customer(uuid, text) TO hermes_app;
