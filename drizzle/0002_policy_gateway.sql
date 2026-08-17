CREATE TYPE "public"."agent_key_custody" AS ENUM('legacy_encrypted', 'external');--> statement-breakpoint
CREATE TYPE "public"."approval_resolution_source" AS ENUM('web', 'telegram', 'expiry', 'owner_override');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'denied', 'expired');--> statement-breakpoint
CREATE TYPE "public"."gateway_decision" AS ENUM('allow', 'deny', 'hold');--> statement-breakpoint
CREATE TYPE "public"."telegram_delivery_state" AS ENUM('not_requested', 'pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "agent_key_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_key_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_key_enrollments_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "agent_key_enrollments_token_hash_length_check" CHECK (octet_length("agent_key_enrollments"."token_hash") = 32),
	CONSTRAINT "agent_key_enrollments_expiry_check" CHECK ("agent_key_enrollments"."expires_at" > "agent_key_enrollments"."created_at"
        AND "agent_key_enrollments"."expires_at" <= "agent_key_enrollments"."created_at" + interval '15 minutes'),
	CONSTRAINT "agent_key_enrollments_consumption_check" CHECK (("agent_key_enrollments"."consumed_at" IS NULL AND "agent_key_enrollments"."consumed_key_id" IS NULL)
        OR ("agent_key_enrollments"."consumed_at" IS NOT NULL
          AND "agent_key_enrollments"."consumed_key_id" IS NOT NULL
          AND "agent_key_enrollments"."consumed_at" >= "agent_key_enrollments"."created_at"
          AND "agent_key_enrollments"."consumed_at" <= "agent_key_enrollments"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "agent_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"currency" text DEFAULT 'HKD' NOT NULL,
	"per_transaction_limit_cents" bigint NOT NULL,
	"daily_limit_cents" bigint NOT NULL,
	"monthly_limit_cents" bigint NOT NULL,
	"approval_threshold_cents" bigint NOT NULL,
	"mcc_allowlist" text[] DEFAULT '{}' NOT NULL,
	"mcc_required" boolean DEFAULT false NOT NULL,
	"assigned_reviewer_user_id" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_policies_id_agent_organization_key" UNIQUE("id","agent_id","organization_id"),
	CONSTRAINT "agent_policies_agent_organization_version_key" UNIQUE("agent_id","organization_id","version"),
	CONSTRAINT "agent_policies_version_positive_check" CHECK ("agent_policies"."version" > 0),
	CONSTRAINT "agent_policies_currency_hkd_check" CHECK ("agent_policies"."currency" = 'HKD'),
	CONSTRAINT "agent_policies_limits_ordered_check" CHECK ("agent_policies"."per_transaction_limit_cents" >= 0
        AND "agent_policies"."daily_limit_cents" >= "agent_policies"."per_transaction_limit_cents"
        AND "agent_policies"."monthly_limit_cents" >= "agent_policies"."daily_limit_cents"
        AND "agent_policies"."approval_threshold_cents" >= 0
        AND "agent_policies"."approval_threshold_cents" <= "agent_policies"."per_transaction_limit_cents"),
	CONSTRAINT "agent_policies_mcc_requirement_check" CHECK (NOT "agent_policies"."mcc_required" OR cardinality("agent_policies"."mcc_allowlist") > 0),
	CONSTRAINT "agent_policies_mcc_values_check" CHECK (cardinality("agent_policies"."mcc_allowlist") = 0
        OR array_to_string("agent_policies"."mcc_allowlist", ',', '<invalid>')
          ~ '^[0-9]{4}(,[0-9]{4})*$'),
	CONSTRAINT "agent_policies_active_state_check" CHECK (("agent_policies"."is_active" AND "agent_policies"."superseded_at" IS NULL)
        OR (NOT "agent_policies"."is_active" AND "agent_policies"."superseded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "gateway_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"request_digest" "bytea" NOT NULL,
	"payload_digest" "bytea" NOT NULL,
	"signature_digest" "bytea" NOT NULL,
	"action_version" text DEFAULT '1' NOT NULL,
	"tool" text NOT NULL,
	"summary" text NOT NULL,
	"justification" text,
	"amount_cents" bigint,
	"currency" text,
	"merchant_category_code" text,
	"signed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "gateway_decision" NOT NULL,
	"current_decision" "gateway_decision" NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"policy_version" integer,
	"decided_at" timestamp with time zone NOT NULL,
	"current_result_updated_at" timestamp with time zone NOT NULL,
	"authorized_at" timestamp with time zone,
	"authorization_expires_at" timestamp with time zone,
	CONSTRAINT "gateway_requests_id_agent_organization_key" UNIQUE("id","agent_id","organization_id"),
	CONSTRAINT "gateway_requests_agent_nonce_key" UNIQUE("agent_id","nonce"),
	CONSTRAINT "gateway_requests_nonce_not_blank_check" CHECK (length(btrim("gateway_requests"."nonce")) BETWEEN 1 AND 255),
	CONSTRAINT "gateway_requests_request_digest_length_check" CHECK (octet_length("gateway_requests"."request_digest") = 32),
	CONSTRAINT "gateway_requests_payload_digest_length_check" CHECK (octet_length("gateway_requests"."payload_digest") = 32),
	CONSTRAINT "gateway_requests_signature_digest_length_check" CHECK (octet_length("gateway_requests"."signature_digest") = 32),
	CONSTRAINT "gateway_requests_action_version_check" CHECK ("gateway_requests"."action_version" = '1'),
	CONSTRAINT "gateway_requests_tool_allowed_check" CHECK ("gateway_requests"."tool" = ANY(ARRAY[
        'catalog.read', 'crm.read', 'refund.issue', 'email.dispatch',
        'checkout.external', 'invoice.approve', 'ads.bid', 'vendor.contract'
      ]::text[])),
	CONSTRAINT "gateway_requests_summary_length_check" CHECK (length(btrim("gateway_requests"."summary")) BETWEEN 1 AND 500),
	CONSTRAINT "gateway_requests_justification_length_check" CHECK ("gateway_requests"."justification" IS NULL OR length("gateway_requests"."justification") <= 2000),
	CONSTRAINT "gateway_requests_reason_fields_check" CHECK (length(btrim("gateway_requests"."reason_code")) BETWEEN 1 AND 100
        AND length(btrim("gateway_requests"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "gateway_requests_mcc_format_check" CHECK ("gateway_requests"."merchant_category_code" IS NULL OR "gateway_requests"."merchant_category_code" ~ '^[0-9]{4}$'),
	CONSTRAINT "gateway_requests_amount_nonnegative_check" CHECK ("gateway_requests"."amount_cents" IS NULL OR "gateway_requests"."amount_cents" >= 0),
	CONSTRAINT "gateway_requests_spend_metadata_check" CHECK (("gateway_requests"."amount_cents" IS NULL AND "gateway_requests"."currency" IS NULL AND "gateway_requests"."merchant_category_code" IS NULL)
        OR ("gateway_requests"."amount_cents" IS NOT NULL AND "gateway_requests"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "gateway_requests_authorization_timing_check" CHECK ((
          "gateway_requests"."current_decision" = 'allow'
          AND "gateway_requests"."authorized_at" IS NOT NULL
          AND "gateway_requests"."authorization_expires_at" > "gateway_requests"."authorized_at"
          AND "gateway_requests"."authorization_expires_at" <= "gateway_requests"."authorized_at" + interval '5 minutes'
        ) OR (
          "gateway_requests"."current_decision" <> 'allow'
          AND "gateway_requests"."authorized_at" IS NULL
          AND "gateway_requests"."authorization_expires_at" IS NULL
        )),
	CONSTRAINT "gateway_requests_result_timing_check" CHECK ("gateway_requests"."decided_at" >= "gateway_requests"."received_at"
        AND "gateway_requests"."current_result_updated_at" >= "gateway_requests"."decided_at"
        AND ("gateway_requests"."authorized_at" IS NULL OR "gateway_requests"."authorized_at" >= "gateway_requests"."decided_at"))
);
--> statement-breakpoint
CREATE TABLE "pending_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"gateway_request_id" uuid NOT NULL,
	"assigned_reviewer_user_id" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"resolution" "gateway_decision",
	"resolution_source" "approval_resolution_source",
	"resolution_reason" text,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"telegram_delivery_state" "telegram_delivery_state" DEFAULT 'not_requested' NOT NULL,
	"telegram_delivery_attempts" integer DEFAULT 0 NOT NULL,
	"telegram_last_attempt_at" timestamp with time zone,
	"telegram_delivered_at" timestamp with time zone,
	"telegram_last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_approvals_request_key" UNIQUE("gateway_request_id"),
	CONSTRAINT "pending_approvals_id_agent_organization_key" UNIQUE("id","agent_id","organization_id"),
	CONSTRAINT "pending_approvals_expiry_check" CHECK ("pending_approvals"."expires_at" > "pending_approvals"."created_at"
        AND "pending_approvals"."expires_at" <= "pending_approvals"."created_at" + interval '4 hours'),
	CONSTRAINT "pending_approvals_resolution_state_check" CHECK ((
          "pending_approvals"."status" = 'pending'
          AND "pending_approvals"."resolution" IS NULL
          AND "pending_approvals"."resolution_source" IS NULL
          AND "pending_approvals"."resolved_by_user_id" IS NULL
          AND "pending_approvals"."resolved_at" IS NULL
        ) OR (
          "pending_approvals"."status" = 'approved'
          AND "pending_approvals"."resolution" = 'allow'
          AND "pending_approvals"."resolution_source" IS NOT NULL
          AND "pending_approvals"."resolved_by_user_id" IS NOT NULL
          AND "pending_approvals"."resolved_at" IS NOT NULL
        ) OR (
          "pending_approvals"."status" = 'denied'
          AND "pending_approvals"."resolution" = 'deny'
          AND "pending_approvals"."resolution_source" IS NOT NULL
          AND "pending_approvals"."resolved_by_user_id" IS NOT NULL
          AND "pending_approvals"."resolved_at" IS NOT NULL
        ) OR (
          "pending_approvals"."status" = 'expired'
          AND "pending_approvals"."resolution" = 'deny'
          AND "pending_approvals"."resolution_source" = 'expiry'
          AND "pending_approvals"."resolved_by_user_id" IS NULL
          AND "pending_approvals"."resolved_at" IS NOT NULL
        )),
	CONSTRAINT "pending_approvals_delivery_attempts_check" CHECK ("pending_approvals"."telegram_delivery_attempts" >= 0),
	CONSTRAINT "pending_approvals_delivery_state_check" CHECK (("pending_approvals"."telegram_delivery_state" = 'sent' AND "pending_approvals"."telegram_delivered_at" IS NOT NULL)
        OR ("pending_approvals"."telegram_delivery_state" <> 'sent' AND "pending_approvals"."telegram_delivered_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_link_id" uuid,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_tokens_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "telegram_link_tokens_token_hash_length_check" CHECK (octet_length("telegram_link_tokens"."token_hash") = 32),
	CONSTRAINT "telegram_link_tokens_expiry_check" CHECK ("telegram_link_tokens"."expires_at" > "telegram_link_tokens"."created_at"
        AND "telegram_link_tokens"."expires_at" <= "telegram_link_tokens"."created_at" + interval '10 minutes'),
	CONSTRAINT "telegram_link_tokens_consumption_check" CHECK (("telegram_link_tokens"."consumed_at" IS NULL AND "telegram_link_tokens"."consumed_link_id" IS NULL)
        OR ("telegram_link_tokens"."consumed_at" IS NOT NULL
          AND "telegram_link_tokens"."consumed_link_id" IS NOT NULL
          AND "telegram_link_tokens"."consumed_at" >= "telegram_link_tokens"."created_at"
          AND "telegram_link_tokens"."consumed_at" <= "telegram_link_tokens"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "telegram_links_id_organization_user_key" UNIQUE("id","organization_id","user_id"),
	CONSTRAINT "telegram_links_active_state_check" CHECK (("telegram_links"."is_active" AND "telegram_links"."revoked_at" IS NULL)
        OR (NOT "telegram_links"."is_active" AND "telegram_links"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "agent_keys" ALTER COLUMN "ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_keys" ALTER COLUMN "iv" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_keys" ALTER COLUMN "wrapped_dek" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_keys" ALTER COLUMN "kek_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_keys" ALTER COLUMN "encryption_algorithm" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD COLUMN "custody" "agent_key_custody" DEFAULT 'legacy_encrypted' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_id_agent_organization_key" UNIQUE("id","agent_id","organization_id");--> statement-breakpoint
ALTER TABLE "org_members" ADD COLUMN "email_snapshot" text;--> statement-breakpoint
ALTER TABLE "org_members" ADD COLUMN "name_snapshot" text;--> statement-breakpoint
ALTER TABLE "agent_key_enrollments" ADD CONSTRAINT "agent_key_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_key_enrollments" ADD CONSTRAINT "agent_key_enrollments_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_key_enrollments" ADD CONSTRAINT "agent_key_enrollments_creator_organization_fk" FOREIGN KEY ("organization_id","created_by_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_key_enrollments" ADD CONSTRAINT "agent_key_enrollments_consumed_key_fk" FOREIGN KEY ("consumed_key_id","agent_id","organization_id") REFERENCES "public"."agent_keys"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_reviewer_organization_fk" FOREIGN KEY ("organization_id","assigned_reviewer_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_creator_organization_fk" FOREIGN KEY ("organization_id","created_by_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_key_agent_organization_fk" FOREIGN KEY ("key_id","agent_id","organization_id") REFERENCES "public"."agent_keys"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_policy_agent_organization_fk" FOREIGN KEY ("agent_id","organization_id","policy_version") REFERENCES "public"."agent_policies"("agent_id","organization_id","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_gateway_agent_organization_fk" FOREIGN KEY ("gateway_request_id","agent_id","organization_id") REFERENCES "public"."gateway_requests"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_reviewer_organization_fk" FOREIGN KEY ("organization_id","assigned_reviewer_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approvals" ADD CONSTRAINT "pending_approvals_resolver_organization_fk" FOREIGN KEY ("organization_id","resolved_by_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_member_organization_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_creator_organization_fk" FOREIGN KEY ("organization_id","created_by_user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_consumed_link_fk" FOREIGN KEY ("consumed_link_id","organization_id","user_id") REFERENCES "public"."telegram_links"("id","organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_member_organization_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."org_members"("organization_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_key_enrollments_agent_expiry_idx" ON "agent_key_enrollments" USING btree ("agent_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_policies_active_agent_key" ON "agent_policies" USING btree ("agent_id") WHERE "agent_policies"."is_active" = true;--> statement-breakpoint
CREATE INDEX "agent_policies_organization_id_idx" ON "agent_policies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_policies_agent_version_idx" ON "agent_policies" USING btree ("agent_id","version");--> statement-breakpoint
CREATE INDEX "gateway_requests_organization_decided_idx" ON "gateway_requests" USING btree ("organization_id","decided_at");--> statement-breakpoint
CREATE INDEX "gateway_requests_agent_authorized_idx" ON "gateway_requests" USING btree ("agent_id","authorized_at");--> statement-breakpoint
CREATE INDEX "pending_approvals_organization_status_idx" ON "pending_approvals" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "pending_approvals_reviewer_status_idx" ON "pending_approvals" USING btree ("assigned_reviewer_user_id","status");--> statement-breakpoint
CREATE INDEX "telegram_link_tokens_member_expiry_idx" ON "telegram_link_tokens" USING btree ("organization_id","user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_active_member_key" ON "telegram_links" USING btree ("organization_id","user_id") WHERE "telegram_links"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_active_user_key" ON "telegram_links" USING btree ("telegram_user_id") WHERE "telegram_links"."is_active" = true;--> statement-breakpoint
CREATE INDEX "telegram_links_organization_id_idx" ON "telegram_links" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_custody_material_check" CHECK ((
        "agent_keys"."custody" = 'legacy_encrypted'
        AND "agent_keys"."ciphertext" IS NOT NULL
        AND "agent_keys"."iv" IS NOT NULL
        AND "agent_keys"."wrapped_dek" IS NOT NULL
        AND "agent_keys"."kek_version" IS NOT NULL
        AND "agent_keys"."encryption_algorithm" IS NOT NULL
      ) OR (
        "agent_keys"."custody" = 'external'
        AND "agent_keys"."ciphertext" IS NULL
        AND "agent_keys"."iv" IS NULL
        AND "agent_keys"."wrapped_dek" IS NULL
        AND "agent_keys"."kek_version" IS NULL
        AND "agent_keys"."encryption_algorithm" IS NULL
      ));--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_email_snapshot_check" CHECK ("org_members"."email_snapshot" IS NULL
        OR (length("org_members"."email_snapshot") BETWEEN 3 AND 320
          AND "org_members"."email_snapshot" !~ '[[:cntrl:]]'));--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_name_snapshot_check" CHECK ("org_members"."name_snapshot" IS NULL
        OR (length(btrim("org_members"."name_snapshot")) BETWEEN 1 AND 200
          AND "org_members"."name_snapshot" !~ '[[:cntrl:]]'));--> statement-breakpoint

-- Re-assert the Phase 1 runtime-role boundary before granting access to the
-- new tables. A contaminated role makes the migration fail closed.
DO $$
DECLARE
  app_role record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolreplication, rolbypassrls, rolcreatedb,
    rolcreaterole, rolinherit
  INTO app_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'hermes_app';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing hermes_app role';
  END IF;

  IF NOT app_role.rolcanlogin OR app_role.rolinherit OR app_role.rolsuper
    OR app_role.rolreplication OR app_role.rolbypassrls
    OR app_role.rolcreatedb OR app_role.rolcreaterole
  THEN
    RAISE EXCEPTION 'unsafe pre-existing hermes_app role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member ON member.oid = membership.member
    WHERE member.rolname = 'hermes_app'
  ) THEN
    RAISE EXCEPTION 'unsafe pre-existing hermes_app role membership';
  END IF;

END
$$;--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM hermes_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO hermes_app;--> statement-breakpoint

REVOKE ALL ON public.agent_policies, public.gateway_requests,
  public.pending_approvals, public.agent_key_enrollments,
  public.telegram_links, public.telegram_link_tokens FROM PUBLIC;--> statement-breakpoint
GRANT SELECT ON public.agent_policies, public.gateway_requests,
  public.pending_approvals, public.agent_key_enrollments,
  public.telegram_links, public.telegram_link_tokens TO hermes_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON public.agent_policies TO hermes_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON public.gateway_requests TO hermes_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON public.pending_approvals TO hermes_app;--> statement-breakpoint
GRANT INSERT ON public.agent_key_enrollments TO hermes_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON public.telegram_links TO hermes_app;--> statement-breakpoint
GRANT INSERT ON public.telegram_link_tokens TO hermes_app;--> statement-breakpoint

REVOKE ALL ON TYPE public.agent_key_custody, public.approval_resolution_source,
  public.approval_status, public.gateway_decision, public.telegram_delivery_state FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON TYPE public.agent_key_custody, public.approval_resolution_source,
  public.approval_status, public.gateway_decision, public.telegram_delivery_state TO hermes_app;--> statement-breakpoint

ALTER TABLE public.agent_policies ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agent_policies FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.gateway_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.gateway_requests FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.pending_approvals FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agent_key_enrollments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.agent_key_enrollments FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.telegram_links FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.telegram_link_tokens FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- FORCE RLS applies to the migration owner too. These policies give only that
-- owner the authoritative read path needed by the narrow SECURITY DEFINER
-- routines below; hermes_app remains constrained by its tenant policies.
CREATE POLICY agent_policies_owner_function_select ON public.agent_policies
FOR SELECT TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_policies'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY gateway_requests_owner_function_select ON public.gateway_requests
FOR SELECT TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.gateway_requests'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY pending_approvals_owner_function_select ON public.pending_approvals
FOR SELECT TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.pending_approvals'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY agent_key_enrollments_owner_function_select ON public.agent_key_enrollments
FOR SELECT TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_key_enrollments'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY telegram_links_owner_function_select ON public.telegram_links
FOR SELECT TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.telegram_links'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY telegram_link_tokens_owner_function_select ON public.telegram_link_tokens
FOR SELECT TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.telegram_link_tokens'::pg_catalog.regclass
  ))
);--> statement-breakpoint

CREATE FUNCTION public.hermes_has_org_role(
  p_organization_id uuid,
  p_roles public.member_role[]
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.hermes_current_user_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.org_members member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = public.hermes_current_user_id()
        AND member.role = ANY(p_roles)
    )
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_current_agent_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.current_setting('hermes.agent_verified', true) = '1'
    THEN nullif(pg_catalog.current_setting('hermes.agent_id', true), '')::uuid
    ELSE NULL::uuid
  END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_current_agent_organization_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.current_setting('hermes.agent_verified', true) = '1'
    THEN nullif(pg_catalog.current_setting('hermes.agent_organization_id', true), '')::uuid
    ELSE NULL::uuid
  END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_current_agent_key_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.current_setting('hermes.agent_verified', true) = '1'
    THEN nullif(pg_catalog.current_setting('hermes.agent_key_id', true), '')::uuid
    ELSE NULL::uuid
  END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_set_verified_agent_claim(
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
  ) THEN
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

CREATE POLICY org_members_admin_roster_select ON public.org_members
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
);--> statement-breakpoint

CREATE POLICY agent_policies_member_or_agent_select ON public.agent_policies
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin', 'viewer']::public.member_role[]
  )
  OR (
    agent_id = public.hermes_current_agent_id()
    AND organization_id = public.hermes_current_agent_organization_id()
  )
);--> statement-breakpoint
CREATE POLICY agent_policies_admin_insert ON public.agent_policies
FOR INSERT TO hermes_app
WITH CHECK (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
  AND created_by_user_id = public.hermes_current_user_id()
);--> statement-breakpoint
CREATE POLICY agent_policies_admin_update ON public.agent_policies
FOR UPDATE TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
)
WITH CHECK (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
);--> statement-breakpoint

CREATE POLICY gateway_requests_member_or_agent_select ON public.gateway_requests
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin', 'viewer']::public.member_role[]
  )
  OR (
    agent_id = public.hermes_current_agent_id()
    AND organization_id = public.hermes_current_agent_organization_id()
  )
);--> statement-breakpoint
CREATE POLICY gateway_requests_verified_agent_insert ON public.gateway_requests
FOR INSERT TO hermes_app
WITH CHECK (
  agent_id = public.hermes_current_agent_id()
  AND organization_id = public.hermes_current_agent_organization_id()
  AND key_id = public.hermes_current_agent_key_id()
);--> statement-breakpoint
CREATE POLICY gateway_requests_reviewer_update ON public.gateway_requests
FOR UPDATE TO hermes_app
USING (
  EXISTS (
    SELECT 1
    FROM public.pending_approvals approval
    WHERE approval.gateway_request_id = gateway_requests.id
      AND approval.organization_id = gateway_requests.organization_id
      AND approval.agent_id = gateway_requests.agent_id
      AND (
        (
          approval.assigned_reviewer_user_id = public.hermes_current_user_id()
          AND public.hermes_has_org_role(
            gateway_requests.organization_id,
            ARRAY['owner', 'admin']::public.member_role[]
          )
        )
        OR public.hermes_has_org_role(
          gateway_requests.organization_id,
          ARRAY['owner']::public.member_role[]
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pending_approvals approval
    WHERE approval.gateway_request_id = gateway_requests.id
      AND approval.organization_id = gateway_requests.organization_id
      AND approval.agent_id = gateway_requests.agent_id
      AND (
        (
          approval.assigned_reviewer_user_id = public.hermes_current_user_id()
          AND public.hermes_has_org_role(
            gateway_requests.organization_id,
            ARRAY['owner', 'admin']::public.member_role[]
          )
        )
        OR public.hermes_has_org_role(
          gateway_requests.organization_id,
          ARRAY['owner']::public.member_role[]
        )
      )
  )
);--> statement-breakpoint

CREATE POLICY pending_approvals_member_or_agent_select ON public.pending_approvals
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin', 'viewer']::public.member_role[]
  )
  OR (
    agent_id = public.hermes_current_agent_id()
    AND organization_id = public.hermes_current_agent_organization_id()
  )
);--> statement-breakpoint
CREATE POLICY pending_approvals_verified_agent_insert ON public.pending_approvals
FOR INSERT TO hermes_app
WITH CHECK (
  agent_id = public.hermes_current_agent_id()
  AND organization_id = public.hermes_current_agent_organization_id()
);--> statement-breakpoint
CREATE POLICY pending_approvals_reviewer_update ON public.pending_approvals
FOR UPDATE TO hermes_app
USING (
  (
    assigned_reviewer_user_id = public.hermes_current_user_id()
    AND public.hermes_has_org_role(
      organization_id,
      ARRAY['owner', 'admin']::public.member_role[]
    )
  )
  OR public.hermes_has_org_role(
    organization_id,
    ARRAY['owner']::public.member_role[]
  )
)
WITH CHECK (
  (
    assigned_reviewer_user_id = public.hermes_current_user_id()
    AND public.hermes_has_org_role(
      organization_id,
      ARRAY['owner', 'admin']::public.member_role[]
    )
  )
  OR public.hermes_has_org_role(
    organization_id,
    ARRAY['owner']::public.member_role[]
  )
);--> statement-breakpoint

CREATE POLICY agent_key_enrollments_member_select ON public.agent_key_enrollments
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
);--> statement-breakpoint
CREATE POLICY agent_key_enrollments_admin_insert ON public.agent_key_enrollments
FOR INSERT TO hermes_app
WITH CHECK (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
  AND created_by_user_id = public.hermes_current_user_id()
);--> statement-breakpoint

CREATE POLICY telegram_links_member_select ON public.telegram_links
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
);--> statement-breakpoint
CREATE POLICY telegram_links_reviewer_insert ON public.telegram_links
FOR INSERT TO hermes_app
WITH CHECK (
  user_id = public.hermes_current_user_id()
  AND public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
);--> statement-breakpoint
CREATE POLICY telegram_links_reviewer_update ON public.telegram_links
FOR UPDATE TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner']::public.member_role[]
  )
  OR (
    user_id = public.hermes_current_user_id()
    AND public.hermes_has_org_role(
      organization_id,
      ARRAY['owner', 'admin']::public.member_role[]
    )
  )
)
WITH CHECK (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner']::public.member_role[]
  )
  OR (
    user_id = public.hermes_current_user_id()
    AND public.hermes_has_org_role(
      organization_id,
      ARRAY['owner', 'admin']::public.member_role[]
    )
  )
);--> statement-breakpoint

CREATE POLICY telegram_link_tokens_member_select ON public.telegram_link_tokens
FOR SELECT TO hermes_app
USING (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
);--> statement-breakpoint
CREATE POLICY telegram_link_tokens_reviewer_insert ON public.telegram_link_tokens
FOR INSERT TO hermes_app
WITH CHECK (
  public.hermes_has_org_role(
    organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  )
  AND created_by_user_id = public.hermes_current_user_id()
  AND EXISTS (
    SELECT 1
    FROM public.org_members reviewer
    WHERE reviewer.organization_id = telegram_link_tokens.organization_id
      AND reviewer.user_id = telegram_link_tokens.user_id
      AND reviewer.role IN ('owner', 'admin')
  )
);--> statement-breakpoint

CREATE POLICY audit_verified_agent_insert ON public.agent_audit_logs
FOR INSERT TO hermes_app
WITH CHECK (
  actor_type = 'agent'
  AND agent_id = public.hermes_current_agent_id()
  AND organization_id = public.hermes_current_agent_organization_id()
  AND actor_id = public.hermes_current_agent_id()::text
);--> statement-breakpoint

CREATE FUNCTION public.hermes_agent_policy_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'agent_policies versions are immutable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.org_members reviewer
      WHERE reviewer.organization_id = NEW.organization_id
        AND reviewer.user_id = NEW.assigned_reviewer_user_id
        AND reviewer.role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'assigned policy reviewer must be an owner or admin'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    OLD.id, OLD.organization_id, OLD.agent_id, OLD.version, OLD.currency,
    OLD.per_transaction_limit_cents, OLD.daily_limit_cents,
    OLD.monthly_limit_cents, OLD.approval_threshold_cents, OLD.mcc_allowlist,
    OLD.mcc_required, OLD.assigned_reviewer_user_id, OLD.created_by_user_id,
    OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organization_id, NEW.agent_id, NEW.version, NEW.currency,
    NEW.per_transaction_limit_cents, NEW.daily_limit_cents,
    NEW.monthly_limit_cents, NEW.approval_threshold_cents, NEW.mcc_allowlist,
    NEW.mcc_required, NEW.assigned_reviewer_user_id, NEW.created_by_user_id,
    NEW.created_at
  ) OR NOT (
    OLD.is_active
    AND NOT NEW.is_active
    AND OLD.superseded_at IS NULL
    AND NEW.superseded_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'agent_policies versions are immutable' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_gateway_request_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'gateway request identity is immutable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.decision IS DISTINCT FROM NEW.current_decision THEN
      RAISE EXCEPTION 'gateway initial and current decisions must match'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    OLD.id, OLD.organization_id, OLD.agent_id, OLD.key_id, OLD.nonce,
    OLD.request_digest, OLD.payload_digest, OLD.signature_digest,
    OLD.action_version, OLD.tool, OLD.summary, OLD.justification,
    OLD.amount_cents, OLD.currency, OLD.merchant_category_code,
    OLD.signed_at, OLD.received_at, OLD.decision, OLD.policy_version,
    OLD.decided_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organization_id, NEW.agent_id, NEW.key_id, NEW.nonce,
    NEW.request_digest, NEW.payload_digest, NEW.signature_digest,
    NEW.action_version, NEW.tool, NEW.summary, NEW.justification,
    NEW.amount_cents, NEW.currency, NEW.merchant_category_code,
    NEW.signed_at, NEW.received_at, NEW.decision, NEW.policy_version,
    NEW.decided_at
  ) OR OLD.current_decision <> 'hold'
    OR NEW.current_decision NOT IN ('allow', 'deny')
    OR NEW.current_result_updated_at < OLD.current_result_updated_at
  THEN
    RAISE EXCEPTION 'gateway request identity is immutable' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.pending_approvals approval
    WHERE approval.gateway_request_id = NEW.id
      AND approval.organization_id = NEW.organization_id
      AND approval.agent_id = NEW.agent_id
      AND (
        (approval.status = 'approved' AND NEW.current_decision = 'allow')
        OR (approval.status IN ('denied', 'expired') AND NEW.current_decision = 'deny')
      )
  ) THEN
    RAISE EXCEPTION 'gateway result requires a matching approval resolution'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_pending_approval_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'pending approval identity is immutable' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
      OR NOT EXISTS (
        SELECT 1
        FROM public.org_members reviewer
        WHERE reviewer.organization_id = NEW.organization_id
          AND reviewer.user_id = NEW.assigned_reviewer_user_id
          AND reviewer.role IN ('owner', 'admin')
      )
      OR NOT EXISTS (
        SELECT 1
        FROM public.gateway_requests request
        WHERE request.id = NEW.gateway_request_id
          AND request.agent_id = NEW.agent_id
          AND request.organization_id = NEW.organization_id
          AND request.decision = 'hold'
          AND request.current_decision = 'hold'
      )
    THEN
      RAISE EXCEPTION 'invalid pending approval assignment or gateway state'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    OLD.id, OLD.organization_id, OLD.agent_id, OLD.gateway_request_id,
    OLD.assigned_reviewer_user_id, OLD.expires_at, OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organization_id, NEW.agent_id, NEW.gateway_request_id,
    NEW.assigned_reviewer_user_id, NEW.expires_at, NEW.created_at
  ) THEN
    RAISE EXCEPTION 'pending approval identity is immutable' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status <> 'pending' AND ROW(
    OLD.status, OLD.resolution, OLD.resolution_source, OLD.resolution_reason,
    OLD.resolved_by_user_id, OLD.resolved_at
  ) IS DISTINCT FROM ROW(
    NEW.status, NEW.resolution, NEW.resolution_source, NEW.resolution_reason,
    NEW.resolved_by_user_id, NEW.resolved_at
  ) THEN
    RAISE EXCEPTION 'approval resolution is single-use' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_agent_key_enrollment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.consumed_at IS NOT NULL
    OR ROW(
      OLD.id, OLD.organization_id, OLD.agent_id, OLD.token_hash,
      OLD.expires_at, OLD.created_by_user_id, OLD.created_at
    ) IS DISTINCT FROM ROW(
      NEW.id, NEW.organization_id, NEW.agent_id, NEW.token_hash,
      NEW.expires_at, NEW.created_by_user_id, NEW.created_at
    ) OR NEW.consumed_at IS NULL OR NEW.consumed_key_id IS NULL
  THEN
    RAISE EXCEPTION 'agent key enrollment is immutable and single-use'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_telegram_link_token_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.consumed_at IS NOT NULL
    OR ROW(
      OLD.id, OLD.organization_id, OLD.user_id, OLD.token_hash,
      OLD.expires_at, OLD.created_by_user_id, OLD.created_at
    ) IS DISTINCT FROM ROW(
      NEW.id, NEW.organization_id, NEW.user_id, NEW.token_hash,
      NEW.expires_at, NEW.created_by_user_id, NEW.created_at
    ) OR NEW.consumed_at IS NULL OR NEW.consumed_link_id IS NULL
  THEN
    RAISE EXCEPTION 'Telegram link token is immutable and single-use'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_telegram_link_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(
    OLD.id, OLD.organization_id, OLD.user_id, OLD.telegram_user_id,
    OLD.telegram_chat_id, OLD.linked_at
  ) IS DISTINCT FROM ROW(
    NEW.id, NEW.organization_id, NEW.user_id, NEW.telegram_user_id,
    NEW.telegram_chat_id, NEW.linked_at
  ) OR NOT (
    OLD.is_active
    AND NOT NEW.is_active
    AND OLD.revoked_at IS NULL
    AND NEW.revoked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Telegram link identity is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER agent_policies_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.agent_policies
FOR EACH ROW EXECUTE FUNCTION public.hermes_agent_policy_guard();--> statement-breakpoint
CREATE TRIGGER gateway_requests_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.gateway_requests
FOR EACH ROW EXECUTE FUNCTION public.hermes_gateway_request_guard();--> statement-breakpoint
CREATE TRIGGER pending_approvals_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.pending_approvals
FOR EACH ROW EXECUTE FUNCTION public.hermes_pending_approval_guard();--> statement-breakpoint
CREATE TRIGGER agent_key_enrollments_guard
BEFORE UPDATE OR DELETE ON public.agent_key_enrollments
FOR EACH ROW EXECUTE FUNCTION public.hermes_agent_key_enrollment_guard();--> statement-breakpoint
CREATE TRIGGER telegram_link_tokens_guard
BEFORE UPDATE OR DELETE ON public.telegram_link_tokens
FOR EACH ROW EXECUTE FUNCTION public.hermes_telegram_link_token_guard();--> statement-breakpoint
CREATE TRIGGER telegram_links_guard
BEFORE UPDATE OR DELETE ON public.telegram_links
FOR EACH ROW EXECUTE FUNCTION public.hermes_telegram_link_guard();--> statement-breakpoint

CREATE FUNCTION public.hermes_lock_policy_version(
  p_agent_id uuid,
  p_organization_id uuid
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT public.hermes_has_org_role(
    p_organization_id,
    ARRAY['owner', 'admin']::public.member_role[]
  ) OR NOT EXISTS (
    SELECT 1 FROM public.agents agent
    WHERE agent.id = p_agent_id
      AND agent.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'permission denied for policy version allocation'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hermes.agent:' || p_agent_id::text, 0)
  );
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_next_policy_version(
  p_agent_id uuid,
  p_organization_id uuid
) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  next_version integer;
BEGIN
  PERFORM public.hermes_lock_policy_version(p_agent_id, p_organization_id);

  SELECT coalesce(pg_catalog.max(policy.version), 0) + 1
  INTO next_version
  FROM public.agent_policies policy
  WHERE policy.agent_id = p_agent_id
    AND policy.organization_id = p_organization_id;

  RETURN next_version;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_lock_gateway_decision(p_agent_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_agent_id IS DISTINCT FROM public.hermes_current_agent_id() THEN
    RAISE EXCEPTION 'verified agent claim required for gateway lock'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hermes.agent:' || p_agent_id::text, 0)
  );
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_lock_approval_resolution(p_agent_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  agent_organization_id uuid;
BEGIN
  SELECT agent.organization_id
  INTO agent_organization_id
  FROM public.agents agent
  WHERE agent.id = p_agent_id;

  IF agent_organization_id IS NULL OR NOT (
    public.hermes_has_org_role(
      agent_organization_id,
      ARRAY['owner']::public.member_role[]
    ) OR EXISTS (
      SELECT 1
      FROM public.pending_approvals approval
      WHERE approval.agent_id = p_agent_id
        AND approval.organization_id = agent_organization_id
        AND approval.status = 'pending'
        AND approval.assigned_reviewer_user_id = public.hermes_current_user_id()
        AND public.hermes_has_org_role(
          agent_organization_id,
          ARRAY['owner', 'admin']::public.member_role[]
        )
    )
  ) THEN
    RAISE EXCEPTION 'reviewer claim required for approval lock'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hermes.agent:' || p_agent_id::text, 0)
  );
END
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.hermes_has_org_role(uuid, public.member_role[]) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_current_agent_id() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_current_agent_organization_id() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_current_agent_key_id() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_set_verified_agent_claim(uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_agent_policy_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_gateway_request_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_pending_approval_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_agent_key_enrollment_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_telegram_link_token_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_telegram_link_guard() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_lock_policy_version(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_next_policy_version(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_lock_gateway_decision(uuid) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_lock_approval_resolution(uuid) FROM PUBLIC;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.hermes_has_org_role(uuid, public.member_role[]) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_current_agent_id() TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_current_agent_organization_id() TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_current_agent_key_id() TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_set_verified_agent_claim(uuid, uuid, uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_lock_policy_version(uuid, uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_next_policy_version(uuid, uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_lock_gateway_decision(uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_lock_approval_resolution(uuid) TO hermes_app;
