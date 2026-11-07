#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecoveryManifest, selectRecoveryArtifact } from "../../apps/desktop/electron/recovery.mjs";

const manifests = { win: "latest.yml", linux: "latest-linux.yml" };

async function sha512(filePath) {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("base64");
}

// Only verified installer files and their metadata leave the build job.
// Never upload the unpacked app, debug YAML, or an incomplete platform feed.
export async function stageComexArtifacts(source, version, target, destination) {
  if (!/^1\.0\.\d+$/.test(version)) throw new Error("Expected a Comex 1.0.N release version.");
  const targets = target === "all" ? Object.keys(manifests) : [target];
  const staged = new Set();
  for (const platformTarget of targets) {
    const manifest = manifests[platformTarget];
    if (!manifest) throw new Error(`Unsupported release target: ${platformTarget}`);
    const raw = await readFile(path.join(source, manifest), "utf8");
    const manifestVersion = /^version:\s*['"]?([\d.]+)['"]?\s*$/m.exec(raw)?.[1];
    if (manifestVersion !== version) throw new Error(`${manifest}: release version does not match ${version}.`);
    const files = parseRecoveryManifest(raw);
    const installer = selectRecoveryArtifact(files, {
      version, platform: platformTarget === "win" ? "win32" : "linux", arch: "x64", distribution: "public",
    });
    if (!installer) throw new Error(`${manifest}: missing compatible Comex installer.`);
    staged.add(manifest);
    for (const file of files) {
      if (typeof file.url !== "string" || !/^[A-Za-z0-9._-]+$/.test(file.url) || file.url === "." || file.url === "..") {
        throw new Error(`${manifest}: artifact must be a local filename.`);
      }
      const filePath = path.join(source, file.url);
      const info = await stat(filePath);
      if (!info.isFile() || info.size === 0 || Number(file.size) !== info.size) {
        throw new Error(`${file.url}: incorrect artifact size.`);
      }
      if (await sha512(filePath) !== file.sha512) throw new Error(`${file.url}: SHA-512 mismatch.`);
      staged.add(file.url);
      // NSIS emits an external blockmap; AppImage embeds its blockmap.
      if (platformTarget === "win") {
        const blockmap = `${file.url}.blockmap`;
        if (!(await stat(path.join(source, blockmap))).isFile()) throw new Error(`Missing ${blockmap}.`);
        staged.add(blockmap);
      }
    }
  }
  // Stage only after every required platform has passed verification.
  await mkdir(destination, { recursive: true });
  for (const filename of staged) await copyFile(path.join(source, filename), path.join(destination, filename));
  return [...staged];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, version, target, destination] = process.argv.slice(2);
  if (!source || !version || !target || !destination) {
    throw new Error("Usage: comex-artifacts.mjs SOURCE VERSION win|linux|all DESTINATION");
  }
  console.log(await stageComexArtifacts(source, version, target, destination));
}
