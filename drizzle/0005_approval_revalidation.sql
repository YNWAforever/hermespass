CREATE OR REPLACE FUNCTION public.hermes_resolve_approval(
  p_approval_id uuid,
  p_resolution public.gateway_decision,
  p_resolution_source public.approval_resolution_source,
  p_reason text,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint
) RETURNS TABLE(
  approval_id uuid,
  gateway_request_id uuid,
  approval_status public.approval_status,
  current_decision public.gateway_decision
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  approval_agent_id uuid;
  approval_record record;
  agent_record record;
  key_record record;
  policy_record record;
  resolver_user_id text := public.hermes_current_user_id();
  resolution_time timestamptz;
  final_resolution public.gateway_decision := p_resolution;
  final_reason text := p_reason;
  invalidation_reason_code text;
  next_approval_status public.approval_status;
  next_reason_code text;
  next_authorization_expires_at timestamptz;
  day_start timestamptz;
  month_start timestamptz;
  authorized_daily_spend numeric := 0;
  authorized_monthly_spend numeric := 0;
BEGIN
  IF p_resolution NOT IN ('allow', 'deny')
    OR pg_catalog.length(pg_catalog.btrim(p_reason)) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid approval resolution' USING ERRCODE = 'P0001';
  ELSIF p_resolution_source <> 'telegram'
    AND (p_telegram_user_id IS NOT NULL OR p_telegram_chat_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'unexpected Telegram approval identity'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT approval.agent_id
  INTO approval_agent_id
  FROM public.pending_approvals approval
  WHERE approval.id = p_approval_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval is unavailable' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hermes.agent:' || approval_agent_id::text, 0)
  );

  SELECT approval.id, approval.organization_id, approval.agent_id,
    approval.gateway_request_id, approval.assigned_reviewer_user_id,
    approval.status, approval.expires_at, request.current_decision,
    request.key_id, request.tool, request.amount_cents, request.currency
  INTO approval_record
  FROM public.pending_approvals approval
  JOIN public.gateway_requests request
    ON request.id = approval.gateway_request_id
   AND request.agent_id = approval.agent_id
   AND request.organization_id = approval.organization_id
  WHERE approval.id = p_approval_id
  FOR UPDATE OF approval, request;

  resolution_time := pg_catalog.clock_timestamp();

  IF NOT FOUND
    OR approval_record.status <> 'pending'
    OR approval_record.current_decision <> 'hold'
  THEN
    RAISE EXCEPTION 'approval is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF p_resolution_source = 'expiry' THEN
    IF p_resolution <> 'deny'
      OR resolver_user_id IS NOT NULL
      OR resolution_time < approval_record.expires_at
    THEN
      RAISE EXCEPTION 'invalid approval expiry' USING ERRCODE = 'P0001';
    END IF;
    next_approval_status := 'expired';
  ELSE
    IF resolution_time >= approval_record.expires_at THEN
      RAISE EXCEPTION 'approval has expired' USING ERRCODE = 'P0001';
    END IF;

    IF p_resolution_source = 'owner_override' THEN
      IF NOT public.hermes_has_org_role(
        approval_record.organization_id,
        ARRAY['owner']::public.member_role[]
      ) THEN
        RAISE EXCEPTION 'organization owner required for override'
          USING ERRCODE = '42501';
      END IF;
    ELSIF p_resolution_source = 'telegram' THEN
      IF resolver_user_id IS NULL
        OR p_telegram_user_id IS NULL
        OR p_telegram_chat_id IS NULL
        OR p_telegram_user_id <= 0
        OR p_telegram_chat_id <> p_telegram_user_id
      THEN
        RAISE EXCEPTION 'exact private Telegram reviewer identity required'
          USING ERRCODE = '42501';
      END IF;

      PERFORM 1
      FROM public.telegram_links link
      WHERE link.organization_id = approval_record.organization_id
        AND link.user_id = approval_record.assigned_reviewer_user_id
        AND link.user_id = resolver_user_id
        AND link.is_active
        AND link.telegram_user_id = p_telegram_user_id
        AND link.telegram_chat_id = p_telegram_chat_id
      FOR UPDATE OF link;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'active Telegram reviewer identity required'
          USING ERRCODE = '42501';
      END IF;

      PERFORM 1
      FROM public.org_members member
      WHERE member.organization_id = approval_record.organization_id
        AND member.user_id = approval_record.assigned_reviewer_user_id
        AND member.user_id = resolver_user_id
        AND member.role IN ('owner', 'admin')
      FOR SHARE OF member;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'current Telegram reviewer role required'
          USING ERRCODE = '42501';
      END IF;
    ELSIF p_resolution_source = 'web' THEN
      IF NOT (
        public.hermes_has_org_role(
          approval_record.organization_id,
          ARRAY['owner']::public.member_role[]
        )
        OR (
          resolver_user_id = approval_record.assigned_reviewer_user_id
          AND public.hermes_has_org_role(
            approval_record.organization_id,
            ARRAY['owner', 'admin']::public.member_role[]
          )
        )
      ) THEN
        RAISE EXCEPTION 'assigned reviewer or organization owner required'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid approval resolution source'
        USING ERRCODE = '42501';
    END IF;

    IF p_resolution = 'allow' THEN
      SELECT agent.status, agent.expires_at, agent.spend_cap_cents
      INTO agent_record
      FROM public.agents agent
      WHERE agent.id = approval_record.agent_id
        AND agent.organization_id = approval_record.organization_id
      FOR SHARE OF agent;

      IF NOT FOUND OR agent_record.status <> 'active' THEN
        invalidation_reason_code := 'PASSPORT_INACTIVE';
      ELSIF agent_record.expires_at <= resolution_time THEN
        invalidation_reason_code := 'PASSPORT_EXPIRED';
      ELSE
        SELECT key.status, key.custody, key.public_jwk
        INTO key_record
        FROM public.agent_keys key
        WHERE key.id = approval_record.key_id
          AND key.agent_id = approval_record.agent_id
          AND key.organization_id = approval_record.organization_id
        FOR SHARE OF key;

        IF NOT FOUND
          OR key_record.status <> 'active'
          OR key_record.custody <> 'external'
          OR key_record.public_jwk ? 'd'
        THEN
          invalidation_reason_code := 'AGENT_KEY_INACTIVE';
        ELSIF approval_record.amount_cents IS NOT NULL THEN
          SELECT policy.currency, policy.per_transaction_limit_cents,
            policy.daily_limit_cents, policy.monthly_limit_cents
          INTO policy_record
          FROM public.agent_policies policy
          WHERE policy.agent_id = approval_record.agent_id
            AND policy.organization_id = approval_record.organization_id
            AND policy.is_active
          FOR SHARE OF policy;

          IF NOT FOUND THEN
            invalidation_reason_code := 'POLICY_REQUIRED';
          ELSIF approval_record.currency <> 'HKD'
            OR policy_record.currency <> 'HKD'
          THEN
            invalidation_reason_code := 'CURRENCY_NOT_SUPPORTED';
          ELSIF approval_record.amount_cents > agent_record.spend_cap_cents THEN
            invalidation_reason_code := 'PASSPORT_SPEND_CAP_EXCEEDED';
          ELSIF approval_record.amount_cents > policy_record.per_transaction_limit_cents THEN
            invalidation_reason_code := 'PER_TRANSACTION_LIMIT_EXCEEDED';
          ELSE
            day_start := pg_catalog.date_trunc(
              'day', resolution_time AT TIME ZONE 'Asia/Hong_Kong'
            ) AT TIME ZONE 'Asia/Hong_Kong';
            month_start := pg_catalog.date_trunc(
              'month', resolution_time AT TIME ZONE 'Asia/Hong_Kong'
            ) AT TIME ZONE 'Asia/Hong_Kong';

            SELECT
              COALESCE(pg_catalog.sum(request.amount_cents) FILTER (
                WHERE request.authorized_at >= day_start
              ), 0::numeric),
              COALESCE(pg_catalog.sum(request.amount_cents) FILTER (
                WHERE request.authorized_at >= month_start
              ), 0::numeric)
            INTO authorized_daily_spend, authorized_monthly_spend
            FROM public.gateway_requests request
            WHERE request.agent_id = approval_record.agent_id
              AND request.organization_id = approval_record.organization_id
              AND request.current_decision = 'allow'
              AND request.currency = 'HKD'
              AND request.amount_cents IS NOT NULL
              AND request.authorized_at >= month_start;

            IF authorized_daily_spend + approval_record.amount_cents >
              policy_record.daily_limit_cents
            THEN
              invalidation_reason_code := 'DAILY_LIMIT_EXCEEDED';
            ELSIF authorized_monthly_spend + approval_record.amount_cents >
              policy_record.monthly_limit_cents
            THEN
              invalidation_reason_code := 'MONTHLY_LIMIT_EXCEEDED';
            END IF;
          END IF;
        END IF;
      END IF;

      IF invalidation_reason_code IS NOT NULL THEN
        final_resolution := 'deny';
        final_reason := CASE invalidation_reason_code
          WHEN 'PASSPORT_INACTIVE' THEN 'The agent passport is no longer active.'
          WHEN 'PASSPORT_EXPIRED' THEN 'The agent passport has expired.'
          WHEN 'AGENT_KEY_INACTIVE' THEN 'The request signing key is no longer active.'
          WHEN 'POLICY_REQUIRED' THEN 'An active policy is required.'
          WHEN 'CURRENCY_NOT_SUPPORTED' THEN 'Only HKD spend can be authorized.'
          WHEN 'PASSPORT_SPEND_CAP_EXCEEDED' THEN
            'The amount exceeds the current passport spend cap.'
          WHEN 'PER_TRANSACTION_LIMIT_EXCEEDED' THEN
            'The amount exceeds the current per-transaction limit.'
          WHEN 'DAILY_LIMIT_EXCEEDED' THEN
            'The amount would exceed the current daily limit.'
          WHEN 'MONTHLY_LIMIT_EXCEEDED' THEN
            'The amount would exceed the current monthly limit.'
          ELSE 'The held request no longer satisfies authorization policy.'
        END;
      END IF;
    END IF;

    next_approval_status := CASE
      WHEN final_resolution = 'allow' THEN 'approved'::public.approval_status
      ELSE 'denied'::public.approval_status
    END;
  END IF;

  next_reason_code := CASE
    WHEN p_resolution_source = 'expiry' THEN 'APPROVAL_EXPIRED'
    WHEN final_resolution = 'allow' THEN 'APPROVAL_APPROVED'
    WHEN invalidation_reason_code IS NOT NULL THEN invalidation_reason_code
    ELSE 'APPROVAL_DENIED'
  END;
  next_authorization_expires_at := CASE
    WHEN final_resolution = 'allow' THEN resolution_time + interval '5 minutes'
    ELSE NULL
  END;

  UPDATE public.pending_approvals approval
  SET status = next_approval_status,
    resolution = final_resolution,
    resolution_source = p_resolution_source,
    resolution_reason = final_reason,
    resolved_by_user_id = CASE
      WHEN p_resolution_source = 'expiry' THEN NULL
      ELSE resolver_user_id
    END,
    resolved_at = resolution_time
  WHERE approval.id = approval_record.id;

  UPDATE public.gateway_requests request
  SET current_decision = final_resolution,
    reason_code = next_reason_code,
    reason = final_reason,
    current_result_updated_at = resolution_time,
    authorized_at = CASE
      WHEN final_resolution = 'allow' THEN resolution_time
      ELSE NULL
    END,
    authorization_expires_at = next_authorization_expires_at
  WHERE request.id = approval_record.gateway_request_id;

  INSERT INTO public.agent_audit_logs (
    organization_id, agent_id, actor_type, actor_id, action, summary,
    decision, tool, amount_cents, payload, occurred_at
  ) VALUES (
    approval_record.organization_id,
    approval_record.agent_id,
    CASE WHEN p_resolution_source = 'expiry' THEN 'system' ELSE 'user' END,
    CASE WHEN p_resolution_source = 'expiry' THEN 'approval-maintenance' ELSE resolver_user_id END,
    CASE WHEN p_resolution_source = 'expiry' THEN 'approval.expired' ELSE 'approval.resolved' END,
    CASE WHEN p_resolution_source = 'expiry'
      THEN 'Approval hold expired'
      WHEN invalidation_reason_code IS NOT NULL
      THEN 'Approval allow invalidated by current authorization policy'
      ELSE 'Approval resolved by authorized reviewer'
    END,
    final_resolution::text,
    approval_record.tool,
    approval_record.amount_cents,
    pg_catalog.jsonb_build_object(
      'approvalId', approval_record.id,
      'gatewayRequestId', approval_record.gateway_request_id,
      'resolutionSource', p_resolution_source,
      'requestedResolution', p_resolution,
      'approvalStatus', next_approval_status,
      'reasonCode', next_reason_code,
      'authorizationExpiresAt', next_authorization_expires_at
    ),
    resolution_time
  );

  RETURN QUERY SELECT approval_record.id,
    approval_record.gateway_request_id, next_approval_status, final_resolution;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_resolve_approval(
  p_approval_id uuid,
  p_resolution public.gateway_decision,
  p_resolution_source public.approval_resolution_source,
  p_reason text
) RETURNS TABLE(
  approval_id uuid,
  gateway_request_id uuid,
  approval_status public.approval_status,
  current_decision public.gateway_decision
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT *
  FROM public.hermes_resolve_approval(
    p_approval_id,
    p_resolution,
    p_resolution_source,
    p_reason,
    NULL::bigint,
    NULL::bigint
  )
$$;--> statement-breakpoint


REVOKE ALL ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text, bigint, bigint) FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text, bigint, bigint) TO hermes_app;
