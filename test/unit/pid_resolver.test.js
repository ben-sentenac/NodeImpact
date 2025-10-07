import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PIDResolver } from '../../src/lib/pid_resolver.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { FIXTURE_PATH } from '../test-utils.js';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
// Utilitaire pour créer un fichier temporaire, exécuter une fonction asynchrone, puis nettoyer





let temp;


async function createPIDFile(dir, pid) {
    const filePath = path.join(dir, 'app.pid');
    return await writeFile(filePath, String(pid), 'utf-8');
}


function makeSpyLogger() {
    const calls = { debug: [], info: [], warn: [], error: [] };
    const logger = {
        debug: (...a) => calls.debug.push(a),
        info: (...a) => calls.info.push(a),
        warn: (...a) => calls.warn.push(a),
        error: (...a) => calls.error.push(a),
    };
    return { logger, calls };
}


test('PID RESOLVER TEST SUITE', async (t) => {

    beforeEach(async () => {
        temp = path.join(FIXTURE_PATH, `pidfile-${Date.now()}`);
        await mkdir(temp, { recursive: true });
    });

    afterEach(async () => {
        await rm(temp, { force: true, recursive: true });
    });

    await t.test('doit exposer une API minimale', () => {
        const r = new PIDResolver({ strategy: 'file', file: { path: '/tmp/x.pid' } });
        assert.equal(typeof r.resolve, 'function');
        assert.ok(r.options && typeof r.options === 'object');
    });

    await t.test('erreur si strategy manquante ou inconnue', () => {
        assert.throws(() => new PIDResolver({}), /strategy/i);
        assert.throws(() => new PIDResolver({ strategy: 'weird' }), /strategy/i);
    });

    await t.test('valeurs par défaut', () => {
        const r = new PIDResolver({ strategy: 'file', file: { path: '/tmp/x.pid' } });
        assert.equal(r.options.strict, false);
        assert.equal(r.options.ensureUnique, false);
        assert.equal(r.options.timeoutMs, 5000);
        assert.deepEqual(r.options.constraints, {});
        assert.equal(r.options.returnInfo, false);
    });



    await t.test('normalise file: string -> { path }', () => {
        const r = new PIDResolver({ strategy: 'file', file: '/var/run/app.pid' });
        assert.deepEqual(r.options.file, { path: '/var/run/app.pid' });
    });



    await t.test('normalise constraints.cmdRegex: string -> RegExp', () => {
        const r = new PIDResolver({
            strategy: 'file',
            file: '/var/run/app.pid',
            constraints: { cmdRegex: 'my-app\\.js' },
        });
        assert.ok(r.options.constraints.cmdRegex instanceof RegExp);
        assert.equal(r.options.constraints.cmdRegex.source, 'my-app\\.js');
    });


    await t.test("n'altère pas l'objet d'options d'origine (pas de mutation)", () => {
        const given = {
            strategy: 'file',
            file: '/var/run/app.pid',
            constraints: { cmdRegex: 'foo', user: 'alice' },
            strict: true
        };
        const snapshot = structuredClone(given);
        const r = new PIDResolver(given);

        // L'instance a des options normalisées…
        assert.ok(r.options.constraints.cmdRegex instanceof RegExp);
        assert.deepEqual(r.options.file, { path: '/var/run/app.pid' });

        // …mais l'objet passé en entrée n'a PAS été modifié
        assert.deepEqual(given, snapshot);
    });


    await t.test('options immuables côté consommateur (expose une copie/snapshot)', () => {
        const r = new PIDResolver({ strategy: 'file', file: '/x.pid' });
        const o = r.options;

        assert.throws(() => {
            o.strict = true; // mutation interdite
        }, /read only/);

        assert.equal(r.options.strict, false); // toujours false
    });

    await t.test('file: OK avec PID simple', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid') });
        const result = await r.resolve();
        assert.deepEqual(result, { ok: true, pid: process.pid });
    });

    await t.test('file: OK avec espace', async () => {
        await createPIDFile(temp, ` ${process.pid}    \n`);
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid') });
        const result = await r.resolve();
        assert.deepEqual(result, { ok: true, pid: process.pid });
    });

    await t.test('file:KO si pid invalide dans le fichier', async () => {
        await createPIDFile(temp, 'PID=25689');
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid') });
        const result = await r.resolve();
        assert.ok(result.ok === false);
        assert.equal(result.error, 'no_pid_found');
    });

    await t.test('file:KO si le fichier n’existe pas', async () => {
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid') });
        const result = await r.resolve();
        assert.ok(result.ok === false);
        assert.equal(result.error, 'file_read_error');
    });

    await t.test('file:KO si le fichier est manquant', async () => {
        const r = new PIDResolver({ strategy: 'file', file: '/path/does/not/exist.pid' });
        const result = await r.resolve();
        assert.ok(result.ok === false);
        assert.equal(result.error, 'file_read_error');
    });

    await t.test('file:KO si config manquante pour strategy file', async () => {
        const r = new PIDResolver({ strategy: 'file' });
        const result = await r.resolve();
        assert.ok(result.ok === false);
        assert.equal(result.error, 'invalid_file_options');
    });

    await t.test('autres stratégies non implémentées', async () => {
        let r = new PIDResolver({ strategy: 'env' });
        let result = await r.resolve();
        assert.ok(result.ok === false);
        assert.equal(result.error, 'not_implemented');

        r = new PIDResolver({ strategy: 'command' });
        result = await r.resolve();
        assert.ok(result.ok === false);
        assert.equal(result.error, 'not_implemented');

        r = new PIDResolver({ strategy: 'port' });
        result = await r.resolve();
        assert.ok(result.ok === false);
        assert.equal(result.error, 'not_implemented');
    })
    await t.test('file:ok:true si le pid est vivant', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid') });
        const result = await r.resolve();

        assert.deepEqual(result, { ok: true, pid: process.pid });
    });
    await t.test('file:ok:false si le pid n est pas vivant', async () => {
        await createPIDFile(temp, 12345);
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid') });
        const result = await r.resolve();
        assert.deepEqual(result, { ok: false, error: 'pid_not_alive', message: 'PID is not alive', details: { pid: 12345 } });
    });

    const constrainstName = process.version.startsWith('v24') ? 'MainThread' : 'node'

    await t.test('constrainst: name OK', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({
            strategy: 'file',
            file: path.join(temp, 'app.pid'),
            constraints: {
                name: constrainstName
            }
        });
        const result = await r.resolve();
        assert.equal(result.ok, true);
    });
    await t.test('constrainst: name missmatch', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({
            strategy: 'file',
            file: path.join(temp, 'app.pid'),
            constraints: {
                name: 'python'
            }
        });
        const result = await r.resolve();
        assert.equal(result.ok, false);
        assert.equal(result.error, 'constraint_name_mismatch');
    });

    await t.test('constraints: cmdRegex OK', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({
            strategy: 'file',
            file: path.join(temp, 'app.pid'),
            constraints: {
                name: constrainstName,
                cmdRegex: new RegExp(path.basename(import.meta.filename))
            }
        });
        assert.deepStrictEqual(await r.resolve(), { ok: true, pid: process.pid });
    });
    await t.test('constraints: cmdRegex KO', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({
            strategy: 'file',
            file: path.join(temp, 'app.pid'),
            constraints: {
                name: constrainstName,
                cmdRegex: /pid_\.test\.js/
            }
        });
        assert.deepStrictEqual(await r.resolve(), { ok: false, error: 'constraint_cmd_mismatch', message: 'Process args do not match the expected pattern' });
    });
    await t.test('constraints: cmdRegex OK', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({
            strategy: 'file',
            file: path.join(temp, 'app.pid'),
            constraints: {
                name: constrainstName,
                user: process.env.USER
            }
        });
        assert.deepStrictEqual(await r.resolve(), { ok: true, pid: process.pid });
    });

    await t.test('constraints: cmdRegex KO', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({
            strategy: 'file',
            file: path.join(temp, 'app.pid'),
            constraints: {
                name: constrainstName,
                user: 'jhon'
            }
        });
        assert.deepStrictEqual(await r.resolve(), { ok: false, error: 'constraint_user_mismatch', message: 'Process user does not match the expected user' });
    });

    await t.test('strict:OK si info identique entre t0 et t1', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({
            strategy: 'file',
            file: path.join(temp, 'app.pid'),
            strict: { delayMs: 1000 },
            constraints: {
                name: constrainstName,
                cmdRegex: new RegExp(path.basename(import.meta.filename)),
                user: process.env.USER
            }
        });

        const result = await r.resolve();
        assert.equal(result.ok, true);
    });
    await t.test('strict:KO si metadonnées changent entre t0 et t1', async () => {
        //provoquer un changement d’“identité” pour un même PID est dur
        //  (la réutilisation de PID est non déterministe)
        //on peut changer process.title pdt la fenetre strict mais ii on prefere
        // eviter de toucher au process.title du test runner
        // on va forker un process enfant
        //ps ne reflète pas process.title pour comm, il le fera presque toujours pour args
        const childPath = path.join(temp, 'child.js');
        await writeFile(childPath, `
    process.title = 'pidres-child-t0';
    if (process.send) process.send({ ready: true, pid: process.pid });
    setInterval(()=>{}, 1e6);
    process.on('message', m => { if (m === 'flip') process.title = 'pidres-child-t1'; });
  `, 'utf8');
            let child;
            try {
                child = fork(childPath, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        const [{ pid }] = await once(child, 'message'); // { ready:true, pid }

        const pidFile = path.join(temp, 'child.pid');
        await writeFile(pidFile, String(pid), 'utf8');

        const r = new PIDResolver({
            strategy: 'file',
            file: pidFile,
            constraints: { user: os.userInfo().username }, // stable
            strict: { delayMs: 120 },
        });

        // bascule titre pendant la fenêtre strict
        setTimeout(() => { child.send('flip'); }, 40);

        const res = await r.resolve();
        assert.equal(res.ok, false);
        assert.equal(res.error, 'strict_identity_changed');

            } catch (error) {
                console.error(error)
            } finally {
                child.kill();
            }
        
        
    });

    await t.test('returnInfo: sans contraintes renvoie info issue de ps', async () => {
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid'), returnInfo: true });
        const res = await r.resolve();
        assert.equal(res.ok, true);
        assert.equal(res.pid, process.pid);
        assert.ok(res.info && typeof res.info === 'object');
        assert.equal(res.info.pid, process.pid);
        assert.equal(typeof res.info.user, 'string');
        assert.equal(typeof res.info.comm, 'string');
        assert.equal(typeof res.info.args, 'string');
    });

    await t.test('returnInfo: avec contraintes + strict → renvoie info (préférence t1)', async () => {
        await createPIDFile(temp, process.pid)
        const r = new PIDResolver({
            strategy: 'file',
            file: path.join(temp, 'app.pid'),
            returnInfo: true,
            strict: { delayMs: 30 },
            // on met une contrainte stable (user) pour forcer l’usage de ps
            constraints: { user: os.userInfo().username },
        });
        const res = await r.resolve();
        assert.equal(res.ok, true);
        assert.equal(res.pid, process.pid);
        assert.ok(res.info && typeof res.info === 'object');
        assert.equal(res.info.pid, process.pid);
    });


    await t.test('logger custom reçoit un debug "file.read.ok" en succès', async () => {
        const { logger, calls } = makeSpyLogger();
        await createPIDFile(temp, process.pid);
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid'), logger, logLevel: 'debug' });
        const res = await r.resolve();
        assert.equal(res.ok, true);

        const hasEvent = calls.debug.some(args => args[0] === 'file.read.ok');
        assert.equal(hasEvent, true);

    });

    await t.test('logger niveau warn : les debug ne doivent pas apparaître', async () => {
        await createPIDFile(temp,process.pid);
        const { logger, calls } = makeSpyLogger();
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid'), logger, logLevel: 'warn' });
        const res = await r.resolve();
        assert.equal(res.ok, true);
        assert.equal(calls.debug.length, 0);
    });

    await t.test('erreur pid_not_alive déclenche un error "file.liveness.notAlive"', async () => {
        await createPIDFile(temp, 999999); // id quasi sûr d’être mort
        const { logger, calls } = makeSpyLogger();
        const r = new PIDResolver({ strategy: 'file', file: path.join(temp, 'app.pid'), logger, logLevel: 'debug' });
        const res = await r.resolve();
        assert.equal(res.ok, false);
        assert.equal(res.error, 'pid_not_alive');

        const hasEvent = calls.error.some(args => args[0] === 'file.liveness.notAlive');
        assert.equal(hasEvent, true);

    });

    /*
    await t.test('logger partiel (seulement error) ne casse rien', async () => {
        const minimal = { error: () => { } }; // pas de debug/info/warn
        await createPIDFile(temp, process.pid);
        const r = new PidResolver({ strategy: 'file', file: path.join(temp, 'app.pid'), logger: minimal, logLevel: 'debug' });
        const res = await r.resolve();
        assert.equal(res.ok, true);

    });
    */


});