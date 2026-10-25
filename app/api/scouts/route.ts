import { ApiError, apiFailure, apiResponse, readPayload, requireSameOrigin, scoutInput } from "@/lib/api";
import { createScout } from "@/lib/store";
import { resolveLocation, LocationLookupError, MARKETPLACE_RETRIEVAL_MILES } from '@/lib/location';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const input = await readPayload(request, scoutInput);
    const { locationId, radiusMiles: _radius, neighborhood, ...preferences } = input;
    if (!locationId && !neighborhood) throw new ApiError('Choose a city from the search results.');
    const location = locationId ? await resolveLocation(locationId) : undefined;
    return apiResponse({ scout: await createScout({ ...preferences, neighborhood: location?.label || neighborhood!, ...(location ? { location } : {}), radiusMiles: MARKETPLACE_RETRIEVAL_MILES }) }, 201);
  } catch (error) { return apiFailure(error instanceof LocationLookupError ? new ApiError(error.message,error.status) : error); }
}
