"use client";
import type { AppState as BackendState } from "@/lib/types";
import { sourcePostedAt } from "@/lib/freshness";

import { useCallback, useEffect, useMemo, useRef, useState, useId, type FormEvent } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Armchair, Bell, Bookmark, Check,
  CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, ExternalLink,
  Eye, Heart, ImageOff, Info, LampDesk, LoaderCircle, Mail, MapPin, Maximize2,
  Monitor, Pause, Pencil, Play, Plus, Radio, RefreshCw, Ruler, Search, ShieldCheck,
  SlidersHorizontal, Sparkles, Trash2, X, LogOut, UserRound,
} from "lucide-react";
import type { Scout as ApiScout } from "@/lib/types";

type Decision = "strong_fit" | "needs_checking" | "doesnt_fit" | "pending";
type UserState = "new" | "saved" | "dismissed" | "collected";
type CityLocation = { id: string; label: string; city: string; state: string; countryCode: "US"; latitude: number; longitude: number };
type Scout = {
  id: string; query: string; name?: string; neighborhood: string; location?: CityLocation;
  email: string; maxWidthInches?: number | null; maxDepthInches?: number | null;
  maxHeightInches?: number | null; maxAgeHours: number; workingRequired: boolean; allowUnknown: boolean;
  status: "active" | "paused" | "complete"; createdAt?: string;
  lastCheckedAt?: string | null; lastCheckAt?: string | null; nextCheckAt?: string | null; lastError?: string | null;
};
type Evidence = { field?: string; value?: string; source?: string; quote?: string };
type Assessment = {
  decision: Decision; summary?: string; reasons?: string[]; missingDetails?: string[];
  pickupQuestions?: string[]; visualConcerns?: string[]; evidence?: Evidence[];
  dimensions?: { widthInches?: number | null; depthInches?: number | null; heightInches?: number | null; source?: string };
  condition?: string; model?: string; visualAssessment?: string;
};
type Comparison = { id?: string; title: string; price: number; url: string; imageUrl?: string; location?: string; city?: string; postedAt?: string | null; matchNote?: string };
type Resale = { basis?: "exact_model" | "similar_items"; confidence?: "model_match" | "low"; query?: string; geography?: string; version?: number; status?: string; low?: number; high?: number; sampleCount?: number; summary?: string; comparisons?: Comparison[]; fetchedAt?: string; strength?: string };
type RequestedFeatureCheck = { label: string; status: "supported" | "mismatch" | "unconfirmed"; summary: string; quote?: string };
type Listing = {
  id: string; scoutId: string; sourceUrl: string; title: string; description?: string;
  price: number | null; location?: string; imageUrl?: string; images?: string[];
  requestedFeatureCheck?: RequestedFeatureCheck; firstSeenAt?: string; sourceCreatedAt?: string | null; sourceDateText?: string | null; sourceDateObservedAt?: string | null; freshness?: {status: "recent" | "older" | "unknown"; maxAgeHours: number; ageHours: number | null}; availability?: string; userState?: UserState;
  assessment?: Assessment | null; resale?: Resale | null; distanceKm?: number | null;
};
type Activity = { id: string; scoutId?: string; message: string; createdAt: string; type?: string };
type WorkSummary = { pendingJobs: number; runningJobs: number; failedJobs: number; runnableJobs: number; nextRetryAt: string | null };
type ScanSession = { scoutId: string; token: number; startedAt: number; steps: number; phase: "searching" | "screening" };
type ScanResponse = { message?: string; pending?: number; processed?: number; progress?: WorkSummary; timing?: { elapsedMs: number; searchMs: number; processedStages: number } };
type State = { workByScout: Record<string, WorkSummary>; scouts: Scout[]; deletedScouts: Scout[]; listings: Listing[]; activity: Activity[]; settings?: { demoEmail?: string; scheduleEnabled?: boolean; scheduleIntervalMinutes?: number; lastWorkerAt?: string | null } };
type FormValues = { maxAgeHours: string; query: string; neighborhood: string; cityQuery: string; locationId: string; email: string; maxWidth: string; maxDepth: string; maxHeight: string; workingRequired: boolean; allowUnknown: boolean };
const EMPTY: State = { workByScout: {}, scouts: [], deletedScouts: [], listings: [], activity: [] };
const DEFAULT_FORM: FormValues = { maxAgeHours: "24", query: "", neighborhood: "", cityQuery: "", locationId: "", email: "", maxWidth: "", maxDepth: "", maxHeight: "", workingRequired: true, allowUnknown: true };
function cityLabel(scout?: Scout | null) { return scout?.location?.label || (scout ? "San Francisco, California" : "United States"); }
function normalizeScout(scout: ApiScout): Scout {
  return { ...scout, maxAgeHours: scout.maxAgeHours || 24, maxWidthInches: scout.maxWidthIn,
    maxDepthInches: scout.maxDepthIn, maxHeightInches: scout.maxHeightIn,
    workingRequired: scout.condition === "working", allowUnknown: scout.includeUnknowns,
    status: scout.status === "collected" ? "complete" : (scout.status as string) === "deleted" ? "paused" : scout.status as "active" | "paused",
    lastCheckedAt: scout.lastSuccessAt, nextCheckAt: scout.nextCheckAt };
}



async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(data.error || data.message || "Something went wrong. Please try again.");
  return data as T;
}
function normalizeState(state: BackendState): State {
  return {
    workByScout: (state as BackendState & { workByScout?: Record<string, WorkSummary> }).workByScout || {},
    scouts: state.scouts.map(normalizeScout),
    deletedScouts: ((state as BackendState & { deletedScouts?: ApiScout[] }).deletedScouts || []).map(normalizeScout),
    listings: state.listings.map(l => ({ id:l.id,scoutId:l.scoutId,sourceUrl:l.url,title:l.title,description:l.description,price:l.price,location:l.city,imageUrl:l.photo??undefined,images:l.photos,firstSeenAt:l.firstSeenAt,sourceCreatedAt:l.sourceCreatedAt,sourceDateText:l.sourceDateText,sourceDateObservedAt:l.sourceDateObservedAt,requestedFeatureCheck:l.requestedFeatureCheck,freshness:l.freshness,userState:l.userState,distanceKm:l.distanceMiles===null?null:l.distanceMiles*1.609344,assessment:{decision:l.decision==='rejected'?'doesnt_fit':l.decision,summary:l.reasons[0],reasons:l.reasons,missingDetails:l.unknowns,pickupQuestions:l.questions,visualConcerns:l.visualNote&&l.visualStatus==='assessed'&&l.unknowns.some(u=>u.includes('photo'))?[l.visualNote]:[],evidence:l.evidence.map(e=>({field:e.field,quote:e.text,source:e.source})),dimensions:{widthInches:l.dimensions.widthIn,depthInches:l.dimensions.depthIn,heightInches:l.dimensions.heightIn},condition:l.conditionNote??undefined,model:l.model??undefined,visualAssessment:l.visualNote??undefined},resale:l.resale?{basis:l.resale.basis,confidence:l.resale.confidence,query:l.resale.query,geography:l.resale.geography,version:l.resale.version,status:l.resale.status,low:l.resale.low??undefined,high:l.resale.high??undefined,sampleCount:l.resale.count,summary:l.resale.note,comparisons:l.resale.comps,fetchedAt:l.resale.queriedAt}:null})),
    activity:state.activity.map(a=>({...a,scoutId:a.scoutId??undefined})),
    settings:{demoEmail:state.system.demoEmail,scheduleEnabled:state.system.schedulerStatus==='Connected',scheduleIntervalMinutes:10,lastWorkerAt:state.system.lastWorkerAt}
  };
}
function relativeTime(value?: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 0) return `In ${Math.max(1, Math.abs(minutes))} min`;
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} hr ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function exactTime(value?: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "Not available";
}
function labelFor(decision?: Decision) {
  return decision === "strong_fit" ? "Strong fit" : decision === "needs_checking" ? "Needs checking" : decision === "doesnt_fit" ? "Rejected" : "Screening";
}
// Stored reviews include both supporting notes and failures. Keep failures first in review views.
function failedChecks(assessment?: Assessment | null) {
  const reasons = assessment?.reasons || [];
  const failures = reasons.filter(reason =>
    /^The listing was posted /.test(reason) ||
    /^The source says .*outside your /.test(reason) ||
    /^The listing is (?:not free|unavailable or pending)\.$/.test(reason) ||
    /^The (?:original Marketplace )?listing is no longer available\.$/.test(reason) ||
    /^The title explicitly describes a different item:/.test(reason) ||
    /^The seller explicitly says (?:this is not a standing desk or is for seated use only|the desk height is fixed or not adjustable)\.$/.test(reason) ||
    /^The listing is in .+outside your selected city of /.test(reason) ||
    /^The item does not match the requested item type\.$/.test(reason) ||
    /^The description (?:asks for payment|offers parts or a component)/.test(reason) ||
    /^The stated (?:width|depth|height).* exceeds your /.test(reason) ||
    /^Working condition is required, but the seller /.test(reason) ||
    /^Approximate (?:pickup )?location is .* outside your .* radius\.$/.test(reason)
  );
  return failures.length ? failures : reasons;
}
function listedPrice(price: number | null) {
  return price === null ? "Price not stated" : price === 0 ? "Listed at $0" : `Listed at $${price.toLocaleString()}`;
}
function ageWindow(hours: number = 24) {
  return hours === 24 ? "Last 24 hours" : `Last ${hours / 24} days`;
}
function postingAge(value: string) {
  const hours = Math.max(0, (Date.now() - Date.parse(value)) / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(hours * 60))} min ago`;
  if (hours < 24) return `${Math.floor(hours)} hr ago`;
  if (hours < 14 * 24) return `${Math.floor(hours / 24)} days ago`;
  return `${Math.floor(hours / 168)} weeks ago`;
}
function postedLabel(listing: Listing, detailed = false) {
  const posted = sourcePostedAt(listing.sourceCreatedAt);
  if (!posted) {
    if (!detailed || !listing.sourceDateText) return "Listing date unconfirmed";
    const observed = sourcePostedAt(listing.sourceDateObservedAt);
    const checked = observed ? ` · checked ${new Date(observed).toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric",timeZone:"America/Los_Angeles"})}` : " · observation date unavailable";
    return `Source said “${listing.sourceDateText}”${checked}`;
  }
  const date = new Date(posted).toLocaleDateString("en-US", {month:"short",day:"numeric",...(detailed ? {year:"numeric" as const} : {}),timeZone:"America/Los_Angeles"});
  return `Listed ${date} · ${postingAge(posted)}`;
}
function postingTitle(listing: Listing) {
  const posted = sourcePostedAt(listing.sourceCreatedAt);
  return posted ? `Facebook listing timestamp: ${new Date(posted).toLocaleString("en-US", {dateStyle:"medium",timeStyle:"short",timeZone:"America/Los_Angeles"})} Pacific` : "The source did not provide a usable exact posting date. Discovery time is not substituted.";
}
function safeUrl(value?: string) {
  try { const parsed = new URL(value || ""); return parsed.protocol === "https:" ? parsed.href : "#"; } catch { return "#"; }
}
function Logo({ small = false }: { small?: boolean }) {
  return <a className={`brand ${small ? "brand-small" : ""}`} href="/" aria-label="Second Look home"><span className="brand-mark"><Eye size={23} strokeWidth={1.8} /></span><span>second look<span className="brand-dot">.</span></span></a>;
}
function DecisionBadge({ decision }: { decision?: Decision }) {
  return <span className={`fit-badge ${decision || "pending"}`}>{decision === "strong_fit" ? <Check size={12} /> : decision === "needs_checking" ? <CircleHelp size={12} /> : decision === "doesnt_fit" ? <X size={12} /> : <LoaderCircle size={12} className="spin" />}{labelFor(decision)}</span>;
}
function ItemImage({ src, title, className = "" }: { src?: string; title: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? <img className={className} src={safeUrl(src)} alt={title} loading="lazy" onError={() => setFailed(true)} referrerPolicy="no-referrer" /> : <div className={`image-placeholder ${className}`}><ImageOff size={26} strokeWidth={1.3} /><span>Photo unavailable</span></div>;
}

export default function SecondLook({ canManage = true, publicDemo = false }: { canManage?: boolean; publicDemo?: boolean }) {
  const [data, setData] = useState<State>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [activeId, setActiveId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Scout | null>(null);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [demoSignedIn, setDemoSignedIn] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleting, setDeleting] = useState<Scout | null>(null);
  const [scanSession, setScanSession] = useState<ScanSession | null>(null);
  const [scanNote, setScanNote] = useState<{ scoutId: string; message: string } | null>(null);
  const [pageVisible, setPageVisible] = useState(true);
  const dataRef = useRef<State>(data);
  dataRef.current = data;
  const scanSessionRef = useRef<ScanSession | null>(null);
  const scanRequestInFlight = useRef(false);
  const scanToken = useRef(0);
  const refreshSequence = useRef(0);
  const appliedRefresh = useRef(0);
  const stopScanSession = useCallback((note?: string) => {
    const current = scanSessionRef.current;
    scanToken.current += 1;
    scanSessionRef.current = null;
    setScanSession(null);
    if (note && current) setScanNote({ scoutId: current.scoutId, message: note });
  }, []);
  useEffect(() => {
    function visibilityChanged() {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (!visible) stopScanSession("Foreground checking stopped while this page is hidden. Saved work stays queued for the background scout.");
    }
    visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => document.removeEventListener("visibilitychange", visibilityChanged);
  }, [stopScanSession]);
  useEffect(() => {
    setDemoSignedIn(publicDemo || window.localStorage.getItem("second-look-demo-session") === "alex");
    setSessionReady(true);
  }, [publicDemo]);
  function signIn() { window.localStorage.setItem("second-look-demo-session", "alex"); setDemoSignedIn(true); }
  function signOut() { stopScanSession(); window.localStorage.removeItem("second-look-demo-session"); setDemoSignedIn(false); setProfileOpen(false); setSelectedId(null); setDeleting(null); setCreating(false); setEditing(null); }

  useEffect(() => {
    if (!deleting) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector(".delete-dialog");
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDeleting(null);
      if (event.key === "Tab" && buttons?.length) {
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [deleting]);

  const initialized = useRef(false);
  const refresh = useCallback(async (quiet = false) => {
    const sequence = ++refreshSequence.current;
    try {
      const next = normalizeState(await request<BackendState>("/api/state"));
      if (sequence < appliedRefresh.current) return dataRef.current;
      appliedRefresh.current = sequence;
      dataRef.current = next;
      setData({ ...EMPTY, ...next });
      setError("");
      if (!initialized.current) {
        const params = new URLSearchParams(window.location.search);
        const stored = params.get('scout') || window.localStorage.getItem("second-look-scout");
        if (params.get('item')) setSelectedId(params.get('item'));
        setActiveId(next.scouts.some(s => s.id === stored) ? stored! : next.scouts[0]?.id || "");
        initialized.current = true;
      }
      return next;
    } catch (err) { if (!quiet) setError(err instanceof Error ? err.message : "We couldn’t load your scouts."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const selectedWorkRunning = (data.workByScout[activeId]?.runningJobs || 0) > 0;
  useEffect(() => {
    const interval = scanSession || busy || selectedWorkRunning ? 2_000 : 10_000;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, interval);
    return () => window.clearInterval(timer);
  }, [refresh, scanSession?.scoutId, busy, selectedWorkRunning]);
  useEffect(() => { if (activeId) window.localStorage.setItem("second-look-scout", activeId); }, [activeId]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 5_000); return () => window.clearTimeout(timer); }, [toast]);
  const scout = data.scouts.find(s => s.id === activeId) || data.scouts[0];
  const allListings = useMemo(() => data.listings.filter(l => l.scoutId === scout?.id).sort((a,b) => (Date.parse(sourcePostedAt(b.sourceCreatedAt) || "") || 0) - (Date.parse(sourcePostedAt(a.sourceCreatedAt) || "") || 0)), [data.listings, scout?.id]);
  const listings = useMemo(() => allListings.filter(l => {
    if (filter === "saved") return l.userState === "saved";
    if (filter === "collected") return l.userState === "collected";
    if (filter === "doesnt_fit") return l.assessment?.decision === "doesnt_fit";
    if (l.userState === "dismissed" || l.userState === "collected") return false;
    if (filter === "all") return l.assessment?.decision !== "doesnt_fit" && l.assessment?.decision !== "pending";
    return l.assessment?.decision === filter;
  }), [allListings, filter]);
  const selected = data.listings.find(l => l.id === selectedId && l.scoutId === scout?.id);
  const pendingCount = allListings.filter(l=>l.assessment?.decision==='pending').length;
  const fitCount = allListings.filter(l => l.assessment?.decision === "strong_fit" && l.userState !== "dismissed").length;
  const activity = data.activity.filter(a => a.type!=='scheduled_tick' && (!a.scoutId || a.scoutId === scout?.id)).slice(0, 5);

  const work = scout ? data.workByScout[scout.id] : undefined;
  const reviewedCount = allListings.filter(item => item.assessment?.decision !== "pending").length;
  const matchCount = allListings.filter(item => item.assessment?.decision === "strong_fit" || item.assessment?.decision === "needs_checking").length;
  const rejectedCount = allListings.filter(item => item.assessment?.decision === "doesnt_fit").length;
  const rejectionReasons = [...new Set(allListings.filter(item => item.assessment?.decision === "doesnt_fit").flatMap(item => failedChecks(item.assessment)))].slice(0, 3);
  const waitingCount = work ? work.pendingJobs + work.runningJobs : pendingCount;
  const failedCount = work?.failedJobs || 0;
  const currentSession = scanSession?.scoutId === scout?.id ? scanSession : null;
  const searchFinished = !!scout?.lastCheckedAt;
  const isSearching = currentSession?.phase === "searching";
  const hasBackoff = !!work?.nextRetryAt && work.runnableJobs === 0 && work.runningJobs === 0;
  const allReviewed = searchFinished && waitingCount === 0 && pendingCount === 0 && failedCount === 0 && !currentSession;
  const hasUnfinishedWork = waitingCount > 0 || pendingCount > 0;

  const performScan = useCallback(async (scoutId: string, continueOnly: boolean) => {
    if (!canManage || scanRequestInFlight.current) return null;
    scanRequestInFlight.current = true;
    setBusy("scan");
    try {
      const result = await request<ScanResponse>(`/api/scouts/${scoutId}/scan`, { method: "POST", body: JSON.stringify({ continueOnly }) });
      await refresh(true);
      const current = scanSessionRef.current;
      if (current?.scoutId === scoutId) {
        const next = { ...current, phase: "screening" as const, steps: current.steps + 1 };
        scanSessionRef.current = next;
        setScanSession(next);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "This check couldn’t finish. Your saved work is safe.";
      setToast(message);
      stopScanSession(message);
      await refresh(true);
      return null;
    } finally {
      scanRequestInFlight.current = false;
      setBusy(previous => previous === "scan" ? "" : previous);
    }
  }, [refresh, stopScanSession, canManage]);

  async function startScanSession(scoutId: string, continueOnly = false) {
    if (!canManage || scanRequestInFlight.current || document.visibilityState !== "visible") return;
    stopScanSession();
    const session = { scoutId, token: ++scanToken.current, startedAt: Date.now(), steps: 0, phase: continueOnly ? "screening" as const : "searching" as const };
    scanSessionRef.current = session;
    setScanSession(session);
    setScanNote(null);
    await performScan(scoutId, continueOnly);
  }

  useEffect(() => {
    if (!scanSession) return;
    const sessionId = scanSession.scoutId;
    if (!canManage || !demoSignedIn || !pageVisible || creating || editing || scout?.id !== sessionId || scout?.status !== "active") {
      stopScanSession();
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule(delay = 1_200) { if (!cancelled) timer = setTimeout(advance, delay); }
    async function advance() {
      const session = scanSessionRef.current;
      if (cancelled || !session || session.scoutId !== sessionId || document.visibilityState !== "visible") return;
      if (Date.now() - session.startedAt > 90_000 || session.steps >= 12) {
        stopScanSession("This foreground check has reached its limit. Remaining work is saved; the background scout can continue it, or you can continue here.");
        return;
      }
      if (scanRequestInFlight.current) { schedule(); return; }
      const currentScout = dataRef.current.scouts.find(item => item.id === sessionId);
      if (!currentScout || currentScout.status !== "active") { stopScanSession(); return; }
      const summary = dataRef.current.workByScout[sessionId];
      if (!summary) { stopScanSession("Your check is saved. Refresh or check again to see the latest progress."); return; }
      if (summary.runningJobs > 0) { schedule(2_000); return; }
      if (summary.runnableJobs === 0) {
        const unreviewed = dataRef.current.listings.filter(item => item.scoutId === sessionId && item.assessment?.decision === "pending").length;
        const note = summary.failedJobs > 0 ? "Some checks failed. Review the error below and retry when ready." : summary.pendingJobs > 0 ? "An interrupted check is waiting to retry. Your place in the queue is saved." : unreviewed > 0 ? `${unreviewed} saved candidates still need review. Continue screening to process another batch.` : "Search and screening finished. Your shortlist is up to date.";
        stopScanSession(note);
        return;
      }
      await performScan(sessionId, true);
      schedule();
    }
    schedule();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [scanSession?.scoutId, scout?.id, scout?.status, demoSignedIn, creating, editing, pageVisible, performScan, stopScanSession, canManage]);

  async function mutate(action: string, fn: () => Promise<unknown>, success?: string) {
    if (!canManage) { setToast("Manage demo to change this shared workspace."); return false; }
    if (action.startsWith("pause") || action.startsWith("delete")) stopScanSession();
    setBusy(action);
    try { await fn(); await refresh(); if (success) setToast(success); return true; }
    catch (err) { setToast(err instanceof Error ? err.message : "That didn’t work. Please try again."); return false; }
    finally { setBusy(""); }
  }
  async function saveScout(values: FormValues) {
    if (!canManage) throw new Error("Management access is required.");
    const body = {
      query: values.query.trim(), ...(values.locationId ? { locationId: values.locationId } : { neighborhood: values.neighborhood }),
      maxAgeHours: Number(values.maxAgeHours),
      maxWidthIn: values.maxWidth ? Number(values.maxWidth) : null,
      maxDepthIn: values.maxDepth ? Number(values.maxDepth) : null,
      maxHeightIn: values.maxHeight ? Number(values.maxHeight) : null,
      condition: values.workingRequired?'working':'any', includeUnknowns: values.allowUnknown,
    };
    const result = await request<{ scout: ApiScout }>(editing ? `/api/scouts/${editing.id}` : "/api/scouts", { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) });
    await refresh();
    setActiveId(result.scout.id); setCreating(false); setEditing(null); setFilter("all");
    setToast(editing ? "Scout updated." : "Your scout is ready. Checking for its first finds…");
    if (!editing) await startScanSession(result.scout.id);
  }
  const setItemState = (listing: Listing, userState: UserState) => mutate(`item-${listing.id}`, () => userState==='collected'?request(`/api/scouts/${listing.scoutId}`,{method:'PATCH',body:JSON.stringify({status:'collected'})}):request(`/api/listings/${listing.id}`, { method: "PATCH", body: JSON.stringify({ scoutId:listing.scoutId,userState }) }), userState === "saved" ? "Saved to your shortlist." : userState === "collected" ? "Scout finished. Monitoring and alerts have stopped." : undefined);
  const checkNow = () => scout && startScanSession(scout.id, hasUnfinishedWork && failedCount === 0);

  async function confirmDelete() {
    if (!deleting) return;
    const scoutToDelete = deleting;
    if (scanSessionRef.current?.scoutId === scoutToDelete.id) stopScanSession();
    const success = await mutate(`delete-${scoutToDelete.id}`, () => request(`/api/scouts/${scoutToDelete.id}`, { method: "DELETE" }), "Scout removed. Future checks and queued alerts are stopped.");
    if (!success) return;
    if (activeId === scoutToDelete.id) { setActiveId(""); window.localStorage.removeItem("second-look-scout"); }
    setDeleting(null);
  }

  const progressTitle = scout?.status !== "active" ? scout?.status === "paused" ? "Scout paused. Your progress is saved." : "Scout finished. Your finds are saved." : isSearching ? "Searching free Marketplace listings…" : currentSession ? "Screening the details as they arrive…" : failedCount > 0 || scout?.lastError ? "Some checks need attention." : hasBackoff ? "Waiting before the next retry." : work?.runningJobs ? "Background review is running." : hasUnfinishedWork ? "Saved candidates are waiting for review." : allReviewed ? matchCount ? "Search finished. Here’s your shortlist." : "No recent matches within your brief yet." : "Ready for your first search.";
  const progressDescription = scout?.status !== "active" ? "Checks and new alerts are stopped. Resume this scout when you’re ready." : isSearching ? "Getting real listings, then checking item details against your brief. Results appear as each review finishes." : currentSession ? "This page is advancing the saved queue one batch at a time. You can keep browsing the reviewed finds below." : failedCount > 0 || scout?.lastError ? "A provider or check could not finish. Your existing finds are kept; review the error and retry when ready." : hasBackoff ? `An interrupted check is scheduled to retry${work?.nextRetryAt ? ` at ${exactTime(work.nextRetryAt)}` : ""}. Your progress is saved.` : work?.runningJobs ? "A worker is checking saved candidates. This page updates as each review finishes." : hasUnfinishedWork ? "These are saved candidates, not confirmed matches. Continue screening to work through the remaining checks." : allReviewed ? matchCount ? "Only reviewed matches appear below. Your next scheduled search can bring new inventory." : "The returned listings did not pass your brief. Try another item name or city, or leave the scout watching." : "Start a check to search real listings. We’ll show what was reviewed and what still needs attention.";
  const emptyTitle = filter === "doesnt_fit" ? "No rejected listings yet." : filter === "saved" ? "A space for your favorites." : filter !== "all" ? "No finds in this view yet." : isSearching ? "Looking for your next good find." : scout?.status !== "active" ? "Your scout is taking a breather." : failedCount > 0 || scout?.lastError ? "This check needs a little attention." : hasBackoff ? "Waiting to retry the remaining checks." : hasUnfinishedWork ? currentSession ? "Your scout is checking the details." : "Candidates found. Review is still waiting." : searchFinished ? matchCount ? "No new finds in your shortlist." : "No recent matches within your brief yet." : "Your next good find is out there.";
  const emptyDescription = filter === "doesnt_fit" ? "Listings that fail a required check will appear here, with the reason for each decision." : filter === "saved" ? "Tap the bookmark on a find to keep it here." : filter !== "all" ? "Try All finds to see the other reviewed matches." : scout?.status !== "active" ? "Your brief and finds are saved. Resume to continue checks and alerts." : failedCount > 0 || scout?.lastError ? "We haven’t called failed checks ‘no results.’ Review the error above and retry when ready." : hasBackoff ? "A remaining check is waiting to retry. Your queued candidates are saved; this is not an empty search result." : hasUnfinishedWork ? "A listing appears here only after the required review. The counts above show what is finished and what is still waiting." : searchFinished ? matchCount ? "Your matching finds may already be saved or dismissed. Check Saved or run a new search." : `${reviewedCount} saved candidates reviewed; none currently match your brief and listing-age window. Try a 7-day window in Edit brief or let the scout keep watching.` : "We’ll search real listings, screen them against your brief, and bring promising ones here.";

  const scoutPanel = data.scouts.length || data.deletedScouts.length ? <section className="my-scouts-panel" aria-label={publicDemo ? "Demo scouts" : "My scouts"}><div className="my-scouts-header"><div><h2>{publicDemo ? "Demo scouts" : "My scouts"}<span>{data.scouts.length}</span></h2><p>Saved briefs. Quietly on the lookout.</p></div><span className="my-scouts-demo">ALEX’S DEMO WORKSPACE</span></div><div className="my-scouts-list">{data.scouts.map(item => {
        const reviewed = data.listings.filter(listing => listing.scoutId === item.id && listing.assessment?.decision !== "pending").length;
        const queued = data.listings.filter(listing => listing.scoutId === item.id && listing.assessment?.decision === "pending").length;
        const rowWork = data.workByScout[item.id];
        return <div className={`scout-list-row ${scout?.id === item.id ? "selected" : ""}`} key={item.id}><button className="scout-row-select" onClick={() => { stopScanSession(); setActiveId(item.id); setFilter("all"); setCreating(false); setEditing(null); setSelectedId(null); }} aria-pressed={scout?.id === item.id}><span className="scout-row-icon"><Search size={16} /></span><span className="scout-row-title"><strong>{item.query}</strong><span>{cityLabel(item)}</span></span></button><div className="scout-row-status"><span className={`status-label ${item.status} ${item.lastError ? "needs-attention" : ""}`}><span />{item.status === "active" ? item.lastError || rowWork?.failedJobs ? "Needs attention" : queued ? scanSession?.scoutId === item.id || rowWork?.runningJobs ? `Checking ${queued}` : `${queued} waiting` : data.settings?.scheduleEnabled ? "Watching" : "Ready" : item.status === "paused" ? "Paused" : "Collected"}</span><small>{reviewed} reviewed</small></div><div className="scout-row-times"><span>Last success <strong>{relativeTime(item.lastCheckedAt)}</strong></span><span>Next <strong>{item.status === "active" ? data.settings?.scheduleEnabled ? item.nextCheckAt ? relativeTime(item.nextCheckAt) : "Awaiting schedule" : "Not connected" : "Stopped"}</strong></span></div><div className="scout-row-actions"><button className="scout-row-action" disabled={!canManage || !!busy} onClick={() => mutate(`pause-${item.id}`, () => request(`/api/scouts/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: item.status === "active" ? "paused" : "active" }) }), item.status === "active" ? "Scout paused. Future checks and alerts are stopped." : "Scout resumed.")} title={item.status === "active" ? "Pause scout" : "Resume scout"}>{item.status === "active" ? <Pause size={13} /> : <Play size={13} />}<span>{item.status === "active" ? "Pause" : "Resume"}</span></button><button className="scout-row-action delete-scout" disabled={!canManage || !!busy} onClick={() => setDeleting(item)} aria-label={`Delete ${item.query} scout`}><Trash2 size={13} /><span>Delete</span></button></div>{item.lastError && <p className="scout-row-error" title={item.lastError}><Info size={13} /><span><strong>Needs attention:</strong> {item.lastError}</span></p>}</div>;
      })}</div>{canManage && !!data.deletedScouts.length && <details className="recently-deleted"><summary><ChevronDown size={12} />Recently deleted ({data.deletedScouts.length})</summary>{data.deletedScouts.map(item => <div className="deleted-scout-row" key={item.id}><span>{item.query}<small>Restores paused · alerts stay off</small></span><button disabled={!canManage || !!busy} onClick={() => mutate(`restore-${item.id}`, async () => { const result = await request<{ scout: ApiScout }>(`/api/scouts/${item.id}/restore`, { method: "POST" }); setActiveId(result.scout.id); }, "Scout restored, paused. Resume when you’re ready.")}><RefreshCw size={12} />Restore</button></div>)}</details>}</section> : null;

  return <div className="second-look">
    <header className="topbar"><div className="topbar-inner"><Logo /><div className="topbar-right"><span className="city-tag"><MapPin size={13} />{scout ? cityLabel(scout) : "United States"}</span><span className="topbar-divider" /><span className="topbar-caption">Good finds, found for you.</span>{publicDemo && <span className="public-sample-profile">Alex · Sample profile</span>}{demoSignedIn && !publicDemo && <div className="demo-profile-wrap"><button className="demo-profile-button" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen} aria-label="Demo profile menu"><span className="profile-avatar">AM</span><span>Alex<span className="profile-demo-label">DEMO</span></span><ChevronDown size={12} /></button>{profileOpen && <div className="profile-popover"><strong>Alex Morgan</strong><span>alex@secondlook.demo</span><p>Sample profile · shared prototype</p><button onClick={signOut}><LogOut size={14} />Sign out</button><small>Signing out does not pause your scouts or stop email alerts.</small></div>}</div>}{scout && demoSignedIn && canManage && <button className="icon-button mobile-new" onClick={() => { setEditing(null); setCreating(true); }} aria-label="Create a new scout"><Plus size={19} /></button>}</div></div></header>
    {sessionReady && !demoSignedIn ? <DemoLogin onSignIn={signIn} /> : loading || !sessionReady ? <main className="page-shell loading-page"><div className="eyebrow"><span className="live-dot" /> FINDING YOUR SCOUTS</div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-subtitle" /><div className="skeleton-grid">{[0, 1, 2].map(n => <div className="skeleton skeleton-card" key={n} />)}</div></main> : error && !data.scouts.length ? <main className="connection-page"><div className="state-icon"><Radio size={30} /></div><h1>Let’s reconnect.</h1><p>{error}</p><button className="button button-primary" onClick={() => { setLoading(true); refresh(); }}><RefreshCw size={16} /> Try again</button></main> : !scout && !canManage ? <main className="connection-page"><div className="state-icon"><Search size={30} /></div><h1>A scout is getting ready.</h1><p>This shared demo has no active scouts yet. Check back soon to see its finds.</p></main> : !scout || creating || editing ? <>{scoutPanel && <div className="page-shell scout-manager-form">{scoutPanel}</div>}<ScoutForm scout={editing} defaultEmail={data.settings?.demoEmail || scout?.email || ""} onSave={saveScout} onBack={scout ? () => { setCreating(false); setEditing(null); } : undefined} /></> : <main className="page-shell dashboard">
      <div className="dashboard-heading"><div><div className="eyebrow">YOUR PERSONAL FINDER</div><h1>A little less searching.<br className="mobile-break" /> A lot more finding.</h1><p>Your scout keeps an eye out. You get the good stuff.</p></div><button className="button button-primary new-scout" disabled={!canManage} onClick={() => { setEditing(null); setCreating(true); }}><Plus size={16} />New scout</button></div>
      {scoutPanel}
      <section className="scout-brief" aria-label="Your scout preferences"><div className="scout-brief-icon"><Search size={23} strokeWidth={1.6} /></div><div className="scout-brief-main"><div className="scout-title-row"><span className="scout-label">LOOKING FOR</span>{data.scouts.length > 1 ? <div className="scout-select-wrap"><select value={scout.id} onChange={e => { stopScanSession(); setActiveId(e.target.value); setFilter("all"); }} aria-label="Active scout">{data.scouts.map(s => <option key={s.id} value={s.id}>{s.query}</option>)}</select><ChevronDown size={15} /></div> : <h2>{scout.query}</h2>}</div><div className="brief-chips"><span><MapPin size={12} />{cityLabel(scout)}</span>{scout.maxWidthInches && <span><Ruler size={12} />Up to {scout.maxWidthInches}″ wide</span>}<span>{scout.workingRequired ? "Working condition" : "Repairs welcome"}</span><span><Clock3 size={12} />{ageWindow(scout.maxAgeHours)}</span></div></div><button className="text-button edit-brief" disabled={!canManage} onClick={() => setEditing(scout)}><SlidersHorizontal size={15} />Edit brief</button></section>
      <div className="dashboard-columns"><section className="finds-section"><div className="section-heading"><div className="section-title"><h2>{filter === "doesnt_fit" ? "Rejected listings" : "Your finds"}</h2><span className="count-badge">{filter === "doesnt_fit" ? rejectedCount : allListings.filter(l => l.userState !== "dismissed" && l.assessment?.decision !== "doesnt_fit" && l.assessment?.decision !== "pending").length}</span></div><span className="section-note">A second life starts here.</span></div><div className="filter-bar" role="tablist" aria-label="Filter finds">{[{ id: "all", label: "All finds" }, { id: "strong_fit", label: "Strong fit" }, { id: "needs_checking", label: "Needs checking" }, { id: "saved", label: "Saved", icon: true }, { id: "doesnt_fit", label: `Rejected (${rejectedCount})` }].map(f => <button key={f.id} role="tab" aria-selected={filter === f.id} className={`filter-tab ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>{f.icon && <Bookmark size={13} />}{f.label}</button>)}</div>
        <section className={`scan-progress ${failedCount || scout.lastError ? "attention" : ""}`} aria-label="Search progress" aria-live="polite"><div className="scan-progress-heading"><span className={`scan-progress-icon ${currentSession ? "working" : ""}`}>{currentSession ? <LoaderCircle size={18} className="spin" /> : failedCount || scout.lastError ? <Info size={18} /> : allReviewed ? <CheckCheck size={18} /> : <Clock3 size={18} />}</span><div><h3>{progressTitle}</h3><p>{progressDescription}</p></div></div><div className="scan-progress-counts"><div><strong>{allListings.length}</strong><span>Candidates</span></div><div><strong>{reviewedCount}</strong><span>Reviewed</span></div><div><strong>{matchCount}</strong><span>Matches</span></div><div><strong>{pendingCount}</strong><span>Waiting</span></div><div className={failedCount ? "has-failures" : ""}><strong>{failedCount}</strong><span>Failed steps</span></div></div>{allListings.length > 0 && <div className="scan-progress-bar" role="progressbar" aria-label="Saved candidates reviewed" aria-valuenow={reviewedCount} aria-valuemin={0} aria-valuemax={allListings.length}><span style={{ width: `${Math.min(100, reviewedCount / allListings.length * 100)}%` }} /></div>}<div className="scan-progress-footer"><span>{reviewedCount} reviewed · {rejectedCount} ruled out{work?.runningJobs ? ` · ${work.runningJobs} steps running` : ""}{work?.pendingJobs ? ` · ${work.pendingJobs} queued steps` : ""}</span>{currentSession && <button onClick={() => stopScanSession("Foreground checking stopped. Your saved queue remains available to the background scout.")}>Continue in background<ArrowUpRight size={11} /></button>}</div>{matchCount === 0 && rejectionReasons.length > 0 && <details className="rejection-summary"><summary>Why listings were ruled out<ChevronDown size={12} /></summary><ul>{rejectionReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></details>}{scanNote?.scoutId === scout.id && <p className="scan-session-note">{scanNote.message}</p>}</section>
        {filter !== "doesnt_fit" && <div className="freshness-explainer"><Clock3 size={15} /><p><strong>{ageWindow(scout.maxAgeHours)} · newest first.</strong> Posting dates come from Facebook. Undated listings need checking and do not trigger alerts.</p></div>}
        {filter === "doesnt_fit" && <div className="rejected-explainer"><ShieldCheck size={17} /><div><strong>A clear reason for every rejection.</strong><p>These listings failed a required age, price, availability, location, or fit check. Age alone does not mean an item is sold. Some checks happen before AI review. Rejected listings do not trigger email alerts.</p></div></div>}
        {error && <div className="inline-error"><Info size={15} />{error}<button onClick={() => refresh()}>Retry</button></div>}
        {!listings.length ? <div className="empty-finds"><div className="empty-orbit"><Search size={31} strokeWidth={1.3} /><span /><span /></div><h3>{emptyTitle}</h3><p>{emptyDescription}</p>{filter === "all" && <button className="button button-secondary" disabled={!canManage || !!currentSession || busy === "scan" || scout.status !== "active"} onClick={checkNow}>{busy === "scan" ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{currentSession ? isSearching ? "Searching…" : "Screening…" : failedCount ? "Retry check" : hasUnfinishedWork ? "Continue screening" : "Check now"}</button>}</div> : <div className="listing-grid">{listings.map((listing, index) => <ListingCard key={listing.id} listing={listing} index={index} onOpen={() => setSelectedId(listing.id)} onSave={() => setItemState(listing, listing.userState === "saved" ? "new" : "saved")} busy={busy === `item-${listing.id}`} canManage={canManage} />)}</div>}
        <div className="finds-footnote"><ShieldCheck size={15} /><p>Every find comes with the evidence. Missing details stay missing until confirmed.</p></div>
      </section><aside className="scout-sidebar"><section className="watch-card"><div className="watch-card-top"><span className="eyebrow">SCOUT STATUS</span><Radio size={18} strokeWidth={1.5} /></div><div className={`watch-status ${scout.status}`}><span className="live-dot" /><h3>{scout.status === "active" ? isSearching ? "Searching listings." : currentSession ? "Reviewing the details." : scout.lastError || failedCount ? "Needs attention." : hasBackoff ? "Waiting to retry." : hasUnfinishedWork ? "Checks waiting." : searchFinished ? "Search finished." : data.settings?.scheduleEnabled ? "Keeping an eye out." : "Ready to check." : scout.status === "paused" ? "Taking a breather." : "Mission accomplished."}</h3></div><p className="watch-description">{scout.status === "active" ? "Your brief is saved. New candidates are checked for fit, condition, and missing details." : scout.status === "paused" ? "Your finds are safe here. Resume whenever you’re ready." : "This scout is finished and alerts have stopped. Start another scout for your next find."}</p><div className="scan-times"><div><span>Last successful check</span><strong title={scout.lastCheckedAt || ""}>{relativeTime(scout.lastCheckedAt)}</strong></div><div><span>Next check</span><strong>{scout.status === "active" ? data.settings?.scheduleEnabled ? scout.nextCheckAt ? relativeTime(scout.nextCheckAt) : "Awaiting schedule" : "Not connected yet" : "Paused"}</strong></div></div>{scout.lastError && <div className="scan-error"><Info size={14} /><span>{scout.lastError}</span></div>}{data.settings?.scheduleEnabled === false && scout.status === "active" && <div className="schedule-note"><Clock3 size={14} /><span>Automatic checks are being connected. You can check now.</span></div>}{data.settings?.lastWorkerAt && <p className="worker-heartbeat">Worker checked in {relativeTime(data.settings.lastWorkerAt).toLowerCase()}.</p>}<div className="watch-actions"><button className="button button-primary" disabled={!canManage || !!currentSession || busy === "scan" || scout.status !== "active"} onClick={checkNow}>{busy === "scan" ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{currentSession ? isSearching ? "Searching…" : "Screening…" : failedCount ? "Retry check" : hasUnfinishedWork ? "Continue screening" : "Check now"}</button><button className="button button-secondary pause-button" disabled={!canManage || !!busy} onClick={() => mutate("pause", () => request(`/api/scouts/${scout.id}`, { method: "PATCH", body: JSON.stringify({ status: scout.status === "active" ? "paused" : "active" }) }), scout.status === "active" ? "Scout paused. Your finds are saved." : "Scout resumed.")}>{scout.status === "active" ? <Pause size={15} /> : <Play size={15} />}{scout.status === "active" ? "Pause" : "Resume"}</button></div></section>
        {canManage && <section className="email-card"><div className="email-icon"><Mail size={18} strokeWidth={1.6} /></div><div><h3>Finds in your inbox.</h3><p>{scout.allowUnknown ? "Strong fits and promising finds with missing details." : "Only finds that meet your required checks."} Only dated listings within your age window trigger alerts.</p><span className="email-address" title={scout.email}>{scout.email}</span></div></section>}
        <section className="activity-card"><div className="section-heading"><h3>Behind the finds</h3><span className="small-label">ACTIVITY</span></div>{!activity.length ? <p className="no-activity">Your scout’s checks and discoveries will appear here.</p> : <ol className="activity-list">{activity.map((a, i) => <li key={a.id}><span className={`activity-dot ${i === 0 ? "latest" : ""}`} /><p>{a.message}<time dateTime={a.createdAt}>{relativeTime(a.createdAt)}</time></p></li>)}</ol>}</section><div className="sidebar-note"><Heart size={15} strokeWidth={1.4} /><p>Less in the landfill.<br />More in someone’s life.</p></div>
      </aside></div>
      <footer className="page-footer"><span>Built for a city that keeps moving.</span><span>{cityLabel(scout)} <span className="footer-dot">✳</span></span></footer>
    </main>}
    {selected && demoSignedIn && <ItemDrawer listing={selected} scout={data.scouts.find(s => s.id === selected.scoutId)} onClose={() => setSelectedId(null)} onSetState={state => state === "collected" ? mutate(`item-${selected.id}`, () => request(`/api/scouts/${selected.scoutId}`, { method: "PATCH", body: JSON.stringify({ status: "collected" }) }), "Scout finished. Future checks and alerts are stopped.") : setItemState(selected, state)} onResale={(forceRefresh = false) => mutate(`resale-${selected.id}`, () => request(`/api/listings/${selected.id}/resale`, { method: "POST",body:JSON.stringify({scoutId:selected.scoutId,forceRefresh}) }))} busy={busy} onToast={setToast} canManage={canManage} />}
    {canManage && deleting && <div className="delete-layer"><button className="delete-backdrop" onClick={() => setDeleting(null)} aria-label="Cancel deleting scout" /><section className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-scout-title"><div className="delete-dialog-icon"><Trash2 size={23} strokeWidth={1.5} /></div><h2 id="delete-scout-title">Retire this scout?</h2><p><strong>{deleting.query}</strong> will be removed from My scouts. Its future checks and queued email alerts will stop. An email already being delivered may still arrive.</p><div className="delete-reversible"><ShieldCheck size={15} /><span>This is a reversible removal. Saved records are retained. You can restore it from Recently deleted; it will stay paused until you resume it.</span></div><div className="delete-dialog-actions"><button className="button button-secondary" onClick={() => setDeleting(null)} disabled={busy === `delete-${deleting.id}`}>Keep my scout</button><button className="button button-delete" disabled={busy === `delete-${deleting.id}`} onClick={confirmDelete}>{busy === `delete-${deleting.id}` ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}Delete scout</button></div></section></div>}
    {toast && <div className="toast" role="status"><Check size={17} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15} /></button></div>}
  </div>;
}

function DemoLogin({ onSignIn }: { onSignIn: () => void }) {
  return <main className="demo-login page-shell"><section className="demo-login-story"><div className="eyebrow"><span className="tiny-star">✳</span> GOOD THINGS GET A SECOND LIFE</div><h1>A city full of <br />possibilities.<br />{" "}<em>A scout for yours.</em></h1><p>Beautifully useful things find new homes every day. Your scout keeps looking, so you don’t have to.</p><div className="login-promise"><span><Search size={16} />Your brief</span><ArrowRight size={13} /><span><Eye size={16} />Always looking</span><ArrowRight size={13} /><span><Heart size={16} />Your next find</span></div><div className="login-city-note"><MapPin size={14} /><span>Finds across the United States.<br />Start with a city that works for you.</span></div></section><section className="demo-login-card"><div className="login-demo-pill"><span />DEMO LOGIN</div><div className="login-profile-avatar">AM<span>✳</span></div><h2>Welcome to Second Look.</h2><p className="login-intro">Take a look around with our sample profile.</p><div className="login-profile-details"><div><strong>Alex Morgan</strong><span>alex@secondlook.demo</span></div><span className="sample-profile-tag">SAMPLE PROFILE</span></div><button className="button button-primary" onClick={onSignIn}>Continue as Alex<ArrowRight size={17} /></button><div className="demo-login-note"><Info size={14} /><p>This is a demo login with no password. Alex is a sample profile in a shared, owner-private prototype; this does not create a separate private account.</p></div><p className="login-running-note"><Radio size={13} />Signing out leaves your scouts running.</p></section><footer className="login-footer"><Logo small /><span>A good find deserves a second look.</span></footer></main>;
}

function CityPicker({ value, selected, onType, onSelect }: { value: string; selected: boolean; onType: (text: string) => void; onSelect: (city: CityLocation) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CityLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(-1);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active >= 0) resultsRef.current?.querySelector<HTMLElement>(`[data-city-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    setResults([]); setActive(-1); setError(""); setSearched(false);
    if (!open || selected || value.trim().length < 2) { setLoading(false); return; }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await request<{ locations: CityLocation[] }>(`/api/locations?q=${encodeURIComponent(value.trim())}`, { signal: controller.signal });
        if (!cancelled) { setResults(data.locations); setSearched(true); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "City lookup is unavailable. Please try again.");
      } finally { if (!cancelled) setLoading(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [value, selected, open]);
  function choose(city: CityLocation) { onSelect(city); setOpen(false); setResults([]); setActive(-1); }
  const showResults = open && !selected && value.trim().length >= 2;
  return <div className="form-field city-field">
    <label htmlFor={`${id}-input`}>Search city</label>
    <div className="city-picker">
      <div className={`input-with-icon ${selected ? "city-selected" : ""}`}><MapPin size={18} /><input id={`${id}-input`} role="combobox" aria-autocomplete="list" aria-expanded={showResults} aria-controls={`${id}-results`} aria-activedescendant={active >= 0 && results[active] ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`} autoComplete="off" required maxLength={100} placeholder="e.g. Chicago, IL" value={value} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={event => { setResults([]); setActive(-1); setSearched(false); onType(event.target.value); setOpen(true); }} onKeyDown={event => {
        if (event.key === "Escape") { setOpen(false); setActive(-1); }
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); if (results.length) setActive(previous => (previous + 1) % results.length); }
        if (event.key === "ArrowUp") { event.preventDefault(); setOpen(true); if (results.length) setActive(previous => previous <= 0 ? results.length - 1 : previous - 1); }
        if (event.key === "Enter" && !selected) { event.preventDefault(); setOpen(true); if (!loading && results.length) choose(results[Math.max(0, active)]); }
      }} />{loading ? <LoaderCircle size={18} className="spin" aria-label="Looking up cities" /> : selected ? <Check size={18} aria-label="City selected" /> : null}</div>
      {showResults && <div className="city-results" ref={resultsRef} id={`${id}-results`} role="listbox" aria-label="Matching U.S. cities">
        {loading && <p role="status">Looking up U.S. cities…</p>}
        {!loading && error && <p className="city-lookup-error" role="alert">{error}</p>}
        {!loading && !error && searched && !results.length && <p>No matching city found. Try the city name and full state.</p>}
        {!loading && !error && results.map((city, index) => <button key={city.id} type="button" role="option" tabIndex={-1} data-city-index={index} id={`${id}-option-${index}`} aria-selected={active === index} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(city)}><MapPin size={17} /><span><strong>{city.city}</strong><small>{city.state}, United States</small></span>{active === index && <ArrowUpRight size={17} />}</button>)}
      </div>}
    </div>
    <small id={`${id}-help`}>{selected ? `Pickup city: ${value}. Listings in other cities are ruled out.` : "Type a city and choose its state from the suggestions. Your device location is not used."}</small>
    <small className="city-attribution">City data from <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a> via <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>.</small>
  </div>;
}

function ScoutForm({ scout, defaultEmail, onSave, onBack }: { scout: Scout | null; defaultEmail: string; onSave: (values: FormValues) => Promise<void>; onBack?: () => void }) {
  const [values, setValues] = useState<FormValues>(scout ? { maxAgeHours: String(scout.maxAgeHours || 24), query: scout.query, neighborhood: scout.neighborhood, cityQuery: cityLabel(scout), locationId: scout.location?.id || "", email: scout.email, maxWidth: String(scout.maxWidthInches || ""), maxDepth: String(scout.maxDepthInches || ""), maxHeight: String(scout.maxHeightInches || ""), workingRequired: scout.workingRequired, allowUnknown: scout.allowUnknown } : { ...DEFAULT_FORM, email: defaultEmail });
  const [expanded, setExpanded] = useState(!!(scout?.maxWidthInches || scout?.maxDepthInches || scout?.maxHeightInches));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function field<K extends keyof FormValues>(key: K, value: FormValues[K]) { setValues(previous => ({ ...previous, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!values.locationId && !(scout && !scout.location && values.neighborhood === scout.neighborhood && values.cityQuery === cityLabel(scout))) { setError("Choose a U.S. city from the suggestions before saving."); return; }
    setSaving(true);
    try { await onSave(values); } catch (err) { setError(err instanceof Error ? err.message : "We couldn’t save this scout."); } finally { setSaving(false); }
  }
  return <main className="onboarding page-shell">{onBack && <button className="text-button back-link" onClick={onBack}><ArrowLeft size={16} />Back to your finds</button>}<div className="onboarding-grid"><section className="onboarding-story"><div className="eyebrow"><span className="tiny-star">✳</span> YOUR CITY, SECOND TIME AROUND</div><h1>Someone’s moving out.<br />{" "}Your next great find<br />{" "}is moving in<span className="green-period">.</span></h1><p className="onboarding-description">The desk. The monitor. The chair you’ve been looking for. Tell your scout what fits your life, then get on with it.</p><div className="scout-illustration" aria-hidden="true"><div className="radar-circle radar-one" /><div className="radar-circle radar-two" /><div className="radar-circle radar-three" /><div className="illustration-center"><Eye size={39} strokeWidth={1.4} /></div><div className="float-item float-monitor"><Monitor size={38} strokeWidth={1.2} /><span>A clearer view.</span></div><div className="float-item float-chair"><Armchair size={43} strokeWidth={1.2} /><span>A comfier corner.</span></div><div className="float-item float-lamp"><LampDesk size={32} strokeWidth={1.2} /></div><span className="illustration-spark spark-one">✳</span><span className="illustration-spark spark-two">+</span></div><div className="onboarding-promise"><span><Search size={15} />Finds while you’re away</span><span><ShieldCheck size={15} />Evidence, not guesses</span><span><Bell size={15} />Only useful alerts</span></div></section><section className="scout-form-card"><div className="form-step">{scout ? "MAKE IT MORE YOU" : "A SMALL BRIEF. A BETTER FIND."}</div><h2>{scout ? "Refine your scout." : "What are we looking for?"}</h2><p className="form-intro">{scout ? "Update the details your scout should keep in mind." : "Set up your personal scout in about a minute."}</p><form onSubmit={submit}><label className="form-field"><span>I’m looking for</span><div className="input-with-icon"><Search size={17} /><input autoFocus required minLength={2} maxLength={80} placeholder="e.g. a standing desk" value={values.query} onChange={e => field("query", e.target.value)} /></div><small>A specific item works best. We’ll look for free listings.</small></label><CityPicker value={values.cityQuery} selected={Boolean(values.locationId || (scout && !scout.location && values.neighborhood === scout.neighborhood && values.cityQuery === cityLabel(scout)))} onType={text => setValues(previous => ({ ...previous, cityQuery: text, locationId: "", neighborhood: "" }))} onSelect={city => setValues(previous => ({ ...previous, cityQuery: city.label, locationId: city.id, neighborhood: city.label }))} /><label className="form-field freshness-form-field"><span>How recent should listings be?</span><div className="select-wrap"><Clock3 size={15} /><select aria-label="Listing age window" value={values.maxAgeHours} onChange={e => field("maxAgeHours", e.target.value)}><option value="24">Last 24 hours</option><option value="168">Last 7 days</option><option value="720">Last 30 days</option></select><ChevronDown size={13} /></div><small>Newest listings first. Older listings are ruled out. Unknown posting dates stay flagged and never trigger alerts.</small></label><button className={`dimension-toggle ${expanded ? "expanded" : ""}`} type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><span><Ruler size={16} />Does it need to fit a space?</span><span>{expanded ? "Hide" : "Add dimensions"}<ChevronDown size={14} /></span></button>{expanded && <div className="dimensions-fields"><p>Maximum size, in inches. Leave anything flexible blank.</p><div className="form-row">{[{ key: "maxWidth" as const, label: "Width" }, { key: "maxDepth" as const, label: "Depth" }, { key: "maxHeight" as const, label: "Height" }].map(f => <label className="form-field" key={f.key}><span>{f.label}</span><div className="unit-input"><input type="number" min="1" max="300" step="0.1" placeholder="Any" value={values[f.key]} onChange={e => field(f.key, e.target.value)} /><span>in</span></div></label>)}</div><small>Missing measurements will be flagged, never guessed from photos.</small></div>}<label className="checkbox-row"><input type="checkbox" checked={values.workingRequired} onChange={e => field("workingRequired", e.target.checked)} /><span><strong>It needs to work</strong><small>Flag broken, parts-only, or unconfirmed functioning.</small></span></label><label className="form-field email-form-field"><span>Send my finds to</span><div className="input-with-icon"><Mail size={16} /><input type="email" required readOnly title="Demo alerts are limited to this verified account inbox." aria-label="Demo alert inbox" placeholder="Demo inbox" value={values.email} onChange={e => field("email", e.target.value)} /></div>{defaultEmail && <small>Demo alerts go to the connected team inbox above.</small>}</label><label className="checkbox-row unknown-checkbox"><input type="checkbox" checked={values.allowUnknown} onChange={e => field("allowUnknown", e.target.checked)} /><span><strong>Include promising finds with missing details</strong><small>We’ll show exactly what still needs checking.</small></span></label>{error && <div className="form-error" role="alert"><Info size={15} />{error}</div>}<button className="button button-primary form-submit" disabled={saving} type="submit">{saving ? <><LoaderCircle size={17} className="spin" />Getting your scout ready…</> : <>{scout ? "Save my brief" : "Start my scout"}<ArrowRight size={17} /></>}</button><p className="form-fine-print"><ShieldCheck size={12} />Your scout never contacts a seller or commits you to a pickup.</p></form></section></div><footer className="onboarding-footer"><span>A good find deserves a second look.</span><span>Finds in your city <span className="footer-dot">✳</span></span></footer></main>;
}

function ListingCard({ listing, index, onOpen, onSave, busy, canManage = true }: { listing: Listing; index: number; onOpen: () => void; onSave: () => void; busy: boolean; canManage?: boolean }) {
  const rejected = listing.assessment?.decision === "doesnt_fit";
  const failures = rejected ? failedChecks(listing.assessment) : [];
  const featureCheck = listing.requestedFeatureCheck;
  const caveat = rejected ? undefined : [...(listing.assessment?.missingDetails || []), ...(listing.assessment?.visualConcerns || [])].find(note => note !== featureCheck?.summary);
  return <article className={`listing-card ${rejected ? "rejected-card" : ""}`} style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}>
    <div className="listing-photo"><button className="photo-open" onClick={onOpen} aria-label={`Review ${listing.title}`}><ItemImage src={listing.imageUrl || listing.images?.[0]} title={listing.title} /></button><span className="free-badge listed-price">{listedPrice(listing.price)}</span>{(!rejected || listing.userState === "saved") && <button className={`save-button ${listing.userState === "saved" ? "is-saved" : ""}`} onClick={onSave} aria-label={listing.userState === "saved" ? `Unsave ${listing.title}` : `Save ${listing.title}`} aria-pressed={listing.userState === "saved"} disabled={!canManage || busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Bookmark size={17} fill={listing.userState === "saved" ? "currentColor" : "none"} />}</button>}{listing.userState === "collected" && <span className="collected-overlay"><CheckCheck size={14} />Collected</span>}</div>
    <button className="listing-card-body" onClick={onOpen}><div className="card-location"><span><MapPin size={11} />{listing.location || "Location needs checking"}</span></div><p className={`card-posted-date ${listing.freshness?.status || "unknown"}`} title={postingTitle(listing)}><Clock3 size={11} />{postedLabel(listing)}</p><h3>{listing.title}</h3><div className="card-fit-row"><DecisionBadge decision={listing.assessment?.decision} /></div><p className="card-reason">{rejected ? failures[0] || "A required check did not pass. Open the review for details." : listing.assessment?.summary || listing.assessment?.reasons?.[0] || "Checking this listing against your brief."}</p>{featureCheck && (rejected || featureCheck.status !== "supported") && <div className={`card-feature-check ${featureCheck.status}`}><span>{featureCheck.status === "supported" ? <Check size={12} /> : featureCheck.status === "mismatch" ? <X size={12} /> : <CircleHelp size={12} />}{featureCheck.status === "supported" ? "Requested capability stated" : featureCheck.status === "mismatch" ? "Requested capability not met" : "Requested capability unconfirmed"}</span><p>{featureCheck.summary}</p></div>}{rejected && failures.length > 1 && <p className="card-rejection-more">+{failures.length - 1} more failed {failures.length === 2 ? "check" : "checks"}</p>}{caveat && <p className="card-caveat"><CircleHelp size={12} /><span>{caveat}</span></p>}<div className="card-bottom"><span>{rejected ? "See rejection details" : "Take a second look"}</span><ArrowUpRight size={16} /></div></button>
  </article>;
}

function ItemDrawer({ listing, scout, onClose, onSetState, onResale, busy, onToast, canManage = true }: { listing: Listing; scout?: Scout; onClose: () => void; onSetState: (state: UserState) => void; onResale: (forceRefresh?: boolean) => void; busy: string; onToast: (message: string) => void; canManage?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [photo, setPhoto] = useState(0);
  const assessment = listing.assessment;
  const rejected = assessment?.decision === "doesnt_fit";
  const failures = rejected ? failedChecks(assessment) : [];
  const supportingNotes = (assessment?.reasons || []).filter(reason => !failures.includes(reason));
  const featureCheck = listing.requestedFeatureCheck;
  const extraUnknowns = [...(assessment?.missingDetails || []), ...(assessment?.visualConcerns || [])].filter(note => note !== featureCheck?.summary);
  const photos = [...new Set([listing.imageUrl, ...(listing.images || [])].filter(Boolean))] as string[];
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; closeRef.current?.focus(); const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); if (event.key === "Tab") { const dialog = document.querySelector(".item-drawer"); const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select'); if (!focusable?.length) return; const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }; document.addEventListener("keydown", listener); return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", listener); previous?.focus(); }; }, [onClose]);
  const question = assessment?.pickupQuestions?.join(" ") || `Hi! Is this ${listing.title.toLowerCase()} still available? Could you confirm ${assessment?.missingDetails?.length ? assessment.missingDetails.join(" and ") : "its condition and pickup details"}? Thank you!`;
  async function copyQuestion() { try { await navigator.clipboard.writeText(question); onToast("Seller question copied. Paste it in Facebook Messenger."); } catch { onToast("Copy isn’t available here. Select the question text to copy it."); } }
  const resale = listing.resale;
  return <div className="drawer-layer"><button className="drawer-backdrop" onClick={onClose} aria-label="Close item details" /><section className="item-drawer" role="dialog" aria-modal="true" aria-labelledby="item-title"><div className="drawer-topbar"><span><Eye size={17} />A SECOND LOOK</span><button className="icon-button" ref={closeRef} onClick={onClose} aria-label="Close item details"><X size={20} /></button></div><div className="drawer-scroll"><div className="drawer-photo"><ItemImage src={photos[photo]} title={listing.title} /><span className="free-badge listed-price">{listedPrice(listing.price)}</span>{photos.length > 1 && <div className="photo-pagination">{photos.map((_, i) => <button key={i} className={photo === i ? "active" : ""} onClick={() => setPhoto(i)} aria-label={`View photo ${i + 1}`} aria-pressed={photo === i} />)}</div>}</div><div className="drawer-content"><div className="drawer-meta"><span><MapPin size={13} />{listing.location || "Location needs checking"}</span><span className="drawer-posted-date" title={postingTitle(listing)}>{postedLabel(listing, true)}</span></div><h2 id="item-title">{listing.title}</h2><div className="drawer-decision"><DecisionBadge decision={assessment?.decision} /><span>For your {scout?.query || "item"} scout</span></div><div className={`listing-freshness-note ${listing.freshness?.status || "unknown"}`}><Clock3 size={14} /><p>{listing.freshness?.status === "recent" ? `Posting date is within your ${(ageWindow(scout?.maxAgeHours)).toLowerCase()} window. Ask the seller to confirm availability before pickup.` : listing.freshness?.status === "older" ? `Outside your ${(ageWindow(scout?.maxAgeHours)).toLowerCase()} window. An older posting does not prove it is sold, but it is excluded from current matches and alerts.` : "The source did not provide a usable exact posting date. Recency and availability need checking; this listing will not trigger an email alert."}</p></div>{rejected ? <><section className="rejection-detail"><h3><X size={17} />Why it was rejected</h3><ul>{failures.length ? failures.map((reason, i) => <li key={i}>{reason}</li>) : <li>A required check did not pass. The saved review has no further explanation.</li>}</ul><p>Checked against your scout’s requirements using source data and, where needed, AI-extracted details. This listing is excluded from email alerts.</p></section>{!!supportingNotes.length && <details className="review-notes"><summary>Other review notes<ChevronDown size={14} /></summary><ul>{supportingNotes.map((reason, i) => <li key={i}>{reason}</li>)}</ul></details>}</> : <><p className="drawer-summary">{assessment?.summary || "Your scout is reviewing the details."}</p>{assessment?.reasons?.length ? <div className="fit-reasons">{assessment.reasons.map((reason, i) => <div key={i}><Check size={15} /><span>{reason}</span></div>)}</div> : null}</>}
        {featureCheck && <RequestedFeatureReview check={featureCheck} />}
        {!!extraUnknowns.length && <section className="unknown-box"><h3><CircleHelp size={16} />A few things to check</h3><ul>{extraUnknowns.map((unknown, i) => <li key={i}>{unknown}</li>)}</ul></section>}
        <section className="drawer-section"><div className="drawer-section-heading"><h3><Ruler size={16} />Will it fit?</h3><span className="small-label">FROM THE LISTING</span></div><div className="dimension-grid">{[{ key: "widthInches" as const, label: "Width", max: scout?.maxWidthInches }, { key: "depthInches" as const, label: "Depth", max: scout?.maxDepthInches }, { key: "heightInches" as const, label: "Height", max: scout?.maxHeightInches }].map(d => <div key={d.key}><span>{d.label}</span><strong>{assessment?.dimensions?.[d.key] ? `${Math.round(assessment.dimensions[d.key]! * 10) / 10}″` : "Unknown"}</strong>{d.max && <small>Your max: {d.max}″</small>}</div>)}</div><p className="section-fine-print">{assessment?.dimensions?.source || "Measurements require listing evidence. Photos alone don’t establish size."}</p></section>
        {rejected && !assessment?.evidence?.length && <p className="section-fine-print rejection-source-note">No quoted seller evidence was saved for this decision. The failed check above records the reason; review the original listing for context.</p>}
        {!!assessment?.evidence?.length && <section className="drawer-section"><div className="drawer-section-heading"><h3><ShieldCheck size={16} />The evidence</h3></div><div className="evidence-list">{assessment.evidence.map((evidence, i) => <div key={i}><span>{evidence.field || evidence.source || "Listing description"}</span><blockquote>“{evidence.quote || evidence.value}”</blockquote></div>)}</div></section>}
        {!rejected && <ResalePanel resale={resale} onResale={onResale} busy={busy === `resale-${listing.id}`} canManage={canManage} />}
        {!rejected && <section className="drawer-section"><div className="drawer-section-heading"><h3><Mail size={16} />A good first question</h3><button className="text-button copy-button" onClick={copyQuestion}><Copy size={13} />Copy</button></div><p className="seller-question">{question}</p><p className="section-fine-print">You send the message on Facebook. Your scout never contacts the seller.</p></section>}
        {listing.description && <details className="source-description"><summary>Original listing description<ChevronDown size={15} /></summary><p>{listing.description}</p></details>}
        {!rejected && <div className="item-secondary-actions"><button className="text-button" onClick={() => onSetState(listing.userState === "collected" ? "new" : "collected")} disabled={!canManage || busy === `item-${listing.id}`}><CheckCheck size={15} />{listing.userState === "collected" ? "Undo collected" : "Collected this? Finish scout"}</button><button className="text-button dismiss-button" onClick={() => { onSetState("dismissed"); onClose(); }} disabled={!canManage || busy === `item-${listing.id}`}><X size={15} />Dismiss find</button></div>}
      </div></div><div className="drawer-bottom">{(!rejected || listing.userState === "saved") && <button className={`button button-secondary drawer-save ${listing.userState === "saved" ? "saved" : ""}`} onClick={() => onSetState(listing.userState === "saved" ? "new" : "saved")} disabled={!canManage || busy === `item-${listing.id}`}><Bookmark size={17} fill={listing.userState === "saved" ? "currentColor" : "none"} />{listing.userState === "saved" ? rejected ? "Unsave" : "Saved" : "Save"}</button>}<a className="button button-primary" href={safeUrl(listing.sourceUrl)} target="_blank" rel="noopener noreferrer">View on Facebook<ArrowUpRight size={17} /></a></div></section></div>;
}


function ComparisonLinks({ comparisons }: { comparisons?: Comparison[] }) {
  if (!comparisons?.length) return null;
  return <div className="comparisons resale-comparison-links">{comparisons.map((comparison, i) => {
    const posted = sourcePostedAt(comparison.postedAt);
    return <a href={safeUrl(comparison.url)} target="_blank" rel="noopener noreferrer" title={comparison.matchNote} key={comparison.id || i}>
      <span className="comparison-copy"><span>{comparison.title}</span><small>{comparison.city || comparison.location || "San Francisco"}{posted ? ` · Listed ${new Date(posted).toLocaleDateString("en-US", {month:"short",day:"numeric",timeZone:"America/Los_Angeles"})}` : ""}</small></span>
      <strong>${comparison.price.toLocaleString()}</strong><ArrowUpRight size={13} />
    </a>;
  })}</div>;
}

function ResalePanel({ resale, onResale, busy, canManage = true }: { resale?: Resale | null; onResale: (forceRefresh?: boolean) => void; busy: boolean; canManage?: boolean }) {
  const hasRange = resale?.status === "ready" && resale.low != null && resale.high != null;
  const similar = resale?.basis === "similar_items";
  const count = resale?.sampleCount ?? resale?.comparisons?.length ?? 0;
  return <section className="drawer-section resale-section" aria-label="Comparable asking prices">
    <div className="drawer-section-heading"><h3><RefreshCw size={16} />What similar items cost</h3><span className="resale-tag">ASKING PRICES</span></div>
    {resale ? <>
      {resale.basis && <span className={`comparison-basis ${similar ? "similar" : "exact"}`}>{similar ? <CircleHelp size={12} /> : <ShieldCheck size={12} />}{similar ? "Similar items · low confidence" : "Same brand & model"}</span>}
      {hasRange ? <><div className="resale-price">${resale.low!.toLocaleString()}<span>–</span>${resale.high!.toLocaleString()}</div><p className="resale-caption">{similar ? "Similar-item asking prices" : "Same-model asking prices"} · {count} {resale.geography || "local"} listings</p></> : <div className="resale-empty resale-partial"><CircleHelp size={19} /><h4>{count ? `${count} comparison${count === 1 ? "" : "s"} found. A range needs three.` : "No suitable comparison prices yet."}</h4></div>}
      {resale.summary && <p className={`resale-summary ${similar ? "similar-reference-note" : ""}`}>{hasRange ? similar ? "A broad category comparison. Brand, model, condition and specifications may differ." : "Matched using the brand and model named in each listing. Condition and specifications may differ." : resale.summary.split(" Only explicitly San Francisco")[0]}</p>}
      {resale.query && <p className="comparison-query">Searched Facebook Marketplace for <strong>{resale.query}</strong>{resale.version === 2 ? " · source dates within 30 days" : ""}.</p>}
      <ComparisonLinks comparisons={resale.comparisons} />
      {resale.summary && resale.basis && <details className="comparison-method"><summary>How comparisons are picked<ChevronDown size={12} /></summary><p>{resale.summary}</p></details>}
      <p className="section-fine-print">These are advertised prices, not completed sales or a valuation of your item. Condition, size and model differences can affect what it sells for.{resale.fetchedAt ? ` Checked ${relativeTime(resale.fetchedAt).toLowerCase()}.` : ""}</p>
      <button className="text-button refresh-comparisons" onClick={() => onResale(true)} disabled={!canManage || busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}{busy ? "Checking current listings…" : hasRange ? "Refresh prices" : "Try another check"}</button>
    </> : <div className="resale-prompt"><p>See paid listings for the same model when known, or clearly labelled similar items when it isn’t. Price references currently use San Francisco listings, even when your scout is in another city.</p><button className="button button-secondary" onClick={() => onResale(false)} disabled={!canManage || busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}{busy ? "Finding comparisons…" : "Check comparable prices"}</button></div>}
    {!canManage && <p className="section-fine-print">Saved price references are available to browse. A demo manager can request a fresh comparison.</p>}
    {busy && <p className="comparison-progress" role="status">Looking up paid listings and checking their type, date and availability.</p>}
  </section>;
}


function RequestedFeatureReview({ check }: { check: RequestedFeatureCheck }) {
  return <section className={`requested-feature-review ${check.status}`} aria-label="Requested item type check">
    <div className="requested-feature-heading"><h3>{check.status === "supported" ? <Check size={15} /> : check.status === "mismatch" ? <X size={15} /> : <CircleHelp size={15} />}{check.label}</h3><span>{check.status === "supported" ? "Stated by seller" : check.status === "mismatch" ? "Does not meet brief" : "Unconfirmed"}</span></div>
    <p>{check.summary}</p>{check.quote && <blockquote>“{check.quote}”</blockquote>}
    <small>Based on the available listing text. A photo alone does not establish adjustable function.</small>
  </section>;
}
