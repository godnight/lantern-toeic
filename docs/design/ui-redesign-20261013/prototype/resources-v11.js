/* F04 design supplement. Synthetic fixtures only; no fetch, storage, microphone, file picker or real export. */
(function () {
  'use strict';
  window.designExtras = window.designExtras || {};
  const routes = {
    'resource-detail': '材料详情', 'resource-checkin': '材料学习记录',
    preferences: '目标与学习偏好', backups: '记录与备份',
    install: '添加桌面与使用方式', about: '来源与说明', recordings: '我的口语录音'
  };
  Object.assign(pages, routes);
  stateOptions['resource-detail'] = [['default', '步骤与访问'], ['learned', '已有学习记录'], ['external-error', '外站暂不可用']];
  stateOptions['resource-checkin'] = [['default', '实际用时与负荷'], ['save-error', '保存失败'], ['saved', '保存后返回材料']];
  stateOptions.preferences = [['default', '完整偏好表单'], ['save-error', '保存失败保留输入'], ['saved', '偏好已更新']];
  stateOptions.backups = [['default', '三类记录分开'], ['exported', '导出结果提示'], ['word-import', '词库合并导入'], ['word-import-error', '词库导入失败'], ['word-imported', '词库合并完成'], ['exam-restore', '完整模考备份范围'], ['exam-restore-error', '模考恢复失败']];
  stateOptions.install = [['default', '网页添加桌面'], ['native', '鸿蒙本机模式'], ['preview', '未登录本机预览']];
  stateOptions.about = [['default', '内容与媒体来源'], ['themes', '四主题与素材说明']];
  stateOptions.recordings = [['default', '历史列表'], ['empty', '暂无录音'], ['replay', '回放面板'], ['local', '本机记录'], ['read-error', '录音读取失败']];

  const materialFixtures = [{
    id: 'voa-budget-cuts', title: '办公室听力 · Budget Cuts', provider: 'VOA Learning English',
    url: 'https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson1/3960391.html',
    description: '从办公室预算话题练习抓主旨，使用原站对话文字进行精听。',
    minutes: 12, parts: 'Part 3 / 4', category: '听力精听', categoryId: 'listening', hasAudio: true, hasTranscript: true,
    steps: ['4分钟：先听 Conversation 音频，不展开或向下看对话文字。', '4分钟：对照原站文字再听，找出两个漏听的表达。', '4分钟：完成原站小测验，再用自己的话复述办公室发生了什么。'],
    access: '免费课程页含对话音频、文字、视频和小测验，无需登录。属于通用英语补充材料，不是托业模拟题。',
    rights: '本应用只保存入口和学习步骤。逐项确认媒体权利前，不搬运原站文字、音频或整页。'
  }, {
    id: 'bc-new-team-member', title: 'A1 听力 · 认识新同事', provider: 'British Council LearnEnglish',
    url: 'https://learnenglish.britishcouncil.org/free-resources/listening/a1/meeting-new-team-member',
    description: '简短职场介绍对话，配音频、Transcript与练习，适合先建立听懂的体验。',
    minutes: 8, parts: 'Part 2 / 3', category: '听力精听', categoryId: 'listening', hasAudio: true, hasTranscript: true,
    steps: ['2分钟：完成 Preparation 后，先听一次音频。', '3分钟：完成练习，再打开 Transcript 核对人名与职位。', '3分钟：跟读两句，再用自己的话做20秒自我介绍。'],
    access: '课程内容免费，无需登录即可学习；收藏或评论可能需要账号。属于通用英语补充材料。',
    rights: '保留原站文字链接。重新发布、改编或脱离课程页面提供音频需要事先许可，本应用不导入媒体。'
  }, {
    id: 'iibc-p7-multiple', title: 'Part 7 · 官方三篇关联阅读', provider: 'IIBC / ETS',
    url: 'https://www.iibc-global.org/toeic/test/lr/about/format/sample07_04.html',
    description: '广告、购物车与邮件配五道题，训练跨材料核对信息。',
    minutes: 15, parts: 'Part 7', category: '托业官方', categoryId: 'official', hasAudio: false, hasTranscript: false,
    steps: ['3分钟：浏览三份材料，判断每份材料提供什么信息。', '7分钟：完成五题，遇到关联题时核对两份材料。', '5分钟：在原站核对，记下一次跨材料定位的方法。'],
    access: '官方免费样题，无需登录；页面导航为日文，题目为英文。',
    rights: 'ETS保留官方样题与媒体版权；这里只提供原站链接，不复制或缓存题目、图片、音频和 PDF。'
  }];
  let material = materialFixtures[0], libraryFilter = 'all';
  const materialRecords = new Map();
  let resourceVisited = false, resourceSaved = false, resourceMinutes = 12, resourceCheckinFixture = null;
  let materialStats = { visits: 0, minutes: 0 };
  let resourceDraft = { minutes: '12', load: '刚好', note: '' };
  let preferencesDraft = { name: '学习者', lrGoal: '650', speakingGoal: '130', examDate: '2026-12-20', dailyMinutes: '25', weeklyTarget: '4', timezone: 'Asia/Shanghai' };
  let returnTarget = { page: 'library', state: 'default', scroll: 0 };
  let selectedRecording = 'notice', playbackExpanded = false;
  const recordingFixtures = [
    { id: 'notice', title: '朗读 · 图书馆通知', date: '2026-10-13 · 07:54', duration: 38, status: '已同步', task: '朗读短文' },
    { id: 'picture', title: '图片描述 · 办公场景', date: '2026-10-11 · 20:16', duration: 26, status: '本机录音', task: '描述图片' }
  ];
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const action = (label, key, primary = false, extra = '') => `<button type="button" class="button ${primary ? 'primary' : ''}" data-resource-action="${key}" ${extra}>${label}</button>`;
  const go = (label, route, next = 'default', primary = false) => action(label, 'go', primary, `data-resource-page="${route}" data-resource-state="${next}"`);
  const notice = (title, body, error = false) => `<div class="rv-notice ${error ? 'rv-error' : ''}" ${error ? 'role="alert"' : 'role="status"'}><strong>${title}</strong>${body ? `<p>${body}</p>` : ''}</div>`;
  const wrap = html => `<div class="rv-page">${html}<p class="rv-demo">隔离设计演示 · 记录与文件均为合成样例；不访问网络、不读写学习数据。</p></div>`;
  const back = (label = '返回资料库', route = 'library', next = 'default') => `<div class="rv-return">${go(`← ${label}`, route, next)}</div>`;
  const sourceLink = (label, url) => `<a class="button" href="${escape(url)}" target="_blank" rel="noopener noreferrer" data-resource-action="open-source">${label} ↗</a>`;
  function selectMaterial(id) {
    const selected = materialFixtures.find(item => item.id === id);
    if (!selected) return false;
    materialRecords.set(material.id, { resourceVisited, resourceSaved, resourceMinutes, resourceCheckinFixture, materialStats: { ...materialStats }, resourceDraft: { ...resourceDraft } });
    material = selected;
    const old = materialRecords.get(id);
    resourceVisited = old?.resourceVisited || false;
    resourceSaved = old?.resourceSaved || false;
    resourceMinutes = old?.resourceMinutes || selected.minutes;
    resourceCheckinFixture = old?.resourceCheckinFixture || null;
    materialStats = old?.materialStats || { visits: 0, minutes: 0 };
    resourceDraft = old?.resourceDraft || { minutes: String(selected.minutes), load: '刚好', note: '' };
    return true;
  }

  const legacyLibraryContent = libraryContent;
  libraryContent = function () {
    if (['local', 'cloud', 'signed-out', 'error'].includes(state)) return legacyLibraryContent();
    const shown = materialFixtures.filter(item => libraryFilter === 'all' || item.categoryId === libraryFilter);
    return wrap(header('资料库', '选一份材料，按步骤完成，再记下实际学习。', '学习资料') +
      `<div class="segmented"><button class="active" aria-pressed="true" data-resource-action="filter-materials" data-resource-filter="all">学习资料</button><button data-resource-action="go" data-resource-page="library" data-resource-state="local">本机题包</button><button data-resource-action="go" data-resource-page="library" data-resource-state="cloud">私人云库</button></div><div class="rv-meta rv-top">${[['all', '全部'], ['official', '托业官方'], ['listening', '听力精听'], ['reading', '阅读积累'], ['speaking', '开口表达']].map(([id, label]) => `<button type="button" class="chip ${libraryFilter === id ? 'active' : ''}" aria-pressed="${libraryFilter === id}" data-resource-action="filter-materials" data-resource-filter="${id}">${label}</button>`).join('')}</div><section class="panel rv-block"><div class="rv-row-title"><div><h2>选一份，做 5–15 分钟</h2><p class="muted small">打开材料与学完打卡分开，不自动记为完成。</p></div></div>${shown.map(item => `<div class="resource"><span class="resource-icon" aria-hidden="true">▤</span><div><h3>${item.title}</h3><p>${item.provider} · ${item.minutes} 分钟 · ${item.parts}</p><p class="muted small">${item.description}</p><span class="tag neutral">${item.category} · 原站使用</span></div><button type="button" class="button compact" data-resource-action="view-material" data-resource-id="${item.id}" aria-label="查看${item.title}">查看 →</button></div>`).join('')}${shown.length ? '' : `<p class="muted">本稿未展开这个分类的代表条目；现有资料仍保留，不是空库。</p><div class="rv-actions">${action('查看三个代表材料', 'filter-materials', false, 'data-resource-filter="all"')}</div>`}<p class="rv-footnote">现有资料共15个入口；本稿展开3个，其余12个沿用原元数据和同一详情模板，不新增材料。</p></section><div class="rv-actions">${go('生词与词卡记录备份', 'backups')}${go('内容与来源', 'about')}</div>`);
  };
  window.designExtras.library = () => libraryContent();

  window.designExtras['resource-detail'] = () => {
    const learned = state === 'learned' || resourceSaved;
    const visits = resourceSaved ? materialStats.visits : learned ? 2 : 0;
    const minutes = resourceSaved ? materialStats.minutes : learned ? 24 : 0;
    return wrap(back() + header(material.title, material.description, '资料 · 材料详情') +
      `<div class="rv-detail-grid"><section class="panel rv-block"><div class="rv-meta"><span class="tag neutral">${material.provider}</span><span>${material.category} · ${material.parts}</span><span>建议 ${material.minutes} 分钟</span></div><h2>按步骤，完成这一份</h2><ol class="rv-steps">${material.steps.map((s, i) => `<li><span class="rv-step">${i + 1}</span><div><p>${s}</p></div></li>`).join('')}</ol><div class="rv-actions">${sourceLink('打开原站材料', material.url)}${action('学完记一笔', 'resource-record', true)}</div>${state === 'external-error' ? notice('原站暂时无法打开', '本应用里的步骤与既有打卡保留。可以稍后重试原站，不把打开失败记为学习完成。', true) : resourceVisited ? notice('已经打开材料入口', '回到这里记录实际学习；打开原站不会自动增加学习次数。') : ''}</section><aside><section class="panel rv-block"><h2>访问与内容</h2><p>${material.access}</p><div class="rv-meta rv-inline">${material.hasAudio ? '<span class="tag neutral">音频</span>' : '<span class="tag neutral">阅读材料</span>'}${material.hasTranscript ? '<span class="tag neutral">对话文字</span>' : ''}<span class="tag neutral">外站使用</span></div><p class="muted small">${material.rights}</p>${go('查看来源说明', 'about')}</section><section class="panel rv-block rv-top"><h2>我的学习记录</h2>${visits ? `<p class="rv-large">${visits}<small> 次 · ${minutes} 分钟</small></p><p class="muted small">演示汇总，来自这份材料的打卡。</p>` : `<p>还没有这份材料的学习记录。</p><p class="muted small">学完后如实记录用时，5 分钟也可以。</p>`}</section></aside></div>`);
  };

  window.designExtras['resource-checkin'] = () => {
    if (state === 'saved') return wrap(back('返回材料', 'resource-detail', 'learned') + `<section class="panel rv-form"><span class="tag neutral">${material.title}</span><h1>这次学习，记下了。</h1><p class="rv-top">${resourceMinutes} 分钟 · 负荷${escape(resourceDraft.load)}${resourceDraft.note ? ` · ${escape(resourceDraft.note)}` : ''}</p><p class="muted small">演示成功状态；真实页面保存成功后，材料次数与分钟才更新。</p><div class="rv-actions">${go('回到这份材料', 'resource-detail', 'learned', true)}${go('浏览其他资料', 'library')}</div></section>`);
    return wrap(`<div class="rv-return">${action('← 返回材料', 'resource-return')}</div>` + header('记下这份材料的收获', material.title, '资料 · 学习打卡') +
      `<form class="panel rv-form" data-resource-form="checkin"><p class="rv-context">当前材料：${material.title}</p><label class="rv-field">实际学习分钟<input name="minutes" type="number" min="1" max="240" step="1" required value="${escape(resourceDraft.minutes)}"><small>填写实际用时，1–240 分钟。</small></label><fieldset class="rv-field"><legend>今天的负荷</legend><div class="rv-radios">${['轻', '刚好', '重'].map(v => `<label><input name="load" type="radio" value="${v}" ${resourceDraft.load === v ? 'checked' : ''}>${v}</label>`).join('')}</div></fieldset><label class="rv-field">一个收获或卡点 · 可选<textarea name="note" maxlength="1000" rows="4" placeholder="例如：第一次没听清 budget，复听后能抓住谈话目的。">${escape(resourceDraft.note)}</textarea><small>最多 1000 字；记录关联这份材料。</small></label>${state === 'save-error' ? notice('学习记录未保存', '分钟、负荷与手记仍在当前页。重试成功后再返回材料，既有记录保持。', true) : ''}<div class="rv-actions">${action(state === 'save-error' ? '重试保存' : '保存这次学习', 'save-resource', true)}${action('暂不记录', 'resource-return')}</div><p class="muted small">打开材料与记录学习是两个动作；取消不会新增打卡。</p></form>`);
  };

  const select = (name, label, options) => `<label class="rv-field">${label}<select name="${name}">${options.map(([value, text]) => `<option value="${value}" ${preferencesDraft[name] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  window.designExtras.preferences = () => {
    if (state === 'saved') return wrap(back('返回外观与偏好', 'settings') + header('学习偏好已更新', '目标和节奏随时可以调整。', '设置') + `<section class="panel rv-block"><dl class="rv-facts"><div><dt>称呼</dt><dd>${escape(preferencesDraft.name)}</dd></div><div><dt>听读目标</dt><dd>${preferencesDraft.lrGoal}</dd></div><div><dt>听读考期</dt><dd>${preferencesDraft.examDate || '尚未设置'}</dd></div><div><dt>每天可用时间</dt><dd>${preferencesDraft.dailyMinutes} 分钟</dd></div><div><dt>每周启动</dt><dd>${preferencesDraft.weeklyTarget} 天</dd></div><div><dt>学习时区</dt><dd>${preferencesDraft.timezone}</dd></div></dl>${notice('仅原型内存中的成功演示', '正式界面由已有保存结果确定成功；主题偏好和其他记录保持。')}${go('返回今日', 'home', 'default', true)}</section>`);
    return wrap(back('返回外观与偏好', 'settings') + header('设定自己的下一程', '目标、考期和时间预算，以你能持续完成为准。', '学习偏好') +
      `<div class="rv-detail-grid"><form class="panel rv-form" data-resource-form="preferences"><label class="rv-field">称呼<input name="name" maxlength="40" required value="${escape(preferencesDraft.name)}"><small>只是显示称呼，不是登录账号。</small></label><div class="rv-two-fields"><label class="rv-field">听读目标<input name="lrGoal" type="number" min="10" max="990" step="5" required value="${preferencesDraft.lrGoal}"></label><label class="rv-field">口语目标<input name="speakingGoal" type="number" min="0" max="200" step="10" required value="${preferencesDraft.speakingGoal}"></label></div><label class="rv-field">听读考试日期<input name="examDate" type="date" value="${preferencesDraft.examDate}"><small>可以留空；当前计划优先听读。</small></label><div class="rv-two-fields">${select('dailyMinutes', '每天可用时间', ['5', '15', '25', '45', '60'].map(v => [v, v + ' 分钟']))}${select('weeklyTarget', '每周启动目标', ['3', '4', '5', '6', '7'].map(v => [v, v + ' 天']))}</div>${select('timezone', '学习时区', [['Asia/Shanghai', '北京时间'], ['Asia/Tokyo', '东京时间'], ['America/Los_Angeles', '美国太平洋时间'], ['Europe/London', '伦敦时间'], ['Etc/UTC', 'UTC']])}${state === 'save-error' ? notice('偏好还未保存', '保留当前输入。请重试；原目标、主题与学习记录不会因失败被替换。', true) : ''}<div class="rv-actions">${action(state === 'save-error' ? '重试保存' : '保存学习偏好', 'save-preferences', true)}${go('取消', 'settings')}</div></form><aside class="panel rv-block"><h2>一个可持续的目标</h2><p>先留下真实学习记录，再逐步调整。漏一天不需要加倍补课。</p><p class="muted small">这里修改学习目标与节奏；界面主题在「外观」选择。</p><div class="rv-links">${go('选择界面主题', 'settings')}${go('记录与备份', 'backups')}${go('使用与安装', 'install')}</div></aside></div>`);
  };

  window.designExtras.backups = () => {
    const extra = state === 'exported' ? notice('已发起演示导出', '正式界面应提示到下载目录确认文件存在。此原型没有生成文件，也没有读取真实备份。') : '';
    let detail = '';
    if (['word-import', 'word-import-error', 'word-imported'].includes(state)) detail = `<section class="panel rv-block rv-top"><span class="tag neutral">词库独立 JSON</span><h2>${state === 'word-imported' ? '词库记录已合并' : '合并词库备份'}</h2><p class="rv-top">${state === 'word-imported' ? '演示：新增 6 条事件，原收藏与复习记录保持。' : '选择已有词库记录 JSON，格式校验成功后合并事件，不覆盖原收藏与复习记录。'}</p><p class="muted small">单份不超过 20 MB；不导入整部通用词典，不包含听读成绩。</p>${state === 'word-import-error' ? notice('格式或事件校验未通过', '原记录未改动。保留原文件，核对备份版本后再试。', true) : ''}<div class="rv-actions">${action(state === 'word-imported' ? '完成' : '选择演示 JSON 并校验', state === 'word-imported' ? 'backup-home' : 'merge-words', true)}${action('返回备份列表', 'backup-home')}</div></section>`;
    if (['exam-restore', 'exam-restore-error'].includes(state)) detail = `<section class="panel rv-block rv-top"><span class="tag neutral">模考完整备份</span><h2>回到本机题包后恢复</h2><p class="rv-top">完整备份包含题包、答案、音频、图像及本机考试记录。仅同一记录范围可恢复，使用现有校验与合并流程。</p>${state === 'exam-restore-error' ? notice('恢复未完成', '格式、范围或存储校验失败。原题包和考试记录保留，不能显示恢复成功。', true) : ''}<div class="rv-actions">${go('去本机题包与记录', 'library', 'local', true)}${action('返回备份列表', 'backup-home')}</div></section>`;
    return wrap(back('返回外观与偏好', 'settings') + header('把记录分别保留', '三类备份用途不同；导出前先确认当前账号或本机范围。', '记录与备份') + extra +
      `<div class="rv-backup-list"><section class="panel rv-block"><div class="rv-row-title"><span class="rv-number">01</span><div><h2>听读与口语学习记录</h2><p class="muted small">目标、作答、打卡、录音的日期与信息</p></div></div><p>学习记录 JSON <strong>不包含录音文件</strong>，也不包含个人模考题包。</p><div class="rv-actions">${action('导出学习记录 JSON', 'export-learning', true)}${go('查看录音历史', 'recordings')}</div><p class="rv-footnote">本轮保留已有导出入口，不新增学习 JSON 恢复界面。录音文件需通过既有可用方式单独保留。</p></section><section class="panel rv-block"><div class="rv-row-title"><span class="rv-number">02</span><div><h2>生词与词卡记录</h2><p class="muted small">收藏标记、词卡反馈和复习事件</p></div></div><p>词库备份独立导出；导入时合并事件并保留旧词条与记录。</p><div class="rv-actions">${action('导出词库记录', 'export-words')}${action('导入词库记录', 'import-words')}</div></section><section class="panel rv-block"><div class="rv-row-title"><span class="rv-number">03</span><div><h2>模考完整备份</h2><p class="muted small">本机题包、媒体、答案与考试记录</p></div></div><p>个人题包云库只保存题包，不能代替本机考试备份。完整备份可能很大，须确认下载已完成。</p><div class="rv-actions">${go('打开本机题包与备份', 'library', 'local')}${action('查看恢复范围', 'exam-backup')}</div></section></div>${detail}`);
  };

  window.designExtras.install = () => {
    const native = state === 'native', preview = state === 'preview';
    return wrap(back('返回外观与偏好', 'settings') + header(native ? '鸿蒙本机模式' : '把微光放到桌面', native ? '离线练习留在这台设备，在线版另用安全登录。' : '网页与添加桌面的版本使用同一站点身份。', '使用方式') +
      `<div class="rv-detail-grid"><section class="panel rv-block"><span class="tag neutral">${native ? '原生 App · 本机' : preview ? '未登录 · 本机预览' : '网页版 / PWA'}</span><h2 class="rv-top">${native ? '本机记录，安全保留' : 'HarmonyOS 系统浏览器'}</h2>${native ? `<p>练习、词库、设置和录音目前保存在本机。App 内尚未接入跨端账号同步；个人云题包通过系统浏览器登录、下载 JSON 后再导入。</p><div class="rv-actions">${sourceLink('打开同步网页版', 'https://lantern-toeic-godnight.zhuangzeliang.chatgpt.site')}${go('查看备份入口', 'backups')}</div>` : `<ol class="rv-steps"><li><span class="rv-step">1</span><p>在系统浏览器打开有权限的微光网页。</p></li><li><span class="rv-step">2</span><p>使用同一个 ChatGPT 账号登录。</p></li><li><span class="rv-step">3</span><p>打开浏览器菜单，选择「添加至桌面」或「安装应用」。</p></li></ol>${preview ? notice('当前是本机预览', '正式私有站点登录后才启用账号同步。本机预览与登录账号的记录范围不同。') : notice('同步范围', '网页学习记录与词库按当前账号同步；模考记录仍在作答设备。')}<div class="rv-actions">${action('查看安装按钮状态', 'install-demo')}${go('确认记录与备份', 'backups')}</div>`}</section><aside class="panel rv-block"><h2>更新或换设备前</h2><p>先正常导出需要保留的记录。不要以卸载或清理数据处理升级问题。</p><p>录音需要麦克风权限；首次打开与云端同步需要网络。</p><p class="muted small">手机号登录与原生账号同步仍未启用；不显示可用的短信入口。</p>${go('内容与来源说明', 'about')}</aside></div>`);
  };

  window.designExtras.about = () => wrap(back('返回资料库') + header(state === 'themes' ? '四套主题，同一学习空间' : '内容从哪里来', '来源、用途与学习记录分开说明。', '来源与说明') +
    `<div class="rv-about-grid"><section class="panel rv-block"><h2>原创练习与场景词</h2><p>68 道原创听读题、5 类口语任务；807 个场景词和55个题内表达。内容含 AI 辅助整理，未等同真人教师校审或正式统计标定。</p><p class="muted small">原创文本按 CC BY 4.0 分享。原创听力使用合成语音或设备系统朗读，不是官方考试音频。</p>${go('打开原创练习', 'practice')}</section><section class="panel rv-block"><h2>通用英汉查词</h2><p>数据来自中文维基词典贡献者与 Kaikki 提取，按 CC BY-SA 4.0 使用；已简体转换、归并和节选。</p><p class="muted small">通用词典不代表托业考纲。来源与编辑历史保留在实际词条详情；不搬运第三方例句或音频。</p>${go('打开查词', 'search')}</section><section class="panel rv-block"><h2>官方与外部材料</h2><p>官方资料和其他课程通过原站访问。这里保存链接、学习步骤和个人打卡，不把公开入口说成内置完整真题。</p><p class="muted small">费用、地区访问、播放器与素材使用范围以原站为准；引用和再分发权限分别核对。</p>${go('查看一份材料', 'resource-detail')}</section><section class="panel rv-block"><h2>主题与参考素材</h2><p>默认日间、夜间没有游戏元素。空洞骑士与丝之歌使用原创视觉表达；主题切换不改变学习内容或记录。</p><p class="muted small">既有 AI 同人插画保留用户提供/生成来源；原作参考是外链，不代表取得游戏素材再分发授权。应用与 ETS、Team Cherry 无官方关联。</p>${go('查看四套主题', 'settings')}</section></div><section class="panel rv-block rv-top"><h2>记录和账号范围</h2><p>显示称呼与登录身份分开。网页使用当前有权限账号；鸿蒙原生当前为本机模式。题包云库不自动同步模考成绩。</p><div class="rv-actions">${go('学习偏好', 'preferences')}${go('记录与备份', 'backups')}${go('添加桌面与使用方式', 'install')}${go('录音历史', 'recordings')}</div></section>`);

  window.designExtras.recordings = () => {
    const chosen = recordingFixtures.find(r => r.id === selectedRecording) || recordingFixtures[0];
    const empty = state === 'empty', showPlayback = ['replay', 'read-error'].includes(state) || playbackExpanded;
    return wrap(back('返回口语练习', 'practice', 'speaking') + header('回听自己的表达', '按练习发生时间保留；每次只找一个可以改进的地方。', '录音历史') +
      (empty ? `<section class="panel rv-block rv-empty"><h2>还没有口语录音</h2><p>完成一次录音后，这里会显示任务、日期、时长与保存范围。</p>${go('去练一次口语', 'practice', 'speaking', true)}</section>` : `<div class="rv-detail-grid"><section class="panel rv-block"><div class="rv-meta"><span>${recordingFixtures.length} 段 · 合成样例</span><span>北京时间显示练习日期</span></div>${recordingFixtures.map(r => `<button type="button" class="rv-recording ${chosen.id === r.id && showPlayback ? 'rv-selected' : ''}" data-resource-action="replay" data-recording="${r.id}" aria-label="回放${r.title}"><span class="rv-play" aria-hidden="true">${playIcon()}</span><span><strong>${r.title}</strong><small>${r.date} · ${r.duration} 秒</small><span class="tag neutral">${state === 'local' ? '本机录音' : r.status}</span></span><span aria-hidden="true">→</span></button>`).join('')}<p class="rv-footnote">「已同步」只用于该录音实际上传成功；原生始终明确本机保存。</p></section><aside class="panel rv-block">${showPlayback ? `<span class="tag neutral">${chosen.task}</span><h2 class="rv-top">${chosen.title}</h2><p class="muted small">${chosen.date} · ${chosen.duration} 秒 · ${state === 'local' ? '本机录音' : chosen.status}</p>${state === 'read-error' ? notice('录音暂时无法读取', '保留录音信息和既有记录。可以重试读取，不把读取失败当作没有录音。', true) : `<div class="rv-player" aria-label="录音回放视觉示意"><span class="rv-play">${playIcon()}</span><div class="track"><span style="width:0"></span></div><span>0:00 / 0:${chosen.duration}</span></div><p class="rv-footnote">演示文件没有声音；正式页面沿用已有音频播放器，可播放、暂停与拖动。</p>`}<div class="rv-actions">${state === 'read-error' ? action('重试读取', 'retry-recording', true) : action('关闭回放', 'close-recording')}${go('再练一次', 'practice', 'speaking')}</div>` : `<h2>选择一段录音回听</h2><p>先听完整，再挑一个语音或表达问题。回放不生成 AI 分数。</p>`}</aside></div>`));
  };
  function playIcon() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>'; }

  function readForm(form) {
    const values = Object.fromEntries(new FormData(form));
    if (form.dataset.resourceForm === 'checkin') resourceDraft = { ...resourceDraft, ...values };
    if (form.dataset.resourceForm === 'preferences') preferencesDraft = { ...preferencesDraft, ...values };
  }
  document.addEventListener('input', e => { const form = e.target.closest('[data-resource-form]'); if (form) { if (e.target.name === 'name') e.target.setCustomValidity(''); readForm(form); } }, { capture: true });
  document.addEventListener('change', e => { const form = e.target.closest('[data-resource-form]'); if (form) readForm(form); }, { capture: true });
  document.addEventListener('submit', e => { if (e.target.matches('[data-resource-form]')) { e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true });
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-resource-action]');
    if (!target) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const key = target.dataset.resourceAction;
    if (key === 'go') { navigate(target.dataset.resourcePage, target.dataset.resourceState || 'default'); return; }
    if (key === 'view-material') { if (selectMaterial(target.dataset.resourceId)) navigate('resource-detail', 'default'); return; }
    if (key === 'filter-materials') { libraryFilter = target.dataset.resourceFilter || 'all'; render(); return; }
    if (key === 'open-source') { if (page === 'resource-detail') resourceVisited = true; toast('仅原站入口演示 · 本次不打开网络页面，也不增加学习记录'); if (page === 'resource-detail') render(); return; }
    if (key === 'resource-record') { returnTarget = { page, state, scroll: window.scrollY }; if (!resourceSaved) materialStats = state === 'learned' ? { visits: 2, minutes: 24 } : { visits: 0, minutes: 0 }; resourceDraft = { minutes: String(material.minutes), load: '刚好', note: '' }; navigate('resource-checkin'); return; }
    if (key === 'resource-return') { navigate(returnTarget.page, returnTarget.state); window.scrollTo(0, returnTarget.scroll); return; }
    if (key === 'save-resource' || key === 'save-preferences') {
      const form = target.closest('form'); readForm(form);
      if (!form.reportValidity()) return;
      if (key === 'save-resource') { resourceMinutes = Number(resourceDraft.minutes); resourceCheckinFixture = { id: 'synthetic-resource-checkin', date: '2026-10-13', minutes: resourceMinutes, load: resourceDraft.load, note: (`[资源:${material.id}] ${material.title}\n${resourceDraft.note}`).slice(0, 1000), createdAt: '2026-10-13T00:00:00.000Z' }; materialStats = { visits: materialStats.visits + 1, minutes: materialStats.minutes + resourceMinutes }; resourceSaved = true; state = 'saved'; }
      else { preferencesDraft.name = preferencesDraft.name.trim(); if (!preferencesDraft.name) { form.elements.name.setCustomValidity('请填写称呼'); form.elements.name.reportValidity(); return; } state = 'saved'; }
      render(); window.scrollTo(0, 0); return;
    }
    if (key === 'export-learning' || key === 'export-words') { state = 'exported'; render(); return; }
    if (key === 'import-words') { state = 'word-import'; render(); return; }
    if (key === 'merge-words') { state = 'word-imported'; render(); return; }
    if (key === 'exam-backup') { state = 'exam-restore'; render(); return; }
    if (key === 'backup-home') { state = 'default'; render(); return; }
    if (key === 'install-demo') { toast('仅安装入口示意 · 此原型不触发安装；正式站点有系统安装提示时才显示按钮'); return; }
    if (key === 'replay') { selectedRecording = target.dataset.recording; playbackExpanded = true; state = 'replay'; render(); document.querySelector('.rv-player')?.focus?.({ preventScroll: true }); return; }
    if (key === 'retry-recording') { state = 'replay'; playbackExpanded = true; render(); return; }
    if (key === 'close-recording') { playbackExpanded = false; state = 'default'; render(); document.querySelector(`[data-recording="${selectedRecording}"]`)?.focus({ preventScroll: true }); }
  }, { capture: true });

  window.resourcesV11 = {
    routes: Object.keys(routes), get materialId() { return material.id; },
    materials: materialFixtures.map(({ id, title, provider, url }) => ({ id, title, provider, url })),
    selectMaterial,
    get checkinContract() { return `note:[资源:${material.id}] ${material.title}\n<用户手记>; minutes整数1–240; load轻/刚好/重; 总note最多1000字`; },
    lastCheckinFixture: () => resourceCheckinFixture,
    sourceEvidence: ['app/learn/resource-library.tsx', 'app/study-app.tsx:108-115', 'app/learn/vocabulary-library.tsx:75', 'lib/study-backup.ts:20-22'],
    entry: (id = 'voa-budget-cuts') => { if (selectMaterial(id)) navigate('resource-detail'); }
  };
})();
