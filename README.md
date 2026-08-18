# Inventaire Discord des coffres

Dashboard statique pour centraliser les dépôts et retraits envoyés par des webhooks Discord. GitHub Pages sert le frontend Vite; Supabase fournit PostgreSQL, Auth, l’Edge Function de synchronisation et le Cron. Aucun bot Gateway ni serveur permanent n’est nécessaire.

La vue par coffre affiche sa capacité maximale, le poids connu, l’espace restant et le poids de chaque ligne d’inventaire. Le catalogue **Poids des items** permet aux administrateurs de renseigner manuellement le poids en kilogrammes par unité; les items inconnus restent explicitement en attente et les totaux concernés sont marqués comme partiels. `Argent` et `Argent Sale` sont affichés comme des montants monétaires séparés et ne comptent jamais comme des items ou du poids.

## Architecture

```text
Webhooks Discord -> salon Discord -> API REST Discord
                                      |
Supabase Cron (15 min) ------------> Edge Function discord-sync
                                      |
                                      v
                              PostgreSQL + RLS
                                      ^
                                      |
GitHub Pages (Vite) -> Supabase Auth + API publique protégée
```

La fonction récupère l’historique complet lors du premier passage, puis utilise le dernier Snowflake Discord traité avec `after`. Les insertions passent par une fonction SQL atomique. Une clé d’événement `UNIQUE`, composée de l’ID du message et de l’index de l’embed, permet d’enregistrer plusieurs mouvements contenus dans un même message sans doublon.

## 1. Créer Supabase

1. Créer un projet dans Supabase.
2. Ouvrir **Authentication > Providers > Email** et activer Email/Password.
3. Désactiver les inscriptions publiques si les comptes sont créés uniquement par un administrateur.
4. Noter l’URL du projet et la clé publique `anon` pour le frontend.

## 2. Appliquer la migration

```powershell
npx supabase login
npx supabase link --project-ref VOTRE_PROJECT_REF
npx supabase db push
```

La migration [202608170001_initial_schema.sql](supabase/migrations/202608170001_initial_schema.sql) crée les tables, vues, index, contraintes, RPC et politiques RLS.

Pour tester la migration sur une pile Supabase locale Docker :

```powershell
npx supabase start
npx supabase db reset
npx supabase test db
```

## 3. Configurer les secrets Edge

Créer un fichier local non commité, puis enregistrer les secrets :

```powershell
npx supabase secrets set --env-file .env.supabase
npx supabase functions deploy discord-sync --no-verify-jwt
```

Le fichier doit fournir les variables listées dans la section **Variables**. `ALLOWED_ORIGINS` accepte une liste séparée par des virgules contenant l’URL GitHub Pages exacte et, si nécessaire, `http://localhost:5173`. L’option `--no-verify-jwt` permet au même endpoint d’accepter soit une session admin validée explicitement, soit le secret interne du Cron.

## 4. Configurer Supabase Cron

Dans **SQL Editor**, enregistrer les deux valeurs dans Vault avec les noms indiqués :

```sql
select vault.create_secret('URL_DU_PROJET', 'SUPABASE_PROJECT_URL');
select vault.create_secret('SECRET_CRON_ALEATOIRE', 'CRON_SECRET');
```

Exécuter ensuite [setup.sql](supabase/cron/setup.sql). Le job appelle exactement la même Edge Function toutes les 15 minutes que le bouton **Actualiser maintenant**.

## 5. Créer l’application Discord

1. Dans le Discord Developer Portal, créer une application puis un bot.
2. Activer **Message Content Intent**.
3. Générer une URL OAuth2 avec le scope `bot`.
4. Accorder uniquement **View Channel** et **Read Message History**.
5. Inviter le bot sur le serveur et vérifier son accès aux salons suivis.
6. Enregistrer son token dans les secrets Supabase.

Le bot n’est jamais connecté au Gateway. Son token sert uniquement aux appels REST `GET /channels/{channel_id}/messages`.

## 6. Autoriser les utilisateurs

Créer les comptes dans **Authentication > Users**, puis renseigner l’allow-list avec les mêmes adresses en minuscules :

```sql
insert into public.app_users (email, role)
values
  ('admin@example.com', 'admin'),
  ('viewer@example.com', 'viewer');
```

Les rôles disponibles sont `viewer` et `admin`. Les utilisateurs autorisés consultent les données; seuls les administrateurs synchronisent, relancent l’historique, modifient les coffres/salons et créent des ajustements.

Ajouter au moins un salon depuis **Administration > Salons Discord**. Au premier passage, l’historique est paginé par lots de 100. Les webhooks inconnus créent automatiquement leur association de coffre.

## 7. Déployer GitHub Pages

1. Pousser le dépôt sur GitHub.
2. Dans **Settings > Secrets and variables > Actions > Variables**, créer les deux variables frontend publiques.
3. Dans **Settings > Pages**, choisir **GitHub Actions** comme source.
4. Pousser sur `main` ou `master`.

Le workflow [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) exécute les tests, construit Vite avec un chemin de base correspondant au dépôt, vérifie l’absence d’identifiants de secrets serveur et publie `dist`.

## 8. Développement local

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Ouvrir `http://localhost:5173`. Pour tester l’Edge Function localement :

```powershell
npx supabase functions serve discord-sync --env-file .env.supabase --no-verify-jwt
```

## Tests et build

```powershell
npm test
npm run test:edge
npm run build
```

Les tests couvrent le parsing accentué, les messages invalides, les calculs de stock, les ajustements, la pagination historique supérieure à 100 messages et la synchronisation incrémentale. Le test SQL vérifie la déduplication et les vues de stock sur une base Supabase locale.

## Import historique administratif

Le bouton **Relancer l’import historique** reparcourt tous les messages sans modifier les transactions existantes. La clé d’événement unique transforme les mouvements déjà connus en doublons ignorés. Pour remettre uniquement le curseur d’un salon à zéro :

```sql
select public.reset_channel_history('DISCORD_CHANNEL_ID');
```

## Variables

Frontend public (`.env`, GitHub Actions Variables) :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BASE_PATH`

Secrets personnalisés Supabase Edge Function :

- `DISCORD_BOT_TOKEN`
- `CRON_SECRET`
- `ALLOWED_ORIGINS`

Variables fournies automatiquement par Supabase :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Secrets Supabase Vault utilisés par Cron :

- `SUPABASE_PROJECT_URL`
- `CRON_SECRET`

Ne jamais placer le token Discord, la clé service-role ou le secret Cron dans une variable préfixée par `VITE_`.
