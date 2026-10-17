/* Optional synthetic PDF end-to-end checks for tests/browser/full-exam.cjs.
 * Uses only that runner's fresh context. Never creates a browser or touches a device.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const ID = 'page-packer-qa-only';
const TITLE = 'PDF page packing QA ONLY - 非真题';
const SOURCE = Object.freeze({classification:'original', title:'Original synthetic PDF QA fixture',
  rightsStatement:'Original QA controls only. Not study material or official questions.'});
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (root, child) => {const rel=path.relative(root,child);return !!rel && !path.isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+path.sep);};

async function readFixture(fixtureDir) {
  assert.equal(typeof fixtureDir,'string','Provide the original synthetic QA fixture directory');
  const root=await fs.realpath(fixtureDir);
  async function read(relative, limit) {
    const file=await fs.realpath(path.join(root,relative));
    assert.ok(inside(root,file),'Synthetic fixture file resolved outside its directory');
    const stat=await fs.stat(file);assert.ok(stat.isFile() && stat.size>0 && stat.size<=limit,'Unexpected synthetic fixture file size');
    const bytes=await fs.readFile(file);assert.ok(bytes.length<=limit);return {file,bytes};
  }
  // Validate the fixed synthetic declaration before reading any media.
  const recipe=JSON.parse((await read('recipe.json',2*1024*1024)).bytes.toString('utf8'));
  assert.equal(recipe.kind,'lantern-exam-page-recipe');assert.equal(recipe.schemaVersion,1);
  assert.deepEqual(recipe.exam,{id:ID,version:1,title:TITLE,source:SOURCE});
  assert.deepEqual(recipe.documents,[{id:'source',file:'synthetic-pages.pdf'}]);
  assert.equal(recipe.audioFile,'synthetic-silence.wav');assert.equal(recipe.audioReviewed,true);
  assert.deepEqual(recipe.pageReview,{reviewed:true,excludedPages:[{documentId:'source',page:8}]});
  const output='packed-'+ID+'-v1';
  const json=await read(path.join(output,'exam.json'),96*1024*1024);
  const pack=JSON.parse(json.bytes.toString('utf8'));
  assert.equal(pack.kind,'lantern-toeic-exam');assert.equal(pack.schemaVersion,1);
  assert.equal(pack.id,ID);assert.equal(pack.version,1);assert.equal(pack.title,TITLE);assert.deepEqual(pack.source,SOURCE);
  assert.equal(pack.questions.length,200);assert.equal(recipe.answers.length,200);
  const mapping=JSON.parse((await read(path.join(output,'mapping-report.json'),4*1024*1024)).bytes.toString('utf8'));
  assert.equal(mapping.kind,'lantern-exam-page-mapping-report');assert.equal(mapping.schemaVersion,1);
  assert.equal(mapping.examId,ID);assert.equal(mapping.examVersion,1);assert.equal(mapping.questions,200);
  assert.equal(mapping.examSha256,sha(json.bytes));assert.equal(mapping.examBytes,json.bytes.length);
  const pdf=await read('synthetic-pages.pdf',16*1024*1024), wav=await read('synthetic-silence.wav',1024*1024);
  assert.equal(pdf.bytes.subarray(0,5).toString(),'%PDF-');assert.equal(mapping.documents.length,1);
  assert.equal(mapping.documents[0].sha256,sha(pdf.bytes));assert.equal(mapping.documents[0].pages,8);
  assert.deepEqual(mapping.excludedPages,[{documentId:'source',page:8,pdfSha256:sha(pdf.bytes)}]);
  assert.deepEqual(mapping.pages.map(p=>p.page).sort((a,b)=>a-b),[1,2,3,4,5,6,7]);
  const assets=new Map(pack.assets.map(a=>[a.id,a]));assert.equal(assets.size,8);
  const pages=new Map();
  for(const entry of mapping.pages) {
    const asset=assets.get(entry.assetId);assert.ok(asset);assert.equal(asset.mime,'image/jpeg');
    const bytes=Buffer.from(asset.base64,'base64');assert.equal(bytes[0],255);assert.equal(bytes[1],216);
    assert.equal(sha(bytes),entry.sha256);assert.equal(bytes.length,entry.bytes);
    assert.equal(entry.pdfSha256,sha(pdf.bytes));assert.equal(entry.section,entry.page<=2?'LC':'RC');
    assert.ok(entry.width>1000 && entry.height>1000,'Full-page QA must retain enough pixels to exercise both scroll axes');
    pages.set(entry.page,entry);
  }
  const audio=assets.get(pack.listeningAudioId);assert.ok(audio);assert.equal(audio.mime,'audio/wav');
  assert.equal(sha(Buffer.from(audio.base64,'base64')),sha(wav.bytes));assert.equal(mapping.audio.sha256,sha(wav.bytes));
  assert.equal(pack.groups.length,recipe.groups.length);
  for(const group of pack.groups) {
    const declared=recipe.groups.find(g=>g.id===group.id);assert.ok(declared);
    assert.equal(group.part,declared.part);assert.deepEqual(group.questionNumbers,declared.questionNumbers);
    assert.deepEqual(group.passages,Array(declared.passageCount).fill(''));
    assert.deepEqual(group.imageIds,declared.pages.map(ref=>{assert.equal(ref.documentId,'source');return pages.get(ref.page)?.assetId;}));
  }
  for(const [index,question] of pack.questions.entries()) {
    assert.equal(question.number,index+1);assert.equal(question.answer,'ABCD'.indexOf(recipe.answers[index]));
    assert.equal(question.choices.length,question.part===2?3:4);
  }
  return {file:json.file,pack,mapping,pages,sha256:sha(json.bytes)};
}

async function eventually(check, message) {
  const until=Date.now()+15000;let last;
  do {try {const result=await check();if(result)return result;}catch(error){last=error;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()<until);
  throw new Error(message+(last?': '+last.message:''));
}

module.exports = async function pagePackFlow({page,step,click,importViaUI,preflight,idle,enter,currentAttempt,screenshot,layout,resultSummary,fixtureDir}) {
  assert.equal(new URL(page.url()).origin,'http://127.0.0.1:4175','Only the owned full-exam QA preview may run this module');
  let fixture,attemptId;
  const activeArticle=number=>page.getByRole('article',{name:`第 ${number} 题`,exact:true});
  async function select(number) {
    const details=page.locator('.mock-answer-card details');
    if(await details.getAttribute('open')===null)await details.locator('summary').click();
    await page.getByRole('button',{name:new RegExp(`^第 ${number} 题，(?:已保存|未答)$`)}).click();
    await activeArticle(number).waitFor({state:'visible'});await idle();
  }
  async function images(number, expectedPages) {
    const article=activeArticle(number);await article.waitFor({state:'visible'});
    const expected=expectedPages.map(n=>fixture.pages.get(n));assert.ok(expected.every(Boolean));
    await eventually(async()=>{
      const imgs=article.locator('.mock-scan img');
      return await imgs.count()===expected.length && await imgs.evaluateAll(rows=>rows.every(img=>img.complete && img.naturalWidth>0));
    },'Rendered question images did not decode');
    const actual=await article.locator('.mock-scan img').evaluateAll(async rows=>Promise.all(rows.map(async img=>{
      if(!img.currentSrc.startsWith('blob:'))throw new Error('Expected an imported local Blob image');
      const response=await fetch(img.currentSrc);if(!response.ok)throw new Error('Displayed Blob was not readable');
      const bytes=await response.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),rect=img.getBoundingClientRect();
      return {sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),
        width:img.naturalWidth,height:img.naturalHeight,displayWidth:rect.width,displayHeight:rect.height};
    })));
    assert.equal(actual.length,expected.length);
    for(let i=0;i<actual.length;i++) {
      assert.equal(actual[i].sha256,expected[i].sha256);assert.equal(actual[i].width,expected[i].width);assert.equal(actual[i].height,expected[i].height);
      assert.ok(actual[i].displayWidth>0 && actual[i].displayHeight>0);
      assert.ok(Math.abs(actual[i].displayHeight-actual[i].displayWidth*actual[i].height/actual[i].width)<2,'Full-page image aspect ratio changed');
    }
    assert.equal(await page.locator('.mock-explanation').count(),0,'Review answers appeared before submission');
    return {question:number,pages:expectedPages,images:actual};
  }
  async function answerCorrect(number) {
    const choice=fixture.pack.questions[number-1].answer,radio=activeArticle(number).getByRole('radio').nth(choice);
    await radio.click();await idle();await currentAttempt(a=>a.id===attemptId && a.answers[number]?.choice===choice);
    await eventually(()=>radio.isChecked(),'Saved QA choice did not render');
  }
  async function magnify(number,index,width,label) {
    await page.setViewportSize({width,height:844});
    await activeArticle(number).getByRole('button',{name:`放大本组材料图片 ${index+1}`,exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor({state:'visible'});
    const scroller=dialog.locator('.mock-image-scroll'),img=scroller.locator('img');
    await eventually(()=>img.evaluate(el=>el.complete && el.naturalWidth>0),'Magnified image did not decode');
    const dimensions=await scroller.evaluate(el=>({width:el.clientWidth,height:el.clientHeight,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight}));
    assert.ok(dimensions.scrollWidth>dimensions.width+20 && dimensions.scrollHeight>dimensions.height+20,'Real full-page image must exercise both scroll axes');
    const corners=[];
    for(const [name,right,bottom] of [['tl',false,false],['tr',true,false],['bl',false,true],['br',true,true]]) {
      const corner=await scroller.evaluate((el,{right,bottom})=>{
        el.scrollLeft=right?el.scrollWidth:0;el.scrollTop=bottom?el.scrollHeight:0;
        const child=el.querySelector('img'),r=el.getBoundingClientRect(),image=child.getBoundingClientRect();
        return {x:el.scrollLeft,y:el.scrollTop,maxX:el.scrollWidth-el.clientWidth,maxY:el.scrollHeight-el.clientHeight,
          edgeDeltaX:right?image.right-(r.left+el.clientLeft+el.clientWidth):image.left-(r.left+el.clientLeft),
          edgeDeltaY:bottom?image.bottom-(r.top+el.clientTop+el.clientHeight):image.top-(r.top+el.clientTop)};
      },{right,bottom});
      assert.ok(Math.abs(corner.x-(right?corner.maxX:0))<=1 && Math.abs(corner.y-(bottom?corner.maxY:0))<=1,'Image corner cannot be scrolled into view');
      assert.ok(Math.abs(corner.edgeDeltaX)<=2 && Math.abs(corner.edgeDeltaY)<=2,'Image edge is cropped inside its scroll area');
      await screenshot(`page-pack-${label}-${width}-${name}`);corners.push({name,...corner});
    }
    // Close via the dialog's visible native control; no DOM removal or synthetic events.
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});
    await activeArticle(number).waitFor({state:'visible'});return {width,...dimensions,corners};
  }

  await step('PDF page pack: original synthetic JPEG/WAV package imported and decoded',async()=>{
    fixture=await readFixture(fixtureDir);
    if(await page.getByRole('button',{name:'返回学习',exact:true}).count())await click('返回学习');
    await enter();assert.equal(await page.getByRole('heading',{name:TITLE,exact:true}).count(),0,'Synthetic page package already exists; use a fresh QA context');
    await importViaUI('导入题包 JSON',fixture.file);await page.getByRole('heading',{name:TITLE,exact:true}).waitFor({state:'visible'});
    const media=await preflight(TITLE);
    return {id:ID,questions:200,renderedPages:7,excludedAnswerPage:8,examSha256:fixture.sha256,media,
      limitation:'Original controls and 20-second silence only; no real exam, hearing or device acceptance claimed'};
  });
  await step('PDF page pack: listening shows exact LC images and hides RC question images',async()=>{
    await click('开始新考试 · 立即计时');await page.getByText('听力 LC',{exact:true}).waitFor({state:'visible'});
    const row=await currentAttempt(a=>a.examId===ID && a.status==='listening');attemptId=row.attempt.id;
    assert.equal(row.attempt.ordinal,1);assert.deepEqual(row.attempt.answers,{});
    const first=await images(1,[1]);await answerCorrect(1);await select(32);const conversation=await images(32,[2]);
    assert.equal(await page.getByRole('button',{name:/^第 (?:101|131|147|176|186) 题，/}).count(),0);
    assert.equal(await page.locator('.mock-paper .mock-scan img').count(),1);
    await screenshot('page-pack-listening');
    return {first,conversation,rcImagesDisplayed:false,scope:'Displayed question images only; preloading/decoding RC assets is allowed'};
  });
  await step('PDF page pack: 320/390 layouts preserve pages and all magnified corners are reachable',async()=>{
    const layouts=await layout('page-pack-listening'),zoom=[];
    for(const width of [320,390])zoom.push(await magnify(32,0,width,'lc-page-2'));
    await page.setViewportSize({width:390,height:844});return {layouts,zoom,
      limitation:'Checks DOM scroll reachability and saves four-corner screenshots; it does not certify OCR readability or touch hardware'};
  });
  await step('PDF page pack: deadline locks LC, maps reading groups and grades two known answers',async()=>{
    const before=(await currentAttempt(a=>a.id===attemptId)).attempt;
    const delta=before.listeningDeadline-await page.evaluate(()=>Date.now())+1200;assert.ok(delta>0);
    await page.clock.fastForward(delta);await page.getByText('阅读 RC',{exact:true}).waitFor({state:'visible'});
    await currentAttempt(a=>a.id===attemptId && a.status==='reading');
    const mappings=[];
    for(const [number,expectedPages,passageCount] of [[101,[3],0],[131,[4],1],[147,[5,7],1],[176,[6],2],[186,[6],3]]) {
      await select(number);const q=fixture.pack.questions[number-1],group=fixture.pack.groups.find(g=>g.id===q.groupId);
      assert.deepEqual(group.passages,Array(passageCount).fill(''));
      assert.equal(await activeArticle(number).locator('.mock-passage').count(),0,'Scan-only placeholders must not become fake passage text');
      mappings.push({...await images(number,expectedPages),passageCount});
      if(number===101)await answerCorrect(101);
      if(number===147) {
        await screenshot('page-pack-single-passage-two-pages');
        await magnify(147,1,320,'rc-continuation-page-7');await page.setViewportSize({width:390,height:844});
      }
    }
    assert.equal(await page.getByRole('button',{name:/^第 (?:1|32) 题，/}).count(),0,'LC answer card must remain locked');
    await click('提交整卷');await page.getByRole('dialog').waitFor({state:'visible'});await click('确认交卷');
    await resultSummary(2,198);
    await page.getByRole('region',{name:'交卷后解析',exact:true}).waitFor({state:'visible'});
    const submitted=await currentAttempt(a=>a.id===attemptId && a.status==='submitted');
    assert.equal(submitted.attempt.submittedReason,'manual');assert.equal(submitted.result.correct,2);assert.equal(submitted.result.unanswered,198);
    assert.equal(submitted.result.listeningCorrect,1);assert.equal(submitted.result.readingCorrect,1);assert.equal(submitted.result.firstAttempt,true);
    assert.deepEqual(Object.keys(submitted.attempt.answers).sort(),['1','101']);
    assert.equal(submitted.result.parts.length,7);assert.equal(submitted.result.parts[0].correct,1);assert.equal(submitted.result.parts[4].correct,1);
    await screenshot('page-pack-submitted');
    return {mappings,correct:2,unanswered:198,firstAttempt:true,lcLocked:true,reviewAfterDurableSubmission:true};
  });
};
// Read-only validation hook for targeted fixture verification, without launching a browser.
module.exports.readSyntheticFixture=readFixture;
