CREATE TYPE "public"."invite_role" AS ENUM('admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."organization_tier" AS ENUM('pilot', 'starter', 'growth', 'scale');--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"direction" "message_direction" DEFAULT 'inbound' NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text,
	"body_text" text,
	"provider_message_id" text,
	"payload_digest" "bytea" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_messages_from_check" CHECK (length(btrim("agent_messages"."from_address")) BETWEEN 3 AND 320 AND "agent_messages"."from_address" !~ '[[:cntrl:]]'),
	CONSTRAINT "agent_messages_to_check" CHECK ("agent_messages"."to_address" ~ '^[a-z0-9][a-z0-9-]{1,62}@agents\.hermespass\.asia$'),
	CONSTRAINT "agent_messages_subject_check" CHECK ("agent_messages"."subject" IS NULL OR (length("agent_messages"."subject") <= 280 AND "agent_messages"."subject" !~ '[[:cntrl:]]')),
	CONSTRAINT "agent_messages_body_check" CHECK ("agent_messages"."body_text" IS NULL OR octet_length("agent_messages"."body_text") <= 16384),
	CONSTRAINT "agent_messages_digest_check" CHECK (octet_length("agent_messages"."payload_digest") = 32)
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_key" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_id_organization_key" UNIQUE("id","organization_id"),
	CONSTRAINT "api_keys_name_check" CHECK (length(btrim("api_keys"."name")) BETWEEN 2 AND 120 AND "api_keys"."name" !~ '[[:cntrl:]]'),
	CONSTRAINT "api_keys_prefix_check" CHECK (length("api_keys"."prefix") = 12),
	CONSTRAINT "api_keys_hash_check" CHECK ("api_keys"."key_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"api_key_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"request_id" text NOT NULL,
	"status" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_usage_endpoint_check" CHECK (length(btrim("api_usage"."endpoint")) BETWEEN 1 AND 120),
	CONSTRAINT "api_usage_request_id_check" CHECK (length(btrim("api_usage"."request_id")) BETWEEN 1 AND 120),
	CONSTRAINT "api_usage_status_check" CHECK ("api_usage"."status" BETWEEN 100 AND 599)
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_digest" "bytea" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_events_provider_event_key" UNIQUE("provider_event_id"),
	CONSTRAINT "billing_events_provider_event_check" CHECK (length(btrim("billing_events"."provider_event_id")) BETWEEN 1 AND 255),
	CONSTRAINT "billing_events_customer_check" CHECK (length(btrim("billing_events"."customer_id")) BETWEEN 1 AND 255),
	CONSTRAINT "billing_events_digest_check" CHECK (octet_length("billing_events"."payload_digest") = 32)
);
--> statement-breakpoint
CREATE TABLE "org_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "invite_role" DEFAULT 'viewer' NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_invites_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "org_invites_email_check" CHECK ("org_invites"."email" ~ '^[^[:cntrl:]@[:space:]]+@[^[:cntrl:]@[:space:]]+\.[^[:cntrl:]@[:space:]]+$'),
	CONSTRAINT "org_invites_token_hash_length_check" CHECK (octet_length("org_invites"."token_hash") = 32),
	CONSTRAINT "org_invites_expiry_check" CHECK ("org_invites"."expires_at" > "org_invites"."created_at" AND "org_invites"."expires_at" <= "org_invites"."created_at" + interval '15 minutes'),
	CONSTRAINT "org_invites_acceptance_check" CHECK ("org_invites"."accepted_at" IS NULL OR "org_invites"."accepted_at" >= "org_invites"."created_at")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "tier" "organization_tier" DEFAULT 'pilot' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_creator_organization_fk" FOREIGN KEY ("organization_id","created_by_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_key_organization_fk" FOREIGN KEY ("api_key_id","organization_id") REFERENCES "public"."api_keys"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_inviter_organization_fk" FOREIGN KEY ("organization_id","invited_by_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_agent_received_idx" ON "agent_messages" USING btree ("agent_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_messages_provider_id_key" ON "agent_messages" USING btree ("organization_id","provider_message_id") WHERE "agent_messages"."provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "api_usage_key_time_idx" ON "api_usage" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_events_organization_received_idx" ON "billing_events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_invites_live_email_key" ON "org_invites" USING btree ("organization_id","email") WHERE "org_invites"."accepted_at" IS NULL;--> statement-breakpoint
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage FORCE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO hermes_app;
GRANT SELECT ON public.org_invites, public.api_keys, public.api_usage, public.billing_events, public.agent_messages TO hermes_app;
GRANT INSERT, UPDATE ON public.org_invites, public.api_keys TO hermes_app;
GRANT USAGE, SELECT ON SEQUENCE public.api_usage_id_seq TO hermes_app;
--> statement-breakpoint
CREATE POLICY productization_org_owner_insert ON public.organizations FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.organizations'::pg_catalog.regclass)));
CREATE POLICY productization_member_owner_insert ON public.org_members FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.org_members'::pg_catalog.regclass)));
--> statement-breakpoint
CREATE POLICY org_invites_owner_function_select ON public.org_invites FOR SELECT TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.org_invites'::pg_catalog.regclass)));
CREATE POLICY org_invites_owner_function_insert ON public.org_invites FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.org_invites'::pg_catalog.regclass)));
CREATE POLICY org_invites_owner_function_update ON public.org_invites FOR UPDATE TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.org_invites'::pg_catalog.regclass)))
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.org_invites'::pg_catalog.regclass)));
CREATE POLICY org_invites_member_select ON public.org_invites FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.organization_id = org_invites.organization_id AND m.user_id = public.hermes_current_user_id() AND m.role IN ('owner','admin')));
CREATE POLICY org_invites_admin_insert ON public.org_invites FOR INSERT TO hermes_app
WITH CHECK (EXISTS (SELECT 1 FROM public.org_members m WHERE m.organization_id = org_invites.organization_id AND m.user_id = public.hermes_current_user_id() AND m.role IN ('owner','admin')));
--> statement-breakpoint
CREATE POLICY api_keys_owner_function_select ON public.api_keys FOR SELECT TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.api_keys'::pg_catalog.regclass)));
CREATE POLICY api_keys_owner_function_insert ON public.api_keys FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.api_keys'::pg_catalog.regclass)));
CREATE POLICY api_keys_owner_function_update ON public.api_keys FOR UPDATE TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.api_keys'::pg_catalog.regclass)))
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.api_keys'::pg_catalog.regclass)));
CREATE POLICY api_keys_member_select ON public.api_keys FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.organization_id = api_keys.organization_id AND m.user_id = public.hermes_current_user_id() AND m.role IN ('owner','admin')));
CREATE POLICY api_keys_admin_insert ON public.api_keys FOR INSERT TO hermes_app
WITH CHECK (EXISTS (SELECT 1 FROM public.org_members m WHERE m.organization_id = api_keys.organization_id AND m.user_id = public.hermes_current_user_id() AND m.role IN ('owner','admin')));
--> statement-breakpoint
CREATE POLICY api_usage_owner_function_select ON public.api_usage FOR SELECT TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.api_usage'::pg_catalog.regclass)));
CREATE POLICY api_usage_owner_function_insert ON public.api_usage FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.api_usage'::pg_catalog.regclass)));
CREATE POLICY api_usage_member_select ON public.api_usage FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.organization_id = api_usage.organization_id AND m.user_id = public.hermes_current_user_id() AND m.role IN ('owner','admin')));
--> statement-breakpoint
CREATE POLICY billing_events_owner_function_select ON public.billing_events FOR SELECT TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.billing_events'::pg_catalog.regclass)));
CREATE POLICY billing_events_owner_function_insert ON public.billing_events FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.billing_events'::pg_catalog.regclass)));
CREATE POLICY billing_events_member_select ON public.billing_events FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.organization_id = billing_events.organization_id AND m.user_id = public.hermes_current_user_id() AND m.role IN ('owner','admin')));
--> statement-breakpoint
CREATE POLICY agent_messages_owner_function_select ON public.agent_messages FOR SELECT TO PUBLIC
USING (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.agent_messages'::pg_catalog.regclass)));
CREATE POLICY agent_messages_owner_function_insert ON public.agent_messages FOR INSERT TO PUBLIC
WITH CHECK (current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.agent_messages'::pg_catalog.regclass)));
CREATE POLICY agent_messages_member_select ON public.agent_messages FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.organization_id = agent_messages.organization_id AND m.user_id = public.hermes_current_user_id()));
--> statement-breakpoint
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_tier_agent_limit(p_tier text) RETURNS integer
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT CASE p_tier WHEN 'pilot' THEN 3 WHEN 'starter' THEN 5 WHEN 'growth' THEN 25 WHEN 'scale' THEN 100 ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.hermes_tier_agent_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_tier_agent_limit(text) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_set_productization_claim(p_actor text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'hermes_app' OR p_actor NOT IN ('system:report','system:billing','system:comms') THEN
    RAISE EXCEPTION 'productization worker claim denied' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.set_config('hermes.productization_actor', p_actor, true);
END
$$;
REVOKE ALL ON FUNCTION public.hermes_set_productization_claim(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_set_productization_claim(text) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_productization_append_audit(
  p_organization_id uuid, p_agent_id uuid, p_actor_type text, p_actor_id text,
  p_action text, p_summary text, p_payload jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_actor_type = 'system' THEN
    IF pg_catalog.current_setting('hermes.productization_actor', true) IS DISTINCT FROM p_actor_id THEN
      RAISE EXCEPTION 'productization audit claim denied' USING ERRCODE = '42501';
    END IF;
  ELSIF p_actor_type = 'human' THEN
    IF p_actor_id IS DISTINCT FROM public.hermes_current_user_id() THEN
      RAISE EXCEPTION 'productization audit actor denied' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'productization audit actor invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agent_audit_logs(organization_id, agent_id, actor_type, actor_id, action, summary, decision, tool, amount_cents, payload, occurred_at, hash)
  VALUES (p_organization_id, p_agent_id, p_actor_type, p_actor_id, p_action, left(p_summary, 280), NULL, NULL, NULL, coalesce(p_payload, '{}'::jsonb), pg_catalog.clock_timestamp(), decode(repeat('00', 32), 'hex'));
END
$$;
REVOKE ALL ON FUNCTION public.hermes_productization_append_audit(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_productization_append_audit(uuid, uuid, text, text, text, text, jsonb) TO hermes_app;
--> statement-breakpoint
CREATE POLICY audit_productization_owner_insert ON public.agent_audit_logs FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'public.agent_audit_logs'::pg_catalog.regclass))
  AND (pg_catalog.current_setting('hermes.productization_actor', true) IS NOT NULL OR public.hermes_current_user_id() IS NOT NULL)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_create_organization(p_name text, p_slug text, p_user_id text, p_email text, p_name_snapshot text)
RETURNS TABLE(id uuid, slug text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE new_id uuid;
BEGIN
  IF p_user_id IS DISTINCT FROM public.hermes_current_user_id() THEN
    RAISE EXCEPTION 'organization actor denied' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_members WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'ORGANIZATION_MEMBERSHIP_EXISTS' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.organizations(name, slug, tier) VALUES (btrim(p_name), lower(p_slug), 'pilot') RETURNING organizations.id INTO new_id;
  INSERT INTO public.org_members(organization_id, user_id, role, email_snapshot, name_snapshot) VALUES (new_id, p_user_id, 'owner', nullif(lower(btrim(p_email)), ''), nullif(btrim(p_name_snapshot), ''));
  PERFORM public.hermes_productization_append_audit(new_id, NULL, 'human', p_user_id, 'organization.created', 'Organization created', jsonb_build_object('slug', lower(p_slug)));
  RETURN QUERY SELECT new_id, lower(p_slug);
END
$$;
REVOKE ALL ON FUNCTION public.hermes_create_organization(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_create_organization(text, text, text, text, text) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_consume_api_key(p_key_hash text, p_endpoint text, p_request_id text, p_status integer)
RETURNS TABLE(api_key_id uuid, organization_id uuid, allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE k public.api_keys; used_count integer; now_value timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE key_hash = p_key_hash FOR UPDATE;
  IF NOT FOUND OR k.revoked_at IS NOT NULL THEN RETURN QUERY SELECT NULL::uuid, NULL::uuid, false, 0; RETURN; END IF;
  SELECT count(*)::integer INTO used_count FROM public.api_usage u WHERE u.api_key_id = k.id AND u.created_at >= now_value - interval '1 minute';
  IF used_count >= 60 THEN RETURN QUERY SELECT k.id, k.organization_id, false, 60; RETURN; END IF;
  INSERT INTO public.api_usage(api_key_id, organization_id, endpoint, request_id, status, created_at) VALUES (k.id, k.organization_id, left(p_endpoint, 120), left(p_request_id, 120), p_status, now_value);
  UPDATE public.api_keys SET last_used_at = now_value WHERE id = k.id;
  RETURN QUERY SELECT k.id, k.organization_id, true, 0;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_consume_api_key(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_consume_api_key(text, text, text, integer) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_accept_org_invite(p_token_hash bytea, p_user_id text, p_email text)
RETURNS TABLE(organization_id uuid, role public.invite_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE invite_row public.org_invites; role_value public.invite_role;
BEGIN
  IF p_user_id IS DISTINCT FROM public.hermes_current_user_id() THEN RAISE EXCEPTION 'invite actor denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO invite_row FROM public.org_invites WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR invite_row.accepted_at IS NOT NULL OR invite_row.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'INVITE_INVALID' USING ERRCODE = 'P0002'; END IF;
  IF invite_row.email IS DISTINCT FROM lower(btrim(p_email)) THEN RAISE EXCEPTION 'INVITE_EMAIL_MISMATCH' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.org_members WHERE user_id = p_user_id) THEN RAISE EXCEPTION 'ORGANIZATION_MEMBERSHIP_EXISTS' USING ERRCODE = '23505'; END IF;
  INSERT INTO public.org_members(organization_id, user_id, role, email_snapshot) VALUES (invite_row.organization_id, p_user_id, invite_row.role::text::public.member_role, invite_row.email);
  UPDATE public.org_invites SET accepted_at = pg_catalog.clock_timestamp() WHERE id = invite_row.id;
  PERFORM public.hermes_productization_append_audit(invite_row.organization_id, NULL, 'human', p_user_id, 'organization.invite.accepted', 'Organization invite accepted', jsonb_build_object('inviteId', invite_row.id));
  RETURN QUERY SELECT invite_row.organization_id, invite_row.role;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_accept_org_invite(bytea, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_accept_org_invite(bytea, text, text) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_insert_agent_message(p_organization_id uuid, p_agent_id uuid, p_from text, p_to text, p_subject text, p_body text, p_provider_id text, p_digest bytea)
RETURNS TABLE(id uuid, agent_id uuid, inserted boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE message_id uuid; was_inserted boolean := true;
BEGIN
  IF pg_catalog.current_setting('hermes.productization_actor', true) IS DISTINCT FROM 'system:comms' THEN RAISE EXCEPTION 'communications claim denied' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.id = p_agent_id AND a.organization_id = p_organization_id) THEN RAISE EXCEPTION 'AGENT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.agent_messages(organization_id, agent_id, direction, from_address, to_address, subject, body_text, provider_message_id, payload_digest)
  VALUES (p_organization_id, p_agent_id, 'inbound', left(p_from, 320), left(p_to, 320), nullif(left(p_subject, 280), ''), left(p_body, 16384), nullif(left(p_provider_id, 255), ''), p_digest)
  ON CONFLICT (organization_id, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
  RETURNING agent_messages.id INTO message_id;
  IF message_id IS NULL THEN
    was_inserted := false;
    SELECT m.id INTO message_id FROM public.agent_messages m WHERE m.organization_id = p_organization_id AND m.provider_message_id = p_provider_id;
  ELSE
    PERFORM public.hermes_productization_append_audit(p_organization_id, p_agent_id, 'system', 'system:comms', 'email.receive', 'Inbound agent message received', jsonb_build_object('messageId', message_id, 'providerMessageId', p_provider_id));
  END IF;
  RETURN QUERY SELECT message_id, p_agent_id, was_inserted;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_insert_agent_message(uuid, uuid, text, text, text, text, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_insert_agent_message(uuid, uuid, text, text, text, text, text, bytea) TO hermes_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.hermes_record_billing_event(p_organization_id uuid, p_provider_event_id text, p_customer_id text, p_event_type text, p_digest bytea)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE inserted boolean := false;
BEGIN
  IF pg_catalog.current_setting('hermes.productization_actor', true) IS DISTINCT FROM 'system:billing' THEN RAISE EXCEPTION 'billing claim denied' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.billing_events(organization_id, provider_event_id, customer_id, event_type, payload_digest)
  VALUES (p_organization_id, left(p_provider_event_id, 255), left(p_customer_id, 255), left(p_event_type, 255), p_digest)
  ON CONFLICT (provider_event_id) DO NOTHING;
  inserted := FOUND;
  IF inserted THEN
    PERFORM public.hermes_productization_append_audit(p_organization_id, NULL, 'system', 'system:billing', 'billing.subscription.updated', 'Billing subscription event received', jsonb_build_object('providerEventId', p_provider_event_id, 'eventType', p_event_type));
  END IF;
  RETURN inserted;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_record_billing_event(uuid, text, text, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_record_billing_event(uuid, text, text, text, bytea) TO hermes_app;