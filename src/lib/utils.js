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


async function protectedDeepFreeze(obj,_seen = new WeakSet) {
  if (obj === null || !typeof obj === 'object') return obj;
  if(_seen.has(obj)) return obj;
  _seen.add(obj);
  if(Object.isFrozen(obj)) return obj;

  const tag = Object.prototype.toString.call(obj);
  //objet speciaux, on fige en surface;
  if(
    tag === '[object Date]' || 
    tag === '[object RegExp]' || 
    tag === '[object Map]' || 
    tag =='[object Set]' ||
     typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(obj)
  ) {
    Object.freeze(obj);
    return obj;
  }

  Object.freeze(obj);
  for(const key of Object.keys(obj)) {
    const value = obj[key];
    // descend que dans les vrais objets/fonctions
    if(value && (typeof value ==='object' || typeof value === 'function')) {
      protectedDeepFreeze(value,_seen);
    }
  }
  return obj;
}


function freezeDepth1(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!Object.isFrozen(obj)) Object.freeze(obj);
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const proto = v && typeof v === 'object' ? Object.getPrototypeOf(v) : null;
    const isPojo = proto === Object.prototype || proto === null || Array.isArray(v);
    if (v && isPojo && !Object.isFrozen(v)) Object.freeze(v);
  }
  return obj;
}

function shallowFreeze(obj) {
   if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
   };
   return obj;
}


export {
    reasonFromCode,
    listDirs,
    accessReadable,
    protectedDeepFreeze,
    shallowFreeze,
    freezeDepth1
}