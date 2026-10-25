import { apiFailure, apiResponse, readPayload, requireSameOrigin, resaleInput, type RouteContext } from "@/lib/api";
import { resale } from "@/lib/engine";

export async function POST(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    const input = await readPayload(request, resaleInput);
    return apiResponse({ resale: await resale(input.scoutId, id, { forceRefresh: input.forceRefresh }) });
  } catch (error) { return apiFailure(error); }
}
