'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {environment}=require('./helpers/short-word-audio-harness.cjs');
// Exact numeric event traces are standalone regression vectors, not a private
// log dependency. They are Media-clock proofs, not audio-hearing/ArkWeb proof.
const firstH4={points:[[264.6,.704203],[530.2,.96649]],endAt:567.8,playingAt:10};
const replayH4={points:[[251.9,.615127],[516.3,.875648]],endAt:643.6,playingAt:4.5};
function check(id,options={},expected='reject'){
 test(id,async()=>{const e=environment(options);try{if(options.priorCheckpoint!==undefined)e.player.seek(options.priorCheckpoint);await e.trace(options);
  if(expected==='accept'){assert.equal(e.errors,0);assert.equal(e.confirmed,1);if(!options.reentry)assert.equal(e.player.completed(),true);assert.equal(e.player.position(),.975);assert(e.completions.includes(true),'Completed must be visible inside changed(false) before reentrant UI action');}
  else{assert.equal(e.confirmed,0);assert.equal(e.player.completed(),false);if(options.trueEnded!==false)assert.equal(e.errors,1);if(options.priorCheckpoint!==undefined)assert.equal(e.player.position(),options.priorCheckpoint);}
 }finally{e.dispose();}});
}
check('negative control: removing the short-start proof rejects the original offset trace',{regression:'without-offset-proof'});
check('negative control: prior final-50ms predicate rejects exact H4 replay',{...replayH4,regression:'old-final-50ms'});
check('H4 first trace accepts pause before ended',firstH4,'accept');
check('H4 first trace accepts ended before pause',{...firstH4,order:'ended-first'},'accept');
check('H4 replay trace accepts pause before ended',replayH4,'accept');
check('H4 replay trace accepts ended before pause',{...replayH4,order:'ended-first'},'accept');
check('H4 replay completed is visible inside changed(false) before reentrant stop',{...replayH4,reentry:true},'accept');
test('H4 first then replay keeps both exact traces and creates a fresh media lease at zero each time',async()=>{const e=environment();try{await e.trace(firstH4);assert(e.player.completed());await e.trace(replayH4);assert.equal(e.errors,0);assert.equal(e.confirmed,2);assert.equal(e.player.completed(),true);assert.deepEqual(e.plays.map(p=>p.target),[0,0]);assert.deepEqual(e.plays.map(p=>p.media),[0,1]);}finally{e.dispose();}});
check('550ms fast terminal tail rejects despite sufficient overall observed tail',{...replayH4,endAt:550});
check('larger terminal media jump rejects without sufficient last-gap time',{...replayH4,points:[[251.9,.615127],[516.3,.8]]});
check('zero time after the last real update cannot prove the natural tail',{...replayH4,endAt:516.3});
check('terminal media time moving backward cannot complete',{...replayH4,points:[[251.9,.615127],[516.3,.98]]});
check('terminal last update older than 500ms cannot complete',{...replayH4,endAt:1040});
check('original offset trace accepts pause before ended',{},'accept');
check('original offset trace accepts ended before pause',{order:'ended-first'},'accept');
check('original offset completion is visible inside changed(false) before reentry',{reentry:true},'accept');
test('natural completion followed by explicit replay uses fresh zero starts',async()=>{const e=environment();try{await e.trace();assert(e.player.completed());await e.trace();assert.equal(e.errors,0);assert.equal(e.confirmed,2);assert.equal(e.player.completed(),true);assert.deepEqual(e.plays.map(p=>p.target),[0,0]);assert.deepEqual(e.plays.map(p=>p.media),[0,1]);}finally{e.dispose();}});
check('one real timeupdate cannot prove the short ending',{points:[[258.1,.68846]]});
check('same-millisecond second update burst cannot prove elapsed playback',{points:[[258.1,.68846],[258.1,.968399]]});
check('unrealistic media jump between two updates rejects',{points:[[250,.2],[500,.968399]]});
check('stationary prefix followed by fast near-end jump rejects',{points:[[100,.2],[400,.2],[523.6,.968399]]});
check('long gap resets the observation window',{points:[[80,.2],[650,.68846],[700,.968399]],endAt:740});
check('nonzero requested target cannot use zero-start proof',{target:.1});
check('selected non-1x rate cannot use zero-start proof',{rate:.85});
check('changed effective playback rate cannot use zero-start proof',{afterFirst:({m,at})=>at(300,()=>m.playbackRate=2)});
check('source replacement cannot confirm',{afterFirst:({m,at})=>at(300,()=>{m.src='https://lantern.local/synthetic-other.mp3';m.currentSrc=m.src;})});
check('seek during startup cannot confirm',{afterFirst:({m,at})=>at(300,()=>{m.seeking=true;m.emit('seeking');})});
check('waiting interruption cannot confirm',{afterFirst:({m,at})=>{at(300,()=>m.emit('waiting'));at(310,()=>m.emit('playing'));}});
check('media error cannot confirm',{afterFirst:({m,at})=>at(300,()=>{m.error={code:3};m.emit('error');})});
check('metadata shrink then restore cannot confirm',{afterFirst:({m,at})=>{at(300,()=>{m.duration=.9;m.emit('durationchange');});at(330,()=>{m.duration=.975;m.emit('durationchange');});}});
check('metadata growth then restore cannot confirm',{afterFirst:({m,at})=>{at(300,()=>{m.duration=1.1;m.emit('durationchange');});at(330,()=>{m.duration=.975;m.emit('durationchange');});}});
check('ended event without actual ended state cannot complete',{trueEnded:false});
check('failed zero replay retains the previously saved checkpoint',{points:[[258.1,.68846]],priorCheckpoint:.4});
