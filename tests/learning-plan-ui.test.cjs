const test=require('node:test'),assert=require('node:assert/strict');
const {harness,workflow,text}=require('./helpers/plan-ui-harness.cjs');
const profile={name:'Original',lrGoal:650,speakingGoal:130,examDate:'',dailyMinutes:10,weeklyTarget:2,timezone:'Asia/Shanghai',theme:'silk',onboarded:false};

test('plan opens without writes, preserves legacy book, and submits current revision only once',async()=>{
 let calls=[],finish,saved=0;const w=workflow({savePlan:(draft,revision)=>{calls.push({draft,revision});return new Promise(resolve=>finish=resolve);}});
 const h=harness('VocabularyPlanEditor',{workflow:w,onLeave(){},onSaved(){saved++;}});
 assert.match(text(h.tree),/保留当前词本/);assert.equal(calls.length,0);
 h.submit();h.submit();assert.equal(calls.length,1);assert.equal(calls[0].draft.bookId,'scene');assert.equal(calls[0].revision,4);
 finish({status:'applied'});await h.flush();assert.equal(saved,1);h.unmount();
});
test('unknown plan is read back without automatic save or equality-as-success',async()=>{
 let saves=0,reads=0,closed=0;const w=workflow({savePlan:async()=>{saves++;return {status:'unknown',id:'original-id'};},refresh:async()=>{reads++;}});
 const h=harness('VocabularyPlanEditor',{workflow:w,onLeave(){closed++;},onSaved(){closed++;}});
 h.submit();await h.flush();assert.equal(closed,0);assert.match(text(h.tree),/original-id/);
 h.click('重新读取核对');await h.flush();assert.equal(reads,1);assert.equal(saves,1);assert.equal(closed,0);
 w.projection.plan.revision=5;h.render();h.click('已核对，继续修改');h.submit();await h.flush();assert.equal(saves,2);h.unmount();
});
test('15s watchdog unlocks safe exit; late applied never closes the editor',async()=>{
 let finish,closed=0;const back={current:null},h=harness('VocabularyPlanEditor',{workflow:workflow({savePlan:()=>new Promise(resolve=>finish=resolve)}),backRef:back,onLeave(){closed++;},onSaved(){closed++;}});
 h.submit();back.current();h.render();assert.equal(h.find(n=>n.props?.role==='alertdialog').length,0);
 h.timeout();assert.match(text(h.tree),/15秒/);h.click('返回');assert.match(text(h.tree),/离开不会撤销/);
 finish({status:'applied'});await h.flush();assert.equal(closed,0);h.click('仍返回');assert.equal(closed,1);h.unmount();
});
test('read recovery stays available when refresh returns before storage is readable',async()=>{
 let saves=0,reads=0;const w=workflow({savePlan:async()=>{saves++;return {status:'unknown'};},refresh:async()=>{reads++;w.ready=false;w.error='存储正在重新打开';}});
 const h=harness('VocabularyPlanEditor',{workflow:w,onLeave(){},onSaved(){throw Error('Unknown must not close');}});
 h.submit();await h.flush();h.click('重新读取核对');await h.flush();
 assert.equal(reads,1);assert.equal(saves,1);assert.equal(h.button('已核对，继续修改'),undefined);assert.equal(h.button('重新读取核对').props.disabled,false);assert.doesNotMatch(text(h.tree),/已重新读取当前计划/);
 h.click('重新读取核对');await h.flush();assert.equal(reads,2);assert.equal(saves,1);
 w.ready=true;w.error='';h.render();assert.ok(h.button('已核对，继续修改'));h.unmount();
});
test('unmount and scope change discard late save UI results',async()=>{
 for(const kind of ['unmount','scope']){let finish,closed=0;const w=workflow({savePlan:()=>new Promise(resolve=>finish=resolve)}),h=harness('VocabularyPlanEditor',{workflow:w,onLeave(){},onSaved(){closed++;}});h.submit();if(kind==='unmount')h.unmount();else h.update({workflow:{...w,scopeKey:'scope-b'}});finish({status:'applied'});await h.flush();assert.equal(closed,0);h.unmount();}
});
test('profile preserves all nine fields and boolean false never closes or promises rollback',()=>{
 let seen,closed=0;const h=harness('ProfilePlanEditor',{profile,readable:true,saveProfile:p=>{seen=p;return false;},onLeave(){closed++;},onSaved(){closed++;}});
 h.submit();assert.equal(closed,0);assert.deepEqual(Object.keys(seen).sort(),Object.keys(profile).sort());assert.equal(seen.theme,'silk');assert.equal(seen.onboarded,true);assert.equal(seen.dailyMinutes,10);assert.equal(seen.weeklyTarget,2);assert.match(text(h.tree),/尚未确认完整保存/);h.click('返回');assert.match(text(h.tree),/离开不会撤销/);h.unmount();
});
test('profile true closes, unsubmitted dirty exit can continue without writing',()=>{
 let writes=0,closed=0;const h=harness('ProfilePlanEditor',{profile,readable:true,saveProfile:()=>{writes++;return true;},onLeave(){closed++;},onSaved(){closed++;}});
 const name=h.find(n=>n.type==='input'&&n.props.maxLength===40)[0];name.props.onChange({target:{value:'Changed'}});h.render();h.click('返回');assert.equal(writes,0);assert.match(text(h.tree),/放弃修改/);h.click('继续编辑');assert.equal(writes,0);h.submit();h.submit();assert.equal(writes,1);assert.equal(closed,1);h.unmount();
});
test('dailyNew boundaries and covered goal with no weekdays retain the existing rules',async()=>{
 let writes=[];const w=workflow({savePlan:async draft=>{writes.push(draft);return {status:'applied'};}});w.projection.plan.goal=2;w.projection.plan.weekdays=[];w.projection.learnedWordIds=['word-a','word-b'];
 const h=harness('VocabularyPlanEditor',{workflow:w,onLeave(){},onSaved(){}});
 const change=value=>{h.find(n=>n.type==='input'&&n.props.type==='number')[1].props.onChange({target:{value:String(value)}});h.render();};
 for(const value of [0,1001,1.5,NaN]){change(value);assert.equal(h.button('保存计划').props.disabled,true);}
 for(const value of [1,1000]){change(value);assert.equal(h.button('保存计划').props.disabled,false);}
 h.submit();await h.flush();assert.equal(writes.length,1);assert.equal(writes[0].dailyNew,1000);assert.deepEqual(Array.from(writes[0].weekdays),[]);h.unmount();
});
test('overview blocks unreadable summaries and never manufactures sync or a plan',()=>{
 const h=harness('LearningPlanOverview',{workflow:workflow(),profile,readable:false,savingScope:'本机',onWord(){},onGoals(){}});assert.doesNotMatch(text(h.tree),/已学 0|听读 650/);assert.equal(h.button('制定单词安排').props.disabled,true);h.unmount();
});
