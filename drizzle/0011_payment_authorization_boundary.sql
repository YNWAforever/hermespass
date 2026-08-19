-- Payment authorization worker boundary. The pooled runtime receives only
-- narrow, safe projections and may mutate payment rows/audit rows through the
-- reviewed SECURITY DEFINER functions below. No provider payload is returned.
CREATE FUNCTION public.hermes_set_payment_worker_claim() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('role', true) <> 'hermes_app' THEN
    RAISE EXCEPTION 'payment worker claim denied' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('hermes.payment_worker', '1', true);
END
$$;
REVOKE ALL ON FUNCTION public.hermes_set_payment_worker_claim() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_set_payment_worker_claim() TO hermes_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_payment_card_context(
  p_rail text,
  p_rail_card_id text
) RETURNS TABLE(
  wallet_card_id uuid,
  organization_id uuid,
  agent_id uuid,
  rail text,
  rail_card_id text,
  card_currency text,
  card_status text,
  agent_did text,
  agent_status text,
  passport_expires_at timestamptz,
  scopes text[],
  spend_cap_cents bigint,
  risk text,
  key_id uuid,
  key_active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c.id, c.organization_id, c.agent_id, c.rail, c.rail_card_id, c.currency,
    c.status::text, a.did, a.status::text, a.expires_at, a.scopes,
    a.spend_cap_cents, a.risk::text, k.id, (k.status = 'active' AND k.custody = 'external')
  FROM public.wallet_cards c
  JOIN public.agents a ON a.id = c.agent_id AND a.organization_id = c.organization_id
  LEFT JOIN LATERAL (
    SELECT ak.id, ak.status, ak.custody
    FROM public.agent_keys ak
    WHERE ak.agent_id = c.agent_id AND ak.organization_id = c.organization_id
    ORDER BY (ak.status = 'active') DESC, ak.created_at DESC
    LIMIT 1
  ) k ON true
  WHERE c.rail = p_rail AND c.rail_card_id = p_rail_card_id
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.hermes_payment_card_context(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_payment_card_context(text, text) TO hermes_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_payment_mandate_context(
  p_id uuid,
  p_agent_id uuid,
  p_organization_id uuid
) RETURNS TABLE(
  id uuid,
  agent_id uuid,
  organization_id uuid,
  status text,
  currency text,
  max_amount_cents bigint,
  merchant text,
  mcc_allowlist text[],
  expires_at timestamptz,
  one_time boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT m.id, m.agent_id, m.organization_id, m.status::text, m.currency,
    m.max_amount_cents, m.merchant, m.mcc_allowlist, m.expires_at, m.one_time
  FROM public.mandates m
  WHERE m.id = p_id AND m.agent_id = p_agent_id AND m.organization_id = p_organization_id
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.hermes_payment_mandate_context(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_payment_mandate_context(uuid, uuid, uuid) TO hermes_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_consume_payment_mandate(
  p_id uuid,
  p_agent_id uuid,
  p_organization_id uuid,
  p_now timestamptz
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.mandates
  SET status = 'consumed', consumed_at = p_now
  WHERE id = p_id AND agent_id = p_agent_id AND organization_id = p_organization_id
    AND status = 'active' AND one_time = true AND expires_at > p_now;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed > 0;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_consume_payment_mandate(uuid, uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_consume_payment_mandate(uuid, uuid, uuid, timestamptz) TO hermes_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_payment_policy_context(
  p_agent_id uuid,
  p_organization_id uuid
) RETURNS TABLE(
  version integer,
  currency text,
  per_transaction_limit_cents bigint,
  daily_limit_cents bigint,
  monthly_limit_cents bigint,
  approval_threshold_cents bigint,
  mcc_allowlist text[],
  mcc_required boolean,
  assigned_reviewer_user_id text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p.version, p.currency, p.per_transaction_limit_cents,
    p.daily_limit_cents, p.monthly_limit_cents, p.approval_threshold_cents,
    p.mcc_allowlist, p.mcc_required, p.assigned_reviewer_user_id
  FROM public.agent_policies p
  WHERE p.agent_id = p_agent_id AND p.organization_id = p_organization_id AND p.is_active
  ORDER BY p.version DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.hermes_payment_policy_context(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_payment_policy_context(uuid, uuid) TO hermes_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_payment_replay(
  p_rail text,
  p_event_id text,
  p_rail_authorization_id text
) RETURNS TABLE(
  id uuid,
  approved boolean,
  reason_code text,
  reason text,
  mandate_id uuid,
  policy_version integer,
  decided_at timestamptz,
  latency_ms integer,
  fingerprint jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pa.id, pa.decision = 'allow', pa.reason_code, pa.reason, pa.mandate_id,
    pa.policy_version, pa.decided_at, pa.latency_ms,
    jsonb_build_object('rail', pa.rail, 'eventId', pa.event_id,
      'railAuthorizationId', pa.rail_authorization_id, 'railCardId', wc.rail_card_id,
      'mandateId', pa.mandate_id, 'amountCents', pa.amount_cents, 'currency', pa.currency,
      'merchantCategoryCode', pa.merchant_category_code, 'merchantName', pa.merchant_name)
  FROM public.payment_authorizations pa
  JOIN public.wallet_cards wc ON wc.id = pa.wallet_card_id
    AND wc.agent_id = pa.agent_id AND wc.organization_id = pa.organization_id
  WHERE pa.rail = p_rail AND (pa.event_id = p_event_id OR pa.rail_authorization_id = p_rail_authorization_id)
  ORDER BY pa.decided_at DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.hermes_payment_replay(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_payment_replay(text, text, text) TO hermes_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_append_payment_audit(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_setting('hermes.payment_worker', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'payment worker claim required' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.agent_audit_logs(
    organization_id, agent_id, actor_type, actor_id, action, summary,
    decision, tool, amount_cents, payload, occurred_at, hash
  ) VALUES (
    (p_payload->>'organizationId')::uuid,
    (p_payload->>'agentId')::uuid,
    'system', 'payment-worker', p_payload->>'action',
    left(p_payload->>'summary', 280), (p_payload->>'decision')::public.gateway_decision,
    'checkout.external', (p_payload->>'amountCents')::bigint,
    COALESCE(p_payload->'payload', '{}'::jsonb), COALESCE((p_payload->>'occurredAt')::timestamptz, clock_timestamp()),
    decode(repeat('00', 32), 'hex')
  );
END
$$;
REVOKE ALL ON FUNCTION public.hermes_append_payment_audit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_append_payment_audit(jsonb) TO hermes_app;--> statement-breakpoint

-- The worker append is SECURITY DEFINER and runs as the migration-owned
-- table owner under FORCE RLS. Keep its insert path narrow and claim-bound.
CREATE POLICY agent_audit_payment_worker_insert ON public.agent_audit_logs
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner
    FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_audit_logs'::pg_catalog.regclass
  ))
  AND pg_catalog.current_setting('hermes.payment_worker', true) = '1'
  AND actor_type = 'system'
  AND action LIKE 'payment.%'
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_record_payment_authorization(p_payload jsonb)
RETURNS SETOF public.payment_authorizations
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  org_id uuid := nullif(p_payload->>'organizationId', '')::uuid;
  agent_id_value uuid := nullif(p_payload->>'agentId', '')::uuid;
  card_id uuid := nullif(p_payload->>'walletCardId', '')::uuid;
  mandate_id_value uuid := nullif(p_payload->>'mandateId', '')::uuid;
BEGIN
  IF org_id IS NULL OR agent_id_value IS NULL OR card_id IS NULL THEN
    RAISE EXCEPTION 'payment authorization actor denied' USING ERRCODE = '42501';
  END IF;
  IF current_setting('hermes.payment_worker', true) IS DISTINCT FROM '1'
     AND NOT (public.hermes_has_org_role(org_id, ARRAY['owner','admin']::public.member_role[])
       OR public.hermes_current_agent_id() IS NOT DISTINCT FROM agent_id_value) THEN
    RAISE EXCEPTION 'payment authorization actor denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  INSERT INTO public.payment_authorizations (
    organization_id, agent_id, wallet_card_id, rail, event_id,
    rail_authorization_id, amount_cents, currency, merchant_category_code,
    merchant_name, mandate_id, decision, status, reason_code, reason,
    policy_version, latency_ms, received_at, decided_at, reversed_at
  ) VALUES (
    org_id, agent_id_value, card_id, p_payload->>'rail', p_payload->>'eventId',
    p_payload->>'railAuthorizationId', (p_payload->>'amountCents')::bigint,
    p_payload->>'currency', nullif(p_payload->>'merchantCategoryCode', ''),
    nullif(p_payload->>'merchantName', ''), mandate_id_value,
    (p_payload->>'decision')::public.payment_decision,
    (p_payload->>'status')::public.payment_authorization_status,
    p_payload->>'reasonCode', p_payload->>'reason', nullif(p_payload->>'policyVersion', '')::integer,
    (p_payload->>'latencyMs')::integer, (p_payload->>'receivedAt')::timestamptz,
    (p_payload->>'decidedAt')::timestamptz, NULL
  ) ON CONFLICT (rail, event_id) DO UPDATE SET event_id = EXCLUDED.event_id
  RETURNING *;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_record_payment_authorization(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_record_payment_authorization(jsonb) TO hermes_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.hermes_apply_payment_provider_event(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  event_id_value text := nullif(btrim(p_payload->>'eventId'), '');
  rail_value text := nullif(btrim(p_payload->>'rail'), '');
  authorization_id_value text := nullif(btrim(p_payload->>'railAuthorizationId'), '');
  event_type text := nullif(btrim(p_payload->>'type'), '');
  event_status text := lower(nullif(btrim(p_payload->>'status'), ''));
  occurred_value timestamptz := COALESCE((p_payload->>'occurredAt')::timestamptz, clock_timestamp());
  auth_row public.payment_authorizations;
  audit_action text;
  audit_decision public.gateway_decision;
  reversal_value timestamptz;
BEGIN
  IF current_setting('hermes.payment_worker', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'payment worker claim required' USING ERRCODE = '42501';
  END IF;
  IF event_id_value IS NULL OR rail_value IS NULL OR authorization_id_value IS NULL
     OR event_type IS NULL THEN
    RAISE EXCEPTION 'payment provider event is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hermes.payment.event:' || rail_value || ':' || event_id_value, 0)
  );

  SELECT pa.*
  INTO auth_row
  FROM public.payment_authorizations pa
  WHERE pa.rail = rail_value
    AND pa.rail_authorization_id = authorization_id_value
  FOR UPDATE;
  IF auth_row.id IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.agent_audit_logs logs
    WHERE logs.action IN ('payment.provider_event', 'payment.authorization_reversed')
      AND logs.payload->>'eventId' = event_id_value
  ) THEN
    RETURN false;
  END IF;

  audit_action := CASE
    WHEN event_status = 'reversed' OR event_type = 'issuing_transaction.created' AND event_status = 'refunded'
      THEN 'payment.authorization_reversed'
    ELSE 'payment.provider_event'
  END;
  audit_decision := CASE
    WHEN audit_action = 'payment.authorization_reversed' THEN 'deny'::public.gateway_decision
    WHEN auth_row.decision = 'allow' THEN 'allow'::public.gateway_decision
    ELSE 'deny'::public.gateway_decision
  END;
  IF audit_action = 'payment.authorization_reversed' THEN
    reversal_value := GREATEST(occurred_value, auth_row.decided_at);
    UPDATE public.payment_authorizations
    SET decision = 'deny', status = 'reversed', reversed_at = COALESCE(reversed_at, reversal_value)
    WHERE id = auth_row.id;
  END IF;

  PERFORM public.hermes_append_payment_audit(jsonb_build_object(
    'organizationId', auth_row.organization_id,
    'agentId', auth_row.agent_id,
    'action', audit_action,
    'decision', audit_decision::text,
    'amountCents', COALESCE(NULLIF(p_payload->>'amountCents', '')::bigint, auth_row.amount_cents),
    'summary', left(audit_action || ': ' || event_id_value, 280),
    'occurredAt', occurred_value,
    'payload', jsonb_build_object(
      'eventId', event_id_value,
      'railAuthorizationId', authorization_id_value,
      'type', event_type,
      'status', event_status,
      'amountCents', COALESCE(NULLIF(p_payload->>'amountCents', '')::bigint, auth_row.amount_cents),
      'currency', COALESCE(NULLIF(p_payload->>'currency', ''), auth_row.currency)
    )
  ));
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_apply_payment_provider_event(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hermes_apply_payment_provider_event(jsonb) TO hermes_app;