#!/usr/bin/env node
'use strict';
// Private local conversion only. No OCR, downloading, answer inference or rights certification.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');

const LIMITS = Object.freeze({recipe: 1024 * 1024, pdf: 128 * 1024 * 1024,
  allPdfs: 256 * 1024 * 1024, documents: 8, pagesPerPdf: 1000,
  edge: 6000, pixels: 16000000, processMs: 90000, stdout: 1024 * 1024});
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
class PackerError extends Error { constructor(code, text) { super(text); this.name='PackerError'; this.code=code; } }
const fail = (code, text) => { throw new PackerError(code, text); };
function check(ok, code, text) { if (!ok) fail(code, text); }
function record(v, allowed, label) {
  check(v && typeof v==='object' && !Array.isArray(v), 'RECIPE', `${label}必须是对象。`);
  check(Object.keys(v).every(k=>allowed.includes(k)), 'RECIPE', `${label}含不支持字段。`);
}
function integer(n, min, max) { return Number.isSafeInteger(n) && n>=min && n<=max; }
function within(base, target) { const rel=path.relative(base,target); return rel==='' || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel)); }
function privateLocation(value) {
  check(!value.split(/[\\/]+/).some(p=>['public','content','harmony','.git','node_modules','dist'].includes(p.toLowerCase())),
    'PRIVATE_LOCATION', '配方与输出必须位于私人目录，不能使用产品资源或发布目录。');
}
function relativeFile(value) {
  check(typeof value==='string' && value.length>0 && value.length<=500 && !path.win32.isAbsolute(value) && !path.posix.isAbsolute(value), 'PATH', '文件必须使用配方目录内的相对路径。');
  const parts=value.split(/[\\/]/);
  check(parts.every(p=>p && p!=='.' && p!=='..' && !/[<>:"|?*\x00-\x1f]/.test(p) && !/[ .]$/.test(p) && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p)),
    'PATH', '文件路径不能包含 URL、越界、设备名或特殊路径。');
  return parts.join(path.sep);
}
async function resolveLocalFile(base, value, maxBytes) {
  const candidate=path.resolve(base,relativeFile(value));
  check(within(base,candidate), 'PATH', '文件路径越出配方目录。');
  let real, stat;
  try { real=await fsp.realpath(candidate); stat=await fsp.stat(real); } catch { fail('INPUT_FILE','输入文件不存在或无法读取。'); }
  check(within(base,real), 'PATH', '文件链接越出配方目录。');
  check(stat.isFile() && stat.size>0 && stat.size<=maxBytes, 'INPUT_SIZE', '输入必须是限额内的普通文件。');
  return {real,size:stat.size};
}
async function readBounded(file, maxBytes) {
  let handle;
  try {
    handle=await fsp.open(file,'r');
    const stat=await handle.stat();
    check(stat.isFile() && stat.size>0 && stat.size<=maxBytes, 'INPUT_SIZE', '输入必须是限额内的普通文件。');
    // A bounded read also prevents a concurrently growing file from exhausting memory.
    const data=Buffer.alloc(stat.size); let position=0;
    while(position<data.length) { const r=await handle.read(data,position,data.length-position,position); if(!r.bytesRead)break; position+=r.bytesRead; }
    const after=await handle.stat();
    check(position===data.length && after.size===stat.size && after.mtimeMs===stat.mtimeMs, 'INPUT_CHANGED', '输入在读取期间发生变化，请重试。');
    return data;
  } catch(e) { if(e instanceof PackerError)throw e; fail('INPUT_FILE','输入文件无法读取。'); }
  finally { if(handle)await handle.close(); }
}
function loadModel(repoRoot=process.env.LANTERN_EXAM_ROOT || path.resolve(__dirname,'..')) {
  try {
    const ts=require(process.env.LANTERN_TYPESCRIPT || path.join(repoRoot,'node_modules','typescript'));
    const code=ts.transpileModule(fs.readFileSync(path.join(repoRoot,'lib','exam-model.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports={};
    vm.runInNewContext(code,{exports,require(){throw new Error('Unexpected model import');},TextEncoder,Uint8Array,Uint32Array,ArrayBuffer,Blob,URL,atob,btoa,crypto:crypto.webcrypto},{timeout:10000});
    check(typeof exports.parseExamPackage==='function','MODEL','缺少题包校验器。');
    return exports;
  } catch(e) { if(e instanceof PackerError)throw e; fail('MODEL','无法加载项目的 TypeScript 题包校验器。'); }
}
function refKey(ref) { return `${ref.documentId}:${ref.page}`; }
function validateRecipe(r, model) {
  record(r,['kind','schemaVersion','exam','documents','audioFile','answers','groups','pageReview','audioReviewed'],'配方');
  check(r.kind==='lantern-exam-page-recipe' && r.schemaVersion===1,'RECIPE','配方格式或版本不支持。');
  record(r.exam,['id','version','title','source'],'试卷信息');
  check(ID.test(r.exam.id) && integer(r.exam.version,1,1000000),'RECIPE','题包 ID 或版本无效。');
  record(r.pageReview,['reviewed','excludedPages'],'页面核对');
  check(r.pageReview.reviewed===true && r.audioReviewed===true,'REVIEW_REQUIRED',
    '须先人工核对引用页无答案解析、听力页不含阅读材料，以及题本/答案/音轨同卷完整，再设置 pageReview.reviewed 和 audioReviewed 为 true。');
  check(Array.isArray(r.documents) && r.documents.length>0 && r.documents.length<=LIMITS.documents,'RECIPE','PDF 文档数量无效。');
  const docs=new Map();
  for(const d of r.documents) {
    record(d,['id','file'],'PDF 文档');
    check(typeof d.id==='string' && ID.test(d.id) && !docs.has(d.id),'RECIPE','PDF 文档 ID 无效或重复。');
    relativeFile(d.file); check(/\.pdf$/i.test(d.file),'RECIPE','文档只接受 PDF 文件。'); docs.set(d.id,d);
  }
  relativeFile(r.audioFile); check(/\.(mp3|wav)$/i.test(r.audioFile),'AUDIO','音频只接受本地 MP3 或 WAV。');
  check(Array.isArray(r.answers) && r.answers.length===200,'ANSWERS','答案必须恰好包含 200 项。');
  for(let n=1;n<=200;n++)check(typeof r.answers[n-1]==='string' && (model.questionPart(n)===2?/^[ABC]$/:/^[ABCD]$/).test(r.answers[n-1]),'ANSWERS','答案须为大写 A-D，Part 2 只能为 A-C。');
  const parseRef=(v)=>{record(v,['documentId','page'],'页码引用');check(typeof v.documentId==='string' && docs.has(v.documentId) && integer(v.page,1,LIMITS.pagesPerPdf),'PAGE','页码引用不存在或超出限额。');};
  check(Array.isArray(r.pageReview.excludedPages) && r.pageReview.excludedPages.length<=LIMITS.pagesPerPdf*LIMITS.documents,'PAGE','必须显式提供 excludedPages 列表，可为空。');
  const excluded=new Set();
  for(const ref of r.pageReview.excludedPages){parseRef(ref);check(!excluded.has(refKey(ref)),'PAGE','排除页重复。');excluded.add(refKey(ref));}
  check(Array.isArray(r.groups) && r.groups.length>0 && r.groups.length<=200,'GROUP','题组数量无效。');
  const used=new Set();
  for(const g of r.groups) {
    record(g,['id','part','questionNumbers','passageCount','pages'],'题组');
    check(typeof g.id==='string' && ID.test(g.id) && integer(g.part,1,7) && integer(g.passageCount,0,3),'GROUP','题组 ID、Part 或材料篇数无效。');
    check(g.part>5 || g.passageCount===0,'GROUP','Part 1-5 的 passageCount 应为 0。');
    check(Array.isArray(g.questionNumbers) && g.questionNumbers.length>0 && g.questionNumbers.length<=5 && g.questionNumbers.every(n=>integer(n,1,200)),'GROUP','题组题号无效。');
    check(Array.isArray(g.pages) && g.pages.length<10 && (g.part===2 || g.pages.length>0),'PAGE','除 Part 2 外，每个题组必须映射原页图片（最多 9 页）。');
    const ownRefs=new Set();
    for(const ref of g.pages){parseRef(ref);check(!excluded.has(refKey(ref)) && !ownRefs.has(refKey(ref)),'PAGE','引用页与排除页重叠或组内重复。');ownRefs.add(refKey(ref));used.add(ref.documentId);}
  }
  check(r.documents.every(d=>used.has(d.id)),'PAGE','每个 PDF 文档必须有实际引用页。');
  // Use the real parser for complete 200-question/group/metadata structure before rendering.
  const fakeImage={mime:'image/jpeg',base64:Buffer.from([255,216,255,217]).toString('base64')};
  const fakeAudio={mime:'audio/wav',base64:Buffer.from('RIFF0000WAVE').toString('base64')};
  const assets=new Map();let i=0;
  for(const g of r.groups)for(const ref of g.pages)if(!assets.has(refKey(ref)))assets.set(refKey(ref),{id:`page-${++i}`,...fakeImage});
  check(assets.size+1<=model.EXAM_LIMITS.assets,'PAGE','引用页数量超过题包素材限额。');
  buildPackage(r,assets,fakeAudio,model);
  return r;
}
function buildPackage(recipe, pageAssets, audio, model) {
  const groups=recipe.groups.map(g=>({id:g.id,part:g.part,questionNumbers:g.questionNumbers,passages:Array(g.passageCount).fill(''),imageIds:g.pages.map(p=>pageAssets.get(refKey(p)).id)}));
  const questions=groups.flatMap(g=>g.questionNumbers.map(number=>({number,part:g.part,groupId:g.id,
    prompt:g.part===2?`请听音频，选择第 ${number} 题答案。`:`请查看本题组原页中的第 ${number} 题；题文及选项以原页为准。`,
    choices:g.part===2?['A','B','C']:['A','B','C','D'],answer:'ABCD'.indexOf(recipe.answers[number-1])}))).sort((a,b)=>a.number-b.number);
  const assets=[...new Map([...pageAssets.values()].map(a=>[a.id,a])).values(),{id:'listening-audio',...audio}];
  try{return model.parseExamPackage({kind:'lantern-toeic-exam',schemaVersion:1,...recipe.exam,listeningAudioId:'listening-audio',assets,groups,questions});}
  catch{fail('MODEL_VALIDATION','题包未通过现行 200 题结构、素材、来源或容量校验；请核对配方。');}
}
function parsePdfInfo(text) {
  const value=(label)=>{
    const matches=text.split(/\r?\n/).filter(line=>line.startsWith(label+':'));
    check(matches.length===1,'PDF_METADATA','PDF 检查字段缺失或重复，无法确认文件状态。');
    return matches[0].slice(label.length+1).trim();
  };
  const encryption=value('Encrypted');
  // pdfinfo runs without passwords. Keep the source intact and only render when printing is allowed.
  const printable=/^yes \(print:yes copy:(?:yes|no) change:(?:yes|no) addNotes:(?:yes|no) algorithm:(?:RC4|AES|AES-256)\)$/.test(encryption);
  check((encryption==='no' || printable) && value('JavaScript')==='no' && value('Form')==='none','PDF_ACTIVE',
    'PDF 须无需密码即可打开并允许打印，且无 JavaScript、无交互表单；未知状态拒绝。');
  const count=Number(value('Pages'));
  check(integer(count,1,LIMITS.pagesPerPdf),'PDF_PAGES','PDF 页数无效或超过限额。');
  return {pages:count,encrypted:encryption!=='no',printingAllowed:true,javascript:false,form:'none'};
}
function parseAttachmentCount(text) {
  check(/^0 embedded files\s*$/.test(text.trim()),'PDF_ATTACHMENTS','PDF 附件检查失败或存在附件。');
  return 0;
}
function parsePageSize(text,page,dpi) {
  const re=new RegExp('^Page\\s+'+page+'\\s+size:\\s*([\\d.]+)\\s+x\\s+([\\d.]+)\\s+pts(?:\\s|$)','mi');
  const match=text.match(re);
  check(match,'PDF_DIMENSIONS','无法取得引用页的准确尺寸。');
  const width=Number(match[1]),height=Number(match[2]);
  const pixels=[Math.ceil(width*dpi/72),Math.ceil(height*dpi/72)];
  check(width>0 && height>0 && pixels.every(n=>integer(n,1,LIMITS.edge)) && pixels[0]*pixels[1]<=LIMITS.pixels,'PDF_DIMENSIONS','引用页渲染尺寸超过限额；请核对 PDF 或降低 DPI。');
  return {widthPoints:width,heightPoints:height,pixels};
}
function jpegSize(data) {
  check(data.length>=12 && data[0]===255 && data[1]===216 && data.at(-2)===255 && data.at(-1)===217,'RENDER','渲染文件不是完整的 JPEG 容器。');
  let pos=2;
  while(pos+4<data.length) {
    check(data[pos++]===255,'RENDER','JPEG 标记无效。');while(data[pos]===255)pos++;
    const marker=data[pos++]; if(marker===217 || marker===218)break;
    if(marker===1 || (marker>=208 && marker<=215))continue;
    const size=data.readUInt16BE(pos);check(size>=2 && pos+size<=data.length,'RENDER','JPEG 段长度无效。');
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      check(size>=8,'RENDER','JPEG 尺寸段无效。');return {width:data.readUInt16BE(pos+5),height:data.readUInt16BE(pos+3)};
    }pos+=size;
  }fail('RENDER','JPEG 缺少尺寸信息。');
}
function checkPageIdentities(recipe, documents) {
  const identity=(ref)=>`${documents.get(ref.documentId).sha256}:${ref.page}`;
  const excluded=new Set(recipe.pageReview.excludedPages.map(identity));
  const pages=new Map();
  for(const g of recipe.groups)for(const ref of g.pages) {
    const key=identity(ref),section=g.part<=4?'LC':'RC';
    check(!excluded.has(key),'EXCLUDED_PAGE','引用页与排除页重叠（包含文档别名或相同文件副本）。');
    const current=pages.get(key);
    check(!current || current.section===section,'CROSS_SECTION','同一 PDF 内容页不能同时用于听力与阅读。');
    if(!current)pages.set(key,{section,ref,uses:[]});
    const uses=pages.get(key).uses;
    check(!uses.some(u=>u.groupId===g.id),'PAGE','同一题组重复引用了相同内容页。');
    uses.push({documentId:ref.documentId,groupId:g.id,part:g.part,questionNumbers:g.questionNumbers});
  }
  return pages;
}
function runProcess(command,args,{timeoutMs=LIMITS.processMs,watchFile,maxFileBytes}={}) {
  return new Promise((resolve,reject)=>{
    let child,output='',outBytes=0,failure=null,settled=false,killGuard;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(monitor);clearTimeout(killGuard);error?reject(error):resolve(result);};
    const stop=(code,text)=>{if(failure || settled)return;failure=new PackerError(code,text);child?.kill('SIGKILL');killGuard=setTimeout(()=>finish(failure),5000);};
    let timer,monitor;
    try {child=spawn(command,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,LC_ALL:'C',LANG:'C'}});}
    catch {finish(new PackerError('POPPLER','无法启动 Poppler 工具。'));return;}
    timer=setTimeout(()=>stop('TIMEOUT','Poppler 步骤超时，已停止本次打包。'),Math.min(timeoutMs,LIMITS.processMs));
    if(watchFile)monitor=setInterval(()=>{try{if(fs.statSync(watchFile).size>maxFileBytes)stop('RENDER_SIZE','渲染页超过素材体积限额。');}catch{}},100);
    child.stdout.on('data',chunk=>{outBytes+=chunk.length;if(outBytes>LIMITS.stdout)stop('POPPLER_OUTPUT','Poppler 检查输出超过限额。');else output+=chunk.toString('utf8');});
    // Never log stderr: it can contain private paths, PDF metadata or text.
    let errBytes=0;child.stderr.on('data',chunk=>{errBytes+=chunk.length;if(errBytes>LIMITS.stdout)stop('POPPLER_OUTPUT','Poppler 诊断输出超过限额。');});
    child.once('error',()=>finish(new PackerError('POPPLER','无法启动 Poppler 工具。')));
    child.once('close',code=>finish(failure || (code===0?null:new PackerError('POPPLER','Poppler 检查或渲染失败；未输出题包。')),output));
  });
}
async function outputTarget(base,requested,defaultName) {
  const candidate=requested===undefined?path.join(base,defaultName):path.resolve(base,relativeFile(requested));
  check(within(base,candidate) && candidate!==base,'OUTPUT_PATH','输出必须是配方目录内的新子目录。');privateLocation(candidate);
  let parent;try{parent=await fsp.realpath(path.dirname(candidate));}catch{fail('OUTPUT_PATH','输出父目录必须已存在。');}
  check(within(base,parent),'OUTPUT_PATH','输出父目录链接越出配方目录。');privateLocation(parent);
  const result=path.join(parent,path.basename(candidate));
  try{await fsp.lstat(result);fail('OUTPUT_EXISTS','输出目录已存在；不会覆盖。');}catch(e){if(e instanceof PackerError)throw e;if(e.code!=='ENOENT')fail('OUTPUT_PATH','无法检查输出目录。');}
  return result;
}
async function publish(stage, target) {
  // mkdir is exclusive. Each hard-link exposes a complete validated file without clobbering.
  // The exam is linked last; a failed commit removes only files this invocation created.
  let made=false;const linked=[];
  try {
    await fsp.mkdir(target,{mode:0o700});made=true;
    for(const name of ['mapping-report.json','exam.json']) {await fsp.link(path.join(stage,name),path.join(target,name));linked.push(name);}
  } catch {
    for(const name of linked)await fsp.unlink(path.join(target,name)).catch(()=>{});
    if(made)await fsp.rmdir(target).catch(()=>{});
    fail('OUTPUT_WRITE','输出路径已存在或写入失败；未覆盖已有内容。');
  }
}
async function packExamPages(options, dependencies={}) {
  const model=dependencies.model || loadModel(), run=dependencies.runProcess || runProcess;
  check(options && typeof options.recipe==='string' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(options.recipe) && !/^[\\/]{2}/.test(options.recipe),'PATH','请指定本地配方 JSON，不能使用 URL 或网络共享路径。');
  const dpi=options.dpi===undefined?192:Number(options.dpi);
  check(integer(dpi,72,200),'DPI','DPI 必须是 72 到 200 的整数。');
  let recipePath;try{recipePath=await fsp.realpath(options.recipe);}catch{fail('INPUT_FILE','找不到配方文件。');}
  check(!/^[\\/]{2}/.test(recipePath),'PATH','配方链接不能指向网络共享路径。');
  const base=path.dirname(recipePath);privateLocation(base);
  let recipe;try{recipe=JSON.parse((await readBounded(recipePath,LIMITS.recipe)).toString('utf8').replace(/^\uFEFF/,''));}catch(e){if(e instanceof PackerError)throw e;fail('RECIPE','配方不是有效 JSON。');}
  validateRecipe(recipe,model);
  const target=await outputTarget(base,options.outDir,`packed-${recipe.exam.id}-v${recipe.exam.version}`);
  const pdfinfo=options.pdfinfo || 'pdfinfo', pdftoppm=options.pdftoppm || 'pdftoppm';
  const pdfdetach=options.pdfdetach || (options.pdfinfo?path.join(path.dirname(pdfinfo),process.platform==='win32'?'pdfdetach.exe':'pdfdetach'):'pdfdetach');
  const stage=await fsp.mkdtemp(path.join(base,'.lantern-page-packer-'));
  try {
    const documents=new Map(),snapshots=new Map();let pdfBytes=0;
    for(const doc of recipe.documents) {
      const input=await resolveLocalFile(base,doc.file,LIMITS.pdf);
      const bytes=await readBounded(input.real,LIMITS.pdf);check(bytes.subarray(0,5).toString('ascii')==='%PDF-','PDF','输入文档缺少 PDF 文件头。');
      const sha256=crypto.createHash('sha256').update(bytes).digest('hex');let info=snapshots.get(sha256);
      if(!info) {
        pdfBytes+=bytes.length;check(pdfBytes<=LIMITS.allPdfs,'INPUT_SIZE','PDF 总体积超过 256 MiB。');
        const snapshot=path.join(stage,`document-${snapshots.size+1}.pdf`);await fsp.writeFile(snapshot,bytes,{flag:'wx',mode:0o600});
        const until=Date.now()+LIMITS.processMs;
        const properties=parsePdfInfo(await run(pdfinfo,[snapshot],{timeoutMs:Math.max(1,until-Date.now())}));
        parseAttachmentCount(await run(pdfdetach,['-list',snapshot],{timeoutMs:Math.max(1,until-Date.now())}));
        info={sha256,snapshot,bytes:bytes.length,...properties,attachments:0};snapshots.set(sha256,info);
      }documents.set(doc.id,info);
    }
    for(const ref of [...recipe.groups.flatMap(g=>g.pages),...recipe.pageReview.excludedPages])check(ref.page<=documents.get(ref.documentId).pages,'PAGE','引用或排除页超出实际 PDF 页数。');
    const uniquePages=checkPageIdentities(recipe,documents);
    check(uniquePages.size+1<=model.EXAM_LIMITS.assets,'PAGE','引用页数量超过素材限额。');
    const audioInput=await resolveLocalFile(base,recipe.audioFile,model.EXAM_LIMITS.assetBytes);
    const audioBytes=await readBounded(audioInput.real,model.EXAM_LIMITS.assetBytes);
    const audio={mime:/\.wav$/i.test(recipe.audioFile)?'audio/wav':'audio/mpeg',base64:audioBytes.toString('base64')};
    let total=audioBytes.length;const pageAssets=new Map(),mapping=[];let index=0;
    for(const [identity,page] of uniquePages) {
      const doc=documents.get(page.ref.documentId),until=Date.now()+LIMITS.processMs;
      const size=parsePageSize(await run(pdfinfo,['-f',String(page.ref.page),'-l',String(page.ref.page),'-box',doc.snapshot],{timeoutMs:Math.max(1,until-Date.now())}),page.ref.page,dpi);
      const prefix=path.join(stage,`page-${++index}`),jpg=prefix+'.jpg';
      await run(pdftoppm,['-f',String(page.ref.page),'-l',String(page.ref.page),'-singlefile','-r',String(dpi),'-jpeg','-jpegopt','quality=90',doc.snapshot,prefix],{timeoutMs:Math.max(1,until-Date.now()),watchFile:jpg,maxFileBytes:model.EXAM_LIMITS.imageBytes});
      const data=await readBounded(jpg,model.EXAM_LIMITS.imageBytes),rendered=jpegSize(data);
      const a=[rendered.width,rendered.height].sort((x,y)=>x-y),b=[...size.pixels].sort((x,y)=>x-y);
      check(a.every((n,i)=>integer(n,1,LIMITS.edge) && Math.abs(n-b[i])<=2) && a[0]*a[1]<=LIMITS.pixels,'RENDER','渲染图像尺寸与引用页不符。');
      total+=data.length;check(total<=model.EXAM_LIMITS.decodedBytes,'ASSET_SIZE','音频与页面图片总大小超过 64 MiB；请调整 DPI 或合法音频编码。');
      const asset={id:`scan-page-${index}`,mime:'image/jpeg',base64:data.toString('base64')};
      for(const use of page.uses)pageAssets.set(`${use.documentId}:${page.ref.page}`,asset);
      mapping.push({pdfSha256:identity.split(':')[0],page:page.ref.page,assetId:asset.id,section:page.section,uses:page.uses,dpi,jpegQuality:90,
        width:rendered.width,height:rendered.height,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});
      await fsp.unlink(jpg);
    }
    const exam=buildPackage(recipe,pageAssets,audio,model),json=JSON.stringify(exam);
    const report={kind:'lantern-exam-page-mapping-report',schemaVersion:1,examId:exam.id,examVersion:exam.version,questions:200,
      examSha256:crypto.createHash('sha256').update(json).digest('hex'),examBytes:Buffer.byteLength(json),assetBytes:total,
      documents:recipe.documents.map(d=>{const v=documents.get(d.id);return {id:d.id,sha256:v.sha256,bytes:v.bytes,pages:v.pages,encrypted:v.encrypted,printingAllowed:v.printingAllowed,javascript:v.javascript,form:v.form,attachments:v.attachments};}),
      audio:{mime:audio.mime,bytes:audioBytes.length,sha256:crypto.createHash('sha256').update(audioBytes).digest('hex'),reviewedByImporter:true,decodedByTool:false},
      pages:mapping,excludedPages:recipe.pageReview.excludedPages.map(p=>({...p,pdfSha256:documents.get(p.documentId).sha256})),
      checks:{modelValidated:true,onlyReferencedPagesRendered:true,crossSectionPhysicalPagesRejected:true,reviewedByImporter:true},
      limitations:['页面无答案/解析、听力页不含阅读材料，以及题本与答案同卷，仅为导入者人工声明；程序不识别页面语义或核对答案正确性。',
        '音轨与题本对应、整场音频完整及可听清，仅为导入者人工声明；本工具未解码或试听音频。',
        '扫描图片需在目标设备逐页检查可读性；页数、200 题结构与图片文件头通过不等于真实试卷、内容完整或获得使用授权。']};
    await fsp.writeFile(path.join(stage,'exam.json'),json,{flag:'wx',mode:0o600});
    await fsp.writeFile(path.join(stage,'mapping-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    check(await fsp.realpath(path.dirname(target))===path.dirname(target) && await fsp.realpath(base)===base,'OUTPUT_PATH','输出父目录在处理期间发生变化。');
    await publish(stage,target);
    return {outputDirectory:target,report};
  } catch(error) {
    if(error instanceof PackerError)throw error;
    fail('PACK_FAILED','本机打包失败，请检查工具、配方与可用磁盘；未覆盖已有文件。');
  } finally {
    // Created solely by mkdtemp directly under the verified private recipe directory.
    check(within(base,stage) && path.basename(stage).startsWith('.lantern-page-packer-'),'CLEANUP','临时目录范围核查失败。');
    await fsp.rm(stage,{recursive:true,force:true,maxRetries:2,retryDelay:100});
  }
}
const HELP=`Usage: node scripts/pack-exam-pages.cjs --recipe <local.json> [--out-dir <new-relative-directory>] [--dpi 72..200]
  [--pdfinfo <executable>] [--pdftoppm <executable>] [--pdfdetach <executable>]
Inputs and output stay inside the recipe's real private directory. Existing output is never replaced.
Default: packed-<id>-v<version>/exam.json and mapping-report.json; JPEG quality 90, DPI 192.
Requires local Poppler pdfinfo, pdftoppm and pdfdetach. No OCR, network access or PDF modification.
pageReview.reviewed:true declares that ALL referenced pages contain no answers/explanations,
LC pages contain no RC material, and the question book and 200 answers refer to the same paper.
audioReviewed:true declares the matching complete audio was personally checked. Neither declaration
is software verification, a copyright licence, or a promise of legibility/sound on the target device.
`;
function parseArgs(argv) {
  const names={'--recipe':'recipe','--out-dir':'outDir','--dpi':'dpi','--pdfinfo':'pdfinfo','--pdftoppm':'pdftoppm','--pdfdetach':'pdfdetach'};
  const out={};for(let i=0;i<argv.length;i++) {const key=names[argv[i]];check(key && out[key]===undefined && argv[i+1] && !argv[i+1].startsWith('--'),'CLI','命令参数无效；请使用 --help。');out[key]=argv[++i];}
  check(out.recipe,'CLI','缺少 --recipe 参数。');return out;
}
async function main(argv=process.argv.slice(2),io=console) {
  if(argv.length===1 && argv[0]==='--help'){io.log(HELP);return 0;}
  try{const result=await packExamPages(parseArgs(argv));io.log(`OK: exam.json + mapping-report.json; ${result.report.pages.length} rendered pages, 200 questions. Human material review remains required.`);return 0;}
  catch(error){io.error(error instanceof PackerError?`${error.code}: ${error.message}`:'PACK_FAILED: 本机打包失败；未输出成功声明。请检查工具、配方与磁盘。');return 1;}
}
module.exports={LIMITS,PackerError,relativeFile,resolveLocalFile,loadModel,validateRecipe,buildPackage,parsePdfInfo,parseAttachmentCount,parsePageSize,jpegSize,checkPageIdentities,runProcess,packExamPages,parseArgs,main};
if(require.main===module)void main().then(code=>{process.exitCode=code;});
