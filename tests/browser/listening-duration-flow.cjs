// Real silent PCM media in disposable contexts; browser clocks do not prove endurance or hearing.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

function longSilence(seconds) {
  const samples=seconds*8000, bytes=Buffer.alloc(44+samples,128);
  bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
  bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(8000,28);
  bytes.writeUInt16LE(1,32);bytes.writeUInt16LE(8,34);bytes.write('data',36);bytes.writeUInt32LE(samples,40);
  return bytes;
}
module.exports=async function durationFlow({getPage,step,click,importViaUI,preflight,idle,enter,currentAttempt,
  screenshot,state,freshContext,newPage,eventually,visible,output,basePackage}) {
  const durationMs=2753000, longPackage=structuredClone(basePackage);
  longPackage.id='browser-qa-declared-duration';longPackage.title='整轨计时合成验证 · 非真实试卷';
  longPackage.listeningDurationMs=durationMs;
  longPackage.assets.find(a=>a.mime==='audio/wav').base64=longSilence(durationMs/1000).toString('base64');
  const legacy=structuredClone(longPackage);legacy.id='browser-qa-legacy-long';legacy.title='旧包超长合成验证 · 非真实试卷';delete legacy.listeningDurationMs;
  const mismatch=structuredClone(basePackage);mismatch.id='browser-qa-duration-mismatch';mismatch.title='时长不符合成验证 · 非真实试卷';mismatch.listeningDurationMs=durationMs;
  const files={};
  for(const [name,exam] of Object.entries({long:longPackage,legacy,mismatch})) {
    files[name]=path.join(output,`qa-duration-${name}.json`);await fs.writeFile(files[name],JSON.stringify(exam),{flag:'wx'});
  }
  await step('real media mismatch and overlong legacy audio prevent new attempts',async()=>{
    for(const [name,exam,seconds] of [['mismatch',mismatch,20],['legacy',legacy,durationMs/1000]]) {
      await freshContext();await newPage();await enter();await importViaUI('导入题包 JSON',files[name]);
      const page=getPage(),card=page.locator('.mock-catalog article').filter({has:page.getByRole('heading',{name:exam.title,exact:true})});
      await card.getByRole('button',{name:'音频预检与新考试',exact:true}).click();
      const audio=page.locator('.mock-audio audio');
      await eventually(()=>audio.evaluate((a,expected)=>a.readyState>=1 && a.duration===expected && !a.error,seconds),'Mismatched media metadata did not decode');
      await visible(page.locator('.mock-audio').getByRole('alert'));
      assert.match(await page.locator('.mock-audio').getByRole('alert').innerText(),/时长.*不符|超过旧题包/);
      await page.getByRole('checkbox').check();
      const box=await audio.boundingBox();assert.ok(box);await audio.click({position:{x:25,y:box.height/2}});
      await eventually(()=>audio.evaluate(a=>a.paused),'Mismatched audio was not stopped');
      assert.equal(await page.getByRole('button',{name:'开始新考试 · 立即计时',exact:true}).isDisabled(),true);
      assert.equal((await state()).attempts.length,0);
      await screenshot(`duration-${name}-blocked`);
    }
    return {mismatchSeconds:20,declaredSeconds:2753,overlongLegacySeconds:2753,attempts:0};
  });
  let initial;
  await step('declared full-track duration starts with exact immutable LC and RC deadlines',async()=>{
    await freshContext();await newPage();await enter();await importViaUI('导入题包 JSON',files.long);
    await preflight(longPackage.title,true,durationMs/1000);await click('开始新考试 · 立即计时');
    initial=(await currentAttempt(a=>a.status==='listening')).attempt;
    assert.equal(initial.listeningDeadline-initial.startedAt,durationMs);
    assert.equal(initial.readingDeadline-initial.listeningDeadline,75*60000);
    const page=getPage();await eventually(()=>page.locator('.mock-audio audio').evaluate(a=>!a.paused && a.currentTime>0),'Declared audio did not start');
    return {declaredMs:durationMs,listeningMs:initial.listeningDeadline-initial.startedAt,readingMs:4500000};
  });
  await step('45-minute boundary stays in listening and cold page keeps declared deadlines',async()=>{
    let page=getPage();await page.clock.fastForward(initial.startedAt+2701000-await page.evaluate(()=>Date.now()));
    await visible(page.getByText('听力 LC',{exact:true}));
    assert.equal((await currentAttempt(a=>a.id===initial.id)).attempt.status,'listening');
    const beforeCold=await page.locator('.mock-audio audio').evaluate(a=>({time:a.currentTime,paused:a.paused}));
    assert.equal(beforeCold.paused,false,'Audio stopped at the old 45-minute boundary');
    await eventually(()=>page.locator('.mock-audio audio').evaluate((a,time)=>!a.paused && a.currentTime>time+0.05,beforeCold.time),'Audio did not advance beyond the old deadline');
    const after=new Date(await page.evaluate(()=>Date.now())+1000);await page.close();await newPage(after);await enter();await click('继续考试');
    page=getPage();await visible(page.getByText('听力 LC',{exact:true}));
    const restored=(await currentAttempt(a=>a.id===initial.id)).attempt;
    assert.equal(restored.listeningDeadline,initial.listeningDeadline);assert.equal(restored.readingDeadline,initial.readingDeadline);
    await eventually(()=>page.locator('.mock-audio audio').evaluate(a=>a.readyState>=2 && a.duration===2753),'Restored long audio metadata did not load');
    const resume=page.getByRole('button',{name:'按已用时间恢复听力',exact:true});
    if(await resume.isVisible())await click('按已用时间恢复听力');
    const expected=(await page.evaluate(()=>Date.now())-initial.startedAt)/1000;
    await eventually(()=>page.locator('.mock-audio audio').evaluate((a,offset)=>!a.paused && Math.abs(a.currentTime-offset)<5,expected),'Restored audio did not align to original exam start');
    const aligned=await page.locator('.mock-audio audio').evaluate(a=>a.currentTime);
    await eventually(()=>page.locator('.mock-audio audio').evaluate((a,time)=>!a.paused && a.currentTime>time+0.05,aligned),'Restored audio did not actually progress');
    await screenshot('duration-after-45-minutes');
    return {status:restored.status,originalListeningDeadline:restored.listeningDeadline,originalReadingDeadline:restored.readingDeadline,
      playingPast45Minutes:true,coldResumeOffsetSeconds:aligned,expectedOffsetSeconds:expected};
  });
  await step('declared deadline stops LC and reading still receives the full 75 minutes',async()=>{
    const page=getPage();await page.clock.fastForward(initial.listeningDeadline-await page.evaluate(()=>Date.now())+1000);
    await visible(page.getByText('阅读 RC',{exact:true}));
    await eventually(()=>page.locator('.mock-audio audio').evaluate(a=>a.paused),'LC audio did not stop at declared deadline');
    const reading=(await currentAttempt(a=>a.id===initial.id && a.status==='reading')).attempt;
    assert.equal(reading.readingDeadline-reading.listeningDeadline,4500000);
    await page.clock.fastForward(initial.readingDeadline-await page.evaluate(()=>Date.now())+1200);await idle();
    const submitted=await currentAttempt(a=>a.id===initial.id && a.status==='submitted');
    assert.equal(submitted.attempt.submittedAt,initial.readingDeadline);assert.equal(submitted.attempt.submittedReason,'timeout');
    assert.equal(submitted.result.elapsedMs,durationMs+4500000);assert.equal(submitted.result.unanswered,200);
    await screenshot('duration-full-timeout');
    return {reason:'timeout',elapsedMs:submitted.result.elapsedMs,unanswered:200};
  });
};
