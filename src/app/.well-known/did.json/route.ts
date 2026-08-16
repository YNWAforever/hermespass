import { didWebForOrigin, issuerDidDocument } from "@/lib/identity/did";
import { issuerOrigin } from "@/lib/env";
import { getPublicIssuerKeys } from "@/lib/agents/service";
import { errorResponse, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const origin = issuerOrigin();
    const did = didWebForOrigin(origin);
    const issuerKeys = await getPublicIssuerKeys(did);
    if (issuerKeys.length === 0)
      return jsonError(request, "ISSUER_NOT_CONFIGURED", "Issuer not configured.", 404);
    return Response.json(
      issuerDidDocument(
        origin,
        issuerKeys.map((issuer) => ({
          keyFragment: issuer.key_fragment,
          publicJwk: issuer.public_jwk as never,
          active: issuer.active,
        })),
      ),
      {
        headers: { "cache-control": "public, max-age=300" },
      },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
