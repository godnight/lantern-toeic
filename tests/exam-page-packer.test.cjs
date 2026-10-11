// Unit tests use deliberately fake PDF/JPEG bytes and a fake Poppler transport.
// They do NOT prove real rendering, image readability or audio decoding.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const tool=require('../scripts/pack-exam-pages.cjs');
const root=process.env.LANTERN_EXAM_ROOT || path.resolve(__dirname,'..');
const fixture=require(path.join(root,'tests/fixtures/synthetic-exam.cjs'));
const model=tool.loadModel(root);
function recipe() {
  const e=fixture('private-unit-test');
  return {kind:'lantern-exam-page-recipe',schemaVersion:1,exam:{id:e.id,version:1,title:e.title,source:e.source},
    documents:[{id:'book',file:'book.pdf'}],audioFile:'audio.wav',answers:e.questions.map(q=>'ABCD'[q.answer]),
    groups:e.groups.map(g=>({id:g.id,part:g.part,questionNumbers:g.questionNumbers,passageCount:g.passages.length,
      pages:g.part===2?[]:[{documentId:'book',page:g.part<=4?1:2}]})),pageReview:{reviewed:true,excludedPages:[{documentId:'book',page:3}]},audioReviewed:true};
}
function info(pages=3,extra='') {return `Title: PRIVATE METADATA DO NOT LOG\nPages: ${pages}\nEncrypted: no\nJavaScript: no\nForm: none\n${extra}`;}
function jpg(w=600,h=800) {
  const b=Buffer.alloc(23);b[0]=255;b[1]=216;b[2]=255;b[3]=192;b.writeUInt16BE(17,4);b[6]=8;b.writeUInt16BE(h,7);b.writeUInt16BE(w,9);b[11]=3;b[21]=255;b[22]=217;return b;
}
async function setup(t,r=recipe()) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lantern-packer-unit-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const e=fixture();await fs.writeFile(path.join(dir,'book.pdf'),'%PDF-1.7\nFAKE PDF FOR UNIT TESTS ONLY');
  await fs.writeFile(path.join(dir,'audio.wav'),Buffer.from(e.assets[1].base64,'base64'));
  await fs.writeFile(path.join(dir,'recipe.json'),JSON.stringify(r));
  return {dir,options:{recipe:path.join(dir,'recipe.json'),dpi:72},r};
}
function fakeRenderer(log=[],hook) {
  return async(command,args,options)=> {
    log.push({command,args,options});if(hook){const response=await hook(command,args,options);if(response!==undefined)return response;}
    if(command==='pdfinfo')return args.includes('-box')?`Page ${args[1]} size: 600 x 800 pts\n`:info();
    if(command==='pdfdetach')return '0 embedded files\n';
    assert.equal(command,'pdftoppm');await fs.writeFile(args.at(-1)+'.jpg',jpg());return '';
  };
}
async function leftovers(dir){return (await fs.readdir(dir)).filter(n=>n.startsWith('.lantern-page-packer-')||n.startsWith('packed-'));}
const deps=(run)=>({model,runProcess:run||fakeRenderer()});

test('valid recipe uses the actual complete-200 model and explicit passage counts',()=>{
  const r=recipe();assert.equal(tool.validateRecipe(r,model),r);
  const g=r.groups.find(g=>g.part===7);g.pages.push({documentId:'book',page:4});assert.equal(g.passageCount,1);
  assert.doesNotThrow(()=>tool.validateRecipe(r,model));
});
test('answers must be exactly 200 uppercase options and Part 2 never D',()=>{
  for(const edit of [r=>r.answers.pop(),r=>r.answers.push('A'),r=>r.answers[0]='a',r=>r.answers[6]='D',r=>r.answers[0]='A\n',r=>r.answers[0]=0]) {
    const r=recipe();edit(r);assert.throws(()=>tool.validateRecipe(r,model),e=>e.code==='ANSWERS');
  }
});
test('manual page and audio review are mandatory and unknown recipe keys are refused',()=>{
  for(const edit of [r=>r.pageReview.reviewed=false,r=>r.audioReviewed=false,r=>delete r.pageReview,r=>delete r.audioReviewed,r=>r.pageReview.reviewed='true',r=>r.download='https://example.invalid']) {
    const r=recipe();edit(r);assert.throws(()=>tool.validateRecipe(r,model));
  }
});
test('real model rejects incorrect Part boundaries, group size, gaps and passage counts',()=>{
  for(const edit of [r=>r.groups.pop(),r=>r.groups[0].questionNumbers=[2],r=>r.groups.find(g=>g.part===3).questionNumbers.pop(),r=>r.groups.find(g=>g.part===6).passageCount=0,r=>r.groups.find(g=>g.part===7).passageCount=2]) {
    const r=recipe();edit(r);assert.throws(()=>tool.validateRecipe(r,model));
  }
});
test('all non-Part-2 groups require original pages and excluded intersection is rejected',()=>{
  for(const part of [1,3,4,5,6,7]){const r=recipe();r.groups.find(g=>g.part===part).pages=[];assert.throws(()=>tool.validateRecipe(r,model));}
  const r=recipe();r.groups[0].pages=[{documentId:'book',page:3}];assert.throws(()=>tool.validateRecipe(r,model),/排除页/);
});
test('URL, absolute, UNC, traversal, ADS, device-name and ambiguous Windows paths are rejected',()=>{
  for(const v of ['https://a.invalid/a.pdf','file:///tmp/a.pdf','C:\\private\\a.pdf','/tmp/a.pdf','\\\\server\\share\\a.pdf','..\\a.pdf','sub/../a.pdf','a.pdf:stream','NUL.pdf','x/COM1','sub//a.pdf','file.pdf.','x\u0000.pdf','./a.pdf'])assert.throws(()=>tool.relativeFile(v));
  assert.equal(tool.relativeFile('资料/题本 一.pdf'),path.join('资料','题本 一.pdf'));
});
test('realpath stops a symlink/junction outside the private recipe root',async t=>{
  const {dir}=await setup(t);const outside=await fs.mkdtemp(path.join(os.tmpdir(),'lantern-external-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'x.pdf'),'private');
  await fs.symlink(outside,path.join(dir,'link'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(tool.resolveLocalFile(dir,'link/x.pdf',100),e=>e.code==='PATH');
});
test('same PDF bytes under aliases/copies cannot cross LC and RC',()=>{
  const r=recipe();r.documents.push({id:'copy',file:'copy.pdf'});r.groups.find(g=>g.part===5).pages=[{documentId:'copy',page:1}];
  const documents=new Map([['book',{sha256:'same'}],['copy',{sha256:'same'}]]);
  assert.throws(()=>tool.checkPageIdentities(r,documents),e=>e.code==='CROSS_SECTION');
});
test('excluded pages cannot be reintroduced through a PDF alias',()=>{
  const r=recipe();r.documents.push({id:'copy',file:'copy.pdf'});r.groups[0].pages=[{documentId:'copy',page:3}];
  assert.throws(()=>tool.checkPageIdentities(r,new Map([['book',{sha256:'same'}],['copy',{sha256:'same'}]])),e=>e.code==='EXCLUDED_PAGE');
});
test('encrypted, JavaScript, forms and missing inspection metadata fail closed',()=>{
  for(const text of [info().replace('Encrypted: no','Encrypted: yes'),info().replace('JavaScript: no','JavaScript: yes'),info().replace('Form: none','Form: AcroForm'),info().replace('JavaScript: no',''),info(1001)])assert.throws(()=>tool.parsePdfInfo(text));
  assert.equal(tool.parsePdfInfo(info()).pages,3);
  assert.equal(tool.parseAttachmentCount('0 embedded files\n'),0);
  for(const s of ['1 embedded files\n1: private.pdf','unknown',''])assert.throws(()=>tool.parseAttachmentCount(s));
});

test('password-free printable protected PDFs render without rewriting source bytes',async t=>{
  const {dir,options}=await setup(t),calls=[];
  const before=await fs.readFile(path.join(dir,'book.pdf'));
  const protectedInfo=info().replace('Encrypted: no','Encrypted: yes (print:yes copy:no change:no addNotes:no algorithm:AES)');
  const rendered=fakeRenderer(calls,async(command,args)=>command==='pdfinfo' && !args.includes('-box')?protectedInfo:undefined);
  const result=await tool.packExamPages(options,deps(rendered));
  assert.equal(result.report.documents[0].encrypted,true);
  assert.equal(result.report.documents[0].printingAllowed,true);
  assert.deepEqual(await fs.readFile(path.join(dir,'book.pdf')),before);
  assert.equal(calls.filter(c=>c.command==='pdftoppm').length,2);
  assert.ok(calls.every(c=>!c.args.includes('-upw') && !c.args.includes('-opw')));
  assert.equal(model.parseExamPackage(JSON.parse(await fs.readFile(path.join(result.outputDirectory,'exam.json'),'utf8'))).questions.length,200);
});

test('protected PDF inspection rejects denied printing, ambiguous metadata and unknown permissions',()=>{
  const encryption='yes (print:yes copy:no change:no addNotes:no algorithm:AES)';
  for(const value of [encryption.replace('print:yes','print:no'),encryption.replace('copy:no','copy:unknown'),
    encryption.replace('algorithm:AES','algorithm:unknown'),'yes (print:yes)',encryption+' trailing']) {
    assert.throws(()=>tool.parsePdfInfo(info().replace('Encrypted: no','Encrypted: '+value)),e=>e.code==='PDF_ACTIVE');
  }
  for(const label of ['Encrypted: no','JavaScript: no','Form: none','Pages: 3']) {
    assert.throws(()=>tool.parsePdfInfo(label+'\n'+info()),e=>e.code==='PDF_METADATA');
  }
  for(const cipher of ['RC4','AES','AES-256']) {
    assert.equal(tool.parsePdfInfo(info().replace('Encrypted: no','Encrypted: '+encryption.replace('algorithm:AES','algorithm:'+cipher))).encrypted,true);
  }
});

test('password-required input fails inspection before rendering or creating a package',async t=>{
  const {dir,options}=await setup(t),calls=[];
  const denied=fakeRenderer(calls,async(command)=>{if(command==='pdfinfo')throw new tool.PackerError('POPPLER','Cannot open input');});
  await assert.rejects(tool.packExamPages(options,deps(denied)),e=>e.code==='POPPLER');
  assert.equal(calls.filter(c=>c.command==='pdftoppm').length,0);
  assert.deepEqual(await leftovers(dir),[]);
});
test('huge page dimensions, unknown size and malformed JPEG are rejected before output',()=>{
  assert.throws(()=>tool.parsePageSize('Page 1 size: 10000 x 10000 pts',1,192));
  assert.throws(()=>tool.parsePageSize('Page 2 size: 600 x 800 pts',1,192));
  assert.throws(()=>tool.jpegSize(Buffer.from([255,216,255,217])));
  assert.deepEqual(tool.jpegSize(jpg()),{width:600,height:800});
});
test('pack renders only referenced physical pages, validates final model and omits private metadata/answers from report',async t=>{
  const {dir,options}=await setup(t),calls=[];
  const result=await tool.packExamPages(options,deps(fakeRenderer(calls)));
  const exam=JSON.parse(await fs.readFile(path.join(result.outputDirectory,'exam.json'),'utf8'));
  assert.equal(model.parseExamPackage(exam).questions.length,200);assert.equal(exam.groups.find(g=>g.part===6).passages[0],'');
  assert.deepEqual(exam.questions[6].choices,['A','B','C']);
  const renders=calls.filter(c=>c.command==='pdftoppm');assert.equal(renders.length,2);assert.deepEqual(renders.map(c=>c.args[1]),['1','2']);
  assert.ok(calls.every(c=>c.options.timeoutMs<=90000));assert.ok(renders.every(c=>c.args.includes('quality=90')));
  assert.equal(result.report.pages[0].section,'LC');assert.equal(result.report.pages[1].section,'RC');
  const report=JSON.stringify(result.report);for(const secret of [dir,'PRIVATE METADATA','base64','answers','FAKE PDF'])assert.ok(!report.includes(secret));
  assert.equal(result.report.audio.decodedByTool,false);assert.equal(result.report.limitations.length,3);
  assert.deepEqual(await leftovers(dir),['packed-private-unit-test-v1']);
});
test('same-byte PDF copies are rejected end-to-end before page rendering',async t=>{
  const r=recipe();r.documents.push({id:'copy',file:'copy.pdf'});r.groups.find(g=>g.part===5).pages=[{documentId:'copy',page:1}];
  const {dir,options}=await setup(t,r);await fs.copyFile(path.join(dir,'book.pdf'),path.join(dir,'copy.pdf'));const log=[];
  await assert.rejects(tool.packExamPages(options,deps(fakeRenderer(log))),e=>e.code==='CROSS_SECTION');
  assert.equal(log.filter(c=>c.command==='pdftoppm').length,0);assert.deepEqual(await leftovers(dir),[]);
});
test('same-byte excluded alias cannot be rendered and does not create final output',async t=>{
  const r=recipe();r.documents.push({id:'copy',file:'copy.pdf'});r.groups[0].pages=[{documentId:'copy',page:3}];
  const {dir,options}=await setup(t,r);await fs.copyFile(path.join(dir,'book.pdf'),path.join(dir,'copy.pdf'));
  await assert.rejects(tool.packExamPages(options,deps()),e=>e.code==='EXCLUDED_PAGE');assert.deepEqual(await leftovers(dir),[]);
});
test('outside/product/existing output paths fail without modifying existing files',async t=>{
  const {dir,options}=await setup(t);await fs.mkdir(path.join(dir,'already'));await fs.writeFile(path.join(dir,'already','keep.txt'),'KEEP');
  for(const outDir of ['../elsewhere','public','content/private','harmony','already'])await assert.rejects(tool.packExamPages({...options,outDir},deps()));
  assert.equal(await fs.readFile(path.join(dir,'already','keep.txt'),'utf8'),'KEEP');assert.deepEqual(await leftovers(dir),[]);
});
test('output parent symlink escape is rejected',async t=>{
  const {dir,options}=await setup(t);const elsewhere=await fs.mkdtemp(path.join(os.tmpdir(),'lantern-output-outside-'));
  t.after(()=>fs.rm(elsewhere,{recursive:true,force:true}));await fs.symlink(elsewhere,path.join(dir,'alias'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(tool.packExamPages({...options,outDir:'alias/output'},deps()),e=>e.code==='OUTPUT_PATH');assert.deepEqual(await fs.readdir(elsewhere),[]);
});
test('late renderer failure removes snapshots/images and exposes no final package or private errors',async t=>{
  const {dir,options}=await setup(t);let count=0;
  const render=fakeRenderer([],async(command)=>{if(command==='pdftoppm' && ++count===2)throw new Error('SECRET PATH '+dir+' PRIVATE METADATA');});
  await assert.rejects(tool.packExamPages(options,deps(render)),e=>e.code==='PACK_FAILED' && !e.message.includes(dir) && !e.message.includes('PRIVATE'));
  assert.deepEqual(await leftovers(dir),[]);
});
test('timeout after an earlier rendered page removes staging and final output',async t=>{
  const {dir,options}=await setup(t);let count=0;
  const render=fakeRenderer([],async(command)=>{if(command==='pdftoppm' && ++count===2)throw new tool.PackerError('TIMEOUT','渲染超时。');});
  await assert.rejects(tool.packExamPages(options,deps(render)),e=>e.code==='TIMEOUT');assert.deepEqual(await leftovers(dir),[]);
});
test('actual process wrapper bounds runtime and does not echo private stderr',async()=>{
  const started=Date.now();await assert.rejects(tool.runProcess(process.execPath,['-e','process.stderr.write("PRIVATE METADATA /secret.pdf");setInterval(()=>{},1000)'],{timeoutMs:80}),e=>e.code==='TIMEOUT' && !e.message.includes('PRIVATE'));
  assert.ok(Date.now()-started<6000);
  await assert.rejects(tool.runProcess(process.execPath,['-e','process.stderr.write("PRIVATE");process.exit(1)']),e=>e.code==='POPPLER' && !e.message.includes('PRIVATE'));
});
test('actual process uses literal argv without invoking a shell',async()=>{
  const literal='x; $(echo SECRET) & | "quoted"';
  const output=await tool.runProcess(process.execPath,['-e','process.stdout.write(process.argv[1])',literal]);assert.equal(output,literal);
});
test('invalid audio header fails final validation and leaves no final files',async t=>{
  const {dir,options}=await setup(t);await fs.writeFile(path.join(dir,'audio.wav'),'INVALID AUDIO');
  await assert.rejects(tool.packExamPages(options,deps()),e=>e.code==='MODEL_VALIDATION');assert.deepEqual(await leftovers(dir),[]);
});
test('page beyond actual PDF count, non-PDF header and excessive render bytes leave no package',async t=>{
  const first=await setup(t);first.r.pageReview.excludedPages[0].page=4;await fs.writeFile(first.options.recipe,JSON.stringify(first.r));
  await assert.rejects(tool.packExamPages(first.options,deps()),e=>e.code==='PAGE');assert.deepEqual(await leftovers(first.dir),[]);
  const second=await setup(t);await fs.writeFile(path.join(second.dir,'book.pdf'),'not PDF');
  await assert.rejects(tool.packExamPages(second.options,deps()),e=>e.code==='PDF');assert.deepEqual(await leftovers(second.dir),[]);
  const third=await setup(t);const render=fakeRenderer([],async(command,args)=>{if(command==='pdftoppm'){await fs.writeFile(args.at(-1)+'.jpg',Buffer.alloc(model.EXAM_LIMITS.imageBytes+1));return '';}});
  await assert.rejects(tool.packExamPages(third.options,deps(render)),e=>e.code==='INPUT_SIZE');assert.deepEqual(await leftovers(third.dir),[]);
});
test('no overwrite under an output race; any unexpected existing content is retained',async t=>{
  const {dir,options}=await setup(t);let planted=false;
  const render=fakeRenderer([],async(command)=>{if(command==='pdftoppm' && !planted){planted=true;await fs.mkdir(path.join(dir,'packed-private-unit-test-v1'));await fs.writeFile(path.join(dir,'packed-private-unit-test-v1','exam.json'),'EXISTING');}});
  await assert.rejects(tool.packExamPages(options,deps(render)),e=>e.code==='OUTPUT_WRITE');
  assert.equal(await fs.readFile(path.join(dir,'packed-private-unit-test-v1','exam.json'),'utf8'),'EXISTING');
  assert.equal((await leftovers(dir)).filter(n=>n.startsWith('.lantern-')).length,0);
});
test('CLI help and errors do not print private recipe paths',async()=>{
  const lines=[],io={log:v=>lines.push(v),error:v=>lines.push(v)};
  assert.equal(await tool.main(['--recipe','Z:\\SENSITIVE_PERSONAL\\unavailable.json'],io),1);assert.ok(!lines.join('').includes('SENSITIVE_PERSONAL'));
  assert.equal(await tool.main(['--help'],io),0);assert.match(lines.join(''),/ALL referenced pages/);
  for(const argv of [['--recipe','x','--dpi','80','--dpi','90'],['--recipe','x','--network'],['--secret','value']])assert.throws(()=>tool.parseArgs(argv));
});
test('DPI outside explicit 72-200 range and network-share recipes fail before running tools',async t=>{
  const {options}=await setup(t);const log=[];
  for(const dpi of [71,201,100.5,'NaN',0])await assert.rejects(tool.packExamPages({...options,dpi},deps(fakeRenderer(log))),e=>e.code==='DPI');
  for(const recipe of ['\\\\server\\share\\recipe.json','//server/share/recipe.json','https://example.invalid/recipe.json'])await assert.rejects(tool.packExamPages({recipe},deps(fakeRenderer(log))),e=>e.code==='PATH');
  assert.equal(log.length,0);
});
test('cumulative media budget is checked during rendering and leaves no final output',async t=>{
  const {dir,options}=await setup(t);
  const limited={...model,EXAM_LIMITS:{...model.EXAM_LIMITS,decodedBytes:60}};
  await assert.rejects(tool.packExamPages(options,{model:limited,runProcess:fakeRenderer()}),e=>e.code==='ASSET_SIZE');
  assert.deepEqual(await leftovers(dir),[]);
});
