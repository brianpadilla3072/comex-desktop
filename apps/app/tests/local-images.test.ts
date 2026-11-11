import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { hydrateLocalImages, releaseLocalImages } from "../src/components/markdown/local-images";
GlobalRegistrator.register();
afterAll(() => GlobalRegistrator.unregister());
function fixture() {
  const root = document.createElement("div");
  root.innerHTML = '<img data-openwork-image-path="result.png" data-openwork-path-decode="true">';
  document.body.append(root);
  const image = root.querySelector("img")!;
  return { root, image, cache: new Map<string, Promise<string | null>>() };
}
test("an image still being saved is retried without leaving a loading marker forever", async () => {
  const f = fixture(); let attempts = 0;
  const stop = hydrateLocalImages(f.root, f.cache, async () => ++attempts === 1 ? null : "blob:saved");
  await new Promise(resolve => setTimeout(resolve, 650));
  expect(attempts).toBe(2);
  expect(f.image.getAttribute("src")).toBe("blob:saved");
  f.image.dispatchEvent(new Event("load"));
  expect(f.image.dataset.openworkImageState).toBe("loaded");
  stop(); f.root.remove();
});
test("a pending old-chat load cannot write into a mounted image after a context change", async () => {
  const f = fixture(); let resolveOld: (value: string) => void = () => {};
  const old = new Promise<string>(resolve => { resolveOld = resolve; });
  const stopOld = hydrateLocalImages(f.root, f.cache, () => old);
  stopOld(); releaseLocalImages(f.root, f.cache);
  const stopNew = hydrateLocalImages(f.root, new Map(), async () => "blob:new-chat");
  await Promise.resolve(); resolveOld("blob:old-chat"); await Promise.resolve();
  expect(f.image.getAttribute("src")).toBe("blob:new-chat");
  stopNew(); f.root.remove();
});
test("cleanup cancels bounded retries and permits a future render to try again", async () => {
  const f = fixture(); let attempts = 0;
  const stop = hydrateLocalImages(f.root, f.cache, async () => { attempts++; return null; });
  await Promise.resolve(); stop();
  await new Promise(resolve => setTimeout(resolve, 600));
  expect(attempts).toBe(1);
  expect(f.image.dataset.openworkImageState).toBeUndefined();
  f.root.remove();
});
test("a render between URL assignment and image load reinstalls the load listener", async () => {
  const f = fixture();
  const stopFirst = hydrateLocalImages(f.root, f.cache, async () => "blob:pending-load");
  await Promise.resolve();
  expect(f.image.dataset.openworkImageState).toBe("loading");
  stopFirst();
  const stopNext = hydrateLocalImages(f.root, f.cache, async () => { throw new Error("cached URL must be reused"); });
  await Promise.resolve(); f.image.dispatchEvent(new Event("load"));
  expect(f.image.dataset.openworkImageState).toBe("loaded");
  stopNext(); f.root.remove();
});
