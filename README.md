# Discord Voice Terminal (dv-tui)

Terminal ASCII pour connecter un **bot Discord officiel** a un salon vocal et y diffuser
votre **micro** ou du **texte converti en parole** (TTS).

- Interface 100 % ASCII : pas d'emoji, pas de caracteres Unicode de dessin, pas d'animation, monochrome.
- Pilotage au clavier : on tape une commande ou un numero puis `Enter`.
- Etats lisibles : `CONNECTED`, `DISCONNECTED`, `READY`, `ERROR`, `MUTED`, ...

> **Bot uniquement.** Le programme exige un token de *bot* officiel (il est verifie aupres de Discord).
> Les tokens d'utilisateur et les self-bots ne sont pas supportes (et violent les conditions de Discord).

```
+----------------------------------------------------------+
| DISCORD VOICE TERMINAL                                   |
+==========================================================+
| Bot    : CONNECTED (MonBot)                              |
| Server : Mon serveur                                     |
| Voice  : General [JOINED]                                |
| Mode   : MIC                                             |
| Input  : Default                                         |
| Audio  : STREAMING (MIC)   Volume : 100                  |
+----------------------------------------------------------+
| [1] Connection       [2] Voice channel                   |
| [3] Audio settings   [4] Text to speech                  |
| [5] Webhook          [6] Logs                            |
| [Q] Quit                                                 |
|                                                          |
| Global: start | stop | mute | vol <0-200> | help         |
+----------------------------------------------------------+
| Status : READY | MIC streaming                           |
+----------------------------------------------------------+
```

## Prerequis

| Element | Detail |
| --- | --- |
| Node.js | **22.12 ou plus recent** (exige par `@discordjs/voice`) |
| FFmpeg | dans le `PATH` (ou variable `FFMPEG_PATH`) - capture micro et conversion audio |
| espeak-ng | uniquement pour le mode TEXT (ou variable `ESPEAK_PATH`) |
| Linux | `pactl` (PulseAudio ou PipeWire-pulse) pour lister les entrees audio |
| Bot Discord | cree dans le Developer Portal, invite avec les permissions **View Channel, Connect, Speak** |

Aucun *intent* privilegie n'est necessaire (le bot utilise `Guilds` et `GuildVoiceStates`).

Installation des outils :

```
# Debian / Ubuntu
sudo apt install ffmpeg espeak-ng
# macOS
brew install ffmpeg espeak-ng
# Windows : installer FFmpeg et espeak-ng, les ajouter au PATH (ou definir FFMPEG_PATH / ESPEAK_PATH)
```

## Installation et lancement

```
git clone https://github.com/ozitoyy001/dv-tui.git
cd dv-tui
npm install
npm start
```

Le chiffrement vocal de bout en bout (DAVE) et l'encodage Opus sont geres par les dependances
(`@discordjs/voice` + `opusscript`, sans compilation native).

## Utilisation rapide

1. `1` (Connection) puis `1` : collez le token du bot (saisie masquee). Il est verifie automatiquement.
2. `4` : connectez le bot. `B` pour revenir.
3. `2` (Voice channel) : choisissez le serveur puis le salon (numero), puis `J` pour rejoindre.
4. Micro : `start`. Texte : ecran `4` (Text to speech), tapez une phrase + `Enter`.
5. `mute`, `stop`, `vol 80`, `Q` pour quitter proprement.

Commandes globales : `start`, `stop`, `mute`, `vol <0-200>`, `help`, `q`.

Le token peut aussi venir de la variable d'environnement `DISCORD_BOT_TOKEN`
(par exemple `node --env-file=.env src/index.js`, voir `.env.example`).

## Donnees et securite

- Config, secrets et journal sont dans `~/.config/discord-voice-terminal/` (Linux/macOS),
  `%APPDATA%\discord-voice-terminal\` (Windows) ou `DVT_CONFIG_DIR`.
  Dossier 0700, fichiers 0600 (POSIX).
- `secrets.json` (token, URL de webhook) est en clair : protegez votre session. Preferez la variable d'environnement si besoin.
- Le journal masque automatiquement tokens et URL de webhook, tourne au-dela de 1 Mo (`dvt.log.1`) et conserve la stack des erreurs inattendues.
- Une config ou un fichier de secrets corrompu est mis de cote (`*.corrupt-<date>`), jamais ecrase.
- Les alertes webhook (connexion, deconnexion, salon rejoint/quitte, code d'erreur) ne contiennent jamais token, audio, texte saisi ni noms.
- Le programme n'enregistre, ne transcrit ni ne retransmet aucune conversation ; le texte saisi n'est jamais journalise.
- Arret propre sur `Q`, `Ctrl+C`, `SIGTERM`, `SIGHUP` et erreurs fatales (ffmpeg/espeak-ng sont arretes).

## Tests

```
npm test
```

Les tests utilisent le lanceur integre de Node (`node --test`). Les tests TTS reels sont ignores
automatiquement si `espeak-ng` ou `ffmpeg` sont absents. Verification manuelle recommandee avec un vrai bot :
connexion, jointure d'un salon, micro, TTS, mute, stop, webhook, `Q`.

## Limites connues

- Les entrees audio disponibles dependent du systeme (dshow sous Windows, avfoundation sous macOS, PulseAudio sous Linux).
- Les voix TTS dependent d'espeak-ng.
- Un seul salon vocal a la fois.

## Journal des corrections

Voir `AUDIT-LOG.md` (corrections de l'audit, etape par etape).

## Licence

MIT
