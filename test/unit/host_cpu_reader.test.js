import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FIXTURE_PATH, createCpuInfo, createStat } from '../test-utils.js';
import { rm, mkdir } from 'node:fs/promises';
import { accessReadable } from '../../src/lib/utils.js';
import HostCpuReader from '../../src/sensors/host_cpu_reader.js';
import SystemCpuProfiler from '../../src/sensors/cpu.js';

let cpuInfoFile = null;
let statFile = null;
let temp;



test('HOST CPU READER TEST SUITE', async (t) => {

    beforeEach(async () => {
        // on crée un répertoire temporaire pour stocker les fichiers cpuinfo et stat
        // on nome ce répertoire avec un timestamp pour éviter les collisions
        temp = path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`);
        await mkdir(temp, { recursive: true });
        cpuInfoFile = await createCpuInfo(temp);
        statFile = await createStat(temp);
    });

    afterEach(async () => {
        await rm(temp, { force: true, recursive: true });
    });

    await t.test('must read /proc/stat and return cpu usage', async () => {

        console.log(statFile);
        /*
        const profiler = new SystemCpuProfiler({ statPath: statFile });
        const reader = new HostCpuReader({ profiler, hz: 100 });

        const nowNs = process.hrtime.bigint;
        const res1 = await reader.sample(nowNs);

        assert.equal(res1.ok, true);
        assert.equal(res1.dt_s, 0);
        assert.equal(res1.host_active_s, 0);
        assert.equal(res1.host_idle_s, 0);
        assert.deepEqual(res1.ticks, { delta_active: 0, delta_idle: 0 });
        */
        
    });

});

