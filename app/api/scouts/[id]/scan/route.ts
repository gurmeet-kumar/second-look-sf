import { z } from 'zod';
import { ApiError, apiFailure, apiResponse, readPayload, requireSameOrigin, type RouteContext } from "@/lib/api";
import { tick } from "@/lib/engine";
import { getScout } from "@/lib/store";

export async function POST(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    const scout = await getScout(id);
    if (!scout) throw new ApiError("Scout not found.", 404);
    if (scout.status !== "active") throw new ApiError("Resume this scout before checking for listings.");
    const input = await readPayload(request, z.object({ continueOnly: z.boolean().optional() }).strict());
    return apiResponse(await tick({ forceScoutId: id, continueOnly: input.continueOnly === true }));
  } catch (error) { return apiFailure(error); }
}
