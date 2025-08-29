## Module src/sensors/rapl.js
RAPL est une technologie développée par Intel à partir de ses processeurs Sandy Bridge, qui permet de mesurer et contrôler la consommation énergétique de différents composants internes du CPU en temps réel
Mesure d’énergie : RAPL expose des compteurs matériels (comme energy_uj) qui indiquent la quantité d’énergie consommée par le CPU, la mémoire (DRAM), le GPU intégré, etc.

Limitation de puissance : Il permet aussi de définir des limites de consommation (power caps) que le processeur respecte en ajustant sa fréquence ou en throttlant certains composants.

Optimisation thermique et énergétique : Très utile en data centers, laptops, ou environnements embarqués pour éviter la surchauffe ou prolonger l’autonomie.


Domaine RAPL	Ce qu’il couvre
package	Tout le socket CPU (cœurs + cache + GPU)
core / pp0	Les cœurs du processeur
uncore / pp1	Cache, contrôleur mémoire, GPU intégré
dram	La mémoire vive (sur serveurs)

L’énergie est mesurée en microjoules (energy_uj)

Les unités varient selon le modèle de CPU (ex: 15.3 µJ pour Sandy Bridge, 61 µJ pour Skylake)

RAPL utilise un modèle logiciel basé sur des événements internes (température, fréquence, etc.) pour estimer la consommation. Ce n’est pas une mesure analogique directe


### Rôle 

1. Découvrir les packages RAPL dispoibles dans `/sys/class/powercap`
2. Vérifier si les fichiers `energy_uj` sont disponoble et **lisible** (droits R.OK)
3. Exposer une liste des packages avec infos utiles (vendors, pagages,maxEnergyRange...)
4. Retourner un statut global clair:
    1. OK si > 1 package lisible
    2. DEGRADED  package trouvé mais aucun lisibles (souvent pb de permissions)
    3. FAILED : pas de RAPL détecté ou /sys/class/powercap absent.

### input/output

input:
```js
await probeRapl({ base_path: "/sys/class/powercap" })
```
output:
```json
{
  "status": "OK",
  "vendor": "intel",
  "packages": [
    {
      "vendor": "intel",
      "node": "intel-rapl:0",
      "path": "/sys/class/powercap/intel-rapl:0",
      "name": "package-0",
      "rhasEnergyUjReadable": true,
      "reason": null,
      "maxEnergyRangeUj": 65532610987,
      "files": {
        "energy_uj": "/sys/class/powercap/intel-rapl:0/energy_uj",
        "max_energy_range_uj": "/sys/class/powercap/intel-rapl:0/max_energy_range_uj"
      }
    }
  ],
  "hint": null
}

```
### IMPORTANT

**Symlinks** : certains nœuds sont des liens symboliques → on accepte dirs et symlinks.

**Filtrage** : on ne garde que les nœuds dont le fichier name contient package-*.

**Permissions** : si energy_uj existe mais non lisible → DEGRADED + reason = "EACCES".

**Wrap** : maxEnergyRangeUj sera utilisé plus tard dans la boucle 1 Hz pour corriger les dépassements de compteur.

**AMD** : support natif (amd-rapl:N).

