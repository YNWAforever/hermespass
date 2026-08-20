import { createPostgresApprovalMaintenanceStore } from "@/lib/approvals/maintenance-store";
import { createPostgresApprovalStore } from "@/lib/approvals/postgres-store";
import {
  ApprovalServiceError,
  resolveApproval,
  type ApprovalResolutionStore,
} from "@/lib/approvals/service";
import { finishClaimedTelegramDelivery } from "@/lib/telegram/claimed-delivery";
import { createPostgresTelegramDeliveryStore } from "@/lib/telegram/delivery-store";
import {
  createConfiguredTelegramSender,
  TelegramDeliveryStore,
  TelegramDeliveryTarget,
  TelegramSender,
} from "@/lib/telegram/delivery";

export type ApprovalMaintenanceBatch = {
  acquired: boolean;
  expiredApprovalIds: string[];
  deliveryTargets: TelegramDeliveryTarget[];
};

export interface ApprovalMaintenanceStore {
  claim(): Promise<ApprovalMaintenanceBatch>;
}

export type ApprovalMaintenanceResult = {
  acquired: boolean;
  expired: number;
  expiryRaces: number;
  delivered: number;
  deliveryFailures: number;
};

type Dependencies = {
  store: ApprovalMaintenanceStore;
  approvalStore: ApprovalResolutionStore;
  deliveryStore: TelegramDeliveryStore;
  sender: TelegramSender;
};

export async function runApprovalMaintenance(
  dependencies: Dependencies = {
    store: createPostgresApprovalMaintenanceStore(),
    approvalStore: createPostgresApprovalStore(),
    deliveryStore: createPostgresTelegramDeliveryStore(),
    sender: createConfiguredTelegramSender(),
  },
): Promise<ApprovalMaintenanceResult> {
  const batch = await dependencies.store.claim();
  const result: ApprovalMaintenanceResult = {
    acquired: batch.acquired,
    expired: 0,
    expiryRaces: 0,
    delivered: 0,
    deliveryFailures: 0,
  };
  if (!batch.acquired) return result;

  for (const approvalId of batch.expiredApprovalIds) {
    try {
      await resolveApproval(
        {
          approvalId,
          decision: "deny",
          source: "expiry",
          actorUserId: null,
          reason: "Approval hold expired after four hours.",
        },
        dependencies.approvalStore,
      );
      result.expired += 1;
    } catch (error) {
      if (error instanceof ApprovalServiceError && error.code === "APPROVAL_UNAVAILABLE") {
        result.expiryRaces += 1;
        continue;
      }
      throw error;
    }
  }

  for (const deliveryTarget of batch.deliveryTargets) {
    const delivery = await finishClaimedTelegramDelivery(deliveryTarget, {
      store: dependencies.deliveryStore,
      sender: dependencies.sender,
    });
    if (delivery.state === "sent") result.delivered += 1;
    else result.deliveryFailures += 1;
  }

  return result;
}
