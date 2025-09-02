import fs from 'node:fs/promises';
import path from 'node:path';
import { constants as F } from 'node:fs';
/**
 * energy_uj — Énergie consommée
Ce fichier contient l’énergie totale consommée par un package CPU (ou un sous-domaine comme DRAM, GPU, etc.) depuis le démarrage.

L’unité est le microjoule (µJ) → 1 joule = 1 000 000 µJ

C’est une valeur croissante : elle augmente au fil du temps tant que le CPU consomme de l’énergie.
calculer la consommation énergétique sur une période :

// À t0
energy_uj = 1_000_000_000

// À t1 (1 seconde plus tard)
energy_uj = 1_000_050_000

// Énergie consommée = 50_000 µJ = 0.05 J

max_energy_range_uj — Capacité maximale du compteur
Ce fichier indique la valeur maximale que energy_uj peut atteindre avant de revenir à zéro (overflow).

C’est un compteur circulaire : quand energy_uj dépasse max_energy_range_uj, il recommence à zéro.

en tenir compte pour éviter des erreurs de calcul si mesures longues.
max_energy_range_uj = 262143999999

// Si energy_uj passe de 262143999900 à 100
// → Il y a eu un overflow, il faut corriger :
delta = (max - old) + new
 */

// src/sensors/rapl.js


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


const DEFAULT_BASE_PATH = '/sys/class/powercap';

export async function probeRapl(options = {}) {
    /**
     * On considère OK si au moins un package a energy_uj LISIBLE (droit R_OK).
    * On considère DEGRADED si on voit des packages mais aucun LISIBLE (existe mais pas de droits).
      *  On considère FAILED si /sys/class/powercap n’est pas LISIBLE du tout.
     */
   const basePath = options?.base_path || DEFAULT_BASE_PATH;

  const dirEntries =  await listDirs(basePath);
  
  if(!dirEntries) {
    return {status:'FAILED', vendor:'unknown',packages:[],hint: `${basePath} not accessible`};
  }

  const packages = [];

  for (const entry of dirEntries) {
   
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const dirname = entry.name;

    const pkgPath = path.join(basePath, dirname);
    const namePath = path.join(pkgPath, 'name');
    const energyPath = path.join(pkgPath, 'energy_uj');
    const maxRangePath = path.join(pkgPath, 'max_energy_range_uj');
    // lire le "name" pour filtrer rapidement
    let name;
    try {
      name = (await fs.readFile(namePath, 'utf8')).trim();
    } catch {
      continue;
    }
     
    if (!name.includes('package-')) continue;

    // tester lisibilité de energy_uj (R_OK), sans forcément le lire
    
    const [readable,maxEnergyRangeStrJ] = await Promise.all([
      accessReadable(energyPath),
      fs.readFile(maxRangePath, 'utf8').catch(() => null)
    ]);
    
    // lire max range (facultatif)
    let maxEnergyRangeUj = null;
      if(maxEnergyRangeStrJ != null) {
        const v = Number(String(maxEnergyRangeStrJ).trim());
        if(Number.isFinite(v)) {
          maxEnergyRangeUj = v;
        }
      }

     let realEnergyPath = energyPath;
    try { realEnergyPath = await fs.realpath(energyPath); } catch {}

    packages.push({
      vendor:dirname.startsWith('intel-rapl') ? 'intel' : (dirname.startsWith('amd-rapl') ? 'amd' : 'unknown'),
      node:dirname,
      path: pkgPath,
      name,
      hasEnergyUjReadable:readable.ok,
      reason:readable.ok ? null: readable.error,
      maxEnergyRangeUj,
      files: { energy_uj: realEnergyPath, max_energy_range_uj: maxRangePath }
    });
  }

  if (packages.length === 0) {
    // on a /sys/class/powercap mais aucun package reconnu
    return {
      status:'FAILED',
      vendor:'unknown',
      packages:[],
      hint:'No RAPL packages found (intel-rapl:N or amd-rapl:N). VM without powercap?'
    }
  } 

    const anyReadable = packages.some(p => p.hasEnergyUjReadable);
    const vendor =  packages.find(p => p.hasEnergyUjReadable)?.vendor || packages[0].vendor;
    const status = anyReadable ? 'OK' : 'DEGRADED';
    const hint = anyReadable ? null
    : 'RAPL present but unreadable (permissions). Run agent as root or add user to proper group (udev).';

  return { status,vendor, packages,hint };
}
