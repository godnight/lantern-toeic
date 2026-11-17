// Runs the real pure TSX with React's runtime. These tests verify text and
// native-button contracts; browser/ArkWeb focus and touch need separate QA.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.LANTERN_REVIEW_ROOT||path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const source=fs.readFileSync(path.join(root,'app/learn/interactive-example.tsx'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const componentExports={};
vm.runInNewContext(code,{exports:componentExports,require:name=>{assert.equal(name,'react/jsx-runtime');return require(path.join(root,'node_modules/react/jsx-runtime'));}});
const {InteractiveExample}=componentExports;
const {renderToStaticMarkup}=require(path.join(root,'node_modules/react-dom/server'));
function text(node){return node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):text(node.props?.children);}
function buttons(tree){return (Array.isArray(tree.props.children)?tree.props.children:[tree.props.children]).filter(node=>node?.type==='button');}

test('English lookup tokens preserve every character, space, line break and punctuation',()=>{
 const sentence='  “Café” employees\' schedules—don’t re-enter!\nRoom B2B: 24 seats; co‑operate.  ';
 const tree=InteractiveExample({text:sentence,onLookup(){}});
 assert.equal(text(tree),sentence);
 assert.deepEqual(Array.from(buttons(tree),text),['Café','employees','schedules','don’t','re-enter','Room','B2B','seats','co‑operate']);
 assert.equal(tree.props.lang,'en');
});

test('lookup passes the original word and exact currentTarget once, without a lemma or storage dependency',()=>{
 const calls=[],trigger={id:'actual-trigger'};
 const tree=InteractiveExample({text:'Meetings aren’t e-mails.',onLookup:(query,element)=>calls.push({query,element})});
 const token=buttons(tree)[0];token.props.onClick({currentTarget:trigger});
 assert.equal(calls.length,1);assert.equal(calls[0].query,'Meetings');assert.equal(calls[0].element,trigger);
 assert.equal(text(tree),'Meetings aren’t e-mails.');
});

test('tokens use native focusable buttons for keyboard and touch activation, without key overrides',()=>{
 const tree=InteractiveExample({text:'Ready now?',onLookup(){}});
 for(const token of buttons(tree)){
  assert.equal(token.type,'button');assert.equal(token.props.type,'button');assert.equal(token.props['aria-haspopup'],'dialog');
  assert.equal(token.props['aria-label'],'查词：'+text(token));assert.notEqual(token.props.tabIndex,-1);
  assert.equal(typeof token.props.onClick,'function');assert.equal(token.props.onKeyDown,undefined);assert.equal(token.props.role,undefined);
 }
});

test('blocking an underlying library keeps token elements disabled and does not dispatch lookup',()=>{
 const calls=[],tree=InteractiveExample({text:'Keep this trigger.',disabled:true,onLookup:(...args)=>calls.push(args)});
 assert.equal(buttons(tree).length,3);for(const token of buttons(tree)){assert.equal(token.props.disabled,true);token.props.onClick({currentTarget:{}});}
 assert.equal(calls.length,0);assert.equal(text(tree),'Keep this trigger.');
});

test('a lookup-only example without a callback remains plain text with no nested action',()=>{
 const sentence='Returns & “searches” <stay> literal.\n';
 const tree=InteractiveExample({text:sentence});assert.equal(text(tree),sentence);assert.equal(buttons(tree).length,0);
 const markup=renderToStaticMarkup(tree);assert.match(markup,/Returns &amp;/);assert.match(markup,/&lt;stay&gt;/);assert.doesNotMatch(markup,/<button|<stay>/);
});

test('empty or numeric-only examples never acquire empty or numeric lookup controls',()=>{
 for(const sentence of ['', ' 2026: 5–10 / 24. ']){const tree=InteractiveExample({text:sentence,onLookup(){}});assert.equal(text(tree),sentence);assert.equal(buttons(tree).length,0);}
});
