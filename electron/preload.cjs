const {contextBridge,ipcRenderer}=require('electron');
const invoke=(name,args)=>ipcRenderer.invoke('journal:'+name,args);
contextBridge.exposeInMainWorld('journal',Object.fromEntries(['get','list','save','trash','read','image','backup','restore','export','openLink'].map(name=>[name,args=>invoke(name,args)])));
contextBridge.exposeInMainWorld('lifecycle',{onFlush:callback=>{ipcRenderer.on('flush-request',()=>callback());},done:ok=>ipcRenderer.send('flush-done',ok)});
