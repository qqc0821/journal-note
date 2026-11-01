const {app,BrowserWindow,ipcMain,utilityProcess,dialog,protocol,Menu,shell,nativeImage}=require('electron');
const path=require('node:path');const fs=require('node:fs');const {randomUUID}=require('node:crypto');
protocol.registerSchemesAsPrivileged([{scheme:'journal-asset',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,worker,quit=false,closing=false;const pending=new Map();
if(process.env.JOURNAL_TEST_DATA)app.setPath('userData',process.env.JOURNAL_TEST_DATA);
const request=(method,args)=>new Promise((resolve,reject)=>{if(!worker)return reject(Error('数据服务不可用'));const id=randomUUID();pending.set(id,{resolve,reject});worker.postMessage({id,method,args});});
if(!app.requestSingleInstanceLock())app.quit();else {
app.on('second-instance',()=>{win?.show();win?.focus();});
app.whenReady().then(()=>{
 worker=utilityProcess.fork(path.join(__dirname,'data.cjs'),[app.getPath('userData')]);
 worker.on('message',m=>{const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.value);}});
 worker.on('exit',()=>{worker=null;for(const p of pending.values())p.reject(Error('数据服务已停止，请保留内容并重启应用'));pending.clear();});
 protocol.handle('journal-asset',async req=>{try{const id=new URL(req.url).hostname;const a=await request('asset',id);return new Response(a.bytes,{headers:{'Content-Type':a.mime}});}catch{return new Response('',{status:404});}});
 const valid=e=>{if(e.sender!==win?.webContents||e.senderFrame!==win.webContents.mainFrame)throw Error('请求来源无效');};
 for(const method of ['get','list','save','trash','read'])ipcMain.handle('journal:'+method,async(e,a)=>{valid(e);return request(method,a);});
 ipcMain.handle('journal:image',async(e,bytes)=>{valid(e);if(!bytes||bytes.length>20*1024*1024)throw Error('图片不能超过 20 MB');const image=nativeImage.createFromBuffer(Buffer.from(bytes));const size=image.getSize();if(image.isEmpty()||size.width*size.height>40000000)throw Error('图片无效或超过 4000 万像素');return request('importImage',{bytes});});
 ipcMain.handle('journal:openLink',async(e,url)=>{valid(e);const u=new URL(url);if(!['https:','http:'].includes(u.protocol))throw Error('不支持的链接');await shell.openExternal(u.href);});
 ipcMain.handle('journal:backup',async e=>{valid(e);const r=await dialog.showSaveDialog(win,{defaultPath:'日记-'+new Date().toISOString().slice(0,10)+'.journalbackup'});if(!r.canceled){await request('backup',r.filePath);return true;}return false;});
 ipcMain.handle('journal:restore',async e=>{valid(e);const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'日记备份',extensions:['journalbackup']}]});if(r.canceled)return false;const c=await dialog.showMessageBox(win,{type:'warning',message:'用备份替换当前日记库？',detail:'当前数据会先保留一份恢复前备份。恢复将包含备份中的回收站。',buttons:['取消','恢复'],defaultId:0,cancelId:0});if(c.response!==1)return false;await request('restore',r.filePaths[0]);return true;});
 ipcMain.handle('journal:export',async(e,a)=>{valid(e);if(typeof a?.text!=='string'||a.text.length>3000000)throw Error('导出内容无效');const r=await dialog.showSaveDialog(win,{defaultPath:'日记.txt',filters:[{name:'纯文本',extensions:['txt']},{name:'HTML 与图片',extensions:['html']}]});if(!r.canceled){if(r.filePath.endsWith('.html')&&a.content){const output=await request('html',a);const folder=path.basename(r.filePath,'.html')+'_images';const dir=path.join(path.dirname(r.filePath),folder);fs.mkdirSync(dir,{recursive:true});for(const asset of output.assets)fs.writeFileSync(path.join(dir,asset.id+'.'+asset.ext),Buffer.from(asset.bytes));fs.writeFileSync(r.filePath,output.html.replaceAll('__ASSETS__',folder),'utf8');}else fs.writeFileSync(r.filePath,a.text,'utf8');return true;}return false;});
 const create=()=>{win=new BrowserWindow({width:1120,height:760,minWidth:640,minHeight:480,titleBarStyle:'hiddenInset',backgroundColor:'#faf9f6',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});win.loadFile(path.join(__dirname,'../dist/index.html'));win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.on('close',e=>{if(!closing){e.preventDefault();win.webContents.send('flush-request');}});};
 ipcMain.on('flush-done',(e,ok)=>{if(e.sender===win?.webContents&&ok){closing=true;if(quit)app.quit();else win.close();}});
 app.on('before-quit',e=>{if(win&&!win.isDestroyed()&&!closing){e.preventDefault();quit=true;win.webContents.send('flush-request');}});
 app.on('activate',()=>{if(!win||win.isDestroyed()){closing=false;create();}});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Journal Note',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}]));create();
});}
