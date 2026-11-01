'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createSourceLoader}=require('./helpers/actual-source-loader.cjs');
const root=path.resolve(__dirname,'..');
const loader=createSourceLoader({root}),domain=loader.load('lib/domain-command.ts');
const rows=()=>[{id:'catalog-fixture',prompt:'Authored text',options:['A','B','C','D'],answer:0,optional:undefined}];
const fullVersion=value=>'practice-v1:'+domain.canonicalHash(domain.canonicalJson(JSON.parse(JSON.stringify(value))));

test('sealed teaching catalogue retains the exact pinned full-content identity without repeated hashing',()=>{
 let hashes=0;
 const actual=createSourceLoader({root,imports:{'./domain-command':{...domain,canonicalHash:value=>{hashes++;return domain.canonicalHash(value);}}}}).load('lib/practice-catalog-identity.ts');
 const value=rows(),expected=fullVersion(value);
 actual.sealPracticeCatalog(value,expected);
 assert.equal(hashes,1);
 for(let i=0;i<20;i++)assert.equal(actual.practiceCatalogIdentity(value),expected);
 assert.equal(hashes,1,'repeated renders do not rehash the sealed catalogue');
 assert(Object.isFrozen(value)&&Object.isFrozen(value[0])&&Object.isFrozen(value[0].options));
 assert.throws(()=>{value[0].options[0]='Changed';},TypeError);
 assert.equal(actual.practiceCatalogIdentity(value),expected);
});

test('unsealed caller arrays still detect nested mutations even when the array itself is frozen',()=>{
 const actual=loader.load('lib/practice-catalog-identity.ts'),value=Object.freeze(rows());
 const before=actual.practiceCatalogIdentity(value);value[0].options[0]='Changed';
 assert.notEqual(actual.practiceCatalogIdentity(value),before);
 assert.equal(actual.practiceCatalogIdentity(value),fullVersion(value));
});

test('seal rejects a changed pinned snapshot instead of reusing its expected version',()=>{
 const actual=loader.load('lib/practice-catalog-identity.ts'),value=rows(),expected=fullVersion(value);
 value[0].prompt+=' changed';
 assert.throws(()=>actual.sealPracticeCatalog(value,expected),/snapshot-mismatch/);
 assert.notEqual(actual.practiceCatalogIdentity(value),expected);
});

test('accessor-backed teaching data cannot enter the sealed identity cache',()=>{
 const actual=loader.load('lib/practice-catalog-identity.ts'),value=rows();let reads=0;
 Object.defineProperty(value[0],'prompt',{enumerable:true,get(){reads++;return 'Mutable getter';}});
 assert.throws(()=>actual.sealPracticeCatalog(value,'untrusted'),/not-immutable-json/);
 assert.equal(reads,0,'sealing never executes a getter');
});
