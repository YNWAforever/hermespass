-- Wallet cards reserve provider work before the network call. Permit the
-- provider identifiers to be installed exactly once when that reservation is
-- finalized, and permit a canceled reservation to be reused for an explicit
-- retry. All stable tenant identity fields remain immutable.
DROP TRIGGER wallet_cards_identity_guard ON public.wallet_cards;
--> statement-breakpoint
CREATE FUNCTION public.hermes_wallet_card_identity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment identity rows are append-only' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
    OR NEW.rail IS DISTINCT FROM OLD.rail
  THEN
    RAISE EXCEPTION 'payment identity fields are immutable' USING ERRCODE = 'P0001';
  END IF;

  IF (
    NEW.rail_card_id IS DISTINCT FROM OLD.rail_card_id
    OR NEW.rail_cardholder_id IS DISTINCT FROM OLD.rail_cardholder_id
  ) AND NOT (
      (OLD.status = 'provisioning' AND NEW.status IN ('active', 'canceled'))
      OR (OLD.status = 'canceled' AND NEW.status = 'provisioning')
    )
  THEN
    RAISE EXCEPTION 'payment identity fields are immutable' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.hermes_wallet_card_identity_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER wallet_cards_identity_guard BEFORE UPDATE OR DELETE ON public.wallet_cards
FOR EACH ROW EXECUTE FUNCTION public.hermes_wallet_card_identity_guard();