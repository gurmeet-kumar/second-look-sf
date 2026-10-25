import { ApiError, apiFailure, apiResponse, listingPatch, readPayload, requireSameOrigin, type RouteContext } from "@/lib/api";
import { getMatch, updateMatchState } from "@/lib/store";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    const input = await readPayload(request, listingPatch);
    if (!await updateMatchState(id, input.userState, input.scoutId)) throw new ApiError("Listing not found.", 404);
    return apiResponse({ listing: await getMatch(input.scoutId, id) });
  } catch (error) { return apiFailure(error); }
}
