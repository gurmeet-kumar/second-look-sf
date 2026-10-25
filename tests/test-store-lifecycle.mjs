import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

import { appDir, bundleDir, require, build } from './support/paths.mjs';
const testEnv = { DB: undefined, DEMO_EMAIL: 'demo@example.invalid' };
globalThis.__secondLookTestEnv = testEnv;

const bundle = await build({
  entryPoints: [path.join(appDir, 'lib/store.ts')],
  absWorkingDir: appDir,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'mock-cloudflare-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'mock-runtime' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock-runtime' }, () => ({ contents: 'export const env = globalThis.__secondLookTestEnv;', loader: 'js' }));
    },
  }],
});
const bundlePath = path.join(bundleDir, 'store-lifecycle.bundle.cjs');
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const store = require(bundlePath);
const migration = readFileSync(path.join(appDir, 'drizzle/0000_needy_domino.sql'), 'utf8');

class D1Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new D1Statement(this.db, this.sql, args); }
  async first(column) {
    const result = this.db.prepare(this.sql).get(...this.args);
    if (!result) return null;
    return column ? result[column] : result;
  }
  async all() { return { success: true, results: this.db.prepare(this.sql).all(...this.args), meta: {} }; }
  runSync() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async run() { return this.runSync(); }
}

class D1Adapter {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec(migration); }
  prepare(sql) { return new D1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(statement => statement.runSync());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

let db;
function reset() {
  if (db) db.sqlite.close();
  db = new D1Adapter();
  testEnv.DB = db;
}
const newScout = () => ({ query: 'standing desk', neighborhood: 'Mission District', radiusMiles: 5, maxWidthIn: 48, maxDepthIn: null, maxHeightIn: null, condition: 'working', includeUnknowns: true });
const row = (sql, ...args) => db.sqlite.prepare(sql).get(...args);
function listing(scoutId, id = 'item-1') {
  return { id, scoutId, url: `https://www.facebook.com/marketplace/item/${id}/`, title: 'Free standing desk', description: 'Working desk. 48 inches wide.', price: 0, city: 'San Francisco, CA', photo: null, photos: [], firstSeenAt: new Date().toISOString(), sourceCreatedAt: null, decision: 'strong_fit', reasons: ['Fits requirements.'], unknowns: [], questions: [], evidence: [], dimensions: { widthIn: 48, depthIn: null, heightIn: null }, brand: null, model: null, conditionNote: 'Seller reports working.', visualNote: null, visualStatus: 'not_requested', distanceMiles: 2, userState: 'saved', resale: null };
}

const checks = [];
async function check(name, fn) {
  reset();
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}

await check('create cap; deletion frees a slot; full-cap restore stays deleted', async () => {
  const scouts = [];
  for (let index = 0; index < 3; index++) scouts.push(await store.createScout(newScout()));
  await assert.rejects(store.createScout(newScout()), /three scouts/);
  assert.equal((await store.listScouts()).length, 3);
  assert.equal(await store.deleteScout(scouts[1].id), true);
  await store.createScout(newScout());
  assert.equal((await store.listScouts()).length, 3);
  await assert.rejects(store.restoreScout(scouts[1].id), /three scouts/);
  assert.equal((await store.getScout(scouts[1].id, true)).status, 'deleted');
});

await check('deletion cancels queued/running/failed work and pending alerts; hides saved finds', async () => {
  const scout = await store.createScout(newScout());
  await store.putItem({ id: 'item-1', title: 'Free desk', url: 'https://example.invalid/item-1' });
  await store.upsertMatch(scout.id, 'item-1', listing(scout.id));
  await store.addJob({ scoutId: scout.id, itemId: 'item-1', stage: 'detail', payload: {} });
  const claimed = await store.claimJob();
  assert.ok(claimed);
  await store.addJob({ scoutId: scout.id, itemId: 'item-1', stage: 'screen', payload: {} });
  await store.addJob({ scoutId: scout.id, itemId: 'item-1', stage: 'email', payload: {} });
  db.sqlite.prepare("UPDATE jobs SET status = 'failed' WHERE stage = 'email'").run();
  const pending = await store.reserveAlert(scout.id, 'item-1');
  const sent = await store.reserveAlert(scout.id, 'item-2');
  await store.markAlert(sent.id, 'sent', 'email-provider-id');
  assert.equal(await store.deleteScout(scout.id), true);
  assert.equal(await store.deleteScout(scout.id), true);
  assert.equal(row("SELECT COUNT(*) count FROM jobs WHERE scout_id = ? AND status = 'cancelled'", scout.id).count, 3);
  assert.equal((await store.getAlert(scout.id, 'item-1')).status, 'cancelled');
  assert.equal((await store.getAlert(scout.id, 'item-2')).status, 'sent');
  assert.equal(await store.getScout(scout.id), null);
  assert.equal(await store.getMatch(scout.id, 'item-1'), null);
  assert.deepEqual(await store.listMatches(), []);
  assert.deepEqual(await store.listScouts(), []);
  assert.equal((await store.listScouts(true)).length, 1);
  assert.equal(await store.countPendingJobs(), 0);
  assert.equal(await store.claimJob(), null);
  assert.equal(await store.ownsJobLease(claimed), false);
  const state = await store.getAppState();
  assert.equal(state.scouts.length, 0);
  assert.equal(state.listings.length, 0);
  assert.equal(state.deletedScouts.length, 1);
  assert.ok(pending);
});

await check('deleted scouts cannot be mutated, reactivated, claimed, or given new work', async () => {
  const scout = await store.createScout(newScout());
  await store.upsertMatch(scout.id, 'item-1', listing(scout.id));
  await store.deleteScout(scout.id);
  assert.equal(await store.updateMatchState('item-1', 'dismissed', scout.id), false);
  assert.equal(await store.updateMatchState('item-1', 'dismissed'), false);
  assert.equal(await store.updateScout(scout.id, { status: 'active', query: 'monitor' }), null);
  assert.equal(await store.claimScout(scout.id, true), null);
  assert.deepEqual(await store.dueScouts(Date.now() + 60_000), []);
  assert.equal(await store.reserveAlert(scout.id, 'new-item'), null);
  await store.addJob({ scoutId: scout.id, itemId: 'new-item', stage: 'detail', payload: {} });
  await store.upsertMatch(scout.id, 'new-item', listing(scout.id, 'new-item'));
  assert.equal(row('SELECT COUNT(*) count FROM jobs').count, 0);
  assert.equal(row('SELECT COUNT(*) count FROM matches').count, 1);
  assert.equal(row('SELECT user_state FROM matches WHERE scout_id = ?', scout.id).user_state, 'saved');
  assert.equal((await store.getScout(scout.id, true)).query, 'standing desk');
});

await check('restore retains finds, resets cancelled work, and stays paused until resume', async () => {
  const scout = await store.createScout(newScout());
  await store.upsertMatch(scout.id, 'item-1', listing(scout.id));
  await store.addJob({ scoutId: scout.id, itemId: 'item-1', stage: 'detail', payload: {} });
  await store.reserveAlert(scout.id, 'item-1');
  await store.deleteScout(scout.id);
  const restored = await store.restoreScout(scout.id);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.nextCheckAt, null);
  assert.equal((await store.getMatch(scout.id, 'item-1')).userState, 'saved');
  assert.equal(row('SELECT status FROM jobs WHERE scout_id = ?', scout.id).status, 'pending');
  assert.equal((await store.getAlert(scout.id, 'item-1')).status, 'pending');
  assert.equal(await store.claimJob(), null);
  assert.deepEqual(await store.dueScouts(Date.now() + 60_000), []);
  assert.equal(await store.reserveAlert(scout.id, 'new-item'), null);
  await store.updateScout(scout.id, { status: 'active', nextCheckAt: new Date().toISOString() });
  assert.ok(await store.claimJob());
});

await check('old lease cannot complete or retry newly claimed work after delete/restore/resume', async () => {
  const scout = await store.createScout(newScout());
  await store.addJob({ scoutId: scout.id, itemId: 'item-1', stage: 'detail', payload: {} });
  const firstNow = Date.now();
  const oldLease = await store.claimJob(firstNow);
  assert.ok(oldLease);
  assert.equal(await store.ownsJobLease(oldLease), true);
  await store.deleteScout(scout.id);
  await store.restoreScout(scout.id);
  await store.updateScout(scout.id, { status: 'active' });
  const newLease = await store.claimJob(firstNow + 1_000);
  assert.ok(newLease);
  assert.equal(oldLease.id, newLease.id);
  assert.notEqual(oldLease.leaseUntil, newLease.leaseUntil);
  assert.equal(await store.ownsJobLease(oldLease), false);
  assert.equal(await store.ownsJobLease(newLease), true);
  await store.completeJob(oldLease);
  assert.equal(row('SELECT status FROM jobs WHERE id = ?', newLease.id).status, 'running');
  await store.retryJob(oldLease, 'late old worker failure', 60_000);
  const stillRunning = row('SELECT * FROM jobs WHERE id = ?', newLease.id);
  assert.equal(stillRunning.status, 'running');
  assert.equal(stillRunning.lease_until, Date.parse(newLease.leaseUntil));
  assert.equal(stillRunning.error, null);
  await store.retryJob(newLease, 'current worker failure', 0);
  assert.equal(row('SELECT status FROM jobs WHERE id = ?', newLease.id).status, 'pending');
  const finalLease = await store.claimJob(firstNow + 2_000);
  assert.ok(finalLease);
  await store.completeJob(finalLease);
  assert.equal(row('SELECT status FROM jobs WHERE id = ?', newLease.id).status, 'done');
});

await check('partial atomic updates preserve concurrent status and accept explicit null', async () => {
  const scout = await store.createScout(newScout());
  await store.updateScout(scout.id, { status: 'paused' });
  const updated = await store.updateScout(scout.id, { maxWidthIn: null, lastError: null, query: 'monitor' });
  assert.equal(updated.status, 'paused');
  assert.equal(updated.maxWidthIn, null);
  assert.equal(updated.query, 'monitor');
  assert.equal(row('SELECT status FROM scouts WHERE id = ?', scout.id).status, 'paused');
});

await check('stale duplicate scan batches preserve completed reviews; explicit failures can update', async () => {
  const scout=await store.createScout(newScout());
  const item={id:'item-1',title:'Free standing desk',url:'https://example.invalid/item-1',price:{amount:0}};
  const pending={...listing(scout.id),decision:'pending',reasons:[]};
  await store.saveSearchCandidates(scout.id,[{item,listing:pending,queue:true}]);
  await store.upsertMatch(scout.id,item.id,{decision:'strong_fit',reasons:['Reviewed after the other scan took its snapshot.'],brand:'Brand',model:'Model'});
  await store.updateMatchState(item.id,'saved',scout.id);
  await store.saveSearchCandidates(scout.id,[{item,listing:pending,queue:true}]);
  const reviewed=await store.getMatch(scout.id,item.id);
  assert.equal(reviewed.decision,'strong_fit');
  assert.deepEqual(reviewed.reasons,['Reviewed after the other scan took its snapshot.']);
  assert.equal(reviewed.model,'Model');
  assert.equal(reviewed.userState,'saved');
  await store.saveSearchCandidates(scout.id,[{item,listing:{...reviewed,decision:'rejected',reasons:['The listing is now unavailable.']},queue:false}]);
  assert.equal((await store.getMatch(scout.id,item.id)).decision,'rejected');
});

await check('search summaries preserve detailed item description and nested location coordinates', async () => {
  const scout=await store.createScout(newScout());
  const detailed={id:'item-1',title:'Original title',url:'https://example.invalid/item-1',description:'Width: 48 inches. Fully working motor.',location:{city:'San Francisco',latitude:37.7599,longitude:-122.4148},attributes:[{attribute_name:'Condition',value:'Used - good'}],price:{amount:0}};
  await store.putItem(detailed);
  const summary={id:'item-1',title:'Updated search title',url:detailed.url,location:{city:'San Francisco'},price:{amount:0}};
  await store.saveSearchCandidates(scout.id,[{item:summary,listing:{...listing(scout.id),decision:'pending'},queue:true}]);
  const preserved=await store.getItem('item-1');
  assert.equal(preserved.title,'Updated search title');
  assert.equal(preserved.description,detailed.description);
  assert.equal(preserved.location.latitude,detailed.location.latitude);
  assert.equal(preserved.location.longitude,detailed.location.longitude);
  assert.deepEqual(preserved.attributes,detailed.attributes);
});

await check('legacy completed detail orphan is repaired when its listing remains pending', async () => {
  const scout=await store.createScout(newScout());
  await store.upsertMatch(scout.id,'item-1',{...listing(scout.id),decision:'pending'});
  await store.addJob({scoutId:scout.id,itemId:'item-1',stage:'detail',payload:{}});
  const detail=await store.claimJob();
  await store.completeJob(detail);
  assert.equal(await store.countPendingJobs(scout.id),0);
  await store.advanceScoutJobs(scout.id);
  const repaired=row('SELECT * FROM jobs WHERE id=?',detail.id);
  assert.equal(repaired.status,'pending');
  assert.equal(repaired.attempts,0);
  assert.equal(repaired.lease_until,null);
  assert.ok(await store.claimJob());
});

await check('orphan repair preserves completed detail when screening is pending, running, or failed', async () => {
  const scout=await store.createScout(newScout());
  await store.upsertMatch(scout.id,'item-1',{...listing(scout.id),decision:'pending'});
  await store.addJob({scoutId:scout.id,itemId:'item-1',stage:'detail',payload:{}});
  const detail=await store.claimJob();await store.completeJob(detail);
  await store.addJob({scoutId:scout.id,itemId:'item-1',stage:'screen',payload:{}});
  const screenId=`${scout.id}:item-1:screen`;
  for(const status of ['pending','running','failed']) {
    await testEnv.DB.prepare('UPDATE jobs SET status=? WHERE id=?').bind(status,screenId).run();
    await store.advanceScoutJobs(scout.id);
    assert.equal(row('SELECT status FROM jobs WHERE id=?',detail.id).status,'done',`${status} screen keeps detail done`);
  }
  await testEnv.DB.prepare("DELETE FROM jobs WHERE id=?").bind(screenId).run();
  await store.updateScout(scout.id,{status:'paused'});
  await store.advanceScoutJobs(scout.id);
  assert.equal(row('SELECT status FROM jobs WHERE id=?',detail.id).status,'done','paused scout is not repaired until active');
});

console.log(`All ${checks.length} actual-store lifecycle checks passed. No provider or network calls made.`);
db.sqlite.close();
db=undefined;
export { D1Adapter, testEnv, store, reset, row, newScout, listing };
