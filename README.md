# Spese Casa

App Next.js + Firebase per gestire spese di casa condivise.

## Funzionamento

- Aggiungi una voce, per esempio `bolletta acqua`.
- Inserisci l'importo.
- Se la voce è un rimborso, attiva `Rimborso`.
- Il totale finale calcola: spese normali meno rimborsi.
- La quota finale divide il totale netto per 2.

## Configurazione

1. Crea o usa un progetto Firebase.
2. Abilita Authentication con provider Google.
3. Crea Firestore Database.
4. Copia `.env.local.example` in `.env.local`.
5. Inserisci le variabili Firebase.
6. Aggiorna `firestore.rules` con gli UID autorizzati.

## Percorso dati

```text
home_expenses/{NEXT_PUBLIC_HOME_EXPENSES_ID}/items
```

Di default `NEXT_PUBLIC_HOME_EXPENSES_ID` è `casa`.

## Deploy Vercel

Su Vercel aggiungi le stesse variabili presenti in `.env.local`, poi fai deploy.
Ricorda di aggiungere il dominio finale in Firebase Authentication -> Settings -> Authorized domains.
