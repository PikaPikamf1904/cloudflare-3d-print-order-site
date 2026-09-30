import { startLocalWorker, stopLocalWorker, runTestFile } from './local-worker.mjs';

const context = await startLocalWorker();
const files = ['tests/bug-reports-integration.mjs', 'tests/storefront-smoke.mjs', 'tests/frontend-redesign.mjs', 'tests/admin-redesign-integration.mjs', 'tests/manual-payments-integration.mjs', 'tests/admin-search-review-integration.mjs', 'tests/browser-ui.mjs', 'tests/catalog-integration.mjs', 'tests/media-integration.mjs', 'tests/media-failures.mjs', 'tests/media-browser.mjs'];
let totalPassed = 0;
let totalFailed = 0;
try {
  for (const file of files) {
    let output = '';
    let runFailed = false;
    try { output = await runTestFile(file, context); }
    catch (error) { runFailed = true; output = error.message; }
    process.stdout.write(`\n=== ${file} ===\n${output}\n`);
    const suitePassed = (output.match(/^PASS /gm) || []).length;
    const suiteFailed = (output.match(/^FAIL /gm) || []).length;
    const footer = [...output.matchAll(/(\d+) passed, (\d+) failed/g)].at(-1);
    const reportedPassed = footer ? Number(footer[1]) : suitePassed;
    const reportedFailed = footer ? Number(footer[2]) : suiteFailed;
    totalPassed += suitePassed;
    totalFailed += Math.max(suiteFailed, runFailed ? 1 : 0, reportedFailed);
    if (!runFailed && footer && (reportedPassed !== suitePassed || reportedFailed !== suiteFailed)) {
      totalFailed += 1;
      process.stderr.write(`${file} reported ${reportedPassed}/${reportedFailed}, but emitted ${suitePassed}/${suiteFailed} individual results.\n`);
    }
  }
} finally { await stopLocalWorker(context); }
console.log(`\nLocal verification aggregate: ${totalPassed} passed, ${totalFailed} failed across ${files.length} suites.`);
if (totalFailed) process.exitCode = 1;
