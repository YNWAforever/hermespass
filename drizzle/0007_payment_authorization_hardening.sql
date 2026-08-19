-- Additive payment authorization hardening: bind aggregate reads to the caller claim.
CREATE OR REPLACE FUNCTION public.hermes_payment_spend_totals(
  p_agent_id uuid,
  p_organization_id uuid,
  p_day_start timestamptz,
  p_month_start timestamptz
) RETURNS TABLE(spent_today_cents bigint, spent_month_cents bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT COALESCE(
    public.hermes_has_org_role(
      p_organization_id,
      ARRAY['owner', 'admin', 'viewer']::public.member_role[]
    ),
    false
  ) AND NOT (
    pg_catalog.current_setting('hermes.agent_verified', true) = '1'
    AND public.hermes_current_agent_id() IS NOT DISTINCT FROM p_agent_id
    AND public.hermes_current_agent_organization_id() IS NOT DISTINCT FROM p_organization_id
  ) THEN
    RAISE EXCEPTION 'payment spend tenant claim required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
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
        AND gr.authorized_at IS NOT NULL AND gr.authorized_at >= p_month_start), 0)::bigint;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_payment_spend_totals(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_payment_spend_totals(uuid, uuid, timestamptz, timestamptz) TO hermes_app;