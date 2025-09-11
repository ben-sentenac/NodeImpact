# Node.js Energy & CO₂ Agent

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

---

## Configuration
L’agent lit son fichier de configuration JSON (validé par AJV).
Exemple minimal :
```json
{
  "agent": { "sampling": { "period_ms": 1000 }, "windows": ["60s"], "timezone": "UTC" },
  "target": { "selector": { "mode": "pid", "pid": 12345 }, "eventloop_probe": { "enabled": false, "expected_interval_ms": 10, "ingest": { "transport": "uds", "uds_path": "/tmp/el.sock" } } },
  "energy": { "sensors": { "rapl": { "enabled": true, "base_path": "/sys/class/powercap", "packages": [] }, "gpu": { "enabled": false } }, "idle_baseline_wh_per_min": 0 },
  "attribution": { "mode": "cpu_share", "multifactor": { "enabled": false, "coefficients": { "w0":0,"w1":15,"w2":0,"w3":0.5,"w4":0.8 } } },
  "carbon": { "source": { "type": "file", "file": "/etc/agent/carbon_intensity.csv" }, "zone": "FR", "default_kg_per_kwh": 0.25 },
  "export": { "http": { "enabled": true, "listen": "0.0.0.0", "port": 9465, "endpoints": { "metrics": "/metrics", "snapshot": "/snapshot", "healthz": "/healthz", "ingest_eventloop": "/ingest/eventloop" } }, "file": { "ndjson_enabled": false, "path": "/tmp/metrics.ndjson", "rotate_mb": 50 } },
  "logging": { "level": "info", "file": "/tmp/agent.log" },
  "limits": { "max_rps_ingest": 200, "max_mem_mb": 100 }
}
```
Voir [config](docs/config.md)
 pour la référence complète.

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

- prod recommandé : ajouter l’utilisateur à un groupe via udev (voir [config](docs/Cconfig.md) section 9)

## Roadmap (V1)

- [x] Config JSON + validation AJV

- [x] Healthz (proc + RAPL)

- [x] Boucle 1 Hz énergie (Δ energy_uj + wrap)

- [ ] CPU share attribution

- [ ] Export Prometheus & NDJSON

- [ ] Ingestion Event-loop

- [ ] Intégration intensité carbone

> [!WARNING]  
> Developpement en cours.