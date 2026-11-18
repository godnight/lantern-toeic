/** Bounded, content-free local performance entries. Unsupported engines retain
 * identical readiness and errors; instrumentation cannot release a gate. */
export function preparationMark(name:string){
 try{if(typeof performance!=='undefined'&&typeof performance.mark==='function')performance.mark('lantern:'+name);}catch{}
}
export function cooperativeTiming(start:number,end:number,waitMs:number,yields:number,status:'complete'|'failed'){
 try{if(typeof performance!=='undefined'&&typeof performance.measure==='function')performance.measure('lantern:cooperative-task',{start,end,detail:{workMs:Math.max(0,end-start-waitMs),waitMs,yields,status}});}catch{}
}
