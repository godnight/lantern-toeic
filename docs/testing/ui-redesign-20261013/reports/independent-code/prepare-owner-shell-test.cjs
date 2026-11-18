// Assemble a standalone Node test for Root integration. Only staging is written.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..','..','theme-redesign-20261012','site');
let source=fs.readFileSync(path.join(root,'tests/ui-redesign-hook-contract.test.cjs'),'utf8');
source=source.slice(0,source.indexOf("test('new users"));
let adapter=fs.readFileSync(path.join(__dirname,'probe-search-origin.cjs'),'utf8');
adapter=adapter.slice(0,adapter.indexOf("render();assert.equal(window.history.scrollRestoration"));
adapter=adapter.replace("const root=path.resolve(__dirname,'..','..','theme-redesign-20261012','site');","const root=process.env.LANTERN_REVIEW_ROOT || path.resolve(__dirname,'..');");
adapter=adapter.replace("const imports={react:hooks","const appliedThemes=[];\nconst imports={react:hooks");
adapter=adapter.replace("useStudy:()=>({data,ready:true,recordsReadable:true,sync:'local',issues:[],syncNow(){},retryIssue(){},saveProfile(){},saveTheme(){},addAttempt(){},addCheckin(){},addRecording(){},recordingUrl(){}})","useStudy:()=>fixtureApi");
adapter=adapter.replace("applyDocumentTheme(){},UI_THEME_META:{paper:{name:'日间'}}","applyDocumentTheme(theme){appliedThemes.push(theme);},UI_THEME_META:{paper:{name:'日间'},crystal:{name:'夜间'},hollow:{name:'空洞骑士'},silk:{name:'丝之歌'}}");
const tail=`
function shellProjection(fixtureApi) {
${adapter}
const actualShell=load('app/learn/workspace-shell.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'lucide-react':proxy,'./ui-theme':{ThemeMotif:'ThemeMotif'}}).WorkspaceShell;
cursor=0;effects=[];tree=app({owner:'bob',nativeMode:false});effects.forEach(fn=>fn());
const props=shell().props,output=actualShell(props);
const nameNode=nodes(output).find(n=>n.type==='div'&&n.props?.className==='workspace-identity');
const identityText=nodes(nameNode).flatMap(n=>Array.isArray(n.props?.children)?n.props.children:[n.props?.children]).filter(x=>typeof x==='string').join(' ');
const reviewBadge=nodes(output).some(n=>n.type==='small'&&n.props?.children===1);
slots.forEach(slot=>slot?.cleanup?.());
return {props,identityText,reviewBadge,appliedTheme:appliedThemes.at(-1)};
}

test('C09: real owner-switch pre-effect snapshot cannot project prior nickname, review badge or document theme',()=>{
  const alice=structuredClone(model.EMPTY_DATA);alice.profile={...alice.profile,name:'PRIVATE Alice Owner A',theme:'silk'};
  alice.attempts=[{id:'private-owner-attempt',qid:'owner-wrong-question',choice:0,correct:false,createdAt:'2026-10-12T00:00:00.000Z',seconds:12,mode:'first'}];
  const storage=new Map([['lantern-v1-alice',JSON.stringify({data:alice})],['lantern-v1-bob:required-schema',JSON.stringify({schemaVersion:999})]]);
  const original=storage.get('lantern-v1-alice'),h=hookHarness(storage);h.render('alice');const readable=h.render('alice');
  const normal=shellProjection(readable);assert.equal(normal.props.name,'PRIVATE Alice Owner A');assert.equal(normal.props.reviewCount,1);assert.equal(normal.reviewBadge,true);assert.equal(normal.appliedTheme,'silk');
  const switching=h.render('bob');assert.equal(switching.ready,true);assert.equal(switching.recordsReadable,false);assert.equal(switching.data.profile.name,'PRIVATE Alice Owner A','Fixture must reproduce the actual retained snapshot before owner effect');
  const blocked=shellProjection(switching);assert.equal(blocked.props.name,'记录暂不可读');assert.doesNotMatch(blocked.identityText,/PRIVATE Alice/);assert.equal(blocked.reviewBadge,false);assert.equal(blocked.props.reviewCount,0);assert.equal(blocked.appliedTheme,'paper');
  const failed=h.render('bob');assert.equal(failed.sync,'blocked');assert.equal(failed.recordsReadable,false);assert.equal(failed.data.attempts.length,0);
  const failure=shellProjection(failed);assert.equal(failure.props.name,'记录暂不可读');assert.equal(failure.reviewBadge,false);assert.equal(failure.appliedTheme,'paper');
  assert.equal(h.writes.length,0);assert.equal(storage.get('lantern-v1-alice'),original);h.unmount();
});

test('C09: loading shell with stale data uses neutral identity and hides review badge before effects',()=>{
  const original=structuredClone(model.EMPTY_DATA);original.profile={...original.profile,name:'PRIVATE Loading Previous Owner',theme:'hollow'};
  original.attempts=[{id:'stale-review',qid:'previous-question',choice:0,correct:false,createdAt:'2026-10-12T00:00:00.000Z',seconds:12,mode:'first'}];
  const shell=shellProjection({data:original,ready:false,recordsReadable:false,sync:'loading',issues:[],syncNow(){}});
  assert.equal(shell.props.name,'正在读取记录');assert.doesNotMatch(shell.identityText,/PRIVATE Loading/);assert.equal(shell.props.reviewCount,0);assert.equal(shell.reviewBadge,false);assert.equal(shell.appliedTheme,'paper');
  assert.equal(original.profile.name,'PRIVATE Loading Previous Owner');assert.equal(original.profile.theme,'hollow');assert.equal(original.attempts.length,1,'Projection must not clear stored records');
});
`;
fs.writeFileSync(path.join(__dirname,'ui-redesign-owner-shell.test.cjs'),source+tail,'utf8');
console.log('Prepared independent staging ui-redesign-owner-shell.test.cjs');
