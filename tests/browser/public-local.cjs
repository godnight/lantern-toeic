'use strict';
const assert=require('node:assert/strict'),h=require('./public-local-harness.cjs');
const {step,eventually,snapshot,report,fs,path,RUN}=h;
let page;
async function preferences(){await page.getByRole('button',{name:'设置我的目标',exact:true}).click();return page.getByRole('dialog',{name:'设定你的下一程'});}
async function settings(){await page.getByRole('button',{name:'外观与偏好',exact:true}).first().click();await page.getByRole('heading',{name:'学习与设备',exact:true}).waitFor();}
async function scenario(width,theme){
 const prefix=(process.env.PUBLIC_LOCAL_MODE||'native')+'-'+theme+'-'+width;
 await h.fresh(width,'paper',width===320?2:3,{clean:true});page=h.page;
 await step(prefix+' clean visitor can skip setup and answer without false history or account API',async()=>{
  const notice=page.getByRole('region',{name:'首次学习'});await notice.waitFor();const text=await page.locator('body').innerText();assert.ok(!text.includes('2026-12-20'));assert.match(text,/尚未确认/);assert.equal(await page.getByRole('button',{name:'先试一组',exact:true}).isEnabled(),true);
  const setup=await page.evaluate(()=>JSON.parse(localStorage.getItem('lantern-v1-device:setup')));assert.equal(setup.timezone,'America/New_York');assert.equal(setup.state,'suggested');
  await snapshot(prefix+'-first-visit');await page.getByRole('button',{name:'先试一组',exact:true}).click();const dialog=page.locator('.practice-dialog');await dialog.getByRole('radio').first().click();await dialog.getByRole('button',{name:'确认答案',exact:true}).click();await dialog.locator('.answer-feedback').waitFor();await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'保存并返回',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'先试一组',exact:true}).waitFor();assert.equal((await h.readState()).local['lantern-v1-device:setup'].state,'skipped');assert.equal(h.studyFacts(await h.readState()).attempts.length,1);assert.equal(h.studyFacts(await h.readState()).checkins.length,0);
 });
 await step(prefix+' explicit preferences preserve editable zone and allow empty exam date',async()=>{
  const dialog=await preferences();assert.equal(await dialog.locator('input[type=date]').inputValue(),'');assert.equal(await dialog.getByLabel('口语目标（0表示暂不设置）').inputValue(),'0');assert.equal(await dialog.getByLabel('学习时区',{exact:true}).inputValue(),'America/New_York');
  await dialog.getByLabel('学习时区',{exact:true}).fill('bad/timezone');await dialog.getByRole('button',{name:'保存目标',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'有效的 IANA'}).waitFor();assert.equal((await h.readState()).local['lantern-v1-device:setup'].state,'skipped');
  await dialog.getByLabel('学习时区',{exact:true}).fill('Asia/Tokyo');await snapshot(prefix+'-preferences');await dialog.getByRole('button',{name:'保存目标',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await h.readState()).local['lantern-v1-device:setup'].state,'confirmed');
  await settings();if(theme==='hollow')await page.getByRole('button',{name:/空洞骑士/}).first().click();
 });
 await step(prefix+' account is discoverable and phone, deletion, migration remain honestly unavailable',async()=>{
  await page.getByRole('button',{name:'查看账号与数据',exact:true}).click();await page.getByRole('heading',{name:'手机号登录',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'发送验证码（尚未开通）',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'迁移至账号（契约与服务未就绪）',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'删除云数据（未开放）',exact:true}).isDisabled(),true);assert.equal(await page.locator('input[type=tel]').count(),0);await snapshot(prefix+'-account');
 });
 await step(prefix+' save matrix, sources and backup scopes are reachable on a phone',async()=>{
  await page.getByRole('button',{name:'查看保存与同步',exact:true}).click();await page.getByRole('heading',{name:'保存与同步',exact:true,level:1}).waitFor();assert.match(await page.locator('.domain-status-list').innerText(),/计划、候选与训练草稿/);assert.equal(await page.getByRole('button',{name:'重试学习域同步',exact:true}).isDisabled(),true);await snapshot(prefix+'-save');
  await page.getByRole('button',{name:'分别备份',exact:true}).click();await page.getByRole('heading',{name:'计划与未完成练习',exact:true}).waitFor();assert.match(await page.locator('.workspace-backups').innerText(),/听写草稿、核对、步骤、句位/);
  await settings();await page.locator('.workspace-settings-row').filter({hasText:'关于微光'}).getByRole('button',{name:'查看',exact:true}).click();await page.getByRole('heading',{name:'参与与勘误',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'贡献说明',exact:true}).getAttribute('href'),'/project-information/CONTRIBUTING.txt');assert.match(await page.locator('.workspace-sources').innerText(),/公共分发待核/);await snapshot(prefix+'-sources');
 });
}
(async()=>{try{
 await h.prepare();for(const width of [320,430])for(const theme of ['paper','hollow'])await scenario(width,theme);
 await step('no page, console, HTTP or external-request errors',async()=>{for(const key of ['pageErrors','consoleErrors','httpErrors','blockedExternal'])assert.deepEqual(report[key],[]);});
}catch(error){report.error=String(error.stack||error);process.exitCode=1;}finally{
 report.sourceAfter=await h.manifest().catch(()=>null);report.sourceChangedDuringRun=report.sourceBefore?.sha256!==report.sourceAfter?.sha256;await h.cleanup();report.finishedAt=new Date().toISOString();report.passed=report.steps.filter(step=>step.status==='passed').length;report.total=report.steps.length;await fs.writeFile(path.join(RUN,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:path.join(RUN,'report.json'),passed:report.passed,total:report.total,error:report.error}));if(report.sourceChangedDuringRun)process.exitCode=1;
}})();
