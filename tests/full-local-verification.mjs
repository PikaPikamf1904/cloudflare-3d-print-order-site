import { startLocalWorker, stopLocalWorker, runTestFile } from './local-worker.mjs';

const context = await startLocalWorker();
const files = ['tests/bug-reports-integration.mjs', 'tests/storefront-smoke.mjs', 'tests/frontend-redesign.mjs', 'tests/admin-redesign-integration.mjs', 'tests/manual-payments-integration.mjs', 'tests/browser-ui.mjs', 'tests/catalog-integration.mjs'];
let failed = false;
try {
  for (const file of files) {
    try { process.stdout.write(await runTestFile(file, context)); }
    catch (error) { failed = true; process.stderr.write(`${file} failed\n${error.message}\n`); }
  }
} finally { await stopLocalWorker(context); }
if (failed) process.exitCode = 1;
