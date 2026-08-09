import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

// Runs the normal dev server in YOUR terminal (live output, Ctrl+C, HMR all
// intact) while mirroring everything to dev-server.log, so the output can be
// read after the fact — by you, or by an agent helping you debug.
const LOG_FILE = 'dev-server.log';
const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

const log = createWriteStream(LOG_FILE, { flags: 'w' });
log.write(`=== npm run dev:log - ${new Date().toISOString()} ===\n`);

const child = spawn('tsx', ['server.ts'], {
  // stdin inherited so Ctrl+C still reaches the server; stdout/stderr piped so
  // we can fan them out to both the terminal and the log file.
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: true, // resolves the tsx binstub on Windows
  // Piping stdout costs us the TTY, so ask for colors back — unless the
  // environment has explicitly opted out via NO_COLOR (setting both warns).
  env: process.env.NO_COLOR
    ? process.env
    : { ...process.env, FORCE_COLOR: '1' },
});

for (const [source, sink] of [
  [child.stdout, process.stdout],
  [child.stderr, process.stderr],
]) {
  source.on('data', (chunk) => {
    sink.write(chunk); // colored, live
    log.write(stripAnsi(chunk.toString())); // plain, readable later
  });
}

child.on('exit', (code, signal) => {
  log.write(`\n=== exited (code=${code} signal=${signal}) ===\n`);
  log.end();
  process.exit(code ?? 0);
});
