import { readFile } from "node:fs/promises";
import { clampDt } from "../lib/cpu_utils.js";
/**
 * Chaque CPU (par “package”) expose un compteur d’énergie cumulée depuis le boot : energy_uj (en microjoules).
* Ce compteur augmente en continu tant que la machine tourne.
* Quand il atteint une valeur max (fichier max_energy_range_uj), il repart à 0 on appelle ça un wrap (dépassement).
* donc si delta negatif il y'eu depassement
 */


export default class RaplReader {
    constructor(probe = {}) {
        const packages = (probe?.packages || []).filter(p => p.hasEnergyUjReadable && p.files?.energy_uj);
        this.state = {
            lastNs: null,//bigint
            pkgs: packages.map(p => ({
                node: p.node,
                path: p.path,
                name: p.name,
                file: p?.files?.energy_uj,
                maxRange: Number.isFinite(p.maxEnergyRangeUj) ? BigInt(p.maxEnergyRangeUj) : null,
                last_uj: null//bigint
            }))
        };
    }
    async sample(nowNs) {
        //dépassement
        let wraps = 0n;
        let delta_uj_total = 0n;//energie_cumulé_uj

        if (this.state.lastNs === null) {
            this.state.lastNs = nowNs;
        }
        const reads = this.state.pkgs.map(async (pkg) => {
            try {
                const raw = await readFile(pkg.file, 'utf8');
                const current_uj = BigInt(raw.trim());
                return { pkg, current_uj };
            } catch (error) {
                return { pkg, current_uj: null };
            }

        });

        const results = await Promise.all(reads);

        for (const { pkg, current_uj } of results) {
            if (current_uj === null) continue;
            if (pkg.last_uj === null) { pkg.last_uj = current_uj; continue; };//prime et ne pas produire de delta (retourner null power la 1ère fois).
            let delta_uj = current_uj - pkg.last_uj;
            if (delta_uj < 0n && pkg.maxRange !== null) { delta_uj = current_uj + pkg.maxRange - pkg.last_uj; wraps++; }
            if (delta_uj > 0n) delta_uj_total += delta_uj;
            pkg.last_uj = current_uj;
        }

        let delta_ts = Number(nowNs - this.state.lastNs) / 1e9;//t en s
         //on borne dt dans [0.2,5] si server ou vm freeze au pour ne pas se retrouver avec un dt absurde si l'intervalle derape
        delta_ts = clampDt(delta_ts);
        this.state.lastNs = nowNs;
        //console.log(delta_uj_total,delta_ts,this.state.lastNs);

        if (delta_uj_total === 0n) {
            return {
                ok: this.state.pkgs.length > 0,
                delta_ts,
                delta_uj: 0,
                delta_j: 0,
                power_w: 0,
                packages: [],
                wraps: Number(wraps)
            }
        }
        const delta_uj_num = Number(delta_uj_total);
        const delta_j = delta_uj_num / 1e6 //micro joule -> joule
        const power_w = delta_j / delta_ts // watt   
        return {
            ok: this.state.pkgs.length > 0,
            delta_ts,
            delta_uj: delta_uj_num,//Énergie sur l’intervalle (tous packages confondus) :
            delta_j,
            power_w,//Puissance moyenne sur l’intervalle :
            packages: this.state.pkgs.map(p => ({ node: p.node, path: p.path })),
            wraps: Number(wraps)
        };
    }
}