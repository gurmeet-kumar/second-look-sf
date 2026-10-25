import { apiFailure, apiResponse } from "@/lib/api";
import { tick } from "@/lib/engine";

export async function POST(request: Request) {
  try {
    // This shared updater is protected by the owner-private Sites dispatch boundary.
    // Service callers use OAI-Sites-Authorization; dispatch consumes that header.
    // Before changing the Site to public, replace this with application authentication.
    const body=await request.json().catch(()=>({})) as {verifyOnly?:boolean};
    return apiResponse(await tick({ scheduled: body.verifyOnly!==true }));
  } catch (error) { return apiFailure(error); }
}
