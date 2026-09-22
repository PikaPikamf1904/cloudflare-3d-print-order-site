import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';

const root = process.cwd();
const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.stderr?.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(output || `${file} exited ${code}`)));
  });
}

async function waitForHttp(base, worker, getOutput) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Wrangler exited before HTTP readiness.\n${getOutput()}`);
    try {
      const response = await fetch(`${base}/api/store`, { signal: AbortSignal.timeout(1200) });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Wrangler did not serve /api/store within 30 seconds.\n${getOutput()}`);
}

export async function startLocalWorker(port = 0) {
  port = await new Promise((resolve, reject) => { const probe = createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => { const chosen = probe.address().port; probe.close(() => resolve(chosen)); }); });
  const state = await mkdtemp(join(tmpdir(), '3d-print-bug-tests-'));
  const key = randomBytes(24).toString('base64url');
  const envFile = join(state, 'test.env');
  await writeFile(envFile, `ADMIN_KEY=${key}\n`, { encoding: 'utf8', mode: 0o600 });
  await run(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'enrichment-3d-print-orders-db', '--local', '--persist-to', state]);
  await run(process.execPath, [wrangler, 'd1', 'execute', 'enrichment-3d-print-orders-db', '--local', '--persist-to', state, '--file', join(root, 'tests', 'fixtures', 'synthetic-history.sql')]);
  const args = [wrangler, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state, '--env-file', envFile, '--log-level', 'debug'];
  const worker = spawn(process.execPath, args, { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = (chunk) => { output = (output + chunk).slice(-40000); };
  worker.stdout.on('data', collect); worker.stderr.on('data', collect);
  const base = `http://127.0.0.1:${port}`;
  try { await waitForHttp(base, worker, () => output.replaceAll(key, '[redacted]')); const auth = await fetch(`${base}/api/admin/catalog`, { headers: { 'x-admin-key': key } }); if (!auth.ok) throw new Error('Disposable Worker authentication failed.'); }
  catch (error) { await stopLocalWorker({ worker, state }); throw error; }
  return { worker, state, base, key, output: () => output };
}

export async function stopLocalWorker(context) {
  if (!context) return;
  const { worker, state } = context;
  if (worker && worker.exitCode === null) {
    if (process.platform === 'win32') {
      try { await run('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F']); } catch {}
    } else worker.kill('SIGTERM');
  }
  if (state) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { await rm(state, { recursive: true, force: true }); break; }
      catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
  }
}

export async function runTestFile(file, context) {
  return run(process.execPath, [file], { env: { ...process.env, TEST_BASE_URL: context.base, TEST_ADMIN_KEY: context.key, EXTERNAL_TEST_SERVER: '1' } });
}
