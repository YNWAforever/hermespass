-- Additive Phase 5 public-verification boundary. Existing migrations remain immutable.
CREATE OR REPLACE FUNCTION public.hermes_revoke_api_key(
  p_organization_id uuid,
  p_api_key_id uuid,
  p_user_id text
)
RETURNS TABLE (
  id uuid,
  name text,
  prefix text,
  created_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  member_role text;
  key_row public.api_keys;
BEGIN
  IF p_user_id IS DISTINCT FROM public.hermes_current_user_id() THEN
    RAISE EXCEPTION 'api key actor denied' USING ERRCODE = '42501';
  END IF;
  SELECT m.role::text INTO member_role
  FROM public.org_members m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = p_user_id;
  IF member_role IS NULL OR member_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'api key mutation denied' USING ERRCODE = '42501';
  END IF;
  SELECT k.* INTO key_row
  FROM public.api_keys k
  WHERE k.id = p_api_key_id
    AND k.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'API_KEY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.api_keys
  SET revoked_at = COALESCE(key_row.revoked_at, pg_catalog.clock_timestamp())
  WHERE public.api_keys.id = key_row.id;
  RETURN QUERY
    SELECT key_row.id, key_row.name, key_row.prefix, key_row.created_at,
      public.api_keys.revoked_at, key_row.last_used_at
    FROM public.api_keys
    WHERE public.api_keys.id = key_row.id;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_revoke_api_key(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_revoke_api_key(uuid, uuid, text) TO hermes_app;
