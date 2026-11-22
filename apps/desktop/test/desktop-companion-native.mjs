// Manual isolated native proof: run Electron under Xvfb, never the signed-in application.
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createDesktopCompanion} from '../electron/desktop-companion.mjs';
const require=createRequire(new URL('../package.json',import.meta.url));
const {app,BrowserWindow,Tray,Menu,globalShortcut,screen,ipcMain,nativeImage}=require('electron');
const directory=mkdtempSync(tmpdir()+'/openwork-companion-proof-');
const build=process.env.OPENWORK_COMPANION_BUILD;
if(!build)throw Error('Set OPENWORK_COMPANION_BUILD to the directory containing companion.html');
app.setPath('userData',directory);app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let controller,main,capsule,quitting=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(value,message)=>{if(!value)throw Error(message);};
void (async () => {
try {
 await app.whenReady();
 main=new BrowserWindow({show:false,webPreferences:{preload:fileURLToPath(new URL('./fixtures/companion-host.cjs',import.meta.url)),sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await main.loadURL('data:text/html,<title>Isolated host</title>');
 controller=createDesktopCompanion({enabled:true,app,BrowserWindow:function(options){capsule=new BrowserWindow(options);return capsule;},Tray,Menu,globalShortcut,screen,ipcMain,icon:nativeImage.createEmpty(),directory,preload:fileURLToPath(new URL('../electron/companion-preload.cjs',import.meta.url)),load:win=>win.loadFile(build+'/companion.html'),getMain:()=>main,quitting:()=>quitting,openMain:async()=>{main.show();main.focus();}});
 controller.attachMain(main);await controller.start();
 main.show();await delay(100);check(!capsule.isVisible(),'capsule remained visible beside main');
 main.hide();await delay(100);check(capsule.isVisible(),'hiding main did not reveal capsule');
 await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.openMain()');await delay(100);
 check(main.isVisible()&&!capsule.isVisible(),'opening main did not replace capsule');
 const snapshot={target:'native-target',sessionId:'fixture',workspaceId:'fixture-workspace',responseAt:Date.now()-300000,title:'Revisar la página de inicio',project:'Sitio del estudio',model:'Big Pickle',state:'idle',canSend:true,messages:[],activity:[],permission:null,question:null};
 await main.webContents.executeJavaScript(`window.__proof.publish(${JSON.stringify(snapshot)})`);await delay(250);
 const recents=[{key:JSON.stringify(['fixture-workspace','fixture']),workspaceId:'fixture-workspace',sessionId:'fixture',title:'Revisar la página de inicio',status:'idle',selected:true,responseAt:snapshot.responseAt,readAt:Date.now()-200000},{key:JSON.stringify(['fixture-workspace','unread']),workspaceId:'fixture-workspace',sessionId:'unread',title:'Propuesta de diseño',status:'unread',selected:false,responseAt:Date.now()-100000,readAt:0},{key:JSON.stringify(['fixture-workspace','seen']),workspaceId:'fixture-workspace',sessionId:'seen',title:'Archivos organizados',status:'idle',selected:false,responseAt:Date.now()-500000,readAt:Date.now()-400000}];
 await main.webContents.executeJavaScript(`window.__proof.recents(${JSON.stringify(recents)})`);await delay(100);
 main.close();check(!main.isDestroyed()&&!main.isVisible(),'main close did not hide');
 await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.view({expanded:true,focus:false})');
 let state=await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.state()');check(state.expanded&&state.snapshot.target==='native-target','native state not connected');
 check(await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.selectSession("unknown")')===false,'unknown selection accepted');
 check(await capsule.webContents.executeJavaScript(`window.__OPENWORK_COMPANION__.selectSession(${JSON.stringify(recents[0].key)})`)===true,'known selection rejected');
 check(await capsule.webContents.executeJavaScript(`window.__OPENWORK_COMPANION__.readSession(${JSON.stringify(recents[1].key)})`)===false,'wrong conversation marked read');
 check(await capsule.webContents.executeJavaScript(`window.__OPENWORK_COMPANION__.readSession(${JSON.stringify(recents[0].key)})`)===true,'displayed response not marked read');
 const reads=await main.webContents.executeJavaScript('window.__proof.reads()');check(reads.length===1&&reads[0].at===recents[0].responseAt,'read version missing');
 const command={id:'same-command',target:'native-target',action:{kind:'send',text:'fixture only',files:[]}};
 const replies=await capsule.webContents.executeJavaScript(`Promise.all([window.__OPENWORK_COMPANION__.command(${JSON.stringify(command)}),window.__OPENWORK_COMPANION__.command(${JSON.stringify(command)})])`);
 check(replies.every(reply=>reply.ok),'command acknowledgement failed');
 const commands=await main.webContents.executeJavaScript('window.__proof.commands()');check(commands.length===1,'command duplicated');
 await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.view({expanded:true,focus:true})');
 await delay(200);
 await capsule.webContents.executeJavaScript('document.querySelector("textarea").focus()');
 capsule.webContents.sendInputEvent({type:'char',keyCode:'z'});await delay(150);
 check(await capsule.webContents.executeJavaScript('document.querySelector("textarea").value')==='z','native dock could not receive keyboard input');
 capsule.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
 capsule.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});await delay(200);
 check(await capsule.webContents.executeJavaScript('document.querySelector("textarea").value')==='','native successful send did not clear input');
 const typedCommands=await main.webContents.executeJavaScript('window.__proof.commands()');
 check(typedCommands.length===2&&typedCommands[1].action.text==='z','native keyboard send not routed exactly once');
 for(let cycle=0;cycle<5;cycle++){
   await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.view({expanded:false})');await delay(30);
   check(capsule.getBounds().height===42,'folded native window did not shrink');
   await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.view({expanded:true})');await delay(30);
 }
 recents[0].status='waiting';await main.webContents.executeJavaScript(`window.__proof.recents(${JSON.stringify(recents)})`);
 snapshot.permission={id:'pending-permission',title:'Modificar archivo',detail:'inicio.html · datos de prueba',busy:false};snapshot.state='waiting';snapshot.canSend=false;
 await main.webContents.executeJavaScript(`window.__proof.publish(${JSON.stringify(snapshot)})`);await delay(300);
 check(!main.isVisible(),'alert restored main unexpectedly');
 state=await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.state()');check(state.expanded&&state.snapshot.permission.id==='pending-permission','permission alert missing');
 check(await capsule.webContents.executeJavaScript('document.querySelector("textarea")===null'),'permission did not replace the composer');
 await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.view({expanded:false})');
 state=await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.state()');check(!state.expanded&&state.snapshot.permission,'fold discarded permission');
 if(process.env.OPENWORK_COMPANION_FOLDED_SCREENSHOT){await delay(150);const image=await capsule.capturePage();await writeFile(process.env.OPENWORK_COMPANION_FOLDED_SCREENSHOT,image.toPNG());}
 await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.view({expanded:true,height:420})');await delay(300);
 if(process.env.OPENWORK_COMPANION_SCREENSHOT){const image=await capsule.capturePage();await writeFile(process.env.OPENWORK_COMPANION_SCREENSHOT,image.toPNG());}
 const bounds=capsule.getBounds(),display=screen.getPrimaryDisplay(),area=display.bounds;check(bounds.y===display.workArea.y && Math.abs(bounds.x-(area.x+(area.width-bounds.width)/2))<=1,'not top center');
 quitting=true;controller.dispose();main.close();await delay(300);check(main.isDestroyed(),'quit did not destroy main');
 console.log(JSON.stringify({checks:['isolated Electron X11','real sandboxed preload','main and capsule alternate on show/hide/openMain','close hides main','top center bounds','native IPC command once','native dock keyboard input and send','five fold/open cycles','permission replaces input, expands and survives folding','recent session selection allowlist','read response version binding','ordered disposal'],bounds}));
 await rm(directory,{recursive:true,force:true});app.exit(0);
} catch(error){console.error(error);quitting=true;controller?.dispose();main?.destroy();await rm(directory,{recursive:true,force:true});app.exit(1);}
})();
