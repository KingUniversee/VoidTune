# VoidTune — Distributed Multi-Guild Audio Streaming Platform

VoidTune is an enterprise-grade, modular Discord music bot platform built with **TypeScript**, **Node.js (v20+)**, and **Discord.js v14**. It uses a decoupled streaming architecture that offloads heavy audio transcoding workloads to a containerized **Lavalink v4** audio node via WebSockets, ensuring sub-50ms latency and preventing Node.js event-loop blocking across concurrent voice channels.

---

## 🚀 Key Features

* **Decoupled Audio Streaming Engine**: Heavy audio encoding/decoding is offloaded to a dedicated, containerized **Lavalink v4** instance connected through **Shoukaku** WebSockets.
* **Extensible Multi-Source Resolver**: Seamless audio resolution across **Spotify**, **YouTube**, **SoundCloud**, and **Direct HTTP/HTTPS Streams** with automated fallback resolution and metadata normalization.
* **Concurrent State & Queue Management**: Event-driven `GuildPlayer` and persistent `QueueManager` with smart autoplay recommendation algorithms, 24/7 channel persistence, dynamic queue shuffling, and track seek/loop controls.
* **Production Reliability & Telemetry**: End-to-end type safety using **TypeScript**, runtime environment validation using **Zod**, structured high-throughput logging with **Pino**, and process clustering via **PM2**.
* **Automated Test Suite**: Unit and integration testing powered by **Vitest** covering autoplay algorithms, queue manipulation, source resolvers, and player lifecycle events.
* **Interactive Identity Studio**: Features `voidtune_preview.html` with real-time canvas equalizers and Discord avatar/banner preview simulator.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Discord Voice Channel                    │
└──────────────────────────────▲──────────────────────────────┘
                               │ Audio Packets (Opus/RTP)
┌──────────────────────────────┴──────────────────────────────┐
│                  Lavalink v4 Audio Node                     │
│                (Dockerized Audio Transcoder)                │
└──────────────────────────────▲──────────────────────────────┘
                               │ WebSocket (Shoukaku)
┌──────────────────────────────┴──────────────────────────────┐
│                    VoidTune Bot Core                        │
│                 (Node.js + TypeScript)                      │
│                                                             │
│  ├── GuildPlayer (Playback State Machine)                   │
│  ├── QueueManager (Track Queuing & Autoplay)                │
│  ├── TrackResolver (Spotify / YouTube / SoundCloud)         │
│  └── Telemetry & Validation (Zod + Pino + PM2)              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

* **Language**: TypeScript 5.7+
* **Runtime**: Node.js 20+
* **Discord Library**: Discord.js v14
* **Audio Gateway**: Lavalink v4, Shoukaku v4
* **Validation**: Zod
* **Testing**: Vitest
* **Process Manager**: PM2
* **Containerization**: Docker & Docker Compose
* **Logger**: Pino

---

## ⚙️ Getting Started

### 1. Prerequisites
* **Node.js**: `v20.0.0` or higher
* **Docker & Docker Compose** (for running Lavalink)
* A registered **Discord Application & Bot Token**

### 2. Installation
```bash
git clone https://github.com/KingUniversee/VoidTune.git
cd VoidTune
npm install
```

### 3. Environment Configuration
Copy the `.env.example` file to `.env` and fill in your credentials:
```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

### 4. Start Lavalink Node
```bash
docker compose up -d
```

### 5. Run the Bot
```bash
# Development (with auto-reload)
npm run dev

# Build and production start
npm run build
npm start

# Or using PM2
npm run pm2:start
```

### 6. Run Test Suite
```bash
npm test
```

---

## 📜 License
This project is licensed under the MIT License.
