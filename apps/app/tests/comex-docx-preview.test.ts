import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { buildZip, utf8Bytes } from "@openwork/workbook";

const ownsDom = !GlobalRegistrator.isRegistered;
if (ownsDom) GlobalRegistrator.register({ url: "http://localhost/" });
const { docxPreviewDocument } = await import("../src/react-app/domains/session/artifacts/docx-preview-document");
afterAll(async () => { if (ownsDom) await GlobalRegistrator.unregister(); });

async function fixture(extra: { name: string; data: Uint8Array }[] = []) {
  const zip = await buildZip([
    { name: "[Content_Types].xml", data: utf8Bytes('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: "_rels/.rels", data: utf8Bytes('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: "word/document.xml", data: utf8Bytes('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Documento de prueba</w:t></w:r></w:p><w:altChunk r:id="evil"/></w:body></w:document>') },
    ...extra,
  ]);
  return new Uint8Array(zip).buffer;
}
test("refuses invalid archives, non-Word files, macros, signatures and XML DTDs", async () => {
  await expect(docxPreviewDocument(new Uint8Array(13 * 1024 * 1024).buffer)).rejects.toThrow();
  const nonWord = await buildZip([{ name: "other.xml", data: utf8Bytes("<x/>") }]);
  await expect(docxPreviewDocument(new Uint8Array(nonWord).buffer)).rejects.toThrow();
  for (const name of ["word/vbaProject.bin", "_xmlsignatures/sig1.xml"]) {
    await expect(docxPreviewDocument(await fixture([{ name, data: utf8Bytes("test") }]))).rejects.toThrow();
  }
  const dtd = await buildZip([{ name: "word/document.xml", data: utf8Bytes('<!DOCTYPE x [<!ENTITY e SYSTEM "https://example.invalid/leak">]><x>&e;</x>') }]);
  await expect(docxPreviewDocument(new Uint8Array(dtd).buffer)).rejects.toThrow();
});
test("renders real text while excluding active HTML fragments and external resources", async () => {
  const result = await docxPreviewDocument(await fixture([
    { name: "word/_rels/document.xml.rels", data: utf8Bytes('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="evil.html"/></Relationships>') },
    { name: "word/evil.html", data: utf8Bytes('<script>parent.attacked=true</script><img src="https://example.invalid/leak">') },
  ]));
  expect(result.html).toContain("Documento de prueba");
  expect(result.html).toContain("default-src 'none'");
  expect(result.html).not.toContain("parent.attacked");
  expect(result.html).not.toContain("https://example.invalid/leak");
  expect(result.pageWidth).toBeGreaterThan(0);
});
