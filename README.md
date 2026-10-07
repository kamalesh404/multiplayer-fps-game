<div align="center">

# 🔫 BulletStorm Arena
**High-Performance Browser FPS Multiplayer**

[![Three.js](https://img.shields.io/badge/Three.js-black?style=for-the-badge&logo=three.js&logoColor=white)](https://threejs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&badgeColor=010101)](https://socket.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

A fast-paced, competitive first-person shooter (FPS) designed for browser environments. It features advanced movement mechanics, skill-based gunplay, real 3D models, and a robust real-time multiplayer backend. 

</div>

---

## 🎮 Gameplay Preview

<div align="center">
  <img src="docs/images/menu.jpg" alt="BulletStorm Menu" width="80%">
  <br><br>
  <img src="docs/images/gameplay1.png" alt="In-Game Action" width="45%">
  <img src="docs/images/gameplay2.png" alt="Combat" width="45%">
  <br><br>
  <img src="docs/images/gameplay3.png" alt="Multiplayer" width="45%">
  <img src="docs/images/gameplay4.jpg" alt="Arena Map" width="45%">
</div>

---

## 🏗️ Core Architecture

### 1. Frontend (Client)
- **3D Engine:** Three.js (Optimized for 60+ FPS across devices).
- **UI Framework:** HTML5/CSS3 with Vanilla JS (Premium glassmorphic aesthetic).
- **Physics:** Cannon-es / lightweight custom AABB collision to ensure smooth, high-framerate performance on low-end devices.
- **Asset Pipeline:** 
  - Using strictly **Real 3D Models** (GLTF/GLB formats).
  - High-quality models for weapons, characters, and maps sourced from reliable CDNs.

### 2. Backend (Server)
- **Framework:** Node.js with Express.
- **Networking:** Socket.io for low-latency, real-time multiplayer synchronization.
- **Server Authority:** The server validates movement and hit detection to prevent cheating, utilizing client-side prediction for lag-free gameplay.

---

## ⚡ Performance & Optimization Strategy

To guarantee a steady **60 FPS** and cross-device compatibility:
1. **Asset Optimization:** Compressed textures, LOD (Level of Detail) models.
2. **Rendering:** Frustum culling, InstancedMeshes for repeated objects (bullets, environmental props).
3. **Tick Rate:** Server runs at a steady 20-30 ticks per second; the client interpolates positions to render smoothly at 60+ FPS.

---

## 🛡️ Server Security & Anti-Cheat Validation

To ensure fair gameplay and protect the multiplayer arena from exploits, the authoritative server enforces strict real-time validations:

1. **Fire Rate Cooldown Validation (`playerShoot`):**
   - Tracks `lastShotTime` per connected player.
   - Enforces weapon-specific minimum cooldown thresholds (baseline 80ms, 50ms for high-fire-rate SMG with network jitter allowance) to reject rapid-fire and packet spam injection before broadcasting shot effects or computing damage.

2. **Combat Range Validation:**
   - Computes the 3D distance between the shooter and the target upon registered hits.
   - Rejects combat packets if distance exceeds the maximum allowed engagement range (120 units), preventing out-of-bounds and cross-map damage hacks.
   - Enforces self-hit rejection and invalid position guards.

3. **Movement Delta & Teleportation Prevention (`playerMovement`):**
   - Validates coordinates for numeric sanity and finiteness.
   - Enforces a maximum movement delta per tick (`MAX_MOVEMENT_DELTA_PER_TICK = 15 units`) to detect and reject teleportation hacks and speedhacks.
   - Whitelists legitimate spawn points for respawn and death plane resets.

4. **Player Profile Sanitization (`playerProfile`):**
   - Sanitizes player names by stripping unsafe characters (preventing HTML/XSS injection into the scoreboard/lobby) and capping length to 16 characters.
   - Validates weapon loadout choices against an allowed whitelist (`assault`, `smg`, `shotgun`).

---

## 🛣️ Development Roadmap

### Phase 1: Engine Foundation & Multiplayer Setup *(CURRENT)*
- [x] Set up Node.js server with Socket.io.
- [x] Establish the client-server connection.
- [x] Synchronize basic player positions and states across the network.

### Phase 2: High-Quality Asset Integration
- [ ] Load a real `.glb` character model.
- [ ] Load real `.glb` weapon models.
- [ ] Set up a visually stunning map (cyberpunk/neon arena style).
- [ ] Implement First-Person camera logic attached to the 3D model.

### Phase 3: Core Gameplay Mechanics
- [ ] **Advanced Movement:** Sprinting, sliding, jumping, and crouch mechanics.
- [ ] **Shooting Logic:** Raycasting from the camera center, server-validated hit detection.
- [ ] Recoil, bullet spread, and weapon firing animations.

### Phase 4: UI Integration & Game Loop
- [ ] Connect the massive HTML/CSS UI to the game engine.
- [ ] Implement Health/Damage systems, Kill Feed, and Scoreboard.
- [ ] Create game modes (Deathmatch, Team Deathmatch).

---

## 🕹️ Run The Playable Alpha

1. Build the client:
```bash
npm run build
```

2. Start the multiplayer server:
```bash
npm run server
```

3. Open your browser to:
```text
http://localhost:3000
```

### ⌨️ Controls
| Action | Key |
| :--- | :--- |
| **Move** | `W`, `A`, `S`, `D` |
| **Aim** | `Mouse` |
| **Fire** | `Left Click` |
| **ADS** | `Right Click` |
| **Reload** | `R` |
| **Sprint** | `Shift` |
| **Slide** | `C` |
| **Jump** | `Space` |
| **Weapons**| `1`, `2`, `3` |
| **Score** | `Tab` |

---

## 📜 License

This project is licensed under the **MIT License**.


---
<br>
<div align="center">
  <a href="https://github.com/kamalesh4044/multiplayer-fps-game">
    <img src="https://komarev.com/ghpvc/?username=kamalesh4044-multiplayer-fps-game&label=PROJECT+VIEWS&color=00ff88&style=for-the-badge" alt="Views"/>
  </a>
</div>
