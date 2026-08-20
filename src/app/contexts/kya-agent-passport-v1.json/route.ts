import { HERMES_CONTEXT, VC_CONTEXT } from "@/lib/identity/vc";

export function GET() {
  return Response.json(
    {
      "@context": {
        id: "@id",
        type: "@type",
        KyaAgentPassport: `${HERMES_CONTEXT}#KyaAgentPassport`,
        capabilities: `${HERMES_CONTEXT}#capabilities`,
        ownerOrganization: `${HERMES_CONTEXT}#ownerOrganization`,
        ownerOrganizationSlug: `${HERMES_CONTEXT}#ownerOrganizationSlug`,
        riskTier: `${HERMES_CONTEXT}#riskTier`,
        spendCapHKD: `${HERMES_CONTEXT}#spendCapHKD`,
      },
      credentialContext: VC_CONTEXT,
    },
    {
      headers: {
        "content-type": "application/ld+json; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}
