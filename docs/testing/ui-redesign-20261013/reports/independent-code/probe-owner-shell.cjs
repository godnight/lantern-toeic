// Actual useStudy -> actual StudyApp -> actual WorkspaceShell projection.
// Private in-memory snapshots; no browser, learner storage or API writes.
const probeFs=require('node:fs'),probePath=require('node:path'),probeVm=require('node:vm');
const probeRoot=probePath.resolve(__dirname,'..','..','theme-redesign-20261012','site');
const hookSource=probeFs.readFileSync(probePath.join(probeRoot,'tests/ui-redesign-hook-contract.test.cjs'),'utf8');
const hookPrefix=hookSource.slice(0,hookSource.indexOf("test('new users"));
const actual=probeVm.runInNewContext(hookPrefix+'\n({model,hookHarness})',{require,process,__dirname:probePath.join(probeRoot,'tests'),structuredClone,Blob,URL,AbortController});
const alice=structuredClone(actual.model.EMPTY_DATA);alice.profile={...alice.profile,name:'PRIVATE Alice Owner A',theme:'silk'};
alice.attempts=[{id:'private-owner-attempt',qid:'owner-wrong-question',choice:0,correct:false,createdAt:'2026-10-12T00:00:00.000Z',seconds:12,mode:'first'}];
const storage=new Map([['lantern-v1-alice',JSON.stringify({data:alice})],['lantern-v1-bob:required-schema',JSON.stringify({schemaVersion:999})]]);
const h=actual.hookHarness(storage);h.render('alice');const before=h.render('alice');
const switching=h.render('bob');const failed=h.render('bob');
let rootPrefix=probeFs.readFileSync(probePath.join(__dirname,'probe-search-origin.cjs'),'utf8');
rootPrefix=rootPrefix.slice(0,rootPrefix.indexOf("render();assert.equal(window.history.scrollRestoration"));
rootPrefix=rootPrefix.replace("const imports={react:hooks", "let fixtureApi=__ownerFixture.switching;\nconst imports={react:hooks");
rootPrefix=rootPrefix.replace("useStudy:()=>({data,ready:true,recordsReadable:true,sync:'local',issues:[],syncNow(){},retryIssue(){},saveProfile(){},saveTheme(){},addAttempt(){},addCheckin(){},addRecording(){},recordingUrl(){}})","useStudy:()=>fixtureApi");
rootPrefix=rootPrefix.replace("UI_THEME_META:{paper:{name:'日间'}}","UI_THEME_META:{paper:{name:'日间'},crystal:{name:'夜间'},hollow:{name:'空洞骑士'},silk:{name:'丝之歌'}}");
const cases=`
const realShell=load('app/learn/workspace-shell.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':proxy,'./ui-theme':{ThemeMotif:'ThemeMotif'}}).WorkspaceShell;
function project(api){fixtureApi=api;cursor=0;effects=[];tree=app({owner:'bob',nativeMode:false});const props=shell().props;const output=realShell(props);const text=nodes(output).flatMap(n=>Array.isArray(n.props?.children)?n.props.children:[n.props?.children]).filter(x=>typeof x==='string'||typeof x==='number');return {ready:api.ready,recordsReadable:api.recordsReadable,sync:api.sync,snapshotName:api.data.profile.name,shellName:props.name,reviewCount:props.reviewCount,theme:props.theme,visiblePrivateName:text.includes('PRIVATE Alice Owner A')};}
const results={readable:project(__ownerFixture.before),switching:project(__ownerFixture.switching),failed:project(__ownerFixture.failed),loading:project({...__ownerFixture.switching,ready:false,recordsReadable:false})};
assert.equal(__ownerFixture.before.recordsReadable,true);assert.equal(__ownerFixture.switching.recordsReadable,false);assert.equal(__ownerFixture.failed.recordsReadable,false);
assert.equal(__ownerFixture.failed.data.attempts.length,0);assert.equal(__ownerFixture.writes.length,0);
assert.equal(results.readable.shellName,'PRIVATE Alice Owner A');assert.equal(results.readable.reviewCount,1);assert.equal(results.readable.theme,'silk');
for(const phase of ['switching','failed','loading']){assert.equal(results[phase].visiblePrivateName,false,phase+' must not project the previous owner name');assert.notEqual(results[phase].shellName,'PRIVATE Alice Owner A');assert.equal(results[phase].reviewCount,0,phase+' must not project the previous review count');assert.equal(results[phase].theme,'paper',phase+' must not project the previous owner theme');}
const report={timestamp:new Date().toISOString(),observedFiles,result:'passed',results,limits:'Actual hook with future-schema Bob failure and actual Root/Shell pre-effect projections; no real ReactDOM paint or learner storage. Loading case is an explicit blocked projection; first switched render is produced by actual hook. No review badge is rendered for blocked projection; zero is a withheld prop, not proof of zero stored records.'};
fs.writeFileSync(path.join(__dirname,'probe-owner-shell-result.json'),JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify(report,null,2));
`;
probeVm.runInNewContext(rootPrefix+cases,{require,process,__dirname,structuredClone,Blob,URL,URLSearchParams,console,__ownerFixture:{before,switching,failed,writes:h.writes}});
h.unmount();
