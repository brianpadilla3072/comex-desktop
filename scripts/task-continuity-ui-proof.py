import json,sys,os
from playwright.sync_api import sync_playwright
connection=json.load(open(sys.argv[1]))
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1)
 context.add_init_script('const c='+json.dumps(connection)+';localStorage.setItem("openwork.server.urlOverride",c.base);localStorage.setItem("openwork.server.token",c.token);localStorage.setItem("openwork.server.hostToken",c.hostToken);')
 page=context.new_page()
 page.goto('http://127.0.0.1:5189/workspace/ws_proof/session/'+connection['sessionId'])
 page.wait_for_timeout(5000)
 later=page.get_by_role('button',name='Configurar después',exact=True)
 if later.count():later.click();page.wait_for_timeout(500)
 print('UI title:',page.title())

 # Open the existing project surface without navigation or model inference.
 button=page.get_by_role('button',name='Resultados y memoria del proyecto',exact=True)
 if not button.count():
  for label in ['Abrir panel lateral','Open side panel','Toggle panel','Mostrar panel','Panel lateral','Toggle side panel','Toggle right sidebar']:
   candidate=page.get_by_role('button',name=label,exact=True)
   if candidate.count():candidate.click();break
  page.wait_for_timeout(500)
 if button.count():button.click()
 page.get_by_test_id('task-continuity-panel').wait_for(timeout=20000)
 page.get_by_role('button',name='Objetivo y continuidad').click()
 page.wait_for_timeout(800)
 page.screenshot(path='docs/features/task-continuity/goal-complete.png',full_page=True)
 assert page.get_by_test_id('task-continuity-panel').get_by_text('Finalizado por el agente',exact=True).count()
 page.get_by_role('button',name='Trabajo aislado y cambios',exact=True).click()
 page.wait_for_timeout(1500)
 page.get_by_role('button',name='Continuar este chat en trabajo aislado',exact=True).wait_for()
 assert not page.get_by_test_id('comex-project-panel').get_by_role('alert').count()
 page.screenshot(path='docs/features/task-continuity/worktree-panel.png',full_page=True)
 print('UI proof passed: goal and worktree panels rendered against the real server')
 browser.close()
