import { test as nodeTest } from 'node:test';
import fs from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';

export function spawnSleepy(args = []) {
  const file = path.resolve('test','scripts', 'sleepy.js');
  // on GARDE un canal IPC pour pouvoir envoyer "stop"
  const child = fork(file, args, {
    execPath: process.execPath,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    detached: false,
  });

  async function waitExit(ms = 800) {
    // Promise.race avec timeout manuel (compatible Node 18/20/22)
    let timer;
    try {
      const p = once(child, 'exit');
      const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('exit-timeout')), ms); });
      await Promise.race([p, t]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    pid: child.pid,
    child,
    async stop() {
      if (!child || child.killed) return;

      // 1) demande propre via IPC
      try { child.send({ type: 'stop' }); } catch {}
      try { await waitExit(800); return; } catch {}

      // 2) SIGTERM si l’enfant n’a pas écouté l’IPC
      try { child.kill('SIGTERM'); } catch {}
      try { await waitExit(600); return; } catch {}

      // 3) dernier recours : SIGKILL
      try { child.kill('SIGKILL'); } catch {}
      try { await waitExit(400); } catch {}
    }
  };
}

async function mkTmp(prefix = 'spec-') {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function rmrf(p) {
    await fs.rm(p, { recursive: true, force: true });
}


export function withTestContext(name, fn, opts = {}) {
    const options = { concurency: 1, ...opts };
    return nodeTest(name, options, async () => {
        const cleanups = [];
        const context = {
            _lastTemp: null,
            async tmpdir(prefix = 'spec-') {
                const dir = await mkTmp(prefix);
                this._lastTemp = dir;
                cleanups.push(async () => await rmrf(dir));
                return dir;
            },
            async write(relPath, content, enc = 'utf8') {
                if (!this._lastTemp) throw new Error('Call ctx.tmpDir() first');
                const full = path.join(this._lastTemp, relPath);
                await fs.mkdir(path.dirname(full), { recursive: true });
                await fs.writeFile(full, content, enc);
                return full;
            },
            async spawnSleepy(args = []) {
                const p = spawnSleepy(args);
                cleanups.push(async () => await p.stop());
                return p;
            },
            addCleanup(fn) {
                cleanups.push(fn);
            }
        }

        try {
            await fn(context);
        } finally {
            // exécuter les cleanups en LIFO
            for (let i = cleanups.length - 1; i >= 0; i--) {
                try { await cleanups[i](); } catch { }
            }
        }
    });
}