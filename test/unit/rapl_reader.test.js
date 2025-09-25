import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import path from 'node:path';
import RaplReader from '../../src/sensors/rapl_reader.js';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { clampDt } from '../../src/lib/cpu_utils.js';
import { nowNs,setEnergy,createRaplPackages } from '../test-utils.js';




let tmp;
let pkgs = [];


beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'rapl-test-'));
    pkgs = [];

});

afterEach(async () => {
    await rm(tmp, { force: true, recursive: true });
});

test('RAPL READER TEST SUITE', async (t) => {

    await t.test('PRIME:first tick should return the right prime value', async () => {
        const pkg0 = await createRaplPackages(tmp, 'intel-rapl:0', { name: 'package-0', energy: 1_000_000n, maxRange: 65_532_610_987n });
        pkgs.push(pkg0);

        const probe = {
            packages: [{
                node: 'intel-rapl:0',
                path: pkg0.dir,
                name: 'package-0',
                files: { energy_uj: path.join(pkg0.dir, 'energy_uj') },
                maxEnergyRangeUj: 65_532_610_987,
                hasEnergyUjReadable: true
            }]
        }

        const raplReader = new RaplReader(probe);
        const primeExpected = {
            ok: true,
            delta_uj: 0,
            delta_j: 0,
            power_w: 0,
            wraps: 0,
            delta_ts: clampDt(0),
            packages: []
        }
        assert.deepStrictEqual(await raplReader.sample(nowNs(0)), primeExpected);
    });


    await t.test('delta without wra correction end delta_j and power_w correct', async () => {
        const pkg0 = await createRaplPackages(tmp, 'intel-rapl:0', { name: 'package-0', energy: 1_000_000n, maxRange: 0n });
        pkgs.push(pkg0);

        const probe = {
            packages: [{
                node: 'intel-rapl:0',
                path: pkg0.dir,
                name: 'package-0',
                files: { energy_uj: path.join(pkg0.dir, 'energy_uj') },
                maxEnergyRangeUj: null,
                hasEnergyUjReadable: true
            }]
        };

        const raplReader = new RaplReader(probe);

        //prime
        await raplReader.sample(nowNs(0));
        await setEnergy(pkg0, 1_018_000n); //18,000 uj
        const result = await raplReader.sample(nowNs(1.0));//1s later

        assert.strictEqual(result.delta_uj, 18_000);
        assert.strictEqual(result.delta_j, 0.018);
        assert.ok(Math.abs(result.power_w - 0.018) < 1e-9);//error tolerance:0.000000001 Math.abs(a - b) < epsilon

    });

    await t.test('wrap correction reading max_energy_range_uj', async () => {
        const MAX = 65_532_610_987n;
        const start = MAX - 10_000n;   // 10,000 µJ before end
        const end = 5_000n;          // compteur back at 5,000
        const pkg0 = await createRaplPackages(tmp, 'intel-rapl:0', { name: 'package-0', energy: start, maxRange: MAX });
        pkgs.push(pkg0);

        const probe = {
            packages: [{
                node: 'intel-rapl:0',
                path: pkg0.dir,
                name: 'package-0',
                files: { energy_uj: path.join(pkg0.dir, 'energy_uj') },
                maxEnergyRangeUj: Number(MAX),
                hasEnergyUjReadable: true
            }]
        };

        const raplReader = new RaplReader(probe);
        //prime
        await raplReader.sample(nowNs(0));
        await setEnergy(pkg0, end);
        const result = await raplReader.sample(nowNs(1.0));
        // delta = end + MAX - start = 5,000 + 65_532_610_987 - (MAX - 10,000) = 15,000 µJ
        assert.strictEqual(result.delta_uj, 15_000);
        assert.strictEqual(result.delta_j, 0.015);
        assert.ok(Math.abs(result.power_w - 0.015) < 1e-9);
        assert.strictEqual(result.wraps, 1);

    });

    await t.test('multipackages', async () => {

        const [p0, p1] = await Promise.all(
            [
                createRaplPackages(tmp, 'intel-rapl:0', { name: 'package-0', energy: 1_000_000n }),
                createRaplPackages(tmp, 'intel-rapl:1', { name: 'package-1', energy: 2_000_000n })
            ]
        )
        const probe = {
            packages: [
                {
                    node: 'intel-rapl:0', path: p0.dir, name: 'package-0',
                    files: { energy_uj: path.join(p0.dir, 'energy_uj') }, maxEnergyRangeUj: null, hasEnergyUjReadable: true
                },
                {
                    node: 'intel-rapl:1', path: p1.dir, name: 'package-1',
                    files: { energy_uj: path.join(p1.dir, 'energy_uj') }, maxEnergyRangeUj: null, hasEnergyUjReadable: true
                }
            ]
        };

        const raplReader = new RaplReader(probe);
        await raplReader.sample(nowNs(0));

        await setEnergy(p0, 1_010_000n); //+10_000
        await setEnergy(p1, 2_020_000n);

        const result = await raplReader.sample(nowNs(1.0));

        const expected_delta_uj = Number((1_010_000 - 1_000_000) + (2_020_000 - 2_000_000))

        assert.ok(result.ok === true);
        assert.strictEqual(result.delta_uj, expected_delta_uj);
        assert.strictEqual(result.delta_j, expected_delta_uj / 1e6);
        assert.ok(Math.abs(result.power_w - 0.03) < 1e-9);
        assert.ok(result.packages.length === probe.packages.length);
    });

    await t.test('unreadable package: ignored if at least one package is readable', async () => {
        //
        const [p0, p1] = await Promise.all(
            [
                createRaplPackages(tmp, 'intel-rapl:0', { name: 'package-0', energy: 1_000_000n }),
                createRaplPackages(tmp, 'intel-rapl:1', { name: 'package-1', energy: 2_000_000n })
            ]
        );

        //change access right of one package
        await chmod(path.join(p1.dir, 'energy_uj'), 0o000);

        const probe = {
            packages: [
                {
                    node: 'intel-rapl:0', path: p0.dir, name: 'package-0',
                    files: { energy_uj: path.join(p0.dir, 'energy_uj') }, maxEnergyRangeUj: null, hasEnergyUjReadable: true
                },
                {
                    node: 'intel-rapl:1', path: p1.dir, name: 'package-1',
                    files: { energy_uj: path.join(p1.dir, 'energy_uj') }, maxEnergyRangeUj: null, hasEnergyUjReadable: true
                }
            ]
        };

        const raplReader = new RaplReader(probe);

        await raplReader.sample(nowNs(0));

        await setEnergy(p0, 1_005_000n);

        const result = await raplReader.sample(nowNs(1.0));

        const expected_delta = Number(1_005_000n - 1_000_000n);

        assert.equal(result.ok, true);
        assert.equal(result.delta_uj, expected_delta);

        //must respond ok:true
    });

    await t.test('clamp delta_ts: dt too small/large', async () => {
        const p0 = await createRaplPackages(tmp, 'intel-rapl:0', { name: 'package-0', energy: 1_000_000n });
        const probe = {
            packages: [
                {
                    node: 'intel-rapl:0', path: p0.dir, name: 'package-0',
                    files: { energy_uj: path.join(p0.dir, 'energy_uj') }, maxEnergyRangeUj: null, hasEnergyUjReadable: true
                }
            ]
        };
        const raplReader = new RaplReader(probe);

        await raplReader.sample(nowNs(0));        // prime
        await setEnergy(p0, 1_010_000n);

        // dt très petit (0.01s) -> clamp à 0.2
        const r2 = await raplReader.sample(nowNs(0.01));
        assert.ok(r2.delta_ts >= 0.2 && r2.delta_ts <= 0.2000001);

        // dt très grand (10s) -> clamp à 5
        await setEnergy(p0, 1_030_000n); // +20,000 µJ
        const r3 = await raplReader.sample(nowNs(10.01));
        assert.ok(r3.delta_ts <= 5.0000001);
    });

});


