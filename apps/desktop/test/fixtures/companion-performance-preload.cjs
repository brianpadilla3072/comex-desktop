const {contextBridge,ipcRenderer}=require('electron');
const listen=(name,callback)=>{const fn=(_event,...args)=>callback(...args);ipcRenderer.on(name,fn);return()=>ipcRenderer.removeListener(name,fn);};
ipcRenderer.on('openwork:companion:ping',(_event,id)=>ipcRenderer.send('openwork:companion:pong',id));
contextBridge.exposeInMainWorld('__OPENWORK_COMPANION_HOST__',{
 state:()=>ipcRenderer.invoke('openwork:companion:host-state'),publish:value=>ipcRenderer.send('openwork:companion:publish',value),clear:target=>ipcRenderer.send('openwork:companion:clear',target),reply:(id,result)=>ipcRenderer.send('openwork:companion:reply',id,result),
 onCommand:callback=>listen('openwork:companion:command',callback),recentSessions:value=>ipcRenderer.send('openwork:companion:recents',value),onSelectSession:callback=>listen('openwork:companion:select-session',callback),onReadSession:callback=>listen('openwork:companion:read-session',callback),onView:callback=>listen('openwork:companion:view-state',callback),
});
