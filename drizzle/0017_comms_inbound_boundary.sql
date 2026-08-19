-- Additive Phase 5 communications lookup boundary. Existing migrations remain immutable.

CREATE OR REPLACE FUNCTION public.hermes_find_agent_by_slug(p_slug text)
RETURNS TABLE(agent_id uuid, organization_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'hermes_app'
     OR pg_catalog.current_setting('hermes.productization_actor', true) IS DISTINCT FROM 'system:comms' THEN
    RAISE EXCEPTION 'communications lookup denied' USING ERRCODE = '42501';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' THEN
    RAISE EXCEPTION 'COMMS_INBOUND_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT agent.id, agent.organization_id
    FROM public.agents AS agent
    WHERE agent.slug = p_slug
      AND agent.status = 'active';
END
$$;
REVOKE ALL ON FUNCTION public.hermes_find_agent_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_find_agent_by_slug(text) TO hermes_app;
