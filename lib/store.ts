import { env } from "cloudflare:workers";
import type { Activity, AppState, Job, Listing, RawItem, Scout } from "@/lib/types";
import { applyFreshness, DEFAULT_MAX_AGE_HOURS, sourcePostedAt } from './freshness';
import { applyRequirementChecks } from './requirements';
import { applyCityScope, sourceCityMetadata } from './location';

type Row = Record<string, unknown>;
export type NewScout = Pick<Scout, "query" | "neighborhood" | "radiusMiles" | "maxWidthIn" | "maxDepthIn" | "maxHeightIn" | "condition" | "includeUnknowns" | "maxAgeHours" | "location">;
export type Alert = { id: string; scoutId: string; itemId: string; type: string; status: string; providerId: string | null; error: string | null; createdAt: string };

export function getDatabase(): D1Database {
  if (!env.DB) throw new Error("The database is not connected. Deploy the database migration before starting a scout.");
  return env.DB;
}

const json = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const iso = (value: unknown): string => new Date(Number(value)).toISOString();
const timestamp = (value: string | null | undefined, fallback = Date.now()): number => value ? new Date(value).getTime() : fallback;
const scoutDefaults = (scout: Scout): Scout => ({...scout,maxAgeHours:scout.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS});

export async function createScout(input: NewScout): Promise<Scout> {
  const count = await getDatabase().prepare("SELECT COUNT(*) AS count FROM scouts WHERE status <> 'deleted'").first<{ count: number }>();
  if ((count?.count ?? 0) >= 3) throw new Error("The demo supports three scouts. Edit an existing scout to try a different search.");
  const now = new Date().toISOString();
  const scout: Scout = { ...input, maxAgeHours:input.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS, id: crypto.randomUUID(), email: env.DEMO_EMAIL || "", status: "active", createdAt: now, lastCheckAt: null, lastSuccessAt: null, nextCheckAt: now, lastError: null };
  const inserted = await getDatabase().prepare("INSERT INTO scouts (id, data, status, next_run_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM scouts WHERE status <> 'deleted') < 3").bind(scout.id, JSON.stringify(scout), scout.status, Date.now(), Date.now(), Date.now()).run();
  if (!inserted.meta.changes) throw new Error("The demo supports three scouts. Edit an existing scout to try a different search.");
  await addActivity(scout.id, "scout_created", `Started watching for ${scout.query}.`);
  return scout;
}

export async function listScouts(deleted = false): Promise<Scout[]> {
  const result = await getDatabase().prepare(`SELECT data FROM scouts WHERE status ${deleted ? '=' : '<>'} 'deleted' ORDER BY created_at DESC`).all<{ data: string }>();
  return result.results.map((row) => scoutDefaults(json<Scout>(row.data)));
}

export async function getScout(id: string, includeDeleted = false): Promise<Scout | null> {
  const row = await getDatabase().prepare(`SELECT data FROM scouts WHERE id = ? ${includeDeleted ? '' : "AND status <> 'deleted'"}`).bind(id).first<{ data: string }>();
  return row ? scoutDefaults(json<Scout>(row.data)) : null;
}

export async function updateScout(id: string, patch: Partial<Scout>): Promise<Scout | null> {
  // Patch only supplied fields atomically: an in-flight scan must not overwrite a
  // newly paused/deleted status or restore an older copy of the user's brief.
  const fields = Object.entries(patch).filter(([key,value]) => !['id','email','createdAt'].includes(key) && value !== undefined);
  if (!fields.length) return getScout(id);
  if (patch.status === 'deleted') throw new Error('Use deleteScout to stop work and remove this scout.');
  const values: (string | number | null)[] = [];
  const jsonFields = fields.map(([key,value]) => { values.push(`$.${key}`,JSON.stringify(value)); return '?, json(?)'; });
  const columns = [`data = json_set(data, ${jsonFields.join(', ')})`];
  if (patch.status !== undefined) { columns.push('status = ?'); values.push(patch.status); }
  if (patch.nextCheckAt !== undefined) { columns.push('next_run_at = ?'); values.push(timestamp(patch.nextCheckAt,Date.now()+600_000)); }
  columns.push('updated_at = ?'); values.push(Date.now(),id);
  const row = await getDatabase().prepare(`UPDATE scouts SET ${columns.join(', ')} WHERE id = ? AND status <> 'deleted' RETURNING data`).bind(...values).first<{data:string}>();
  return row ? scoutDefaults(json<Scout>(row.data)) : null;
}

export async function deleteScout(id: string): Promise<boolean> {
  if (!await getScout(id,true)) return false;
  const now = Date.now(); const db = getDatabase();
  const results = await db.batch([
    db.prepare("UPDATE scouts SET status = 'deleted', data = json_set(data, '$.status', 'deleted', '$.nextCheckAt', NULL), updated_at = ? WHERE id = ? AND status <> 'deleted'").bind(now,id),
    db.prepare("UPDATE jobs SET status = 'cancelled', lease_until = NULL, updated_at = ? WHERE scout_id = ? AND status IN ('pending','running','failed')").bind(now,id),
    db.prepare("UPDATE alerts SET status = 'cancelled', updated_at = ? WHERE scout_id = ? AND status = 'pending'").bind(now,id),
  ]);
  if (results[0].meta.changes) await addActivity(id,'scout_deleted','Scout deleted. Future checks and queued alerts have stopped.');
  return true;
}

export async function restoreScout(id: string): Promise<Scout | null> {
  const existing = await getScout(id,true);
  if (!existing || existing.status !== 'deleted') return existing;
  const db = getDatabase(); const now = Date.now();
  const results = await db.batch([
    db.prepare("UPDATE scouts SET status = 'paused', data = json_set(data, '$.status', 'paused', '$.nextCheckAt', NULL, '$.lastError', NULL), updated_at = ? WHERE id = ? AND status = 'deleted' AND (SELECT COUNT(*) FROM scouts WHERE status <> 'deleted') < 3").bind(now,id),
    db.prepare("UPDATE jobs SET status = 'pending', attempts = 0, available_at = ?, lease_until = NULL, updated_at = ? WHERE scout_id = ? AND status = 'cancelled' AND EXISTS (SELECT 1 FROM scouts WHERE id = ? AND status = 'paused')").bind(now,now,id,id),
    db.prepare("UPDATE alerts SET status = 'pending', updated_at = ? WHERE scout_id = ? AND status = 'cancelled' AND EXISTS (SELECT 1 FROM scouts WHERE id = ? AND status = 'paused')").bind(now,id,id),
  ]);
  if (!results[0].meta.changes) throw new Error('The demo supports three scouts. Delete another scout before restoring this one.');
  await addActivity(id,'scout_restored','Scout restored in a paused state. Resume it when you want checks and alerts.');
  return getScout(id);
}

export async function dueScouts(now = Date.now()): Promise<Scout[]> {
  const result = await getDatabase().prepare("SELECT data FROM scouts WHERE status = 'active' AND next_run_at <= ? ORDER BY next_run_at LIMIT 3").bind(now).all<{ data: string }>();
  return result.results.map((row) => scoutDefaults(json<Scout>(row.data)));
}

export async function claimScout(id: string, force = false): Promise<Scout | null> {
  const now = Date.now();
  const row = await getDatabase().prepare(`UPDATE scouts SET next_run_at = ?, updated_at = ? WHERE id = ? AND status = 'active' ${force ? "" : "AND next_run_at <= ?"} RETURNING data`).bind(...(force ? [now + 600_000, now, id] : [now + 600_000, now, id, now])).first<{ data: string }>();
  if (!row) return null;
  return updateScout(id, { lastCheckAt: new Date(now).toISOString(), nextCheckAt: new Date(now + 600_000).toISOString() });
}

export async function putItem(item: RawItem): Promise<void> {
  const now = Date.now();
  await getDatabase().prepare("INSERT INTO items (id, data, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = json_patch(items.data,excluded.data), last_seen_at = excluded.last_seen_at").bind(item.id, JSON.stringify(withoutMissingDates(item)), now, now).run();
}

function withoutMissingDates(item: RawItem): RawItem {
  const cleaned={...item};
  for(const key of ['creation_time','listing_date_text','source_date_observed_at'] as const) if(cleaned[key]==null || cleaned[key]==='') delete cleaned[key];
  return cleaned;
}

export async function getItem(id: string): Promise<RawItem | null> {
  const row = await getDatabase().prepare("SELECT data FROM items WHERE id = ?").bind(id).first<{ data: string }>();
  return row ? json<RawItem>(row.data) : null;
}

export async function upsertMatch(scoutId: string, itemId: string, data: Listing | Partial<Listing>): Promise<Listing> {
  const existing = await getMatch(scoutId, itemId);
  const listing = { ...existing, ...data, id: itemId, scoutId, userState: existing?.userState ?? data.userState ?? "new", firstSeenAt: existing?.firstSeenAt ?? data.firstSeenAt ?? new Date().toISOString() } as Listing;
  const now = Date.now();
  await getDatabase().prepare("INSERT INTO matches (id, scout_id, item_id, data, user_state, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM scouts WHERE id = ? AND status <> 'deleted') ON CONFLICT(scout_id, item_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(`${scoutId}:${itemId}`, scoutId, itemId, JSON.stringify(listing), listing.userState, now, now,scoutId).run();
  return listing;
}

export async function getMatch(scoutId: string, itemId: string): Promise<Listing | null> {
  const row = await getDatabase().prepare("SELECT m.data, m.user_state, i.data AS item_data FROM matches m JOIN scouts s ON s.id = m.scout_id LEFT JOIN items i ON i.id=m.item_id WHERE m.scout_id = ? AND m.item_id = ? AND s.status <> 'deleted'").bind(scoutId, itemId).first<MatchRow>();
  return row ? matchWithSourceDates(row) : null;
}

type MatchRow={data:string;user_state:Listing['userState'];item_data?:string|null};
function matchWithSourceDates(row:MatchRow):Listing {
  const listing={...json<Listing>(row.data),userState:row.user_state};
  const item=row.item_data?json<RawItem>(row.item_data):null;
  const sourceDateText=listing.sourceDateText||item?.listing_date_text||null;
  return {...listing,...(item?sourceCityMetadata(item):{}),sourceCreatedAt:sourcePostedAt(listing.sourceCreatedAt)||sourcePostedAt(item?.creation_time),sourceDateText,sourceDateObservedAt:listing.sourceDateObservedAt||item?.source_date_observed_at||null};
}

export async function getMatchesForItems(scoutId: string, itemIds: string[]): Promise<Map<string,Listing>> {
  if (!itemIds.length) return new Map();
  const placeholders = itemIds.map(()=>'?').join(',');
  const result = await getDatabase().prepare(`SELECT m.data,m.user_state,i.data AS item_data FROM matches m JOIN scouts s ON s.id=m.scout_id LEFT JOIN items i ON i.id=m.item_id WHERE m.scout_id=? AND m.item_id IN (${placeholders}) AND s.status<>'deleted'`).bind(scoutId,...itemIds).all<MatchRow>();
  return new Map(result.results.map(row=>{const listing=matchWithSourceDates(row);return [listing.id,listing];}));
}

export async function saveSearchCandidates(scoutId: string, candidates: { item: RawItem; listing: Listing; queue: boolean; refreshOnly?: boolean }[]): Promise<void> {
  if (!candidates.length) return;
  const db=getDatabase(); const now=Date.now(); const statements:D1PreparedStatement[]=[];
  for (const {item,listing,queue,refreshOnly} of candidates) {
    statements.push(db.prepare("INSERT INTO items (id,data,first_seen_at,last_seen_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=json_patch(items.data,excluded.data),last_seen_at=excluded.last_seen_at").bind(item.id,JSON.stringify(withoutMissingDates(item)),now,now));
    const conflict=queue||refreshOnly?"DO UPDATE SET data=json_set(matches.data,'$.sourceCreatedAt',COALESCE(json_extract(excluded.data,'$.sourceCreatedAt'),json_extract(matches.data,'$.sourceCreatedAt')),'$.sourceDateText',COALESCE(json_extract(excluded.data,'$.sourceDateText'),json_extract(matches.data,'$.sourceDateText')),'$.sourceDateObservedAt',COALESCE(json_extract(excluded.data,'$.sourceDateObservedAt'),json_extract(matches.data,'$.sourceDateObservedAt'))),updated_at=excluded.updated_at":'DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at';
    statements.push(db.prepare(`INSERT INTO matches (id,scout_id,item_id,data,user_state,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM scouts WHERE id=? AND status<>'deleted') ON CONFLICT(scout_id,item_id) ${conflict}`).bind(`${scoutId}:${item.id}`,scoutId,item.id,JSON.stringify(listing),listing.userState,now,now,scoutId));
    if(queue) statements.push(db.prepare("INSERT OR IGNORE INTO jobs (id,scout_id,stage,payload,status,available_at,attempts,created_at,updated_at) SELECT ?,?,'detail',?,'pending',?,0,?,? WHERE EXISTS (SELECT 1 FROM scouts WHERE id=? AND status<>'deleted')").bind(`${scoutId}:${item.id}:detail`,scoutId,JSON.stringify({itemId:item.id}),now,now,now,scoutId));
  }
  await db.batch(statements);
}

export async function listMatches(scoutId?: string): Promise<Listing[]> {
  const statement = scoutId ? getDatabase().prepare("SELECT m.data, m.user_state, i.data AS item_data FROM matches m JOIN scouts s ON s.id = m.scout_id LEFT JOIN items i ON i.id=m.item_id WHERE m.scout_id = ? AND s.status <> 'deleted' ORDER BY m.created_at DESC LIMIT 150").bind(scoutId) : getDatabase().prepare("SELECT m.data, m.user_state, i.data AS item_data FROM matches m JOIN scouts s ON s.id = m.scout_id LEFT JOIN items i ON i.id=m.item_id WHERE s.status <> 'deleted' ORDER BY m.created_at DESC LIMIT 150");
  const result = await statement.all<MatchRow>();
  return result.results.map(matchWithSourceDates);
}

export async function updateMatchState(itemId: string, userState: Listing["userState"], scoutId?: string): Promise<boolean> {
  const available = " AND EXISTS (SELECT 1 FROM scouts WHERE scouts.id = matches.scout_id AND scouts.status <> 'deleted')";
  const query = (scoutId ? "UPDATE matches SET user_state = ?, updated_at = ? WHERE item_id = ? AND scout_id = ?" : "UPDATE matches SET user_state = ?, updated_at = ? WHERE item_id = ?") + available;
  const result = await getDatabase().prepare(query).bind(...(scoutId ? [userState, Date.now(), itemId, scoutId] : [userState, Date.now(), itemId])).run();
  return Boolean(result.meta.changes);
}

export async function addActivity(scoutId: string | null | undefined, type: string, message: string): Promise<void> {
  await getDatabase().prepare("INSERT INTO activity (id, scout_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), scoutId ?? null, type, message.slice(0, 500), Date.now()).run();
}

export async function listActivity(): Promise<Activity[]> {
  const result = await getDatabase().prepare("SELECT * FROM activity ORDER BY created_at DESC LIMIT 30").all<Row>();
  return result.results.map((row) => ({ id: String(row.id), scoutId: row.scout_id ? String(row.scout_id) : null, type: String(row.kind), message: String(row.message), createdAt: iso(row.created_at) }));
}

function toJob(row: Row): Job {
  const payload = String(row.payload);
  let itemId: string | null = null;
  try { itemId = (JSON.parse(payload) as { itemId?: string }).itemId ?? null; } catch { /* Older jobs can contain a plain string payload. */ }
  return { id: String(row.id), scoutId: String(row.scout_id), itemId, stage: String(row.stage) as Job["stage"], payload, attempts: Number(row.attempts), nextAt: iso(row.available_at), leaseUntil: row.lease_until ? iso(row.lease_until) : null, createdAt: iso(row.created_at) };
}

export async function addJob(input: { scoutId: string; itemId?: string | null; stage: Job["stage"]; payload: string | Record<string, unknown>; nextAt?: string; id?: string; restartDone?: boolean }): Promise<string> {
  const id = input.id ?? (input.itemId ? `${input.scoutId}:${input.itemId}:${input.stage}` : crypto.randomUUID());
  let payload = typeof input.payload === "string" ? input.payload : JSON.stringify(input.payload);
  if (input.itemId) {
    try { payload = JSON.stringify({ ...JSON.parse(payload), itemId: input.itemId }); } catch { payload = JSON.stringify({ value: payload, itemId: input.itemId }); }
  }
  const now = Date.now();
  const conflict=input.restartDone?" ON CONFLICT(id) DO UPDATE SET status='pending',attempts=0,available_at=excluded.available_at,lease_until=NULL,error=NULL,updated_at=excluded.updated_at WHERE jobs.status='done'":'';
  await getDatabase().prepare("INSERT OR IGNORE INTO jobs (id, scout_id, stage, payload, status, available_at, attempts, created_at, updated_at) SELECT ?, ?, ?, ?, 'pending', ?, 0, ?, ? WHERE EXISTS (SELECT 1 FROM scouts WHERE id = ? AND status <> 'deleted')"+conflict).bind(id, input.scoutId, input.stage, payload, timestamp(input.nextAt), now, now,input.scoutId).run();
  return id;
}

export const createJob = addJob;

export async function claimJob(now = Date.now(), scoutId?: string): Promise<Job | null> {
  const values: (string | number)[] = [now + 90_000, now, now, now];
  if (scoutId) values.push(scoutId);
  const row = await getDatabase().prepare(`UPDATE jobs SET status = 'running', lease_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = (SELECT j.id FROM jobs j INNER JOIN scouts s ON s.id = j.scout_id WHERE s.status = 'active' AND j.attempts < 5 AND ((j.status = 'pending' AND j.available_at <= ?) OR (j.status = 'running' AND j.lease_until < ?)) ${scoutId ? 'AND j.scout_id = ?' : ''} ORDER BY CASE j.stage WHEN 'email' THEN 0 WHEN 'screen' THEN 1 ELSE 2 END, j.available_at, j.created_at LIMIT 1) RETURNING *`).bind(...values).first<Row>();
  return row ? toJob(row) : null;
}

export async function ownsJobLease(job: Job): Promise<boolean> {
  const row = await getDatabase().prepare("SELECT id FROM jobs WHERE id = ? AND status = 'running' AND lease_until = ?").bind(job.id,timestamp(job.leaseUntil,0)).first();
  return Boolean(row);
}

export async function completeJob(job: Job): Promise<void> {
  await getDatabase().prepare("UPDATE jobs SET status = 'done', lease_until = NULL, updated_at = ? WHERE id = ? AND status = 'running' AND lease_until = ?").bind(Date.now(), job.id,timestamp(job.leaseUntil,0)).run();
}

export async function retryJob(job: Job, error: string, delayMs = 60_000): Promise<void> {
  await getDatabase().prepare("UPDATE jobs SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END, lease_until = NULL, available_at = ?, error = ?, updated_at = ? WHERE id = ? AND status = 'running' AND lease_until = ?").bind(Date.now() + delayMs, error.slice(0, 500), Date.now(), job.id,timestamp(job.leaseUntil,0)).run();
}

export async function countPendingJobs(scoutId?: string): Promise<number> {
  const query = `SELECT COUNT(*) AS count FROM jobs j INNER JOIN scouts s ON s.id = j.scout_id WHERE s.status = 'active' AND j.status IN ('pending', 'running') ${scoutId ? 'AND j.scout_id = ?' : ''}`;
  const statement = getDatabase().prepare(query);
  const row = await (scoutId ? statement.bind(scoutId) : statement).first<{ count: number }>();
  return row?.count ?? 0;
}

export const listPendingJobs = countPendingJobs;

export type WorkSummary = { pendingJobs: number; runningJobs: number; failedJobs: number; runnableJobs: number; nextRetryAt: string | null };

export async function getWorkSummary(scoutId: string): Promise<WorkSummary> {
  const now = Date.now();
  const row = await getDatabase().prepare("SELECT COALESCE(SUM(status = 'pending'), 0) pending, COALESCE(SUM(status = 'running'), 0) running, COALESCE(SUM(status = 'failed'), 0) failed, COALESCE(SUM(status = 'pending' AND available_at <= ?), 0) runnable, MIN(CASE WHEN status = 'pending' AND available_at > ? THEN available_at END) next_at FROM jobs WHERE scout_id = ?").bind(now,now,scoutId).first<{ pending: number; running: number; failed: number; runnable: number; next_at: number | null }>();
  return { pendingJobs: row?.pending ?? 0, runningJobs: row?.running ?? 0, failedJobs: row?.failed ?? 0, runnableJobs: row?.runnable ?? 0, nextRetryAt: row?.next_at ? iso(row.next_at) : null };
}

export async function advanceScoutJobs(scoutId: string, retryFailed = false): Promise<void> {
  const now = Date.now();
  // Older scans could leave a visible pending candidate without a detail job.
  await getDatabase().prepare("INSERT OR IGNORE INTO jobs (id,scout_id,stage,payload,status,available_at,attempts,created_at,updated_at) SELECT m.scout_id || ':' || m.item_id || ':detail',m.scout_id,'detail',json_object('itemId',m.item_id),'pending',?,0,?,? FROM matches m JOIN scouts s ON s.id=m.scout_id WHERE m.scout_id=? AND s.status='active' AND json_extract(m.data,'$.decision')='pending'").bind(now,now,now,scoutId).run();
  // An older worker could mark a detail job done while paused, before queuing
  // screening. Repair only that orphan; an existing next stage owns its work.
  await getDatabase().prepare("UPDATE jobs SET status='pending',attempts=0,available_at=?,lease_until=NULL,error=NULL,updated_at=? WHERE scout_id=? AND stage='detail' AND status='done' AND EXISTS (SELECT 1 FROM matches m JOIN scouts s ON s.id=m.scout_id WHERE m.scout_id=jobs.scout_id AND m.item_id=json_extract(jobs.payload,'$.itemId') AND s.status='active' AND json_extract(m.data,'$.decision')='pending') AND NOT EXISTS (SELECT 1 FROM jobs other WHERE other.scout_id=jobs.scout_id AND json_extract(other.payload,'$.itemId')=json_extract(jobs.payload,'$.itemId') AND other.status IN ('pending','running','failed'))").bind(now,now,scoutId).run();
  // Only untouched detail jobs had a deliberate batch delay. Provider retries
  // keep their backoff; a continuation must not repeatedly hit a rate limit.
  await getDatabase().prepare("UPDATE jobs SET available_at = ?, updated_at = ? WHERE scout_id = ? AND status = 'pending' AND stage = 'detail' AND attempts = 0 AND available_at > ? AND EXISTS (SELECT 1 FROM scouts WHERE id = ? AND status = 'active')").bind(now,now,scoutId,now,scoutId).run();
  if (retryFailed) await getDatabase().prepare("UPDATE jobs SET status = 'pending', attempts = 0, available_at = ?, lease_until = NULL, updated_at = ? WHERE scout_id = ? AND status = 'failed' AND EXISTS (SELECT 1 FROM scouts WHERE id = ? AND status = 'active')").bind(now,now,scoutId,scoutId).run();
}

function toAlert(row: Row): Alert {
  return { id: String(row.id), scoutId: String(row.scout_id), itemId: String(row.item_id), type: String(row.type), status: String(row.status), providerId: row.provider_id ? String(row.provider_id) : null, error: row.error ? String(row.error) : null, createdAt: iso(row.created_at) };
}

export async function reserveAlert(scoutId: string, itemId: string, type = "match"): Promise<Alert | null> {
  const now = Date.now();
  const row = await getDatabase().prepare("INSERT OR IGNORE INTO alerts (id, scout_id, item_id, type, status, created_at, updated_at) SELECT ?, ?, ?, ?, 'pending', ?, ? WHERE EXISTS (SELECT 1 FROM scouts WHERE id = ? AND status = 'active') RETURNING *").bind(`${scoutId}:${itemId}:${type}`, scoutId, itemId, type, now, now,scoutId).first<Row>();
  return row ? toAlert(row) : null;
}

export async function getAlert(scoutId: string, itemId: string, type = "match"): Promise<Alert | null> {
  const row = await getDatabase().prepare("SELECT * FROM alerts WHERE scout_id = ? AND item_id = ? AND type = ?").bind(scoutId, itemId, type).first<Row>();
  return row ? toAlert(row) : null;
}

export async function markAlert(id: string, status: "pending" | "sent" | "failed", providerId?: string | null, error?: string | null): Promise<void> {
  await getDatabase().prepare("UPDATE alerts SET status = ?, provider_id = ?, error = ?, updated_at = ? WHERE id = ?").bind(status, providerId ?? null, error?.slice(0, 500) ?? null, Date.now(), id).run();
}

export async function getSetting<T = string>(key: string, fallback?: T): Promise<T | null> {
  const row = await getDatabase().prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? json<T>(row.value) : fallback ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDatabase().prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(key, JSON.stringify(value), Date.now()).run();
}

export async function incrementSetting(key: string, amount = 1): Promise<number> {
  const row = await getDatabase().prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + ? AS TEXT), updated_at = excluded.updated_at RETURNING value").bind(key, String(amount), Date.now(), amount).first<{ value: string }>();
  return Number(row?.value ?? amount);
}

export async function getAppState(): Promise<AppState & { workByScout: Record<string, WorkSummary> }> {
  const [scouts, deletedScouts, listings, activity, lastWorkerAt, schedulerStatus, creditsRemaining, requestsUsed, requestBudget, modelAvailable] = await Promise.all([listScouts(),listScouts(true), listMatches(), listActivity(), getSetting<string>("last_worker_at"), getSetting<string>("scheduler_status", "Not connected"), getSetting<number>("credits_remaining"), getSetting<number>("requests_used", 0), getSetting<number>("request_budget", 200), getSetting<boolean>("model_available", Boolean(env.OPENAI_API_KEY || env.GROQ_API_KEY))]);
  const summaries = await Promise.all(scouts.map(async scout => [scout.id,await getWorkSummary(scout.id)] as const));
  const scoutById=new Map(scouts.map(scout=>[scout.id,scout]));
  const currentListings=listings.map(listing=>{const scout=scoutById.get(listing.scoutId);return applyFreshness(scout?applyRequirementChecks(applyCityScope(listing,scout),scout):listing,scout?.maxAgeHours);});
  return { scouts, deletedScouts, listings:currentListings, activity, workByScout: Object.fromEntries(summaries), system: { demoEmail: env.DEMO_EMAIL || "", schedulerStatus: schedulerStatus ?? "Not connected", lastWorkerAt, creditsRemaining, requestsUsed: requestsUsed ?? 0, requestBudget: requestBudget ?? 200, modelAvailable: modelAvailable ?? Boolean(env.GROQ_API_KEY) } };
}
