import { ApiError, apiFailure, apiResponse } from '@/lib/api';
import { LOCATION_ATTRIBUTION, LocationLookupError, searchLocations } from '@/lib/location';

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get('q') || '';
    return apiResponse({ locations: await searchLocations(query), attribution: LOCATION_ATTRIBUTION });
  } catch (error) { return apiFailure(error instanceof LocationLookupError ? new ApiError(error.message,error.status) : error); }
}
