'use strict';
// A synthetic transport seam for tests only. Tokens are random in-memory
// capabilities issued directly by the test harness; this is NOT real login,
// password verification, HTTP, TLS, durable sessions, or production auth.
const {randomUUID}=require('node:crypto');
const {SnapshotServer}=require('./synthetic-sync-snapshot.cjs');
class SyntheticTransport {
 constructor(){this.server=new SnapshotServer();this.tokens=new Map();}
 issueTestSession(owner){const t=randomUUID();this.tokens.set(t,owner);return t;}
 revoke(t){this.tokens.delete(t);}
 owner(t){const owner=this.tokens.get(t);if(!owner)throw Error('unauthenticated');return owner;}
 append(t,claimedOwner,events){const owner=this.owner(t);if(claimedOwner!==owner)throw Error('session owner mismatch');this.server.append(owner,events);return {ok:true,owner,id:events[0].id};}
 begin(t,pageSize){return this.server.start(this.owner(t),pageSize);}
 page(t,id,cursor){return this.server.page(this.owner(t),id,cursor);}
 close(){this.server.close();}
}
module.exports={SyntheticTransport};
