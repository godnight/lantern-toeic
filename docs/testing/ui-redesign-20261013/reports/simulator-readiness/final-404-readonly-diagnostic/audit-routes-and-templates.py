"""Bounded source/reference audit; no device, build, credential or learning-data operations."""
from pathlib import Path
import datetime, hashlib, json, re, subprocess

out=Path(__file__).resolve().parent
root=out.parent
build=json.loads((root/'latest-build.json').read_text(encoding='utf-8'))
result=json.loads((Path(build['evidence'])/'result.json').read_text(encoding='utf-8'))
assert result['artifactSha256']=='d10202ec9ffc908e15199d8917cc270214d36b351161d90403a786faa604f573'
stage=Path(build['stage'])
repo=Path(result['repo'])
web=stage/'harmony/entry/src/main/resources/rawfile/web'
manifest=json.loads((web/'bundle-manifest.json').read_text(encoding='utf-8'))
names={row['path'] for row in manifest['files']}
sha=lambda raw:hashlib.sha256(raw).hexdigest()

index_path='harmony/entry/src/main/ets/pages/Index.ets'
raw=(stage/index_path).read_bytes()
head=subprocess.run(['git','-c','safe.directory='+str(repo).replace('\\','/'),'show','HEAD:'+index_path],cwd=repo,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
worktree=(repo/index_path).read_bytes()
native_diff=subprocess.run(['git','-c','safe.directory='+str(repo).replace('\\','/'),'diff','--name-only','HEAD','--',index_path],cwd=repo,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode('utf-8')
index_lines=raw.decode('utf-8').splitlines()
native_evidence=[]
for number,line in enumerate(index_lines,1):
 if any(token in line for token in ['function localPath','web/index.html',"'web' + decoded",'getRawFileContent','Bundled resource not found','setResponseCode(404)','setResponseMimeType(\'text/plain\')','this.readAsset','onInterceptRequest']):
  native_evidence.append({'source':index_path,'line':number,'text':line.strip()})
native={'source':index_path,'stageSha256':sha(raw),'headSha256':sha(head),'currentSha256':sha(worktree),
 'stageMatchesHeadRawBytes':raw==head,
 'stageMatchesHeadAfterCrLfNormalization':raw.replace(b'\r\n',b'\n')==head.replace(b'\r\n',b'\n'),
 'stageMatchesCurrent':raw==worktree,'gitDiffNameOnly':native_diff.strip(),
 'getRawFileContentCallCount':sum('getRawFileContent(' in line for line in index_lines),
 'configured404Body':'Bundled resource not found','configured404BodyUtf8Bytes':len('Bundled resource not found'.encode('utf-8')),
 'evidence':native_evidence}

audio_path='mobile/offline-audio/manifest.json'
audio=json.loads((stage/audio_path).read_text(encoding='utf-8'))
missing_audio=['audio/offline/'+clip['file'] for clip in audio['clips'] if 'audio/offline/'+clip['file'] not in names]
json_refs=[]
def json_walk(value,source,pointer=''):
 if isinstance(value,dict):
  for key,item in value.items(): json_walk(item,source,pointer+'/'+key)
 elif isinstance(value,list):
  for number,item in enumerate(value): json_walk(item,source,pointer+'/'+str(number))
 elif isinstance(value,str) and value.startswith('/') and re.search(r'\.(?:webp|png|jpe?g|svg|ico|mp3|woff2?)(?:[?#]|$)',value,re.I):
  clean=value.split('?')[0].split('#')[0]
  json_refs.append({'source':source,'jsonPointer':pointer,'reference':clean,'present':clean.lstrip('/') in names})
json_sources=list((stage/'content').glob('*.json'))+list((stage/'public/art').rglob('*.json'))
for source in json_sources:
 if source.stat().st_size>2_000_000: continue
 json_walk(json.loads(source.read_text(encoding='utf-8')),source.relative_to(stage).as_posix())

range_rows=[]
def excerpt(rel,start,end):
 lines=(stage/rel).read_text(encoding='utf-8').splitlines()
 range_rows.append({'source':rel,'startLine':start,'endLine':min(end,len(lines)),
  'sourceSha256':sha((stage/rel).read_bytes()),'lines':[{'line':i+1,'text':lines[i]} for i in range(start-1,min(end,len(lines)))]})
excerpt('mobile/src/main.tsx',1,15)
excerpt('app/study-app.tsx',74,75)
for rel in ['lib/dictionary.ts','lib/dictionary-search.ts','lib/lesson-audio.ts']:
 file=stage/rel
 if not file.exists(): continue
 lines=file.read_text(encoding='utf-8').splitlines()
 for i,line in enumerate(lines):
  if '/dictionaries/' in line or '/audio/offline/' in line:
   excerpt(rel,max(1,i-2),min(len(lines),i+3))

report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'candidateSha256':result['artifactSha256'],
 'nativeIndexHeadComparison':native,'bundledAudioTemplate':{'source':audio_path,'sourceSha256':sha((stage/audio_path).read_bytes()),'clips':len(audio['clips']),'missingAssets':missing_audio},
 'dictionaryAssets':[name for name in sorted(names) if name.startswith('dictionaries/')],
 'sourceJsonImageAudioReferences':json_refs,'missingSourceJsonReferences':[row for row in json_refs if not row['present']],
 'sourceGuardAndTemplateExcerpts':range_rows,
 'limits':'Static paths and owner/native guards do not reveal executed masked request URLs. Identical native source to HEAD is not proof the baseline was bug-free. No user localStorage, imported file, runtime business data, signing material, or device files were read.'}
(out/'404-final-routes-and-templates.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'nativeIndexMatchesHeadNormalized':native['stageMatchesHeadAfterCrLfNormalization'],'nativeIndexMatchesCurrent':native['stageMatchesCurrent'],
 'nativeIndexSha256':native['stageSha256'],'rawfileCalls':native['getRawFileContentCallCount'],'responseBytes':native['configured404BodyUtf8Bytes'],
 'audioClips':len(audio['clips']),'missingAudio':missing_audio,'dictionaryAssets':report['dictionaryAssets'],
 'jsonAssetReferenceCount':len(json_refs),'missingJsonAssets':report['missingSourceJsonReferences'],'sourceExcerptGroups':len(range_rows)},ensure_ascii=False,indent=2))
