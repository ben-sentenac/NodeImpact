import path,{ resolve,join } from 'path';
import { mkdir,open,mkdtemp,writeFile} from 'fs/promises';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'node:os';

const TEST_PATH = resolve(import.meta.dirname);
const FIXTURE_PATH = join(TEST_PATH,'fixtures');

async function makeTempDir(prefix = 'cpu-profiler-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return dir;
}

async function createFakeFile(source,dest,content = null) {
    if(content) {
        await mkdir(path.dirname(dest),{recursive:true});
        await writeFile(dest,content,'utf-8');
        return dest;
    }
    await mkdir(path.dirname(dest),{recursive:true});

    const srcFile = await open(source,'r');
    const destFile =  await open(dest,'w');

    try {
        const srcStream = srcFile.createReadStream();
        const destStream = destFile.createWriteStream();
        await pipeline(srcStream,destStream);
        return dest;
    } catch (error) {
        throw error;
    } finally {
        await srcFile.close();
        await destFile.close();
    }
}

async function createCpuInfo(outDir,source = '/proc/cpuinfo') {

    const dest = outDir ? path.join(outDir,'cpuinfo'): path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`, 'cpuinfo');

    return await createFakeFile(source,dest);
}

async function createStat(outDir, source = '/proc/stat') {
    const dest = outDir ? path.join(outDir,'stat'): path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`, 'stat');

    return await createFakeFile(source,dest);
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


export {
    TEST_PATH,
    FIXTURE_PATH,
    makeTempDir,
    createCpuInfo,
    createStat,
    createFakeFile,
    createStatUnderControl
}