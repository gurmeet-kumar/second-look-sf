import { ApiError, apiFailure, apiResponse, requireSameOrigin, type RouteContext } from '@/lib/api';
import { restoreScout } from '@/lib/store';

export async function POST(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    const scout = await restoreScout(id);
    if (!scout) throw new ApiError('Scout not found.',404);
    return apiResponse({scout});
  } catch(error) { return apiFailure(error); }
}
