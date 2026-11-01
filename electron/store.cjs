const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { z } = require('zod');
function atomicWrite(target,data){const temp=target+'.tmp';const fd=fs.openSync(temp,'w');try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,target);const dir=fs.openSync(path.dirname(target),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
const nodes = new Set(['doc','paragraph','text','heading','bulletList','orderedList','listItem','taskList','taskItem','blockquote','horizontalRule','hardBreak','image']);
const marks = new Set(['bold','italic','underline','strike','link']);
function inspect(doc, depth=0) {
 if (!doc || !nodes.has(doc.type) || depth>50) throw Error('不支持的正文格式');
 if (doc.text !== undefined && typeof doc.text !== 'string') throw Error('正文格式错误');
 for (const m of doc.marks || []) { if (!marks.has(m.type)) throw Error('不支持的文字格式'); if(m.type==='link' && !/^https?:\/\//i.test(m.attrs?.href || '')) throw Error('链接仅支持 http 或 https'); }
 if(doc.type==='image' && !/^journal-asset:\/\/[a-f0-9-]+$/.test(doc.attrs?.src || '')) throw Error('图片引用无效');
 for(const child of doc.content || []) inspect(child,depth+1);
}
function text(doc) { return (doc.text || '') + (doc.content || []).map(text).join(['doc','bulletList','orderedList','blockquote'].includes(doc.type)?'\n':''); }
function images(doc) { return [...(doc.type==='image'?[doc.attrs.src.split('//')[1]]:[]),...(doc.content||[]).flatMap(images)]; }
class Store {
 constructor(root) {
  this.root=root; fs.mkdirSync(root,{recursive:true}); this.pointer=path.join(root,'current.json');
  if(!fs.existsSync(this.pointer)) this.point(randomUUID());
  this.open();
 }
 point(id) { atomicWrite(this.pointer,JSON.stringify({id})); }
 open() {
  const {id}=JSON.parse(fs.readFileSync(this.pointer,'utf8')); if(!/^[a-f0-9-]+$/.test(id)) throw Error('数据目录无效');
  this.dir=path.join(this.root,'generations',id);fs.mkdirSync(path.join(this.dir,'assets'),{recursive:true});
  this.db=new Database(path.join(this.dir,'journal.sqlite'));this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');this.db.pragma('foreign_keys = ON');
  const v=this.db.pragma('user_version',{simple:true});if(v>1) throw Error('数据版本高于当前应用');
  this.db.exec(`CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,entry_date TEXT NOT NULL,title TEXT NOT NULL,content_json TEXT NOT NULL,plain_text TEXT NOT NULL,revision INTEGER NOT NULL,mutation TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT); CREATE UNIQUE INDEX IF NOT EXISTS active_date ON entries(entry_date) WHERE deleted_at IS NULL; CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,ext TEXT NOT NULL,hash TEXT NOT NULL); PRAGMA user_version=1;`);
  this.db.prepare('DELETE FROM entries WHERE deleted_at < ?').run(new Date(Date.now()-30*86400000).toISOString());
 }
 row(row) {return row?{...row,content:JSON.parse(row.content_json)}:null;}
 get(value) {date.parse(value);return this.row(this.db.prepare('SELECT * FROM entries WHERE entry_date=? AND deleted_at IS NULL').get(value));}
 list({month,keyword='',from='',to='',trash=false}={}) {
  z.string().max(1000).parse(keyword);if(from)date.parse(from);if(to)date.parse(to);if(from&&to&&from>to)throw Error('开始日期不能晚于结束日期');
  if(month&&!/^\d{4}-\d{2}$/.test(month))throw Error('月份无效');
  return this.db.prepare(`SELECT id,entry_date,title,substr(plain_text,1,160) AS summary,revision,deleted_at FROM entries WHERE ${trash?'deleted_at IS NOT NULL':'deleted_at IS NULL'} AND (?='' OR substr(entry_date,1,7)=?) AND (?='' OR instr(title,?)>0 OR instr(plain_text,?)>0) AND (?='' OR entry_date>=?) AND (?='' OR entry_date<=?) ORDER BY entry_date DESC LIMIT 10000`).all(month||'',month||'',keyword.normalize('NFC'),keyword.normalize('NFC'),keyword.normalize('NFC'),from,from,to,to);
 }
 save(input) {
  const a=z.object({id:z.string().uuid(),entry_date:date,title:z.string().max(1000),revision:z.number().int().nonnegative(),mutation:z.string().uuid(),content:z.any()}).parse(input);
  if(JSON.stringify(a.content).length>2000000)throw Error('单篇内容过大');inspect(a.content);if(a.content.type!=='doc')throw Error('正文格式错误');
  return this.db.transaction(()=>{
   const old=this.db.prepare('SELECT * FROM entries WHERE id=?').get(a.id);
   if(old?.mutation===a.mutation)return this.row(old);
   if(old && (old.revision!==a.revision || old.deleted_at || old.entry_date!==a.entry_date))throw Error('版本冲突，请保留当前内容并重新打开');
   if(!old && a.entry_date>new Date().toLocaleDateString('en-CA'))throw Error('不能创建未来日期的日记');
   if(!old && a.revision!==0)throw Error('日记已不存在');
   for(const id of images(a.content))if(!this.db.prepare('SELECT id FROM assets WHERE id=?').get(id))throw Error('图片尚未保存');
   const plain=text(a.content).normalize('NFC'), title=a.title.normalize('NFC');
   if(!old&&!plain.trim()&&!title.trim()&&!images(a.content).length)return null;
   const now=new Date().toISOString();
   this.db.prepare(`INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content_json=excluded.content_json,plain_text=excluded.plain_text,revision=excluded.revision,mutation=excluded.mutation,updated_at=excluded.updated_at`).run(a.id,a.entry_date,title,JSON.stringify(a.content),plain,a.revision+1,a.mutation,old?.created_at||now,now);
   return this.row(this.db.prepare('SELECT * FROM entries WHERE id=?').get(a.id));
  })();
 }
 trash({id,restore=false,permanent=false}) {
  z.string().uuid().parse(id);const row=this.db.prepare('SELECT * FROM entries WHERE id=?').get(id);if(!row)throw Error('日记不存在');
  if(permanent){if(!row.deleted_at)throw Error('请先移至回收站');this.db.prepare('DELETE FROM entries WHERE id=?').run(id);return;}
  if(restore&&this.get(row.entry_date))throw Error('该日期已有日记，请先导出回收站中的记录');
  this.db.prepare('UPDATE entries SET deleted_at=?, revision=revision+1 WHERE id=?').run(restore?null:new Date().toISOString(),id);
 }
 read(id){z.string().uuid().parse(id);return this.row(this.db.prepare('SELECT * FROM entries WHERE id=?').get(id));}
 importImage({bytes}) {
  const b=Buffer.from(bytes);if(b.length>20*1024*1024)throw Error('图片不能超过 20 MB');
  const ext=b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':b[0]===255&&b[1]===216?'jpg':b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'?'webp':null;
  if(!ext)throw Error('请选择 PNG、JPEG 或 WebP 图片');
  const id=randomUUID(),target=path.join(this.dir,'assets',id+'.'+ext);atomicWrite(target,b);
  this.db.prepare('INSERT INTO assets VALUES(?,?,?)').run(id,ext,createHash('sha256').update(b).digest('hex'));return 'journal-asset://'+id;
 }
 asset(id){z.string().uuid().parse(id);const a=this.db.prepare('SELECT * FROM assets WHERE id=?').get(id);if(!a)throw Error('图片不存在');return {bytes:fs.readFileSync(path.join(this.dir,'assets',id+'.'+a.ext)),mime:{png:'image/png',jpg:'image/jpeg',webp:'image/webp'}[a.ext]};}
 html({content,title='',date=''}) {
  inspect(content);const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const assets=[];
  const render=n=>{if(n.type==='text'){let value=escape(n.text||'');for(const mark of n.marks||[]){const tag={bold:'strong',italic:'em',underline:'u',strike:'s'}[mark.type];if(tag)value='<'+tag+'>'+value+'</'+tag+'>';if(mark.type==='link')value='<a href="'+escape(mark.attrs.href)+'">'+value+'</a>';}return value;}
   if(n.type==='image'){const id=n.attrs.src.split('//')[1],a=this.db.prepare('SELECT * FROM assets WHERE id=?').get(id);if(!a)throw Error('图片不存在');assets.push({...a,bytes:this.asset(id).bytes});return '<img src="__ASSETS__/'+a.id+'.'+a.ext+'" alt="日记图片">';}
   const tag={doc:'div',paragraph:'p',heading:n.attrs?.level===2?'h2':'h1',bulletList:'ul',orderedList:'ol',listItem:'li',taskList:'ul',taskItem:'li',blockquote:'blockquote',horizontalRule:'hr',hardBreak:'br'}[n.type]||'div';return '<'+tag+'>'+((n.content||[]).map(render).join(''))+'</'+tag+'>';};
  return {html:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+escape(title||date)+'</title><style>body{font:17px/1.8 system-ui;max-width:720px;margin:60px auto;padding:24px}img{max-width:100%}</style><body><p>'+escape(date)+'</p><h1>'+escape(title)+'</h1>'+render(content)+'</body></html>',assets};
 }
 async backup(target) {
  const tmp=path.join(this.root,'snapshot-'+randomUUID()+'.sqlite');
  try {await this.db.backup(tmp);const snapshot=new Database(tmp,{readonly:true});const assets=snapshot.prepare('SELECT * FROM assets').all();snapshot.close();
   const database=fs.readFileSync(tmp);const pack={version:1,databaseHash:createHash('sha256').update(database).digest('hex'),database:database.toString('base64'),assets:assets.map(a=>({...a,data:fs.readFileSync(path.join(this.dir,'assets',a.id+'.'+a.ext)).toString('base64')}))};
   atomicWrite(target,JSON.stringify(pack));
  } finally {fs.rmSync(tmp,{force:true});}
 }
 async restore(file) {
  if(fs.statSync(file).size>512*1024*1024)throw Error('备份超过当前 512 MB 恢复限制');
  const pack=JSON.parse(fs.readFileSync(file,'utf8'));if(pack.version!==1||!Array.isArray(pack.assets))throw Error('备份格式不支持');
  const id=randomUUID(),dir=path.join(this.root,'generations',id);fs.mkdirSync(path.join(dir,'assets'),{recursive:true});
  const database=Buffer.from(pack.database,'base64');if(createHash('sha256').update(database).digest('hex')!==pack.databaseHash)throw Error('备份数据库校验失败');atomicWrite(path.join(dir,'journal.sqlite'),database);
  const check=new Database(path.join(dir,'journal.sqlite'));
  try {if(check.pragma('integrity_check',{simple:true})!=='ok'||check.pragma('user_version',{simple:true})!==1)throw Error('备份数据库无效');
   const map=new Map(pack.assets.map(a=>[a.id,a]));for(const a of check.prepare('SELECT * FROM assets').all()) {
    z.string().uuid().parse(a.id);if(!['png','jpg','webp'].includes(a.ext))throw Error('图片类型无效');const item=map.get(a.id);if(!item)throw Error('备份缺少图片');const b=Buffer.from(item.data,'base64');if(createHash('sha256').update(b).digest('hex')!==a.hash)throw Error('图片校验失败');atomicWrite(path.join(dir,'assets',a.id+'.'+a.ext),b);
   }
   for(const e of check.prepare('SELECT * FROM entries').all()){date.parse(e.entry_date);const doc=JSON.parse(e.content_json);inspect(doc);for(const asset of images(doc))if(!map.has(asset))throw Error('正文图片缺失');}
  }finally{check.close();}
  await this.backup(path.join(this.root,'before-restore-'+Date.now()+'.journalbackup'));
  const previous=fs.readFileSync(this.pointer,'utf8');this.db.close();
  try{this.point(id);this.open();}catch(e){atomicWrite(this.pointer,previous);this.open();throw e;}
 }
 close(){this.db.close();}
}
module.exports={Store,empty,text,inspect};
