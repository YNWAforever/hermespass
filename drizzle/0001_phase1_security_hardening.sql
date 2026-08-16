DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = 'hermes_app'
  ) THEN
    RAISE EXCEPTION 'unsafe pre-existing hermes_app role membership';
  END IF;
END
$$;--> statement-breakpoint

ALTER TABLE "agent_audit_logs" DROP CONSTRAINT "agent_audit_logs_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_keys" DROP CONSTRAINT "agent_keys_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_id_organization_id_key" UNIQUE("id", "organization_id");--> statement-breakpoint
ALTER TABLE "agent_audit_logs" ADD COLUMN "hash_version" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_audit_logs" ALTER COLUMN "hash_version" SET DEFAULT 3;--> statement-breakpoint
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_hash_version_allowed" CHECK (hash_version IN (2, 3));--> statement-breakpoint
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_agent_organization_fk" FOREIGN KEY ("agent_id", "organization_id") REFERENCES "public"."agents"("id", "organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_agent_organization_fk" FOREIGN KEY ("agent_id", "organization_id") REFERENCES "public"."agents"("id", "organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

DROP POLICY agent_keys_member_select ON agent_keys;--> statement-breakpoint
DROP POLICY agent_keys_admin_insert ON agent_keys;--> statement-breakpoint
DROP POLICY agent_keys_admin_update ON agent_keys;--> statement-breakpoint
CREATE POLICY agent_keys_member_select ON agent_keys FOR SELECT TO hermes_app
USING (
  EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.organization_id = agent_keys.organization_id
      AND m.user_id = hermes_current_user_id()
  )
  AND EXISTS (
    SELECT 1 FROM agents a
    WHERE a.id = agent_keys.agent_id
      AND a.organization_id = agent_keys.organization_id
  )
);--> statement-breakpoint
CREATE POLICY agent_keys_admin_insert ON agent_keys FOR INSERT TO hermes_app
WITH CHECK (
  EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.organization_id = agent_keys.organization_id
      AND m.user_id = hermes_current_user_id()
      AND m.role IN ('owner', 'admin')
  )
  AND EXISTS (
    SELECT 1 FROM agents a
    WHERE a.id = agent_keys.agent_id
      AND a.organization_id = agent_keys.organization_id
  )
);--> statement-breakpoint
CREATE POLICY agent_keys_admin_update ON agent_keys FOR UPDATE TO hermes_app
USING (
  EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.organization_id = agent_keys.organization_id
      AND m.user_id = hermes_current_user_id()
      AND m.role IN ('owner', 'admin')
  )
  AND EXISTS (
    SELECT 1 FROM agents a
    WHERE a.id = agent_keys.agent_id
      AND a.organization_id = agent_keys.organization_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.organization_id = agent_keys.organization_id
      AND m.user_id = hermes_current_user_id()
      AND m.role IN ('owner', 'admin')
  )
  AND EXISTS (
    SELECT 1 FROM agents a
    WHERE a.id = agent_keys.agent_id
      AND a.organization_id = agent_keys.organization_id
  )
);--> statement-breakpoint

DROP POLICY audit_member_select ON agent_audit_logs;--> statement-breakpoint
DROP POLICY audit_admin_insert ON agent_audit_logs;--> statement-breakpoint
CREATE POLICY audit_member_select ON agent_audit_logs FOR SELECT TO hermes_app
USING (
  EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.organization_id = agent_audit_logs.organization_id
      AND m.user_id = hermes_current_user_id()
  )
  AND (
    agent_audit_logs.agent_id IS NULL
    OR EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = agent_audit_logs.agent_id
        AND a.organization_id = agent_audit_logs.organization_id
    )
  )
);--> statement-breakpoint
CREATE POLICY audit_admin_insert ON agent_audit_logs FOR INSERT TO hermes_app
WITH CHECK (
  EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.organization_id = agent_audit_logs.organization_id
      AND m.user_id = hermes_current_user_id()
      AND m.role IN ('owner', 'admin')
  )
  AND (
    agent_audit_logs.agent_id IS NULL
    OR EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id = agent_audit_logs.agent_id
        AND a.organization_id = agent_audit_logs.organization_id
    )
  )
);--> statement-breakpoint

-- These tables use FORCE ROW LEVEL SECURITY, so SECURITY DEFINER functions owned
-- by the migration role still need an explicit read path. Only the table owner
-- receives it; hermes_app continues to be constrained by the tenant policies.
CREATE POLICY organizations_owner_function_select ON organizations FOR SELECT TO PUBLIC
USING (
  current_user = pg_get_userbyid((
    SELECT relation.relowner FROM pg_class relation
    WHERE relation.oid = 'public.organizations'::regclass
  ))
);--> statement-breakpoint
CREATE POLICY org_members_owner_function_select ON org_members FOR SELECT TO PUBLIC
USING (
  current_user = pg_get_userbyid((
    SELECT relation.relowner FROM pg_class relation
    WHERE relation.oid = 'public.org_members'::regclass
  ))
);--> statement-breakpoint
CREATE POLICY issuer_keys_owner_function_select ON issuer_keys FOR SELECT TO PUBLIC
USING (
  current_user = pg_get_userbyid((
    SELECT relation.relowner FROM pg_class relation
    WHERE relation.oid = 'public.issuer_keys'::regclass
  ))
);--> statement-breakpoint
CREATE POLICY agents_owner_function_select ON agents FOR SELECT TO PUBLIC
USING (
  current_user = pg_get_userbyid((
    SELECT relation.relowner FROM pg_class relation
    WHERE relation.oid = 'public.agents'::regclass
  ))
);--> statement-breakpoint
CREATE POLICY agent_keys_owner_function_select ON agent_keys FOR SELECT TO PUBLIC
USING (
  current_user = pg_get_userbyid((
    SELECT relation.relowner FROM pg_class relation
    WHERE relation.oid = 'public.agent_keys'::regclass
  ))
);--> statement-breakpoint
CREATE POLICY audit_owner_function_select ON agent_audit_logs FOR SELECT TO PUBLIC
USING (
  current_user = pg_get_userbyid((
    SELECT relation.relowner FROM pg_class relation
    WHERE relation.oid = 'public.agent_audit_logs'::regclass
  ))
);--> statement-breakpoint

CREATE FUNCTION hermes_audit_hash_v3(
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
        3,
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
        to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        coalesce(encode(p_prev_hash, 'hex'), '')
      )::text,
      'UTF8'
    ),
    'sha256'
  )
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION hermes_audit_before_insert() RETURNS trigger
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

  NEW.hash_version := 3;
  NEW.hash := hermes_audit_hash_v3(
    NEW.organization_id, NEW.chain_position, NEW.agent_id, NEW.actor_type, NEW.actor_id,
    NEW.action, NEW.summary, NEW.decision, NEW.tool, NEW.amount_cents,
    NEW.payload, NEW.occurred_at, NEW.prev_hash
  );
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION hermes_verify_audit_chain(p_organization_id uuid)
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
    expected := CASE item.hash_version
      WHEN 2 THEN hermes_audit_hash(
        item.organization_id, item.chain_position, item.agent_id, item.actor_type, item.actor_id,
        item.action, item.summary, item.decision, item.tool, item.amount_cents,
        item.payload, item.occurred_at, previous
      )
      WHEN 3 THEN hermes_audit_hash_v3(
        item.organization_id, item.chain_position, item.agent_id, item.actor_type, item.actor_id,
        item.action, item.summary, item.decision, item.tool, item.amount_cents,
        item.payload, item.occurred_at, previous
      )
      ELSE NULL
    END;
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

CREATE FUNCTION hermes_revoke_agent(
  p_agent_id uuid,
  p_organization_id uuid,
  p_actor_id text
) RETURNS TABLE(changed boolean)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  revoked_agent record;
  revoked_timestamp timestamptz := clock_timestamp();
BEGIN
  IF p_actor_id IS DISTINCT FROM hermes_current_user_id() OR NOT EXISTS (
    SELECT 1 FROM org_members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = hermes_current_user_id()
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'permission denied for agent revocation' USING ERRCODE = '42501';
  END IF;

  UPDATE agents
  SET status = 'revoked', revoked_at = revoked_timestamp, revoked_by = p_actor_id,
    updated_at = revoked_timestamp
  WHERE id = p_agent_id
    AND organization_id = p_organization_id
    AND status = 'active'
  RETURNING name, did, credential_id INTO revoked_agent;

  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM agents
      WHERE id = p_agent_id AND organization_id = p_organization_id
    ) THEN
      RAISE EXCEPTION 'AGENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  UPDATE agent_keys
  SET status = 'revoked', revoked_at = revoked_timestamp
  WHERE agent_id = p_agent_id
    AND organization_id = p_organization_id
    AND status = 'active';

  INSERT INTO agent_audit_logs (
    organization_id, agent_id, actor_type, actor_id, action, summary,
    decision, tool, payload
  ) VALUES (
    p_organization_id, p_agent_id, 'user', p_actor_id, 'passport.revoked',
    'Passport revoked for ' || revoked_agent.name, 'deny', 'passport.revoke',
    jsonb_build_object('did', revoked_agent.did, 'credentialId', revoked_agent.credential_id)
  );

  RETURN QUERY SELECT true;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION hermes_public_agent(p_slug text)
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
      AND k.organization_id = a.organization_id
      AND (a.status = 'revoked' OR k.status = 'active')
    ORDER BY k.created_at DESC
    LIMIT 1
  ) k ON true
  WHERE a.slug = p_slug
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION hermes_public_agent_by_did(p_did text)
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
      AND k.organization_id = a.organization_id
      AND (a.status = 'revoked' OR k.status = 'active')
    ORDER BY k.created_at DESC
    LIMIT 1
  ) k ON true
  WHERE a.did = p_did
$$;--> statement-breakpoint

CREATE FUNCTION hermes_public_issuer_keys(p_did text)
RETURNS TABLE (did text, key_fragment text, public_jwk jsonb, thumbprint text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.did, i.key_fragment, i.public_jwk, i.thumbprint, i.status = 'active'
  FROM issuer_keys i
  WHERE i.did = p_did
  ORDER BY (i.status = 'active') DESC, i.created_at DESC
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION hermes_audit_hash_v3(uuid, bigint, uuid, text, text, text, text, text, text, bigint, jsonb, timestamptz, bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION hermes_revoke_agent(uuid, uuid, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION hermes_public_issuer_keys(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hermes_revoke_agent(uuid, uuid, text) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hermes_public_issuer_keys(text) TO hermes_app;
