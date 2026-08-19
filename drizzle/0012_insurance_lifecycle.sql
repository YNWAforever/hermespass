CREATE TYPE "public"."insurance_event_kind" AS ENUM('quoted', 'bind_started', 'bound', 'lapsed', 'canceled', 'renewed');--> statement-breakpoint
CREATE TYPE "public"."insurance_status" AS ENUM('quoted', 'binding', 'active', 'lapsed', 'canceled');--> statement-breakpoint
CREATE TABLE public.insurance_commission_ledger (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"premium_cents" bigint NOT NULL,
	"commission_bps" integer DEFAULT 2000 NOT NULL,
	"commission_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_commission_ledger_policy_key" UNIQUE("policy_id"),
	CONSTRAINT "insurance_commission_ledger_amounts_safe_check" CHECK ("insurance_commission_ledger"."premium_cents" > 0 AND "insurance_commission_ledger"."premium_cents" <= 9007199254740991 AND "insurance_commission_ledger"."commission_cents" >= 0 AND "insurance_commission_ledger"."commission_cents" <= 9007199254740991),
	CONSTRAINT "insurance_commission_ledger_bps_check" CHECK ("insurance_commission_ledger"."commission_bps" = 2000),
	CONSTRAINT "insurance_commission_ledger_math_check" CHECK ("insurance_commission_ledger"."commission_cents" = floor("insurance_commission_ledger"."premium_cents" * "insurance_commission_ledger"."commission_bps" / 10000))
);
--> statement-breakpoint
CREATE TABLE public.insurance_policies (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"insurer" text DEFAULT 'mock' NOT NULL,
	"insurer_quote_id" text,
	"insurer_policy_id" text,
	"risk" "risk_tier" NOT NULL,
	"coverage_cents" bigint NOT NULL,
	"premium_cents" bigint NOT NULL,
	"commission_bps" integer DEFAULT 2000 NOT NULL,
	"status" "insurance_status" DEFAULT 'quoted' NOT NULL,
	"quoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"binding_started_at" timestamp with time zone,
	"bound_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"bind_attempt_id" uuid,
	"bind_attempt_expires_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_policies_id_agent_organization_key" UNIQUE("id","agent_id","organization_id"),
	CONSTRAINT "insurance_policies_agent_organization_version_key" UNIQUE("agent_id","organization_id","version"),
	CONSTRAINT "insurance_policies_version_positive_check" CHECK ("insurance_policies"."version" > 0),
	CONSTRAINT "insurance_policies_insurer_check" CHECK ("insurance_policies"."insurer" = ANY(ARRAY['mock', 'aia', 'zurich']::text[])),
	CONSTRAINT "insurance_policies_amounts_safe_check" CHECK ("insurance_policies"."coverage_cents" > 0 AND "insurance_policies"."coverage_cents" <= 9007199254740991 AND "insurance_policies"."premium_cents" > 0 AND "insurance_policies"."premium_cents" <= 9007199254740991),
	CONSTRAINT "insurance_policies_commission_fixed_check" CHECK ("insurance_policies"."commission_bps" = 2000),
	CONSTRAINT "insurance_policies_quote_state_check" CHECK (("insurance_policies"."status" = 'quoted' AND "insurance_policies"."insurer_quote_id" IS NOT NULL AND "insurance_policies"."insurer_policy_id" IS NULL) OR ("insurance_policies"."status" = 'binding' AND "insurance_policies"."insurer_quote_id" IS NOT NULL AND "insurance_policies"."insurer_policy_id" IS NULL) OR ("insurance_policies"."status" IN ('active', 'lapsed', 'canceled') AND "insurance_policies"."insurer_policy_id" IS NOT NULL)),
	CONSTRAINT "insurance_policies_binding_attempt_check" CHECK (("insurance_policies"."status" = 'binding' AND "insurance_policies"."bind_attempt_id" IS NOT NULL AND "insurance_policies"."bind_attempt_expires_at" IS NOT NULL) OR ("insurance_policies"."status" <> 'binding' AND "insurance_policies"."bind_attempt_id" IS NULL AND "insurance_policies"."bind_attempt_expires_at" IS NULL)),
	CONSTRAINT "insurance_policies_bound_dates_check" CHECK (("insurance_policies"."status" IN ('active', 'lapsed', 'canceled') AND "insurance_policies"."bound_at" IS NOT NULL AND "insurance_policies"."expires_at" IS NOT NULL) OR ("insurance_policies"."status" IN ('quoted', 'binding') AND "insurance_policies"."bound_at" IS NULL AND "insurance_policies"."expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE public.insurance_policy_events (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"insurer" text NOT NULL,
	"provider_event_id" text,
	"event_kind" "insurance_event_kind" NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_digest" "bytea" NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_policy_events_id_policy_organization_key" UNIQUE("id","policy_id","organization_id"),
	CONSTRAINT "insurance_policy_events_provider_id_check" CHECK ("insurance_policy_events"."provider_event_id" IS NULL OR length(btrim("insurance_policy_events"."provider_event_id")) BETWEEN 1 AND 255),
	CONSTRAINT "insurance_policy_events_summary_check" CHECK (length(btrim("insurance_policy_events"."summary")) BETWEEN 1 AND 280),
	CONSTRAINT "insurance_policy_events_payload_digest_check" CHECK (octet_length("insurance_policy_events"."payload_digest") = 32)
);
--> statement-breakpoint
ALTER TABLE "insurance_commission_ledger" ADD CONSTRAINT "insurance_commission_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_commission_ledger" ADD CONSTRAINT "insurance_commission_ledger_policy_agent_organization_fk" FOREIGN KEY ("policy_id","agent_id","organization_id") REFERENCES "public"."insurance_policies"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_creator_organization_fk" FOREIGN KEY ("organization_id","created_by_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_updater_organization_fk" FOREIGN KEY ("organization_id","updated_by_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policy_events" ADD CONSTRAINT "insurance_policy_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policy_events" ADD CONSTRAINT "insurance_policy_events_policy_agent_organization_fk" FOREIGN KEY ("policy_id","agent_id","organization_id") REFERENCES "public"."insurance_policies"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_policies_current_agent_key" ON "insurance_policies" USING btree ("organization_id","agent_id") WHERE "insurance_policies"."status" IN ('quoted', 'binding', 'active');--> statement-breakpoint
CREATE INDEX "insurance_policies_organization_status_idx" ON "insurance_policies" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "insurance_policies_agent_created_idx" ON "insurance_policies" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_provider_event_unique" ON "insurance_policy_events" USING btree ("insurer","provider_event_id") WHERE "insurance_policy_events"."provider_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "insurance_policy_events_policy_created_idx" ON "insurance_policy_events" USING btree ("policy_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_policies_quote_key" ON public.insurance_policies USING btree (organization_id, agent_id, insurer_quote_id) WHERE insurer_quote_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_policies_provider_policy_key" ON public.insurance_policies USING btree (insurer, insurer_policy_id) WHERE insurer_policy_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_policy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_policy_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_commission_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_commission_ledger FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.insurance_policies, public.insurance_policy_events, public.insurance_commission_ledger FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public.insurance_policies TO hermes_app;
GRANT SELECT ON public.insurance_policy_events, public.insurance_commission_ledger TO hermes_app;
GRANT USAGE ON TYPE public.insurance_status, public.insurance_event_kind TO hermes_app;
--> statement-breakpoint
CREATE POLICY insurance_policies_member_select ON public.insurance_policies
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(organization_id, ARRAY['owner','admin','viewer']::public.member_role[])
  OR (agent_id = public.hermes_current_agent_id() AND organization_id = public.hermes_current_agent_organization_id())
);
CREATE POLICY insurance_policies_admin_insert ON public.insurance_policies
FOR INSERT TO hermes_app
WITH CHECK (
  public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[])
  AND created_by_user_id = public.hermes_current_user_id()
);
CREATE POLICY insurance_policies_admin_update ON public.insurance_policies
FOR UPDATE TO hermes_app
USING (public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[]))
WITH CHECK (public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[]));
CREATE POLICY insurance_policy_events_member_select ON public.insurance_policy_events
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(organization_id, ARRAY['owner','admin','viewer']::public.member_role[])
  OR (agent_id = public.hermes_current_agent_id() AND organization_id = public.hermes_current_agent_organization_id())
);
CREATE POLICY insurance_commission_member_select ON public.insurance_commission_ledger
FOR SELECT TO hermes_app
USING (public.hermes_has_org_role(organization_id, ARRAY['owner','admin','viewer']::public.member_role[]));
--> statement-breakpoint
CREATE POLICY insurance_policies_owner_function_select ON public.insurance_policies
FOR SELECT TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_policies'::pg_catalog.regclass)));
CREATE POLICY insurance_policy_events_owner_function_select ON public.insurance_policy_events
FOR SELECT TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_policy_events'::pg_catalog.regclass)));
CREATE POLICY insurance_policies_owner_function_insert ON public.insurance_policies
FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_policies'::pg_catalog.regclass)));
CREATE POLICY insurance_policies_owner_function_update ON public.insurance_policies
FOR UPDATE TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_policies'::pg_catalog.regclass)))
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_policies'::pg_catalog.regclass)));
CREATE POLICY insurance_policy_events_owner_function_insert ON public.insurance_policy_events
FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_policy_events'::pg_catalog.regclass)));
CREATE POLICY insurance_commission_owner_function_insert ON public.insurance_commission_ledger
FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_commission_ledger'::pg_catalog.regclass)));
CREATE POLICY insurance_audit_owner_function_insert ON public.agent_audit_logs
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.agent_audit_logs'::pg_catalog.regclass))
  AND actor_type IN ('human', 'system')
  AND action LIKE 'insurance.%'
);CREATE POLICY insurance_policy_events_worker_insert ON public.insurance_policy_events
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_policy_events'::pg_catalog.regclass))
  AND pg_catalog.current_setting('hermes.insurance_worker', true) = '1'
  AND actor_type = 'system'
  AND actor_id = 'insurance-worker'
);
CREATE POLICY insurance_commission_owner_function_select ON public.insurance_commission_ledger
FOR SELECT TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_commission_ledger'::pg_catalog.regclass)));
CREATE POLICY insurance_commission_worker_insert ON public.insurance_commission_ledger
FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.insurance_commission_ledger'::pg_catalog.regclass)) AND pg_catalog.current_setting('hermes.insurance_worker', true) = '1');
CREATE POLICY insurance_audit_worker_insert ON public.agent_audit_logs
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.agent_audit_logs'::pg_catalog.regclass))
  AND pg_catalog.current_setting('hermes.insurance_worker', true) = '1'
  AND actor_type = 'system'
  AND actor_id = 'insurance-worker'
  AND action LIKE 'insurance.%'
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_set_insurance_worker_claim() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'hermes_app' THEN
    RAISE EXCEPTION 'insurance worker claim denied' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.set_config('hermes.insurance_worker', '1', true);
END
$$;
REVOKE ALL ON FUNCTION public.hermes_set_insurance_worker_claim() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_set_insurance_worker_claim() TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insurance_require_actor(p_organization_id uuid, p_mutation boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('hermes.insurance_worker', true) = '1' THEN
    RETURN;
  END IF;
  IF public.hermes_current_user_id() IS NULL THEN
    RAISE EXCEPTION 'insurance actor required' USING ERRCODE = '42501';
  END IF;
  IF p_mutation THEN
    IF NOT public.hermes_has_org_role(p_organization_id, ARRAY['owner','admin']::public.member_role[]) THEN
      RAISE EXCEPTION 'insurance mutation requires owner or admin' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.hermes_has_org_role(p_organization_id, ARRAY['owner','admin','viewer']::public.member_role[]) THEN
    RAISE EXCEPTION 'insurance organization access denied' USING ERRCODE = '42501';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_insurance_require_actor(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_require_actor(uuid, boolean) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insurance_append_audit(
  p_organization_id uuid,
  p_agent_id uuid,
  p_action text,
  p_summary text,
  p_payload jsonb
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE actor_kind text; actor_value text;
BEGIN
  IF pg_catalog.current_setting('hermes.insurance_worker', true) = '1' THEN
    actor_kind := 'system'; actor_value := 'insurance-worker';
  ELSE
    actor_kind := 'human'; actor_value := public.hermes_current_user_id();
  END IF;
  INSERT INTO public.agent_audit_logs(
    organization_id, agent_id, actor_type, actor_id, action, summary,
    decision, tool, amount_cents, payload, occurred_at, hash
  ) VALUES (
    p_organization_id, p_agent_id, actor_kind, actor_value, p_action,
    left(p_summary, 280), NULL, 'insurance', NULL,
    COALESCE(p_payload, '{}'::jsonb), pg_catalog.clock_timestamp(),
    decode(repeat('00', 32), 'hex')
  );
END
$$;
REVOKE ALL ON FUNCTION public.hermes_insurance_append_audit(uuid, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_append_audit(uuid, uuid, text, text, jsonb) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insurance_agent_context(p_agent_id uuid)
RETURNS TABLE(organization_id uuid, agent_id uuid, did text, risk public.risk_tier, status public.agent_status, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT a.organization_id, a.id, a.did, a.risk, a.status, a.expires_at
  FROM public.agents a
  WHERE a.id = p_agent_id
    AND (pg_catalog.current_setting('hermes.insurance_worker', true) = '1'
      OR public.hermes_has_org_role(a.organization_id, ARRAY['owner','admin','viewer']::public.member_role[]))
$$;
REVOKE ALL ON FUNCTION public.hermes_insurance_agent_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_agent_context(uuid) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insurance_policy_list(p_organization_id uuid, p_cursor timestamptz DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, agent_id uuid, version integer, insurer text, risk public.risk_tier, status public.insurance_status, coverage_cents bigint, premium_cents bigint, commission_bps integer, insurer_quote_id text, insurer_policy_id text, quoted_at timestamptz, bound_at timestamptz, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p.id, p.agent_id, p.version, p.insurer, p.risk, p.status, p.coverage_cents,
    p.premium_cents, p.commission_bps, p.insurer_quote_id, p.insurer_policy_id,
    p.quoted_at, p.bound_at, p.expires_at
  FROM public.insurance_policies p
  WHERE p.organization_id = p_organization_id
    AND (p_cursor IS NULL OR p.created_at < p_cursor)
    AND (public.hermes_has_org_role(p_organization_id, ARRAY['owner','admin','viewer']::public.member_role[])
      OR p.agent_id = public.hermes_current_agent_id())
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
$$;
REVOKE ALL ON FUNCTION public.hermes_insurance_policy_list(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_policy_list(uuid, timestamptz, integer) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insurance_quote_insert(p_payload jsonb)
RETURNS SETOF public.insurance_policies
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  org_id uuid := nullif(p_payload->>'organizationId', '')::uuid;
  agent_id_value uuid := nullif(p_payload->>'agentId', '')::uuid;
  quote_id text := nullif(pg_catalog.btrim(p_payload->>'insurerQuoteId'), '');
  actor_id text := public.hermes_current_user_id();
  agent_row public.agents;
  policy_row public.insurance_policies;
  next_version integer;
BEGIN
  PERFORM public.hermes_insurance_require_actor(org_id, true);
  IF org_id IS NULL OR agent_id_value IS NULL OR quote_id IS NULL THEN
    RAISE EXCEPTION 'insurance quote payload is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hermes.insurance.agent:' || agent_id_value::text, 0));
  SELECT * INTO agent_row FROM public.agents a WHERE a.id = agent_id_value AND a.organization_id = org_id FOR UPDATE;
  IF agent_row.id IS NULL OR agent_row.status <> 'active' OR agent_row.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'insurance agent is inactive' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO policy_row FROM public.insurance_policies p WHERE p.organization_id = org_id AND p.agent_id = agent_id_value AND p.insurer = 'mock' AND p.insurer_quote_id = quote_id LIMIT 1;
  IF policy_row.id IS NOT NULL THEN
    RETURN NEXT policy_row; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.insurance_policies p WHERE p.organization_id = org_id AND p.agent_id = agent_id_value AND p.status IN ('quoted','binding','active')) THEN
    RAISE EXCEPTION 'insurance policy already current' USING ERRCODE = '23505';
  END IF;
  SELECT COALESCE(max(p.version), 0) + 1 INTO next_version FROM public.insurance_policies p WHERE p.organization_id = org_id AND p.agent_id = agent_id_value;
  INSERT INTO public.insurance_policies(
    organization_id, agent_id, version, insurer, insurer_quote_id, risk,
    coverage_cents, premium_cents, commission_bps, status, quoted_at,
    expires_at, created_by_user_id, updated_by_user_id
  ) VALUES (
    org_id, agent_id_value, next_version, 'mock', quote_id,
    agent_row.risk, (p_payload->>'coverageCents')::bigint, (p_payload->>'premiumCents')::bigint,
    2000, 'quoted', COALESCE((p_payload->>'quotedAt')::timestamptz, pg_catalog.clock_timestamp()),
    (p_payload->>'expiresAt')::timestamptz, actor_id, actor_id
  ) RETURNING * INTO policy_row;
  INSERT INTO public.insurance_policy_events(
    organization_id, policy_id, agent_id, insurer, event_kind, actor_type, actor_id,
    summary, payload, payload_digest, effective_at
  ) VALUES (
    org_id, policy_row.id, agent_id_value, 'mock', 'quoted', 'human', actor_id,
    'Insurance quote created', jsonb_build_object('insurerQuoteId', quote_id, 'risk', agent_row.risk::text),
    public.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'), policy_row.quoted_at
  );
  PERFORM public.hermes_insurance_append_audit(org_id, agent_id_value, 'insurance.quote', 'Insurance quote created', jsonb_build_object('policyId', policy_row.id, 'insurerQuoteId', quote_id, 'premiumCents', policy_row.premium_cents));
  RETURN NEXT policy_row;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_insurance_quote_insert(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_quote_insert(jsonb) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insurance_bind_reserve(p_policy_id uuid, p_attempt_id uuid, p_expires_at timestamptz)
RETURNS SETOF public.insurance_policies
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE p public.insurance_policies; now_value timestamptz := pg_catalog.clock_timestamp(); actor_id text := public.hermes_current_user_id();
BEGIN
  SELECT organization_id INTO STRICT p.organization_id FROM public.insurance_policies WHERE id = p_policy_id;
  PERFORM public.hermes_insurance_require_actor(p.organization_id, true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hermes.insurance.agent:' || (SELECT agent_id::text FROM public.insurance_policies WHERE id = p_policy_id), 0));
  SELECT * INTO p FROM public.insurance_policies WHERE id = p_policy_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'insurance policy not found' USING ERRCODE = 'P0002'; END IF;
  IF p.status = 'active' THEN RETURN NEXT p; RETURN; END IF;
  IF p.status = 'binding' AND p.bind_attempt_id = p_attempt_id THEN RETURN NEXT p; RETURN; END IF;
  IF p.status = 'binding' AND p.bind_attempt_expires_at > now_value THEN RAISE EXCEPTION 'insurance bind already in progress' USING ERRCODE = '23505'; END IF;
  IF p.status NOT IN ('quoted','binding') THEN RAISE EXCEPTION 'insurance policy is terminal' USING ERRCODE = '23514'; END IF;
  IF p_expires_at <= now_value OR p_expires_at > now_value + interval '10 minutes' THEN RAISE EXCEPTION 'insurance bind attempt expiry is invalid' USING ERRCODE = '22023'; END IF;
  UPDATE public.insurance_policies SET status='binding', binding_started_at=COALESCE(binding_started_at, now_value), bind_attempt_id=p_attempt_id, bind_attempt_expires_at=p_expires_at, updated_by_user_id=actor_id, updated_at=now_value WHERE id=p.id RETURNING * INTO p;
  INSERT INTO public.insurance_policy_events(organization_id, policy_id, agent_id, insurer, event_kind, actor_type, actor_id, summary, payload, payload_digest, effective_at)
  VALUES (p.organization_id, p.id, p.agent_id, p.insurer, 'bind_started', CASE WHEN pg_catalog.current_setting('hermes.insurance_worker', true)='1' THEN 'system' ELSE 'human' END, COALESCE(actor_id,'insurance-worker'), 'Insurance bind started', jsonb_build_object('attemptId', p_attempt_id), public.digest(pg_catalog.convert_to(p_attempt_id::text, 'UTF8'),'sha256'), now_value);
  PERFORM public.hermes_insurance_append_audit(p.organization_id, p.agent_id, 'insurance.bind_started', 'Insurance bind started', jsonb_build_object('policyId', p.id));
  RETURN NEXT p;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_insurance_bind_reserve(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_bind_reserve(uuid, uuid, timestamptz) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insurance_bind_finalize(p_policy_id uuid, p_attempt_id uuid, p_provider_policy_id text, p_bound_at timestamptz, p_expires_at timestamptz)
RETURNS SETOF public.insurance_policies
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE p public.insurance_policies; actor_id text := public.hermes_current_user_id(); now_value timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT organization_id INTO STRICT p.organization_id FROM public.insurance_policies WHERE id = p_policy_id;
  PERFORM public.hermes_insurance_require_actor(p.organization_id, true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hermes.insurance.agent:' || (SELECT agent_id::text FROM public.insurance_policies WHERE id = p_policy_id), 0));
  SELECT * INTO p FROM public.insurance_policies WHERE id = p_policy_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'insurance policy not found' USING ERRCODE = 'P0002'; END IF;
  IF p.status = 'active' AND p.insurer_policy_id = p_provider_policy_id THEN RETURN NEXT p; RETURN; END IF;
  IF p.status <> 'binding' OR p.bind_attempt_id IS DISTINCT FROM p_attempt_id THEN RAISE EXCEPTION 'insurance bind attempt is stale' USING ERRCODE = 'P0002'; END IF;
  IF p_provider_policy_id IS NULL OR length(pg_catalog.btrim(p_provider_policy_id)) = 0 OR p_bound_at IS NULL OR p_expires_at <= p_bound_at THEN RAISE EXCEPTION 'insurance bind finalization is invalid' USING ERRCODE = '22023'; END IF;
  UPDATE public.insurance_policies SET status='active', insurer_policy_id=pg_catalog.btrim(p_provider_policy_id), bound_at=p_bound_at, expires_at=p_expires_at, bind_attempt_id=NULL, bind_attempt_expires_at=NULL, updated_by_user_id=COALESCE(actor_id,'insurance-worker'), updated_at=now_value WHERE id=p.id RETURNING * INTO p;
  INSERT INTO public.insurance_commission_ledger(organization_id, policy_id, agent_id, premium_cents, commission_bps, commission_cents)
  VALUES (p.organization_id, p.id, p.agent_id, p.premium_cents, 2000, floor(p.premium_cents::numeric * 2000 / 10000)) ON CONFLICT (policy_id) DO NOTHING;
  INSERT INTO public.insurance_policy_events(organization_id, policy_id, agent_id, insurer, event_kind, actor_type, actor_id, summary, payload, payload_digest, effective_at)
  VALUES (p.organization_id, p.id, p.agent_id, p.insurer, 'bound', CASE WHEN pg_catalog.current_setting('hermes.insurance_worker', true)='1' THEN 'system' ELSE 'human' END, COALESCE(actor_id,'insurance-worker'), 'Insurance policy bound', jsonb_build_object('insurerPolicyId', p.insurer_policy_id), public.digest(pg_catalog.convert_to(p.insurer_policy_id,'UTF8'),'sha256'), p_bound_at);
  PERFORM public.hermes_insurance_append_audit(p.organization_id, p.agent_id, 'insurance.bound', 'Insurance policy bound', jsonb_build_object('policyId', p.id, 'insurerPolicyId', p.insurer_policy_id));
  RETURN NEXT p;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_insurance_bind_finalize(uuid, uuid, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_bind_finalize(uuid, uuid, text, timestamptz, timestamptz) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insurance_provider_event(p_payload jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  org_id uuid := nullif(p_payload->>'organizationId','')::uuid;
  provider_event_id_value text := nullif(pg_catalog.btrim(p_payload->>'providerEventId'),'');
  insurer_value text := COALESCE(nullif(pg_catalog.btrim(p_payload->>'insurer'),''),'mock');
  provider_policy_id text := nullif(pg_catalog.btrim(p_payload->>'insurerPolicyId'),'');
  kind public.insurance_event_kind := (p_payload->>'eventKind')::public.insurance_event_kind;
  effective_value timestamptz := COALESCE((p_payload->>'effectiveAt')::timestamptz, pg_catalog.clock_timestamp());
  policy public.insurance_policies;
  agent_id_value uuid;
  new_status public.insurance_status;
  expires_value timestamptz;
BEGIN
  IF pg_catalog.current_setting('hermes.insurance_worker', true) IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'insurance worker claim required' USING ERRCODE='42501'; END IF;
  IF org_id IS NULL OR provider_event_id_value IS NULL OR provider_policy_id IS NULL THEN RAISE EXCEPTION 'insurance provider event is invalid' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.insurance_policy_events e WHERE e.insurer=insurer_value AND e.provider_event_id=provider_event_id_value) THEN RETURN false; END IF;
  SELECT p.agent_id INTO agent_id_value FROM public.insurance_policies p WHERE p.organization_id=org_id AND p.insurer=insurer_value AND p.insurer_policy_id=provider_policy_id LIMIT 1;
  IF agent_id_value IS NULL THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hermes.insurance.agent:' || agent_id_value::text, 0));
  SELECT * INTO policy FROM public.insurance_policies p WHERE p.organization_id=org_id AND p.insurer=insurer_value AND p.insurer_policy_id=provider_policy_id FOR UPDATE;
  IF policy.id IS NULL OR policy.status <> 'active' THEN RETURN false; END IF;
  new_status := CASE kind WHEN 'lapsed' THEN 'lapsed'::public.insurance_status WHEN 'canceled' THEN 'canceled'::public.insurance_status WHEN 'renewed' THEN 'active'::public.insurance_status ELSE NULL END;
  IF new_status IS NULL THEN RAISE EXCEPTION 'insurance provider transition is invalid' USING ERRCODE='22023'; END IF;
  expires_value := COALESCE((p_payload->>'expiresAt')::timestamptz, policy.expires_at);
  UPDATE public.insurance_policies SET status=new_status, expires_at=CASE WHEN new_status='active' THEN expires_value ELSE expires_at END, updated_at=pg_catalog.clock_timestamp() WHERE id=policy.id RETURNING * INTO policy;
  INSERT INTO public.insurance_policy_events(organization_id, policy_id, agent_id, insurer, provider_event_id, event_kind, actor_type, actor_id, summary, payload, payload_digest, effective_at)
  VALUES (org_id, policy.id, policy.agent_id, insurer_value, provider_event_id_value, kind, 'system', 'insurance-worker', 'Insurance provider event applied', jsonb_build_object('providerEventId', provider_event_id_value, 'eventKind', kind::text), public.digest(pg_catalog.convert_to(p_payload::text,'UTF8'),'sha256'), effective_value);
  PERFORM public.hermes_insurance_append_audit(org_id, policy.agent_id, 'insurance.' || kind::text, 'Insurance provider event applied', jsonb_build_object('policyId', policy.id, 'providerEventId', provider_event_id_value));
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_insurance_provider_event(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_provider_event(jsonb) TO hermes_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_insurance_agent_context(uuid), public.hermes_insurance_policy_list(uuid, timestamptz, integer), public.hermes_insurance_quote_insert(jsonb), public.hermes_insurance_bind_reserve(uuid, uuid, timestamptz), public.hermes_insurance_bind_finalize(uuid, uuid, text, timestamptz, timestamptz), public.hermes_insurance_provider_event(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insurance_agent_context(uuid), public.hermes_insurance_policy_list(uuid, timestamptz, integer), public.hermes_insurance_quote_insert(jsonb), public.hermes_insurance_bind_reserve(uuid, uuid, timestamptz), public.hermes_insurance_bind_finalize(uuid, uuid, text, timestamptz, timestamptz), public.hermes_insurance_provider_event(jsonb) TO hermes_app;