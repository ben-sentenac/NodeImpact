import { constants as F } from 'node:fs';
import fs from 'node:fs/promises';


function reasonFromCode(code) {
  const reason = code || 'UNKNOWN';
  const map = {
    EACCES: 'permission_denied',
    EPERM: 'operation_not_permitted',
    ENOENT: 'not_found',
    ELOOP:  'symlink_loop',
    ENOTDIR:'not_a_directory'
  };
  return map[reason] || reason.toLowerCase();
}


async function listDirs(dir) {
  try {
    return  await fs.readdir(dir,{withFileTypes:true});
  } catch {
    return null;
  }
}

async function accessReadable(file) {
  try {
    await fs.access(file,F.R_OK);
    return { ok:true };
  } catch (error) {
    return {ok:false, error:reasonFromCode(error?.code) || reasonFromCode('EACCESS')};
  }
}


export {
    reasonFromCode,
    listDirs,
    accessReadable
}