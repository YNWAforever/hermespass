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
  resolver_user_id text := public.hermes_current_user_id();
  resolution_time timestamptz;
  next_approval_status public.approval_status;
  next_reason_code text;
  next_authorization_expires_at timestamptz;
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
    request.tool, request.amount_cents
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

    next_approval_status := CASE
      WHEN p_resolution = 'allow' THEN 'approved'::public.approval_status
      ELSE 'denied'::public.approval_status
    END;
  END IF;

  next_reason_code := CASE
    WHEN p_resolution_source = 'expiry' THEN 'APPROVAL_EXPIRED'
    WHEN p_resolution = 'allow' THEN 'APPROVAL_APPROVED'
    ELSE 'APPROVAL_DENIED'
  END;
  next_authorization_expires_at := CASE
    WHEN p_resolution = 'allow' THEN resolution_time + interval '5 minutes'
    ELSE NULL
  END;

  UPDATE public.pending_approvals approval
  SET status = next_approval_status,
    resolution = p_resolution,
    resolution_source = p_resolution_source,
    resolution_reason = p_reason,
    resolved_by_user_id = CASE
      WHEN p_resolution_source = 'expiry' THEN NULL
      ELSE resolver_user_id
    END,
    resolved_at = resolution_time
  WHERE approval.id = approval_record.id;

  UPDATE public.gateway_requests request
  SET current_decision = p_resolution,
    reason_code = next_reason_code,
    reason = p_reason,
    current_result_updated_at = resolution_time,
    authorized_at = CASE WHEN p_resolution = 'allow' THEN resolution_time ELSE NULL END,
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
      ELSE 'Approval resolved by authorized reviewer'
    END,
    p_resolution::text,
    approval_record.tool,
    approval_record.amount_cents,
    pg_catalog.jsonb_build_object(
      'approvalId', approval_record.id,
      'gatewayRequestId', approval_record.gateway_request_id,
      'resolutionSource', p_resolution_source,
      'approvalStatus', next_approval_status,
      'reasonCode', next_reason_code,
      'authorizationExpiresAt', next_authorization_expires_at
    ),
    resolution_time
  );

  RETURN QUERY SELECT approval_record.id,
    approval_record.gateway_request_id, next_approval_status, p_resolution;
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

CREATE OR REPLACE FUNCTION public.hermes_record_approval_delivery(
  p_approval_id uuid,
  p_delivery_state public.telegram_delivery_state,
  p_error_code text
) RETURNS TABLE(
  approval_id uuid,
  delivery_state public.telegram_delivery_state,
  delivery_attempts integer
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  approval_record record;
  attempt_time timestamptz;
BEGIN
  IF p_delivery_state NOT IN ('pending', 'sent', 'failed')
    OR (p_delivery_state = 'failed' AND (
      p_error_code IS NULL
      OR pg_catalog.length(pg_catalog.btrim(p_error_code)) NOT BETWEEN 1 AND 100
    ))
    OR (p_delivery_state <> 'failed' AND p_error_code IS NOT NULL)
  THEN
    RAISE EXCEPTION 'invalid Telegram delivery update' USING ERRCODE = 'P0001';
  END IF;

  SELECT approval.id, approval.organization_id, approval.agent_id,
    approval.gateway_request_id, approval.status, approval.expires_at,
    approval.telegram_delivery_state, approval.telegram_delivery_attempts,
    approval.telegram_last_attempt_at, request.tool, request.amount_cents
  INTO approval_record
  FROM public.pending_approvals approval
  JOIN public.gateway_requests request
    ON request.id = approval.gateway_request_id
   AND request.agent_id = approval.agent_id
   AND request.organization_id = approval.organization_id
  WHERE approval.id = p_approval_id
  FOR UPDATE OF approval;

  attempt_time := pg_catalog.clock_timestamp();

  IF NOT FOUND
    OR approval_record.status <> 'pending'
    OR approval_record.expires_at <= attempt_time
    OR approval_record.telegram_delivery_state = 'sent'
    OR (
      p_delivery_state = 'pending'
      AND approval_record.telegram_delivery_state = 'pending'
      AND approval_record.telegram_last_attempt_at IS NOT NULL
      AND approval_record.telegram_last_attempt_at >= attempt_time - interval '10 minutes'
    )
    OR (
      p_delivery_state IN ('sent', 'failed')
      AND approval_record.telegram_delivery_state <> 'pending'
    )
  THEN
    RAISE EXCEPTION 'approval delivery is unavailable' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pending_approvals approval
  SET telegram_delivery_state = p_delivery_state,
    telegram_delivery_attempts = CASE
      WHEN p_delivery_state IN ('sent', 'failed')
      THEN approval.telegram_delivery_attempts + 1
      ELSE approval.telegram_delivery_attempts
    END,
    telegram_last_attempt_at = CASE
      WHEN p_delivery_state = 'pending' THEN attempt_time
      ELSE approval.telegram_last_attempt_at
    END,
    telegram_delivered_at = CASE
      WHEN p_delivery_state = 'sent' THEN attempt_time
      ELSE NULL
    END,
    telegram_last_error_code = CASE
      WHEN p_delivery_state = 'failed' THEN p_error_code
      ELSE NULL
    END
  WHERE approval.id = approval_record.id
  RETURNING approval.id, approval.telegram_delivery_state,
    approval.telegram_delivery_attempts
  INTO approval_id, delivery_state, delivery_attempts;

  INSERT INTO public.agent_audit_logs (
    organization_id, agent_id, actor_type, actor_id, action, summary,
    decision, tool, amount_cents, payload, occurred_at
  ) VALUES (
    approval_record.organization_id,
    approval_record.agent_id,
    'system',
    'telegram-delivery',
    'approval.delivery.' || p_delivery_state::text,
    'Telegram approval delivery state updated',
    'hold',
    approval_record.tool,
    approval_record.amount_cents,
    pg_catalog.jsonb_build_object(
      'approvalId', approval_record.id,
      'gatewayRequestId', approval_record.gateway_request_id,
      'deliveryState', p_delivery_state,
      'deliveryAttempts', delivery_attempts,
      'errorCode', p_error_code
    ),
    attempt_time
  );

  RETURN NEXT;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_telegram_reviewer_identity(
  p_approval_id uuid,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint
) RETURNS TABLE(user_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT link.user_id
  FROM public.telegram_links link
  JOIN public.pending_approvals approval
    ON approval.organization_id = link.organization_id
   AND approval.assigned_reviewer_user_id = link.user_id
  JOIN public.org_members member
    ON member.organization_id = link.organization_id
   AND member.user_id = link.user_id
  WHERE approval.id = p_approval_id
    AND approval.status = 'pending'
    AND approval.expires_at > pg_catalog.clock_timestamp()
    AND link.is_active
    AND link.telegram_user_id = p_telegram_user_id
    AND link.telegram_chat_id = p_telegram_chat_id
    AND p_telegram_user_id > 0
    AND p_telegram_chat_id = p_telegram_user_id
    AND member.role IN ('owner', 'admin')
  LIMIT 1
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_approval_delivery_target(
  p_approval_id uuid
) RETURNS TABLE(
  approval_id uuid,
  telegram_chat_id bigint,
  agent_name text,
  tool text,
  summary text,
  amount_cents bigint,
  currency text,
  request_digest bytea,
  expires_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT approval.id, link.telegram_chat_id, agent.name, request.tool,
    request.summary, request.amount_cents, request.currency,
    request.request_digest, approval.expires_at
  FROM public.pending_approvals approval
  JOIN public.gateway_requests request
    ON request.id = approval.gateway_request_id
   AND request.agent_id = approval.agent_id
   AND request.organization_id = approval.organization_id
  JOIN public.agents agent
    ON agent.id = approval.agent_id
   AND agent.organization_id = approval.organization_id
  JOIN public.telegram_links link
    ON link.organization_id = approval.organization_id
   AND link.user_id = approval.assigned_reviewer_user_id
   AND link.is_active
  JOIN public.org_members member
    ON member.organization_id = link.organization_id
   AND member.user_id = link.user_id
  WHERE approval.id = p_approval_id
    AND approval.status = 'pending'
    AND approval.expires_at > pg_catalog.clock_timestamp()
    AND member.role IN ('owner', 'admin')
    AND link.telegram_user_id > 0
    AND link.telegram_chat_id = link.telegram_user_id
    AND (
      approval.telegram_delivery_state = 'not_requested'
      OR (
        approval.telegram_delivery_state IN ('failed', 'pending')
        AND approval.telegram_last_attempt_at IS NOT NULL
        AND approval.telegram_last_attempt_at <
          pg_catalog.clock_timestamp() - interval '10 minutes'
      )
    )
  LIMIT 1
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_try_lock_approval_maintenance() RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('hermes.approval-maintenance', 0)
  )
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_expired_approval_ids()
RETURNS TABLE(approval_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT approval.id
  FROM public.pending_approvals approval
  WHERE approval.status = 'pending'
    AND approval.expires_at <= pg_catalog.clock_timestamp()
  ORDER BY approval.expires_at, approval.id
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_claim_approval_delivery_targets()
RETURNS TABLE(
  approval_id uuid,
  telegram_chat_id bigint,
  agent_name text,
  tool text,
  summary text,
  amount_cents bigint,
  currency text,
  request_digest bytea,
  expires_at timestamptz
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  candidate record;
  maintenance_time timestamptz := pg_catalog.clock_timestamp();
BEGIN
  FOR candidate IN
    SELECT approval.id, link.telegram_chat_id, agent.name AS agent_name,
      request.tool, request.summary, request.amount_cents, request.currency,
      request.request_digest, approval.expires_at
    FROM public.pending_approvals approval
    JOIN public.gateway_requests request
      ON request.id = approval.gateway_request_id
     AND request.agent_id = approval.agent_id
     AND request.organization_id = approval.organization_id
    JOIN public.agents agent
      ON agent.id = approval.agent_id
     AND agent.organization_id = approval.organization_id
    JOIN public.telegram_links link
      ON link.organization_id = approval.organization_id
     AND link.user_id = approval.assigned_reviewer_user_id
     AND link.is_active
     AND link.telegram_user_id > 0
     AND link.telegram_chat_id = link.telegram_user_id
    WHERE approval.status = 'pending'
      AND approval.expires_at > maintenance_time
      AND (
        approval.telegram_delivery_state = 'not_requested'
        OR (
          approval.telegram_delivery_state IN ('failed', 'pending')
          AND approval.telegram_last_attempt_at IS NOT NULL
          AND approval.telegram_last_attempt_at < maintenance_time - interval '10 minutes'
        )
      )
      AND EXISTS (
        SELECT 1
        FROM public.telegram_links link
        JOIN public.org_members member
          ON member.organization_id = link.organization_id
         AND member.user_id = link.user_id
        WHERE link.organization_id = approval.organization_id
          AND link.user_id = approval.assigned_reviewer_user_id
          AND link.is_active
          AND member.role IN ('owner', 'admin')
      )
    ORDER BY approval.created_at, approval.id
    FOR UPDATE OF approval SKIP LOCKED
  LOOP
    PERFORM * FROM public.hermes_record_approval_delivery(
      candidate.id, 'pending'::public.telegram_delivery_state, NULL
    );

    approval_id := candidate.id;
    telegram_chat_id := candidate.telegram_chat_id;
    agent_name := candidate.agent_name;
    tool := candidate.tool;
    summary := candidate.summary;
    amount_cents := candidate.amount_cents;
    currency := candidate.currency;
    request_digest := candidate.request_digest;
    expires_at := candidate.expires_at;
    RETURN NEXT;
  END LOOP;
END
$$;--> statement-breakpoint

CREATE POLICY approval_operations_system_audit_insert
ON public.agent_audit_logs
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner
    FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_audit_logs'::pg_catalog.regclass
  ))
  AND actor_type = 'system'
  AND (
    (actor_id = 'approval-maintenance'
      AND action = 'approval.expired'
      AND decision = 'deny')
    OR
    (actor_id = 'telegram-delivery'
      AND action IN (
        'approval.delivery.pending', 'approval.delivery.sent', 'approval.delivery.failed'
      )
      AND decision = 'hold')
  )
);--> statement-breakpoint

REVOKE ALL ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text, bigint, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_record_approval_delivery(uuid, public.telegram_delivery_state, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_telegram_reviewer_identity(uuid, bigint, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_approval_delivery_target(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_try_lock_approval_maintenance() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_expired_approval_ids() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_claim_approval_delivery_targets() FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text, bigint, bigint) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_record_approval_delivery(uuid, public.telegram_delivery_state, text) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_telegram_reviewer_identity(uuid, bigint, bigint) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_approval_delivery_target(uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_try_lock_approval_maintenance() TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_expired_approval_ids() TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_claim_approval_delivery_targets() TO hermes_app;
