const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const siteRoot = process.env.LANTERN_SITE_ROOT || path.resolve(__dirname, '..');
const sourceRoot = process.env.LANTERN_EXAM_SOURCE_ROOT || siteRoot;
const prototypePath = path.join(siteRoot, 'docs/design/ui-redesign-20261013/prototype/exam-v11.js');

function fixture() {
  const events = [];
  const context = {
    URLSearchParams, params: new URLSearchParams(''), window: {designExtras: {}},
    pages: {}, stateOptions: {}, page: 'exam', state: 'reading-multi', theme: 'day',
    examContent() {}, examSetupContent() {}, examResultContent() {}, render() {}, toast() {},
    escapeHTML: value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    btn: (label, target, primary, attrs='') => `<button class="button ${primary?'primary':''}" ${attrs}>${label}</button>`,
    header: (title, subtitle) => `<h1>${title}</h1><p>${subtitle}</p>`,
    document: {
      body: {classList: {add() {}, toggle() {}}},
      querySelector() {return null;}, getElementById() {return null;},
      addEventListener(type, handler) {events.push([type, handler]);},
    },
  };
  context.navigate = (page, state) => {context.page=page;context.state=state||context.stateOptions[page][0][0];};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(prototypePath, 'utf8'), context, {filename: prototypePath});
  return {
    context,
    press(action) {
      const button = {dataset: {examAction: action}};
      const event = {target: {closest: () => button}, preventDefault() {}, stopImmediatePropagation() {}};
      for (const [type, handler] of events) if (type==='click') handler(event);
    },
    submit() {this.press('submit-open');this.press('submit');this.press('demo-submit-success');},
    review() {this.press('review');return context.window.designExtras.examreview();},
  };
}

function activeChoice(html) {
  return html.match(/class="option active[^>]*data-exam-action="exam-choose-([A-D])"/)?.[1];
}

test('R1: unpersisted B is unanswered after successful submission and review', () => {
  const view=fixture();view.context.examContent();view.submit();
  const result=view.context.examResultContent();
  assert.match(result,/正确 119 · 错误 27 · 漏答 54/);
  const review=view.review();
  assert.equal(activeChoice(review),undefined);
  assert.match(review,/本次未作答 \/ 未保存 · 正确答案 B/);
  assert.doesNotMatch(review,/回答正确 · 正确答案 B/);
  assert.match(review,/设计示例题包 A · v1/);
  assert.match(review,/首次完整模考/);
});

test('R1: persisted B is the immutable original answer after submission', () => {
  const view=fixture();view.context.examContent();view.press('exam-choose-B');view.press('save-answer');view.submit();
  assert.match(view.context.examResultContent(),/正确 120 · 错误 27 · 漏答 53/);
  assert.equal(activeChoice(view.review()),'B');
  assert.match(view.review(),/回答正确 · 正确答案 B/);
  // A later transient fixture selection cannot rewrite this submitted record.
  view.context.page='exam';view.context.state='reading-multi';view.press('exam-choose-A');
  view.context.page='examreview';view.context.state='default';
  assert.equal(activeChoice(view.context.window.designExtras.examreview()),'B');
});

test('R1: persisted A followed by unpersisted B reviews the saved A', () => {
  const view=fixture();view.context.examContent();view.press('exam-choose-A');view.press('save-answer');
  view.press('exam-choose-B');view.submit();
  assert.match(view.context.examResultContent(),/正确 119 · 错误 28 · 漏答 53/);
  const review=view.review();
  assert.equal(activeChoice(review),'A');
  assert.match(review,/回答错误 · 正确答案 B/);
  view.press('back-result');
  assert.equal(view.context.page,'examresult');
  assert.match(view.context.examResultContent(),/layout-attempt-a-01/);
});

test('R1: production question rendering must use the durable saved attempt for submitted answers', () => {
  const source=fs.readFileSync(path.join(sourceRoot,'app/learn/mock-exam.tsx'),'utf8');
  assert.match(source,/durableSubmitted\s*=\s*saved\?\.attempt\.status\s*===\s*'submitted'\s*&&\s*!!saved\.result/);
  assert.match(source,/selected=\{[^}]*saved\.attempt\.answers\[question\.number\]\?\.choice[^}]*\}/);
  assert.match(source,/result=\{saved\.result!\}\s+attempt=\{saved\.attempt\}/);
});

const ts=require(path.join(siteRoot,'node_modules/typescript'));
const React=require(path.join(siteRoot,'node_modules/react'));
const runtime=require(path.join(siteRoot,'node_modules/react/jsx-runtime'));
const {renderToStaticMarkup}=require(path.join(siteRoot,'node_modules/react-dom/server'));
const icons=require(path.join(siteRoot,'node_modules/lucide-react'));
function load(file,imports={},globals={}) {
  const exports={},code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>{if(name==='@/lib/learning-access')return {useLearningAccess:()=>()=>true};assert.ok(name in imports,`Unexpected import: ${name}`);return imports[name];},
    Date,Intl,Map,Set,Promise,Error,JSON,URL,Blob,AbortController,TextEncoder,Uint8Array,Uint32Array,ArrayBuffer,atob,btoa,setTimeout,clearTimeout,crypto:globalThis.crypto,...globals},{filename:file});
  return exports;
}
const model=load(path.join(siteRoot,'lib/exam-model.ts'));
const ui=load(path.join(siteRoot,'lib/exam-ui.ts'),{'@/lib/exam-model':model});
const dialog=new Proxy({},{get:(_,name)=>name});
const componentPath=path.join(sourceRoot,'app/learn/mock-exam.tsx');
const imports={react:React,'react/jsx-runtime':runtime,'lucide-react':icons,'@/components/ui/dialog':dialog,
  '@/lib/native-host':{},'@/lib/exam-model':model,'@/lib/exam-storage':{},'@/lib/exam-ui':ui,'./exam-library':{}};
const component=load(componentPath,imports);
const synthetic=require(path.join(siteRoot,'tests/fixtures/synthetic-exam.cjs'));
const legacySynthetic=require(path.join(siteRoot,'tests/fixtures/synthetic-legacy-exam.cjs'));
const start=Date.parse('2026-10-13T09:00:00.000Z');
const fingerprint='sha256:'+'a'.repeat(64);
function pack(legacy=false) {return model.parseExamPackage(legacy?legacySynthetic():synthetic());}
function newAttempt(exam,ordinal=1) {return model.createAttempt(exam,{id:'ui-synthetic-attempt',ownerId:'ui-test-owner',fingerprint,ordinal,now:start});}
const paperProps=(exam,number,extra={})=>({question:exam.questions.find(q=>q.number===number),group:exam.groups.find(g=>g.questionNumbers.includes(number)),
  urls:{pixel:'blob:synthetic-picture'},submitted:false,disabled:false,previousAvailable:true,nextAvailable:true,onAnswer(){},onSelect(){},onImage(){},onImageError(){},...extra});

test('actual ExamPaper keeps submitted A when a later transient B is passed',()=>{
  const exam=pack(),question=exam.questions.find(q=>q.number===101);
  const html=renderToStaticMarkup(React.createElement(component.ExamPaper,paperProps(exam,101,{selected:0,pendingChoice:1,submitted:true})));
  assert.match(html,/<label class="answer-wrong"><input[^>]*checked=""/);
  assert.match(html,/回答错误 · 正确答案 B/);
  assert.match(html,/<fieldset[^>]*disabled=""/);
  assert.doesNotMatch(html,/待保存|清除此题答案/);
  assert.equal(question.answer,1);
});

// IV05: rendered review feedback follows the immutable saved selection. Full
// question is intentionally passed before submission to exercise the defensive
// answer/explanation gate, rather than relying only on the model's stripping.
function feedbackView({selected,submitted}) {
  const question=pack().questions.find(q=>q.number===101);
  question.explanation='PRIVATE ANSWER EXPLANATION FIXTURE';
  const before=JSON.stringify(question);
  const html=renderToStaticMarkup(React.createElement(component.QuestionBody,{question,selected,submitted,disabled:false,onAnswer(){throw Error('Static feedback must not answer');}}));
  assert.equal(JSON.stringify(question),before,'Rendering must not rewrite the original question');
  const choices=[...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/g)].map(match=>match[0]);
  assert.equal(choices.length,4);
  return {html,choices};
}

test('IV05: saved wrong A has distinct error feedback while correct B remains unselected',()=>{
  const {html,choices}=feedbackView({selected:0,submitted:true});
  assert.match(choices[0],/^<label class="answer-wrong">/);assert.match(choices[0],/checked=""/);
  assert.match(choices[0],/你的答案 · 回答错误/);
  assert.match(choices[1],/^<label class="answer-correct">/);assert.doesNotMatch(choices[1],/checked=""/);
  assert.match(choices[1],/正确答案/);assert.doesNotMatch(choices[1],/你的答案/);
  assert.match(html,/class="mock-explanation answer-wrong"/);assert.match(html,/回答错误 · 正确答案 B/);
  assert.match(html,/PRIVATE ANSWER EXPLANATION FIXTURE/);assert.doesNotMatch(html,/class="selected"|清除此题答案/);
  assert.match(html,/<fieldset[^>]*disabled=""/);
});

test('IV05: saved correct B is marked as both the correct and learner answer',()=>{
  const {html,choices}=feedbackView({selected:1,submitted:true});
  assert.match(choices[1],/^<label class="answer-correct">/);assert.match(choices[1],/checked=""/);
  assert.match(choices[1],/正确答案 · 你的答案/);
  assert.match(html,/class="mock-explanation answer-correct"/);assert.match(html,/回答正确 · 正确答案 B/);
  assert.doesNotMatch(html,/answer-wrong|answer-unanswered|回答错误|class="selected"/);
  assert.equal((html.match(/checked=""/g)||[]).length,1);
});

test('IV05: submitted unanswered question reveals correct B without inventing a learner answer',()=>{
  const {html,choices}=feedbackView({selected:undefined,submitted:true});
  assert.match(choices[1],/^<label class="answer-correct">/);assert.match(choices[1],/正确答案/);
  assert.match(html,/class="mock-explanation answer-unanswered"/);assert.match(html,/未作答 · 正确答案 B/);
  assert.doesNotMatch(html,/checked=""|你的答案|answer-wrong|回答错误|class="selected"|清除此题答案/);
  assert.match(html,/<fieldset[^>]*disabled=""/);
});

test('IV05: unsubmitted full question never reveals correctness or explanation for either selection',()=>{
  for(const selected of [0,1,undefined]) {
    const {html,choices}=feedbackView({selected,submitted:false});
    assert.doesNotMatch(html,/answer-correct|answer-wrong|answer-unanswered|mock-explanation|mock-answer-label|正确答案|你的答案|回答正确|回答错误|PRIVATE ANSWER EXPLANATION FIXTURE/);
    assert.match(html,/清除此题答案/);assert.doesNotMatch(html,/<fieldset[^>]*disabled=""/);
    assert.equal((html.match(/checked=""/g)||[]).length,selected===undefined?0:1);
    if(selected!==undefined){assert.match(choices[selected],/^<label class="selected">/);assert.match(choices[selected],/checked=""/);}
  }
});

test('actual current and legacy long-material layouts use their original groups',()=>{
  for(const [legacy,number,count] of [[false,191,3],[true,181,2]]) {
    const exam=pack(legacy),props=paperProps(exam,number),html=renderToStaticMarkup(React.createElement(component.ExamPaper,props));
    assert.equal(props.group.passages.length,count);
    assert.match(html,/mock-paper-content parallel/);
    assert.equal((html.match(/id="mock-material-/g)||[]).length,count);
    assert.match(html,new RegExp(`第 ${number} / 200 题`));
  }
  const photo=renderToStaticMarkup(React.createElement(component.ExamPaper,paperProps(pack(),1)));
  assert.match(photo,/放大本组材料图片 1/);
  assert.match(photo,/blob:synthetic-picture/);
  assert.match(photo,/扫描材料未自动转为无障碍文字/);
});

test('actual results render all seven Parts using each original format and retest identity',()=>{
  for(const legacy of [false,true]) {
    const exam=pack(legacy),attempt=model.submitAttempt(model.advanceAttempt(newAttempt(exam,2),start+model.LISTENING_MS),start+model.LISTENING_MS+1000),result=model.gradeAttempt(exam,attempt);
    const html=renderToStaticMarkup(React.createElement(component.Results,{result,attempt}));
    assert.match(html,/复测第 1 次/);
    assert.equal((html.match(/scope="row"/g)||[]).length,7);
    assert.match(html,legacy?/<td>0 \/ 40<\/td>/:/<td>0 \/ 30<\/td>/);
    assert.match(html,legacy?/<td>0 \/ 48<\/td>/:/<td>0 \/ 54<\/td>/);
    assert.match(html,/不推算正式托业分数/);
  }
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function controlledRepository() {
  const exam=pack(),base=newAttempt(exam),clock={now:start+model.LISTENING_MS+1000};
  let row={attempt:model.advanceAttempt(base,clock.now)},answerGate=null,exitGate=null,submitGate=null,selectGate=null;
  const calls=[];
  const summary={key:model.examKey(exam),id:exam.id,version:exam.version,title:exam.title,source:exam.source,fingerprint,bytes:1000,importedAt:start};
  const commit=attempt=>{row={attempt,...(attempt.status==='submitted'?{result:model.gradeAttempt(exam,attempt)}:{})};return row;};
  const repo={ownerId:'ui-test-owner',close(){calls.push(['close']);},async listPackages(){return [summary];},async listAttempts(){return [row];},async getPackage(){return exam;},async getDefinition(){return exam;},async getAssetBlob(_key,id){const asset=exam.assets.find(a=>a.id===id);assert.ok(asset,'Synthetic asset exists');return new Blob([Buffer.from(asset.base64,'base64')],{type:asset.mime});},
    async resumeAttempt(){calls.push(['resume']);return row;},
    async markInterrupted(id,reason,now,revision){calls.push(['interrupt',id,revision]);if(exitGate)await exitGate.promise;assert.equal(revision,row.attempt.revision);return commit(model.markInterrupted(row.attempt,reason,now));},
    async answer(id,number,choice,now,revision){calls.push(['answer',id,number,choice,revision]);if(answerGate)await answerGate.promise;assert.equal(revision,row.attempt.revision);return commit(model.answerQuestion(row.attempt,number,choice,now));},
    async select(id,number,now,revision){calls.push(['select',id,number,revision]);if(selectGate)await selectGate.promise;assert.equal(revision,row.attempt.revision);return commit(model.selectQuestion(row.attempt,number,now));},
    async submit(id,now,revision){calls.push(['submit',id,revision]);if(submitGate)await submitGate.promise;assert.equal(revision,row.attempt.revision);return commit(model.submitAttempt(row.attempt,now));},
  };
  return {repo,clock,calls,exam,get row(){return row;},setAnswerGate(value){answerGate=value;},setExitGate(value){exitGate=value;},setSubmitGate(value){submitGate=value;},setSelectGate(value){selectGate=value;}};
}
function ownerHarness(control) {
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  let slots=[],cursor=0,effects=[],dirty=false,tree,dead=false,lateWrites=0,back,tick,closed=0;const frames=[],focuses=[],scrolls=[],queries=[];
  const hooks={useRef(value){const i=cursor++;if(!(i in slots))slots[i]={current:value};return slots[i];},
    useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return [slots[i],next=>{if(dead){lateWrites++;return;}const value=typeof next==='function'?next(slots[i]):next;if(!Object.is(value,slots[i])){slots[i]=value;dirty=true;}}];},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
    useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps))slots[i]={deps,fn};return slots[i].fn;}};
  class ClockDate extends Date {constructor(...args){super(...(args.length?args:[control.clock.now]));}static now(){return control.clock.now;}}
  const mod=load(componentPath,{...imports,react:hooks,'@/lib/native-host':{isNativeForeground:()=>true,registerNativeBack:handler=>{back=handler;return ()=>{if(back===handler)back=null;};},subscribeNativeState:()=>()=>{}},
    '@/lib/exam-storage':{openExamRepository:async()=>control.repo},'@/lib/exam-ui':{...ui,verifyExamImage:async()=>{},ExamAssetUrls:class {get(id){return 'blob:'+id;}close(){}}}},
    {document:{hidden:false,querySelector(selector){
      const number=Number(selector.match(/第 (\d+) 题/)?.[1]);const paper=nodes(tree).find(node=>node.type===mod.ExamPaper),result=nodes(tree).find(node=>node.type===mod.Results);
      queries.push({number,attemptId:result?.props.attempt.id});if(paper?.props.question.number!==number)return null;
      return {scrollIntoView(options){scrolls.push({number,options,attemptId:result?.props.attempt.id});},focus(options){focuses.push({number,options,attemptId:result?.props.attempt.id});}};
    }},requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},Date:ClockDate,setInterval:handler=>{tick=handler;return 1;},clearInterval(){}});
  const outer=mod.default({ownerId:control.repo.ownerId,onClose:()=>closed++}),Owner=outer.type;
  function render(){let count=0;do{assert.ok(++count<35,'Owner did not settle');dirty=false;cursor=0;effects=[];tree=Owner(outer.props);effects.forEach(fn=>fn());}while(dirty);return tree;}
  function textOf(node){if(node==null||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(textOf).join('');if(typeof node!=='object')return String(node);if(node.type==='Dialog'&&!node.props.open)return '';if([mod.QuestionBody,mod.ExamPaper,mod.Results].includes(node.type))return textOf(node.type(node.props));return textOf(node.props?.children);}
  function nodes(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(nodes);if(node.type==='Dialog'&&!node.props.open)return [];if([mod.QuestionBody,mod.ExamPaper,mod.Results].includes(node.type))return [node,...nodes(node.type(node.props))];return [node,...React.Children.toArray(node.props?.children).flatMap(nodes)];}
  async function drain(){for(let i=0;i<28;i++){await Promise.resolve();render();}}
  const h={mod,render,drain,focuses,scrolls,queries,get pendingFrames(){return frames.length;},paint(){if(!dead)render();const batch=frames.splice(0);batch.forEach(fn=>fn());if(!dead)render();},get tree(){return tree;},get text(){return textOf(tree);},get closed(){return closed;},get lateWrites(){return lateWrites;},find:predicate=>nodes(tree).find(predicate),all:predicate=>nodes(tree).filter(predicate),
    async click(label){const button=nodes(tree).find(n=>n.type==='button'&&textOf(n)===label);assert.ok(button,`Missing button: ${label}`);assert.notEqual(button.props.disabled,true,`Disabled: ${label}`);button.props.onClick();await drain();},
    async choose(number,index){const inputs=nodes(tree).filter(n=>n.type==='input'&&n.props.name===`exam-answer-${number}`);assert.ok(inputs[index]);inputs[index].props.onChange();await drain();},
    async back(){assert.ok(back);back();await drain();},async tick(){tick();await drain();},unmount(){slots.forEach(slot=>slot?.cleanup?.());dead=true;}};
  render();return h;
}
async function openedOwner() {const control=controlledRepository(),view=ownerHarness(control);await view.drain();await view.click('继续考试');return {control,view};}

test('actual owner: pending/failed answer remains visible without increasing durable count, then retries',async()=>{
  const {control,view}=await openedOwner(),gate=deferred(),deadline=control.row.attempt.readingDeadline;
  control.setAnswerGate(gate);await view.choose(101,1);
  assert.match(view.text,/已保存 0 \/ 200/);assert.match(view.text,/已选 B · 待保存/);assert.equal(control.row.attempt.answers[101],undefined);
  gate.reject(Error('synthetic quota failure'));await view.drain();
  assert.match(view.text,/临时选项 B尚未保存/);assert.match(view.text,/已保存 0 \/ 200/);assert.equal(view.closed,0);
  control.setAnswerGate(null);await view.click('重试保存本题');
  assert.equal(control.row.attempt.answers[101].choice,1);assert.match(view.text,/已保存 1 \/ 200/);assert.equal(control.row.attempt.readingDeadline,deadline);view.unmount();
});

test('actual owner: unsaved later selection is excluded from submission and original review',async()=>{
  const {control,view}=await openedOwner();await view.choose(101,0);
  const gate=deferred();control.setAnswerGate(gate);await view.choose(101,1);gate.reject(Error('synthetic quota failure'));await view.drain();
  await view.click('提交整卷');assert.match(view.text,/仅按原已保存选项 A 交卷/);
  await view.click('确认交卷');assert.equal(control.row.attempt.status,'submitted');
  // Submitted review initially opens LC question 1; choose the original RC question using the all-Part card.
  const originalQuestion=view.find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('第 101 题，'));assert.ok(originalQuestion);originalQuestion.props.onClick();await view.drain();assert.equal(control.row.attempt.answers[101].choice,0);
  assert.match(view.text,/回答错误 · 正确答案 B/);const radios=view.all(n=>n.type==='input'&&n.props.name==='exam-answer-101');assert.equal(radios[0].props.checked,true);assert.equal(radios[1].props.checked,false);
  assert.doesNotMatch(view.text,/已选 B · 待保存/);view.unmount();
});

test('actual owner: failed submit does not reveal results and original deadline remains visible',async()=>{
  const {control,view}=await openedOwner(),gate=deferred();control.setSubmitGate(gate);await view.click('提交整卷');await view.click('确认交卷');
  assert.match(view.text,/正在保存交卷/);assert.equal(view.find(n=>n.type===view.mod.Results),undefined);
  gate.reject(Error('synthetic write failure'));await view.drain();assert.equal(control.row.attempt.status,'reading');assert.match(view.text,/交卷尚未完成/);assert.equal(view.find(n=>n.type===view.mod.Results),undefined);assert.match(view.text,/原截止/);
  control.setSubmitGate(null);await view.click('确认交卷');assert.equal(control.row.attempt.status,'submitted');view.unmount();
});

test('actual owner: Back closes submit/exit confirmation before leaving; failure has explicit emergency exit',async()=>{
  const {control,view}=await openedOwner();await view.click('提交整卷');await view.back();assert.doesNotMatch(view.text,/确认提交整卷/);assert.equal(view.closed,0);
  await view.back();assert.match(view.text,/保存并退出模考/);const gate=deferred();control.setExitGate(gate);
  // The page header and modal share this label; select the enabled modal callback directly.
  const buttons=view.all(n=>n.type==='button'&&n.props.children==='保存并退出');assert.equal(buttons.length,1);buttons[0].props.onClick();await view.drain();assert.equal(view.closed,0);assert.match(view.text,/正在保存退出状态/);
  gate.reject(Error('synthetic interruption failure'));await view.drain();assert.equal(view.closed,0);assert.match(view.text,/退出状态尚未保存/);assert.match(view.text,/原截止/);
  await view.click('中断标记未保存，仍退出（计时继续）');assert.equal(view.closed,0);await view.click('确认未保存仍退出');assert.equal(view.closed,1);view.unmount();
});

test('actual owner: late answer completion after owner disposal cannot update or close a new view',async()=>{
  const {control,view}=await openedOwner(),gate=deferred();control.setAnswerGate(gate);await view.choose(101,1);view.unmount();gate.resolve();for(let i=0;i<28;i++)await Promise.resolve();
  assert.equal(view.lateWrites,0);assert.equal(view.closed,0);assert.equal(control.calls.filter(call=>call[0]==='close').length,1);
});

test('actual owner: computed deadline with failed durable reconciliation locks answers and hides results',async()=>{
  const {control,view}=await openedOwner(),deadline=control.row.attempt.readingDeadline;
  control.repo.resumeAttempt=async()=>{throw Error('synthetic deadline write failure');};
  control.clock.now=deadline+1000;await view.tick();
  assert.match(view.text,/时间已到 · 作答已锁定/);assert.match(view.text,/重新读取记录/);
  assert.doesNotMatch(view.text,/正确答案 [A-D]|这一次，已交卷并保存/);
  assert.equal(view.find(n=>n.type===view.mod.Results),undefined);
  assert.ok(view.all(n=>n.type==='fieldset').every(n=>n.props.disabled));
  assert.equal(control.row.attempt.readingDeadline,deadline);assert.equal(control.row.attempt.status,'reading');view.unmount();
});

test('actual owner: image Back closes the preview before requesting exit or writing a new interruption',async()=>{
  const control=controlledRepository();control.exam.groups.find(group=>group.questionNumbers.includes(101)).imageIds=['pixel'];
  const view=ownerHarness(control);await view.drain();await view.click('继续考试');
  const interrupts=control.calls.filter(call=>call[0]==='interrupt').length;
  await view.click('放大图片 ↗');assert.match(view.text,/原图保持比例/);await view.back();
  assert.doesNotMatch(view.text,/原图保持比例/);assert.doesNotMatch(view.text,/保存并退出模考/);
  assert.equal(control.calls.filter(call=>call[0]==='interrupt').length,interrupts);assert.equal(view.closed,0);view.unmount();
});

test('actual owner: one keyed audio element remains under the same parent across preflight and start',async()=>{
  const control=controlledRepository();control.repo.listAttempts=async()=>[];
  control.repo.startAttempt=async key=>({attempt:model.createAttempt(control.exam,{id:'new-ui-synthetic-attempt',ownerId:control.repo.ownerId,fingerprint,ordinal:1,now:control.clock.now})});
  const view=ownerHarness(control);await view.drain();await view.click('音频预检与新考试');
  const before=view.find(node=>node.type===view.mod.ExamAudio);assert.ok(before);assert.equal(before.props.attempt,null);const beforeParent=parentOf(view.tree,before);assert.equal(beforeParent.type,'div');assert.match(beforeParent.props.className,/mock-preflight-layout/);
  before.props.onPreflight(true,before.props.url);await view.drain();
  const confirmation=view.find(node=>node.type==='input'&&node.props.type==='checkbox');assert.ok(confirmation);confirmation.props.onChange({target:{checked:true}});await view.drain();
  await view.click('开始新考试 · 立即计时');
  const after=view.find(node=>node.type===view.mod.ExamAudio);assert.ok(after);assert.equal(after.key,before.key);assert.equal(after.props.url,before.props.url);assert.equal(after.props.attempt.status,'listening');
  function parentOf(node,target,parent=null){if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const item of node){const found=parentOf(item,target,parent);if(found)return found;}return null;}if(node===target||node.type===target.type&&node.props===target.props)return parent;return parentOf(node.props?.children,target,node);}
  assert.equal(parentOf(view.tree,after).type,beforeParent.type);assert.match(parentOf(view.tree,after).props.className,/mock-running-media/);
  assert.equal((fs.readFileSync(componentPath,'utf8').match(/<ExamAudio\b/g)||[]).length,1);
  view.unmount();
});

async function focusCard(view,number){const button=view.find(node=>node.type==='button'&&node.props['aria-label']?.startsWith(`第 ${number} 题，`));assert.ok(button);assert.notEqual(button.props.disabled,true);button.props.onClick();await view.drain();}
const focusPlain=value=>JSON.parse(JSON.stringify(value)); // Compare JSON data, not VM realm prototypes.

test('actual owner: answer-card navigation focuses the saved question after paint; ordinary next keeps material position',async()=>{
  const {control,view}=await openedOwner(),before=structuredClone(control.row.attempt);
  await focusCard(view,176);assert.equal(control.row.attempt.activeQuestion,176);assert.equal(view.focuses.length,0);assert.equal(view.pendingFrames,1);
  assert.equal(control.row.attempt.id,before.id);assert.equal(control.row.attempt.readingDeadline,before.readingDeadline);assert.equal(control.row.attempt.listeningDeadline,before.listeningDeadline);assert.deepEqual(focusPlain(control.row.attempt.answers),before.answers);
  view.paint();assert.equal(view.scrolls.length,1);assert.equal(view.focuses.length,1);assert.equal(view.focuses[0].number,176);assert.equal(view.focuses[0].options.preventScroll,true);assert.equal(view.scrolls[0].options.behavior,'auto');
  await view.click('下一题');assert.equal(control.row.attempt.activeQuestion,177);assert.equal(view.pendingFrames,0);view.paint();assert.equal(view.scrolls.length,1);assert.equal(view.focuses.length,1);
  assert.equal(control.row.attempt.readingDeadline,before.readingDeadline);assert.deepEqual(focusPlain(control.row.attempt.answers),before.answers);
  assert.equal(control.calls.filter(call=>call[0]==='answer'||call[0]==='submit').length,0);view.unmount();
});

test('actual owner: a failed card selection never schedules focus or changes the saved question and original deadlines',async()=>{
  const {control,view}=await openedOwner(),before=structuredClone(control.row.attempt),gate=deferred();control.setSelectGate(gate);
  await focusCard(view,147);assert.equal(view.pendingFrames,0);assert.equal(control.row.attempt.activeQuestion,101);gate.reject(Error('synthetic selection write failed'));await view.drain();view.paint();
  assert.deepEqual(focusPlain(control.row.attempt),before);assert.equal(view.focuses.length,0);assert.equal(view.scrolls.length,0);assert.equal(view.queries.length,0);assert.match(view.text,/synthetic selection write failed/);
  control.setSelectGate(null);await focusCard(view,147);assert.equal(control.row.attempt.activeQuestion,147);view.paint();assert.equal(view.focuses.length,1);assert.equal(view.focuses[0].number,147);
  assert.equal(control.row.attempt.readingDeadline,before.readingDeadline);assert.deepEqual(focusPlain(control.row.attempt.answers),before.answers);view.unmount();
});

test('actual owner: stale card frames cannot focus a different attempt with the same question number or a disposed owner',async()=>{
  const control=controlledRepository();
  function submitted(id,ordinal){const base=model.createAttempt(control.exam,{id,ownerId:control.repo.ownerId,fingerprint,ordinal,now:start});
    const attempt=model.submitAttempt(model.advanceAttempt(base,start+model.LISTENING_MS),start+model.LISTENING_MS+1000);return{attempt,result:model.gradeAttempt(control.exam,attempt)};}
  const oldRow=submitted('old-focus-record',1),nextRow=submitted('next-focus-record',2),oldSnapshot=structuredClone(oldRow),nextSnapshot=structuredClone(nextRow);
  control.repo.listAttempts=async()=>[oldRow,nextRow];control.repo.resumeAttempt=async id=>id===oldRow.attempt.id?oldRow:nextRow;
  const view=ownerHarness(control);await view.drain();
  const history=view.find(node=>node.type==='button'&&Array.isArray(node.props.children)&&node.props.children[0]==='考试记录');assert.ok(history);history.props.onClick();await view.drain();
  function renderedText(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return Array.isArray(node)?node.map(renderedText).join(''):renderedText(node.props?.children);}
  async function openHistory(identity){const row=view.all(node=>node.props?.className==='panel mock-history-item').find(node=>renderedText(node).includes(identity));assert.ok(row,identity);
    const button=React.Children.toArray(row.props.children).find(node=>node.type==='button');assert.ok(button);button.props.onClick();await view.drain();}
  await openHistory('首次');await focusCard(view,147);assert.equal(view.pendingFrames,1);await view.click('回到题包与记录');
  await openHistory('复测第 1 次');await focusCard(view,147);assert.equal(view.pendingFrames,2);view.paint();
  assert.equal(view.queries.length,1,'The stale same-number frame must fail identity guard before querying the replacement view');
  assert.equal(view.focuses.length,1);assert.equal(view.focuses[0].attemptId,nextRow.attempt.id);assert.equal(view.focuses[0].number,147);
  await focusCard(view,176);assert.equal(view.pendingFrames,1);view.unmount();view.paint();assert.equal(view.queries.length,1);assert.equal(view.focuses.length,1);assert.equal(view.lateWrites,0);
  assert.deepEqual(focusPlain(oldRow),oldSnapshot);assert.deepEqual(focusPlain(nextRow),nextSnapshot);assert.equal(control.calls.filter(call=>call[0]==='select'||call[0]==='answer'||call[0]==='submit').length,0);
});

test('I02: failed draft disables next/previous and all card navigation; stale pre-paint callbacks cannot leave the question',async()=>{
  const {control,view}=await openedOwner(),before=structuredClone(control.row.attempt);
  const next=view.find(n=>n.type==='button'&&n.props.children==='下一题');
  const otherCard=view.find(n=>n.type==='button'&&n.props['aria-label']?.startsWith('第 102 题，'));
  const gate=deferred();control.setAnswerGate(gate);await view.choose(101,1);
  gate.reject(Error('synthetic first-answer quota failure'));await view.drain();
  const selects=control.calls.filter(call=>call[0]==='select').length;
  next.props.onClick();otherCard.props.onClick();await view.drain();view.paint();
  assert.equal(control.calls.filter(call=>call[0]==='select').length,selects);
  assert.equal(control.row.attempt.activeQuestion,101);assert.equal(control.row.attempt.id,before.id);
  assert.equal(control.row.attempt.readingDeadline,before.readingDeadline);assert.deepEqual(focusPlain(control.row.attempt.answers),before.answers);
  assert.match(view.text,/临时选项 B尚未保存/);assert.match(view.text,/已保存 0 \/ 200/);
  assert.doesNotMatch(view.text,/正确答案 [A-D]|mock-explanation/);assert.equal(view.pendingFrames,0);
  assert.ok(view.all(n=>n.type==='button'&&['上一题','下一题'].includes(n.props.children)).every(n=>n.props.disabled));
  assert.ok(view.all(n=>n.type==='button'&&n.props['aria-label']?.startsWith('第 ')).every(n=>n.props.disabled));
  view.unmount();
});

test('I02: explicit cancel drops only the failed change, then another question can save without rewriting the original answer',async()=>{
  const {control,view}=await openedOwner();await view.choose(101,0);
  const deadline=control.row.attempt.readingDeadline,id=control.row.attempt.id,gate=deferred();
  control.setAnswerGate(gate);await view.choose(101,1);gate.reject(Error('synthetic later-change failure'));await view.drain();
  assert.match(view.text,/原已保存选项 A 保留/);assert.equal(control.row.attempt.answers[101].choice,0);
  await view.click('取消未保存选择');assert.doesNotMatch(view.text,/临时选项 B尚未保存/);
  control.setAnswerGate(null);await view.click('下一题');await view.choose(102,0);
  assert.equal(control.row.attempt.activeQuestion,102);assert.equal(control.row.attempt.answers[101].choice,0);
  assert.equal(control.row.attempt.answers[102].choice,0);assert.match(view.text,/已保存 2 \/ 200/);
  assert.equal(control.row.attempt.id,id);assert.equal(control.row.attempt.readingDeadline,deadline);view.unmount();
});

test('I02: failed retry retains original draft and durable count until success, after which navigation unlocks',async()=>{
  const {control,view}=await openedOwner(),first=deferred();control.setAnswerGate(first);await view.choose(101,1);
  first.reject(Error('synthetic initial failure'));await view.drain();
  const retry=deferred();control.setAnswerGate(retry);await view.click('重试保存本题');retry.reject(Error('synthetic retry failure'));await view.drain();
  assert.equal(control.row.attempt.activeQuestion,101);assert.equal(control.row.attempt.answers[101],undefined);
  assert.match(view.text,/临时选项 B尚未保存/);assert.match(view.text,/已保存 0 \/ 200/);
  assert.equal(view.find(n=>n.type==='button'&&n.props.children==='下一题').props.disabled,true);
  control.setAnswerGate(null);await view.click('重试保存本题');await view.click('下一题');
  assert.equal(control.row.attempt.activeQuestion,102);assert.equal(control.row.attempt.answers[101].choice,1);
  const writes=control.calls.filter(call=>call[0]==='answer');assert.equal(writes.length,3);
  assert.ok(writes.every(call=>call[1]===control.row.attempt.id&&call[2]===101&&call[3]===1));view.unmount();
});

test('I02: stale answer callback for another question cannot replace a failed draft',async()=>{
  const {control,view}=await openedOwner();await view.click('下一题');
  const staleOther=view.find(n=>n.type===view.mod.ExamPaper).props.onAnswer;
  await view.click('上一题');const gate=deferred();control.setAnswerGate(gate);await view.choose(101,1);
  gate.reject(Error('synthetic pending failure'));await view.drain();const calls=control.calls.filter(call=>call[0]==='answer').length;
  staleOther(0);await view.drain();
  assert.equal(control.calls.filter(call=>call[0]==='answer').length,calls);
  assert.equal(control.row.attempt.answers[102],undefined);assert.equal(control.row.attempt.activeQuestion,101);
  assert.match(view.text,/临时选项 B尚未保存/);assert.doesNotMatch(view.text,/第 102 题临时选项/);view.unmount();
});

test('I02: rereading durable records clears only the error and still requires retry or explicit cancel of the draft',async()=>{
  const {control,view}=await openedOwner(),gate=deferred(),before=structuredClone(control.row.attempt);
  control.setAnswerGate(gate);await view.choose(101,1);gate.reject(Error('synthetic refresh fixture failure'));await view.drain();
  await view.click('重新读取记录');assert.doesNotMatch(view.text,/synthetic refresh fixture failure/);
  assert.match(view.text,/第 101 题变更仍待保存/);assert.match(view.text,/重试成功或明确取消后才能换题/);
  assert.equal(view.find(n=>n.type==='button'&&n.props.children==='下一题').props.disabled,true);
  assert.equal(control.row.attempt.activeQuestion,101);assert.deepEqual(focusPlain(control.row.attempt.answers),before.answers);
  assert.equal(control.row.attempt.readingDeadline,before.readingDeadline);assert.equal(control.row.attempt.id,before.id);
  await view.click('取消未保存选择');await view.click('下一题');assert.equal(control.row.attempt.activeQuestion,102);
  assert.equal(control.calls.filter(call=>call[0]==='answer').length,1);assert.deepEqual(focusPlain(control.row.attempt.answers),before.answers);view.unmount();
});

test('I02: a same-question callback while saving cannot replace the in-flight draft before its failure',async()=>{
  const {control,view}=await openedOwner(),stale=view.find(n=>n.type==='input'&&n.props.name==='exam-answer-101'&&n.props.checked===false);
  const gate=deferred();control.setAnswerGate(gate);await view.choose(101,1);
  stale.props.onChange();await view.drain();assert.equal(control.calls.filter(call=>call[0]==='answer').length,1);
  gate.reject(Error('synthetic pre-paint failure'));await view.drain();
  assert.match(view.text,/临时选项 B尚未保存/);assert.match(view.text,/已选 B · 待保存/);
  assert.equal(control.row.attempt.answers[101],undefined);assert.equal(control.row.attempt.activeQuestion,101);
  control.setAnswerGate(null);await view.click('重试保存本题');assert.equal(control.row.attempt.answers[101].choice,1);view.unmount();
});
