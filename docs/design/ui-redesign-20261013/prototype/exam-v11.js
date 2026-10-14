/* v1.1 F02 — isolated, original layout fixtures only.
 * Source contract: app/learn/mock-exam.tsx, app/learn/practice.tsx,
 * lib/exam-model.ts, lib/exam-ui.ts. No media, deadlines, APIs or storage run.
 * Load after the host's window.designExtras render support and design.js.
 */
(() => {
  'use strict';
  const extras = window.designExtras = window.designExtras || {};
  const partNames = ['照片描述','应答问题','简短对话','简短独白','短句填空','长文填空','阅读理解'];
  const currentCounts = [6,25,39,30,30,16,54];
  const legacyCounts = [10,30,30,30,40,12,48];
  let chosenPackage = params.get('format') === 'legacy-2006' ? 'legacy' : 'current';
  let examChoice = 'B';
  let examPhotoChoice = params.get('state')==='listening-save-error'?'C':'';
  let photoSaved = false;
  let readingSaved = false;
  let readingPending = true;
  let readingKind = params.get('state')==='reading-single'?'single':'multi';
  let storedReadingChoice = '';
  let submittedSnapshot = null;
  function freezeSubmittedSnapshot() {
    const identity=packageInfo(),answers={};
    if(readingSaved&&storedReadingChoice)answers[readingNumber()]=storedReadingChoice;
    if(photoSaved&&examPhotoChoice)answers[3]=examPhotoChoice;
    submittedSnapshot=Object.freeze({
      identity:Object.freeze({...identity,counts:Object.freeze([...identity.counts])}),
      readingNumber:readingNumber(),readingKind,answers:Object.freeze({...answers}),
      clocks:Object.freeze({...clocks()})
    });
  }
  const readingNumber=()=>chosenPackage==='legacy'?readingKind==='single'?154:183:readingKind==='single'?148:178;
  let examQuestion = 178;
  let materialTab = 0;
  let dictationText = '';
  let mediaReturnState = 'listen';
  let examReturnState = 'reading-multi';
  let practicePlaying = false;
  let heardFixture = false;
  let chosenOrdinal = 1;
  let resultReturnState = 'default';
  let practiceKind = 'listen';
  let modalOriginAction = 'exit';
  const esc = escapeHTML;
  const actionButton = (label, action, primary=false, extra='') => btn(label,null,primary,`data-exam-action="${action}" ${extra}`);
  const synthetic = '<div class="ev-fixture-label">原创合成材料 · 只用于审阅布局；不接题包、媒体或存储</div>';
  const packageInfo = () => chosenPackage === 'legacy'
    ? {id:'layout-legacy-b',name:'设计示例题包 B',version:2,label:'2006 版旧题型',format:"format: 'legacy-2006'",counts:legacyCounts,listening:'42:30',declared:'已声明 2,550,000 ms（42:30）',ordinal:'复测第 1 次',attempt:'layout-attempt-b-02'}
    : {id:'layout-current-a',name:'设计示例题包 A',version:1,label:'现行题型',format:'format: 未提供（现行）',counts:currentCounts,listening:'45:00',declared:'未声明；默认 45:00',ordinal:chosenOrdinal===1?'首次完整模考':'复测第 1 次',attempt:chosenOrdinal===1?'layout-attempt-a-01':'layout-attempt-a-02'};
  const miniIdentity = () => {const p=(['examresult','examreview'].includes(page)&&submittedSnapshot?submittedSnapshot.identity:packageInfo()),identity=page==='examsetup'?(p.ordinal==='复测第 1 次'?'将记录为第 1 次复测':'将记录为首次完整模考'):p.ordinal;return `<div class="ev-identity"><strong>${p.name} · v${p.version}</strong><span>${p.label} · ${identity} · 记录仅本机</span></div>`;};
  const clocks = () => chosenPackage==='legacy'?{lc:'09:42:30',rc:'10:57:30',lcLeft:'24:20',rcLeft:'32:36'}:{lc:'09:45:00',rc:'11:00:00',lcLeft:'26:50',rcLeft:'32:36'};
  const simulationControls = kind => `<div class="ev-demo-controls"><span>评审控件 · 只模拟保存返回，不写入数据</span><div class="buttons">${actionButton('模拟返回成功',`demo-${kind}-success`)}${actionButton('模拟返回失败',`demo-${kind}-failure`)}</div></div>`;
  const partBreakdown = counts => counts.map((n,i)=>`<li><span>Part ${i+1} · ${partNames[i]}</span><strong>${n} 题</strong></li>`).join('');

  pages.examcatalog = '模考题包与记录';
  stateOptions.examcatalog = [['default','题包目录与未交卷记录'],['empty','尚无本机题包'],['history','已交卷记录']];
  pages['practice-media'] = '练习 · 媒体与长材料';
  stateOptions['practice-media'] = [['listen','听力作答'],['photo','Part 1 题图'],['photo-submitted','Part 1 原图解析'],['listen-submitted','听力解析'],['intensive','逐句回听'],['dictation','听写输入'],['dictation-checked','听写核对'],['long','长材料阅读'],['long-submitted','长材料依据解析'],['save-error','答案保存失败'],['image-expanded','题图放大'],['exit-confirm','退出确认']];
  pages.examreview = '模考 · 原题解析';
  stateOptions.examreview = [['default','原多材料题组'],['single','原单篇长材料'],['photo','原题图与解析'],['legacy','旧制原题型'],['missing','题包未提供解析']];
  stateOptions.exam = [['default','阅读 · 多材料'],['reading-multi','阅读 · 多材料'],['reading-single','阅读 · 单篇长材料'],['listening','听力 · 完整轨与题图'],['listening-save-error','听力答案保存失败'],['audio-error','听力媒体失败恢复'],['audio-ended','音轨结束 · 截止不变'],['transition','听力截止 · 转入阅读'],['image-expanded','题图放大 · 计时可见'],['answer-card','手机答题卡'],['save-error','已选答案未保存'],['submit-confirm','漏答与未保存 · 交卷确认'],['submitting','正在交卷'],['submit-error','交卷保存失败'],['timeout','截止 · 等待保存'],['timeout-error','截止保存失败'],['exit-confirm','保存并退出确认'],['exit-saving','退出保存中'],['exit-save-error','退出中断标记保存失败']];
  stateOptions.examsetup = [['default','现行 · 尚未试听'],['ready','现行 · 可开始'],['legacy','旧制 · 声明听力时长'],['legacy-ready','旧制 · 预检通过'],['error','媒体时长不匹配'],['image-error','题图解码失败']];
  stateOptions.examresult = [['default','现行 · 七 Part 结果'],['retest','现行 · 复测身份'],['legacy','旧制 · 七 Part 结果'],['timeout','到时自动交卷'],['interrupted','有中断标记']];

  const officePicture = (large=false) => `<svg class="ev-office ${large?'large':''}" viewBox="0 0 640 360" role="img" aria-label="原创布局示意：会议室桌旁排列椅子，墙面有窗；正式页面使用当前题包原图。"><rect width="640" height="360" fill="#e1e2e0"/><path d="M0 248H640V360H0Z" fill="#b8bbb8"/><path d="M0 248L200 176H640V248Z" fill="#ccd0cc"/><rect x="305" y="30" width="290" height="130" fill="#f5f5f3" stroke="#9a9e9a" stroke-width="5"/><path d="M400 30V160M499 30V160M305 97H595" stroke="#b0b5b0" stroke-width="4"/><path d="M163 166H477L558 243H88Z" fill="#909790"/><path d="M115 243V307M526 243V307M196 170V223M451 170V223" stroke="#697469" stroke-width="11"/><g fill="#757d75" stroke="#616b61" stroke-width="5"><path d="M82 180H132V225H82ZM81 225H138V243H81Z"/><path d="M255 245H317V300H255ZM250 300H320V319H250Z"/><path d="M433 245H495V300H433ZM428 300H498V319H428Z"/></g><g stroke="#616b61" stroke-width="5"><path d="M85 243V282M133 243V282M256 318V350M313 318V350M434 318V350M491 318V350"/></g><rect x="26" y="24" width="140" height="30" rx="5" fill="#f5f5f3"/><text x="38" y="45" fill="#424a42" font-size="16">LAYOUT FIXTURE</text></svg>`;
  function imageBlock(context='exam') {
    return `<figure class="ev-image"><button class="ev-image-button" data-exam-action="${context==='practice'?'practice-image':'image'}" aria-label="放大本题图片">${officePicture()}<span class="ev-image-enlarge">放大题图 ↗</span></button><figcaption>原创示意图。正式页面显示当前题包图片；扫描图未自动转为无障碍正文。</figcaption></figure>`;
  }
  const passages = [
    {name:'材料 1 · 电子邮件',heading:'Harbor Office — furniture delivery',body:[
      'To: Facilities team\nFrom: Nina Patel\nDate: October 11\nSubject: Delivery for the third-floor meeting room',
      'The new meeting tables and chairs will arrive on Thursday, October 15. The delivery team expects to reach our building between 9:00 and 11:00 a.m. Please keep the loading entrance clear during that period.',
      'The third-floor meeting room must be empty before the team arrives. Staff who have a meeting booked that morning should use Room 204 instead. Once the furniture is installed, our facilities team will check the room and reopen it.',
      'If the delivery is delayed, I will send another message before 8:30 a.m. on Thursday. Please do not change your booking until you receive that update. Thank you for helping us complete the work with as little disruption as possible.'
    ]},
    {name:'材料 2 · 配送通知',heading:'Delivery confirmation — Harbor Office',body:[
      'Order number: HO-1048\nDelivery date: Thursday, October 15\nArrival window: 9:00–11:00 a.m.\nContact: Nina Patel',
      'Your order includes two meeting tables and twelve chairs. Assembly is included in the delivery service. The team requires approximately sixty minutes after unloading to complete installation.',
      'Please provide access to a freight elevator and ensure that someone can sign for the order. If an item is damaged, note it on the delivery form before the team leaves. Contact our service office within two business days for follow-up assistance.'
    ]},
    {name:'材料 3 · 房间安排',heading:'Room reservations — October 15',body:[
      '9:30–10:15 a.m.  Project briefing  → Room 204\n10:30–11:30 a.m.  Client workshop  → Room 204\n1:00–2:00 p.m.  Training session  → Third-floor meeting room',
      'The afternoon reservation is subject to the facilities check. Meeting organizers will receive an update if the third-floor room cannot reopen by noon. Room 204 has the same screen and conference-call equipment.'
    ]}
  ];
  function materialArticle(item,index) {return `<article class="ev-material" id="ev-material-${index}" aria-labelledby="ev-material-title-${index}"><span class="ev-material-label">${item.name}</span><h2 id="ev-material-title-${index}" lang="en">${item.heading}</h2>${item.body.map(p=>`<p lang="en">${esc(p).replace(/\n/g,'<br>')}</p>`).join('')}</article>`;}
  function materials(multi=true) {const legacy=chosenPackage==='legacy'&&page!=='practice-media',items=multi?(legacy?passages.slice(0,2):passages):[passages[0]];return `<section class="ev-materials" aria-label="题组原材料"><div class="ev-section-heading"><h2>${multi?legacy?'阅读材料 · 181–185 题':'阅读材料 · 176–180 题':legacy?'阅读材料 · 153–157 题':'阅读材料 · 147–150 题'}</h2><span>${multi?legacy?'2 份材料':'3 份材料':'1 篇长材料'}</span></div>${multi?`<nav class="ev-material-tabs" aria-label="跳至材料">${items.map((p,i)=>actionButton(`材料 ${i+1}`,`material-${i}`,false,`aria-label="跳至${p.name}"`)).join('')}</nav>`:''}${items.map(materialArticle).join('')}<div class="ev-material-end">材料结束 · 接下来作答</div></section>`;}
  function options(values,selected,locked=false,context='exam',correct='') {return `<fieldset class="ev-options"><legend class="ev-sr-only">选择本题答案</legend>${values.map((text,i)=>{const letter='ABCD'[i];return `<button type="button" class="option ${selected===letter?'active':''} ${correct===letter?'correct':''}" data-exam-action="${context}-choose-${letter}" aria-pressed="${selected===letter}" ${locked?'disabled':''}><span class="letter">${letter}</span><span lang="en">${esc(text)}</span>${correct===letter?'<span class="ev-correct-label">✓ 正确</span>':''}</button>`;}).join('')}</fieldset>`;}
  function examQuestionPanel(kind='multi',locked=false,review=false) {
    const photo=kind==='photo',multi=kind==='multi',legacy=chosenPackage==='legacy',n=photo?3:multi?legacy?183:178:legacy?154:148;
    const prompt=photo?'Look at the picture and choose the best description.':multi?'What are staff with a morning reservation asked to do?':'When will Nina contact staff if the delivery is delayed?';
    const choices=photo?['选项 A','选项 B','选项 C','选项 D']:multi?['Cancel their meetings.','Use a different meeting room.','Sign the delivery form.','Move the new furniture.']:['Before 8:30 a.m. on Thursday.','At 9:00 a.m. on Wednesday.','After the facilities check.','Within two business days.'];
    const pending=['save-error','listening-save-error'].includes(state)||(!photo&&!review&&readingPending),picked=review?submittedSnapshot?.answers[n]:photo?examPhotoChoice:examChoice,correctTarget=multi||photo?'B':'A',reviewCorrect=picked===correctTarget;
    return `<section class="ev-question panel" aria-label="第 ${n} 题"><div class="ev-section-heading"><span>Part ${photo?1:7} · 第 ${n} / 200 题</span><span>${review?'交卷后 · 只读':'当前题'}</span></div>${photo?imageBlock():''}<h1 class="question-stem" lang="en">${prompt}</h1>${options(choices,picked,locked||review,'exam',review?correctTarget:'')}${review?`<div class="analysis"><h2>${state==='missing'?'题包未提供解析':(picked===undefined?'本次未作答 / 未保存':reviewCorrect?'回答正确':'回答错误')+' · 正确答案 '+correctTarget}</h2><p>${state==='missing'?'显示正确答案与原作答；本题包没有解析正文。不会生成未经验证的解释。':photo?'示意解析：请依据当前题包提供的答案和解析核对原图。':multi?(legacy?'材料 1 的邮件写明，周四上午有预约的员工应改用 Room 204。':'材料 1 写明，周四上午有预约的员工应改用 Room 204；材料 3 保留原预约，并列出替代房间。'):'原邮件最后一段写明，若配送延迟，Nina 会在周四上午 8:30 之前发出更新。因此选择 A。'}</p></div>`:''}<div class="ev-answer-status ${pending?'pending':''}" role="status">${review?'本次答案已锁定，不可修改':pending?`○ ${picked?'已选 '+esc(picked):'清除操作'} · 待保存（尚未计入已保存题数）`:photo&&!picked?'本题未选择 · 已保存其他 '+(13+(photoSaved?1:0))+' 题':'✓ 本题答案已保存 · 本机'}</div><div class="ev-question-actions">${actionButton('上一题','previous',false,locked?'disabled':'')}${actionButton('下一题','next',false,locked?'disabled':'')}</div>${!review?actionButton('清除此题答案','clear-answer',false,`class="compact" ${locked||!picked?'disabled':''}`):''}</section>`;
  }
  function examTop(listening=false,locked=false,review=false) {
    const c=clocks();return `<div class="ev-top"><button class="quiet" data-exam-action="${review?'back-result':'exit'}">← ${review?'返回原模考结果':'保存并退出'}</button><div class="ev-clock"><span>${review?'已交卷 · 答案只读':listening?'听力 LC':'阅读 RC'}</span>${review?'':`<strong class="timer" role="timer" aria-label="${listening?'听力':'阅读'}阶段剩余时间">${locked?'00:00':listening?c.lcLeft:c.rcLeft}</strong>`}</div></div>${miniIdentity()}${review?'':`<div class="ev-deadline">原截止：${listening?c.lc:c.rc} · ${locked?'截止后不能继续作答':'离开、后台、放大图片均不暂停'}<span>演示时间固定，无实际计时</span></div>`}`;
  }
  function audioPanel(error=false,ended=false,preflight=false) {
    const p=packageInfo();return `<section class="ev-audio panel" aria-label="${preflight?'听力预检':'完整听力轨'}"><div class="ev-section-heading"><h2>${preflight?'完整听力音轨 · 预检试听':'完整听力音轨'}</h2><span>${p.listening}</span></div><div class="ev-media-status ${error?'error':''}" role="${error?'alert':'status'}"><span aria-hidden="true">${error?'!':ended?'✓':'◉'}</span><div><strong>${error?'音频当前无法播放':ended?'音轨已结束':'正在播放整场听力 · 示意'}</strong><p>${preflight?'播放成功和人耳确认是独立预检。':error?'考试计时继续；重新读取后按已用时间恢复。':ended?'音轨结束不提前结束听力，仍按原截止转入阅读。':'18:10 / '+p.listening+' · 恢复按考试已用时间对齐'}</p></div></div>${preflight?`<div class="ev-preview-controls">${actionButton('▶ 试听完整轨','hear',false)}<span>00:00 / ${p.listening}</span><input type="range" min="0" max="100" value="0" aria-label="预检试听位置，设计演示" disabled></div>`:error?`<div class="buttons">${actionButton('按已用时间恢复听力','recover-audio',true)}${actionButton('重新加载音频','reload-audio')}</div>`:''}<p class="ev-media-note">${preflight?'预检允许播放器试听。开考后从头以正常速度播放。':'开考后没有自由拖进度、暂停考试或倍速控制。恢复音频也不重置截止。'}</p></section>`;
  }
  const savedTotal=()=>146+(readingSaved?1:0);
  function answerCard(listening=false,expanded=false,locked=false) {
    const p=packageInfo(),counts=p.counts;let start=1;
    const savedPerPart=chosenPackage==='legacy'?[9,23,23,21,28,9,33]:[5,19,31,21,20,11,39];
    const savedNumbers=new Set();let firstNumber=1;counts.forEach((count,i)=>{const limit=listening?i===0?Math.min(count,5):i===1?8:0:savedPerPart[i];for(let j=0,got=0;j<count&&got<limit;j++){const n=firstNumber+j;if(listening&&n===3||!listening&&n===readingNumber())continue;savedNumbers.add(n);got++;}firstNumber+=count;});if(listening&&photoSaved)savedNumbers.add(3);if(!listening&&readingSaved)savedNumbers.add(readingNumber());
    const groups=counts.map((count,i)=>{const first=start;start+=count;if(listening?i>3:i<4)return '';return `<section class="ev-card-part"><h3>Part ${i+1} · ${count} 题</h3><div class="ev-keygrid">${Array.from({length:count},(_,j)=>{const n=first+j;const answered=savedNumbers.has(n);const pending=listening?n===3&&state==='listening-save-error':n===readingNumber()&&state==='save-error';return `<button class="${n===readingNumber()&&!listening||n===3&&listening?'active':''} ${answered&&!pending?'answered':''} ${pending?'pending':''}" data-exam-action="jump-${n}" aria-label="第 ${n} 题，${pending?'已选待保存':answered?'已保存':'未答'}" ${locked?'disabled':''}>${n}${answered&&!pending?'<span aria-hidden="true">✓</span>':''}</button>`;}).join('')}</div></section>`;}).join('');
    return `<aside class="ev-answer-card panel"><h2>答题卡</h2><p class="ev-card-count">${listening?'已保存 '+(13+(photoSaved?1:0))+' / 200':'已保存 '+savedTotal()+' / 200'}<br>${listening?'听力阶段 · 只显示 Part 1–4':'阅读阶段 · 只显示 Part 5–7'}</p><div class="ev-card-legend"><span>✓ 已保存</span><span>□ 未答</span><span>○ 待保存</span></div><details ${expanded?'open':''}><summary>题号导航 · ${listening?'1–100':'101–200'}</summary>${groups}</details>${!listening?actionButton('提交整卷','submit-open',true,locked?'disabled':''):''}<p class="ev-media-note">${listening?'阅读阶段未开放；听力按原截止自动结束。':'听力答案已锁定。交卷后本次答案不可修改。'}</p></aside>`;
  }
  const errorBanner = (title,body,button='重新读取记录',act='reload-records') => `<div class="notice error" role="alert"><strong>${title}</strong><p>${body}</p>${actionButton(button,act,false,'class="compact"')}</div>`;
  function dialog(title,body,actions,extra='') {return `<div class="ev-dialog-backdrop"><section class="ev-dialog" role="dialog" aria-modal="true" aria-labelledby="ev-dialog-title"><h2 id="ev-dialog-title">${title}</h2>${body}<div class="buttons">${actions}</div>${extra}</section></div>`;}
  function examOverlay() {
    const c=clocks(),exitListening=['listening','listening-save-error','audio-error','audio-ended'].includes(examReturnState),exitStage=exitListening?'听力':'阅读',exitLeft=exitListening?c.lcLeft:c.rcLeft,exitDeadline=exitListening?c.lc:c.rc,exitSaved=exitListening?13+(photoSaved?1:0):savedTotal(),exitChoice=exitListening?examPhotoChoice:examChoice,totalSaved=savedTotal(),missing=200-totalSaved,pendingNew=!!examChoice&&readingPending&&!readingSaved;
    if(state==='submit-confirm')return dialog('确认提交整卷？',`<p>已持久保存 <strong>${totalSaved} / 200</strong> 题。还有 <strong>${missing} 题未保存答案</strong>，按错误计。</p><dl class="ev-summary"><div><dt>尚未选择</dt><dd>${missing-(pendingNew?1:0)} 题</dd></div><div><dt>当前已选 · 待保存</dt><dd>${pendingNew?'1':'0'} 题</dd></div></dl><div class="notice warning">${readingPending?examChoice?'当前题 '+esc(examChoice)+' 变更尚未保存。'+(readingSaved?'原已保存答案保留；这项变更不重复计入漏答数量。':'先返回答题卡重试保存，才能计入本次答案。'):'当前清除操作未保存；原已保存答案保持。':'当前题答案已保存。'}交卷后不可修改；再次开始会另存复测。</div><p>阅读剩余 <strong>${c.rcLeft}</strong> · 原截止 ${c.rc}，确认期间计时继续。</p>`,actionButton('返回检查与保存','return-exam')+actionButton('仍按已保存答案交卷','submit',true));
    if(state==='submitting')return dialog('正在保存交卷…',`<p role="status">正在提交本次记录。不要把等待状态视为已交卷。</p><p>原截止 <strong>${c.rc}</strong> · 剩余 <strong>${c.rcLeft}</strong>，计时仍继续。</p><p>结果和正确答案仅在本机保存成功后显示。</p>`,actionButton('提交处理中…','noop',true,'disabled'),simulationControls('submit'));
    if(state==='exit-confirm')return dialog('保存并退出模考？',`<p>先保存中断标记，再离开本次考试。已保存 ${exitSaved} 题，${exitChoice?'当前选择 '+esc(exitChoice)+' 保留；请以持久化状态确认保存。':'当前题未选择。'}</p><p><strong>${exitStage}剩余 ${exitLeft}</strong> · 原截止 ${exitDeadline}。离开不会暂停，也不会重开计时。</p>`,actionButton('继续作答','return-exam')+actionButton('保存并退出','exit-save',true));
    if(state==='exit-saving')return dialog('正在保存退出状态…',`<p role="status">等待本机保存返回。原截止 ${exitDeadline} 保持。</p><p><strong>${exitStage}剩余 ${exitLeft}</strong>，处理期间继续计时。</p>`,actionButton('正在保存…','noop',true,'disabled'),simulationControls('exit'));
    if(state==='exit-save-error')return dialog('退出中断标记尚未保存',`<div class="notice error" role="alert"><strong>保存未完成 · 没有显示退出成功</strong><p>原已保存答案保留。当前页面选择仍在，未完成操作不能视为已保存。</p></div><p><strong>${exitStage}剩余 ${exitLeft}</strong> · 原截止 ${exitDeadline}。请重新读取记录，再决定退出。</p><p>如仍需离开，可使用现有应急出口；本次未保存选择不能保证保留，考试仍继续计时。</p>`,actionButton('留在考试','return-exam')+actionButton('重新读取并重试','retry-exit',true)+actionButton('中断标记未保存，仍退出','force-exit'));
    if(state==='image-expanded')return dialog('Part 1 · 第 3 题原图',`<div class="ev-enlarged-picture" tabindex="0" aria-label="原图区域，可横向纵向滚动">${officePicture(true)}</div><p>本机示意图 · 正式原图保持比例，支持滚动查看。扫描文字未自动转为无障碍正文。</p><p><strong>听力剩余 ${c.lcLeft}</strong> · 原截止 ${c.lc}，图片打开期间继续计时。</p>`,actionButton('关闭图片 · 返回原题','close-image',true));
    return '';
  }
  examContent = function() {
    const listening=['listening','listening-save-error','audio-error','audio-ended','image-expanded'].includes(state);
    const locked=['timeout','timeout-error'].includes(state);
    if(state==='reading-single')readingKind='single';if(['default','reading-multi','transition'].includes(state))readingKind='multi';
    const single=readingKind==='single';
    let notice='';
    if(state==='transition')notice=`<div class="notice" role="status"><strong>听力时间已到 · 已进入阅读</strong><p>Part 1–4 已锁定，不能返回修改。阅读沿用原截止 ${clocks().rc}，不从重新打开页面开始计时。</p></div>`;
    if(state==='save-error')notice=errorBanner('第 '+readingNumber()+' 题变更尚未保存',`${examChoice?'当前已选 '+esc(examChoice)+' 保留。':'清除操作尚未保存。'}已保存 ${savedTotal()} 题，未保存答案 ${200-savedTotal()} 题。${readingSaved?'原已保存答案保持；本题待保存变更不重复计入漏答数。':'当前已选答案尚未计入持久化题数。'}原材料、题号与截止保持。`,'重试保存本题','save-answer');
    if(state==='listening-save-error')notice=errorBanner('第 3 题尚未保存',`当前${examPhotoChoice?'已选 '+esc(examPhotoChoice):'清除操作'}保留。仍在听力阶段，已保存 13 题。完整音轨与原听力截止 ${clocks().lc} 保持。`,'重试保存本题','save-answer');
    if(state==='submit-error')notice=errorBanner('交卷尚未保存','仍是原考试，答案保持锁定与否以重新读取的持久化状态为准。当前画面保留选择，不展示结果或正确答案；原截止不变。','重新读取后重试交卷','retry-submit');
    if(state==='timeout')notice='<div class="notice warning" role="status"><strong>时间已到 · 正在保存自动交卷</strong><p>作答已锁定，最后点击未计入。保存成功前不显示成绩与正确答案。</p></div>';
    if(state==='timeout-error')notice=errorBanner('截止交卷尚未保存','时间已到，不能继续作答。原记录仍在；重新读取并完成本次结算，成功后才显示结果。','重新读取并重试结算','retry-timeout');
    return `<div class="ev-shell">${examTop(listening,locked)}${synthetic}${notice}${listening?audioPanel(state==='audio-error',state==='audio-ended'):''}<div class="ev-workspace ${listening?'ev-photo-workspace':''}">${listening?examQuestionPanel('photo',locked):`<div class="ev-reading-grid">${materials(!single)}${examQuestionPanel(single?'single':'multi',locked)}</div>`}${answerCard(listening,state==='answer-card',locked)}</div>${examOverlay()}</div>`;
  };
  extras.examcatalog = function() {
    const empty=state==='empty';return header('题包与本机记录','选择原题包，先检查材料，再开始独立计时。','听读模考')+`<div class="ev-catalog">${synthetic}<div class="notice">考试记录仅当前设备与当前记录范围。私人云库只上传 / 下载题包；不代表考试答案已云同步。</div><div class="buttons">${actionButton('导入题包 JSON','import-package',true)}${actionButton('导出完整备份','backup')}${actionButton('恢复本机备份','restore')}</div>${empty?'<section class="panel empty space"><h2>还没有完整本机题包</h2><p>导入有权个人使用的 200 题 JSON。须含完整正文或扫描图、选项、答案和听力音轨；不会拼出“真题卷”。</p></section>':`<section class="panel space"><h2>已导入题包</h2>${['current','legacy'].map((id,i)=>`<article class="ev-package"><div><span class="tag neutral">${i?'2006 版旧题型':'现行题型'} · 200 题</span><h3>设计示例题包 ${i?'B':'A'} · v${i?2:1}</h3><p>Part：${(i?legacyCounts:currentCounts).join(' / ')}<br>听力 ${i?'42:30 · 已声明':'45:00 · 未声明，沿用默认'} / 阅读 75:00</p><details><summary>来源与个人使用声明</summary><p>合成设计题包，原材料仅用于布局。正式页面显示导入者填写的 source；程序不认证授权。</p></details></div><div>${actionButton('音频预检与新考试',`package-${id}`,false)}</div></article>`).join('')}</section><section class="panel space"><h2>${state==='history'?'已交卷记录':'继续或结算上一次'}</h2><div class="ev-package"><div><h3>设计示例题包 A · v1 · 首次</h3><p>${state==='history'?'已交卷 · 原记录 ID 与题包摘要保持':'阅读阶段 · 原截止 11:00:00 · 已保存 146 / 200'}<br>${state==='history'?'正确 119 / 200，漏答 54':'离开期间继续计时；恢复时先校准阶段与音频。'}</p></div>${actionButton(state==='history'?'结果与原题复盘':'继续或结算原考试',state==='history'?'result':'resume',true)}</div></section>`}<p class="ev-media-note space">已有考试记录的题包不可移除。导入与恢复沿用现有逐文件校验及同记录范围合并，不做数据迁移或清理。</p></div>`;
  };
  examSetupContent = function() {
    if(state.startsWith('legacy'))chosenPackage='legacy';else if(['default','ready','error','image-error'].includes(state))chosenPackage='current';
    const p=packageInfo(),ready=state==='ready'||state==='legacy-ready',error=state==='error'||state==='image-error';
    return header('开考前，检查这一份题包。','预检不计时；点击开始并保存成功，才建立本次原截止。','模考预检')+`<div class="ev-preflight">${miniIdentity()}${synthetic}<section class="panel"><h2>原题型与时长</h2><p class="ev-format">${p.format} · 题包版本 v${p.version}</p><ul class="ev-parts">${partBreakdown(p.counts)}</ul><dl class="ev-summary"><div><dt>听力时限</dt><dd>${p.listening}</dd></div><div><dt>实际音轨测量</dt><dd>${state==='error'?'41:12 · 不匹配':p.listening+' · 匹配'}</dd></div><div><dt>声明</dt><dd>${p.declared}</dd></div><div><dt>阅读时限</dt><dd>75:00</dd></div></dl><p class="ev-media-note">${chosenPackage==='legacy'?'旧题型仅作补充练习；Part 分布和结果不混为现行基线。':'format 未提供时按现行结构校验，不猜测书名或出版年份。'} 声明时长须为 40–50 分钟整秒，匹配真实媒体后使用。</p></section>${audioPanel(state==='error',false,true)}<section class="panel"><h2>开始前确认</h2><div class="ev-check-row"><span>200 题结构、选项、答案与引用素材</span><strong>✓ 校验通过</strong></div><div class="ev-check-row"><span>全部题图依次解码</span><strong>${state==='image-error'?'! 解码失败':'✓ 通过'}</strong></div><div class="ev-check-row"><span>完整听力音轨与时长匹配</span><strong>${state==='error'?'! 时长不匹配':'✓ 匹配'}</strong></div>${error?errorBanner(state==='image-error'?'材料图片预检失败':'音轨时长与声明不符','不能开始新考试。保留原题包，重试预检或核对材料；不可用跳过校验按钮。','重试预检','retry-preflight'):''}<label class="ev-check"><input type="checkbox" data-exam-heard ${ready||heardFixture?'checked':''} ${error?'disabled':''}><span>我已试听，确认听得清，而且音轨包含本卷完整听力。</span></label><div class="notice warning">开始后先听力 ${p.listening}，再阅读 75:00。退出、后台、重启都不暂停。只有保存成功才进入作答。</div><div class="buttons">${actionButton('开始新考试 · 立即计时','start',true,`${!ready?'disabled':''} id="ev-start-exam"`)}${actionButton('返回题包目录','catalog')}</div><p class="ev-media-note">本稿试听和开考均为状态演示，不执行音频、创建 attempt 或写入 deadline。</p></section></div>`;
  };
  examResultContent = function() {
    if(state==='legacy')chosenPackage='legacy';else if(state!=='legacy')chosenPackage='current';
    chosenOrdinal=state==='retest'||state==='legacy'?2:1;
    const p=submittedSnapshot?.identity||packageInfo(),legacy=p.id==='layout-legacy-b',finalReadingNumber=submittedSnapshot?.readingNumber??readingNumber(),finalKind=submittedSnapshot?.readingKind??readingKind,savedChoice=submittedSnapshot?.answers[finalReadingNumber],finalSaved=!!savedChoice,correct=legacy?[7,20,18,17,17,7,33+(finalSaved&&savedChoice===(finalKind==='single'?'A':'B')?1:0)]:[4,16,24,18,12,9,36+(finalSaved&&savedChoice===(finalKind==='single'?'A':'B')?1:0)],unanswered=legacy?[1,7,7,9,12,3,15-(finalSaved?1:0)]:[1,6,8,9,10,5,15-(finalSaved?1:0)];
    const rcCorrect=correct.slice(4).reduce((a,b)=>a+b,0),allCorrect=62+rcCorrect,allMissing=unanswered.reduce((a,b)=>a+b,0);
    const time=['03:00','11:00','16:00',legacy?'12:30':'15:00','10:00','07:00','25:24'];
    const ordinal=submittedSnapshot?.identity.ordinal||(state==='retest'||legacy?'复测第 1 次':'首次完整模考');
    return header('这一次，已交卷并保存。','先看原始题数与原材料；本次答案已锁定。','模考复盘')+`<div class="ev-results">${synthetic}<div class="ev-result-identity"><h2>${p.name} · v${p.version}</h2><p>${p.label} · ${ordinal} · ${state==='timeout'?'到时自动交卷':'主动交卷'}<br>听力 ${p.listening} / 阅读 75:00 · 总用时 ${legacy?'01:24:54':'01:27:24'}</p><span class="tag neutral">已保存在本机 · ${p.attempt}</span></div><div class="statgrid space"><div class="stat"><span>听力原始正确</span><div class="metric">62 <small>/ 100</small></div><p>Part 1–4 · 分母来自原 format</p></div><div class="stat"><span>阅读原始正确</span><div class="metric">${rcCorrect} <small>/ 100</small></div><p>Part 5–7 · 分母来自原 format</p></div><div class="stat"><span>整卷漏答</span><div class="metric">${allMissing} <small>/ 200</small></div><p>正确 ${allCorrect} · 错误 ${200-allCorrect-allMissing} · 漏答 ${allMissing}</p></div></div><section class="panel"><h2>全部 7 个 Part</h2><div class="ev-result-table"><table><caption class="ev-sr-only">当前原题型的各 Part 原始成绩</caption><thead><tr><th scope="col">Part</th><th scope="col">正确 / 总题</th><th scope="col">漏答</th><th scope="col">正确率</th><th scope="col">驻留用时</th></tr></thead><tbody>${p.counts.map((n,i)=>`<tr><th scope="row">${i+1}<span>${partNames[i]}</span></th><td>${correct[i]} / ${n}</td><td>${unanswered[i]}</td><td>${Math.round(correct[i]/n*100)}%</td><td>${time[i]}</td></tr>`).join('')}</tbody></table></div><p class="ev-media-note">驻留用时是墙钟时间，包含后台与离开，不代表有效专注时长。${legacy?'旧题型单独判分；不并入现行首次基线。':''}</p><div class="notice ${state==='interrupted'?'warning':''}">${state==='interrupted'?'本次有中断或时钟异常标记，比较时请一并考虑。':'未记录到中断；本机结果不等于监考认证。'}</div><details><summary>原记录与中断信息</summary><p>原题包 ID：${p.id} · 版本 ${p.version} · 原 format 与摘要校验保持。记录身份：${ordinal}。开始、原截止和交卷时间从本次原记录读取，不重新生成。</p></details><div class="buttons space">${actionButton('查看原题与解析','review',true)}${actionButton('导出完整模考备份','backup')}${actionButton('回到题包与记录','catalog')}</div><p class="ev-media-note space">此设计题包未提供有出处的分数换算表，只展示原始题数；不预测正式托业分数。复测另存，不覆盖首次。</p></section></div>`;
  };
  extras.examreview = function() {
    if(state==='legacy')chosenPackage='legacy';
    const photo=state==='photo',single=state==='single';
    return `<div class="ev-shell">${examTop(false,false,true)}${synthetic}<div class="notice">仅查看这一次模考的原题与答案。保持原题包 / 版本 / 题型 / 首次或复测身份，不写成普通练习首答。</div><div class="ev-reading-grid ${photo?'ev-photo-review':''}">${photo?'':materials(!single)}${examQuestionPanel(photo?'photo':single?'single':'multi',true,true)}</div><div class="buttons space">${actionButton('原题组：Part 1 图像','review-photo')}${actionButton('原题组：单篇阅读','review-single')}${actionButton('原题组：多材料','review-multi')}</div><p class="ev-media-note">实际题号和题组来自原记录的 format 映射；旧制 Part 7 为 153–200，多材料从 181 开始；现行 Part 7 为 147–200，多材料从 176 开始。没有题包解析时明确缺失，不编造。</p></div>`;
  };

  const transcriptLines=['The delivery team will arrive on Thursday morning.','Please keep the loading entrance clear between nine and eleven.','Staff with a morning meeting should use Room two hundred four.'];
  function practiceAudio(line='',index=-1) {return `<div class="ev-practice-player"><button class="ev-play" data-exam-action="practice-play" aria-label="${practicePlaying?'停止朗读':'播放'+(line?'第 '+(index+1)+' 句':'本题音频')}">${practicePlaying?'■':'▶'}</button><div><strong lang="en">${line||'听一遍，再选择'}</strong><span>原创练习 · 内置合成语音 / 设备支持时系统朗读</span></div><label>语速<select aria-label="${line?'第 '+(index+1)+' 句':'本题'}朗读语速"><option>0.7×</option><option>0.85×</option><option selected>1×</option><option>1.15×</option></select></label></div>`;}
  extras['practice-media'] = function() {
    if(['listen','listen-submitted','intensive','dictation','dictation-checked'].includes(state))practiceKind='listen';
    if(['photo','photo-submitted','image-expanded'].includes(state))practiceKind='photo';
    if(['long','long-submitted'].includes(state))practiceKind='long';
    const long=practiceKind==='long',photo=practiceKind==='photo';
    const submitted=['listen-submitted','photo-submitted','long-submitted','intensive','dictation','dictation-checked'].includes(state);
    const intensive=['intensive','dictation','dictation-checked'].includes(state);
    const normalize=v=>String(v).toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();
    const typed=dictationText||(['dictation','dictation-checked'].includes(state)?'The delivery team will arrive Thursday morning.':'');
    const dictationCorrect=normalize(typed)===normalize(transcriptLines[0]);
    const kind=long?'Part 7 · 阅读理解':photo?'Part 1 · 照片描述':'Part 3 · 简短对话';
    const stem=long?'What should staff do if they have a morning meeting?':photo?'Look at the picture and choose the best description.':'Where will the morning meetings take place?';
    return `<div class="ev-shell ev-practice"><div class="ev-top"><button class="quiet" data-exam-action="practice-exit">← 退出练习</button><span>${kind} · 3 / 5<br>原创起步包 · 新题首答</span></div>${synthetic}<div class="ev-reading-grid ${long?'':'ev-single-column'}">${long?materials(false):''}<section class="panel ev-question">${photo?imageBlock('practice')+practiceAudio():long?'':practiceAudio()}<h1 class="question-stem" lang="en">${stem}</h1>${options(photo?submitted?['The chairs are stacked by a door.','The windows are being replaced.','Chairs are arranged around a table.','Someone is carrying a table.']:['选项 A','选项 B','选项 C','选项 D']:['In the third-floor room.','In Room 204.','At the loading entrance.','At the delivery office.'],examChoice,submitted,'practice',submitted?(photo?'C':'B'):'')}${state==='save-error'?errorBanner('本题提交尚未保存','当前选项 B 保留，重试成功才进入解析与下一题。不是已保存、已同步状态。','重试提交本题','practice-submit'):''}${submitted?`<div class="analysis"><h2>答案 ${photo?'C':'B'} · 已提交并保存</h2><nav class="ev-material-tabs" aria-label="已提交答案的学习内容">${actionButton('答案解析','practice-explain',!intensive)}${!long?actionButton('精听与听写','practice-intensive',intensive):''}${actionButton('词汇与表达','practice-vocab')}</nav>${intensive?`<h3 class="space">逐句回听 · 点一句，听一句</h3>${transcriptLines.map(practiceAudio).join('')}<section class="ev-dictation"><h3>听写第一句</h3><p>标点和大小写不计；核对只影响当前听写反馈，不新增成绩。</p><label class="ev-sr-only" for="ev-dictation-answer">听写答案</label><textarea id="ev-dictation-answer" placeholder="Type what you hear…" lang="en" spellcheck="false">${esc(dictationText||(['dictation','dictation-checked'].includes(state)?'The delivery team will arrive Thursday morning.':''))}</textarea>${actionButton('核对听写','dictation-check',true)}${state==='dictation-checked'?`<div class="notice"><strong>${dictationCorrect?'听写正确 · 试着跟读一次':'对照原句'}</strong><p lang="en">${esc(transcriptLines[0])}</p><p>${dictationCorrect?'这次核对只作本页反馈。':'重新回听，再改一遍；保留已提交的题目答案。'}</p></div>`:''}</section>`:`<p class="space">${photo?'从原图看，椅子围在桌旁。保留原图，对照描述再回听。':long?'邮件第三段说明，上午的会议改用 Room 204。依据原材料核对，完成本题后才进入下一题。':'音频第三句写明，上午的会议改用 Room 204。先找出这一句，再回听完整语境。'}</p><blockquote lang="en">${photo?'Chairs are arranged around a table.':'Staff with a morning meeting should use Room two hundred four.'}</blockquote>`}</div>`:''}<div class="ev-question-actions"><span>${submitted?'3 道已提交 · 首答保留':state==='save-error'?'当前选项 B · 待保存':'2 道已提交 · 当前未提交'}</span>${actionButton(submitted?'下一题 →':'提交答案',submitted?'practice-next':'practice-submit',true)}</div></section></div><p class="ev-media-note">常规练习可逐句回听与变速，模考完整轨不可自由变速或拖进度。听写为当前页辅助反馈；无 AI 评分、音频转写或新存储接口。</p>${state==='image-expanded'?dialog('原练习题图',`<div class="ev-enlarged-picture" tabindex="0">${officePicture(true)}</div><p>关闭后保留原题号与当前选择，不重新启动题组。</p>`,actionButton('关闭并返回原题','practice-image-close',true)):''}${state==='exit-confirm'?dialog('退出这组练习？','<p>2 道已提交答案保留。当前未提交选项与题组位置不持久保存，重新进入重开题组。完成题组后另行记录时间。</p>',actionButton('继续当前题','practice-return')+actionButton('退出并保留已提交答案','practice-leave',true)):''}</div>`;
  };
  const beforeRender = render;
  render = function() {
    document.querySelector('.ev-dialog-backdrop')?.remove();
    beforeRender();
    if(['practice-media','examreview'].includes(page))document.body.classList.add('focus-mode');
    document.body.classList.toggle('ev-active',['exam','examreview','practice-media'].includes(page));
    const modal=document.querySelector('.ev-dialog');if(modal){modal.setAttribute('tabindex','-1');(modal.querySelector('button:not(:disabled)')||modal).focus({preventScroll:true});}
  };
  const setExamState=(next)=>{state=next;render();};
  const returnToExam=()=>{setExamState(examReturnState);document.querySelector(`[data-exam-action="${modalOriginAction}"]`)?.focus({preventScroll:true});};
  document.addEventListener('input',e=>{if(e.target.id==='ev-dictation-answer')dictationText=e.target.value;},{capture:true});
  document.addEventListener('change',e=>{if(e.target.matches('[data-exam-heard]')){e.stopImmediatePropagation();heardFixture=e.target.checked;const start=document.getElementById('ev-start-exam');if(start)start.disabled=!heardFixture||['error','image-error'].includes(state);}},{capture:true});
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-exam-action]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();
    const a=b.dataset.examAction;
    if(a.startsWith('material-')){materialTab=Number(a.split('-')[1]);document.getElementById('ev-material-'+materialTab)?.scrollIntoView({block:'start',behavior:'instant'});return;}
    if(a.startsWith('exam-choose-')){if(['examreview'].includes(page)||['timeout','timeout-error','submitting'].includes(state))return;if(['listening','listening-save-error','audio-error','audio-ended'].includes(state)){examPhotoChoice=a.at(-1);setExamState('listening-save-error');}else{examChoice=a.at(-1);readingPending=true;setExamState('save-error');}return;}
    if(a.startsWith('practice-choose-')){examChoice=a.at(-1);render();return;}
    if(a.startsWith('package-')){chosenPackage=a.endsWith('legacy')?'legacy':'current';heardFixture=false;navigate('examsetup',chosenPackage==='legacy'?'legacy':'default');return;}
    if(a.startsWith('jump-')){examQuestion=Number(a.slice(5));if(page==='examreview')return;setExamState(examQuestion<=100?'listening':examQuestion>=176?'reading-multi':'reading-single');toast('题号为布局示意；实际从原题包读取该题，不重建考试');return;}
    switch(a){
      case 'catalog':navigate('examcatalog');break;
      case 'resume':chosenPackage='current';navigate('exam','reading-multi');break;
      case 'result':navigate('examresult');break;
      case 'hear':heardFixture=false;toast('仅试听按钮示意，不播放音轨；人耳确认不会自动勾选');break;
      case 'retry-preflight':setExamState(chosenPackage==='legacy'?'legacy':'default');break;
      case 'start':navigate('exam','listening');break;
      case 'exit':modalOriginAction='exit';examReturnState=['listening','listening-save-error','audio-error','audio-ended'].includes(state)?state:readingKind==='single'?'reading-single':'reading-multi';setExamState('exit-confirm');break;
      case 'exit-save':setExamState('exit-saving');break;
      case 'retry-exit':setExamState('exit-saving');break;
      case 'force-exit':navigate('examcatalog');toast('应急退出状态示意 · 原截止继续；未操作真实数据');break;
      case 'return-exam':returnToExam();break;
      case 'save-answer':if(state==='listening-save-error')photoSaved=!!examPhotoChoice;else{readingSaved=!!examChoice;storedReadingChoice=examChoice;readingPending=false;}setExamState(state==='listening-save-error'?'listening':readingKind==='single'?'reading-single':'reading-multi');toast('演示保存成功；真实保存返回成功才计入');break;
      case 'clear-answer':if(['listening','listening-save-error','audio-error','audio-ended'].includes(state)){examPhotoChoice='';setExamState('listening-save-error');}else{examChoice='';readingPending=true;setExamState('save-error');}break;
      case 'previous':case 'next':toast('示意原题号切换；正式页面等待现有select持久化返回');break;
      case 'submit-open':modalOriginAction='submit-open';examReturnState=readingKind==='single'?'reading-single':'reading-multi';setExamState('submit-confirm');break;
      case 'submit':case 'retry-submit':setExamState('submitting');break;
      case 'retry-timeout':setExamState('timeout');break;
      case 'reload-records':toast('示意重新读取本次原记录，不重置截止或覆盖数据');break;
      case 'recover-audio':case 'reload-audio':setExamState('listening');toast('恢复状态示意 · 实际按已用时间对齐，不延长截止');break;
      case 'image':modalOriginAction='image';examReturnState='listening';setExamState('image-expanded');break;
      case 'close-image':returnToExam();break;
      case 'review':resultReturnState=state;navigate('examreview',chosenPackage==='legacy'?'legacy':'default');break;
      case 'back-result':navigate('examresult',chosenPackage==='legacy'?'legacy':resultReturnState);break;
      case 'demo-submit-success':freezeSubmittedSnapshot();navigate('examresult',chosenPackage==='legacy'?'legacy':'default');break;
      case 'demo-submit-failure':setExamState('submit-error');break;
      case 'demo-exit-success':navigate('examcatalog');break;
      case 'demo-exit-failure':setExamState('exit-save-error');break;
      case 'review-photo':setExamState('photo');break;
      case 'review-single':setExamState('single');break;
      case 'review-multi':setExamState('default');break;
      case 'practice-play':practicePlaying=!practicePlaying;render();toast('朗读状态示意，不调用音频或系统语音');break;
      case 'practice-submit':setExamState(practiceKind==='photo'?'photo-submitted':practiceKind==='long'?'long-submitted':'listen-submitted');break;
      case 'practice-explain':setExamState(practiceKind==='photo'?'photo-submitted':practiceKind==='long'?'long-submitted':'listen-submitted');break;
      case 'practice-intensive':setExamState('intensive');break;
      case 'practice-vocab':toast('沿用已存在词汇与表达内容；无新增接口');break;
      case 'dictation-check':setExamState('dictation-checked');break;
      case 'practice-next':toast('下一题状态示意；首答已保留，不写真实记录');break;
      case 'practice-image':mediaReturnState='photo';setExamState('image-expanded');break;
      case 'practice-image-close':setExamState(mediaReturnState);break;
      case 'practice-exit':mediaReturnState=state;setExamState('exit-confirm');break;
      case 'practice-return':setExamState(mediaReturnState);break;
      case 'practice-leave':navigate('practice');break;
      case 'import-package':case 'backup':case 'restore':toast('保留现有入口 · 不打开文件、不读写本机数据');break;
      case 'noop':break;
    }
  },{capture:true});
  document.addEventListener('keydown',e=>{
    const modal=document.querySelector('.ev-dialog');
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&['exam','examreview','practice-media'].includes(page)){e.preventDefault();e.stopImmediatePropagation();return;}
    if(!modal)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(['submitting','exit-saving'].includes(state))return;if(page==='practice-media')setExamState(mediaReturnState);else if(state==='image-expanded')setExamState('listening');else returnToExam();return;}
    if(e.key==='Tab'){const controls=[...modal.querySelectorAll('button:not(:disabled),[tabindex="0"]')];if(!controls.length)return;if(e.shiftKey&&document.activeElement===controls[0]){e.preventDefault();controls.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===controls.at(-1)){e.preventDefault();controls[0].focus();}}
  },{capture:true});
})();
