#!/usr/bin/env node
// CI installs the pinned standalone distribution; the app never downloads Python.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { buildPortablePython } from "./comex-python-runtime.mjs";
const execute = promisify(execFile);
const version = "3.12.12";
const installDir = resolve(process.env.RUNNER_TEMP ?? "tmp", "comex-python-source");
const env = { ...process.env, UV_PYTHON_INSTALL_DIR: installDir, UV_CACHE_DIR: resolve(process.env.RUNNER_TEMP ?? "tmp", "comex-uv-cache") };
await execute("uv", ["python", "install", version, "--no-bin", "--no-registry"], { env, timeout: 300_000, windowsHide: true });
const executable = (await execute("uv", ["python", "find", version, "--managed-python"], { env, timeout: 30_000, windowsHide: true })).stdout.trim();
const pythonRoot = process.platform === "win32" ? dirname(executable) : dirname(dirname(executable));
const result = await buildPortablePython({ pythonRoot, out: "apps/desktop/vendor/comex-python" });
console.log(JSON.stringify(result, null, 2));
