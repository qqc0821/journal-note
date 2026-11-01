const {Store}=require('./store.cjs');
const store=new Store(process.argv[2]);let queue=Promise.resolve();
process.parentPort.on('message',({data})=>{queue=queue.then(async()=>{try{const allowed=['html','get','list','save','trash','read','importImage','asset','backup','restore'];if(!allowed.includes(data.method))throw Error('未知操作');const value=await store[data.method](data.args);process.parentPort.postMessage({id:data.id,value});}catch(e){process.parentPort.postMessage({id:data.id,error:e.message});}});});
