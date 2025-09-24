import path,{ resolve,join } from 'path';
import { mkdir,open,mkdtemp} from 'fs/promises';
import { pipeline } from 'stream/promises';
import { tmpdir } from 'node:os';

const TEST_PATH = resolve(import.meta.dirname);
const FIXTURE_PATH = join(TEST_PATH,'fixtures');

async function makeTempDir(prefix = 'cpu-profiler-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return dir;
}

async function createFakeFile(source,dest)  {
    
    await mkdir(path.dirname(dest),{recursive:true});

    const srcFile = await open(source,'r');
    const destFile =  await open(dest,'w');

    try {
        const srcStream = srcFile.createReadStream();
        const destStream = destFile.createWriteStream();
        await pipeline(srcStream,destStream);
    } catch (error) {
        throw error;
    } finally {
        await srcFile.close();
        await destFile.close();
    }
}

async function createCpuInfo(outDir,source = '/proc/cpuinfo') {

    const dest = outDir ? path.join(outDir,'cpuinfo'): path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`, 'cpuinfo');

    await createFakeFile(source,dest);

    return dest;
}

async function createStat(outDir, source = '/proc/stat') {
    const dest = outDir ? path.join(outDir,'stat'): path.join(FIXTURE_PATH, `proc-${process.hrtime.bigint().toString()}`, 'stat');

    await createFakeFile(source,dest);

    return dest;
}


export {
    TEST_PATH,
    FIXTURE_PATH,
    makeTempDir,
    createCpuInfo,
    createStat,
    createFakeFile
}