import { posix, win32 } from 'node:path';

// Pure decision functions: explicit inputs, no processes, files, clock or network.
export function safeUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = ''; url.password = '';
    url.search = url.search ? '?redacted' : '';
    if (url.hash) url.hash = url.hash.startsWith('#/') ? url.hash.split('?')[0] : '#redacted';
    return url.href;
  } catch { return '[invalid URL]'; }
}
export function browserCandidates(platform, env) {
  const join = platform === 'win32' ? win32.join : posix.join;
  const names = platform === 'win32' ? ['chrome.exe', 'msedge.exe', 'chromium.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  const installed = platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : platform === 'win32' ? [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap(base => [join(base, 'Google/Chrome/Application/chrome.exe'), join(base, 'Microsoft/Edge/Application/msedge.exe')]) : [];
  return [env.CHROME_PATH, ...installed, ...(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean).flatMap(dir => names.map(name => join(dir, name)))].filter(Boolean);
}
export function parseArgs(argv) {
  const command = argv[0] ?? 'help';
  const options = {};
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--reload') { options.reload = true; continue; }
    if (!['--cdp', '--target', '--url', '--seconds', '--browser', '--session'].includes(key) || !argv[i + 1]) throw new Error('Unknown or missing option: ' + key);
    options[key.slice(2)] = argv[++i];
  }
  const seconds = Number(options.seconds ?? 8);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new Error('--seconds must be 1–60');
  return { command, options, seconds };
}

export function summarizeStates(states) {
  if (!states.length) return { redirected: false, welcome: false };
  return {
    redirected: states[0].url !== states.at(-1).url,
    welcome: /(?:\/|#\/)welcome(?:$|[/?#])/.test(states.at(-1).url),
  };
}
