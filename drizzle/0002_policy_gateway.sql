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
        AND "agent_policies"."per_transaction_limit_cents" <= 9007199254740991
        AND "agent_policies"."daily_limit_cents" >= "agent_policies"."per_transaction_limit_cents"
        AND "agent_policies"."daily_limit_cents" <= 9007199254740991
        AND "agent_policies"."monthly_limit_cents" >= "agent_policies"."daily_limit_cents"
        AND "agent_policies"."monthly_limit_cents" <= 9007199254740991
        AND "agent_policies"."approval_threshold_cents" >= 0
        AND "agent_policies"."approval_threshold_cents" <= 9007199254740991
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
	CONSTRAINT "gateway_requests_amount_nonnegative_check" CHECK ("gateway_requests"."amount_cents" IS NULL
        OR ("gateway_requests"."amount_cents" >= 0 AND "gateway_requests"."amount_cents" <= 9007199254740991)),
	CONSTRAINT "gateway_requests_spend_metadata_check" CHECK (("gateway_requests"."amount_cents" IS NULL AND "gateway_requests"."currency" IS NULL AND "gateway_requests"."merchant_category_code" IS NULL)
        OR ("gateway_requests"."amount_cents" IS NOT NULL AND "gateway_requests"."currency" IS NOT NULL
          AND "gateway_requests"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "gateway_requests_allow_hkd_check" CHECK ("gateway_requests"."amount_cents" IS NULL
        OR "gateway_requests"."current_decision" <> 'allow'
        OR ("gateway_requests"."currency" IS NOT NULL AND "gateway_requests"."currency" = 'HKD')),
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
ALTER TABLE "agents" ADD CONSTRAINT "agents_spend_cap_safe_integer_check" CHECK ("agents"."spend_cap_cents" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "agent_audit_logs" ADD CONSTRAINT "agent_audit_logs_amount_safe_integer_check" CHECK ("agent_audit_logs"."amount_cents" IS NULL
        OR "agent_audit_logs"."amount_cents" BETWEEN -9007199254740991 AND 9007199254740991);--> statement-breakpoint
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
  public.pending_approvals, public.telegram_links TO hermes_app;--> statement-breakpoint
GRANT INSERT, UPDATE ON public.agent_policies TO hermes_app;--> statement-breakpoint
GRANT INSERT ON public.gateway_requests TO hermes_app;--> statement-breakpoint
GRANT INSERT ON public.pending_approvals TO hermes_app;--> statement-breakpoint
GRANT UPDATE ON public.telegram_links TO hermes_app;--> statement-breakpoint

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
CREATE POLICY gateway_requests_owner_function_update ON public.gateway_requests
FOR UPDATE TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.gateway_requests'::pg_catalog.regclass
  ))
)
WITH CHECK (
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
CREATE POLICY pending_approvals_owner_function_update ON public.pending_approvals
FOR UPDATE TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.pending_approvals'::pg_catalog.regclass
  ))
)
WITH CHECK (
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
CREATE POLICY agent_key_enrollments_owner_function_insert ON public.agent_key_enrollments
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_key_enrollments'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY agent_key_enrollments_owner_function_update ON public.agent_key_enrollments
FOR UPDATE TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_key_enrollments'::pg_catalog.regclass
  ))
)
WITH CHECK (
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
CREATE POLICY telegram_links_owner_function_insert ON public.telegram_links
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.telegram_links'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY telegram_links_owner_function_update ON public.telegram_links
FOR UPDATE TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.telegram_links'::pg_catalog.regclass
  ))
)
WITH CHECK (
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
CREATE POLICY telegram_link_tokens_owner_function_insert ON public.telegram_link_tokens
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.telegram_link_tokens'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY telegram_link_tokens_owner_function_update ON public.telegram_link_tokens
FOR UPDATE TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.telegram_link_tokens'::pg_catalog.regclass
  ))
)
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.telegram_link_tokens'::pg_catalog.regclass
  ))
);--> statement-breakpoint

CREATE POLICY agent_keys_owner_function_insert ON public.agent_keys
FOR INSERT TO PUBLIC
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_keys'::pg_catalog.regclass
  ))
);--> statement-breakpoint
CREATE POLICY agent_keys_owner_function_update ON public.agent_keys
FOR UPDATE TO PUBLIC
USING (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_keys'::pg_catalog.regclass
  ))
)
WITH CHECK (
  current_user = pg_catalog.pg_get_userbyid((
    SELECT relation.relowner FROM pg_catalog.pg_class relation
    WHERE relation.oid = 'public.agent_keys'::pg_catalog.regclass
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
      AND key.status = 'active'
      AND agent.status = 'active'
      AND agent.expires_at > pg_catalog.clock_timestamp()
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

CREATE FUNCTION public.hermes_create_agent_key_enrollment(
  p_organization_id uuid,
  p_agent_id uuid,
  p_token_hash bytea
) RETURNS TABLE(enrollment_id uuid, expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  caller_user_id text := public.hermes_current_user_id();
  enrollment_issued_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF pg_catalog.octet_length(p_token_hash) <> 32
    OR NOT public.hermes_has_org_role(
      p_organization_id,
      ARRAY['owner', 'admin']::public.member_role[]
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.agents agent
      WHERE agent.id = p_agent_id
        AND agent.organization_id = p_organization_id
        AND agent.status = 'active'
        AND agent.expires_at > enrollment_issued_at
    )
  THEN
    RAISE EXCEPTION 'permission denied for agent key enrollment'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.agent_key_enrollments (
    organization_id,
    agent_id,
    token_hash,
    expires_at,
    created_by_user_id,
    created_at
  ) VALUES (
    p_organization_id,
    p_agent_id,
    p_token_hash,
    enrollment_issued_at + interval '15 minutes',
    caller_user_id,
    enrollment_issued_at
  )
  RETURNING id, agent_key_enrollments.expires_at;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_consume_agent_key_enrollment(
  p_token_hash bytea,
  p_key_fragment text,
  p_public_jwk jsonb,
  p_thumbprint text
) RETURNS TABLE(agent_id uuid, organization_id uuid, key_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  enrollment_record record;
  activated_key_id uuid;
  consumed_time timestamptz;
BEGIN
  IF pg_catalog.octet_length(p_token_hash) <> 32
    OR pg_catalog.length(pg_catalog.btrim(p_key_fragment)) NOT BETWEEN 1 AND 255
    OR pg_catalog.length(pg_catalog.btrim(p_thumbprint)) NOT BETWEEN 1 AND 255
    OR p_public_jwk IS NULL
    OR p_public_jwk = '{}'::jsonb
  THEN
    RAISE EXCEPTION 'AGENT_ENROLLMENT_INVALID' USING ERRCODE = 'P0002';
  END IF;

  SELECT enrollment.id, enrollment.organization_id, enrollment.agent_id,
    enrollment.expires_at, enrollment.consumed_at
  INTO enrollment_record
  FROM public.agent_key_enrollments enrollment
  WHERE enrollment.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND OR enrollment_record.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'AGENT_ENROLLMENT_INVALID' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hermes.agent:' || enrollment_record.agent_id::text,
      0
    )
  );

  consumed_time := pg_catalog.clock_timestamp();

  IF enrollment_record.expires_at <= consumed_time
    OR NOT EXISTS (
      SELECT 1
      FROM public.agents agent
      WHERE agent.id = enrollment_record.agent_id
        AND agent.organization_id = enrollment_record.organization_id
        AND agent.status = 'active'
        AND agent.expires_at > consumed_time
    )
  THEN
    RAISE EXCEPTION 'AGENT_ENROLLMENT_INVALID' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.agent_keys existing_key
  SET status = 'revoked', revoked_at = consumed_time
  WHERE existing_key.agent_id = enrollment_record.agent_id
    AND existing_key.organization_id = enrollment_record.organization_id
    AND existing_key.status = 'active';

  INSERT INTO public.agent_keys (
    agent_id,
    organization_id,
    key_fragment,
    public_jwk,
    thumbprint,
    custody,
    status
  ) VALUES (
    enrollment_record.agent_id,
    enrollment_record.organization_id,
    p_key_fragment,
    p_public_jwk,
    p_thumbprint,
    'external',
    'active'
  )
  RETURNING id INTO activated_key_id;

  UPDATE public.agent_key_enrollments enrollment
  SET consumed_at = consumed_time,
    consumed_key_id = activated_key_id
  WHERE enrollment.id = enrollment_record.id;

  RETURN QUERY SELECT enrollment_record.agent_id,
    enrollment_record.organization_id, activated_key_id;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_create_telegram_link_token(
  p_organization_id uuid,
  p_user_id text,
  p_token_hash bytea
) RETURNS TABLE(link_token_id uuid, expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  caller_user_id text := public.hermes_current_user_id();
  token_issued_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF pg_catalog.octet_length(p_token_hash) <> 32
    OR NOT public.hermes_has_org_role(
      p_organization_id,
      ARRAY['owner', 'admin']::public.member_role[]
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.org_members member
      WHERE member.organization_id = p_organization_id
        AND member.user_id = p_user_id
        AND member.role IN ('owner', 'admin')
    )
  THEN
    RAISE EXCEPTION 'permission denied for Telegram link token'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.telegram_link_tokens (
    organization_id,
    user_id,
    token_hash,
    expires_at,
    created_by_user_id,
    created_at
  ) VALUES (
    p_organization_id,
    p_user_id,
    p_token_hash,
    token_issued_at + interval '10 minutes',
    caller_user_id,
    token_issued_at
  )
  RETURNING telegram_link_tokens.id, telegram_link_tokens.expires_at;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_consume_telegram_link_token(
  p_token_hash bytea,
  p_telegram_user_id bigint,
  p_telegram_chat_id bigint
) RETURNS TABLE(organization_id uuid, user_id text, link_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  token_record record;
  activated_link_id uuid;
  consumed_time timestamptz;
BEGIN
  IF pg_catalog.octet_length(p_token_hash) <> 32
    OR p_telegram_user_id = 0
    OR p_telegram_chat_id = 0
  THEN
    RAISE EXCEPTION 'TELEGRAM_LINK_TOKEN_INVALID' USING ERRCODE = 'P0002';
  END IF;

  SELECT token.id, token.organization_id, token.user_id,
    token.expires_at, token.consumed_at
  INTO token_record
  FROM public.telegram_link_tokens token
  WHERE token.token_hash = p_token_hash
  FOR UPDATE;

  consumed_time := pg_catalog.clock_timestamp();

  IF NOT FOUND
    OR token_record.consumed_at IS NOT NULL
    OR token_record.expires_at <= consumed_time
    OR NOT EXISTS (
      SELECT 1
      FROM public.org_members member
      WHERE member.organization_id = token_record.organization_id
        AND member.user_id = token_record.user_id
        AND member.role IN ('owner', 'admin')
    )
  THEN
    RAISE EXCEPTION 'TELEGRAM_LINK_TOKEN_INVALID' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.telegram_links existing_link
  SET is_active = false, revoked_at = consumed_time
  WHERE existing_link.organization_id = token_record.organization_id
    AND existing_link.user_id = token_record.user_id
    AND existing_link.is_active;

  INSERT INTO public.telegram_links (
    organization_id,
    user_id,
    telegram_user_id,
    telegram_chat_id,
    is_active,
    linked_at
  ) VALUES (
    token_record.organization_id,
    token_record.user_id,
    p_telegram_user_id,
    p_telegram_chat_id,
    true,
    consumed_time
  )
  RETURNING telegram_links.id INTO activated_link_id;

  UPDATE public.telegram_link_tokens token
  SET consumed_at = consumed_time,
    consumed_link_id = activated_link_id
  WHERE token.id = token_record.id;

  RETURN QUERY SELECT token_record.organization_id,
    token_record.user_id, activated_link_id;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_resolve_approval(
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
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  approval_agent_id uuid;
  approval_record record;
  resolver_user_id text := public.hermes_current_user_id();
  resolution_time timestamptz;
  next_approval_status public.approval_status;
BEGIN
  IF p_resolution NOT IN ('allow', 'deny')
    OR pg_catalog.length(pg_catalog.btrim(p_reason)) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid approval resolution' USING ERRCODE = 'P0001';
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
    approval.status, approval.expires_at, request.current_decision
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
    ELSIF p_resolution_source IN ('web', 'telegram') THEN
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
    reason_code = CASE
      WHEN p_resolution_source = 'expiry' THEN 'APPROVAL_EXPIRED'
      WHEN p_resolution = 'allow' THEN 'APPROVAL_APPROVED'
      ELSE 'APPROVAL_DENIED'
    END,
    reason = p_reason,
    current_result_updated_at = resolution_time,
    authorized_at = CASE WHEN p_resolution = 'allow' THEN resolution_time ELSE NULL END,
    authorization_expires_at = CASE
      WHEN p_resolution = 'allow' THEN resolution_time + interval '5 minutes'
      ELSE NULL
    END
  WHERE request.id = approval_record.gateway_request_id;

  RETURN QUERY SELECT approval_record.id,
    approval_record.gateway_request_id, next_approval_status, p_resolution;
END
$$;--> statement-breakpoint

CREATE FUNCTION public.hermes_record_approval_delivery(
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

  SELECT approval.id, approval.status, approval.expires_at,
    approval.telegram_delivery_state, approval.telegram_delivery_attempts
  INTO approval_record
  FROM public.pending_approvals approval
  WHERE approval.id = p_approval_id
  FOR UPDATE;

  attempt_time := pg_catalog.clock_timestamp();

  IF NOT FOUND
    OR approval_record.status <> 'pending'
    OR approval_record.expires_at <= attempt_time
    OR approval_record.telegram_delivery_state = 'sent'
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
      WHEN p_delivery_state IN ('sent', 'failed') THEN attempt_time
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

  RETURN NEXT;
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

  IF NEW.telegram_delivery_attempts < OLD.telegram_delivery_attempts
    OR (
      (OLD.status <> 'pending' OR OLD.telegram_delivery_state = 'sent')
      AND ROW(
        OLD.telegram_delivery_state, OLD.telegram_delivery_attempts,
        OLD.telegram_last_attempt_at, OLD.telegram_delivered_at,
        OLD.telegram_last_error_code
      ) IS DISTINCT FROM ROW(
        NEW.telegram_delivery_state, NEW.telegram_delivery_attempts,
        NEW.telegram_last_attempt_at, NEW.telegram_delivered_at,
        NEW.telegram_last_error_code
      )
    )
  THEN
    RAISE EXCEPTION 'approval delivery state cannot regress'
      USING ERRCODE = 'P0001';
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

  IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    IF NEW.resolution_source = 'expiry' THEN
      IF NEW.resolution <> 'deny'
        OR NEW.resolved_by_user_id IS NOT NULL
        OR pg_catalog.clock_timestamp() < OLD.expires_at
      THEN
        RAISE EXCEPTION 'invalid approval expiry' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      IF pg_catalog.clock_timestamp() >= OLD.expires_at
        OR NEW.resolved_by_user_id IS DISTINCT FROM public.hermes_current_user_id()
      THEN
        RAISE EXCEPTION 'invalid approval resolver or expiry'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.resolution_source = 'owner_override' THEN
        IF NOT public.hermes_has_org_role(
          OLD.organization_id,
          ARRAY['owner']::public.member_role[]
        ) THEN
          RAISE EXCEPTION 'organization owner required for override'
            USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.resolution_source IN ('web', 'telegram') THEN
        IF NOT (
          public.hermes_has_org_role(
            OLD.organization_id,
            ARRAY['owner']::public.member_role[]
          )
          OR (
            NEW.resolved_by_user_id = OLD.assigned_reviewer_user_id
            AND public.hermes_has_org_role(
              OLD.organization_id,
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
    END IF;
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
REVOKE ALL ON FUNCTION public.hermes_create_agent_key_enrollment(uuid, uuid, bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_consume_agent_key_enrollment(bytea, text, jsonb, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_create_telegram_link_token(uuid, text, bytea) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_consume_telegram_link_token(bytea, bigint, bigint) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.hermes_record_approval_delivery(uuid, public.telegram_delivery_state, text) FROM PUBLIC;--> statement-breakpoint
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
GRANT EXECUTE ON FUNCTION public.hermes_create_agent_key_enrollment(uuid, uuid, bytea) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_consume_agent_key_enrollment(bytea, text, jsonb, text) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_create_telegram_link_token(uuid, text, bytea) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_consume_telegram_link_token(bytea, bigint, bigint) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_resolve_approval(uuid, public.gateway_decision, public.approval_resolution_source, text) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_record_approval_delivery(uuid, public.telegram_delivery_state, text) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_lock_policy_version(uuid, uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_next_policy_version(uuid, uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_lock_gateway_decision(uuid) TO hermes_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hermes_lock_approval_resolution(uuid) TO hermes_app;
