-- Additive Phase 5 compliance-report read boundary. Existing migrations remain immutable.

CREATE OR REPLACE FUNCTION public.hermes_verify_audit_chain(p_organization_id uuid)
RETURNS TABLE(valid boolean, checked bigint, first_invalid bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  item record;
  previous bytea;
  expected bytea;
  count_checked bigint := 0;
  expected_chain_position bigint := 1;
  report_claim boolean := coalesce(pg_catalog.current_setting('hermes.productization_actor', true) = 'system:report', false);
BEGIN
  IF NOT (
    report_claim
    OR (
      public.hermes_current_user_id() IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.org_members AS m
        WHERE m.organization_id = p_organization_id
          AND m.user_id = public.hermes_current_user_id()
      )
    )
  ) THEN
    RETURN QUERY SELECT false, 0::bigint, NULL::bigint;
    RETURN;
  END IF;

  FOR item IN
    SELECT *
    FROM public.agent_audit_logs
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
      WHEN 2 THEN public.hermes_audit_hash(
        item.organization_id, item.chain_position, item.agent_id, item.actor_type, item.actor_id,
        item.action, item.summary, item.decision, item.tool, item.amount_cents,
        item.payload, item.occurred_at, previous
      )
      WHEN 3 THEN public.hermes_audit_hash_v3(
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
$$;
REVOKE ALL ON FUNCTION public.hermes_verify_audit_chain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_verify_audit_chain(uuid) TO hermes_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_report_read_model(
  p_organization_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  organization_slug text;
  agent_rows jsonb;
  decision_rows jsonb;
  approval_rows jsonb;
  chain_valid boolean;
  checked_rows bigint;
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'hermes_app' THEN
    RAISE EXCEPTION 'report read role denied' USING ERRCODE = '42501';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'REPORT_PERIOD_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_actor = 'system:report' THEN
    IF pg_catalog.current_setting('hermes.productization_actor', true) IS DISTINCT FROM 'system:report' THEN
      RAISE EXCEPTION 'report worker claim denied' USING ERRCODE = '42501';
    END IF;
  ELSIF p_actor IS DISTINCT FROM public.hermes_current_user_id() OR NOT EXISTS (
    SELECT 1
    FROM public.org_members AS member
    WHERE member.organization_id = p_organization_id
      AND member.user_id = p_actor
  ) THEN
    RAISE EXCEPTION 'report actor denied' USING ERRCODE = '42501';
  END IF;

  SELECT organization.slug
  INTO organization_slug
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id;
  IF organization_slug IS NULL THEN
    RAISE EXCEPTION 'REPORT_ORG_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'did', agent.did,
        'name', agent.name,
        'risk', agent.risk::text,
        'status', agent.status::text
      )
      ORDER BY agent.slug
    ),
    '[]'::jsonb
  )
  INTO agent_rows
  FROM public.agents AS agent
  WHERE agent.organization_id = p_organization_id;

  SELECT jsonb_build_object(
    'allow', count(*) FILTER (WHERE request.current_decision = 'allow'),
    'deny', count(*) FILTER (WHERE request.current_decision = 'deny'),
    'hold', count(*) FILTER (WHERE request.current_decision = 'hold')
  )
  INTO decision_rows
  FROM public.gateway_requests AS request
  WHERE request.organization_id = p_organization_id
    AND request.decided_at >= p_period_start
    AND request.decided_at < p_period_end;

  SELECT jsonb_build_object(
    'resolved', count(*) FILTER (WHERE approval.status <> 'pending'),
    'byHuman', count(*) FILTER (
      WHERE approval.resolution_source IN ('web', 'telegram', 'owner_override')
    ),
    'byTimeout', count(*) FILTER (WHERE approval.resolution_source = 'expiry'),
    'medianMinutes', coalesce(
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (approval.resolved_at - approval.created_at)) / 60.0
      ) FILTER (WHERE approval.resolved_at IS NOT NULL),
      0
    )
  )
  INTO approval_rows
  FROM public.pending_approvals AS approval
  WHERE approval.organization_id = p_organization_id
    AND approval.resolved_at >= p_period_start
    AND approval.resolved_at < p_period_end;

  SELECT verification.valid, verification.checked
  INTO chain_valid, checked_rows
  FROM public.hermes_verify_audit_chain(p_organization_id) AS verification;

  RETURN jsonb_build_object(
    'orgSlug', organization_slug,
    'agents', agent_rows,
    'decisions', decision_rows,
    'approvals', approval_rows,
    'chainValid', coalesce(chain_valid, false),
    'checkedRows', coalesce(checked_rows, 0)
  );
END
$$;
REVOKE ALL ON FUNCTION public.hermes_report_read_model(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_report_read_model(uuid, timestamptz, timestamptz, text) TO hermes_app;
