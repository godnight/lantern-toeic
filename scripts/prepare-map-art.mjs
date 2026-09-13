import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

// Format/size derivatives only; the supplied illustrations remain unchanged.
const source=process.argv[2];
if(!source)throw Error('Pass the supplied 素材 directory containing 图片清单.json');
const root=fileURLToPath(new URL('..',import.meta.url));
const catalogue=JSON.parse(readFileSync(resolve(source,'图片清单.json'),'utf8'));
const selected=[['M01','greenpath'],['M03','crystal-peak'],['M02','city-of-tears'],['M04','white-palace'],['M05','greymoor'],['K02','listening'],['K03','reading'],['K09','speaking'],['K01','dirtmouth']];
const assets=[];mkdirSync(resolve(root,'public/images/maps'),{recursive:true});
for(const [id,name] of selected){
 const item=catalogue.find(x=>x.id===id);if(!item)throw Error('Missing '+id);
 const input=readFileSync(resolve(source,item.path));
 const sourceSha256=createHash('sha256').update(input).digest('hex');
 if(sourceSha256!==item.sha256)throw Error('Source checksum changed: '+id);
 const variants=id.startsWith('M')?[['',1600,83],['-mobile',960,80],['-thumb',320,76]]:[['',640,82]];
 for(const [suffix,width,quality] of variants){
  const path='/images/maps/'+name+suffix+'.webp';
  const {data,info}=await sharp(input).resize({width,withoutEnlargement:true}).webp({quality}).toBuffer({resolveWithObject:true});
  writeFileSync(resolve(root,'public/.'+path),data);
  assets.push({id:id+suffix,title:item.title,path,width:info.width,height:info.height,bytes:info.size,sha256:createHash('sha256').update(data).digest('hex'),sourceId:id,sourceFile:item.path,sourceSha256});
 }
}
writeFileSync(resolve(root,'art/map-art-provenance.json'),JSON.stringify({schemaVersion:1,date:'2026-09-13',author:'项目所有者提供的自生成素材',sourceBundle:'空洞骑士与丝之歌_素材25张_含深渊',usage:'用户授权用于微光托业页面设计；同人素材不标注为官方资源，不纳入原创题库的 CC BY 4.0 授权。',processing:'仅等比例缩放及 WebP 编码，无重绘；原始 PNG 留在用户素材目录。',assets},null,2)+'\n');
console.log(`Prepared ${assets.length} WebP files, ${(assets.reduce((sum,x)=>sum+x.bytes,0)/1024/1024).toFixed(2)} MiB total.`);
