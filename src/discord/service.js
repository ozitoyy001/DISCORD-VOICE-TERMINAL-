'use strict';
const EventEmitter = require('events');
const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { AppError } = require('../util/errors');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];

class DiscordService extends EventEmitter {
  constructor(log) {
    super();
    this.log = log;
    this.client = null;
    this.state = 'DISCONNECTED';
    this.user = null;
    this.connection = null;
    this.player = null;
    this.guildId = null;
    this.channelId = null;
  }

  // Branche le lecteur audio (AudioEngine.player) sur la connexion vocale.
  // Sans cet appel, rien n'est jamais transmis au salon (bug critique de la v1.0).
  setPlayer(player) {
    this.player = player;
    if (this.connection && player) this.connection.subscribe(player);
  }

  _set(next) {
    const prev = this.state;
    this.state = next;
    if (prev !== next) this.emit('state', next, prev);
    this.emit('change');
  }

  async validateToken(token) {
    let res;
    try {
      res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: 'Bot ' + token },
        signal: AbortSignal.timeout(8000)
      });
    } catch (_) {
      throw new AppError('network error: cannot reach Discord');
    }
    if (res.status === 401) throw new AppError('token rejected by Discord (invalid or reset)');
    if (!res.ok) throw new AppError('Discord API error HTTP ' + res.status);
    let u;
    try { u = await res.json(); } catch (_) { throw new AppError('unexpected response from Discord'); }
    if (!u || !u.bot) throw new AppError('this token does not belong to a bot');
    return { id: u.id, name: u.username };
  }

  async connect(token) {
    await this.disconnect();
    this._set('CONNECTING');
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    client.on('error', (e) => this.log.error('gateway: ' + e.message));
    client.on('shardDisconnect', () => {
      if (this.client === client && this.state === 'CONNECTED') this._set('DISCONNECTED');
    });
    // shardResume = reprise de session ; shardReady = nouvelle session (reconnexion complete).
    // Sans shardReady, l'etat restait bloque sur DISCONNECTED alors que le bot refonctionnait.
    const back = () => { if (this.client === client && client.isReady()) this._set('CONNECTED'); };
    client.on('shardResume', back);
    client.on('shardReady', back);
    client.on('guildCreate', () => this.emit('change'));
    client.on('guildDelete', () => this.emit('change'));
    this.client = client;
    try {
      await client.login(token);
      for (let i = 0; i < 150 && !client.isReady(); i++) await sleep(100);
      if (!client.isReady()) throw new AppError('no READY from Discord (timeout)', true);
    } catch (e) {
      this.client = null;
      try { await client.destroy(); } catch (_) {}
      this._set('ERROR');
      if (e instanceof AppError) throw e;
      if (e && e.code === 'TokenInvalid') throw new AppError('token rejected by Discord', true);
      throw new AppError('login failed: ' + e.message, true);
    }
    this.user = client.user.username;
    this._set('CONNECTED');
  }

  async disconnect() {
    this.leave();
    const c = this.client;
    this.client = null;
    this.user = null;
    if (c) { try { await c.destroy(); } catch (_) {} }
    this._set('DISCONNECTED');
  }

  guilds() {
    if (!this.client) return [];
    return [...this.client.guilds.cache.values()]
      .map((g) => ({ id: g.id, name: g.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  voiceChannels(guildId) {
    const g = this.client && guildId ? this.client.guilds.cache.get(guildId) : null;
    if (!g) return [];
    const me = g.members.me;
    return [...g.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildVoice)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => {
        const p = me ? c.permissionsFor(me) : null;
        return { id: c.id, name: c.name, canJoin: !!p && p.has(NEEDED) };
      });
  }

  guildName(id) {
    const g = this.client && id ? this.client.guilds.cache.get(id) : null;
    return g ? g.name : null;
  }

  channelName(gid, cid) {
    const g = this.client && gid ? this.client.guilds.cache.get(gid) : null;
    const c = g && cid ? g.channels.cache.get(cid) : null;
    return c ? c.name : null;
  }

  async join(guildId, channelId) {
    if (!this.client || !this.client.isReady()) throw new AppError('bot is not connected');
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) throw new AppError('server not found (bot removed from it?)');
    const ch = guild.channels.cache.get(channelId);
    if (!ch || ch.type !== ChannelType.GuildVoice) throw new AppError('voice channel not found');
    const me = guild.members.me || await guild.members.fetchMe();
    const perms = ch.permissionsFor(me);
    if (!perms || !perms.has(NEEDED)) throw new AppError('missing permission: View Channel, Connect, Speak', true);
    if (ch.full && !perms.has(PermissionFlagsBits.MoveMembers)) throw new AppError('voice channel is full', true);

    this.leave();
    const connection = joinVoiceChannel({
      channelId, guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    this.connection = connection;
    this.guildId = guildId;
    this.channelId = channelId;

    connection.on('error', (e) => this.log.error('voice: ' + e.message));
    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch (_) {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      }
    });
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (this.connection === connection) {
        this.connection = null;
        this.emit('left');
        this.emit('change');
      }
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    } catch (_) {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      throw new AppError('voice join timeout (check permissions, DAVE and encryption dependencies)', true);
    }
    if (this.player) connection.subscribe(this.player);
    this.emit('joined');
    this.emit('change');
  }

  leave() {
    const c = this.connection;
    if (!c) return false;
    if (c.state.status !== VoiceConnectionStatus.Destroyed) c.destroy();
    return true;
  }
}

module.exports = { DiscordService };
