CREATE FUNCTION public.hermes_gateway_auth_context(
  p_agent_did text,
  p_key_id uuid
) RETURNS TABLE(
  agent_id uuid,
  organization_id uuid,
  key_id uuid,
  public_jwk jsonb,
  thumbprint text,
  agent_status public.agent_status,
  key_status public.key_status,
  passport_expires_at timestamptz,
  scopes text[],
  spend_cap_cents bigint,
  risk public.risk_tier
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF pg_catalog.length(pg_catalog.btrim(p_agent_did)) NOT BETWEEN 1 AND 512
    OR p_key_id IS NULL
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT agent.id, agent.organization_id, key.id, key.public_jwk,
    key.thumbprint, agent.status, key.status, agent.expires_at,
    agent.scopes, agent.spend_cap_cents, agent.risk
  FROM public.agents agent
  JOIN public.agent_keys key
    ON key.agent_id = agent.id
   AND key.organization_id = agent.organization_id
  WHERE agent.did = p_agent_did
    AND key.id = p_key_id
    AND key.custody = 'external'
    AND NOT (key.public_jwk ? 'd');
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_lock_gateway_signature_agent(
  p_agent_id uuid,
  p_organization_id uuid,
  p_key_id uuid
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM pg_catalog.set_config('hermes.agent_verified', '0', true);
  PERFORM pg_catalog.set_config('hermes.agent_id', '', true);
  PERFORM pg_catalog.set_config('hermes.agent_organization_id', '', true);
  PERFORM pg_catalog.set_config('hermes.agent_key_id', '', true);

  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_keys key
    JOIN public.agents agent
      ON agent.id = key.agent_id
     AND agent.organization_id = key.organization_id
    WHERE key.id = p_key_id
      AND key.agent_id = p_agent_id
      AND key.organization_id = p_organization_id
      AND key.custody = 'external'
      AND NOT (key.public_jwk ? 'd')
  ) THEN
    RAISE EXCEPTION 'AGENT_KEY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.set_config('hermes.agent_id', p_agent_id::text, true);
  PERFORM pg_catalog.set_config(
    'hermes.agent_organization_id', p_organization_id::text, true
  );
  PERFORM pg_catalog.set_config('hermes.agent_key_id', p_key_id::text, true);
  PERFORM pg_catalog.set_config('hermes.agent_verified', '1', true);

  -- 0002 enrollment and gateway work share this advisory-lock-first order.
  PERFORM public.hermes_lock_gateway_decision(p_agent_id);
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_set_signature_authenticated_agent_claim(
  p_agent_id uuid,
  p_organization_id uuid,
  p_key_id uuid
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM pg_catalog.set_config('hermes.agent_verified', '0', true);
  PERFORM pg_catalog.set_config('hermes.agent_id', '', true);
  PERFORM pg_catalog.set_config('hermes.agent_organization_id', '', true);
  PERFORM pg_catalog.set_config('hermes.agent_key_id', '', true);

  -- The helper takes the shared advisory lock before this key snapshot lock.
  PERFORM public.hermes_lock_gateway_signature_agent(
    p_agent_id, p_organization_id, p_key_id
  );

  PERFORM 1
    FROM public.agent_keys key
    JOIN public.agents agent
      ON agent.id = key.agent_id
     AND agent.organization_id = key.organization_id
    WHERE key.id = p_key_id
      AND key.agent_id = p_agent_id
      AND key.organization_id = p_organization_id
      AND key.custody = 'external'
      AND NOT (key.public_jwk ? 'd')
    FOR SHARE OF key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AGENT_KEY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.set_config('hermes.agent_id', p_agent_id::text, true);
  PERFORM pg_catalog.set_config(
    'hermes.agent_organization_id', p_organization_id::text, true
  );
  PERFORM pg_catalog.set_config('hermes.agent_key_id', p_key_id::text, true);
  PERFORM pg_catalog.set_config('hermes.agent_verified', '1', true);
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.hermes_gateway_auth_context(text, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_lock_gateway_signature_agent(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_set_signature_authenticated_agent_claim(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_gateway_auth_context(text, uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_lock_gateway_signature_agent(uuid, uuid, uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_set_signature_authenticated_agent_claim(uuid, uuid, uuid) TO hermes_app;
