import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {api} from './worker/api.mjs';
const db=new DatabaseSync(':memory:');db.exec(readFileSync('./drizzle/0000_rooms.sql','utf8'));
const env={DB:{prepare(sql){return {async first(){return db.prepare(sql).get()??null;},bind(...args){return {async first(){return db.prepare(sql).get(...args)??null;},async run(){return {meta:db.prepare(sql).run(...args)};}};}}}}};
let n=0;async function req(path,data,headers={}){const r=await api(new Request('https://ludo.test'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)}),env);return {status:r.status,body:await r.json()};}
async function test(name,f){await f();n++;console.log('PASS',name);}
const tokens=['a','b','c','d','e'].map(c=>c.repeat(64));const action=()=>crypto.randomUUID().replaceAll('-','');let code;
await test('creation redacts secret and snapshot public state',async()=>{const r=await req('/api/create',{token:tokens[0],count:2});assert.equal(r.status,200);code=r.body.code;assert.equal(r.body.seat,0);assert.equal(r.body.ready,false);assert.equal(JSON.stringify(r.body).includes(tokens[0]),false);assert.equal(r.body.state.players.length,2);});
await test('host create retry is idempotent',async()=>{const r=await req('/api/create',{token:tokens[0],count:4});assert.equal(r.body.code,code);assert.equal(r.body.state.players.length,2);assert.equal(db.prepare('select count(*) as n from rooms').get().n,1);});
await test('roll prohibited before all seats filled',async()=>{const r=await req('/api/action/'+code,{token:tokens[0],version:0,actionId:action(),kind:'roll'});assert.equal(r.status,409);});
await test('unauthenticated state cannot be read',async()=>{const r=await req('/api/state/'+code,{token:tokens[4]});assert.equal(r.status,403);assert.equal(r.body.errorCode,'seat_missing');});
await test('concurrent joins cannot overwrite seats',async()=>{const rs=await Promise.all([1,2].map(i=>req('/api/join/'+code,{token:tokens[i]})));assert.deepEqual(rs.map(x=>x.status).sort(),[200,409]);assert.equal(rs.find(x=>x.status===200).body.seat,1);});
await test('foreign origin cannot mutate room',async()=>{const r=await req('/api/action/'+code,{token:tokens[0],version:1,actionId:action(),kind:'roll'},{Origin:'https://evil.test'});assert.equal(r.status,403);});
await test('other seat cannot act on host turn',async()=>{const r=await req('/api/action/'+code,{token:tokens[1],version:1,actionId:action(),kind:'roll'});assert.equal(r.status,403);});
await test('concurrent rolls commit once and retry deduplicates',async()=>{const id=action(),input={token:tokens[0],version:1,actionId:id,kind:'roll',dice:6};const rs=await Promise.all([req('/api/action/'+code,input),req('/api/action/'+code,{...input,actionId:action()})]);assert.deepEqual(rs.map(x=>x.status).sort(),[200,409]);const row=db.prepare('select * from rooms where code=?').get(code);assert.equal(row.version,2);assert.equal(JSON.parse(row.data).state.rolls,1);const committed=JSON.parse(row.data).actions[0].id;const retry=await req('/api/action/'+code,{...input,actionId:committed});assert.equal(retry.status,200);assert.equal(retry.body.version,2);});
await test('stale version rejects before applying move or roll',async()=>{const r=await req('/api/action/'+code,{token:tokens[0],version:0,actionId:action(),kind:'roll'});assert.equal(r.status,409);assert.equal(r.body.version,2);assert.equal(r.body.state.rolls,1);});
await test('request body limit is enforced',async()=>{const r=await req('/api/state/'+code,{token:tokens[0],junk:'x'.repeat(5000)});assert.equal(r.status,400);});
await test('expired room rejects all continued play',async()=>{db.prepare('update rooms set expires=0 where code=?').run(code);const r=await req('/api/state/'+code,{token:tokens[0]});assert.equal(r.status,404);assert.equal(r.body.errorCode,'room_unavailable');});
await test('invalid-session status is machine-readable',async()=>{const r=await req('/api/state/'+code,{token:'invalid'});assert.equal(r.status,401);assert.equal(r.body.errorCode,'invalid_session');});
console.log(`${n} API review checks passed.`);
