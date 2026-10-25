export type Decision = 'strong_fit' | 'needs_checking' | 'rejected' | 'pending';
export type ScoutLocation = { id: string; label: string; city: string; state: string; countryCode: 'US'; latitude: number; longitude: number };
export type Scout = {
  id: string; query: string; neighborhood: string; radiusMiles: number;
  location?: ScoutLocation;
  maxWidthIn: number | null; maxDepthIn: number | null; maxHeightIn: number | null;
  condition: 'working' | 'any' | 'repair'; includeUnknowns: boolean; email: string;
  maxAgeHours?: number;
  status: 'active' | 'paused' | 'collected' | 'deleted'; createdAt: string;
  lastCheckAt: string | null; lastSuccessAt: string | null; nextCheckAt: string | null;
  lastError: string | null;
};
export type Evidence = { field: string; text: string; source: 'description' | 'attribute' | 'photo' };
export type Dimensions = { widthIn: number | null; depthIn: number | null; heightIn: number | null };
export type Comparable = { id: string; title: string; price: number; url: string; conditionNote: string; city?: string; postedAt?: string; matchNote?: string };
export type ResaleReference = {
  status: 'ready' | 'insufficient'; low: number | null; high: number | null;
  count: number; comps: Comparable[]; queriedAt: string; note: string;
  basis?: 'exact_model' | 'similar_items'; confidence?: 'model_match' | 'low';
  query?: string; geography?: 'San Francisco'; version?: 2;
};
export type Listing = {
  id: string; scoutId: string; url: string; title: string; description: string;
  price: number | null; city: string; photo: string | null; photos: string[];
  sourceCity?: string | null; sourceState?: string | null;
  cityCheck?: { status: 'matches' | 'mismatch' | 'unconfirmed'; summary: string };
  firstSeenAt: string; sourceCreatedAt: string | null; decision: Decision;
  sourceDateText?: string | null; sourceDateObservedAt?: string | null;
  freshness?: { status: 'recent' | 'older' | 'unknown'; maxAgeHours: number; ageHours: number | null };
  requestedFeatureCheck?: { label: string; status: 'supported' | 'mismatch' | 'unconfirmed'; summary: string; quote?: string };
  screeningDecision?: Decision; screeningReasons?: string[]; screeningUnknowns?: string[]; screeningQuestions?: string[];
  reasons: string[]; unknowns: string[]; questions: string[]; evidence: Evidence[];
  dimensions: Dimensions; brand: string | null; model: string | null;
  conditionNote: string | null; visualNote: string | null;
  visualStatus: 'assessed' | 'unavailable' | 'not_requested'; distanceMiles: number | null;
  userState: 'new' | 'saved' | 'dismissed'; resale: ResaleReference | null;
};
export type Activity = { id: string; scoutId: string | null; type: string; message: string; createdAt: string };
export type SystemStatus = { demoEmail: string; schedulerStatus: string; lastWorkerAt: string | null; creditsRemaining: number | null; requestsUsed: number; requestBudget: number; modelAvailable: boolean };
export type AppState = { scouts: Scout[]; deletedScouts: Scout[]; listings: Listing[]; activity: Activity[]; system: SystemStatus };
export type RawItem = {
  id: string; url: string; title: string; description?: string;
  price?: { amount?: number; currency?: string; formatted_amount?: string; formatted_amount_zeros_stripped?: string };
  location?: { latitude?: number; longitude?: number; city?: string; display_name?: string; state?: string; state_code?: string };
  location_text?: string; primary_photo?: { url?: string }; photos?: { url: string }[];
  attributes?: { attribute_name: string; label?: string; value?: string }[];
  creation_time?: string | number | null; listing_date_text?: string | null; source_date_observed_at?: string | null;
  is_sold?: boolean; is_pending?: boolean; is_hidden?: boolean; is_live?: boolean;
  delivery_types?: string[]; is_shipping_offered?: boolean;
};
export type Job = { id: string; scoutId: string; itemId: string | null; stage: 'detail' | 'screen' | 'email'; payload: string; attempts: number; nextAt: string; leaseUntil: string | null; createdAt: string };
export const NEIGHBORHOODS = {
  'Mission District': { lat: 37.7599, lng: -122.4148 },
  'SoMa': { lat: 37.7785, lng: -122.4056 },
  'Sunset': { lat: 37.7534, lng: -122.4944 },
  'Richmond': { lat: 37.7807, lng: -122.4784 },
  'Marina': { lat: 37.8037, lng: -122.4368 },
  'Pacific Heights': { lat: 37.7925, lng: -122.4382 },
  'Noe Valley': { lat: 37.7502, lng: -122.4337 },
  'San Francisco': { lat: 37.7749, lng: -122.4194 },
} as const;
