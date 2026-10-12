const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'dist')));
app.use('/models', express.static(path.join(__dirname, 'public', 'models')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Allow CORS for the Vite dev server
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const players = {};
const lastMoveAt = {}; // socket id -> ms timestamp of last accepted movement; cleared on respawn
const MAX_HP = 100;

// Server-authoritative weapon stats (mirror of main.js); client-reported damage is ignored.
const WEAPONS = {
  assault: { damage: 24, fireRate: 92, range: 120 },
  smg: { damage: 18, fireRate: 62, range: 80 },
  shotgun: { damage: 14, fireRate: 640, range: 50 }
};
const DEFAULT_LOADOUT = 'assault';
const HEADSHOT_MULTIPLIER = 1.8;
const FIRE_RATE_TOLERANCE = 0.8;   // allow jitter: min interval = fireRate * 0.8
const RANGE_TOLERANCE = 1.25;      // latency slack on hit distance
const MAX_MOVE_SPEED = 30;         // units/s; sprint ~8, slide boost ~2x, plus slack
const MAX_VERTICAL_SPEED = 60;     // units/s; jumps and falls
const MAX_ORIGIN_OFFSET = 10;      // shot origin must be near server-known position
const WORLD_LIMIT = 100;
const MIN_Y = -50;
const MAX_Y = 100;
const PLAYER_STATES = new Set(['idle', 'running', 'sprinting']);

function isVec3(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function isInWorld(v) {
  return isVec3(v) && Math.abs(v.x) <= WORLD_LIMIT && Math.abs(v.z) <= WORLD_LIMIT &&
    v.y >= MIN_Y && v.y <= MAX_Y;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const spawnPoints = [
  { x: 0, y: 8, z: 0 },
  { x: 18, y: 8, z: 16 },
  { x: -18, y: 8, z: -16 },
  { x: 24, y: 8, z: -8 },
  { x: -24, y: 8, z: 8 },
  { x: 8, y: 8, z: -24 },
  { x: -8, y: 8, z: 24 }
];

function pickSpawn() {
  return spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
}

function publicPlayers() {
  return players;
}

function emitLobbyStats() {
  io.emit('lobbyStats', {
    online: Object.keys(players).length,
    players: publicPlayers()
  });
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Initialize new player
  players[socket.id] = {
    id: socket.id,
    name: `Soldier_${socket.id.slice(0, 4)}`,
    position: pickSpawn(),
    rotation: { x: 0, y: 0, z: 0 },
    health: MAX_HP,
    kills: 0,
    deaths: 0,
    state: 'idle',
    isDead: false,
    loadout: DEFAULT_LOADOUT
  };
  let lastShotAt = 0;

  // Sync current state
  socket.emit('currentPlayers', players);
  socket.broadcast.emit('playerJoined', players[socket.id]);
  emitLobbyStats();

  socket.on('playerProfile', (profile = {}) => {
    const player = players[socket.id];
    if (!player) return;

    if (profile.name !== undefined) {
      const sanitizedName = String(profile.name)
        .replace(/[^a-zA-Z0-9_\- ]/g, '')
        .trim()
        .slice(0, 16);
      player.name = sanitizedName || `Soldier_${socket.id.slice(0, 4)}`;
    }

    if (typeof profile.loadout === 'string' && Object.hasOwn(WEAPONS, profile.loadout)) {
      player.loadout = profile.loadout;
    }

    emitLobbyStats();
  });

  // Movement: Handle Player Movement with Speed & Range Validation
  socket.on('playerMovement', (movementData) => {
    const player = players[socket.id];
    if (!player || player.isDead || !movementData) return;
    const { position, rotation, state } = movementData;
    if (!isInWorld(position) || !rotation || !Number.isFinite(rotation.y)) return;

    const now = Date.now();
    if (lastMoveAt[socket.id]) {
      // Reject teleports / speed hacks and resync the client to its last accepted position
      const dt = Math.min(Math.max((now - lastMoveAt[socket.id]) / 1000, 0.016), 1);
      const horizontal = Math.hypot(position.x - player.position.x, position.z - player.position.z);
      const vertical = Math.abs(position.y - player.position.y);
      if (horizontal / dt > MAX_MOVE_SPEED || vertical / dt > MAX_VERTICAL_SPEED) {
        // Allow legitimate respawn / fall resets near predefined spawn points
        const isNearSpawn = spawnPoints.some((sp) => {
          return Math.hypot(position.x - sp.x, position.y - sp.y, position.z - sp.z) < 3.0;
        });

        if (!isNearSpawn) {
          socket.emit('playerMoved', player);
          return;
        }
      }
    }
    lastMoveAt[socket.id] = now;

    player.position = { x: position.x, y: position.y, z: position.z };
    player.rotation = { x: 0, y: Number(rotation.y) || 0, z: 0 };
    player.state = PLAYER_STATES.has(state) ? state : 'running';
    socket.broadcast.emit('playerMoved', player);
  });

  // Combat: Handle Shooting with Server-Authoritative Validation
  socket.on('playerShoot', (hitData) => {
    const shooter = players[socket.id];
    if (!shooter || shooter.isDead || !hitData) return;

    const weapon = WEAPONS[shooter.loadout] || WEAPONS[DEFAULT_LOADOUT];
    const now = Date.now();
    if (now - lastShotAt < weapon.fireRate * FIRE_RATE_TOLERANCE) return;
    if (!isVec3(hitData.origin) || !isVec3(hitData.end)) return;
    if (distance(hitData.origin, shooter.position) > MAX_ORIGIN_OFFSET) return;
    lastShotAt = now;

    // Broadcast muzzle flash/sound effect to others
    socket.broadcast.emit('playerFired', {
      id: socket.id,
      origin: hitData.origin,
      end: hitData.end
    });

    // If a player was hit
    const target = typeof hitData.targetId === 'string' ? players[hitData.targetId] : null;
    if (target && target.id !== socket.id && !target.isDead &&
        (!target.isBot || target.ownerId === socket.id) &&
        distance(shooter.position, target.position) <= weapon.range * RANGE_TOLERANCE) {
      const headshot = hitData.headshot === true;
      const damage = headshot ? Math.round(weapon.damage * HEADSHOT_MULTIPLIER) : weapon.damage;
      target.health -= damage;

      if (target.health <= 0) {
        target.health = 0;
        target.isDead = true;
        target.deaths += 1;
        players[socket.id].kills += 1;

        // Notify everyone of the kill
        io.emit('playerKilled', {
          killerId: socket.id,
          victimId: target.id,
          damage,
          headshot,
          killerStats: players[socket.id],
          victimStats: target
        });
        emitLobbyStats();

        // Respawn the dead player after 3 seconds
        setTimeout(() => {
          if (players[target.id]) {
            players[target.id].health = MAX_HP;
            players[target.id].isDead = false;
            players[target.id].position = pickSpawn();
            delete lastMoveAt[target.id];
            io.emit('playerRespawned', players[target.id]);
            emitLobbyStats();
          }
        }, 3000);
      } else {
        // Notify the target they took damage
        io.emit('playerDamaged', {
          id: target.id,
          attackerId: socket.id,
          health: target.health,
          damage,
          headshot
        });
        emitLobbyStats();
      }
    }
  });

  // AI Bot for Training (Local to player)
  socket.on('startTraining', () => {
    const botId = 'bot_' + socket.id;
    if (players[botId]) return;
    players[botId] = {
      id: botId,
      name: 'Training Bot',
      position: pickSpawn(),
      rotation: { x: 0, y: 0, z: 0 },
      health: MAX_HP,
      kills: 0,
      deaths: 0,
      state: 'running',
      isDead: false,
      isBot: true,
      ownerId: socket.id
    };
    socket.emit('playerJoined', players[botId]);
  });

  // Handle Disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    delete lastMoveAt[socket.id];
    if (players['bot_' + socket.id]) {
      delete players['bot_' + socket.id];
    }
    io.emit('playerDisconnected', socket.id);
    emitLobbyStats();
  });
});

// Bot AI Loop
setInterval(() => {
  const bots = Object.values(players).filter(p => p.isBot && !p.isDead);
  
  bots.forEach(bot => {
    const target = players[bot.ownerId];
    if (!target || target.isDead) return;

    let minDist = Math.sqrt(
      Math.pow(target.position.x - bot.position.x, 2) + 
      Math.pow(target.position.z - bot.position.z, 2)
    );

    if (minDist > 8) {
      const speed = 5.0;
      const dx = target.position.x - bot.position.x;
      const dz = target.position.z - bot.position.z;
      bot.position.x += (dx / minDist) * speed * 0.05;
      bot.position.z += (dz / minDist) * speed * 0.05;
      bot.rotation.y = Math.atan2(dx, dz);
      bot.state = 'running';
      io.to(bot.ownerId).emit('playerMoved', bot);
    } else {
      bot.state = 'idle';
      bot.rotation.y = Math.atan2(target.position.x - bot.position.x, target.position.z - bot.position.z);
      io.to(bot.ownerId).emit('playerMoved', bot);
      
      if (Math.random() < 0.08) {
        io.to(bot.ownerId).emit('playerFired', {
          id: bot.id,
          origin: { x: bot.position.x, y: bot.position.y + 1.5, z: bot.position.z },
          end: { x: target.position.x, y: target.position.y + 1.5, z: target.position.z }
        });
        target.health -= 10;
        if (target.health <= 0) {
          target.health = 0;
          target.isDead = true;
          target.deaths += 1;
          bot.kills += 1;
          io.to(bot.ownerId).emit('playerKilled', {
            killerId: bot.id,
            victimId: target.id,
            damage: 10,
            headshot: false,
            killerStats: bot,
            victimStats: target
          });
          setTimeout(() => {
            if (players[target.id]) {
              players[target.id].health = MAX_HP;
              players[target.id].isDead = false;
              players[target.id].position = pickSpawn();
              delete lastMoveAt[target.id];
              io.to(bot.ownerId).emit('playerRespawned', players[target.id]);
            }
          }, 3000);
        } else {
          io.to(bot.ownerId).emit('playerDamaged', { id: target.id, attackerId: bot.id, health: target.health, damage: 10, headshot: false });
        }
      }
    }
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`BulletStorm Arena Server running on port ${PORT}`);
});
