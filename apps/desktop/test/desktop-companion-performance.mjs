// Controlled Electron measurement, no engines, models or signed-in profile.
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir,cpus} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(new URL('../package.json',import.meta.url));
const {app,BrowserWindow,Tray,Menu,globalShortcut,screen,ipcMain,nativeImage}=require('electron');
const build=process.env.COMPANION_PERFORMANCE_BUILD, output=process.env.COMPANION_PERFORMANCE_RESULT;
if(!build||!output)throw Error('COMPANION_PERFORMANCE_BUILD and COMPANION_PERFORMANCE_RESULT are required');
const directory=mkdtempSync(tmpdir()+'/companion-performance-');
app.setPath('userData',directory);app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let main,capsule,controller,quitting=false;
const counts={snapshots:0,recents:0,state:0,view:0,pongs:0};
for(const [event,field] of [['publish','snapshots'],['recents','recents'],['pong','pongs']])ipcMain.on('openwork:companion:'+event,()=>counts[field]++);
const register=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,handler)=>register(channel,(event,...args)=>{if(channel==='openwork:companion:view')counts.view++;return handler(event,...args)});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const duration=Number(process.env.COMPANION_PERFORMANCE_SECONDS||15)*1000;
const enabled=process.env.COMPANION_PERFORMANCE_ENABLED!=='false';
const memory=async metrics=>{
 let pssKiB=0,processes=0;
 for(const metric of metrics){try{const raw=await readFile(`/proc/${metric.pid}/smaps_rollup`,'utf8');const match=/^Pss:\s+(\d+) kB$/m.exec(raw);if(match){pssKiB+=Number(match[1]);processes++;}}catch{}}
 return {pssMiB:Math.round(pssKiB/1024*100)/100,processes};
};
void(async()=>{try{
 await app.whenReady();
 const controllerUrl=process.env.COMPANION_PERFORMANCE_CONTROLLER?pathToFileURL(process.env.COMPANION_PERFORMANCE_CONTROLLER):new URL('../electron/desktop-companion.mjs',import.meta.url);
 const {createDesktopCompanion}=await import(controllerUrl.href);
 main=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,preload:fileURLToPath(new URL('./fixtures/companion-performance-preload.cjs',import.meta.url)),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 controller=createDesktopCompanion({enabled,app,BrowserWindow:function(options){capsule=new BrowserWindow(options);const send=capsule.webContents.send.bind(capsule.webContents);capsule.webContents.send=(channel,...args)=>{if(channel==='openwork:companion:state')counts.state++;return send(channel,...args)};return capsule;},Tray,Menu,globalShortcut,screen,ipcMain,icon:nativeImage.createEmpty(),directory,preload:fileURLToPath(new URL('../electron/companion-preload.cjs',import.meta.url)),load:win=>win.loadFile(build+'/companion.html'),getMain:()=>main,quitting:()=>quitting,openMain:async()=>{}});
 controller.attachMain(main);await main.loadFile(build+'/tests/fixtures/companion-performance.html');await controller.start();await wait(2000);
 if(capsule)await capsule.webContents.executeJavaScript('window.__OPENWORK_COMPANION__.preferences({mascot:"sprout",image:"",motion:false,autoClose:30})');
 const phases=[];
 for(const phase of ['idle-folded','working-folded','working-expanded']){
  await main.webContents.executeJavaScript(`window.__companionPerformance.working(${phase!=='idle-folded'})`);
  if(capsule)await capsule.webContents.executeJavaScript(`window.__OPENWORK_COMPANION__.view({expanded:${phase==='working-expanded'}})`);
  await wait(500);
  const startCount={...counts}, startSnapshots=await main.webContents.executeJavaScript('window.__companionPerformance.snapshots');
  app.getAppMetrics();const started=performance.now();await wait(duration);const elapsed=(performance.now()-started)/1000, metrics=app.getAppMetrics();
  const deltas=Object.fromEntries(Object.entries(counts).map(([name,value])=>[name,value-startCount[name]]));
  const snapshots=(await main.webContents.executeJavaScript('window.__companionPerformance.snapshots'))-startSnapshots;
  phases.push({phase,seconds:Math.round(elapsed*100)/100,cpuPercentElectron:Math.round(metrics.reduce((sum,metric)=>sum+metric.cpu.percentCPUUsage,0)*1000)/1000,...await memory(metrics),packets:deltas,snapshotBuilds:snapshots});
 }
 const result={label:process.env.COMPANION_PERFORMANCE_LABEL||'fixture',enabled,electron:process.versions.electron,node:process.versions.node,cpu:cpus()[0]?.model,logicalCpus:cpus().length,animation:false,streamHz:20,scope:'isolated actual React host and capsule, no inference/backend; Linux summed PSS of Electron-owned processes',phases};
 await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));quitting=true;controller.dispose();main.destroy();await rm(directory,{recursive:true,force:true});app.exit(0);
}catch(error){console.error(error);quitting=true;controller?.dispose();main?.destroy();await rm(directory,{recursive:true,force:true});app.exit(1)}})();
