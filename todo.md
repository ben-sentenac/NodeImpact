# Agent Node.js – Spécification **fiable** (V1 pur Node.js)

> But : construire un **agent** qui mesure **énergie**, **CO₂e** et **santé de l’event‑loop** d’une application Node.js.

---

## 0) Résumé exécutif (pour Dev/DevOps)

* **Mesure “source de vérité”** : énergie CPU/SoC lue dans **RAPL** (`/sys/class/powercap/.../energy_uj`).
* **Attribution à l’app** : clé **CPU‑share** (part CPU app vs hôte).
* **CO₂e** : énergie (kWh) × **intensité carbone** (kgCO₂e/kWh).
* **Event‑loop** : `monitorEventLoopDelay()` + `eventLoopUtilization()`.
* **Exports** : Prometheus `/metrics`, JSON `/snapshot`, NDJSON.

---

## 1) Notation claire

* **W** = Watt (puissance).
* **J** = Joule (énergie). 1 Wh = 3600 J ; 1 kWh = 1000 Wh.
* `Δt` = durée du pas (s).
* `E_cumul_uj` = compteur énergie RAPL (µJ).
* `P_host` = puissance hôte (W).
* `share` = part CPU de l’app (0→N).
* `P_app` = puissance attribuée (W).
* `E_app` = énergie de l’app (J/Wh/kWh).
* `I_grid` = intensité carbone (kgCO₂e/kWh).
* `lag_p95`, `EL_util` = métriques event‑loop.

---

## 2) Formules principales

### 2.1 Puissance hôte (RAPL)

* `E_delta_J = (E_cumul[i] − E_cumul[i−1]) / 1e6` (corrigé wrap).
* `P_host = E_delta_J / Δt` (W).

### 2.2 Part CPU & attribution

* `ΔCPU_host_s = (CPU_host[i] − CPU_host[i−1]) / HZ`.
* `ΔCPU_app_s  = (CPU_app[i] − CPU_app[i−1]) / HZ`.
* `share = ΔCPU_app_s / ΔCPU_host_s`.
* `P_app = share × P_host` ; `E_app_J += P_app × Δt`.

### 2.3 CO₂e

* `CO2e_g_window = E_app_kWh_window × I_grid × 1000`.
* `CO2e_req_mg = (E_req_kWh × I_grid × 1e6)`.

### 2.4 Event‑loop

* `lag` via histogramme `monitorEventLoopDelay()` → p50/p95/p99/max.
* `EL_util = Δactive / (Δactive+Δidle)` via `eventLoopUtilization()`.

---

## 3) Flow de l’application

```
[Config YAML] → [Init Agent] → [Découverte Cible]
                    ↓
        ┌───────────┴───────────┐
        │  Boucle 1 Hz (Δt)     │
        │  - RAPL → P_host      │
        │  - /proc → share      │
        │  - P_app, E_app       │
        │  - Ingest EL/Trafic   │
        └───────────┬───────────┘
                    ↓ (fenêtres)
             [Agrégation & CO₂e]
                    ↓
    [Prometheus /metrics]  [JSON /snapshot]  [NDJSON]
                    ↓
               [Health / Logs]
```

États :

* **OK** : tous capteurs OK.
* **DEGRADED** : RAPL absent (fallback) ou pas d’event‑loop.
* **FAILED** : cible introuvable ou capteur critique HS.

---

## 4) Briefing énergie & carbone

* **Puissance (W)** = instantané, **Énergie (Wh)** = cumul (W × temps).
* **RAPL** = compteur matériel fiable (µJ).
* **Attribution** : on suppose que la part CPU ≈ part énergie.
* **CO₂e** : intensité carbone dépend de l’heure et du lieu.
* **Event‑loop** : lag élevé = saturation ; EL\_util proche de 1 = CPU saturé.

---

## 5) Exemple chiffré (60 s)

* RAPL : `ΔE_host = 252 J` → `P_host = 4.2 W`.
* CPU : `share = 0.5`.
* App : `P_app = 2.1 W`, `E_app = 126 J = 0.035 Wh`.
* Carbone : `CO₂e = 5.25 g` (I\_grid=0.150).
* Event‑loop : `lag_p99=28 ms`, `EL_util=0.58`.

---

## 6) Exemple de config YAML (complet)

```yaml
# agent-config.yaml
agent:
  sampling:
    period_ms: 1000       # pas d'échantillonnage (1 Hz)
  windows: [10s, 60s, 300s] # fenêtres glissantes
  timezone: UTC

target:
  selector:
    mode: pid               # pid | process_name | port | cgroup
    pid: 12345
  eventloop_probe:
    enabled: true
    expected_interval_ms: 10
    ingest:
      transport: uds
      uds_path: /tmp/node-app-el.sock

energy:
  sensors:
    rapl:
      enabled: true
      base_path: /sys/class/powercap
      packages: []
    gpu:
      enabled: false
  idle_baseline_wh_per_min: 0.000

attribution:
  mode: cpu_share
  multifactor:
    enabled: false
    coefficients:
      w0: 0.0
      w1: 15.0
      w2: 0.0
      w3: 0.5
      w4: 0.8

carbon:
  source:
    type: file
    file: /etc/agent/carbon_intensity.csv
  zone: FR
  default_kg_per_kwh: 0.25

export:
  http:
    enabled: true
    listen: 0.0.0.0
    port: 9465
    endpoints:
      metrics: /metrics
      snapshot: /snapshot
      healthz: /healthz
      ingest_eventloop: /ingest/eventloop
  file:
    ndjson_enabled: true
    path: /var/log/agent/metrics-%Y-%m-%d.ndjson
    rotate_mb: 50

logging:
  level: info
  file: /var/log/agent/agent.log

limits:
  max_rps_ingest: 200
  max_mem_mb: 100
```

---

## 7) Schéma JSON event‑loop (extrait)

```json
{
  "ts": "2025-08-28T12:34:56Z",
  "pid": 12345,
  "source": "eventloop",
  "utilization": 0.58,
  "stats": {"p50_ms": 3.1, "p95_ms": 11.2, "p99_ms": 28.4, "max_ms": 52.0, "count": 6000}
}
```

---

## 8) To‑do list (implémentation pas‑à‑pas)

### Étape 1 – Init & Healthz

*

### Étape 2 – Découverte cible

*

### Étape 3 – Boucle d’échantillonnage 1 Hz

*

### Étape 4 – Event‑loop ingestion

*

### Étape 5 – Agrégation fenêtres

*

### Étape 6 – Exports

*

### Étape 7 – Tests

*

---

## 9) Modèle empirique (fallback si RAPL absent)

### 9.1 Objectif

Estimer la **puissance moyenne P\_hat (W)** du processus sans capteur matériel, en utilisant un modèle linéaire basé sur des métriques accessibles (/proc, Node.js APIs).

### 9.2 Formule

```
P_hat[W] = w0
         + w1 * cpu_ratio         # 0 → N (N≈nb de coeurs utilisés)
         + w2 * rss_gb            # Go de mémoire résidente
         + w3 * net_MBps          # débit réseau en MB/s
         + w4 * disk_MBps         # débit disque en MB/s
```

### 9.3 Variables

* `cpu_ratio` = ΔCPU\_app\_s / Δt  (temps CPU de l’app pendant la fenêtre, normalisé en secondes / Δt). Peut dépasser 1 si multi-coeurs.
* `rss_gb` = mémoire résidente moyenne pendant la fenêtre (Go).
* `net_MBps` = (Δoctets\_rx+Δoctets\_tx) / Δt / 1e6.
* `disk_MBps` = (Δread+Δwrite) / Δt / 1e6.

### 9.4 Calibration

1. **Mesures réelles** : lancer l’app sous charges variées (idle, 30%, 60%, 90%) pendant quelques minutes.
2. **Collecte** : enregistrer à chaque pas Δt :

   * `P_host_mesuré` via wattmètre externe ou machine identique avec RAPL.
   * les features (`cpu_ratio`, `rss_gb`, `net_MBps`, `disk_MBps`).
3. **Ajustement** : régression linéaire Ridge (L2) → coefficients `w0..w4`.
4. **Validation** : R² ≥ 0.9, erreur médiane ≤ 10–15 %. Sinon, refaire calibration.

### 9.5 Utilisation

* Pendant la boucle d’échantillonnage :

  * calculer `P_hat` à chaque Δt.
  * énergie app = Σ (P\_hat × Δt).
  * ensuite même pipeline (Wh, CO₂e, per-req, agrégation).

### 9.6 Limites du modèle

* **Spécifique au hardware** : recalibrer si changement CPU/plan énergie.
* **Colinéarité** : CPU et I/O souvent corrélés → Ridge stabilise.
* **RSS** : faible influence en pratique → `w2` peut ≈ 0.
* **Qualité** : pas aussi fiable que RAPL (erreur ±15–25 %).

---

## 10) Limites connues

* RAPL absent sur certains CPU/VM → fallback modèle empirique calibré.
* Attribution CPU‑share approximative si app très I/O‑bound.
* Event‑loop metrics requièrent `--require probe` côté app.

---

## 6bis) Exemple **carbon\_intensity.csv** (format et règles)

### Schéma attendu (CSV, UTF‑8, séparateur `,`)

Colonnes **obligatoires** :

* `ts_utc` : horodatage en **UTC** au format ISO‑8601 (`YYYY-MM-DDTHH:MM:SSZ`).
* `intensity_kg_per_kwh` : nombre réel (ex. `0.150` pour 150 gCO₂e/kWh).

Colonnes **optionnelles** :

* `zone` : code court (ex. `FR`, `DE`, `UK`) — si absent, la valeur de `carbon.zone` dans la config est utilisée.
* `type` : `average` ou `marginal` (défaut `average`).
* `source` : texte libre (ex. `entsoe`, `ademe`, `uk-nationalgrid`).

### Exemple minimal (horaire)

```
ts_utc,intensity_kg_per_kwh,zone,type,source
2025-08-28T12:00:00Z,0.150,FR,average,ademe
2025-08-28T13:00:00Z,0.138,FR,average,ademe
2025-08-28T14:00:00Z,0.165,FR,average,ademe
```

### Exemple pas 15 minutes (plus précis)

```
ts_utc,intensity_kg_per_kwh,zone,type,source
2025-08-28T12:00:00Z,0.152,FR,marginal,entsoe
2025-08-28T12:15:00Z,0.149,FR,marginal,entsoe
2025-08-28T12:30:00Z,0.143,FR,marginal,entsoe
2025-08-28T12:45:00Z,0.145,FR,marginal,entsoe
2025-08-28T13:00:00Z,0.140,FR,marginal,entsoe
```

### Règles d’interprétation côté agent

1. **UTC obligatoire** : l’agent n’applique **aucun fuseau** aux valeurs CSV. Convertissez vos données en UTC **avant** import.
2. **Appariement temporel** : pour chaque fenêtre (ex. 60 s), l’agent utilise la valeur **la plus proche** de `ts_utc` ; si plusieurs valeurs encadrent la fenêtre, il peut faire une **interpolation linéaire** (option activable plus tard) ; par défaut, c’est un **nearest**.
3. **Trous de données** : si aucun point n’est disponible dans une tolérance de ±90 min autour de la fenêtre, l’agent utilise `carbon.default_kg_per_kwh` et marque un **flag** interne `carbon_gap`.
4. **Types** : si la colonne `type` existe, l’agent préfère la série `type == config.carbon.type` (dans la V1, `average` implicite).
5. **Validation** : valeurs négatives ou > 1.5 kg/kWh → ligne ignorée + compteur `sensor_errors_total{sensor="carbon"}`.

### Bonnes pratiques

* **Granularité** : un pas de 15 min apporte une meilleure fidélité que l’horaire pour des workloads variables.
* **Qualité** : documentez la **source** et la **méthode** (`average` vs `marginal`). Le **marginal** est souvent plus pertinent pour l’optimisation.
* **Continuité** : évitez les grands trous ; au besoin, prolongez la dernière valeur connue pour < 2 heures.

---

## 6ter) Alternative HTTP (si vous avez une API interne)

### Requête

* `GET` sur l’URL définie par `carbon.source.http_url` (si activé dans la config).
* Paramètres **recommandés** (query) : `start=ISO_UTC`, `end=ISO_UTC`, `zone=FR`, `step=15m|60m`.

### Réponse (JSON, exemple)

```json
{
  "zone": "FR",
  "type": "average",
  "series": [
    {"ts_utc": "2025-08-28T12:00:00Z", "intensity_kg_per_kwh": 0.150},
    {"ts_utc": "2025-08-28T13:00:00Z", "intensity_kg_per_kwh": 0.138}
  ]
}
```

### Règles

* Même logique qu’en CSV : UTC strict, valeurs > 0, nearest par défaut.
* Si l’API renvoie plusieurs **types**, l’agent choisit celui demandé par la config (sinon `average`).

---

## 6quater) Modèle empirique **fiable** (fallback lorsque RAPL est absent)

> Objectif : estimer la **puissance moyenne** de l’application (en W) à partir de métriques disponibles sans capteurs d’énergie. À n’utiliser **que si** RAPL/wattmètre n’est pas accessible. Le modèle doit être **calibré par machine** et **validé**.

### A) Grandeurs et unités (cohérentes)

* `cpu_ratio` : part CPU de l’app sur le pas `Δt` (en "cœurs équivalents").

  * Calcul : `cpu_ratio = ΔCPU_app_s / Δt` ; ex. 1.0 = 1 cœur saturé, 2.0 = 2 cœurs, etc.
* `rss_gb` : mémoire résidente moyenne (Go) de l’app sur `Δt`.
* `net_MBps` : débit réseau moyen (Mo/s) = `(Δrx+Δtx)/Δt/1e6`.
* `disk_MBps` : débit disque moyen (Mo/s) = `(Δread+Δwrite)/Δt/1e6`.
* (optionnel) `cpu_freq_norm` : fréquence CPU courante / fréquence max (0–1) si lisible.

### B) Forme du modèle (linéaire, en W)

```
P_hat[W] = w0
         + w1 * cpu_ratio
         + w2 * rss_gb
         + w3 * net_MBps
         + w4 * disk_MBps
         (+ w5 * cpu_freq_norm)        # optionnel
         (+ w6 * cpu_ratio * net_MBps) # interaction optionnelle
```

* **Pourquoi linéaire ?** robuste, explicable, calibrable vite. Les interactions sont facultatives si elles réduisent l’erreur.

### C) Données nécessaires pour calibrer

* Pour chaque pas (ex. 1 s) pendant **4 paliers de charge** (idle/30/60/90 %) et **3–5 min** chacun :

  * Côté app : `cpu_ratio`, `rss_gb`, `net_MBps`, `disk_MBps` (et `cpu_freq_norm` si possible).
  * **Cible à estimer** : `P_host_measured` (via wattmètre externe **ou**, si indisponible, un **proxy** comme `cpu_power_model` du kernel si présent). Si aucune mesure de référence n’est possible, le modèle **n’est pas utilisable fiablement**.

### D) Calibration (réglage des coefficients)

1. **Préparer X et y** :

   * `X = [cpu_ratio, rss_gb, net_MBps, disk_MBps, (freq), (interaction)]`
   * `y = P_host_measured`
2. **Standardiser** les colonnes de `X` (z-score) sauf si les échelles sont déjà maîtrisées.
3. **Ridge regression (L2)** pour stabilité : choisir `alpha` par **validation croisée k-fold (k=5)**.
4. **Vérifier** les signes : `w1` (CPU) devrait être **positif** ; `w2` (RSS) peut être proche de zéro ; `w3`, `w4` **positifs**.

### E) Validation (avant mise en prod)

* **R² ≥ 0.90** (sur un jeu de validation distinct) **et**
* **MdAPE ≤ 15 %** (Median Absolute Percentage Error) ; viser **≤ 10 %** si possible.
* **Biais** : la médiane des résidus doit être ≈ 0. Si biais systématique aux forts débits disque → ajouter interaction ou revoir features.

### F) Utilisation du modèle en production

* À chaque pas `Δt` : calculer `P_hat` avec les features instantanés → `E_hat_J += P_hat × Δt`.
* **Attribution multi‑process** (si plusieurs apps) :

  * Option A (simple) : ce modèle est **par app** ; on ne force pas la somme à égaler la puissance hôte.
  * Option B (contrainte douce) : si on dispose parfois d’une **mesure hôte** (ex. lecture ACPI/board) on peut **re‑scaler** tous les `P_hat` pour que `Σ P_hat ≤ P_host_proxy`.
* **Incertitude** : publier une **barre d’erreur** basée sur l’erreur de validation (ex. ±MdAPE).

### G) Détection de dérive (drift)

* Surveiller en continu l’**erreur ex‑post** quand une référence ponctuelle est dispo (ex. mesures ponctuelles avec un wattmètre). Si MdAPE glissant > 20 % → **recalibrer**.
* Déclencher recalibration aussi après : upgrade kernel/CPU governor, changement d’instance cloud, migration conteneur.

### H) Bonnes pratiques

* **Profil par machine** : stocker `model.json` par type d’instance (ex. `c6i.large`, `baremetal‑x`).
* **Limiter les features** : mieux vaut 3–4 signaux fiables qu’une dizaine corrélés.
* **Vérifier la colinéarité** : si `cpu_ratio` et `disk_MBps` sont très corrélés, le Ridge aide ; sinon, retirer la feature la moins explicative.
* **Bornes physiques** : tronquer `P_hat` à `[0, TDP_estime]` pour éviter des valeurs non plausibles.

### I) Exemple chiffré (fictif)

* Coefficients calibrés (profil `vm‑standard‑x`) :

  * `w0=22.0`, `w1=11.5`, `w2=0.0`, `w3=0.6`, `w4=0.9` (W).
* Pas de 1 s ; features mesurées : `cpu_ratio=1.2`, `rss_gb=0.8`, `net_MBps=5`, `disk_MBps=2` →

  * `P_hat = 22.0 + 11.5*1.2 + 0*0.8 + 0.6*5 + 0.9*2 = 22 + 13.8 + 3 + 1.8 = 40.6 W`.
  * Énergie sur 60 s : `E_hat = 40.6 × 60 = 2436 J = 0.677 Wh`.

### J) Export et traçabilité du modèle

* Sauvegarder `model.json` :

```json
{
  "version": 1,
  "features": ["cpu_ratio","rss_gb","net_MBps","disk_MBps"],
  "coefficients": {"w0":22.0,"w1":11.5,"w2":0.0,"w3":0.6,"w4":0.9},
  "alpha": 0.5,
  "r2": 0.92,
  "mdape": 0.12,
  "trained_at": "2025-08-28T12:00:00Z",
  "profile": "vm-standard-x"
}
```

* Journaliser la **version** et le **profil matériel** dans chaque ligne NDJSON.

---

---

## 19) Tableau récapitulatif – Fichiers/API, unités, calculs

| Sous-système           | Où lire                                                                         | Champs clés                                           | Unités         | Lecture / échantillonnage                                          | Ce qu’on calcule                                                    | Pièges                                             |
| ---------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------- |
| **CPU (hôte)**         | `/proc/stat` (ligne `cpu`)                                                      | user, nice, system, idle, iowait, irq, softirq, steal | ticks (1/HZ s) | Lire à chaque Δt (≈1s), faire Δ par champ, sommer temps « actifs » | `ΔCPU_host_s = Δ(sum actifs)/HZ`                                    | HZ ≈ 100; ne pas oublier irq/softirq/steal         |
| **CPU (app)**          | `/proc/<pid>/stat`                                                              | `utime` (14), `stime` (15)                            | ticks          | Lire à chaque Δt et faire Δ                                        | `ΔCPU_app_s = Δ(utime+stime)/HZ` ; `share = ΔCPU_app_s/ΔCPU_host_s` | PID qui redémarre → réinitialiser base             |
| **Énergie CPU/SoC**    | `/sys/class/powercap/intel-rapl:*/energy_uj`                                    | `energy_uj`, `max_energy_range_uj`, `name`            | µJ             | Lire chaque Δt, faire Δ, corriger wrap, sommer packages            | `E_delta_J = Δ/1e6` ; `P_host = E_delta_J/Δt` ; `E_app` via `share` | Absence RAPL sur certains CPU/VM                   |
| **Mémoire (app)**      | `/proc/<pid>/status` ou `process.memoryUsage()`                                 | `VmRSS` / `rss`                                       | kB / bytes     | Lire chaque Δt (ou moins), moyenne/max par fenêtre                 | `rss_bytes` (reporting)                                             | `VmRSS` parfois fluctue avec COW                   |
| **I/O disque (app)**   | `/proc/<pid>/io`                                                                | `read_bytes`, `write_bytes`                           | bytes          | Lire chaque Δt et faire Δ                                          | `read_Bps = Δ/Δt` ; `write_Bps` (reporting, modèle fallback)        | Cache page → `read_bytes` sous-estimé              |
| **Réseau (interface)** | `/proc/net/dev` (ou `/proc/<pid>/net/dev` si netns partagé)                     | `bytes` RX/TX                                         | bytes          | Lire chaque Δt et faire Δ                                          | `rx_Bps`, `tx_Bps` (reporting, modèle fallback)                     | Attribution par app non triviale hors cgroup/netns |
| **Event‑loop**         | `perf_hooks.monitorEventLoopDelay()` & `eventLoopUtilization()` (dans la cible) | histogramme lag, active/idle                          | ms / µs        | Émettre vers agent toutes 10–60 s                                  | `lag_p50/p95/p99/max`, `EL_util = Δactive/(Δactive+Δidle)`          | Nécessite `--require` (coopération de la cible)    |
| **Carbone**            | CSV `carbon_intensity.csv` ou API                                               | `ts_utc`, `intensity_kg_per_kwh`                      | kg/kWh         | Appariement par fenêtre (nearest)                                  | `CO2e_g_window = E_kWh × I × 1000`                                  | UTC strict, trous → valeur par défaut              |

---

## 20) Guide de codage – Pas à pas clair

### 20.1 Structure de projet (proposée)

```
agent/
├─ src/
│  ├─ config.ts            # chargement/validation YAML
│  ├─ sensors/
│  │  ├─ rapl.ts           # lecture energy_uj, wrap, multi-packages
│  │  ├─ cpu.ts            # /proc/stat et /proc/<pid>/stat → shares
│  │  ├─ proc_io.ts        # /proc/<pid>/io
│  │  ├─ net.ts            # /proc/net/dev
│  │  └─ mem.ts            # /proc/<pid>/status ou process.memoryUsage()
│  ├─ carbon.ts            # parse CSV/API, nearest match
│  ├─ aggregate.ts         # fenêtres, moyennes, percentiles, conversions
│  ├─ export/
│  │  ├─ http.ts           # /metrics, /snapshot, /healthz, /ingest/eventloop
│  │  └─ ndjson.ts         # writer rotatif
│  ├─ loop.ts              # boucle 1 Hz orchestrant les capteurs
│  ├─ eventloop_ingest.ts  # réception des métriques de la cible
│  ├─ health.ts            # états OK/DEGRADED/FAILED
│  └─ utils.ts             # Δt, parsing, safe fs, clamp, percentiles
├─ bin/
│  └─ agent.js             # entrypoint CLI
├─ probe-eventloop.js      # micro‑module à charger avec --require côté app
└─ agent-config.yaml       # config exemple
```

### 20.2 Étapes de dev (checklist)

1. **Config & Healthz**

* Parser le YAML → objet config typé + défauts.
* Endpoints `/healthz` (simple JSON) et log niveau `info`.

2. **Capteurs de base**

* **RAPL** : function `readRapl()` renvoie `{E_delta_J, P_host_W}` (gère wrap, multi-packages, Δt réel).
* **CPU share** : function `readCpu()` renvoie `{ΔCPU_host_s, ΔCPU_app_s, share}`.

3. **Boucle 1 Hz**

* Scheduler basé sur `setInterval` + correction dérive (utiliser l’horloge pour Δt réel).
* À chaque tick : lire capteurs, calculer `P_app`, accumuler `E_app_J`, bufferiser le point brut.

4. **Agrégation fenêtres** (10s/60s/300s)

* Maintenir des buffers circulaires par métrique.
* Calculer : moyennes (puissance), sommes (énergie), min/max, percentiles (event‑loop, latences si dispo).
* Conversion `J→Wh/kWh` ; calcul `CO₂e` via `carbon.ts`.

5. **Exports**

* `/metrics` : exposer gauges/counters (prom-client ou sortie texte Prom simple).
* `/snapshot` : JSON agrégé de la dernière fenêtre.
* NDJSON : écriture 1 ligne/fenêtre avec rotation par date.

6. **Event‑loop ingestion**

* UDS/UDP/HTTP selon config ; valider le schéma ; agréger dans les fenêtres.

7. **Tests & robustesse**

* Cas wrap RAPL ; PID restart ; Δt irrégulier ; capteurs absents → état `DEGRADED`.
* Test de précision : comparer total énergie vs wattmètre (si dispo) sur un run simple.

### 20.3 Conseils d’implémentation

* **Δt réel** : ne pas supposer 1.000 s ; calcule `Δt = now - last`.
* **Lecture fichiers** : préférer `fs.readFileSync` sur petits fichiers de `/proc`/`/sys` (coût négligeable à 1 Hz), ou `promisified` si tu veux non‑bloquant.
* **Parse robuste** : trim, split sur espaces multiples ; gérer erreurs silencieuses en `DEGRADED`.
* **Horodatage** : toujours émettre en **UTC** ISO‑8601.
* **Overhead** : mesure ton propre CPU/RSS (`process.cpuUsage`, `process.memoryUsage`) et expose-les.
* **Percentiles** : pour l’EL, si tu reçois un histogramme, calcule p50/p95/p99 avec une méthode HDR‑like ou utilise les percentiles déjà fournis par le probe.

### 20.4 Stratégie de validation (sans maths compliquées)

* **Test Idle** : 5 min sans trafic → vérifier `P_app` \~ 0 et `E_app` \~ baseline.
* **Test CPU‑bound** : un workload CPU constant → `share` \~ stable ; `P_app` corrélé à `P_host`.
* **Test I/O‑bound** : gros downloads/reads → vérifier que l’attribution reste raisonnable (documenter que la précision baisse).
* **Event‑loop** : injecter un `setTimeout` lourd pour voir `lag_p99` grimper.

---

## 21) Prochaine étape suggérée

On peut démarrer par **Étape 1–3** : config + healthz, puis capteurs RAPL/CPU, puis la **boucle 1 Hz** avec logs des premières valeurs (`P_host`, `share`, `P_app`, `E_app_J`). Ensuite, on ajoutera l’agrégation et les exports.


resources: 
https://web.eece.maine.edu/~vweaver/projects/rapl/
https://github.com/amd/amd_energy

