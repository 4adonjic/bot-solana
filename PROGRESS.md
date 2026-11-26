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
- `src/brain/security.ts` : scoring de sécurité.
- `src/brain/security-onchain.ts` : lecture des autorités mint/freeze.
- `src/brain/holder-stats.ts` : calcul et récupération RPC des métriques de détenteurs.
- `src/brain/liquidity.ts` : collecte de liquidité USD via DEX Screener.
- `src/shadow/`, `src/executor/` : étapes futures.

## Règle TypeScript NodeNext
Les imports relatifs doivent finir par `.js`, même si les fichiers source sont en `.ts`.

## Module 1 – Radar WebSocket
- Fusionné dans `main` via la PR #1.
- `RPC_WS_URL` est transmis à `Connection`.
- Chaque wallet cible reçoit un abonnement `onLogs`.
- Nettoyage des abonnements à l'arrêt et backoff exponentiel pour les échecs de création.
- GitHub Actions a validé `npm ci`, `npm run typecheck` et `npm run build`.
- À tester encore avec une vraie connexion RPC et un wallet qui effectue une transaction. La reconnexion en cas de coupure réseau n'a pas encore été validée en conditions réelles.

## Module 2 – Décodeur
- Fusionné dans `main` via la PR #2.
- Les soldes pré- et post-transaction sont agrégés par wallet + mint, y compris les comptes créés ou fermés.
- Les variations utilisent `BigInt` sur les montants bruts ; le résultat expose `tokenAmountRaw` et `tokenDecimals`.
- Les instructions de haut niveau et internes sont normalisées, y compris pour les transactions versionnées.
- Les mints WSOL et USDC sont ignorés comme actifs de cotation dans cette première heuristique.
- 8 tests unitaires passent. Les vérifications CI `npm test`, `npm run typecheck` et `npm run build` ont réussi.
- Limites : les swaps multi-actifs ambigus sont écartés ; les program IDs DEX doivent être revérifiés ; les résultats doivent être comparés à des transactions réelles avant toute utilisation. `amountIn` / `amountOut` représentent actuellement la quantité du token suivi, pas la quantité de SOL/stablecoin dépensée ou reçue.

## Module 3 – Sécurité des tokens
- Scoring heuristique sur 100 : autorités mint/freeze, liquidité, concentration des 10 plus gros détenteurs, nombre de détenteurs.
- Décisions `allow`, `review`, `reject`. Les données manquantes ou invalides imposent au minimum une revue.
- Les autorités mint/freeze sont récupérées par RPC dans `security-onchain.ts` (PR #4 fusionnée).
- Les statistiques de détenteurs sont récupérées dans `holder-stats.ts` : agrégation par propriétaire et part cumulée des 10 plus gros (PR #5 fusionnée).
- Nouvelle étape : `liquidity.ts` interroge l'API DEX Screener, conserve la plus grosse liquidité de pool Solana associée au mint et ne somme pas plusieurs pools.
- Tests ajoutés avec réponses API simulées ; une erreur API ou une donnée absente provoque une erreur, jamais une valeur zéro interprétée comme valide.
- Limites : la liquidité affichée par un agrégateur reste indicative et peut évoluer rapidement. La collecte n'est pas encore branchée automatiquement au radar ni au scoring. Les coffres de pools peuvent fausser les statistiques de détenteurs. Aucun achat réel n'est activé.

## Roadmap restante
- Module 3 : vérifier fraîcheur et fiabilité des métriques, exclure/étiqueter les coffres de pools, puis brancher les collecteurs au scoring de façon contrôlée.
- Module 4 : shadow bot (historique, PnL virtuel, TP/SL).
- Module 5 : exécution (swap, frais prioritaires, slippage, limites et kill-switch).

## Consignes de travail
- Une étape à la fois, expliquer le but avant les modifications.
- Une commande à la fois ; attendre le résultat avant de poursuivre.
- Ne jamais activer d'exécution réelle sans tests et sécurités validés.
