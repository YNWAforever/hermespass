-- Additive boundary for signed-agent mandate issuance under the existing verified-agent claim.
CREATE POLICY mandates_verified_agent_select ON public.mandates
FOR SELECT TO hermes_app
USING (
  agent_id = public.hermes_current_agent_id()
  AND organization_id = public.hermes_current_agent_organization_id()
  AND key_id = public.hermes_current_agent_key_id()
);--> statement-breakpoint
CREATE POLICY mandates_verified_agent_insert ON public.mandates
FOR INSERT TO hermes_app
WITH CHECK (
  agent_id = public.hermes_current_agent_id()
  AND organization_id = public.hermes_current_agent_organization_id()
  AND key_id = public.hermes_current_agent_key_id()
);
