const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {environment,migrate,syntheticLegacy,root,ORIGIN,sha}=require('./helpers/sites-legacy-readonly-harness.cjs');
const tables=['profiles','attempts','checkins','recordings','question_marks','resource_tasks','vocabulary_events','exam_library'];
const snapshot=e=>JSON.stringify(Object.fromEntries(tables.map(t=>[t,e.rows(t)])));
function ready(t){const e=environment();t.after(()=>e.close());migrate(e);return e;}
function signin(e,owner='sites-synthetic-A'){e.ambient({'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'synthetic@example.invalid'});}

test('official helper requires stable id and email; sign-in return paths remain same-origin',async t=>{
 const e=ready(t),auth=e.load('app/chatgpt-auth.ts');e.ambient({'oai-authenticated-user-email':'synthetic@example.invalid'});assert.equal(await auth.getChatGPTUser(),null);signin(e);assert.equal((await auth.getChatGPTUser()).userId,'sites-synthetic-A');
 e.ambient({});await assert.rejects(auth.requireChatGPTUser('/legacy'),x=>x.url==='/signin-with-chatgpt?return_to=%2Flegacy');
 for(const bad of ['https://outside.invalid','//outside.invalid','/signin-with-chatgpt','/callback'])assert.equal(auth.chatGPTSignInPath(bad),'/signin-with-chatgpt?return_to=%2F');
});
test('disabled, invalid origin and missing identity fail without reading data or trusting request owner/header',async t=>{
 const e=ready(t),route=e.load('app/api/legacy/study/route.ts');
 for(const config of [{LANTERN_SITES_LEGACY_READONLY_ENABLED:undefined},{LANTERN_SITES_LEGACY_READONLY_ENABLED:'false'},{LANTERN_SITES_LEGACY_ORIGIN:'http://legacy.synthetic.test'},{LANTERN_SITES_LEGACY_ORIGIN:ORIGIN+'/path'}]){const old={...e.env};Object.assign(e.env,config);signin(e);assert.equal((await route.GET(e.request('study'))).status,404);Object.assign(e.env,old);}
 signin(e);assert.equal((await route.GET(new Request('https://different.synthetic.test/api/legacy/study'))).status,404);
 e.ambient({});const before=e.queries.length;
 assert.equal((await route.GET(e.request('study','?owner=sites-synthetic-A',{'oai-authenticated-user-id':'sites-synthetic-A','oai-authenticated-user-email':'synthetic@example.invalid','x-lantern-owner':'sites-synthetic-A'}))).status,401);assert.equal(e.queries.length,before);
 signin(e,'usr_00000000-0000-4000-8000-000000000001');assert.equal((await route.GET(e.request('study'))).status,401);
});
test('two legacy partitions and product account remain distinct; all raw reads and exports preserve facts',async t=>{
 const e=ready(t);const a=syntheticLegacy(e),b=syntheticLegacy(e,'sites-synthetic-B',1),p=syntheticLegacy(e,'usr_00000000-0000-4000-8000-000000000001',1);const before=snapshot(e),beforeObjects=[...e.objects.keys()];signin(e,a);
 const route=e.load('app/api/legacy/study/route.ts'),res=await route.GET(e.request('study','?owner='+b));assert.equal(res.status,200);assert.equal((await res.json()).counts.exam_library,12);
 const page=await (await route.GET(e.request('study','?table=attempts&owner='+b))).json();assert.equal(page.rows.length,3);assert(page.rows.every(r=>r.user_id===a));
 assert.equal((await route.GET(e.request('study','?table=profiles%3BDROP%20TABLE%20attempts'))).status,400);
 const exp=await e.load('app/api/legacy/export/route.ts').GET(e.request('export'));assert.match(exp.headers.get('cache-control'),/no-store/);assert.match(exp.headers.get('content-disposition'),/attachment/);
 const lines=(await exp.text()).trim().split('\n').map(JSON.parse);assert.equal(lines[0].owner,a);assert.equal(lines.at(-1).complete,true);const rowlines=lines.filter(r=>r.type==='row');assert.equal(rowlines.length,16);assert(rowlines.every(x=>x.row.user_id===a));
 const keys=e.load('lib/sites-legacy-readonly.ts').LEGACY_TABLES;
 for(const table of tables){const key=keys[table],expected=e.rows(table).filter(r=>r.user_id===a).sort((x,y)=>String(x[key])<String(y[key])?-1:String(x[key])>String(y[key])?1:0);assert.deepEqual(rowlines.filter(x=>x.table===table).map(x=>x.row),expected);}
 signin(e,b);assert.equal((await (await route.GET(e.request('study'))).json()).counts.exam_library,1);signin(e,p);assert.equal((await route.GET(e.request('study'))).status,401);
 assert.equal(snapshot(e),before);assert.deepEqual([...e.objects.keys()],beforeObjects);assert.equal(e.storage.puts,0);assert.equal(e.storage.deletes,0);
});
test('export walks bounded real SQL pages without dropping old rows or accepting an incomplete stream',async t=>{
 const e=ready(t),owner=syntheticLegacy(e,'sites-synthetic-pages',0);for(let i=0;i<205;i++)e.sqlite.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)').run('page-'+String(i).padStart(4,'0'),owner,'old-qid',2,0,'2026-01-01',4,'review');signin(e,owner);const before=snapshot(e);
 const route=e.load('app/api/legacy/study/route.ts'),first=await (await route.GET(e.request('study','?table=attempts'))).json();assert.equal(first.rows.length,100);assert(first.nextCursor);
 const second=await (await route.GET(e.request('study','?table=attempts&after='+encodeURIComponent(first.nextCursor)))).json();assert.equal(second.rows.length,100);const last=await (await route.GET(e.request('study','?table=attempts&after='+encodeURIComponent(second.nextCursor)))).json();assert.equal(last.rows.length,8);assert.equal(last.nextCursor,null);
 const response=await e.load('app/api/legacy/export/route.ts').GET(e.request('export'));const lines=(await response.text()).trim().split('\n').map(JSON.parse);assert.equal(lines.at(-1).counts.attempts,208);assert.equal(new Set(lines.filter(x=>x.table==='attempts').map(x=>x.row.id)).size,208);assert.equal(snapshot(e),before);
 const core=e.load('lib/sites-legacy-readonly.ts');const broken=core.legacyExportResponse({prepare(){throw Error('synthetic read failure');}},owner);await assert.rejects(broken.text());
});
test('all twelve original R2 references download only through owned D1 records and preserve bytes',async t=>{
 const e=ready(t),a=syntheticLegacy(e),b=syntheticLegacy(e,'sites-synthetic-B',1),rows=e.rows('exam_library').filter(r=>r.user_id===a),before=snapshot(e);signin(e,a);const route=e.load('app/api/legacy/exam-library/route.ts');
 const list=await (await route.GET(e.request('exam-library'))).json();assert.equal(list.rows.length,12);
 for(const row of rows){const res=await route.GET(e.request('exam-library','?id='+row.id+'&object_key=forged&owner='+b));assert.equal(res.status,200);assert.equal(res.headers.get('x-exam-sha256'),row.sha256);assert.equal(sha(Buffer.from(await res.arrayBuffer())),row.sha256);}
 signin(e,b);const gets=e.storage.gets;assert.equal((await route.GET(e.request('exam-library','?id='+rows[0].id))).status,404);assert.equal(e.storage.gets,gets);
 signin(e,a);e.objects.delete(rows[0].object_key);assert.equal((await route.GET(e.request('exam-library','?id='+rows[0].id))).status,503);e.storage.fail=true;assert.equal((await route.GET(e.request('exam-library','?id='+rows[1].id))).status,503);
 assert.equal(snapshot(e),before);assert.equal(e.storage.puts,0);assert.equal(e.storage.deletes,0);
 for(const kind of ['study','export','exam-library','recordings']){const api=e.load('app/api/legacy/'+kind+'/route.ts');for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(api[method],undefined);}
});
test('recording object read is owner-bound and failure never removes original metadata',async t=>{
 const e=ready(t),owner=syntheticLegacy(e,'sites-synthetic-recording',0),id='00000000-0000-4000-8000-000000000099',key='synthetic-original-audio';e.sqlite.prepare('INSERT INTO recordings VALUES(?,?,?,?,?)').run(id,owner,key,'{"title":"Synthetic audio"}','2026-01-01');e.objects.set(key,{bytes:Buffer.from('synthetic recording'),httpMetadata:{contentType:'audio/webm'}});const before=snapshot(e),route=e.load('app/api/legacy/recordings/route.ts');signin(e,owner);assert.equal(await (await route.GET(e.request('recordings','?id='+id))).text(),'synthetic recording');signin(e,'sites-synthetic-other');const reads=e.storage.gets;assert.equal((await route.GET(e.request('recordings','?id='+id))).status,404);assert.equal(e.storage.gets,reads);signin(e,owner);e.storage.fail=true;assert.equal((await route.GET(e.request('recordings','?id='+id))).status,503);assert.equal(snapshot(e),before);assert.equal(e.storage.puts,0);assert.equal(e.storage.deletes,0);
});
test('actual current product APIs never fall back to Sites identity, even with invalid product session',async t=>{
 const e=ready(t);signin(e);const server=e.load('lib/server-auth.ts');
 for(const cookie of ['', '__Host-lantern-session='+'0'.repeat(64)]){const headers={'cookie':cookie,'oai-authenticated-user-id':'sites-synthetic-A','oai-authenticated-user-email':'synthetic@example.invalid'};assert.equal(await server.userId(new Request(ORIGIN+'/api/study',{headers})),null);for(const route of ['study','vocabulary','exam-library','recordings'])assert.equal((await e.load('app/api/'+route+'/route.ts').GET(new Request(ORIGIN+'/api/'+route,{headers}))).status,401);}
 const id='usr_00000000-0000-4000-8000-000000000001',token='1'.repeat(64);e.sqlite.prepare('INSERT INTO auth_users VALUES(?,?,?)').run(id,'synthetic_user',1);e.sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha(token),id,1,Date.now()+100000);const request=new Request(ORIGIN+'/api/study',{headers:{cookie:'__Host-lantern-session='+token}});assert.equal(await server.userId(request),id);assert.equal((await e.load('app/api/legacy/study/route.ts').GET(e.request('study'))).status,200);assert.equal(e.rows('auth_users').length,1);
});
test('migration is schema-only, original rows remain intact and required journal stages are complete',t=>{
 const e=environment();t.after(()=>e.close());syntheticLegacy(e);const before=snapshot(e);migrate(e);assert.equal(snapshot(e),before);assert.equal(e.rows('study_sync_clock').length,0);
 const sql=fs.readFileSync(path.join(root,'drizzle/0004_study_sync_index.sql'),'utf8');for(const stmt of sql.split('--> statement-breakpoint'))assert.match(stmt.replace(/^\s*--.*$/gm,'').trim(),/^CREATE /);
 const journal=JSON.parse(fs.readFileSync(path.join(root,'drizzle/meta/_journal.json'),'utf8'));const tags=['0000_spotty_stellaris','0001_study_data_v2','0002_parched_edwin_jarvis','0003_cynical_snowbird','0004_study_sync_index','0005_product_auth','0006_auth_admission_ticket','0007_phone_auth','0008_phone_challenges'];assert.deepEqual(journal.entries.slice(0,9).map(x=>x.tag),tags);for(let i=0;i<9;i++){assert.equal(journal.entries[i].idx,i);assert(fs.existsSync(path.join(root,'drizzle',tags[i]+'.sql')));}
});
test('official generated auth metadata chains all four missing stages without changing old tables',t=>{
 const e=environment();t.after(()=>e.close());e.sqlite.exec(fs.readFileSync(path.join(root,'drizzle/0004_study_sync_index.sql'),'utf8'));let prev=JSON.parse(fs.readFileSync(path.join(root,'drizzle/meta/0004_snapshot.json'),'utf8'));const oldTables=prev.tables;
 const files=['0005_product_auth.sql','0006_auth_admission_ticket.sql','0007_phone_auth.sql','0008_phone_challenges.sql'];
 for(let i=0;i<files.length;i++){
  e.sqlite.exec(fs.readFileSync(path.join(root,'drizzle',files[i]),'utf8'));const meta=JSON.parse(fs.readFileSync(path.join(root,`drizzle/meta/000${i+5}_snapshot.json`),'utf8'));assert.equal(meta.prevId,prev.id);
  for(const [name,table] of Object.entries(oldTables))assert.deepEqual(meta.tables[name],table);
  for(const [name,table] of Object.entries(meta.tables)){const columns=e.sqlite.prepare('PRAGMA table_info('+name+')').all();assert.deepEqual(columns.map(x=>x.name).sort(),Object.keys(table.columns).sort());for(const col of columns){assert.equal(col.type.toLowerCase(),table.columns[col.name].type.toLowerCase());assert.equal(Boolean(col.notnull),table.columns[col.name].notNull);}}
  assert.equal('admission_id' in meta.tables.auth_rate_limits.columns,i>=1);assert.equal('auth_phone_proofs' in meta.tables,i>=2);assert.equal('auth_phone_challenges' in meta.tables,i>=3);prev=meta;
 }
 for(let i=0;i<5;i++)assert(fs.existsSync(path.join(root,`drizzle/meta/000${i}_snapshot.json`)),'Original snapshots remain present');
});
test('bounded idempotent init preserves facts, gap writes, concurrent revision/tombstones and readiness',async t=>{
 const e=environment();t.after(()=>e.close());const owner=syntheticLegacy(e,'sites-synthetic-init',0);for(let i=0;i<121;i++)e.sqlite.prepare('INSERT INTO checkins VALUES(?,?,?,?)').run('check-'+String(i).padStart(4,'0'),owner,'{"note":"original"}','2026-01-01');migrate(e);
 e.sqlite.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?)').run('before-clock',owner,'old-qid',1,1,'2026-01-01',7,'first');e.sqlite.prepare('DELETE FROM attempts WHERE id=?').run(owner+'-attempt-0');assert.equal(e.rows('study_sync_clock').length,0);assert(e.rows('study_sync_index').every(r=>r.revision===1));
 const init=e.load('db/initialize-study-sync.ts').initializeStudySyncBatch;for(const invalid of [0,101,1.5,NaN])await assert.rejects(init(e.d1,invalid));
 e.fault(3);await assert.rejects(init(e.d1,3));assert.equal(e.rows('study_sync_clock').length,0);e.fault(-1);
 let r=await init(e.d1,3);assert.equal(r.ready,false);assert(r.inserted<=18);assert.equal(e.sqlite.prepare('SELECT * FROM study_sync_clock WHERE ready=1').get(),undefined);
 await assert.rejects(e.load('db/study-sync.ts').readStudySyncPage(e.load('db/index.ts').getDb(),owner,new URL(ORIGIN+'/api/study?sync=1')),error=>error.status===503);
 e.sqlite.prepare('UPDATE attempts SET seconds=22 WHERE id=?').run('before-clock');e.sqlite.prepare('DELETE FROM checkins WHERE id=?').run('check-0120');e.sqlite.prepare('INSERT INTO checkins VALUES(?,?,?,?)').run('concurrent-new',owner,'{"note":"concurrent"}','2026-01-02');const facts=snapshot(e);
 let rounds=1;while(!r.ready&&rounds<60){r=await init(e.d1,3);rounds++;assert(r.inserted<=18);}assert(r.ready);assert(rounds>2);assert.equal(snapshot(e),facts);
 assert.equal(e.sqlite.prepare('SELECT deleted FROM study_sync_index WHERE user_id=? AND kind=? AND entity_id=?').get(owner,'attempt',owner+'-attempt-0').deleted,1);assert.equal(e.sqlite.prepare('SELECT deleted FROM study_sync_index WHERE user_id=? AND kind=? AND entity_id=?').get(owner,'checkin','check-0120').deleted,1);
 const indices=JSON.stringify(e.rows('study_sync_index')),clock=JSON.stringify(e.rows('study_sync_clock'));const again=await init(e.d1,100);assert.equal(again.inserted,0);assert(again.ready);assert.equal(JSON.stringify(e.rows('study_sync_index')),indices);assert.equal(JSON.stringify(e.rows('study_sync_clock')),clock);assert.equal(snapshot(e),facts);
});
test('Home computes legacy availability only from real server deployment configuration',async t=>{
 const e=ready(t),jsx=(type,props)=>({type,props});
 const page=e.pageLoader({'./study-app':{__esModule:true,default:'StudyApp'},'react/jsx-runtime':{jsx,jsxs:jsx}}).load('app/page.tsx');
 assert.equal((await page.default()).props.legacyAvailable,true);
 e.env.LANTERN_SITES_LEGACY_READONLY_ENABLED='false';assert.equal((await page.default()).props.legacyAvailable,false);
 e.env.LANTERN_SITES_LEGACY_READONLY_ENABLED='true';e.env.LANTERN_SITES_LEGACY_ORIGIN=ORIGIN+'/path';assert.equal((await page.default()).props.legacyAvailable,false);
});
test('standalone Account page exposes an ordinary legacy anchor only behind the real server gate',async t=>{
 const e=ready(t),jsx=(type,props)=>({type,props}),page=e.pageLoader({'./account-form':{__esModule:true,default:'AccountForm'},'react/jsx-runtime':{jsx,jsxs:jsx}}).load('app/account/page.tsx');
 const anchors=tree=>{const out=[];function walk(x){if(!x||typeof x!=='object')return;if(Array.isArray(x)){x.forEach(walk);return;}if(x.type==='a'&&x.props?.href==='/legacy')out.push(x);walk(x.props?.children);}walk(tree);return out;};
 const props={searchParams:Promise.resolve({})};const open=anchors(await page.default(props));assert.equal(open.length,1);assert.equal(open[0].props.onClick,undefined);
 e.env.LANTERN_SITES_LEGACY_READONLY_ENABLED='false';assert.equal(anchors(await page.default(props)).length,0);
});
test('workspace source passes the flag with false defaults and hides every legacy anchor in native mode',()=>{
 // Static integration contract; this does not claim browser rendering coverage.
 const ts=require(require.resolve('typescript',{paths:[root]}));const file=ts.createSourceFile('study-app.tsx',fs.readFileSync(path.join(root,'app/study-app.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const functions=[],anchors=[],passes=[];
 function visit(n){if(ts.isFunctionDeclaration(n)&&['StudyApp','StudyWorkspace'].includes(n.name?.text))functions.push(n);if(ts.isJsxElement(n)&&n.openingElement.tagName.getText(file)==='a'&&n.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.text==='href'&&a.initializer?.text==='/legacy'))anchors.push(n);if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(file)==='StudyWorkspace')passes.push(n);ts.forEachChild(n,visit);}visit(file);
 assert.equal(functions.length,2);for(const fn of functions){const binding=fn.parameters[0].name.elements.find(e=>e.name.getText(file)==='legacyAvailable');assert.equal(binding.initializer.kind,ts.SyntaxKind.FalseKeyword);}
 assert.equal(passes.length,1);assert(passes[0].attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.text==='legacyAvailable'&&a.initializer.expression.getText(file)==='legacyAvailable'));
 assert(anchors.length>0);for(const anchor of anchors){assert(!anchor.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.text==='onClick'));let n=anchor.parent,guarded=false;while(n){if(ts.isJsxExpression(n)&&n.expression&&ts.isBinaryExpression(n.expression)){const left=n.expression.left;if(n.expression.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&ts.isBinaryExpression(left)&&left.operatorToken.kind===ts.SyntaxKind.AmpersandAmpersandToken&&ts.isPrefixUnaryExpression(left.left)&&left.left.operator===ts.SyntaxKind.ExclamationToken&&left.left.operand.getText(file)==='nativeMode'&&left.right.getText(file)==='legacyAvailable')guarded=true;}n=n.parent;}assert(guarded,'Every legacy anchor requires !nativeMode && legacyAvailable');}
});
