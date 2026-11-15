// SYNTHETIC EXPERIMENT ONLY: this is a pure projection, not a wire protocol,
// verifier, persistence layer, or product feature. No caller is connected.
// A future trusted authority must independently validate each causal edge and
// the immutable identity of each event (including device ownership, atomic
// sequence allocation, provenance and fork/replay checks). A claim supplied by
// a device, a timestamp, arrival order, or a legacy mode is NOT such proof.
// No authority or complete-history certificate exists in the current product.
// Do not use these provisional labels for statistics or scheduling.

const OWNER=/^usr_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION='synthetic-causal-order-v1';
const record=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>record(x)&&Object.keys(x).sort().join('\0')===[...keys].sort().join('\0');
const uuid=x=>typeof x==='string'&&x===x.toLowerCase()&&UUID.test(x);
const owner=x=>typeof x==='string'&&x===x.toLowerCase()&&OWNER.test(x);
const invalid=()=>Error('invalid synthetic causal evidence');

// verifiedEdges is a *precondition*, not an endorsement: each {before,after}
// must already be proven by a future trusted verifier. The projection cannot
// turn client-authored evidence into proof. Missing endpoints stay unresolved.
// A verified predecessor of the same question proves only "review"; absence
// of one never proves "first", since other offline devices may have history.
export function projectSyntheticCausalOrder(input) {
 if(!exact(input,['version','owner','events','verifiedEdges'])||input.version!==VERSION||
    !owner(input.owner)||!Array.isArray(input.events)||input.events.length>10000||
    !Array.isArray(input.verifiedEdges)||input.verifiedEdges.length>50000)throw invalid();
 const events=new Map();
 for(const event of input.events){
  if(!exact(event,['id','owner','qid'])||!uuid(event.id)||event.owner!==input.owner||
     typeof event.qid!=='string'||event.qid.length===0||event.qid.length>256||/[\x00-\x1f\x7f]/.test(event.qid))throw invalid();
  const prior=events.get(event.id);
  if(prior&&prior.qid!==event.qid)throw invalid();
  if(!prior)events.set(event.id,{id:event.id,qid:event.qid});
 }
 const outgoing=new Map([...events.keys()].map(id=>[id,[]]));
 const indegree=new Map([...events.keys()].map(id=>[id,0]));
 const priorKnown=new Set(),seen=new Set();
 for(const edge of input.verifiedEdges){
  if(!exact(edge,['before','after'])||!uuid(edge.before)||!uuid(edge.after)||edge.before===edge.after)throw invalid();
  const key=edge.before+'\0'+edge.after;if(seen.has(key))continue;seen.add(key);
  const before=events.get(edge.before),after=events.get(edge.after);
  if(!before||!after)continue;
  if(before.qid!==after.qid)throw invalid();
  outgoing.get(before.id).push(after.id);
  indegree.set(after.id,indegree.get(after.id)+1);
  priorKnown.add(after.id);
 }
 // Reject contradictions instead of inventing an ordering. Iterative traversal
 // avoids stack exhaustion even for the largest accepted synthetic input.
 const queue=[];for(const [id,count] of indegree)if(count===0)queue.push(id);
 let visited=0;for(let i=0;i<queue.length;i++){
  visited++;for(const next of outgoing.get(queue[i])){const count=indegree.get(next)-1;indegree.set(next,count);if(count===0)queue.push(next);}
 }
 if(visited!==events.size)throw invalid();
 return {version:VERSION,owner:input.owner,labels:[...events.keys()].sort().map(id=>({id,status:priorKnown.has(id)?'review':'unknown'}))};
}
