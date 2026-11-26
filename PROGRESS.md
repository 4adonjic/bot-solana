# PROGRESS – Bot copy-trading Solana (solana-bot-trade)

## Le projet en une phrase
Bot TypeScript (Node.js) qui surveille des wallets Solana, décode leurs transactions, filtre les tokens douteux, simule les trades (shadow), puis copie les bons trades avec des sécurités.

## Environnement réel
- **Windows + PowerShell** (pas Linux/Ubuntu), dossier : `C:\Users\...\Documents\solana-bot-trade`
- Node v22.23.2, npm 10.9.8
- **PowerShell bloque `npm`** (scripts .ps1 désactivés) → toujours lancer avec `cmd /c`, par exemple :
  - `cmd /c "npm run typecheck"`
  - `cmd /c "npm run dev"`
  - (ou une fois : `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`)
- Les commandes longues (npm install) peuvent être coupées par Cline : lancer une seule commande à la fois, et attendre la fin avant la suivante.

## Versions installées (exactes)
- Prod : `@solana/web3.js` **1.99.0** (v1 volontairement, PAS la v3), `dotenv` 18.0.10, `pino` 10.4.0, `zod` 4.6.7
- Dev : `typescript` 7.0.2, `tsx` 4.23.15, `@types/node` 26.6.6, `pino-pretty` 13.2.0
- Piège connu : `npm install` sans version installe web3.js 3.x. Toujours vérifier avec `cmd /c "npm ls @solana/web3.js"` → doit afficher 1.99.0.
- Un avertissement EBADENGINE (`@solana-program/stake` demande Node ≥ 24) est apparu pendant l'installation de la v3. À vérifier : `cmd /c "npm ls @solana-program/stake"`. S'il reste, c'est un résidu, sans impact sur la v1.

## Arborescence
```
solana-bot-trade/
├─ src/
│  ├─ config/env.ts      (étape 1.2)
│  ├─ core/logger.ts     (étape 1.2)
│  ├─ radar/             (vide, étape 1.3)
│  ├─ decoder/           (vide, Module 2)
│  ├─ brain/             (vide, Module 3)
│  ├─ shadow/            (vide, Module 4)
│  ├─ executor/          (vide, Module 5)
│  └─ index.ts
├─ .env  (ignoré par git)   ├─ .env.example   ├─ .gitignore
├─ package.json ("type": "module")   └─ tsconfig.json (strict, NodeNext, ES2022)
```
Scripts : `dev` (tsx watch src/index.ts), `build` (tsc), `start` (node dist/index.js), `typecheck` (tsc --noEmit).

## Règle TypeScript NodeNext
Les imports relatifs doivent finir par `.js` (ex : `import { config } from "./config/env.js"`), même si le fichier source est `.ts`.

## Étapes validées
### 1.1 – Init (validée)
Projet initialisé, dépendances en versions exactes, tsconfig strict, connexion RPC réelle OK (log de la version `solana-core`).

### 1.2 – Config zod + logger (validée)
- `src/config/env.ts` : schéma zod qui valide `RPC_HTTP_URL`, `RPC_WS_URL` (ws/wss), `LOG_LEVEL`, `TARGET_WALLETS` (liste de vraies clés publiques Solana). Exporte un `config` typé en lecture seule. Si la config est invalide, le programme s'arrête avec un message clair (testé avec un wallet invalide).
- `src/core/logger.ts` : logger pino partagé, basé sur `config.logLevel`.
- `.env` créé (avec un wallet de test) ; `.env.example` mis à jour avec `TARGET_WALLETS`.
- `src/index.ts` utilise config + logger et affiche la connexion RPC.
- Test OK : `cmd /c "npm run typecheck"` puis `cmd /c "npm run dev"`.

## Étape en cours : 1.3 – Le radar (rien n'est encore écrit)
Plan prévu :
1. `src/core/types.ts` : interface `IngestionSource` (`start()`, `stop()`, événement `onTransactionSignature`) pour pouvoir ajouter plus tard une source gRPC Geyser sans toucher au reste.
2. `src/radar/websocketIngestor.ts` : implémentation avec `connection.onLogs` (`logsSubscribe`) sur chaque wallet cible, avec :
   - reconnexion automatique + resouscription explicite après coupure,
   - ping / health-check (les WebSockets Solana coupent parfois sans prévenir),
   - **backoff exponentiel** plafonné (~30 s), avec **nombre max de tentatives puis arrêt + log fatal** (option recommandée, à confirmer).
3. Mise à jour de `src/index.ts` : démarrer le radar et logger les signatures détectées.

Test attendu : lancer `cmd /c "npm run dev"` et voir une signature apparaître quand un wallet cible transactionne.

## Roadmap restante
- Module 2 : décodeur (pre/postTokenBalances, innerInstructions, détection DEX : Raydium, Pump.fun, Jupiter, Meteora, achat/vente, mint, montants)
- Module 3 : filtres de sécurité (mint/freeze authority, liquidité, top holders, scoring < 50 ms)
- Module 4 : shadow bot (SQLite/Prisma, PnL virtuel, TP/SL, copie de la vente)
- Module 5 : exécution (swap Jupiter, priority fees, Jito, slippage, montant max, kill-switch)

## Pour reprendre avec Cline
1. Vérifier dans les réglages de Cline le **fournisseur** et le **modèle** : la dernière erreur était « credit balance too low » de l'API **Anthropic**, donc Cline était sur le mauvais fournisseur. Choisir Google Gemini (modèle Flash Lite) ou un autre avec du quota.
2. Ouvrir une **nouvelle tâche** (bouton +) et coller :

```
Lis PROGRESS.md à la racine du projet avant de faire quoi que ce soit.
Règles : une seule étape à la fois, explique le pourquoi avant le code, code propre sans placeholder, ne lance qu'une commande à la fois (Windows PowerShell : utilise cmd /c pour npm), donne-moi une commande de test puis attends mon "C'est bon, ça tourne". Réponses courtes, ne relis pas les fichiers inutilement.
Reprends à l'étape 1.3 (radar WebSocket) en suivant le plan du fichier.
```
