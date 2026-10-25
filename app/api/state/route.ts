import { apiFailure, apiResponse } from "@/lib/api";
import { getAppState } from "@/lib/store";

export async function GET() {
  try { return apiResponse(await getAppState()); } catch (error) { return apiFailure(error); }
}
