const fs=require('node:fs'),path=require('node:path');
const root=process.env.LANTERN_SITE_ROOT;if(!root)throw Error('Pass LANTERN_SITE_ROOT explicitly');
let source=fs.readFileSync(path.join(root,'tests/ui-redesign-exam.test.cjs'),'utf8');
function replace(old,next){if(!source.includes(old))throw Error('Exam harness changed: '+old.slice(0,80));source=source.replace(old,next);}
replace('answerGate=null,exitGate=null,submitGate=null;','answerGate=null,exitGate=null,submitGate=null,selectGate=null;');
replace('async select(id,number,now,revision){assert.equal(revision,row.attempt.revision);','async select(id,number,now,revision){calls.push([\'select\',id,number,revision]);if(selectGate)await selectGate.promise;assert.equal(revision,row.attempt.revision);');
replace('setSubmitGate(value){submitGate=value;}};','setSubmitGate(value){submitGate=value;},setSelectGate(value){selectGate=value;}};');
replace('let slots=[],cursor=0,effects=[],dirty=false,tree,dead=false,lateWrites=0,back,tick,closed=0;','let slots=[],cursor=0,effects=[],dirty=false,tree,dead=false,lateWrites=0,back,tick,closed=0;const frames=[],focuses=[],scrolls=[],queries=[];');
replace('{document:{hidden:false},Date:ClockDate,setInterval:handler=>{tick=handler;return 1;},clearInterval(){}});',`{document:{hidden:false,querySelector(selector){
      const number=Number(selector.match(/第 (\\d+) 题/)?.[1]);const paper=nodes(tree).find(node=>node.type===mod.ExamPaper),result=nodes(tree).find(node=>node.type===mod.Results);
      queries.push({number,attemptId:result?.props.attempt.id});if(paper?.props.question.number!==number)return null;
      return {scrollIntoView(options){scrolls.push({number,options,attemptId:result?.props.attempt.id});},focus(options){focuses.push({number,options,attemptId:result?.props.attempt.id});}};
    }},requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},Date:ClockDate,setInterval:handler=>{tick=handler;return 1;},clearInterval(){}});`);
replace('const h={mod,render,drain,get tree(){return tree;},','const h={mod,render,drain,focuses,scrolls,queries,get pendingFrames(){return frames.length;},paint(){if(!dead)render();const batch=frames.splice(0);batch.forEach(fn=>fn());if(!dead)render();},get tree(){return tree;},');
source+=fs.readFileSync(path.join(__dirname,'exam-focus-cases.txt'),'utf8');
fs.writeFileSync(path.join(__dirname,'ui-redesign-exam.test.cjs'),source,'utf8');
console.log('Prepared existing exam suite plus 3 independent focus cases in staging only.');
