# API

## ENDPOINTS

`GET /healthz` 

1. Conditions normales

```json
{
  "status": "OK",
  "details": {
    "proc": "OK",
    "rapl": {
      "status": "OK",
      "vendor": "intel",
      "packages": [
        { "name": "package-0", "hasEnergyUjReadable": true }
      ]
    }
  }
}
```

2. Conditions dégradé:
   
```json
{
  "status": "DEGRADED",
  "details": {
    "proc": "OK",
    "rapl": {
      "status": "DEGRADED",
      "vendor": "intel",
      "packages": [
        {
          "name": "package-0",
          "hasEnergyUjReadable": false,
          "reason": "EACCES"
        }
      ],
      "hint": "RAPL present but unreadable (permissions). Run agent as root or add user to proper group (udev)."
    }
  }
}
```