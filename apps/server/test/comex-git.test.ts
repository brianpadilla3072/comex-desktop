import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewGitWorkspace, createGitWorktree } from "../src/comex/git.js";
import { comexGitWorkspaceEnabled, comexContinuityEnabled } from "../src/comex/features.js";

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "comex-git-"));
  const root = join(parent, "project"); await mkdir(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: "pipe" });
  git("init"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "report.md"), "original\n"); git("add", "."); git("commit", "-m", "fixture");
  return { root, parent, git };
}

test("new features default off, respect operator switches and exclude cloud", () => {
  assert.equal(comexGitWorkspaceEnabled({}), false);
  assert.equal(comexContinuityEnabled({}), false);
  assert.equal(comexGitWorkspaceEnabled({ DEN_FEATURE_COMEX_GIT_WORKSPACE: "true" }), true);
  assert.equal(comexContinuityEnabled({ DEN_FEATURE_COMEX_CONTINUITY: "true" }), true);
  assert.equal(comexGitWorkspaceEnabled({ DEN_DEPLOYMENT: "cloud", DEN_FEATURE_COMEX_GIT_WORKSPACE: "true" }), false);
});

test("review includes staged, unstaged and untracked state without changing files", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "report.md"), "prepared\n"); f.git("add", "report.md");
    await writeFile(join(f.root, "report.md"), "working\n");
    await writeFile(join(f.root, "new file.txt"), "new");
    const review = await reviewGitWorkspace(f.root);
    assert.match(review.diff, /prepared/); assert.match(review.diff, /working/);
    assert.ok(review.status.some(line => line.includes("new file.txt")));
    assert.equal(await readFile(join(f.root, "report.md"), "utf8"), "working\n");
    await mkdir(join(f.root, "nested"));
    await assert.rejects(reviewGitWorkspace(join(f.root, "nested")), /raíz/);
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("isolated work starts at reviewed commit, preserves dirty source, rejects stale commits", async () => {
  const f = await fixture();
  try {
    const head = f.git("rev-parse", "HEAD").trim();
    await writeFile(join(f.root, "report.md"), "uncommitted\n");
    const work = await createGitWorktree(f.root, join(f.parent, "runtime"), head);
    assert.equal(await readFile(join(work.path, "report.md"), "utf8"), "original\n");
    assert.equal(await readFile(join(f.root, "report.md"), "utf8"), "uncommitted\n");
    assert.equal(work.includesUncommittedChanges, false);
    assert.equal(execFileSync("git", ["-C", work.path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), head);
    await assert.rejects(createGitWorktree(f.root, join(f.parent, "runtime"), "0".repeat(40)), /Cambió el commit/);
    await mkdir(join(f.parent, "outside"));
    await symlink(join(f.parent, "outside"), join(f.parent, "linked"), "dir");
    await assert.rejects(createGitWorktree(f.root, join(f.parent, "linked"), head), /enlaces/);
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("large diffs return bounded previews rather than failing maxBuffer", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, "report.md"), "changed line for bounded diff\n".repeat(100_000));
    const review = await reviewGitWorkspace(f.root);
    assert.equal(review.truncated, true);
    assert.ok(review.diff.length <= 160_000);
    assert.match(review.diff, /changed line/);
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("inherited Git overrides cannot redirect review to a different repository", async () => {
  const f = await fixture();
  const external = await fixture();
  const previousDirectory = process.env.GIT_DIR;
  const previousWorktree = process.env.GIT_WORK_TREE;
  try {
    process.env.GIT_DIR = join(external.root, ".git");
    process.env.GIT_WORK_TREE = external.root;
    await writeFile(join(f.root, "report.md"), "registered workspace change\n");
    const review = await reviewGitWorkspace(f.root);
    assert.equal(review.root, f.root);
    assert.match(review.diff, /registered workspace change/);
  } finally {
    if (previousDirectory === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previousDirectory;
    if (previousWorktree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = previousWorktree;
    await rm(f.parent, { recursive: true, force: true });
    await rm(external.parent, { recursive: true, force: true });
  }
});

test("review and checkout do not execute configured clean, smudge, process or hooks", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.root, ".gitattributes"), "report.md filter=untrusted\n");
    f.git("add", ".gitattributes"); f.git("commit", "-m", "attributes fixture");
    await writeFile(join(f.root, ".git", "hooks", "post-checkout"), "#!/bin/sh\nexit 96\n", { mode: 0o755 });
    // A failing process would break status/checkout if it were ever executed.
    f.git("config", "filter.untrusted.process", "exit 93");
    f.git("config", "filter.untrusted.clean", "exit 94");
    f.git("config", "filter.untrusted.smudge", "exit 95");
    f.git("config", "filter.untrusted.required", "true");
    await writeFile(join(f.root, "report.md"), "dirty source\n");
    const review = await reviewGitWorkspace(f.root);
    assert.match(review.diff, /dirty source/);
    const head = f.git("rev-parse", "HEAD").trim();
    const work = await createGitWorktree(f.root, join(f.parent, "runtime"), head);
    assert.equal(await readFile(join(work.path, "report.md"), "utf8"), "original\n");
    assert.equal(await readFile(join(f.root, "report.md"), "utf8"), "dirty source\n");
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});

test("review does not execute filters inside initialized submodules", async () => {
  const f = await fixture();
  try {
    const sub = join(f.root, "sub"); await mkdir(sub);
    const subGit = (...args: string[]) => execFileSync("git", ["-C", sub, ...args], { encoding: "utf8", stdio: "pipe" });
    subGit("init"); subGit("config", "user.name", "Test"); subGit("config", "user.email", "test@example.invalid");
    await writeFile(join(sub, "file.txt"), "original\n");
    await writeFile(join(sub, ".gitattributes"), "file.txt filter=evil\n");
    subGit("add", "."); subGit("commit", "-m", "submodule fixture");
    f.git("config", "-f", ".gitmodules", "submodule.sub.path", "sub");
    f.git("add", "sub", ".gitmodules"); f.git("commit", "-m", "submodule gitlink");
    subGit("config", "filter.evil.clean", "exit 97");
    subGit("config", "filter.evil.required", "true");
    await writeFile(join(sub, "file.txt"), "dirty submodule\n");
    const review = await reviewGitWorkspace(f.root);
    assert.equal(review.head, f.git("rev-parse", "HEAD").trim());
    assert.equal(await readFile(join(sub, "file.txt"), "utf8"), "dirty submodule\n");
  } finally { await rm(f.parent, { recursive: true, force: true }); }
});
