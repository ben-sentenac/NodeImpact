import test, { afterEach, beforeEach } from 'node:test';
import assert from "node:assert/strict";
import path from "node:path";
import PidCpuReader from '../../src/sensors/pid_cpu_reader.js';
import { cleanup, createFakePidStatFile, generateStatSample, makeTempDir } from '../test-utils.js';

let pid;
let temp;
let statPath;

test('PidCpuReader Test Suite', async (t) => {

    beforeEach(async () => {
        temp = await makeTempDir('proc');
        pid = 25041;
        const statContent = generateStatSample({ pid, utime: 0, stime: 0, starttime: 9954766, delay: 0, hz: 100 });
        await createFakePidStatFile(pid, temp, statContent);
    });

    afterEach(async () => {
        await cleanup(temp);
    });

    await t.test('must throw if pid missing', async () => {
        assert.throws(() => new PidCpuReader({ pid: null }), err => {
            assert.match(err.message, /pid is required/);
            return true;
        });
    });

    await t.test('must parse  pid stat file (/proc/<pid>/stat file)', async () => {
        statPath = path.join(temp, String(pid), 'stat');
        const reader = new PidCpuReader({ pid, hz: 100, statPath });
        const pidStat = await reader.getPidStat();
        assert.ok(pidStat.ok, 'pidStat.ok must be true');
        assert.strictEqual(pidStat.pid, pid, `pidStat.pid must be ${pid}`); 
        assert.strictEqual(typeof pidStat.utime, 'number', 'pidStat.utime must be a number');
        assert.strictEqual(typeof pidStat.stime, 'number', 'pidStat.stime must be a number');
        assert.strictEqual(typeof pidStat.starttime, 'number', 'pidStat.starttime must be a number')
        assert.strictEqual(pidStat.session,52710);
        assert.strictEqual(pidStat.ppid,52710); 
        assert.strictEqual(pidStat.comm,'node'); 
        assert.strictEqual(pidStat.exit_code,0);
        assert.strictEqual(pidStat.starttime,9954766);
    });
   
    await t.test('must sample pid cpu usage', async () => {
        statPath = path.join(temp, String(pid), 'stat');
        const reader = new PidCpuReader({ pid, hz: 100, statPath });
        let sample = await reader.sample();
        assert.ok(sample.ok, 'sample.ok must be true');
        assert.strictEqual(sample.pid, pid, `sample.pid must be ${pid}`);
        assert.strictEqual(sample.app_cpu_s, 0, 'first sample app_cpu_s must be 0');
        assert.strictEqual(sample.pid_restarted, false, 'first sample pid_restarted must be false');
        assert.strictEqual(typeof sample.ticks.now, 'number', 'sample.ticks.now must be a number');
        assert.strictEqual(sample.ticks.delta, 0, 'first sample ticks.delta must be 0');

        // Simulate some CPU usage by modifying the fake stat file
        const statContent2 = generateStatSample({ pid, utime: 0, stime: 0, starttime: 9954766, delay: 1, hz: 100 });

        await createFakePidStatFile(pid, temp, statContent2);

        // Wait 1 second bit before taking the next sample
        await new Promise(resolve => setTimeout(resolve, 1000));

        sample = await reader.sample();
        assert.ok(sample.ok, 'second sample.ok must be true');
        assert.strictEqual(sample.pid, pid, `second sample.pid must be ${pid}`);
        assert.strictEqual(typeof sample.app_cpu_s, 'number', 'second sample app_cpu_s must be a number');
        assert.ok(sample.app_cpu_s > 0, 'second sample app_cpu_s must be greater than 0');
        assert.strictEqual(sample.pid_restarted, false, 'second sample pid_restarted must be false');
        assert.strictEqual(typeof sample.ticks.now, 'number', 'second sample ticks.now must be a number');
        assert.ok(sample.ticks.delta > 0, 'second sample ticks.delta must be greater than 0');
        // With a 1 second delay and 100 Hz, we expect approximately 100 ticks (1 second * 100 ticks/second)
        // and approximately 1.0 second of CPU time used by the app
        assert.ok(sample.app_cpu_s,1.0, 'second sample app_cpu_s must be approximately 1.0');
        assert.ok(sample.ticks.delta,100, 'second sample ticks.delta must be approximately 100');
    });

    //must handle pid restart
    await t.test('must handle pid restart', async () => {
        statPath = path.join(temp, String(pid), 'stat');
        const reader = new PidCpuReader({ pid, hz: 100, statPath });
        let sample = await reader.sample();
        assert.ok(sample.ok, 'sample.ok must be true');
        assert.strictEqual(sample.pid, pid, `sample.pid must be ${pid}`);
        assert.strictEqual(sample.app_cpu_s, 0, 'first sample app_cpu_s must be 0');
        assert.strictEqual(sample.pid_restarted, false, 'first sample pid_restarted must be false');
        assert.strictEqual(typeof sample.ticks.now, 'number', 'sample.ticks.now must be a number');
        assert.strictEqual(sample.ticks.delta, 0, 'first sample ticks.delta must be 0');

        // Simulate some CPU usage by modifying the fake stat file
        const statContent2 = generateStatSample({ pid, utime: 0, stime: 0, starttime: 9954766, delay: 1, hz: 100 });

        await createFakePidStatFile(pid, temp, statContent2);

        // Wait 1 second bit before taking the next sample
        await new Promise(resolve => setTimeout(resolve, 1000));

        sample = await reader.sample();
        assert.ok(sample.ok, 'second sample.ok must be true');
        assert.strictEqual(sample.pid, pid, `second sample.pid must be ${pid}`);
        assert.strictEqual(typeof sample.app_cpu_s, 'number', 'second sample app_cpu_s must be a number');
        assert.ok(sample.app_cpu_s > 0, 'second sample app_cpu_s must be greater than 0');
        assert.strictEqual(sample.pid_restarted, false, 'second sample pid_restarted must be false');
        assert.strictEqual(typeof sample.ticks.now, 'number', 'second sample ticks.now must be a number');
        assert.ok(sample.ticks.delta > 0, 'second sample ticks.delta must be greater than 0');      

        // Now simulate a PID restart by changing the starttime
        const statContent3 = generateStatSample({ pid, utime: 0, stime: 0, starttime: 9954767, delay: 1, hz: 100 }); // Note the incremented starttime

        await createFakePidStatFile(pid, temp, statContent3);

        // Wait a bit before taking the next sample
        await new Promise(resolve => setTimeout(resolve, 500));

        sample = await reader.sample();
        assert.ok(sample.ok, 'third sample.ok must be true');
        assert.strictEqual(sample.pid, pid, `third sample.pid must be ${pid}`);
        assert.strictEqual(sample.app_cpu_s, 0, 'third sample app_cpu_s must be 0 after restart');
        assert.strictEqual(sample.pid_restarted, true, 'third sample pid_restarted must be true');
        assert.strictEqual(typeof sample.ticks.now, 'number', 'third sample ticks.now must be a number');
        assert.strictEqual(sample.ticks.delta, 0, 'third sample ticks.delta must be 0 after restart');
    });

    // Add more tests as needed
    await t.test('must handle non-existent pid stat file', async () => {
        const reader = new PidCpuReader({ pid: 99999, hz: 100 });
        const pidStat = await reader.getPidStat();
        assert.ok(!pidStat.ok, 'pidStat.ok must be false');
        assert.match(pidStat.error.message, /no such file or directory/, 'error message must indicate missing file');
    });
});   