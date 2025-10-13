# Node.js Energy & CO₂ Agent

![Node.js CI](https://github.com/ben-sentenac/NodeImpact/actions/workflows/nodejs.yml/badge.svg)

Un **agent Node.js** pour mesurer :

-  **Énergie CPU/SoC** (via RAPL ou modèle empirique)
-  **Émissions CO₂e** (avec intensité carbone dynamique)
-  **Santé de l’event-loop** (latence, utilisation)
-  Export métriques (Prometheus, JSON, NDJSON)

##  Objectif

Aider **développeurs et DevOps** à :
- comprendre la consommation énergétique de leurs applications,
- calibrer les ressources (CPU/RAM/IO),
- suivre l’empreinte carbone en temps réel,
- détecter les saturations de l’event-loop.

```
## Lancer l’agent

```sh
node bin/agent.js --config agent.config.json
```

## Endpoints disponibles par défaut :

- `GET /healthz` : état global (OK / DEGRADED / FAILED)

- `GET /metrics` : exposition Prometheus (prochaines étapes)

- `GET /snapshot` : snapshot JSON (prochaines étapes)

## Permissions RAPL

- Sur Linux, les fichiers /sys/class/powercap/intel-rapl:*/energy_uj sont parfois réservés à root.
Solutions :

test rapide : sudo node bin/agent.js ...

- prod recommandé : ajouter l’utilisateur à un groupe via udev.

## Roadmap (V1)

- [x] Config JSON + validation AJV

- [x] Healthz (proc + RAPL)

- [x] Boucle 1 Hz énergie (Δ energy_uj + wrap)

- [x] CPU share attribution

- [ ] Export Prometheus & NDJSON

- [ ] Ingestion Event-loop

- [ ] Intégration intensité carbone

> [!WARNING]  
> Developpement en cours.