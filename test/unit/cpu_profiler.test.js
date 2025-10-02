import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import path from 'node:path';
import SystemCpuProfiler from '../../src/sensors/cpu.js';
import { mkdir, rm, writeFile, } from 'node:fs/promises';
import { FIXTURE_PATH, makeTempDir, createCpuInfo, createStat, createStatUnderControl,cleanup } from '../test-utils.js';
import { cpus } from 'node:os';


let cpuInfoFile = null;
let statFile = null;
let temp;



test('CPU PROFILER TEST SUITE', async (t) => {

    beforeEach(async () => {
        // on crée un répertoire temporaire pour stocker les fichiers cpuinfo et stat
        // on nome ce répertoire avec un timestamp pour éviter les collisions d'ecriture
        // ou de lecture
        // sinon {concurrency:1} dans les tests
        temp = path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`);
        await mkdir(temp, { recursive: true });
        cpuInfoFile = await createCpuInfo(temp);
        if(!process.env.CI) {
            statFile = await createStat(temp);
        } else {
            statFile = await createStatUnderControl(temp,{user: 1100, system: 600, idle: 2200});
        }
        
    });

    afterEach(async (t) => {
        t.diagnostic(`Erasing ${temp}`);
        await cleanup(temp);
    });

    await t.test('must parse /proc/cpuinfo', async () => {
        const profiler = new SystemCpuProfiler({ cpuInfo: cpuInfoFile });

        const cpuDetails = await profiler.getAllCpusDetails();

        const cpuInfos = await profiler.cpuInfo();

        assert.ok(cpuDetails.length > 0);
        assert.ok(Object.keys(cpuDetails[0]).includes('model_name'));

        // on verifie que le nombre de cpu detecté est cohérent
        assert.ok(cpuInfos.ok);
        assert.ok(cpuDetails.length === cpus().length, `expected ${cpus().length} cpus, got ${cpuDetails.length}`);
        assert.ok(cpuInfos?.cpu?.cores?.logical === cpus().length, `expected ${cpus().length} logical cores, got ${cpuInfos?.cpu?.cores?.logical}`);
        assert.deepStrictEqual(Object.keys(cpuInfos.cpu).sort(), ['cache', 'capabilities', 'cores', 'frequency', 'hyperThreading', 'model', 'powerManagement', 'vendor'].sort());
        assert.ok(cpuInfos.timestamp !== NaN);
        assert.ok(cpuInfos.cpu.frequency.unit === 'MHz');
        assert.ok(cpuInfos.cpu.frequency.max >= cpuInfos.cpu.frequency.min);
        assert.ok(cpuInfos.cpu.frequency.total >= cpuInfos.cpu.frequency.average);
        assert.ok(cpuInfos.cpu.frequency.spread === (cpuInfos.cpu.frequency.max - cpuInfos.cpu.frequency.min));
        assert.ok(cpuInfos.cpu.frequency.loadEstimate >= 0 && cpuInfos.cpu.frequency.loadEstimate <= 1);
        assert.ok(cpuInfos.cpu.cores.physical > 0);
        assert.ok(cpuInfos.cpu.cores.logical >= cpuInfos.cpu.cores.physical);
        assert.ok(typeof cpuInfos.cpu.hyperThreading === 'boolean');

    });


    await t.test('must parse /proc/stat', async () => {

        const profiler = new SystemCpuProfiler({ stat: statFile });

        const snap1 = profiler.getLastSnapshot();
        assert.ok(snap1 === null);

        const stat1 = await profiler.stat();

        const snap2 = profiler.getLastSnapshot();
        assert.ok(snap2 !== null);

        assert.ok(stat1.ok === true);

        assert.ok(Number.isFinite(Date.parse(stat1.timestamp)));
        assert.ok(stat1.unit === 'seconds');
        assert.ok(typeof stat1.activeCpuTime === 'number');
        assert.ok(typeof stat1.idleCpuTime === 'number');
        assert.ok(stat1.activeCpuTime >= 0);
        assert.ok(stat1.idleCpuTime >= 0);

        //regenère le fichier stat
        await rm(statFile);
        if(!process.env.CI) {
            statFile = await createStat(temp);
        } else {
            statFile = await createStatUnderControl(temp,{user: 1500, system: 1000, idle: 2500})
        }
        
        const stat2 = await profiler.stat();

        assert.ok(stat2.ok === true);

        assert.ok(Number.isFinite(Date.parse(stat2.timestamp)));
        assert.ok(stat2.unit === 'seconds');
        assert.ok(typeof stat2.activeCpuTime === 'number');
        assert.ok(typeof stat2.idleCpuTime === 'number');
        assert.ok(stat2.activeCpuTime >= 0);
        assert.ok(stat2.idleCpuTime >= 0);

        assert.ok(typeof stat2.activeCpuTime === 'number');
        assert.ok(typeof stat2.idleCpuTime === 'number');
        assert.ok(stat2.activeCpuTime >= 0);
        assert.ok(stat2.idleCpuTime >= 0);

        //on doit avoir une progression du temps cpu
        assert.ok(stat2.activeCpuTime >= stat1.activeCpuTime);
        assert.ok(stat2.idleCpuTime >= stat1.idleCpuTime);

        //au moins une des deux valeurs doit avoir augmenté
        //dans le cas d'une machine totalement idle, il se peut que activeCpuTime n'augmente pas
        //mais dans ce cas idleCpuTime doit augmenter
        assert.ok(stat2.idleCpuTime > stat1.idleCpuTime);
        assert.ok((stat2.activeCpuTime > stat1.activeCpuTime) || (stat2.idleCpuTime > stat1.idleCpuTime));
    });


    await t.test('must return error if /proc/stat is not readable', async () => {
        const profiler = new SystemCpuProfiler({ stat: '/path/to/nonexistent/file' });

        const stat1 = await profiler.stat();

        assert.ok(stat1.ok === false);
        assert.ok(stat1.error instanceof String === false && typeof stat1.error === 'string');
        assert.ok(stat1.error === "Failed to parse /proc/stat: ENOENT: no such file or directory, open '/path/to/nonexistent/file'");
    });

    await t.test('SystemCpuProfiler — cpuinfo : final block without "power management"', async () => {
        const dir = await makeTempDir();
        const cpuinfoNoTail = `
processor : 0
model name : Foo
cpu MHz : 1000.0

processor : 1
model name : Bar
cpu MHz : 2000.0
`.trim();
        await writeFile(path.join(dir, 'cpuinfo'), cpuinfoNoTail, 'utf-8');
        const profiler = new SystemCpuProfiler({ cpuInfo: path.join(dir, 'cpuinfo'), stat: path.join(dir, 'stat') });

        const cpus = await profiler.getAllCpusDetails();
        assert.equal(cpus.length, 2);
        assert.equal(cpus[0].model_name, 'Foo');
        assert.equal(cpus[1].model_name, 'Bar');
        await rm(dir, { recursive: true, force: true });
    });

    await t.test('SystemCpuProfiler — analyzeFlags() simple case', () => {
        const profiler = new SystemCpuProfiler();
        const flags = 'sse sse2 aes vmx nx smep smap';
        const res = profiler.analyzeFlags(flags);
        assert.equal(res.virtualisable, true);
        assert.equal(res.aesSupport, true);
        assert.equal(res.secureBootCapable, true);
    });

});





