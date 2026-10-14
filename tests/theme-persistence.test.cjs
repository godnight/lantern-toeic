'use strict';
// Tests the repository's real modules with synthetic records, never user storage.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const root = process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname, '..');
const fromRepo = createRequire(path.join(root, 'package.json'));
const ts = fromRepo('typescript');

function load(file, imports = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (!(name in imports)) throw Error('Unexpected import: ' + name);
      return imports[name];
    },
    Date, Intl, Map, Set, structuredClone, Request, Response, Headers,
    crypto: {randomUUID},
  }, {filename: file});
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const model = load('lib/study-model.ts');
const backup = load('lib/study-backup.ts', {'./study-model': model, zod: fromRepo('zod')});
const themes = ['hollow', 'silk', 'paper', 'crystal'];
const stamp = '2026-01-01T10:00:00.000Z';
const later = '2026-01-02T10:00:00.000Z';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const recordKeys = ['attempts', 'checkins', 'recordings', 'questionMarks', 'resourceTasks'];

function populated(theme) {
  const data = plain(model.EMPTY_DATA);
  data.profile = {...data.profile, name: 'Synthetic theme QA', theme, onboarded: true};
  data.attempts = [
    {id: uuid(1), qid: 'p1-01', choice: 1, correct: false, createdAt: stamp, seconds: 12, mode: 'first'},
    {id: uuid(2), qid: 'p1-01', choice: 0, correct: true, createdAt: later, seconds: 8, mode: 'review'},
  ];
  data.checkins = [{id: uuid(3), date: '2026-01-01', minutes: 5, load: '轻', note: '[资源:synthetic-theme-qa] keep note', createdAt: stamp}];
  data.recordings = [{id: uuid(4), promptId: 'speaking-1', title: 'Synthetic recording metadata', createdAt: stamp, duration: 7, mime: 'audio/webm', uploaded: true, note: 'keep practice time'}];
  data.questionMarks = [{qid: 'p1-01', flagged: true, reason: 'listening', note: 'keep mistake reason', revision: 2, mutationId: uuid(5), updatedAt: later}];
  data.resourceTasks = [{id: uuid(6), resourceId: 'synthetic-theme-qa', plannedDate: '2026-01-01', status: 'completed', minutes: 5, checkinId: uuid(3), revision: 2, mutationId: uuid(7), updatedAt: later}];
  return data;
}

function assertRecords(actual, expected) {
  for (const key of recordKeys) assert.deepEqual(plain(actual[key]), expected[key], key + ' must not change');
}

test('new profiles default to day while existing theme IDs and schema stay compatible', () => {
  assert.equal(model.DEFAULT_PROFILE.theme, 'paper');
  assert.equal(model.DATA_SCHEMA_VERSION, 2);
});

for (const theme of themes) {
  test(`backup round trip preserves ${theme} and every saved study record`, () => {
    const original = populated(theme);
    const before = JSON.stringify(original);
    const exported = backup.createStudyBackup(original, later);
    assert.equal(exported.schemaVersion, 2);
    assert.equal(exported.audioIncluded, false);
    const decoded = backup.parseStudyBackup(JSON.stringify(exported));
    assert.deepEqual(plain(decoded.profile), original.profile);
    assertRecords(decoded, original);
    // Restoration over this installation keeps its confirmed recording metadata.
    const restored = backup.restoreStudyBackup(original, exported, true);
    assert.deepEqual(plain(restored), original);
    assert.deepEqual(plain(backup.restoreStudyBackup(restored, exported, true)), original);
    assert.equal(JSON.stringify(original), before, 'export/parse/restore must not mutate the source');
  });
}

for (const theme of themes.slice(0, 3)) {
  test(`legacy v1 ${theme} retains its stored theme ID and existing records`, () => {
    const old = populated(theme);
    delete old.schemaVersion;
    delete old.questionMarks;
    delete old.resourceTasks;
    const before = JSON.stringify(old);
    const upgraded = backup.parseStudyBackup(old);
    assert.equal(upgraded.schemaVersion, 2);
    assert.deepEqual(plain(upgraded.profile), old.profile);
    for (const key of ['attempts', 'checkins', 'recordings']) assert.deepEqual(plain(upgraded[key]), old[key]);
    assert.deepEqual(plain(upgraded.questionMarks), []);
    assert.deepEqual(plain(upgraded.resourceTasks), []);
    assert.equal(JSON.stringify(old), before, 'legacy input is read without mutation');
  });
}

test('switching only the theme through each choice preserves first/review history and all records', () => {
  let current = populated('hollow');
  const original = plain(current);
  for (const theme of ['silk', 'paper', 'crystal', 'hollow']) {
    current = model.mergeData(current, {...current, profile: {...current.profile, theme}});
    assert.equal(current.profile.theme, theme);
    assert.deepEqual({...plain(current.profile), theme: original.profile.theme}, original.profile);
    assertRecords(current, original);
    assert.equal(model.firstAttempts(current.attempts)[0].id, original.attempts[0].id);
  }
});

test('record-only restore keeps the current theme; explicit profile restore opts into the imported theme', () => {
  const current = populated('paper');
  const incoming = backup.createStudyBackup(populated('crystal'), later);
  assert.equal(backup.restoreStudyBackup(current, incoming).profile.theme, 'paper');
  const restored = backup.restoreStudyBackup(current, incoming, true);
  assert.equal(restored.profile.theme, 'crystal');
  assertRecords(restored, current);
  assert.equal(restored.recordings[0].uploaded, true);
});

test('unknown or malformed themes fail backup parsing and leave existing records intact', () => {
  const current = populated('silk');
  const before = JSON.stringify(current);
  for (const theme of ['invented-theme', 'blue-lake', 'crystal-peak', '', null, 42, {}, undefined]) {
    const incoming = populated('hollow');
    incoming.profile.theme = theme;
    assert.throws(() => backup.parseStudyBackup(incoming));
    assert.throws(() => backup.restoreStudyBackup(current, incoming, true));
    assert.equal(JSON.stringify(current), before);
  }
});

test('profile API persists the four theme IDs, rejects arbitrary themes and does not touch study records', async () => {
  const orm = fromRepo('drizzle-orm');
  const {drizzle} = fromRepo('drizzle-orm/sqlite-proxy');
  const schema = load('db/schema.ts', {'drizzle-orm/sqlite-core': fromRepo('drizzle-orm/sqlite-core')});
  const statements = load('db/mutable-study.ts', {'drizzle-orm': orm, './schema': schema, '../lib/study-model': model});
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of fs.readdirSync(path.join(root, 'drizzle')).filter(file => file.endsWith('.sql')).sort()) {
      sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', file), 'utf8'));
    }
    const db = drizzle(async (query, params, method) => {
      const prepared = sqlite.prepare(query);
      if (method === 'run') {prepared.run(...params); return {rows: []};}
      const rows = prepared.all(...params).map(row => Object.values(row));
      return {rows: method === 'get' ? rows[0] : rows};
    });
    const api = load('app/api/study/route.ts', {
      'drizzle-orm': orm, zod: fromRepo('zod'), '@/db': {getDb: () => db}, '@/db/schema': schema,
      '@/db/mutable-study': statements, '@/lib/study-model': model,
      '@/lib/server-auth': {
        userId: async () => 'theme-qa-alice',
        safeMutation: request => request.headers.get('origin') === 'https://test.local',
        privateJson: (body, status = 200) => Response.json(body, {status}),
      },
      '@/content/questions.json': {default: JSON.parse(fs.readFileSync(path.join(root, 'content/questions.json'), 'utf8'))},
      '@/content/resources-v2': load('content/resources-v2.ts'),
      '@/content/exams/catalogue.json': {default: JSON.parse(fs.readFileSync(path.join(root, 'content/exams/catalogue.json'), 'utf8'))},
    });
    const otherProfile = JSON.stringify(populated('paper').profile);
    sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run('theme-qa-bob', otherProfile, stamp);
    const saved = populated('hollow');
    for (const attempt of saved.attempts) sqlite.prepare('INSERT INTO attempts(id,user_id,qid,choice,correct,created_at,seconds,mode) VALUES(?,?,?,?,?,?,?,?)').run(attempt.id, 'theme-qa-alice', attempt.qid, attempt.choice, Number(attempt.correct), attempt.createdAt, attempt.seconds, attempt.mode);
    sqlite.prepare('INSERT INTO checkins(id,user_id,body,created_at) VALUES(?,?,?,?)').run(uuid(3), 'theme-qa-alice', JSON.stringify(saved.checkins[0]), stamp);
    sqlite.prepare('INSERT INTO recordings(id,user_id,object_key,body,created_at) VALUES(?,?,?,?,?)').run(uuid(4), 'theme-qa-alice', 'synthetic-never-fetched', JSON.stringify(saved.recordings[0]), stamp);
    const records = () => JSON.stringify(Object.fromEntries(['attempts', 'checkins', 'recordings'].map(table => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])));
    const beforeRecords = records();
    const post = theme => api.POST(new Request('https://test.local/api/study', {
      method: 'POST', headers: {origin: 'https://test.local', 'Content-Type': 'application/json', 'X-Lantern-Owner': 'theme-qa-alice'},
      body: JSON.stringify({type: 'profile', data: {...saved.profile, theme}}),
    }));
    for (const theme of themes) {
      assert.equal((await post(theme)).status, 200, theme + ' must sync');
      assert.equal(JSON.parse(sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get('theme-qa-alice').body).theme, theme);
      assert.equal((await (await api.GET()).json()).profile.theme, theme);
      assert.equal(records(), beforeRecords);
      assert.equal(sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get('theme-qa-bob').body, otherProfile);
    }
    const beforeProfile = sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get('theme-qa-alice').body;
    for (const theme of ['invented-theme', 'blue-lake', 'crystal-peak', '', null, 42]) {
      assert.equal((await post(theme)).status, 400);
      assert.equal(sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get('theme-qa-alice').body, beforeProfile);
      assert.equal(records(), beforeRecords);
    }
  } finally {sqlite.close();}
});

// Append to tests/theme-persistence.test.cjs; reuses load(), model and fromRepo.
test('theme-only API atomically preserves existing settings, isolates users and rejects extra fields',async()=>{
 const orm=fromRepo('drizzle-orm');const {drizzle}=fromRepo('drizzle-orm/sqlite-proxy');
 const schema=load('db/schema.ts',{'drizzle-orm/sqlite-core':fromRepo('drizzle-orm/sqlite-core')});
 const statements=load('db/mutable-study.ts',{'drizzle-orm':orm,'./schema':schema,'../lib/study-model':model});
 const sqlite=new DatabaseSync(':memory:');let owner='alice';
 try{
  for(const file of fs.readdirSync(path.join(root,'drizzle')).filter(x=>x.endsWith('.sql')).sort())sqlite.exec(fs.readFileSync(path.join(root,'drizzle',file),'utf8'));
  const db=drizzle(async(query,params,method)=>{const stmt=sqlite.prepare(query);if(method==='run'){stmt.run(...params);return {rows:[]};}const rows=stmt.all(...params).map(row=>Object.values(row));return {rows:method==='get'?rows[0]:rows};});
  const api=load('app/api/study/route.ts',{
   'drizzle-orm':orm,zod:fromRepo('zod'),'@/db':{getDb:()=>db},'@/db/schema':schema,'@/db/mutable-study':statements,'@/lib/study-model':model,
   '@/lib/server-auth':{userId:async()=>owner,safeMutation:r=>r.headers.get('origin')==='https://test.local',privateJson:(body,status=200)=>Response.json(body,{status})},
   '@/content/questions.json':{default:JSON.parse(fs.readFileSync(path.join(root,'content/questions.json'),'utf8'))},'@/content/resources-v2':load('content/resources-v2.ts'),
   '@/content/exams/catalogue.json':{default:JSON.parse(fs.readFileSync(path.join(root,'content/exams/catalogue.json'),'utf8'))}
  });
  const cloud={...plain(model.DEFAULT_PROFILE),name:'Cloud learner',dailyMinutes:45,lrGoal:800,unknownFutureField:{keep:true}};
  const bob=JSON.stringify({...cloud,name:'Bob',theme:'paper'});
  sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run('alice',JSON.stringify(cloud),stamp);
  sqlite.prepare('INSERT INTO profiles(user_id,body,updated_at) VALUES(?,?,?)').run('bob',bob,stamp);
  const post=(data,headerOwner=owner,type='theme')=>api.POST(new Request('https://test.local/api/study',{method:'POST',headers:{origin:'https://test.local','Content-Type':'application/json','X-Lantern-Owner':headerOwner},body:JSON.stringify({type,data})}));
  for(const theme of ['hollow','paper','silk','crystal']){
   assert.equal((await post({theme})).status,200);
   assert.deepEqual(JSON.parse(sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get('alice').body),{...cloud,theme});
   assert.equal(sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get('bob').body,bob);
  }
  const before=sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get('alice').body;
  for(const bad of [{theme:'invented'},{theme:'hollow',name:'overwrite'},{theme:'hollow',lrGoal:990},{}])assert.equal((await post(bad)).status,400);
  assert.equal((await post({theme:'silk'},'bob')).status,409);
  assert.equal(sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get('alice').body,before);
  owner='new-owner';assert.equal((await post({theme:'crystal'})).status,200);
  assert.deepEqual(JSON.parse(sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get(owner).body),{...plain(model.DEFAULT_PROFILE),theme:'crystal'});
  const legacy={...plain(model.DEFAULT_PROFILE),name:'Legacy full profile',theme:'paper'};
  assert.equal((await post(legacy,owner,'profile')).status,200);
  assert.deepEqual(JSON.parse(sqlite.prepare('SELECT body FROM profiles WHERE user_id=?').get(owner).body),legacy);
 }finally{sqlite.close();}
});
