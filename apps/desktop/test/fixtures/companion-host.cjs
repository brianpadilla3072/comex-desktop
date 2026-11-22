const {contextBridge,ipcRenderer}=require('electron');
const commands=[], selections=[], reads=[];
ipcRenderer.on("openwork:companion:select-session",(_event,key)=>selections.push(key));
ipcRenderer.on("openwork:companion:read-session",(_event,key,at)=>reads.push({key,at}));
ipcRenderer.on('openwork:companion:command',(_event,value)=>{commands.push(value);ipcRenderer.send('openwork:companion:reply',value.id,{ok:true});});
contextBridge.exposeInMainWorld('__proof',{publish:value=>ipcRenderer.send('openwork:companion:publish',value),commands:()=>commands,recents:value=>ipcRenderer.send("openwork:companion:recents",value),selections:()=>selections,reads:()=>reads});
