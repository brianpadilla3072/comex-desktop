import { strToU8, zipSync, type Zippable } from "fflate";

/**
 * Builds a PowerPoint presentation (OOXML, 16:9) from rendered slide images. Pure: bytes in,
 * bytes out, no I/O. Every slide carries
 *   - a title placeholder with the page title (outline view, search and screen readers; the
 *     picture is drawn on top of it, so it never shows over the design),
 *   - the slide PNG as a full-bleed picture (alt text = page title),
 *   - a notes page with the speaker notes.
 * The package holds only the parts PowerPoint, Keynote and LibreOffice need: content types,
 * package relationships, document properties, presentation, one master + one layout, a notes
 * master, two themes, presentation/view properties and the table style list.
 */

export const PPTX_SLIDE_WIDTH_EMU = 12_192_000;
export const PPTX_SLIDE_HEIGHT_EMU = 6_858_000;
const NOTES_WIDTH_EMU = 6_858_000;
const NOTES_HEIGHT_EMU = 9_144_000;
export const PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export type PptxSlideInput = {
  title: string;
  notes: string;
  png: Uint8Array;
};

export type PptxInput = {
  title: string;
  slides: PptxSlideInput[];
  /** Creation time written to docProps/core.xml and the zip entries. */
  createdAt: Date;
};

export class PptxBuildError extends Error {
  constructor(readonly code: "no_slides" | "invalid_png", message: string) {
    super(message);
  }
}

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const PML_NS = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from the IHDR chunk, or null when the bytes are not a PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index++) if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  // Chunk type at 12..15 must be IHDR.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** XML text/attribute escaping; drops characters XML 1.0 cannot carry. */
export function xmlEscape(value: string): string {
  return value
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function relationships(entries: Array<{ id: string; type: string; target: string }>): string {
  const body = entries.map(entry => `<Relationship Id="${entry.id}" Type="${entry.type}" Target="${entry.target}"/>`).join("");
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
}

const GROUP_PROPS = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const TITLE_XFRM = '<a:xfrm><a:off x="838200" y="365125"/><a:ext cx="10515600" cy="1325563"/></a:xfrm>';

function paragraphs(text: string, lang: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.map(line => line
    ? `<a:p><a:r><a:rPr lang="${lang}" dirty="0"/><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`
    : `<a:p><a:endParaRPr lang="${lang}" dirty="0"/></a:p>`).join("");
}

function theme(name: string): string {
  const color = (tag: string, value: string) => `<a:${tag}><a:srgbClr val="${value}"/></a:${tag}>`;
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (width: number) => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/></a:ln>`;
  return `${XML_DECL}<a:theme xmlns:a="${NS_A}" name="${name}"><a:themeElements>`
    + `<a:clrScheme name="${name}"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>`
    + color("dk2", "1F2933") + color("lt2", "E7EBEF") + color("accent1", "2F6FB3") + color("accent2", "D9822B") + color("accent3", "6B7C8F")
    + color("accent4", "C29B0C") + color("accent5", "3E8E7E") + color("accent6", "6C9A3B") + color("hlink", "2F6FB3") + color("folHlink", "7A4FA0")
    + "</a:clrScheme>"
    + `<a:fontScheme name="${name}"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="${name}"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst>`
    + `<a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>`
    + "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>"
    + `<a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme>`
    + "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>";
}

function titleShape(title: string, withPosition: boolean): string {
  const body = title ? paragraphs(title, "es-ES") : '<a:p><a:endParaRPr lang="es-ES" dirty="0"/></a:p>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>`
    + `<p:spPr>${withPosition ? TITLE_XFRM : ""}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

/** Fits the image inside the slide (contain), centered. A 16:9 render is full-bleed. */
function pictureFrame(size: { width: number; height: number }): { x: number; y: number; cx: number; cy: number } {
  const slideRatio = PPTX_SLIDE_WIDTH_EMU / PPTX_SLIDE_HEIGHT_EMU;
  const imageRatio = size.width / size.height;
  if (Math.abs(imageRatio - slideRatio) < 0.001) return { x: 0, y: 0, cx: PPTX_SLIDE_WIDTH_EMU, cy: PPTX_SLIDE_HEIGHT_EMU };
  if (imageRatio > slideRatio) {
    const cy = Math.round(PPTX_SLIDE_WIDTH_EMU / imageRatio);
    return { x: 0, y: Math.round((PPTX_SLIDE_HEIGHT_EMU - cy) / 2), cx: PPTX_SLIDE_WIDTH_EMU, cy };
  }
  const cx = Math.round(PPTX_SLIDE_HEIGHT_EMU * imageRatio);
  return { x: Math.round((PPTX_SLIDE_WIDTH_EMU - cx) / 2), y: 0, cx, cy: PPTX_SLIDE_HEIGHT_EMU };
}

function slideXml(slide: PptxSlideInput, size: { width: number; height: number }): string {
  const frame = pictureFrame(size);
  const picture = `<p:pic><p:nvPicPr><p:cNvPr id="3" name="Slide image" descr="${xmlEscape(slide.title)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
    + `<p:spPr><a:xfrm><a:off x="${frame.x}" y="${frame.y}"/><a:ext cx="${frame.cx}" cy="${frame.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  return `${XML_DECL}<p:sld ${PML_NS}><p:cSld><p:spTree>${GROUP_PROPS}${titleShape(slide.title, true)}${picture}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function notesSlideXml(notes: string): string {
  const image = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>';
  const body = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs(notes, "es-ES")}</p:txBody></p:sp>`;
  return `${XML_DECL}<p:notes ${PML_NS}><p:cSld><p:spTree>${GROUP_PROPS}${image}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

function slideMasterXml(): string {
  return `${XML_DECL}<p:sldMaster ${PML_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_PROPS}${titleShape("", true)}</p:spTree></p:cSld>`
    + `${CLR_MAP}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>`
    + '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>';
}

function slideLayoutXml(): string {
  return `${XML_DECL}<p:sldLayout ${PML_NS} type="titleOnly" preserve="1"><p:cSld name="Title Only"><p:spTree>${GROUP_PROPS}${titleShape("", false)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function notesMasterXml(): string {
  const image = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>';
  const body = '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></p:txBody></p:sp>';
  return `${XML_DECL}<p:notesMaster ${PML_NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_PROPS}${image}${body}</p:spTree></p:cSld>${CLR_MAP}`
    + '<p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>';
}

function contentTypesXml(count: number): string {
  const override = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;
  let body = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>'
    + override("/ppt/presentation.xml", `${CT}.presentationml.presentation.main+xml`)
    + override("/ppt/slideMasters/slideMaster1.xml", `${CT}.presentationml.slideMaster+xml`)
    + override("/ppt/slideLayouts/slideLayout1.xml", `${CT}.presentationml.slideLayout+xml`)
    + override("/ppt/notesMasters/notesMaster1.xml", `${CT}.presentationml.notesMaster+xml`)
    + override("/ppt/theme/theme1.xml", `${CT}.theme+xml`)
    + override("/ppt/theme/theme2.xml", `${CT}.theme+xml`)
    + override("/ppt/presProps.xml", `${CT}.presentationml.presProps+xml`)
    + override("/ppt/viewProps.xml", `${CT}.presentationml.viewProps+xml`)
    + override("/ppt/tableStyles.xml", `${CT}.presentationml.tableStyles+xml`)
    + override("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml")
    + override("/docProps/app.xml", `${CT}.extended-properties+xml`);
  for (let index = 1; index <= count; index++) {
    body += override(`/ppt/slides/slide${index}.xml`, `${CT}.presentationml.slide+xml`);
    body += override(`/ppt/notesSlides/notesSlide${index}.xml`, `${CT}.presentationml.notesSlide+xml`);
  }
  return `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${body}</Types>`;
}

function presentationXml(count: number): string {
  const slideIds = Array.from({ length: count }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${10 + index}"/>`).join("");
  return `${XML_DECL}<p:presentation ${PML_NS} saveSubsetFonts="1">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + '<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>'
    + `<p:sldIdLst>${slideIds}</p:sldIdLst>`
    + `<p:sldSz cx="${PPTX_SLIDE_WIDTH_EMU}" cy="${PPTX_SLIDE_HEIGHT_EMU}"/><p:notesSz cx="${NOTES_WIDTH_EMU}" cy="${NOTES_HEIGHT_EMU}"/>`
    + "</p:presentation>";
}

function coreXml(title: string, createdAt: Date): string {
  const stamp = createdAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${xmlEscape(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;
}

function appXml(count: number): string {
  return `${XML_DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>OpenWork</Application><PresentationFormat>Widescreen</PresentationFormat><Slides>${count}</Slides><Notes>${count}</Notes></Properties>`;
}

export function buildPptx(input: PptxInput): Uint8Array {
  if (input.slides.length === 0) throw new PptxBuildError("no_slides", "La presentación no tiene diapositivas.");
  const sizes = input.slides.map((slide, index) => {
    const size = readPngSize(slide.png);
    if (!size) throw new PptxBuildError("invalid_png", `La imagen de la diapositiva ${index + 1} no es un PNG válido.`);
    return size;
  });
  const count = input.slides.length;
  const text = (value: string) => strToU8(value);
  const files: Zippable = {
    "[Content_Types].xml": text(contentTypesXml(count)),
    "_rels/.rels": text(relationships([
      { id: "rId1", type: `${REL}/officeDocument`, target: "ppt/presentation.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
      { id: "rId3", type: `${REL}/extended-properties`, target: "docProps/app.xml" },
    ])),
    "docProps/core.xml": text(coreXml(input.title, input.createdAt)),
    "docProps/app.xml": text(appXml(count)),
    "ppt/presentation.xml": text(presentationXml(count)),
    "ppt/_rels/presentation.xml.rels": text(relationships([
      { id: "rId1", type: `${REL}/slideMaster`, target: "slideMasters/slideMaster1.xml" },
      { id: "rId2", type: `${REL}/notesMaster`, target: "notesMasters/notesMaster1.xml" },
      { id: "rId3", type: `${REL}/theme`, target: "theme/theme1.xml" },
      { id: "rId4", type: `${REL}/presProps`, target: "presProps.xml" },
      { id: "rId5", type: `${REL}/viewProps`, target: "viewProps.xml" },
      { id: "rId6", type: `${REL}/tableStyles`, target: "tableStyles.xml" },
      ...input.slides.map((_, index) => ({ id: `rId${10 + index}`, type: `${REL}/slide`, target: `slides/slide${index + 1}.xml` })),
    ])),
    "ppt/presProps.xml": text(`${XML_DECL}<p:presentationPr ${PML_NS}/>`),
    "ppt/viewProps.xml": text(`${XML_DECL}<p:viewPr ${PML_NS}/>`),
    "ppt/tableStyles.xml": text(`${XML_DECL}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`),
    "ppt/theme/theme1.xml": text(theme("OpenWork")),
    "ppt/theme/theme2.xml": text(theme("OpenWork Notes")),
    "ppt/slideMasters/slideMaster1.xml": text(slideMasterXml()),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": text(relationships([
      { id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: `${REL}/theme`, target: "../theme/theme1.xml" },
    ])),
    "ppt/slideLayouts/slideLayout1.xml": text(slideLayoutXml()),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": text(relationships([
      { id: "rId1", type: `${REL}/slideMaster`, target: "../slideMasters/slideMaster1.xml" },
    ])),
    "ppt/notesMasters/notesMaster1.xml": text(notesMasterXml()),
    "ppt/notesMasters/_rels/notesMaster1.xml.rels": text(relationships([
      { id: "rId1", type: `${REL}/theme`, target: "../theme/theme2.xml" },
    ])),
  };
  input.slides.forEach((slide, index) => {
    const number = index + 1;
    files[`ppt/slides/slide${number}.xml`] = text(slideXml(slide, sizes[index]));
    files[`ppt/slides/_rels/slide${number}.xml.rels`] = text(relationships([
      { id: "rId1", type: `${REL}/slideLayout`, target: "../slideLayouts/slideLayout1.xml" },
      { id: "rId2", type: `${REL}/image`, target: `../media/image${number}.png` },
      { id: "rId3", type: `${REL}/notesSlide`, target: `../notesSlides/notesSlide${number}.xml` },
    ]));
    files[`ppt/notesSlides/notesSlide${number}.xml`] = text(notesSlideXml(slide.notes));
    files[`ppt/notesSlides/_rels/notesSlide${number}.xml.rels`] = text(relationships([
      { id: "rId1", type: `${REL}/notesMaster`, target: "../notesMasters/notesMaster1.xml" },
      { id: "rId2", type: `${REL}/slide`, target: `../slides/slide${number}.xml` },
    ]));
    // PNG is already compressed: store it.
    files[`ppt/media/image${number}.png`] = [slide.png, { level: 0 }];
  });
  return zipSync(files, { level: 6, mtime: input.createdAt });
}
