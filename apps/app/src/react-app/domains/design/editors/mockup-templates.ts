/**
 * Starting points for a new screen. Each is a self-contained, responsive HTML document (no
 * network, no scripts) with neutral sample content; the agent or the person refines it later.
 */

export type MockupTemplateId = "blank" | "landing" | "form" | "dashboard" | "list";
export const MOCKUP_TEMPLATE_IDS: MockupTemplateId[] = ["blank", "landing", "form", "dashboard", "list"];

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f2933;background:#f5f7fa;line-height:1.5}
a{color:inherit}.wrap{max-width:1120px;margin:0 auto;padding:24px}
.btn{display:inline-block;padding:10px 18px;border-radius:10px;background:#1f2933;color:#fff;text-decoration:none;font-weight:600;border:0}
.btn.secondary{background:#e4e7eb;color:#1f2933}.card{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 2px rgba(15,23,42,.06),0 4px 16px rgba(15,23,42,.05)}
.muted{color:#616e7c}header.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;background:#fff;border-bottom:1px solid #e4e7eb}
.logo{font-weight:700}nav.links{display:flex;gap:20px}@media (max-width:700px){nav.links{display:none}.wrap{padding:16px}}`;

function documentHtml(title: string, body: string, css = ""): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${BASE_CSS}${css}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

const TEMPLATES: Record<MockupTemplateId, (title: string) => string> = {
  blank: title => documentHtml(title, `<main class="wrap"><h1>${title}</h1><p class="muted">Contenido de la pantalla.</p></main>`),
  landing: title => documentHtml(title, `<header class="top"><span class="logo">Marca</span><nav class="links"><a href="#">Productos</a><a href="#">Precios</a><a href="#">Contacto</a></nav><a class="btn" href="#">Empezar</a></header>
<main class="wrap"><section class="hero"><div><h1>Un título claro para tu propuesta</h1><p class="muted">Una frase que explica el beneficio principal en pocas palabras.</p><p><a class="btn" href="#">Probar ahora</a> <a class="btn secondary" href="#">Ver más</a></p></div><div class="art" aria-hidden="true"></div></section>
<section class="grid"><div class="card"><h3>Rápido</h3><p class="muted">Describe una ventaja concreta.</p></div><div class="card"><h3>Simple</h3><p class="muted">Describe una ventaja concreta.</p></div><div class="card"><h3>Seguro</h3><p class="muted">Describe una ventaja concreta.</p></div></section></main>`,
  `.hero{display:grid;grid-template-columns:1.2fr 1fr;gap:32px;align-items:center;padding:48px 0}.hero h1{font-size:44px;line-height:1.1;margin:0 0 12px}.art{aspect-ratio:4/3;border-radius:20px;background:linear-gradient(135deg,#e3f8ff,#d9e2ec)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding-bottom:48px}@media (max-width:700px){.hero{grid-template-columns:1fr;padding:24px 0}.hero h1{font-size:32px}.grid{grid-template-columns:1fr}}`),
  form: title => documentHtml(title, `<main class="wrap narrow"><div class="card"><h1>${title}</h1><p class="muted">Completa los datos para continuar.</p>
<form><label>Nombre<input type="text" placeholder="Nombre y apellido"></label><label>Correo<input type="email" placeholder="nombre@ejemplo.com"></label><label>Mensaje<textarea rows="4" placeholder="Escribe aquí"></textarea></label><button class="btn" type="button">Enviar</button></form></div></main>`,
  `.narrow{max-width:520px;padding-top:48px}form{display:flex;flex-direction:column;gap:14px;margin-top:16px}label{display:flex;flex-direction:column;gap:6px;font-weight:600;font-size:14px}
input,textarea{font:inherit;font-weight:400;padding:10px 12px;border:1px solid #cbd2d9;border-radius:10px;background:#fff}h1{margin:0 0 4px;font-size:26px}`),
  dashboard: title => documentHtml(title, `<div class="layout"><aside class="side"><span class="logo">Panel</span><a href="#" class="active">Resumen</a><a href="#">Pedidos</a><a href="#">Clientes</a><a href="#">Ajustes</a></aside>
<main class="wrap"><h1>${title}</h1><section class="kpis"><div class="card"><p class="muted">Ventas</p><strong>128</strong></div><div class="card"><p class="muted">Pedidos abiertos</p><strong>24</strong></div><div class="card"><p class="muted">Clientes nuevos</p><strong>9</strong></div></section>
<section class="card"><h3>Actividad reciente</h3><table><thead><tr><th>Pedido</th><th>Estado</th><th>Fecha</th></tr></thead><tbody><tr><td>N.º 1042</td><td>En curso</td><td>Hoy</td></tr><tr><td>N.º 1041</td><td>Entregado</td><td>Ayer</td></tr><tr><td>N.º 1040</td><td>Entregado</td><td>Lunes</td></tr></tbody></table></section></main></div>`,
  `.layout{display:grid;grid-template-columns:220px 1fr;min-height:100vh}.side{display:flex;flex-direction:column;gap:6px;padding:20px;background:#fff;border-right:1px solid #e4e7eb}.side a{padding:8px 10px;border-radius:8px;text-decoration:none;color:#52606d}.side a.active{background:#f0f4f8;color:#1f2933;font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px}.kpis strong{font-size:28px}.kpis p{margin:0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #e4e7eb}th{font-size:13px;color:#616e7c}
@media (max-width:700px){.layout{grid-template-columns:1fr}.side{flex-direction:row;overflow-x:auto}.kpis{grid-template-columns:1fr}}`),
  list: title => documentHtml(title, `<header class="top"><span class="logo">${title}</span><a class="btn" href="#">Nuevo</a></header>
<main class="wrap"><input class="search" type="search" placeholder="Buscar"><ul class="items"><li class="card"><div><strong>Elemento uno</strong><p class="muted">Detalle breve del elemento.</p></div><span class="chip">Activo</span></li><li class="card"><div><strong>Elemento dos</strong><p class="muted">Detalle breve del elemento.</p></div><span class="chip">Pendiente</span></li><li class="card"><div><strong>Elemento tres</strong><p class="muted">Detalle breve del elemento.</p></div><span class="chip">Activo</span></li></ul></main>`,
  `.search{width:100%;font:inherit;padding:10px 14px;border:1px solid #cbd2d9;border-radius:12px;margin-bottom:16px}.items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}.items li{display:flex;align-items:center;justify-content:space-between;gap:12px}.items p{margin:2px 0 0}
.chip{font-size:13px;padding:4px 10px;border-radius:999px;background:#f0f4f8;color:#52606d}`),
};

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The HTML of a new screen from a template, with the (escaped) screen title. */
export function mockupTemplateHtml(id: MockupTemplateId, title: string): string {
  return TEMPLATES[id](escapeHtml(title));
}
