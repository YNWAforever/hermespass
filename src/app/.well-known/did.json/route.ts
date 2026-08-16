import { didWebForOrigin, issuerDidDocument } from "@/lib/identity/did";
import { issuerOrigin } from "@/lib/env";
import { getPublicIssuerKey } from "@/lib/agents/service";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const origin = issuerOrigin();
    const did = didWebForOrigin(origin);
    const issuer = await getPublicIssuerKey(did);
    if (!issuer) return Response.json({ error: "issuer_not_configured" }, { status: 404 });
    return Response.json(
      issuerDidDocument(origin, issuer.public_jwk as never, issuer.key_fragment),
      {
        headers: { "cache-control": "public, max-age=300" },
      },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
