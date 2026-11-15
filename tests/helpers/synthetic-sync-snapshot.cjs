'use strict';
// EXPERIMENT ONLY: no network, no real data, not a production security boundary.
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');

class SnapshotServer {
 constructor(){
  this.db=new DatabaseSync(':memory:');this.sessions=new Map();
  this.db.exec('CREATE TABLE events (revision INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(owner,id))');
 }
 append(owner,events){
  if(!owner || !Array.isArray(events)) throw Error('invalid input');
  this.db.exec('BEGIN IMMEDIATE');
  try {
   for(const e of events){
    if(!e || typeof e.id!=='string' || !e.id)throw Error('invalid event');
    const value=JSON.stringify(e), old=this.db.prepare('SELECT payload FROM events WHERE owner=? AND id=?').get(owner,e.id);
    if(old && old.payload!==value)throw Error('same id has conflicting content');
    if(!old)this.db.prepare('INSERT INTO events(owner,id,payload) VALUES(?,?,?)').run(owner,e.id,value);
   }
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 // Sessions freeze a high-water mark. Inserts after this point are delivered
 // in the NEXT round. Token/cursor security and session expiry are NOT solved.
 start(owner,pageSize=2){
  if(!owner || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100)throw Error('invalid input');
  const upper=this.db.prepare('SELECT COALESCE(MAX(revision),0) AS n FROM events WHERE owner=?').get(owner).n;
  const id=randomUUID();this.sessions.set(id,{owner,upper,pageSize,cursors:new Map([['start',0]])});return {id,owner,upper,cursor:'start'};
 }
 page(owner,id,cursor){
  const session=this.sessions.get(id);
  if(!session || session.owner!==owner || !session.cursors.has(cursor))throw Error('invalid snapshot or cursor');
  const after=session.cursors.get(cursor);
  const rows=this.db.prepare('SELECT revision,payload FROM events WHERE owner=? AND revision>? AND revision<=? ORDER BY revision LIMIT ?').all(owner,after,session.upper,session.pageSize+1);
  const more=rows.length>session.pageSize, selected=rows.slice(0,session.pageSize);
  let next=null;
  if(more){const revision=selected.at(-1).revision;next=`cursor:${revision}`;session.cursors.set(next,revision);}
  return {owner,id,upper:session.upper,cursor,events:selected.map(r=>JSON.parse(r.payload)),next};
 }
 close(){this.db.close();}
}

// Pure in-memory client. Page input must be received over an authenticated
// transport in a real implementation. Every page returns a fresh projection;
// input is untouched on errors. Durable atomic commits are NOT implemented.
function consume(state,page,project,lease){
 if(page.owner!==state.owner || page.id!==state.snapshot || page.upper!==state.upper || page.cursor!==state.cursor || state.complete)throw Error('stale or wrong snapshot page');
 const merged=project({version:1,owner:state.owner,stateVersion:state.version,events:state.events},{version:1,owner:state.owner,events:page.events},{owner:state.owner,stateVersion:state.version},lease);
 return {...state,version:merged.stateVersion,events:JSON.parse(JSON.stringify(merged.events)),unresolved:[...merged.unresolvedCorrectionIds],cursor:page.next,complete:page.next===null};
}

module.exports={SnapshotServer,consume};
