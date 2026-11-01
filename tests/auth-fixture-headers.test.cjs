'use strict';
// Deterministic auth-to-business integration, not a deployed Worker or live D1/R2.
const test = require('node:test');
const assert = require('node:assert/strict');
const {environment, ORIGIN, COOKIE_NAME} = require('./helpers/sites-route-harness.cjs');
const tables = ['profiles','attempts','checkins','recordings','question_marks','resource_tasks','vocabulary_events','exam_library'];
const snapshot = e => ({rows:Object.fromEntries(tables.map(table=>[table,e.rows(table)])),
  objects:[...e.objects],puts:e.storage.puts,gets:e.storage.gets,deletes:e.storage.deletes});

test('legacy fixture obtains a real cookie and session, then reaches actual owned business storage', async t => {
  const e = environment(); t.after(()=>e.close());
  const alice = await e.register('fixture_alice'), bob = await e.register('fixture_bob');
  assert.match(alice.id,/^usr_[0-9a-f-]{36}$/i);
  assert(alice.cookie.startsWith(COOKIE_NAME+'='));
  assert.notEqual(alice.id,bob.id);assert.notEqual(alice.cookie,bob.cookie);
  const session = await e.call('session','GET',{cookie:alice.cookie});
  assert.equal(session.status,200);
  const confirmed = await session.json(); assert.equal(confirmed.user.id,alice.id);
  assert.equal(confirmed.capabilities.passwordLogin,true);
  assert.equal(e.rows('auth_users').length,2);assert.equal(e.rows('auth_sessions').length,2);
  assert(!JSON.stringify(e.rows('auth_sessions')).includes(alice.cookie.split('=')[1]),'Raw cookie must not be stored as a session key');
  // Spoofed request and ambient platform identities cannot replace a valid owner.
  e.setAmbientHeaders({'oai-authenticated-user-id':bob.id});
  const profile = {...e.load('lib/study-model.ts').DEFAULT_PROFILE,name:'real authenticated fixture',examDate:'2028-02-29'};
  const response = await e.call('study','POST',{cookie:alice.cookie,owner:alice.id,
    headers:{'oai-authenticated-user-id':bob.id},body:{type:'profile',data:profile}});
  assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  const rows = e.rows('profiles');assert.equal(rows.length,1);assert.equal(rows[0].user_id,alice.id);
  assert.deepEqual(JSON.parse(rows[0].body),profile);
  const get = await e.call('study','GET',{cookie:alice.cookie,headers:{'oai-authenticated-user-id':bob.id}});
  assert.equal(get.status,200);assert.equal((await get.json()).owner,alice.id);
});

test('forged platform identity never authenticates a request or reaches body/storage work', async t => {
  const e = environment(); t.after(()=>e.close());
  const alice = await e.register('forged_alice');
  e.setAmbientHeaders({'oai-authenticated-user-id':alice.id});
  const before = snapshot(e);
  for (const cookie of [undefined,'synthetic-platform=opaque-platform-fixture']) {
    for (const route of ['study','vocabulary','recordings']) await t.test(route+' POST '+(cookie?'fake cookie':'no cookie'),async()=>{
      let reads=0;
      const body = new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array([123]));controller.close();}},{highWaterMark:0});
      const headers = new Headers({origin:ORIGIN,'content-type':'application/json',
        'oai-authenticated-user-id':alice.id,'x-lantern-owner':alice.id});
      if(cookie)headers.set('cookie',cookie);
      const request = new Request(ORIGIN+'/api/'+route,{method:'POST',headers,body,duplex:'half'});
      const response = await e.routes[route].POST(request);
      assert.equal(response.status,401);assert.match(response.headers.get('cache-control'),/private/);
      assert.equal(reads,0,'Auth rejection must precede every request body read');
      assert.deepEqual(snapshot(e),before,'Forged identity changed business rows or R2 counters');
    });
  }
  for (const route of ['study','vocabulary','recordings','library']) await t.test(route+' GET forged header',async()=>{
    const response = await e.call(route,'GET',{owner:alice.id,headers:{'oai-authenticated-user-id':alice.id}});
    assert.equal(response.status,401);assert.deepEqual(snapshot(e),before);
  });
});
