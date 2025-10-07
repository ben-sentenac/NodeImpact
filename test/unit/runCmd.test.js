import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { PIDResolver,runCmd } from '../../src/lib/pid_resolver.js';
import { FIXTURE_PATH } from '../test-utils.js';
import { mkdir,rm, writeFile} from  'node:fs/promises';
import path from 'node:path';

 async function createPIDFile(dir, pid) {
        const filePath = path.join(dir, 'app.pid');
        return await writeFile(filePath, String(pid), 'utf-8');
    }

function makeSpyLogger() {
  const calls = { debug: [], info: [], warn: [], error: [] };
  return {
    logger: {
      debug: (...a) => calls.debug.push(a),
      info:  (...a) => calls.info.push(a),
      warn:  (...a) => calls.warn.push(a),
      error: (...a) => calls.error.push(a),
    },
    calls,
  };
}

test('runCmd: success simple', async () => {
  const res = await runCmd(process.execPath, ['-e', 'console.log("ok")'], { timeoutMs: 500 }, null);
  assert.equal(res.ok, true);
  assert.match(res.stdout, /ok/);
  assert.equal(res.stderr,'');
});


test('runCmd: timeout', async () => {
  const res = await runCmd(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], { timeoutMs: 50 }, null);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'cmd_timeout');
});

test('runCmd: binaire introuvable', async () => {
  const res = await runCmd('definitely-not-a-binary-xyz', [], { timeoutMs: 100 }, null);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'tool_unavailable');
});

test('runCmd: exit code non zéro', async () => {
  const res = await runCmd(process.execPath, ['-e', 'process.exit(3)'], { timeoutMs: 500 }, null);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'cmd_exit');
  assert.equal(res.details.code, 3);
});

test('runCmd: logs cmd.start/cmd.ok en succès', async () => {
  const { logger, calls } = makeSpyLogger();
  const res = await runCmd(process.execPath, ['-e', 'console.log("ok")'], { timeoutMs: 500 }, logger);
  assert.equal(res.ok, true);
  const hasStart = calls.debug.some(a => a[0] === 'cmd.start');
  const hasOk = calls.debug.some(a => a[0] === 'cmd.ok');
  assert.equal(hasStart && hasOk, true);
});

test('runCmd: logs cmd.fail en erreur', async () => {
  const { logger, calls } = makeSpyLogger();
  const res = await runCmd(process.execPath, ['-e', 'process.exit(2)'], { timeoutMs: 500 }, logger);
  assert.equal(res.ok, false);
  const hasFail = calls.error.some(a => a[0] === 'cmd.fail');
  assert.equal(hasFail, true);
});

test('getProcessInfo via runCmd: retourne quelque chose pour process.pid', async () => {
   const temp = path.join(FIXTURE_PATH, `pidfile-${Date.now()}`);
    await mkdir(temp, { recursive: true }); 
   await createPIDFile(temp, process.pid);
  // Intégration indirecte : PIDResolver.resolve({returnInfo:true}) finira par appeler getProcessInfo.
  const r = new PIDResolver({ strategy: 'file', file: path.join(temp,'app.pid'), returnInfo: true });
  const res = await r.resolve();
  assert.equal(res.ok, true);
  assert.equal(res.pid, process.pid);
  assert.ok(res.info && typeof res.info.user === 'string');
    await rm(temp,{recursive:true,force:true});
});

