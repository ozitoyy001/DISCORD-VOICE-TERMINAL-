'use strict';
const config = require('./config');
const logger = require('./logger');
const { DiscordService } = require('./discord/service');
const { AudioEngine } = require('./audio/engine');
const { Notifier } = require('./notify/webhook');
const { App } = require('./ui/app');
const { installProcessHandlers } = require('./process-handlers');

async function main() {
  const cfg = config.loadConfig();
  logger.setFile(config.LOG_FILE);
  const token = config.getToken();
  if (token.value) logger.registerSecret(token.value);
  const webhookUrl = config.getSecret('webhookUrl');
  if (webhookUrl) logger.registerSecret(webhookUrl);

  const log = logger;
  const discord = new DiscordService(log);
  const audio = new AudioEngine(log, cfg);
  discord.setPlayer(audio.player);
  const notifier = new Notifier(
    log,
    () => config.getSecret('webhookUrl'),
    () => cfg.webhook.enabled
  );
  const app = new App({ cfg, discord, audio, notifier, log });
  installProcessHandlers(process, {
    log,
    quit: (code) => app.quit(code),
    soft: (msg) => { app.err(msg); app.draw(); },
    cleanup: () => audio.kill()
  });
  app.start();
}

main().catch((e) => {
  console.error('fatal: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
