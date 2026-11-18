# AUDIT-LOG - journal des corrections (pour reprendre si interruption)

Projet : discord-voice-terminal (Node.js). Original conserve dans /home/claude/audit/original (si dispo).
Regle : chaque etape = modification + verification (node --check / tests) + une ligne ici.

## Liste des etapes
- [x] 1  package.json : engines, script test, lockfile (davey ensuite retire, voir 3b)
- [x] 2  test pad : attendu 'a...' (le code est correct)
- [x] 3  CRITIQUE : brancher audio.player sur DiscordService (setPlayer) + test
- [x] 3b CRITIQUE (decouvert en cours de route) : aucun encodeur Opus -> createAudioResource plante -> ajout opusscript, retrait davey redondant
- [x] 4  shardReady -> etat CONNECTED
- [x] 5  signaux SIGTERM/SIGHUP + uncaughtException/unhandledRejection
- [x] 6  logger : perms 0600, rotation, stack des erreurs inattendues
- [x] 7  config : Object.hasOwn, sauvegarde si JSON corrompu, dossier 0700
- [x] 8  mineurs : disconnect exclusif, webhook 429, VOICE_LEFT attendu au quit, champs declares
- [x] 9  tests supplementaires (config, logger, render, webhook, service)
- [x] 10 README, LICENSE, .gitignore, .env.example
- [x] 11 smoke test (demarrage/quit sans token)
- [x] 12 zip final

## Journal
- 19:58 Setup : journal cree, node_modules/lockfile nettoyes, package.json original restaure.
- 19:58 Etape 1 OK : package.json (davey ^0.2.0 car 0.6.1 n'existe pas, engines >=22.12.0 requis par @discordjs/voice, script test avec glob, lockfile genere). npm install OK, npm audit = 0 vuln.
- 19:58 Etape 2 OK : test pad corrige (attendu 'a...'). 4/4 tests passent.
- 19:59 Etape 3 OK (CRITIQUE) : DiscordService.setPlayer(player) ajoute, appele dans index.js avec audio.player ; abonne aussi une connexion deja ouverte. Tests service.test.js (3) + verif integration avec vrais AudioEngine/DiscordService : 7/7 tests OK.
- 19:59 Etape 4 OK : service.js gere shardReady en plus de shardResume (retour CONNECTED). Verifie avec faux client, test permanent test/service-events.test.js.
- 19:59 Etape 5 OK : src/process-handlers.js (SIGTERM/SIGHUP -> quit(0), uncaughtException -> quit(1), unhandledRejection -> ERROR sans quitter, exit -> audio.kill()). util/errors.js : describe(). app.quit(code). engine.kill(). Branche dans index.js. 14/14 tests. (Test reel avec vrai signal prevu a l'etape 11.)
- 20:00 Etape 6 OK : logger.js reecrit en fabrique createLogger() : fichier 0600, dossier 0700, ancien journal chmod 0600, rotation >1 Mo vers .1, secrets masques. app.report() journalise la stack (une ligne) des erreurs inattendues. test/logger.test.js (5 tests). 19/19 OK.
- 20:00 Etape 7 OK : config.js : merge defensif (Object.hasOwn, controle des types, pas de pollution __proto__), guildId/channelId valides (snowflake), JSON corrompu mis de cote en .corrupt-<date> (config ET secrets) au lieu d'etre ecrase, dossier cree en 0700. test/config.test.js (10 tests). 29/29 OK.
- 20:01 Etape 8 OK : webhook.js (429 : 1 relance si retry_after<=5s, fetch injectable, post exporte) ; app.js (disconnect/deleteToken sous exclusive('connect'), quit() attend VOICE_LEFT+DISCONNECTED avant exit, pas de doublon VOICE_LEFT pendant la fermeture) ; service.js (guildId/channelId declares, reponse Discord invalide => AppError). Tests webhook (7) + app-quit (4). 40/40 OK.
- 20:02 Etape 3b OK (CRITIQUE, nouveau) : l'original n'avait AUCUNE lib Opus (prism-media la charge a la demande) : createAudioResource(Raw) levait 'Cannot find module @discordjs/opus' => `start` et TTS plantaient. Ajout de opusscript ^0.1.1 (pur JS, sans compilation). Retrait de @snazzah/davey du package.json : deja dependance interne de @discordjs/voice (0.1.12), la ligne etait inutile (et 0.6.1 n'existe pas). Reinstall propre, 0 vuln, test reel PCM->Opus : 50 paquets/s OK.
- 20:03 Etape 9 OK : tests ajoutes : render.test.js (largeur 60, ASCII pur), audio.test.js (TTS reel espeak-ng->ffmpeg PCM s16le 48k stereo, binaire absent, options invalides sans injection, moteur reel speak()->STREAMING (TEXT)->IDLE, ffmpeg introuvable => failure, volume/mute, stop() tue le processus). Installation de espeak-ng dans le sandbox pour ces tests (ils sont ignores proprement si espeak-ng/ffmpeg absents). 49/49 OK, 0 skip.
- 20:03 Etape 10 OK : README reecrit (Node 22.12+, ffmpeg, espeak-ng, pactl, commandes reelles, apercu genere par le vrai frame()), LICENSE MIT, .gitignore etendu (config.json, *.corrupt-*, *.log.1...), .env.example (charge via node --env-file). Commandes du README verifiees dans app.js.
- 20:04 Etape 11 OK : test de bout en bout dans un vrai pseudo-terminal (script /tmp/smoke, non livre) : demarrage + cadre 60 colonnes ASCII, 'q' / Ctrl-C / Ctrl-D / '/q' => code 0, SIGTERM et SIGHUP => arret propre code 0 + journalises, saisie du token MASQUEE (jamais a l'ecran ni dans le journal), secrets.json/dvt.log en 0600, messages clairs pour start/vol/TTS sans salon, volume sauvegarde. CORRECTION d'honnetete : un controle (dossier 0700) etait vide dans la 1re version ; refait pour de vrai avec un dossier inexistant cree par l'appli : 0700 OK. Statut reel apres saisie d'un faux token : 'ERROR | network error: cannot reach Discord' (sandbox sans acces a discord.com).

## Ce qui N'A PAS pu etre teste ici (a verifier chez toi avec un vrai bot)
- Connexion reelle a Discord (pas d'acces reseau a discord.com dans le sandbox) : login, liste des serveurs/salons, jointure vocale, envoi audio effectif dans le salon (le branchement player->connexion est verifie par test, pas par ecoute).
- Capture micro reelle (dshow Windows / avfoundation macOS / pulse Linux) : aucune carte son dans le sandbox. Les arguments ffmpeg sont inchanges par rapport a l'original.
- Windows et macOS (tests faits sous Linux, Node 22).
- Webhook reel (seulement teste avec un faux fetch).

## Checklist de test manuel (5 minutes)
1. npm install && npm start
2. 1 > 1 : coller le token ; 4 : connexion => Bot CONNECTED
3. Retour (B), 2 : serveur, salon, J => [JOINED]
4. Ecran 3 : 2 (lister les entrees), i <n> ; B ; 'start' => quelqu'un dans le salon doit ENTENDRE le micro
5. Ecran 4 : taper une phrase => elle doit etre prononcee dans le salon
6. 'mute' / 'vol 50' / 'stop' / Q

## Comment reprendre si l'assistant s'arrete
Toutes les etapes ci-dessus sont cochees. Pour continuer : `npm install && npm test` (49 tests, doivent passer), puis la checklist manuelle. Si un test echoue, lire le message : chaque module (config, logger, webhook, service, audio, app) a son fichier test/*.test.js.
