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
- `src/brain/security-pipeline.ts` : orchestration des contrôles de sécurité.
- `src/brain/security-cache.ts` : cache temporaire et mutualisation des analyses par mint.
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
- Les tests du décodeur ont été validés en CI lors de la PR #2.
- Limites : les swaps multi-actifs ambigus sont écartés ; les program IDs DEX doivent être revérifiés ; les résultats doivent être comparés à des transactions réelles avant toute utilisation. `amountIn` / `amountOut` représentent actuellement la quantité du token suivi, pas la quantité de SOL/stablecoin dépensée ou reçue.

## Module 3 – Sécurité des tokens
- Scoring heuristique sur 100 : autorités mint/freeze, liquidité, concentration des 10 plus gros détenteurs, nombre de détenteurs.
- Décisions `allow`, `review`, `reject`. Les données manquantes ou invalides imposent au minimum une revue.
- Les autorités mint/freeze sont récupérées par RPC dans `security-onchain.ts` (PR #4 fusionnée).
- Les statistiques de détenteurs sont récupérées dans `holder-stats.ts` : agrégation par propriétaire et part cumulée des 10 plus gros (PR #5 fusionnée).
- `liquidity.ts` interroge l'API DEX Screener et conserve la plus grosse liquidité d'un pool Solana associé au mint (PR #6 fusionnée).
- `security-pipeline.ts` rassemble les trois sources et journalise le résultat après le décodage (PR #7 fusionnée).
- La PR #8 ajoute un cache par mint de 60 secondes, partage les analyses simultanées du même mint et limite le cache à 500 entrées. Les analyses en erreur ne sont pas conservées.
- Tests unitaires présents pour les calculs, les collecteurs et le cache.
- Limites : les coffres de pools peuvent fausser les statistiques de détenteurs ; la liquidité DEX Screener reste indicative ; une première analyse d'un nouveau mint déclenche toujours les appels RPC/API. Le cache ne remplace pas une limitation globale du débit RPC. Aucun achat réel n'est activé.

## Roadmap restante
- Module 3 : limiter la concurrence globale, améliorer l'identification des coffres de pools et valider les métriques sur des mints/transactions réels.
- Module 4 : shadow bot (historique, PnL virtuel, TP/SL).
- Module 5 : exécution (swap, frais prioritaires, slippage, limites et kill-switch).

## Consignes de travail
- Une étape à la fois, expliquer le but avant les modifications.
- Une commande à la fois ; attendre le résultat avant de poursuivre.
- Ne jamais activer d'exécution réelle sans tests et sécurités validés.
