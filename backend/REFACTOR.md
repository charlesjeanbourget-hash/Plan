# Refactor modulaire (en cours)

Branche `refactor/modular-backend`.

## Production
`uvicorn server:app` — monolithe inchangé.

## Bascule
`uvicorn app:app`

## Tests extraits
```
cd backend && pytest tests/test_extracted_core.py -q
```

## Modules extraits
auth, reset, pharmacies, licences, admin users, pointages, quarts.

## Pas encore extraits
IA horaire, formations, congés, paie, chat.
