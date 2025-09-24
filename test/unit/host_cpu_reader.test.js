import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FIXTURE_PATH, createStat, createStatUnderControl } from '../test-utils.js';
import { rm, mkdir } from 'node:fs/promises';
import HostCpuReader from '../../src/sensors/host_cpu_reader.js';
import SystemCpuProfiler from '../../src/sensors/cpu.js';
import { clampDt } from '../../src/lib/cpu_utils.js';

let statFile;
let temp;

beforeEach(async () => {
    // on crée un répertoire temporaire pour stocker les fichiers cpuinfo et stat
    // on nome ce répertoire avec un timestamp pour éviter les collisions
    temp = path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`);
    await mkdir(temp, { recursive: true });
    statFile = await createStatUnderControl(temp, { user: 1000, system: 500, idle: 2000 });
});

afterEach(async () => {
    await rm(temp, { force: true, recursive: true });
});


test('HOST CPU READER TEST SUITE', async (t) => {


    await t.test('must read /proc/stat and return cpu usage', async () => {
        t.diagnostic(`Using stat file: ${statFile}`);
        const profiler = new SystemCpuProfiler({ stat: statFile });
        const reader = new HostCpuReader({ profiler, hz: 100 });

        const nowNs = process.hrtime.bigint();
        const res1 = await reader.sample(nowNs);

        // premier appel, doit retourner des zéros
        assert.ok(res1.ok);
        assert.strictEqual(res1.dt_s, clampDt(0));
        assert.strictEqual(res1.host_active_s, 0);
        assert.strictEqual(res1.host_idle_s, 0);
        assert.deepStrictEqual(res1.ticks, { delta_active: 0, delta_idle: 0 });

        //update le fichier stat pour simuler une activité CPU
        await createStatUnderControl(temp,{ user: 1100, system: 600, idle: 2200 });

        const nowNs2 = nowNs + BigInt(1e9); // 1 seconde plus tard
        const res2 = await reader.sample(nowNs2);

        t.diagnostic(`Second sample: ${JSON.stringify(res2, null, 2)}`);

        assert.ok(res2.ok);
        // teste les bornes
        assert.ok(res2.dt_s >= 0.001 && res2.dt_s <= 10);
        assert.strictEqual(res2.dt_s, clampDt(1));

        assert.strictEqual(res2.host_active_s,2);
        assert.strictEqual(res2.host_idle_s,2);
        assert.strictEqual(res2.ticks.delta_active,200);
        assert.strictEqual(res2.ticks.delta_idle,200);

    });

});

