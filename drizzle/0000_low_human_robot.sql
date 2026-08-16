CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."key_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."risk_tier" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "agent_audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_position" bigint DEFAULT 0 NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"decision" text,
	"tool" text,
	"amount_cents" bigint,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" bytea,
	"hash" bytea NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"key_fragment" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"thumbprint" text NOT NULL,
	"ciphertext" bytea NOT NULL,
	"iv" bytea NOT NULL,
	"wrapped_dek" bytea NOT NULL,
	"kek_version" text NOT NULL,
	"encryption_algorithm" text NOT NULL,
	"status" "key_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"did" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"risk" "risk_tier" NOT NULL,
	"scopes" text[] NOT NULL,
	"spend_cap_cents" bigint DEFAULT 0 NOT NULL,
	"governance_notes" text,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"credential_id" text NOT NULL,
	"credential_jws" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issuer_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"did" text NOT NULL,
	"key_fragment" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"thumbprint" text NOT NULL,
	"ciphertext" bytea NOT NULL,
	"iv" bytea NOT NULL,
	"wrapped_dek" bytea NOT NULL,
	"kek_version" text NOT NULL,
	"encryption_algorithm" text NOT NULL,
	"status" "key_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_audit_logs_organization_id_id_idx" ON "agent_audit_logs" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_audit_logs_organization_chain_position_key" ON "agent_audit_logs" USING btree ("organization_id","chain_position");--> statement-breakpoint
CREATE INDEX "agent_audit_logs_agent_id_idx" ON "agent_audit_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_agent_fragment_key" ON "agent_keys" USING btree ("agent_id","key_fragment");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_keys_active_agent_key" ON "agent_keys" USING btree ("agent_id") WHERE "agent_keys"."status" = 'active';--> statement-breakpoint
CREATE INDEX "agent_keys_organization_id_idx" ON "agent_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_slug_key" ON "agents" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_did_key" ON "agents" USING btree ("did");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_credential_id_key" ON "agents" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "agents_organization_id_idx" ON "agents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "issuer_keys_did_key_fragment_key" ON "issuer_keys" USING btree ("did","key_fragment");--> statement-breakpoint
CREATE UNIQUE INDEX "issuer_keys_active_did_key" ON "issuer_keys" USING btree ("did") WHERE "issuer_keys"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_user_id_key" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_members_organization_id_idx" ON "org_members" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree ("slug");--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_app') THEN
    CREATE ROLE hermes_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END
$$;--> statement-breakpoint

ALTER ROLE hermes_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM hermes_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO hermes_app;--> statement-breakpoint
GRANT SELECT ON organizations, org_members, agents, agent_keys, issuer_keys, agent_audit_logs TO hermes_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON agents TO hermes_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON agent_keys, agent_audit_logs TO hermes_app;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE agent_audit_logs_id_seq TO hermes_app;--> statement-breakpoint

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE org_members FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE issuer_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE issuer_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_audit_logs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agent_audit_logs FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE FUNCTION hermes_current_user_id() RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$ SELECT nullif(current_setting('hermes.user_id', true), '') $$;--> statement-breakpoint

CREATE POLICY organizations_member_select ON organizations FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = organizations.id AND m.user_id = hermes_current_user_id()));--> statement-breakpoint
CREATE POLICY org_members_self_select ON org_members FOR SELECT TO hermes_app
USING (user_id = hermes_current_user_id());--> statement-breakpoint

CREATE POLICY issuer_keys_authenticated_select ON issuer_keys FOR SELECT TO hermes_app
USING (hermes_current_user_id() IS NOT NULL);--> statement-breakpoint
CREATE POLICY agents_member_select ON agents FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agents.organization_id AND m.user_id = hermes_current_user_id()));--> statement-breakpoint
CREATE POLICY agents_admin_insert ON agents FOR INSERT TO hermes_app
WITH CHECK (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agents.organization_id AND m.user_id = hermes_current_user_id() AND m.role IN ('owner', 'admin')));--> statement-breakpoint
CREATE POLICY agents_admin_update ON agents FOR UPDATE TO hermes_app
USING (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agents.organization_id AND m.user_id = hermes_current_user_id() AND m.role IN ('owner', 'admin')))
WITH CHECK (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agents.organization_id AND m.user_id = hermes_current_user_id() AND m.role IN ('owner', 'admin')));--> statement-breakpoint

CREATE POLICY agent_keys_member_select ON agent_keys FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agent_keys.organization_id AND m.user_id = hermes_current_user_id()));--> statement-breakpoint
CREATE POLICY agent_keys_admin_insert ON agent_keys FOR INSERT TO hermes_app
WITH CHECK (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agent_keys.organization_id AND m.user_id = hermes_current_user_id() AND m.role IN ('owner', 'admin')));--> statement-breakpoint
CREATE POLICY agent_keys_admin_update ON agent_keys FOR UPDATE TO hermes_app
USING (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agent_keys.organization_id AND m.user_id = hermes_current_user_id() AND m.role IN ('owner', 'admin')))
WITH CHECK (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agent_keys.organization_id AND m.user_id = hermes_current_user_id() AND m.role IN ('owner', 'admin')));--> statement-breakpoint

CREATE POLICY audit_member_select ON agent_audit_logs FOR SELECT TO hermes_app
USING (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agent_audit_logs.organization_id AND m.user_id = hermes_current_user_id()));--> statement-breakpoint
CREATE POLICY audit_admin_insert ON agent_audit_logs FOR INSERT TO hermes_app
WITH CHECK (EXISTS (SELECT 1 FROM org_members m WHERE m.organization_id = agent_audit_logs.organization_id AND m.user_id = hermes_current_user_id() AND m.role IN ('owner', 'admin')));--> statement-breakpoint

ALTER TABLE agents ADD CONSTRAINT agents_spend_cap_nonnegative CHECK (spend_cap_cents >= 0);--> statement-breakpoint
ALTER TABLE agents ADD CONSTRAINT agents_scopes_allowed CHECK (scopes <@ ARRAY['catalog.read', 'crm.read', 'refund.issue', 'email.dispatch', 'checkout.external', 'invoice.approve', 'ads.bid', 'vendor.contract']::text[]);--> statement-breakpoint
ALTER TABLE agents ADD CONSTRAINT agents_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE agents ADD CONSTRAINT agents_role_not_blank CHECK (length(btrim(role)) BETWEEN 1 AND 120);--> statement-breakpoint

CREATE FUNCTION hermes_audit_hash(
  p_organization_id uuid,
  p_chain_position bigint,
  p_agent_id uuid,
  p_actor_type text,
  p_actor_id text,
  p_action text,
  p_summary text,
  p_decision text,
  p_tool text,
  p_amount_cents bigint,
  p_payload jsonb,
  p_occurred_at timestamptz,
  p_prev_hash bytea
) RETURNS bytea
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT digest(
    convert_to(
      jsonb_build_array(
        2,
        p_chain_position,
        p_organization_id::text,
        coalesce(p_agent_id::text, ''),
        p_actor_type,
        p_actor_id,
        p_action,
        p_summary,
        coalesce(p_decision, ''),
        coalesce(p_tool, ''),
        coalesce(p_amount_cents::text, ''),
        p_payload,
        p_occurred_at,
        coalesce(encode(p_prev_hash, 'hex'), '')
      )::text,
      'UTF8'
    ),
    'sha256'
  )
$$;--> statement-breakpoint

CREATE FUNCTION hermes_audit_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id::text, 0));

  SELECT coalesce(max(chain_position), 0) + 1 INTO NEW.chain_position
  FROM agent_audit_logs
  WHERE organization_id = NEW.organization_id;

  SELECT hash INTO NEW.prev_hash
  FROM agent_audit_logs
  WHERE organization_id = NEW.organization_id
  ORDER BY chain_position DESC
  LIMIT 1;

  NEW.hash := hermes_audit_hash(
    NEW.organization_id, NEW.chain_position, NEW.agent_id, NEW.actor_type, NEW.actor_id,
    NEW.action, NEW.summary, NEW.decision, NEW.tool, NEW.amount_cents,
    NEW.payload, NEW.occurred_at, NEW.prev_hash
  );
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE FUNCTION hermes_audit_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'agent_audit_logs is append-only';
END
$$;--> statement-breakpoint

CREATE FUNCTION hermes_verify_audit_chain(p_organization_id uuid)
RETURNS TABLE(valid boolean, checked bigint, first_invalid bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item record;
  previous bytea;
  expected bytea;
  count_checked bigint := 0;
  expected_chain_position bigint := 1;
BEGIN
  IF hermes_current_user_id() IS NULL OR NOT EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = hermes_current_user_id()
  ) THEN
    RETURN QUERY SELECT false, 0::bigint, NULL::bigint;
    RETURN;
  END IF;

  FOR item IN
    SELECT * FROM agent_audit_logs
    WHERE organization_id = p_organization_id
    ORDER BY chain_position ASC
  LOOP
    count_checked := count_checked + 1;
    IF item.chain_position <> expected_chain_position THEN
      RETURN QUERY SELECT false, count_checked, item.id;
      RETURN;
    END IF;
    IF item.prev_hash IS DISTINCT FROM previous THEN
      RETURN QUERY SELECT false, count_checked, item.id;
      RETURN;
    END IF;
    expected := hermes_audit_hash(
      item.organization_id, item.chain_position, item.agent_id, item.actor_type, item.actor_id,
      item.action, item.summary, item.decision, item.tool, item.amount_cents,
      item.payload, item.occurred_at, previous
    );
    IF item.hash IS DISTINCT FROM expected THEN
      RETURN QUERY SELECT false, count_checked, item.id;
      RETURN;
    END IF;
    previous := item.hash;
    expected_chain_position := expected_chain_position + 1;
  END LOOP;

  RETURN QUERY SELECT true, count_checked, NULL::bigint;
END
$$;--> statement-breakpoint

CREATE TRIGGER agent_audit_before_insert
BEFORE INSERT ON agent_audit_logs
FOR EACH ROW EXECUTE FUNCTION hermes_audit_before_insert();--> statement-breakpoint
CREATE TRIGGER agent_audit_immutable
BEFORE UPDATE OR DELETE ON agent_audit_logs
FOR EACH ROW EXECUTE FUNCTION hermes_audit_immutable();--> statement-breakpoint

CREATE FUNCTION hermes_public_issuer_key(p_did text)
RETURNS TABLE (did text, key_fragment text, public_jwk jsonb, thumbprint text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.did, i.key_fragment, i.public_jwk, i.thumbprint
  FROM issuer_keys i
  WHERE i.did = p_did AND i.status = 'active'
  ORDER BY i.created_at DESC
  LIMIT 1
$$;--> statement-breakpoint

CREATE FUNCTION hermes_public_agent(p_slug text)
RETURNS TABLE (
  id uuid, slug text, did text, name text, role text, organization_name text,
  organization_slug text, risk risk_tier, scopes text[], spend_cap_cents bigint,
  status agent_status, credential_id text, credential_jws text,
  issued_at timestamptz, expires_at timestamptz, public_jwk jsonb, thumbprint text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.slug, a.did, a.name, a.role, o.name, o.slug, a.risk,
    a.scopes, a.spend_cap_cents, a.status, a.credential_id, a.credential_jws,
    a.issued_at, a.expires_at, k.public_jwk, k.thumbprint
  FROM agents a
  JOIN organizations o ON o.id = a.organization_id
  LEFT JOIN LATERAL (
    SELECT k.public_jwk, k.thumbprint
    FROM agent_keys k
    WHERE k.agent_id = a.id
    ORDER BY k.created_at DESC
    LIMIT 1
  ) k ON true
  WHERE a.slug = p_slug
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION hermes_public_issuer_key(text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION hermes_public_agent(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hermes_public_issuer_key(text) TO hermes_app;--> statement-breakpoint

CREATE FUNCTION hermes_public_issuer_key_for_fragment(p_did text, p_key_fragment text)
RETURNS TABLE (did text, key_fragment text, public_jwk jsonb, thumbprint text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.did, i.key_fragment, i.public_jwk, i.thumbprint
  FROM issuer_keys i
  WHERE i.did = p_did AND i.key_fragment = p_key_fragment
  ORDER BY i.created_at DESC
  LIMIT 1
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION hermes_public_issuer_key_for_fragment(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hermes_public_issuer_key_for_fragment(text, text) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hermes_public_agent(text) TO hermes_app;--> statement-breakpoint

CREATE FUNCTION hermes_public_agent_by_did(p_did text)
RETURNS TABLE (
  id uuid, slug text, did text, name text, role text, organization_name text,
  organization_slug text, risk risk_tier, scopes text[], spend_cap_cents bigint,
  status agent_status, credential_id text, credential_jws text,
  issued_at timestamptz, expires_at timestamptz, public_jwk jsonb, thumbprint text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.slug, a.did, a.name, a.role, o.name, o.slug, a.risk,
    a.scopes, a.spend_cap_cents, a.status, a.credential_id, a.credential_jws,
    a.issued_at, a.expires_at, k.public_jwk, k.thumbprint
  FROM agents a
  JOIN organizations o ON o.id = a.organization_id
  LEFT JOIN LATERAL (
    SELECT k.public_jwk, k.thumbprint
    FROM agent_keys k
    WHERE k.agent_id = a.id
    ORDER BY k.created_at DESC
    LIMIT 1
  ) k ON true
  WHERE a.did = p_did
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION hermes_public_agent_by_did(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hermes_public_agent_by_did(text) TO hermes_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hermes_verify_audit_chain(uuid) TO hermes_app;
