# PROGRESS – Bot copy-trading Solana (solana-bot-trade)

## Le projet
Bot TypeScript (Node.js) qui surveille des wallets Solana, décode leurs transactions, filtre les tokens douteux, simule les trades (shadow), puis copie les bons trades avec des sécurités.

## Environnement
- Windows + PowerShell, Node.js 22.23.2, npm 10.9.8.
- Si PowerShell bloque les scripts npm, lancer les commandes via `cmd /c "npm ..."`.
- Dépendances verrouillées dans `package-lock.json`. Garder `@solana/web3.js` en version 1.x (actuellement 1.99.0).
- Ne jamais committer le fichier `.env` ni les clés RPC privées.

## Arborescence
- `src/config/env.ts` : validation Zod de la configuration.
- `src/core/logger.ts` : logger Pino partagé.
- `src/radar/radar.ts` : surveillance WebSocket des wallets.
- `src/decoder/` : récupération et décodage des transactions.
- `src/brain/`, `src/shadow/`, `src/executor/` : étapes futures.

## Règle TypeScript NodeNext
Les imports relatifs doivent finir par `.js`, même si les fichiers source sont en `.ts`.

## Étapes validées
### 1.1 – Initialisation
Projet initialisé, dépendances verrouillées, tsconfig strict, connexion RPC testée.

### 1.2 – Configuration et logs
- `src/config/env.ts` valide `RPC_HTTP_URL`, `RPC_WS_URL`, `LOG_LEVEL` et `TARGET_WALLETS`.
- `src/core/logger.ts` configure Pino.

### 1.3 – Radar WebSocket
- Fusionné dans `main` via la PR #1.
- `RPC_WS_URL` est transmis à `Connection`.
- Chaque wallet cible reçoit un abonnement `onLogs`.
- Nettoyage des abonnements à l'arrêt et backoff exponentiel pour les échecs de création.
- GitHub Actions a validé `npm ci`, `npm run typecheck` et `npm run build`.
- À tester encore avec une vraie connexion RPC et un wallet qui effectue une transaction. La reconnexion en cas de coupure réseau n'a pas encore été validée en conditions réelles.

## Module 2 – Décodeur (en cours)
Branche actuelle : `feat/decoder-balance-diffs` (PR #2 ouverte). La CI valide `npm test`, `npm run typecheck` et `npm run build`.
- Les soldes pré- et post-transaction sont agrégés par wallet + mint.
- Les nouveaux comptes de tokens et les comptes fermés sont pris en compte grâce à l'union des soldes avant/après.
- Les calculs de variation utilisent `BigInt` sur les montants bruts, sans calculer la différence à partir de `uiAmount`.
- Le résultat expose `tokenAmountRaw` et `tokenDecimals` pour conserver le montant exact. `amountIn` / `amountOut` restent des nombres en unités lisibles pour compatibilité.
- Les instructions de haut niveau et internes sont normalisées pour retrouver les program IDs, y compris les index de programmes des transactions versionnées.
- Les mints WSOL et USDC sont ignorés comme actifs de cotation dans cette première heuristique.
- Si plusieurs tokens non-quote changent pour le wallet, le décodeur renvoie `null` plutôt que de choisir arbitrairement un mint.

### Limites à traiter avant tout copy-trading réel
- Le décodeur générique ne sait pas toujours identifier le token principal d'un swap multi-actifs ; les transactions ambiguës sont volontairement écartées.
- La liste des program IDs DEX doit être vérifiée auprès des sources officielles.
- Tests unitaires ajoutés dans `src/decoder/decoder.test.ts` : achat, vente totale, agrégation de plusieurs comptes, mouvements WSOL, ambiguïté, précision brute, wallet non surveillé et timestamp. Les 8 tests passent dans GitHub Actions.
- Valider les résultats contre des transactions réelles avant de les utiliser pour prendre une décision.
- `amountIn` / `amountOut` désignent actuellement la quantité du token suivi, pas la quantité de SOL ou de stablecoin dépensée/reçue.

## Roadmap
- Module 2 : fiabiliser et tester le décodeur, puis identifier précisément les swaps par DEX.
- Module 3 : filtres de sécurité (mint/freeze authority, liquidité, top holders, scoring).
- Module 4 : shadow bot (historique, PnL virtuel, TP/SL).
- Module 5 : exécution (swap, frais prioritaires, slippage, limites et kill-switch).

## Consignes de travail
- Une étape à la fois, expliquer le but avant les modifications.
- Une commande à la fois ; attendre le résultat avant de poursuivre.
- Ne jamais activer d'exécution réelle sans tests et sécurités validés.
