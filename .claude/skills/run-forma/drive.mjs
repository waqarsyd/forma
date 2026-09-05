/*
 * Drives the running Forma workspace in a headless browser over the Chrome
 * DevTools Protocol, and reports what the app actually shows.
 *
 * Deliberately dependency-free. Node 20+ has a global WebSocket and fetch, so
 * this needs no puppeteer and no playwright -- neither is installed here, and
 * adding one to run the app would be a dependency the product does not have.
 *
 * Pure ASCII on purpose. Windows PowerShell 5.1 decodes a BOM-less script as
 * ANSI, so any non-ASCII character in here is one bad round-trip from mojibake;
 * see the encoding bullet in CLAUDE.md.
 *
 * Usage (see SKILL.md for the full sequence):
 *   node .claude/skills/run-forma/drive.mjs --out <dir> [options]
 *
 *   --out <dir>        where screenshots and console.txt go        (default .)
 *   --url <url>        page to open       (default localhost:3000/workspace)
 *   --port <n>         CDP port                                    (default 9222)
 *   --attach <file>    attach a file before generating; repeatable
 *   --prompt <text>    text to send with the generation
 *   --say <text>       a chat turn after the report arrives; repeatable
 *   --pane <name>      open a pane at the end: Mockup | Spec | REPX
 *   --no-key           do not seed a placeholder API key
 *   --wait <seconds>   how long to wait for a generation      (default 60)
 *
 * Exit code is non-zero if a step could not complete, so it is usable as a check.
 */
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = { out: '.', url: 'http://localhost:3000/workspace', port: 9222, attach: [], say: [], prompt: '', pane: '', key: true, wait: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') opts.out = next();
    else if (a === '--url') opts.url = next();
    else if (a === '--port') opts.port = Number(next());
    else if (a === '--attach') opts.attach.push(path.resolve(next()));
    else if (a === '--say') opts.say.push(next());
    else if (a === '--prompt') opts.prompt = next();
    else if (a === '--pane') opts.pane = next();
    else if (a === '--no-key') opts.key = false;
    else if (a === '--wait') opts.wait = Number(next());
    else throw new Error('unknown argument: ' + a);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
fs.mkdirSync(opts.out, { recursive: true });

// ------------------------------------------------------------- CDP plumbing

const targets = await (await fetch(`http://127.0.0.1:${opts.port}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
if (!target) throw new Error(`no page target on port ${opts.port} -- is the browser running?`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let seq = 0;
const pending = new Map();
const consoleLines = [];

ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    consoleLines.push(`[${msg.params.type}] ${text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLines.push('[exception] ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  }
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}

/** Poll a boolean expression until it holds. Returns seconds waited. */
async function until(label, expression, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await evalJs(expression)) return i / 2;
    await sleep(500);
  }
  throw new Error(`timed out after ${seconds}s waiting for ${label}`);
}

/*
 * Click with real mouse events at the element's centre.
 *
 * React ignores a synthetic click dispatched from page script for anything
 * that matters, and el.click() skips the pointer sequence some handlers want.
 * Input.dispatchMouseEvent is the browser's own input path, so the app cannot
 * tell it from a person.
 */
async function click(selector) {
  const box = await evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: !!el.disabled };
  })()`);
  if (!box) throw new Error('no element matching ' + selector);
  if (box.disabled) throw new Error('element is disabled: ' + selector);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
}

/** Type into the composer. Input.insertText updates React state; setting .value does not. */
async function type(text) {
  await click(SEL.composer);
  await send('Input.insertText', { text });
  await sleep(200);
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(opts.out, name);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`shot   ${file} (${fs.statSync(file).size} bytes)`);
}

// ------------------------------------------------------------- app knowledge

/*
 * Selectors, in one place because they are the part that rots. Every one is an
 * aria-label or a stable class from App.tsx rather than a DOM path.
 */
const SEL = {
  composer: '[aria-label="Describe a change"]',
  send: '[aria-label="Send note"]',
  fileInput: 'input[type=file]',
  status: '.wb-status',
  live: '.wb-status .wb-live',
  audit: '.wb-status .wb-warn, .wb-status .wb-bad',
  notes: '.wb-kicker',
};

/** The audit chip is silent when the report is clean, which is the good case. */
const READ_AUDIT = `(() => {
  const el = document.querySelector(${JSON.stringify(SEL.audit)});
  return el ? { chip: el.textContent.trim(), findings: el.getAttribute('title') } : null;
})()`;

/*
 * Every one of these matches case-insensitively, and that is not defensive
 * habit. The status bar is uppercased by CSS text-transform, and innerText
 * returns the *rendered* text -- so `.wb-live` reads "IDLE" through innerText
 * and "Idle" through textContent. Matching /^Idle/ against innerText waits
 * forever on a report that arrived seconds ago, which is exactly how this was
 * found: the bar plainly said 2 BANDS while the driver timed out at 60s.
 */
const STATUS_TEXT = `(document.querySelector(${JSON.stringify(SEL.status)})?.innerText || '').replace(/\\s+/g, ' ').trim()`;
const IDLE = `/^\\s*idle/i.test(document.querySelector(${JSON.stringify(SEL.live)})?.innerText || '')`;
const HAS_REPORT = `/\\d+\\s+bands/i.test(document.querySelector(${JSON.stringify(SEL.status)})?.innerText || '')`;
const NOTE_COUNT = `(() => { const m = (document.querySelector(${JSON.stringify(SEL.notes)})?.textContent || '').match(/(\\d+)\\s+note/i); return m ? Number(m[1]) : 0; })()`;

// ------------------------------------------------------------------ the run

let step = 0;
const shotName = (label) => `${String(++step).padStart(2, '0')}-${label}.png`;

await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

/*
 * Unlock the workspace without a real key. hasApiKey is a non-empty check and
 * nothing validates the value until a request is made, so mock mode never sees
 * it. Seeded before navigation so the first render is already unlocked.
 *
 * --no-key REMOVES the key rather than merely not setting it, and that is the
 * whole trick. The browser outlives any single run of this script: sessionStorage
 * survives in the tab, and a Page.addScriptToEvaluateOnNewDocument registered by
 * an EARLIER run keeps firing on every navigation, with no identifier this
 * process could use to unregister it. So "just don't seed it" leaves the
 * workspace unlocked and --no-key reports the opposite of what it did. Observed
 * exactly that. Registered scripts run in registration order, so a removal
 * registered now lands after any earlier seed and wins.
 */
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: opts.key
    ? "try { sessionStorage.setItem('geminiApiKey:session', 'AIzaSy-FORMA-LOCAL-DRIVER-PLACEHOLDER'); } catch (e) {}"
    : "try { sessionStorage.removeItem('geminiApiKey:session'); } catch (e) {}",
});

await send('Page.navigate', { url: opts.url });
await until('the page to render', `!!document.querySelector(${JSON.stringify(SEL.composer)})`, 30);
console.log('title  ' + (await evalJs('document.title')));
console.log('path   ' + (await evalJs('location.pathname')));
/*
 * Assert rather than report. An unlocked composer under --no-key is not a
 * curiosity to print and move past -- it means the key state is not what was
 * asked for, and every step after this would be testing the wrong thing.
 */
const unlocked = await evalJs(`!document.querySelector(${JSON.stringify(SEL.composer)}).disabled`);
console.log('key    ' + (unlocked ? 'present, composer enabled' : 'absent, composer locked'));
if (unlocked !== opts.key) {
  throw new Error(opts.key
    ? 'the seeded key did not take -- the composer is still locked'
    : '--no-key was asked for but the composer is unlocked; a key survived in this tab');
}
await shot(shotName('loaded'));

if (opts.attach.length) {
  for (const file of opts.attach) {
    if (!fs.existsSync(file)) throw new Error('no such file to attach: ' + file);
  }
  /*
   * The nodeId path is the one that works. Getting an objectId from
   * Runtime.evaluate and passing that to DOM.setFileInputFiles did not fire
   * the change event; going through DOM.getDocument -> DOM.querySelector does.
   */
  const { root } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: SEL.fileInput });
  if (!nodeId) throw new Error('no file input on the page');
  await send('DOM.setFileInputFiles', { nodeId, files: opts.attach });
  await until('the attachment to be ingested', `document.body.innerText.includes(${JSON.stringify(path.basename(opts.attach[0]))})`, 30);
  console.log('attach ' + opts.attach.map((f) => path.basename(f)).join(', '));
  await shot(shotName('attached'));
}

if (opts.attach.length || opts.prompt) {
  if (opts.prompt) await type(opts.prompt);
  await click(SEL.send);
  const waited = await until('the report', `${IDLE} && ${HAS_REPORT}`, opts.wait);
  console.log(`report rendered after ${waited}s`);
  await shot(shotName('report'));
}

for (const message of opts.say) {
  const before = await evalJs(NOTE_COUNT);
  await type(message);
  await click(SEL.send);
  const waited = await until('a reply', `${NOTE_COUNT} >= ${before + 2} && ${IDLE}`, opts.wait);
  console.log(`chat replied after ${waited}s to: ${message}`);
  await shot(shotName('chat'));
}

if (opts.pane) {
  const opened = await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(opts.pane)});
    if (b) b.click();
    return !!b;
  })()`);
  if (!opened) throw new Error('no pane button named ' + opts.pane);
  await sleep(1200);
  await shot(shotName('pane-' + opts.pane.toLowerCase()));
}

// --------------------------------------------------------------- what it says

console.log('status ' + (await evalJs(STATUS_TEXT)));

const audit = await evalJs(READ_AUDIT);
if (audit) {
  console.log('audit  ' + audit.chip);
  for (const finding of (audit.findings || '').split('\n\n')) console.log('       ' + finding);
} else {
  console.log('audit  clean (no chip in the status bar)');
}

const noisy = consoleLines.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'));
if (noisy.length) {
  console.log(`console ${noisy.length} error(s):`);
  for (const line of noisy) console.log('       ' + line);
}
fs.writeFileSync(path.join(opts.out, 'console.txt'), consoleLines.join('\n'), 'utf8');
console.log(`console ${consoleLines.length} line(s) -> ${path.join(opts.out, 'console.txt')}`);

ws.close();
