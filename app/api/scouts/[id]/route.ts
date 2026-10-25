import { addActivity, updateScout, getScout, getDatabase, listMatches, getSetting, getItem, upsertMatch, reserveAlert, getAlert, addJob, deleteScout, advanceScoutJobs } from "@/lib/store";
import { evaluate, type ScreeningFacts } from '@/lib/screening';
import { applyFreshness } from '@/lib/freshness';
import type { Listing } from '@/lib/types';
import { applyCityScope, LocationLookupError, MARKETPLACE_RETRIEVAL_MILES, needsCityRecheck, resolveLocation, searchScopeKey } from '@/lib/location';
import { ApiError, apiFailure, apiResponse, readPayload, requireSameOrigin, scoutPatch, type RouteContext } from "@/lib/api";

export async function PATCH(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    const input = await readPayload(request, scoutPatch);
    const previous = await getScout(id);
    if (!previous) throw new ApiError('Scout not found.',404);
    const { locationId, radiusMiles: _radius, neighborhood, ...preferences } = input;
    const location = locationId ? await resolveLocation(locationId) : undefined;
    // A legacy neighborhood field is only needed by existing SF clients. Never
    // let it silently override a canonical city selected by a newer client.
    if (!location && neighborhood && previous.location && neighborhood !== previous.neighborhood) throw new ApiError('Choose a city from the search results.');
    const scout = await updateScout(id, { ...preferences, ...(location ? { location, neighborhood: location.label } : neighborhood ? { neighborhood } : {}), radiusMiles: MARKETPLACE_RETRIEVAL_MILES, ...(input.status === "active" ? { nextCheckAt: new Date().toISOString() } : {}) });
    if (!scout) throw new ApiError("Scout not found.", 404);
    const changedSearch = searchScopeKey(scout)!==searchScopeKey(previous);
    if (changedSearch) {
      await getDatabase().batch([getDatabase().prepare('DELETE FROM matches WHERE scout_id = ?').bind(id),getDatabase().prepare('DELETE FROM jobs WHERE scout_id = ?').bind(id)]);
      await updateScout(id,{nextCheckAt:new Date().toISOString(),lastError:null});
    } else if (!input.status) {
      for (const match of await listMatches(id)) {
        const cached = await getSetting<{facts:ScreeningFacts;visualStatus:Listing['visualStatus']}>(`facts:${id}:${match.id}`);
        const item = await getItem(match.id);
        if (!cached || !item) continue;
        const base = await upsertMatch(id,match.id,evaluate(scout,item,cached.facts,cached.visualStatus));
        const assessed=applyFreshness(applyCityScope(base,scout),scout.maxAgeHours);
        if (scout.status==='active' && assessed.freshness?.status==='recent' && assessed.cityCheck?.status==='matches' && !needsCityRecheck(assessed) && (assessed.decision==='strong_fit' || assessed.decision==='needs_checking'&&scout.includeUnknowns)) {
          const alert = await reserveAlert(id,match.id)||await getAlert(id,match.id);
          if(alert?.status==='pending') await addJob({scoutId:id,itemId:match.id,stage:'email',payload:{itemId:match.id},restartDone:true});
        }
      }
      if(input.maxAgeHours!==undefined) {
        // Newly eligible candidates retain their base pending state; repair
        // their completed/skipped detail jobs without resetting sent alerts.
        await advanceScoutJobs(id);
        await updateScout(id,{nextCheckAt:new Date().toISOString(),lastError:null});
      }
    }
    await addActivity(id, "scout_updated", input.status ? `Scout ${input.status === "active" ? "resumed" : input.status}.` : "Scout preferences updated.");
    return apiResponse({ scout });
  } catch (error) { return apiFailure(error instanceof LocationLookupError ? new ApiError(error.message,error.status) : error); }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    if (!await deleteScout(id)) throw new ApiError('Scout not found.',404);
    return apiResponse({deleted:true,id});
  } catch(error) { return apiFailure(error); }
}
