import { z } from "zod";

import { AuthRequiredError } from "@/lib/auth/errors";
import { getSessionUser } from "@/lib/auth/server";
import { createOrganization } from "@/lib/orgs/service";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const organizationInput = z.object({
  name: z.string(),
  slug: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) throw new AuthRequiredError();
    const input = organizationInput.parse(await request.json());
    return ok(
      {
        organization: await createOrganization(
          { userId: user.id, email: user.email, name: user.name },
          input,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
