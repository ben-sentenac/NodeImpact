import path, { resolve, join } from 'path';
import { mkdir, open, mkdtemp, writeFile, rm } from 'fs/promises';
import { pipeline } from 'stream/promises';


const TEST_PATH = resolve(import.meta.dirname);
const FIXTURE_PATH = join(TEST_PATH, 'fixtures');

async function makeTempDir(dir = 'tmp') {
    const unique = `${dir}-${Date.now()}`;
    const tempDir = path.join(FIXTURE_PATH,unique);
    await mkdir(tempDir,{recursive:true});
    return tempDir;
}

async function createFakeFile(source, dest, content = null) {
    if (content) {
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, content, 'utf-8');
        return dest;
    }
    await mkdir(path.dirname(dest), { recursive: true });

    const srcFile = await open(source, 'r');
    const destFile = await open(dest, 'w');

    try {
        const srcStream = srcFile.createReadStream();
        const destStream = destFile.createWriteStream();
        await pipeline(srcStream, destStream);
        return dest;
    } catch (error) {
        throw error;
    } finally {
        await srcFile.close();
        await destFile.close();
    }
}

async function createRaplPackages(baseDir, nodeName, { name = 'package-0', energy = 0n, maxRange = 0n }) {
    const pkgDir = path.join(baseDir, nodeName);
    await mkdir(pkgDir, { recursive: true });

    const namePath = path.join(pkgDir, 'name');
    const energyPath = path.join(pkgDir, 'energy_uj');
    const maxRangePath = path.join(pkgDir, 'max_energy_range_uj');

    await Promise.all([
        writeFile(namePath, name, 'utf8'),
        writeFile(energyPath, String(energy), 'utf8'),
        maxRange > 0n ? writeFile(maxRangePath, String(maxRange), 'utf8') : null
    ]);

    return { dir: pkgDir, files: { namePath, energyPath, maxRangePath } };
}

async function setEnergy(pkg, valueBigInt) {
    await writeFile(pkg.files.energyPath ?? pkg.files.energy_uj ?? path.join(pkg.dir, 'energy_uj'), String(valueBigInt), 'utf8');
}

//nowNs(1.0) => 1e9n
const nowNs = (n) => BigInt(Math.round(n * 1e9));





async function createCpuInfo(outDir, source = '/proc/cpuinfo') {

    const dest = outDir ? path.join(outDir, 'cpuinfo') : path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`, 'cpuinfo');

    return await createFakeFile(source, dest);
}

async function createFakePidStatFile(pid, outDir, content) {
    const dest = path.join(outDir, String(pid), 'stat');
    return await createFakeFile(null, dest, content);
}

function generateStatSample({ pid, utime, stime, starttime, delay, hz = 100 }) {
    const delta_ticks = Math.round(delay * hz);
    const new_utime = utime + Math.floor(delta_ticks / 2);
    const new_stime = stime + Math.ceil(delta_ticks / 2);

    const fields = [
        pid, '(node)', 'S', 52710, 52711, 52710, 34819, 52711, 4194560,
        18391, 0, 1, 0,
        new_utime, new_stime, 0, 0, 20, 0, 11, 0,
        starttime, 1278586880, 17245, '18446744073709551615', 1, 1, 0, 0, 0, 0, 0,
        16781312, 134235650, 0, 0, 0, 17, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ];

    return fields.join(' ');
}

async function createStat(outDir, source = '/proc/stat') {
    const dest = outDir ? path.join(outDir, 'stat') : path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`, 'stat');

    return await createFakeFile(source, dest);
}

async function cleanup(dir) {
    if (dir) {
        await rm(dir, { force: true, recursive: true });
    }
}

/**
 * Crée un fichier /proc/stat simulé avec des ticks contrôlés.
 * @param {string} dir - Répertoire cible
 * @param {object} options - Options pour les ticks
 * @param {number} options.user - Ticks utilisateur
 * @param {number} options.nice - Ticks nice
 * @param {number} options.system - Ticks système
 * @param {number} options.idle - Ticks idle
 * @returns {Promise<string>} - Chemin du fichier stat généré
 */
async function createStatUnderControl(
    dir,
    {
        user = 1000,
        nice = 0,
        system = 500,
        idle = 2000
    } = {}
) {
    const statPath = path.join(dir, 'stat');

    const cpuLine = `cpu  ${user} ${nice} ${system} ${idle} 0 0 0 0 0 0\n`;
    const content = cpuLine + 'cpu0  ...\n'; //  ajouter des lignes de core si besoin

    await writeFile(statPath, content, 'utf-8');
    return statPath;
}

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


export {
    TEST_PATH,
    FIXTURE_PATH,
    makeTempDir,
    createRaplPackages,
    createCpuInfo,
    createStat,
    createFakeFile,
    createStatUnderControl,
    createFakePidStatFile,
    generateStatSample,
    createPIDFile,
    cleanup,
    nowNs,
    setEnergy,
    makeSpyLogger
}