import assert from 'node:assert/strict';
import { applyCityScope, needsCityRecheck, resolveLocation, scoutCenter, scoutCity, searchLocations, sourceCityMetadata } from './location';
import { applyFreshness } from './freshness';
import type { Listing, Scout, ScoutLocation } from './types';

const city: ScoutLocation = {id:'5392171',label:'San Jose, California',city:'San Jose',state:'California',countryCode:'US',latitude:37.33939,longitude:-121.89496};
const scout: Scout = {id:'s',query:'standing desk',neighborhood:'Mission District',radiusMiles:5,maxWidthIn:null,maxDepthIn:null,maxHeightIn:null,condition:'working',includeUnknowns:true,email:'demo@example.invalid',status:'active',createdAt:new Date().toISOString(),lastCheckAt:null,lastSuccessAt:null,nextCheckAt:null,lastError:null};
const item: Listing = {id:'i',scoutId:'s',url:'https://example.invalid/i',title:'Standing desk',description:'',price:0,city:'San Francisco, CA',photo:null,photos:[],firstSeenAt:new Date().toISOString(),sourceCreatedAt:new Date().toISOString(),decision:'strong_fit',reasons:['Matches your search for standing desk.'],unknowns:[],questions:[],evidence:[],dimensions:{widthIn:null,depthIn:null,heightIn:null},brand:null,model:null,conditionNote:null,visualNote:null,visualStatus:'not_requested',distanceMiles:36,userState:'new',resale:null};

assert.deepEqual(scoutCenter(scout),{lat:37.7749,lng:-122.4194});
assert.equal(scoutCity(scout)?.city,'San Francisco');
assert.deepEqual(scoutCenter({...scout,location:city,neighborhood:city.label}),{lat:37.33939,lng:-121.89496});
assert.equal(scoutCenter({...scout,neighborhood:'Unknown City'}),null,'unknown legacy names do not silently become SF');
assert.equal(applyCityScope(item,scout).decision,'strong_fit','same city matches even when legacy radius/distance disagree');
for (const [name,source] of [['Livermore','Livermore, CA'],['Napa','Napa, CA'],['Brisbane','Brisbane, CA']]) {
  const checked=applyCityScope({...item,city:source,decision:'rejected',reasons:['Approximate pickup location is 36 mi away, outside your 5 mi radius.']},scout);
  assert.equal(checked.cityCheck?.status,'mismatch'); assert.equal(checked.decision,'rejected');
  assert.match(checked.reasons[0],new RegExp(`listing is in ${name}`)); assert.ok(checked.reasons.every(reason=>!reason.includes('radius')));
}
const rechecked=applyCityScope({...item,decision:'rejected',reasons:['Approximate pickup location is 36 mi away, outside your 5 mi radius.']},scout);
assert.equal(rechecked.decision,'needs_checking','removing old radius cannot silently certify an unreviewed item');
assert.equal(rechecked.cityCheck?.status,'matches');
for(const reason of ['The listing is not free.','Working condition is required, but the seller describes a functional fault.','The item does not match the requested item type.']) {
  const checked=applyCityScope({...item,decision:'rejected',reasons:['Approximate pickup location is 36 mi away, outside your 5 mi radius.',reason]},scout);
  assert.equal(checked.decision,'rejected'); assert.ok(checked.reasons.includes(reason));
}
const unknown=applyCityScope({...item,city:'Near downtown',sourceCity:null},scout);
assert.equal(unknown.cityCheck?.status,'unconfirmed');assert.equal(unknown.decision,'needs_checking');
assert.equal(applyCityScope({...item,city:'Somewhere',sourceCity:'San Francisco'},scout).cityCheck?.status,'unconfirmed');
assert.equal(applyCityScope({...item,city:'San Francisco, CA',sourceCity:'San Francisco'},scout).cityCheck?.status,'matches','structured city recovers the explicit state from the source display location');
assert.equal(sourceCityMetadata({id:'raw',url:'https://example.invalid/raw',title:'Desk',location:{city:'San Francisco'},location_text:'San Francisco, CA'}).sourceState,'California');
assert.equal(applyCityScope({...item,city:'Springfield',sourceCity:'Springfield'},{...scout,location:{...city,city:'Springfield',state:'Illinois',label:'Springfield, Illinois'}}).cityCheck?.status,'unconfirmed','same name without a state never certifies the selected state');
assert.equal(applyCityScope({...item,city:'San Francisco, CA, United States'},scout).cityCheck?.status,'matches');
assert.equal(applyCityScope({...item,city:'San Francisco, CA 94110'},scout).cityCheck?.status,'matches');
assert.equal(applyCityScope({...item,city:'San Jose, CA',sourceCity:'San Jose',sourceState:'CA'},{...scout,location:city}).cityCheck?.status,'matches');
assert.equal(applyCityScope({...item,sourceCity:'San Jose',sourceState:'NM'},{...scout,location:city}).cityCheck?.status,'mismatch','same city name in another state is not a match');
const old=applyFreshness({...item,sourceCreatedAt:new Date(Date.now()-72*3_600_000).toISOString(),decision:'rejected',reasons:['Approximate pickup location is 36 mi away, outside your 5 mi radius.']},24);
const revised=applyFreshness(applyCityScope(old,scout),24);
assert.equal(revised.decision,'rejected');assert.equal(revised.freshness?.status,'older','city changes do not revive stale finds');
assert.equal(applyCityScope(applyCityScope(item,scout),scout).cityCheck?.status,'matches');
assert.ok(needsCityRecheck(applyCityScope(rechecked,scout)),'rescreen guard survives repeated overlays');

const originalFetch=globalThis.fetch;
let calls=0;
const place=(id:number,name:string,country='US',feature='PPL')=>({id,name,admin1:'California',country_code:country,feature_code:feature,latitude:37.3,longitude:-121.9});
globalThis.fetch=(async(input: RequestInfo | URL)=>{
  calls++; const url=new URL(String(input));
  assert.equal(url.hostname,'geocoding-api.open-meteo.com');
  if(url.pathname==='/v1/search') {
    assert.equal(url.searchParams.get('countryCode'),'US');
    return Response.json({results:[place(5392171,'San Jose'),place(1,'Toronto','CA'),place(2,'County','US','ADM2'),place(3,'Abandoned','US','PPLQ')]});
  }
  const id=Number(url.searchParams.get('id'));
  return Response.json(id===424242?place(id,'Resolved City'):id===424243?place(id,'Foreign','CA'):place(99,'Wrong id'));
}) as typeof fetch;
try {
  const matches=await searchLocations('San Jose');
  assert.equal(matches.length,1);assert.equal(matches[0].id,'5392171');
  assert.equal((await resolveLocation('5392171')).city,'San Jose');assert.equal(calls,1,'selected server search result is cached without trusting client coordinates');
  assert.equal((await resolveLocation('424242')).city,'Resolved City');
  await assert.rejects(resolveLocation('424243'),/supported U.S. city/);
  await assert.rejects(resolveLocation('https://evil.invalid'),/Choose a city/);
  await assert.rejects(resolveLocation('424244'),/supported U.S. city/);
  globalThis.fetch=async()=>{throw new Error('offline');};
  await assert.rejects(resolveLocation('424245'),/taking too long/);
} finally {globalThis.fetch=originalFetch;}
console.log('PASS U.S. city resolution, canonical coordinates, state aliases, city-only filtering, cached rejection migration and freshness preservation');
