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
- `src/radar/radar.ts` : surveillance WebSocket des wallets configurés.
- `src/radar/dex-radar.ts` : flux WebSocket optionnel des programmes DEX connus.
- `src/decoder/` : récupération et décodage des transactions.
- `src/brain/security.ts` : scoring de sécurité.
- `src/brain/security-onchain.ts` : lecture des autorités mint/freeze.
- `src/brain/holder-stats.ts` : calcul et récupération RPC des métriques de détenteurs.
- `src/brain/liquidity.ts` : collecte de liquidité USD via DEX Screener.
- `src/brain/security-pipeline.ts` : orchestration des contrôles de sécurité.
- `src/brain/security-cache.ts` : cache temporaire et mutualisation des analyses par mint.
- `src/brain/concurrency-limit.ts` : limiteur de concurrence avec file d'attente bornée.
- `src/brain/wallet-candidate-store.ts` : registre persistant des wallets candidats, observations dédupliquées et bornées.
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

## Module 2 – Décodeur et découverte
- Fusionné dans `main` via les PR #2 et #11.
- Les soldes pré- et post-transaction sont agrégés par wallet + mint, y compris les comptes créés ou fermés.
- Les variations utilisent `BigInt` sur les montants bruts ; le résultat expose `tokenAmountRaw` et `tokenDecimals`.
- Les montants de cotation WSOL/USDC sont extraits des variations de soldes, avec montant brut et décimales.
- Si aucun token de cotation ne bouge, le changement de solde SOL du wallet est utilisé en estimation après correction des frais de transaction. Le loyer/rent et les transferts SOL annexes peuvent encore fausser cette estimation.
- Les montants de cotation dont le sens contredit l'achat/vente du token sont ignorés.
- Les instructions de haut niveau et internes sont normalisées, y compris pour les transactions versionnées.
- Les transactions ambiguës avec plusieurs tokens non-quote modifiés sont écartées.
- Le flux DEX optionnel (PR #12) repère les wallets inconnus qui présentent des variations de soldes dans des transactions touchant les programmes surveillés.
- Limite : une transaction qui invoque un programme DEX n'est pas forcément un swap ; la classification reste heuristique.

## Module 3 – Sécurité des tokens
- Scoring heuristique sur 100 : autorités mint/freeze, liquidité, concentration des 10 plus gros détenteurs, nombre de détenteurs.
- Décisions `allow`, `review`, `reject`. Les données manquantes ou invalides imposent au minimum une revue.
- Les autorités mint/freeze sont récupérées par RPC dans `security-onchain.ts` (PR #4 fusionnée).
- Les statistiques de détenteurs sont récupérées dans `holder-stats.ts` : agrégation par propriétaire et part cumulée des 10 plus gros (PR #5 fusionnée).
- `liquidity.ts` interroge l'API DEX Screener et conserve la plus grosse liquidité d'un pool Solana associé au mint (PR #6 fusionnée).
- `security-pipeline.ts` rassemble les trois sources et journalise le résultat après le décodage (PR #7 fusionnée).
- `security-cache.ts` met en cache les analyses par mint pendant 60 secondes, mutualise les appels simultanés et conserve au maximum 500 entrées (PR #8 fusionnée).
- Les PR #9 et #10 limitent la concurrence et mutualisent les analyses identiques.
- Tests unitaires présents pour les calculs, les collecteurs, le cache et le limiteur de concurrence.
- Limites : les coffres de pools peuvent fausser les statistiques de détenteurs ; la liquidité DEX Screener reste indicative ; aucune exécution réelle n'est activée.

## Module 3 bis – Registre des wallets candidats
- La PR #13 ajoute un registre JSON local dans `data/wallet-candidates.json`, chargé au démarrage lorsque la découverte DEX est activée.
- Chaque wallet conserve ses dates de première/dernière détection, son nombre d'observations et ses transactions récentes.
- Les observations répétées (même signature + mint pour le même wallet) sont dédupliquées.
- Le nombre de wallets conservés, les observations récentes et les clés de déduplication sont bornés.
- Le dossier `data/` est ignoré par Git : les données de fonctionnement ne sont pas envoyées au dépôt.
- Ce registre ne calcule pas encore de PnL et ne qualifie pas les wallets de rentables.

## Étape suivante – Montants de cotation
- La PR #14 ajoute l'extraction des montants WSOL/USDC et une estimation SOL de secours.
- Les montants bruts sont stockés sans perte de précision ; la source et le caractère estimé sont conservés dans le registre des candidats.
- Cette étape ne calcule pas encore de prix fiable ni de PnL : il faudra confirmer les swaps, les frais, les mouvements de rent et les transactions réelles.

## Roadmap restante
- Valider les extractions sur des transactions réelles et améliorer l'identification des swaps.
- Ajouter un historique de performance fiable : coût d'entrée/sortie en SOL, frais, PnL réalisé/virtuel, drawdown et échantillon minimum.
- Module 4 : shadow bot (historique, PnL virtuel, TP/SL).
- Module 5 : exécution réelle uniquement après tests et sécurités validés, avec limites strictes et kill-switch.

## Consignes de travail
- Une étape à la fois, expliquer le but avant les modifications.
- Une commande à la fois ; attendre le résultat avant de poursuivre.
- Ne jamais committer le fichier `.env`, les clés RPC privées ou les données locales du dossier `data/`.
- Ne jamais activer d'exécution réelle sans tests et sécurités validés.
