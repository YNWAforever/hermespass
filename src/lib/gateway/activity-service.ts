import type { Actor } from "@/lib/auth/authorization";
import { createPostgresGatewayActivityStore } from "@/lib/gateway/activity-postgres-store";
import type { GatewayActivityResponse } from "@/lib/gateway/activity-types";

export interface GatewayActivityStore {
  list(actorUserId: string, organizationId: string): Promise<GatewayActivityResponse>;
}

export async function listGatewayActivity(
  actor: Actor,
  store: GatewayActivityStore = createPostgresGatewayActivityStore(),
): Promise<GatewayActivityResponse> {
  return store.list(actor.userId, actor.organizationId);
}
