// v1.1 isolated revision. Synthetic samples only; production storage is never read.
window.designExtras=window.designExtras||{};
const v11Version='v1.1 · 待独立复验';
iconPaths['♬']='<path d="m4 9 4 0 5-4v14l-5-4H4Z"/><path d="M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/>';
iconPaths['×']='<path d="m6 6 12 12M18 6 6 18"/>';
let v11CardFeedback='记住了';
function v11Motif(kind){
  if(kind==='hollow')return '<svg class="theme-motif hollow" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 44V23C4 10 12 4 24 4s20 6 20 19v21M10 44V24c0-9 5-14 14-14s14 5 14 14v20"/><path d="M17 22l-2-7 6 4h6l6-4-2 7v8c0 7-14 7-14 0Z" fill="currentColor" stroke="none"/></g><ellipse cx="21" cy="27" rx="2.1" ry="3.4" fill="var(--bg)"/><ellipse cx="27" cy="27" rx="2.1" ry="3.4" fill="var(--bg)"/></svg>';
  return '<svg class="theme-motif silk" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 42 36 7l5-3-1 6L12 43Z"/><ellipse cx="35.2" cy="9.2" rx="1.5" ry="2.4" transform="rotate(38 35 9)"/><path d="M35 9c-16 0-27 6-26 14 1 12 33 9 31 17-1 4-10 4-15 2M18 26c0-7 3-10 7-10s7 3 7 10l3 4H15Zm4 7c1 3 5 3 6 0"/></g></svg>';
}
motif=v11Motif;
const oldV11Home=homeContent;homeContent=function(){return oldV11Home().replace('先回忆，再看解析。今天只需要弄懂一个错因。','回忆词义，揭示释义，再明确选择“记住了”或“还不熟”。').replace('开始复习 →','开始词卡自测 →').replaceAll('done b','done b');};
const oldV11Progress=progressContent;progressContent=function(){return oldV11Progress().replace('>3 <small>/ 4 天目标','>4 <small>/ 4 天目标');};
const oldV11Session=sessionContent;sessionContent=function(){let html=oldV11Session();if(state==='explanation')html=html.replace('2 道已提交','3 道已提交');return html;};
const oldV11Card=reviewCardContent;reviewCardContent=function(){let html=oldV11Card();if(state==='save-error')html=html.replace('词卡反馈未保存',`词卡反馈未保存 · 待保存：${v11CardFeedback}`).replace('保留当前词卡和选项，重试成功再进入下一张；不显示“已掌握”。',`当前是第 2 / 8 张，选择“${v11CardFeedback}”尚未保存。重试保存相同反馈；也可改选，继续留在这一张。失败不记为已掌握。`).replace('data-action="grade-word"','data-v11-action="change-card-feedback"').replace('data-action="retry-card"','data-v11-action="retry-feedback"');return html;};
themeCards=function(){return `<div class="themegrid v11-themegrid" role="group" aria-label="选择界面主题">${Object.entries(themes).map(([id,name])=>`<button class="theme-card ${id===theme?'selected':''}" data-theme-pick="${id}" aria-pressed="${id===theme}" aria-label="选择${name}主题"><div class="v11-theme-preview" data-theme="${id}"><div class="v11-preview-title"><strong>词卡自测</strong>${id==='hollow'||id==='silk'?motif(id):'<span class="v11-plain-mark" aria-hidden="true">Aa</span>'}</div><p>先回忆词义，再揭示释义。</p><div class="v11-preview-word"><b>schedule</b><span>日程表；安排</span><span class="v11-selected-mark">✓ 选中</span></div><div class="v11-preview-action">查看释义</div><div class="v11-preview-states"><div class="v11-preview-success">✓ 反馈已保存</div><div class="v11-preview-failure"><strong>! 反馈未保存</strong><span>选择保留，可重试。</span><span class="v11-preview-retry">重试保存</span></div></div></div><div class="v11-theme-caption"><strong>${name}${id===theme?' · 已选':''}</strong><small>${id==='day'?'暖白 · 墨绿 · 无游戏':id==='night'?'炭灰 · 薄荷 · 无游戏':id==='hollow'?'对称门拱 · 骨白切面':'斜针 · 丝环 · 钟线'}</small></div></button>`).join('')}</div>`;};
const v11Comparison=compareContent;compareContent=function(){return v11Comparison().replaceAll('先回忆，再看解析。今天弄懂一处卡点。','回忆词义，揭示释义，再明确自测反馈。');};
const v11SearchBody=searchBody;searchBody=function(){if(state==='long')return `<div class="search-layout ${detailOpen?'detail-open':''}"><div class="results"><div class="result-label" role="status">1 个结果 · 精确词头</div><button class="wordrow selected" data-v11-action="long-detail" aria-current="true"><span><b>internationalization</b><small>国际化；为不同国家与语言环境作准备</small><small>名词 · 自洽设计压力样例</small></span><span class="match-tag">精确</span></button></div>${searchDetail()}</div>`;return v11SearchBody();};
const v11OldSearchDetail=searchDetail;searchDetail=function(){if(state!=='long')return v11OldSearchDetail();return `<div class="detail"><button class="detail-back" data-action="back-results">← 返回结果 · 保留查询</button><span class="tag neutral">通用词典 · 设计示意词条</span><h1 class="word-title" lang="en">internationalization</h1><div class="phonetic">暂无音标</div><div class="definition"><b>名词 · 国际化</b><p>1. 使产品、服务或组织能够适用于不同国家和语言环境的过程。</p><p>2. 软件国际化：在开发时为不同语言、日期格式、数字格式和文本方向预留支持；随后可按具体地区进行本地化。</p><p>3. 商业语境：企业逐步将业务、服务或合作扩展到本国以外的市场，同时考虑当地语言、文化与使用习惯。</p><p>4. 组织语境：在活动、合作或交流中引入来自不同国家的参与者，形成跨国联系。</p><p>5. 英式拼写也可写作 internationalisation。软件领域常用缩写 i18n，其中18代表首字母i和末字母n之间的字母数。</p></div><div class="notice">此词条暂无内置音频。没有内容的发音和例句入口不显示。</div><button class="button primary" data-v11-action="long-word-save">＋ 加入 internationalization</button><div class="source space">演示词条：internationalization · 本稿释义为原创布局示意，非实际词典摘录。正式通用词条沿用自己的来源和许可。</div></div>`;};
const v11BeforeRender=render;
render=function(){
  if(page==='search'){
    if(state==='empty')query='appelp';
    if(state==='related')query='sche';
    if(state==='long'){query='internationalization';detailOpen=true;}
    if(state==='initial')query='';
  }
  v11BeforeRender();
  history.replaceState(null,'',`?page=${page}&theme=${theme}&state=${state}${params.get('chrome')==='0'?'&chrome=0':''}${params.get('format')?'&format='+encodeURIComponent(params.get('format')):''}`);
  document.body.classList.toggle('clean-preview',params.get('chrome')==='0');
  document.body.classList.toggle('v11-search',page==='search'&&!detailOpen);
  document.body.classList.toggle('v11-game',theme==='hollow'||theme==='silk');
  const identity=document.querySelector('.pagehead');
  if(identity&&['hollow','silk'].includes(theme)&&!document.body.classList.contains('focus-mode'))identity.classList.add('v11-game-heading');
  if(page==='home'&&state!=='empty'){
    const days=[...document.querySelectorAll('.week>span')];
    [0,2,5,6].forEach(i=>{days[i]?.classList.add('done');if(days[i])days[i].querySelector('b').textContent='✓';});
  }
  document.querySelectorAll('.reviewbar strong').forEach(x=>x.textContent='微光 · '+v11Version);
  document.title='微光托业 · 设计评审稿 '+v11Version;
  if(page==='search'){
    document.getElementById('content').setAttribute('aria-label',detailOpen?'词条详情':'查词');
    let title=document.querySelector('.compact-search-title');
    if(!title){title=document.createElement('h1');title.className='compact-search-title';title.textContent='查词';document.querySelector('.search-origin-back').after(title);}
  }
  const correctCount=document.querySelector('.statgrid .stat:nth-child(2) .metric');
  if(page==='progress'&&state!=='empty'&&correctCount)correctCount.innerHTML='4 <small>/ 4 天目标</small>';
  if(page==='settings'){
    const preferenceRow=[...document.querySelectorAll('.settingrow')].find(x=>x.querySelector('h3')?.textContent==='每日学习预算');
    if(preferenceRow){preferenceRow.querySelector('h3').textContent='学习偏好';preferenceRow.querySelector('p').textContent='目标 · 考期 · 预算 · 每周启动 · 时区';const b=preferenceRow.querySelector('button');b.textContent='编辑偏好';b.removeAttribute('data-action');b.dataset.page='preferences';}
    const exportButton=document.querySelector('aside [data-action="demo-export"]');if(exportButton){exportButton.textContent='管理三类备份';exportButton.removeAttribute('data-action');exportButton.dataset.page='backups';}
    const pane=document.querySelector('main section');if(pane&&!pane.querySelector('.v11-settings-links'))pane.insertAdjacentHTML('beforeend',`<div class="panel space v11-settings-links"><h2>安装、来源与回放</h2><div class="settingrow"><div><h3>设备安装与离线范围</h3><p>Web/PWA 与 HarmonyOS，身份和保存范围分别说明</p></div>${btn('查看','install',false,'class="button compact"')}</div><div class="settingrow"><div><h3>来源与许可</h3><p>原创练习、通用词典、私人题包分开</p></div>${btn('查看','about',false,'class="button compact"')}</div><div class="settingrow"><div><h3>录音历史</h3><p>发生时间、秒数、真实回放与文件可用状态</p></div>${btn('回放','recordings',false,'class="button compact"')}</div></div>`);
  }
  if(page==='practice'){
    if(state==='speaking'){const b=document.querySelector('main [data-page="speaking"]');if(b)b.dataset.page='speakinglist';}
    else{const partTitle=[...document.querySelectorAll('.section-title')].find(x=>x.querySelector('h2')?.textContent==='按 Part 练习');if(partTitle)partTitle.insertAdjacentHTML('beforebegin',`<div class="v11-quick-entry"><div><h2>完整听读模考</h2><p>个人题包 · 预检 · 原截止计时 · 首次或复测</p></div>${btn('选择题包','examcatalog',false,'class="button compact"')}</div><div class="buttons space">${btn('听力题图与回听','practice-media',false,'class="button compact" data-next="photo"')}${btn('长阅读练习','practice-media',false,'class="button compact" data-next="long"')}</div>`);document.querySelectorAll('.partrow').forEach((row,i)=>{const button=row.querySelector('[data-page]');if(button&&[0,2,6].includes(i)){button.dataset.page='practice-media';button.dataset.next=i===0?'photo':i===6?'long':'listen';}});}
  }
  if(page==='practice-media'||page==='examreview')document.body.classList.add('focus-mode');
};
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&page==='reviewcard'){e.preventDefault();e.stopImmediatePropagation();toast('词卡自测中，请先使用受控返回。');}},{capture:true});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(page==='reviewcard'&&state==='save-error'&&b.dataset.action==='grade-word'){e.preventDefault();e.stopImmediatePropagation();v11CardFeedback='记住了';render();return;}if(b.dataset.v11Action){e.preventDefault();e.stopImmediatePropagation();switch(b.dataset.v11Action){case'change-card-feedback':v11CardFeedback='还不熟';render();break;case'retry-feedback':state='revealed';render();toast(`演示：反馈“${v11CardFeedback}”已保存；未操作真实记录`);break;case'long-word-save':toast('演示：只收藏 internationalization，保留对应词条身份');break;case'long-detail':state='long';detailOpen=true;render();window.scrollTo(0,0);break;}return;}if(b.dataset.word&&innerWidth<=1023){requestAnimationFrame(()=>window.scrollTo(0,0));}},{capture:true});
// Extension routes are parsed only after all v1.1 modules are installed.
if(pages[params.get('page')])page=params.get('page');
if(params.get('state'))state=params.get('state');
render();
