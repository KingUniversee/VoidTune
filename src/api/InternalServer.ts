import http from 'http';
import fs from 'fs';
import path from 'path';
import { Container } from '../app/Container';
import { MusicService } from '../services/MusicService';
import { MusicManager } from '../music/MusicManager';
import { Logger } from 'pino';
import { lavalinkGatekeeper } from '../utils/lavalinkGatekeeper';

export class InternalServer {
  private server: http.Server | null = null;
  private readonly container: Container;
  private readonly logger: Logger;
  private readonly port: number;

  constructor(container: Container) {
    this.container = container;
    this.logger = container.logger.child({ module: 'InternalServer' });
    this.port = container.config.API_PORT || 3000;
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/status')) {
          const client = this.container.client;
          const musicManager = this.container.getService<MusicManager>('musicManager');
          const nodes = Array.from(musicManager.shoukaku.nodes.values()).map((n) => ({
            name: n.name,
            state: n.state,
          }));

          res.writeHead(200);
          res.end(
            JSON.stringify({
              status: 'ok',
              bot: client.user?.tag,
              botId: client.user?.id,
              guilds: client.guilds.cache.size,
              uptime: client.uptime,
              nodes,
            })
          );
          return;
        }

        if (req.method === 'GET' && url.pathname === '/logs') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.writeHead(200);
          res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VoidTune v2.0 - Live Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #090d16; color: #e2e8f0; font-family: 'JetBrains Mono', monospace; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
    header { background: #0f172a; border-bottom: 1px solid #1e293b; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .brand { display: flex; align-items: center; gap: 10px; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 1.1rem; color: #fff; }
    .pulse-dot { width: 10px; height: 10px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981; animation: pulse 1.8s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } }
    .controls { display: flex; align-items: center; gap: 10px; }
    input[type="text"] { background: #1e293b; border: 1px solid #334155; color: #f8fafc; padding: 6px 12px; border-radius: 6px; font-family: inherit; font-size: 0.85rem; outline: none; width: 220px; }
    input[type="text"]:focus { border-color: #38bdf8; }
    .btn { background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 0.8rem; transition: all 0.15s; }
    .btn:hover { background: #334155; color: #fff; }
    .btn.active { background: #0284c7; border-color: #38bdf8; color: #fff; }
    #player-bar { background: #0d1322; border-bottom: 1px solid #1e293b; padding: 8px 20px; font-size: 0.82rem; display: flex; align-items: center; justify-content: space-between; color: #94a3b8; }
    #player-bar b { color: #38bdf8; }
    #log-container { flex: 1; overflow-y: auto; padding: 14px 20px; font-size: 0.83rem; line-height: 1.6; background: #070a10; }
    .log-line { white-space: pre-wrap; word-break: break-all; padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.02); }
    .log-time { color: #64748b; margin-right: 8px; }
    .badge { padding: 1px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 600; margin-right: 8px; }
    .badge-info { background: #0369a1; color: #e0f2fe; }
    .badge-warn { background: #b45309; color: #fef3c7; }
    .badge-err { background: #be123c; color: #ffe4e6; }
    .badge-play { background: #047857; color: #d1fae5; }
    .log-msg { color: #cbd5e1; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="pulse-dot"></div>
      VoidTune v2.0 &mdash; Live Console
    </div>
    <div class="controls">
      <input type="text" id="search" placeholder="Filter logs... (e.g. play, spotify)">
      <button class="btn active" id="btn-autoscroll" onclick="toggleAutoScroll()">Auto-scroll: ON</button>
      <button class="btn" onclick="clearLogs()">Clear</button>
    </div>
  </header>
  <div id="player-bar">
    <div id="player-info">Loading active player status...</div>
    <div id="status-counts">Logs: <span id="log-count">0</span></div>
  </div>
  <div id="log-container"></div>

  <script>
    let autoScroll = true;
    let knownLogLines = [];
    const container = document.getElementById('log-container');
    const searchInput = document.getElementById('search');

    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      const btn = document.getElementById('btn-autoscroll');
      btn.className = 'btn' + (autoScroll ? ' active' : '');
      btn.innerText = 'Auto-scroll: ' + (autoScroll ? 'ON' : 'OFF');
      if (autoScroll) scrollToBottom();
    }

    function scrollToBottom() { container.scrollTop = container.scrollHeight; }
    function clearLogs() { container.innerHTML = ''; knownLogLines = []; document.getElementById('log-count').innerText = '0'; }

    function renderLine(raw) {
      let timeStr = '';
      let badge = '<span class="badge badge-info">LOG</span>';
      let msg = raw;
      try {
        const parts = raw.split(': {');
        if (parts.length > 1) {
          timeStr = parts[0];
          const jsonStr = '{' + parts.slice(1).join(': {');
          const obj = JSON.parse(jsonStr);
          const lvl = obj.level || 30;
          if (lvl >= 50) badge = '<span class="badge badge-err">ERROR</span>';
          else if (lvl >= 40) badge = '<span class="badge badge-warn">WARN</span>';
          else if (obj.command || obj.spotifyTrack || obj.resolved) badge = '<span class="badge badge-play">MUSIC</span>';
          else badge = '<span class="badge badge-info">' + (obj.module || 'SYS') + '</span>';

          const extras = [];
          if (obj.command) extras.push('/' + obj.command);
          if (obj.spotifyTrack) extras.push('Track: "' + obj.spotifyTrack + '"');
          if (obj.resolved) extras.push('Stream: "' + obj.resolved + '"');
          if (obj.author) extras.push('Artist: ' + obj.author);
          if (obj.score) extras.push('Score: ' + obj.score);
          if (obj.node) extras.push('Node: ' + obj.node);
          if (obj.query) extras.push('Query: "' + obj.query + '"');
          if (obj.reason) extras.push('Reason: ' + obj.reason);
          msg = (obj.msg || '') + (extras.length ? ' | ' + extras.join(' | ') : '');
        }
      } catch (e) { msg = raw; }

      const query = searchInput.value.trim().toLowerCase();
      if (query && !raw.toLowerCase().includes(query)) return null;

      const div = document.createElement('div');
      div.className = 'log-line';
      div.innerHTML = '<span class="log-time">' + escapeHtml(timeStr) + '</span>' + badge + '<span class="log-msg">' + escapeHtml(msg) + '</span>';
      return div;
    }

    function escapeHtml(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function refreshView() {
      container.innerHTML = '';
      for (const line of knownLogLines) {
        const el = renderLine(line);
        if (el) container.appendChild(el);
      }
      document.getElementById('log-count').innerText = knownLogLines.length;
      if (autoScroll) scrollToBottom();
    }

    searchInput.addEventListener('input', refreshView);

    async function fetchLogs() {
      try {
        const res = await fetch('/api/logs?lines=150');
        const data = await res.json();
        if (data && data.lines) {
          if (data.lines.length !== knownLogLines.length || data.lines[data.lines.length - 1] !== knownLogLines[knownLogLines.length - 1]) {
            knownLogLines = data.lines;
            refreshView();
          }
        }
      } catch (err) {}
    }

    async function fetchPlayer() {
      try {
        const res = await fetch('/api/player?guildId=1544275485096284213');
        if (res.ok) {
          const data = await res.json();
          if (data.status && data.status.currentTrack) {
            const track = data.status.currentTrack;
            const posSec = Math.floor((data.position || 0) / 1000);
            const durSec = Math.floor((track.duration || 0) / 1000);
            document.getElementById('player-info').innerHTML =
              '▶ Playing: <b>' + escapeHtml(track.title) + '</b> (' + escapeHtml(track.author) + ') &bull; ' +
              '[' + formatTime(posSec) + ' / ' + formatTime(durSec) + '] &bull; ' +
              'Vol: ' + data.status.volume + '% &bull; State: <span style="color:#10b981;font-weight:700;">' + data.status.state + '</span>';
            return;
          }
        }
        document.getElementById('player-info').innerHTML = 'Player: Idle / No active track';
      } catch (err) {
        document.getElementById('player-info').innerHTML = 'Player: Idle';
      }
    }

    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    fetchLogs();
    fetchPlayer();
    setInterval(fetchLogs, 1200);
    setInterval(fetchPlayer, 2000);
  </script>
</body>
</html>`);
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/logs') {
          const linesCount = parseInt(url.searchParams.get('lines') || '100', 10);
          const logPath = path.join(process.cwd(), 'logs', 'voidtune-out-0.log');
          try {
            if (fs.existsSync(logPath)) {
              const content = fs.readFileSync(logPath, 'utf8');
              const allLines = content.split('\n').filter(Boolean);
              const tail = allLines.slice(-linesCount);
              res.writeHead(200);
              res.end(JSON.stringify({ success: true, total: allLines.length, lines: tail }));
              return;
            }
          } catch (e: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, lines: [] }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/test-resolve') {
          const q = url.searchParams.get('q') || 'scsearch:Ajeeb Dastan Hai Yeh Lata Mangeshkar';
          const musicManager = this.container.getService<MusicManager>('musicManager');
          const results: any = {};
          for (const [name, node] of musicManager.shoukaku.nodes) {
            if (node.state !== 1) continue;
            try {
              const res = await lavalinkGatekeeper.resolve(node, q, 6000);
              results[name] = {
                loadType: (res as any)?.loadType,
                count: Array.isArray((res as any)?.data) ? (res as any).data.length : ((res as any)?.data?.tracks?.length || 0),
                first: Array.isArray((res as any)?.data) ? (res as any).data[0]?.info : (res as any)?.data?.tracks?.[0]?.info
              };
            } catch (err: any) {
              results[name] = { error: err.message };
            }
          }
          res.writeHead(200);
          res.end(JSON.stringify(results));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/test-autoplay') {
          const guildId = url.searchParams.get('guildId') || '1544275485096284213';
          const musicService = this.container.getService<MusicService>('musicService');
          let player = musicService.getPlayer(guildId);
          if (!player) {
            player = await musicService.join(guildId, '1550543891579666543', '1550543866178965564');
          }
          const rec = await player.fetchAutoplayRecommendation();
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, recommendation: rec }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/guild-info') {
          const client = this.container.client;
          const guilds = client.guilds.cache.map((g) => ({
            id: g.id,
            name: g.name,
            voiceChannels: g.channels.cache
              .filter((c) => c.isVoiceBased())
              .map((vc) => ({
                id: vc.id,
                name: vc.name,
                members: (vc as any).members?.map((m: any) => ({
                  id: m.id,
                  tag: m.user.tag,
                  mute: m.voice?.mute,
                  deaf: m.voice?.deaf,
                  selfMute: m.voice?.selfMute,
                  selfDeaf: m.voice?.selfDeaf,
                  serverMute: m.voice?.serverMute,
                  serverDeaf: m.voice?.serverDeaf,
                })),
              })),
            textChannels: g.channels.cache
              .filter((c) => c.isTextBased() && 'send' in c)
              .map((tc) => ({ id: tc.id, name: tc.name })),
          }));
          res.writeHead(200);
          res.end(JSON.stringify(guilds));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/player') {
          const guildId = url.searchParams.get('guildId') || '';
          const musicService = this.container.getService<MusicService>('musicService');
          const player = musicService.getPlayer(guildId);
          if (!player) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'No player found for guild' }));
            return;
          }
          const status = player.getStatus();
          res.writeHead(200);
          res.end(JSON.stringify({ status, position: player.position, isPlaying: player.isPlaying }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/user-voice') {
          const userId = url.searchParams.get('userId') || '';
          const client = this.container.client;
          let foundInfo: any = null;
          for (const guild of client.guilds.cache.values()) {
            const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
            if (member && member.voice?.channelId) {
              const defaultText = guild.channels.cache.find((c) => c.isTextBased() && 'send' in c)?.id || '';
              foundInfo = {
                found: true,
                guildId: guild.id,
                guildName: guild.name,
                voiceChannelId: member.voice.channelId,
                voiceChannelName: member.voice.channel?.name,
                textChannelId: defaultText,
              };
              break;
            }
          }
          res.writeHead(200);
          res.end(JSON.stringify(foundInfo || { found: false }));
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/play') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              const { guildId, voiceChannelId, textChannelId, query, requesterId, autoplay } = data;
              const musicService = this.container.getService<MusicService>('musicService');
              const result = await musicService.play({
                guildId,
                voiceChannelId,
                textChannelId,
                query,
                requesterId: requesterId || this.container.client.user?.id || 'admin',
              });

              const player = musicService.getPlayer(guildId);
              if (player && typeof autoplay === 'boolean') {
                player.autoplay = autoplay;
              }

              res.writeHead(200);
              res.end(JSON.stringify({ success: true, result, autoplay: player?.autoplay }));
            } catch (err: any) {
              this.logger.error({ err }, 'Internal API play request failed');
              const statusCode = err?.code === 'TRACK_NOT_FOUND' ? 404 : 400;
              res.writeHead(statusCode);
              res.end(JSON.stringify({ success: false, error: err.userMessage || err.message }));
            }
          });
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/skip') {
          const guildId = url.searchParams.get('guildId') || '';
          const musicService = this.container.getService<MusicService>('musicService');
          try {
            const skipped = await musicService.skip(guildId);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, skipped }));
          } catch (err: any) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/previous') {
          const guildId = url.searchParams.get('guildId') || '';
          const musicService = this.container.getService<MusicService>('musicService');
          try {
            const previous = await musicService.previous(guildId);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, previous }));
          } catch (err: any) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/autoplay') {
          const guildId = url.searchParams.get('guildId') || '';
          const musicService = this.container.getService<MusicService>('musicService');
          const player = musicService.getPlayer(guildId);
          if (player) {
            player.autoplay = !player.autoplay;
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, autoplay: player.autoplay }));
          } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Player not found' }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/stop') {
          const guildId = url.searchParams.get('guildId') || '';
          const musicService = this.container.getService<MusicService>('musicService');
          try {
            await musicService.stop(guildId);
            res.writeHead(200);
            res.end(JSON.stringify({ success: true }));
          } catch (err: any) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        this.logger.info(`🚀 Internal management API listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.logger.info('Internal API server stopped');
    }
  }
}
