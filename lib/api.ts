import { z } from "zod";
import { NEIGHBORHOODS } from "@/lib/types";

export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError("This action must come from the app.", 403);
}

export async function readPayload<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.output<T>> {
  if (Number(request.headers.get("content-length") || 0) > 8_192) throw new ApiError("The request is too large.", 413);
  const text = await request.text();
  if (text.length > 8_192) throw new ApiError("The request is too large.", 413);
  let value: unknown;
  try { value = text ? JSON.parse(text) : {}; } catch { throw new ApiError("Please send a valid request."); }
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(result.error.issues.map((issue) => `${issue.path.join(".") || "Request"}: ${issue.message}`).join("; "));
  return result.data;
}

export function apiResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiFailure(error: unknown): Response {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Something went wrong. Please try again.";
  return apiResponse({ error: message }, error instanceof ApiError ? error.status : 500);
}

const dimension = z.number().finite().positive().max(300).nullable().default(null);
export const scoutInput = z.object({
  query: z.string().trim().min(2, "Enter the item you want.").max(80),
  locationId: z.string().regex(/^[1-9]\d{0,9}$/, 'Choose a city from the search results.').optional(),
  neighborhood: z.enum(Object.keys(NEIGHBORHOODS) as [keyof typeof NEIGHBORHOODS, ...Array<keyof typeof NEIGHBORHOODS>]).optional(),
  // Accepted for older clients; it no longer controls filtering or retrieval.
  radiusMiles: z.number().finite().min(1).max(100).optional(),
  maxWidthIn: dimension,
  maxDepthIn: dimension,
  maxHeightIn: dimension,
  condition: z.enum(["working", "any", "repair"]).default("working"),
  includeUnknowns: z.boolean().default(false),
  maxAgeHours: z.union([z.literal(24),z.literal(168),z.literal(720)]).default(24),
}).strict();

export const scoutPatch = scoutInput.partial().extend({ status: z.enum(["active", "paused", "collected"]).optional() }).strict().refine(v=>Object.keys(v).length>0,'No changes supplied.');
export const listingPatch = z.object({ scoutId: z.string().min(1).max(100), userState: z.enum(["new", "saved", "dismissed"]) }).strict();
export const resaleInput = z.object({ scoutId: z.string().min(1).max(100), forceRefresh: z.boolean().optional() }).strict();
export type RouteContext = { params: Promise<{ id: string }> | { id: string } };
