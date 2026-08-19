CREATE TYPE "public"."mandate_kind" AS ENUM('intent', 'cart');--> statement-breakpoint
CREATE TYPE "public"."mandate_status" AS ENUM('active', 'consumed', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_authorization_status" AS ENUM('pending', 'approved', 'declined', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."payment_decision" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."wallet_card_status" AS ENUM('provisioning', 'active', 'frozen', 'canceled');--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"kind" "mandate_kind" NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"nonce" text NOT NULL,
	"agent_did" text NOT NULL,
	"key_id" uuid NOT NULL,
	"key_thumbprint" text NOT NULL,
	"body" jsonb NOT NULL,
	"signature" "bytea" NOT NULL,
	"body_digest" "bytea" NOT NULL,
	"currency" text DEFAULT 'HKD' NOT NULL,
	"max_amount_cents" bigint NOT NULL,
	"mcc_allowlist" text[] DEFAULT '{}'::text[] NOT NULL,
	"merchant" text,
	"parent_mandate_id" uuid,
	"status" "mandate_status" DEFAULT 'active' NOT NULL,
	"one_time" boolean DEFAULT false NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mandates_id_agent_organization_key" UNIQUE("id","agent_id","organization_id"),
	CONSTRAINT "mandates_agent_nonce_key" UNIQUE("agent_id","nonce"),
	CONSTRAINT "mandates_version_positive_check" CHECK ("mandates"."version" > 0),
	CONSTRAINT "mandates_nonce_not_blank_check" CHECK (length(btrim("mandates"."nonce")) BETWEEN 1 AND 255),
	CONSTRAINT "mandates_body_version_check" CHECK ("mandates"."body" ->> 'version' = '1'),
	CONSTRAINT "mandates_signature_length_check" CHECK (octet_length("mandates"."signature") = 64),
	CONSTRAINT "mandates_body_digest_length_check" CHECK (octet_length("mandates"."body_digest") = 32),
	CONSTRAINT "mandates_currency_hkd_check" CHECK ("mandates"."currency" = 'HKD'),
	CONSTRAINT "mandates_max_amount_safe_integer_check" CHECK ("mandates"."max_amount_cents" > 0 AND "mandates"."max_amount_cents" <= 9007199254740991),
	CONSTRAINT "mandates_mcc_values_check" CHECK (cardinality("mandates"."mcc_allowlist") = 0
        OR array_to_string("mandates"."mcc_allowlist", ',', '<invalid>') ~ '^[0-9]{4}(,[0-9]{4})*$'),
	CONSTRAINT "mandates_expiry_check" CHECK ("mandates"."expires_at" > "mandates"."issued_at"),
	CONSTRAINT "mandates_status_timestamps_check" CHECK ((
          "mandates"."status" = 'active'
          AND "mandates"."consumed_at" IS NULL
          AND "mandates"."revoked_at" IS NULL
        ) OR (
          "mandates"."status" = 'consumed'
          AND "mandates"."consumed_at" IS NOT NULL
          AND "mandates"."revoked_at" IS NULL
        ) OR (
          "mandates"."status" = 'revoked'
          AND "mandates"."revoked_at" IS NOT NULL
        ) OR (
          "mandates"."status" = 'expired'
          AND "mandates"."consumed_at" IS NULL
        ))
);
--> statement-breakpoint
CREATE TABLE "payment_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"wallet_card_id" uuid NOT NULL,
	"rail" text NOT NULL,
	"event_id" text NOT NULL,
	"rail_authorization_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"merchant_category_code" text,
	"merchant_name" text,
	"mandate_id" uuid,
	"decision" "payment_decision" NOT NULL,
	"status" "payment_authorization_status" NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"policy_version" integer,
	"latency_ms" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "payment_authorizations_rail_event_key" UNIQUE("rail","event_id"),
	CONSTRAINT "payment_authorizations_rail_authorization_key" UNIQUE("rail","rail_authorization_id"),
	CONSTRAINT "payment_authorizations_event_not_blank_check" CHECK (length(btrim("payment_authorizations"."event_id")) BETWEEN 1 AND 255),
	CONSTRAINT "payment_authorizations_authorization_not_blank_check" CHECK (length(btrim("payment_authorizations"."rail_authorization_id")) BETWEEN 1 AND 255),
	CONSTRAINT "payment_authorizations_amount_safe_integer_check" CHECK ("payment_authorizations"."amount_cents" > 0 AND "payment_authorizations"."amount_cents" <= 9007199254740991),
	CONSTRAINT "payment_authorizations_currency_check" CHECK ("payment_authorizations"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_authorizations_mcc_format_check" CHECK ("payment_authorizations"."merchant_category_code" IS NULL OR "payment_authorizations"."merchant_category_code" ~ '^[0-9]{4}$'),
	CONSTRAINT "payment_authorizations_reason_fields_check" CHECK (length(btrim("payment_authorizations"."reason_code")) BETWEEN 1 AND 100
        AND length(btrim("payment_authorizations"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "payment_authorizations_decision_status_check" CHECK (("payment_authorizations"."decision" = 'allow' AND "payment_authorizations"."status" = 'approved')
        OR ("payment_authorizations"."decision" = 'deny' AND "payment_authorizations"."status" IN ('pending', 'declined', 'reversed'))),
	CONSTRAINT "payment_authorizations_latency_nonnegative_check" CHECK ("payment_authorizations"."latency_ms" >= 0),
	CONSTRAINT "payment_authorizations_timing_check" CHECK ("payment_authorizations"."decided_at" >= "payment_authorizations"."received_at"
        AND ("payment_authorizations"."reversed_at" IS NULL OR "payment_authorizations"."reversed_at" >= "payment_authorizations"."decided_at"))
);
--> statement-breakpoint
CREATE TABLE "wallet_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"rail" text NOT NULL,
	"rail_cardholder_id" text NOT NULL,
	"rail_card_id" text NOT NULL,
	"last4" text NOT NULL,
	"brand" text NOT NULL,
	"currency" text NOT NULL,
	"status" "wallet_card_status" DEFAULT 'provisioning' NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"frozen_at" timestamp with time zone,
	CONSTRAINT "wallet_cards_id_agent_organization_key" UNIQUE("id","agent_id","organization_id"),
	CONSTRAINT "wallet_cards_agent_key" UNIQUE("organization_id","agent_id"),
	CONSTRAINT "wallet_cards_rail_card_key" UNIQUE("rail","rail_card_id"),
	CONSTRAINT "wallet_cards_rail_not_blank_check" CHECK (length(btrim("wallet_cards"."rail")) BETWEEN 1 AND 50),
	CONSTRAINT "wallet_cards_cardholder_not_blank_check" CHECK (length(btrim("wallet_cards"."rail_cardholder_id")) BETWEEN 1 AND 255),
	CONSTRAINT "wallet_cards_card_not_blank_check" CHECK (length(btrim("wallet_cards"."rail_card_id")) BETWEEN 1 AND 255),
	CONSTRAINT "wallet_cards_last4_check" CHECK ("wallet_cards"."last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "wallet_cards_currency_check" CHECK ("wallet_cards"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "wallet_cards_policy_version_positive_check" CHECK ("wallet_cards"."policy_version" > 0),
	CONSTRAINT "wallet_cards_frozen_state_check" CHECK (("wallet_cards"."status" = 'frozen' AND "wallet_cards"."frozen_at" IS NOT NULL)
        OR ("wallet_cards"."status" <> 'frozen' AND "wallet_cards"."frozen_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_key_agent_organization_fk" FOREIGN KEY ("key_id","agent_id","organization_id") REFERENCES "public"."agent_keys"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_parent_agent_organization_fk" FOREIGN KEY ("parent_mandate_id","agent_id","organization_id") REFERENCES "public"."mandates"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_card_agent_organization_fk" FOREIGN KEY ("wallet_card_id","agent_id","organization_id") REFERENCES "public"."wallet_cards"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_mandate_agent_organization_fk" FOREIGN KEY ("mandate_id","agent_id","organization_id") REFERENCES "public"."mandates"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_policy_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id","policy_version") REFERENCES "public"."agent_policies"("agent_id","organization_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_cards" ADD CONSTRAINT "wallet_cards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_cards" ADD CONSTRAINT "wallet_cards_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_cards" ADD CONSTRAINT "wallet_cards_policy_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id","policy_version") REFERENCES "public"."agent_policies"("agent_id","organization_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mandates_active_agent_idx" ON "mandates" USING btree ("organization_id","agent_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_authorizations_spend_idx" ON "payment_authorizations" USING btree ("organization_id","agent_id","decided_at");--> statement-breakpoint
CREATE INDEX "wallet_cards_agent_status_idx" ON "wallet_cards" USING btree ("organization_id","agent_id","status");

--> statement-breakpoint
REVOKE ALL ON public.mandates, public.wallet_cards, public.payment_authorizations FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON TYPE public.mandate_kind, public.mandate_status, public.wallet_card_status,
  public.payment_decision, public.payment_authorization_status TO hermes_app;
GRANT SELECT ON public.mandates, public.wallet_cards, public.payment_authorizations TO hermes_app;
GRANT INSERT, UPDATE ON public.mandates, public.wallet_cards TO hermes_app;
--> statement-breakpoint
ALTER TABLE "mandates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mandates" FORCE ROW LEVEL SECURITY;
ALTER TABLE "wallet_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_cards" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payment_authorizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_authorizations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY mandates_owner_function_all ON public.mandates
FOR ALL TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((
  SELECT relation.relowner FROM pg_catalog.pg_class relation
  WHERE relation.oid = 'public.mandates'::pg_catalog.regclass
)))
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((
  SELECT relation.relowner FROM pg_catalog.pg_class relation
  WHERE relation.oid = 'public.mandates'::pg_catalog.regclass
)));
CREATE POLICY wallet_cards_owner_function_all ON public.wallet_cards
FOR ALL TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((
  SELECT relation.relowner FROM pg_catalog.pg_class relation
  WHERE relation.oid = 'public.wallet_cards'::pg_catalog.regclass
)))
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((
  SELECT relation.relowner FROM pg_catalog.pg_class relation
  WHERE relation.oid = 'public.wallet_cards'::pg_catalog.regclass
)));
CREATE POLICY payment_authorizations_owner_function_all ON public.payment_authorizations
FOR ALL TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((
  SELECT relation.relowner FROM pg_catalog.pg_class relation
  WHERE relation.oid = 'public.payment_authorizations'::pg_catalog.regclass
)))
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((
  SELECT relation.relowner FROM pg_catalog.pg_class relation
  WHERE relation.oid = 'public.payment_authorizations'::pg_catalog.regclass
)));
--> statement-breakpoint
CREATE POLICY mandates_member_select ON public.mandates
FOR SELECT TO hermes_app
USING (public.hermes_has_org_role(organization_id, ARRAY['owner','admin','viewer']::public.member_role[]));
CREATE POLICY mandates_member_insert ON public.mandates
FOR INSERT TO hermes_app
WITH CHECK (public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[])
);
CREATE POLICY mandates_member_update ON public.mandates
FOR UPDATE TO hermes_app
USING (public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[]))
WITH CHECK (public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[]));
CREATE POLICY wallet_cards_member_select ON public.wallet_cards
FOR SELECT TO hermes_app
USING (public.hermes_has_org_role(organization_id, ARRAY['owner','admin','viewer']::public.member_role[]));
CREATE POLICY wallet_cards_member_insert ON public.wallet_cards
FOR INSERT TO hermes_app
WITH CHECK (public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[]));
CREATE POLICY wallet_cards_member_update ON public.wallet_cards
FOR UPDATE TO hermes_app
USING (public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[]))
WITH CHECK (public.hermes_has_org_role(organization_id, ARRAY['owner','admin']::public.member_role[]));
CREATE POLICY payment_authorizations_member_select ON public.payment_authorizations
FOR SELECT TO hermes_app
USING (public.hermes_has_org_role(organization_id, ARRAY['owner','admin','viewer']::public.member_role[]));
--> statement-breakpoint
CREATE FUNCTION public.hermes_payment_identity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment identity rows are append-only' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
    NEW.agent_id IS DISTINCT FROM OLD.agent_id OR
    (TG_TABLE_NAME = 'mandates' AND ((to_jsonb(NEW)->>'key_id') IS DISTINCT FROM (to_jsonb(OLD)->>'key_id') OR (to_jsonb(NEW)->>'nonce') IS DISTINCT FROM (to_jsonb(OLD)->>'nonce'))) OR
    (TG_TABLE_NAME = 'wallet_cards' AND ((to_jsonb(NEW)->>'rail') IS DISTINCT FROM (to_jsonb(OLD)->>'rail') OR (to_jsonb(NEW)->>'rail_card_id') IS DISTINCT FROM (to_jsonb(OLD)->>'rail_card_id'))) OR
    (TG_TABLE_NAME = 'payment_authorizations' AND ((to_jsonb(NEW)->>'rail') IS DISTINCT FROM (to_jsonb(OLD)->>'rail') OR (to_jsonb(NEW)->>'event_id') IS DISTINCT FROM (to_jsonb(OLD)->>'event_id') OR (to_jsonb(NEW)->>'rail_authorization_id') IS DISTINCT FROM (to_jsonb(OLD)->>'rail_authorization_id')))
  ) THEN
    RAISE EXCEPTION 'payment identity fields are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_payment_identity_guard() FROM PUBLIC;
CREATE TRIGGER mandates_identity_guard BEFORE UPDATE OR DELETE ON public.mandates
FOR EACH ROW EXECUTE FUNCTION public.hermes_payment_identity_guard();
CREATE TRIGGER wallet_cards_identity_guard BEFORE UPDATE OR DELETE ON public.wallet_cards
FOR EACH ROW EXECUTE FUNCTION public.hermes_payment_identity_guard();
CREATE TRIGGER payment_authorizations_identity_guard BEFORE UPDATE OR DELETE ON public.payment_authorizations
FOR EACH ROW EXECUTE FUNCTION public.hermes_payment_identity_guard();
--> statement-breakpoint
CREATE FUNCTION public.hermes_payment_spend_totals(
  p_agent_id uuid,
  p_organization_id uuid,
  p_day_start timestamptz,
  p_month_start timestamptz
) RETURNS TABLE(spent_today_cents bigint, spent_month_cents bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    COALESCE((SELECT sum(pa.amount_cents) FROM public.payment_authorizations pa
      WHERE pa.agent_id = p_agent_id AND pa.organization_id = p_organization_id
        AND pa.decision = 'allow' AND pa.status = 'approved' AND pa.decided_at >= p_day_start), 0)::bigint
    + COALESCE((SELECT sum(gr.amount_cents) FROM public.gateway_requests gr
      WHERE gr.agent_id = p_agent_id AND gr.organization_id = p_organization_id
        AND gr.current_decision = 'allow' AND gr.amount_cents IS NOT NULL
        AND gr.authorized_at IS NOT NULL AND gr.authorized_at >= p_day_start), 0)::bigint,
    COALESCE((SELECT sum(pa.amount_cents) FROM public.payment_authorizations pa
      WHERE pa.agent_id = p_agent_id AND pa.organization_id = p_organization_id
        AND pa.decision = 'allow' AND pa.status = 'approved' AND pa.decided_at >= p_month_start), 0)::bigint
    + COALESCE((SELECT sum(gr.amount_cents) FROM public.gateway_requests gr
      WHERE gr.agent_id = p_agent_id AND gr.organization_id = p_organization_id
        AND gr.current_decision = 'allow' AND gr.amount_cents IS NOT NULL
        AND gr.authorized_at IS NOT NULL AND gr.authorized_at >= p_month_start), 0)::bigint
$$;
REVOKE ALL ON FUNCTION public.hermes_payment_spend_totals(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_payment_spend_totals(uuid, uuid, timestamptz, timestamptz) TO hermes_app;
--> statement-breakpoint

-- PAYMENT scoped idempotency contracts: UNIQUE("agent_id", "nonce") and UNIQUE("rail", "rail_authorization_id")
--> statement-breakpoint
CREATE FUNCTION public.hermes_record_payment_authorization(p_payload jsonb)
RETURNS SETOF public.payment_authorizations
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  org_id uuid := nullif(p_payload->>'organizationId', '')::uuid;
  agent_id_value uuid := nullif(p_payload->>'agentId', '')::uuid;
  card_id uuid := nullif(p_payload->>'walletCardId', '')::uuid;
  mandate_id_value uuid := nullif(p_payload->>'mandateId', '')::uuid;
  amount_value bigint := (p_payload->>'amountCents')::bigint;
  policy_version_value integer := nullif(p_payload->>'policyVersion', '')::integer;
  received_value timestamptz := (p_payload->>'receivedAt')::timestamptz;
  decided_value timestamptz := (p_payload->>'decidedAt')::timestamptz;
  existing public.payment_authorizations;
BEGIN
  IF org_id IS NULL OR agent_id_value IS NULL OR card_id IS NULL
     OR NOT public.hermes_has_org_role(org_id, ARRAY['owner','admin']::public.member_role[])
     AND public.hermes_current_agent_id() IS DISTINCT FROM agent_id_value THEN
    RAISE EXCEPTION 'payment authorization actor denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  INSERT INTO public.payment_authorizations (
    organization_id, agent_id, wallet_card_id, rail, event_id,
    rail_authorization_id, amount_cents, currency, merchant_category_code,
    merchant_name, mandate_id, decision, status, reason_code, reason,
    policy_version, latency_ms, received_at, decided_at, reversed_at
  ) VALUES (
    org_id, agent_id_value, card_id, p_payload->>'rail', p_payload->>'eventId',
    p_payload->>'railAuthorizationId', amount_value, p_payload->>'currency',
    nullif(p_payload->>'merchantCategoryCode', ''), nullif(p_payload->>'merchantName', ''),
    mandate_id_value, (p_payload->>'decision')::public.payment_decision,
    (p_payload->>'status')::public.payment_authorization_status,
    p_payload->>'reasonCode', p_payload->>'reason', policy_version_value,
    (p_payload->>'latencyMs')::integer, received_value, decided_value,
    nullif(p_payload->>'reversedAt', '')::timestamptz
  )
  ON CONFLICT (rail, event_id) DO UPDATE
    SET event_id = EXCLUDED.event_id
  RETURNING *;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_record_payment_authorization(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_record_payment_authorization(jsonb) TO hermes_app;
--> statement-breakpoint
