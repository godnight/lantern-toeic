// Deliberately in-memory workflow boundary for the existing owner/navigation
// probes. Real storage, CAS and bridge behavior live in phase2-*workflow tests.
exports.workflowShellFixture = function workflowShellFixture(react, selection) {
 return {
  '@/lib/use-vocabulary': {useVocabulary:()=>({ready:true,error:'',events:[]})},
  '@/lib/use-vocabulary-workflow': {useVocabularyWorkflow:()=>({ready:false,error:'',projection:null,activeSession:null})},
  '@/lib/use-practice-workflow': {usePracticeWorkflow:options=>{
   const key=JSON.stringify([options.nativeMode,options.owner]);
   const [view,setView]=react.useState(null);
   const session=view?.key===key?view.session:null;
   return {ready:options.ready,error:'',busy:false,session,sessions:session?[session]:[],pendingSettlements:[],refresh:async()=>{},
    start(queue,start){const id='fixture-session-'+key;setView({key,session:{id,queue,cursor:0,status:'active',chainId:start.chainId||id,unitIds:start.unitIds,steps:queue.map(q=>({status:'unanswered',choice:null,attempt:null})),settlement:{status:'draft',draft:{minutes:1,load:'刚好',note:''},payload:null}}});return Promise.resolve({status:'started',sessionId:id});},
    closeView(){setView(null);return Promise.resolve({status:'closed',sessionId:session?.id||''});},
    resume:async()=>({status:'restored'}),leave:async()=>({status:'updated'}),submit:async()=>({status:'applied'}),next:async()=>({status:'updated'}),updateSettlementDraft:async()=>({status:'updated'}),settle:async()=>({status:'applied'})};
  }},
  '@/lib/practice-selection':selection,
  './learn/practice-settlement':{default:'PracticeSettlement'},
  './learn/learning-plan':{LearningPlanDialog:'LearningPlanDialog'},
  './learn/interactive-example':{InteractiveExample:'InteractiveExample'},
  './learn/vocabulary-plan':{VocabularyPlan:'VocabularyPlan',TodayVocabularyTask:'TodayVocabularyTask',CandidateAction:'CandidateAction'}
 };
};
