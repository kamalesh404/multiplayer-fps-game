import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { io } from 'socket.io-client';

// Setup BVH for exact physics
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ==========================================
// 1. GAME STATE & NETWORKING
// ==========================================
const serverUrl = window.location.port === '3000' ? window.location.origin : 'http://localhost:3000';
const socket = io(serverUrl, { transports: ['websocket', 'polling'] });
const players = {}; 
let myId = null;
let isDead = false;
let isMatchActive = false;

const ammoCurrent = document.getElementById('ammo-current');
const ammoReserve = document.getElementById('ammo-reserve');
const healthText = document.getElementById('health-text');
const healthBar = document.getElementById('health-bar');
const armorText = document.getElementById('armor-text');
const armorBar = document.getElementById('armor-bar');
const onlineCount = document.getElementById('online-count');
const killFeed = document.getElementById('kill-feed');
const scoreboard = document.getElementById('scoreboard');
const scoreboardBody = document.getElementById('scoreboard-body');
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas?.getContext('2d');
const hudWeaponName = document.getElementById('hud-weapon-name');
const loaderBar = document.getElementById('loader-bar');
const loaderText = document.getElementById('loader-text');

const WEAPONS = {
    assault: {
        id: 'assault',
        name: 'Vanguard AR',
        path: '/models/assult_gun.glb',
        ammo: 30,
        reserve: 120,
        damage: 24,
        fireRate: 92,
        recoil: 1,
        spread: 0.006,
        adsFov: 52,
        scale: 0.014,
        basePos: new THREE.Vector3(0.18, -0.22, -0.42),
        adsPos: new THREE.Vector3(0.01, -0.19, -0.36),
        stats: { damage: 62, firerate: 82, accuracy: 70, range: 72, mobility: 64 }
    },
    smg: {
        id: 'smg',
        name: 'Rift SMG',
        path: '/models/smg_90.glb',
        ammo: 36,
        reserve: 144,
        damage: 18,
        fireRate: 62,
        recoil: 0.65,
        spread: 0.011,
        adsFov: 56,
        scale: 0.005,
        basePos: new THREE.Vector3(0.18, -0.20, -0.40),
        adsPos: new THREE.Vector3(0.0, -0.18, -0.35),
        stats: { damage: 45, firerate: 96, accuracy: 56, range: 45, mobility: 88 }
    },
    shotgun: {
        id: 'shotgun',
        name: 'Breach-12',
        path: '/models/shortgun.glb',
        ammo: 8,
        reserve: 40,
        damage: 14,
        pellets: 8,
        fireRate: 640,
        recoil: 1.75,
        spread: 0.045,
        adsFov: 58,
        scale: 0.040,
        basePos: new THREE.Vector3(0.20, -0.24, -0.45),
        adsPos: new THREE.Vector3(0.01, -0.20, -0.36),
        stats: { damage: 92, firerate: 34, accuracy: 38, range: 28, mobility: 54 }
    }
};

const MAPS = [
    { id: 'arena', name: 'Dustline Arena', path: '/models/map1.glb', scaleMultiplier: 1.0, yOffset: 0 },
    { id: 'foundry', name: 'Iron Foundry', path: '/models/map2.glb', scaleMultiplier: 1.0, yOffset: 0 }
];

let selectedMap = MAPS[0];
let selectedMode = 'deathmatch';
let selectedWeaponId = 'assault';
let currentWeapon = WEAPONS[selectedWeaponId];
let currentAmmo = currentWeapon.ammo;
let reserveAmmo = currentWeapon.reserve;
let MAX_AMMO = currentWeapon.ammo;
let isReloading = false;
let isAiming = false; // ADS State
let localStats = { health: 100, armor: 100, kills: 0, deaths: 0, headshots: 0, shots: 0, hits: 0 };
let lastLobbySnapshot = {};

socket.on('connect', () => {
    myId = socket.id;
    sendProfile();
});

// ==========================================
// 2. ENGINE SETUP
// ==========================================
const canvas = document.getElementById('game-canvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); 
scene.fog = new THREE.FogExp2(0x87CEEB, 0.005);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const cameraGroup = new THREE.Group(); // Represents the player's FEET
scene.add(cameraGroup);

// Position camera (eyes) at head height relative to feet
camera.position.set(0, 1.68, 0); 
cameraGroup.add(camera);

const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
hemiLight.position.set(0, 200, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(100, 200, 50);
dirLight.castShadow = true;
scene.add(dirLight);

// ==========================================
// 3. PHYSICS & VARIABLES
// ==========================================
const playerRadius = 0.32;
let playerHeight = 1.78;
const capsuleBase = new THREE.Vector3();
const capsuleTop = new THREE.Vector3();
const velocity = new THREE.Vector3();
let playerOnFloor = false;
let mapCollider = null;
const spawnPoint = new THREE.Vector3(0, 4, 0);
const tempBox = new THREE.Box3();
const tempSize = new THREE.Vector3();
const tempPoint = new THREE.Vector3();
const tempPointB = new THREE.Vector3();
const tempMidPoint = new THREE.Vector3();
const tempPushDir = new THREE.Vector3();
const tempIntersectionPoint = new THREE.Vector3();
const capsuleCenters = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

// Movement State
let slideBoost = 1.0; 
const SLIDE_COOLDOWN = 1.0;
let slideCooldownLeft = 0;
let landedRecentlyTimer = 0;
const MAX_ACTIVE_EFFECTS = 180;
let minimapAccumulator = 0;

const qualityPresets = {
    low: { pixelRatio: 0.8, shadows: false },
    medium: { pixelRatio: 1.0, shadows: true },
    high: { pixelRatio: 1.25, shadows: true },
    ultra: { pixelRatio: 1.5, shadows: true }
};

const applyGraphicsSettings = () => {
    const quality = document.getElementById('quality-select')?.value || 'medium';
    const shadowsEnabled = document.getElementById('shadows-toggle')?.checked ?? true;
    const preset = qualityPresets[quality] || qualityPresets.medium;
    const targetRatio = Math.min(window.devicePixelRatio * preset.pixelRatio, 2);
    renderer.setPixelRatio(targetRatio);
    renderer.shadowMap.enabled = Boolean(preset.shadows && shadowsEnabled);
};

// ==========================================
// 3.5. AUDIO SYSTEM (Synthesized for instant feedback)
// ==========================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const playSound = (type) => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    if (type === 'shoot_assault') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.1);
        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'shoot_smg') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
        gainNode.gain.setValueAtTime(0.2, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
    } else if (type === 'shoot_shotgun') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.2);
        gainNode.gain.setValueAtTime(0.5, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    } else if (type === 'hitmarker') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.05);
        gainNode.gain.setValueAtTime(0.8, now);
        gainNode.gain.linearRampToValueAtTime(0.01, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
    } else if (type === 'headshot') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.linearRampToValueAtTime(2000, now + 0.1);
        gainNode.gain.setValueAtTime(1.0, now);
        gainNode.gain.linearRampToValueAtTime(0.01, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
    } else if (type === 'step') {
        // Soft noise for step
        const bufferSize = audioCtx.sampleRate * 0.05; 
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        noise.connect(filter);
        filter.connect(gainNode);
        gainNode.gain.setValueAtTime(0.05, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
        noise.start(now);
    }
};

// ==========================================
// 4. LOAD ASSETS
// ==========================================
const gltfLoader = new GLTFLoader();
let playerModel = null;
let weaponModel = null;
let currentMapMesh = null;
let currentMapPath = selectedMap.path;
const weaponCache = {};
let modelsLoaded = 0;
const requiredLoads = 3;

const checkLoadStatus = () => {
    modelsLoaded++;
    const percent = Math.min(100, Math.round((modelsLoaded / requiredLoads) * 100));
    if (loaderBar) loaderBar.style.width = `${percent}%`;
    if (loaderText) loaderText.innerText = `Loading combat assets... ${percent}%`;
    if (modelsLoaded >= requiredLoads) {
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        buildMenuData();
        updateHud();
    }
};

const loadMap = (map, onDone = () => {}) => {
    selectedMap = map;
    currentMapPath = map.path;
    if (currentMapMesh) scene.remove(currentMapMesh);
    if (mapCollider) {
        scene.remove(mapCollider);
        mapCollider.geometry.disposeBoundsTree?.();
        mapCollider.geometry.dispose();
        mapCollider = null;
    }

gltfLoader.load(map.path, (gltf) => {
    const mapMesh = gltf.scene;
    mapMesh.scale.set(1, 1, 1);
    mapMesh.position.set(0, 0, 0);
    mapMesh.updateMatrixWorld(true);

    tempBox.setFromObject(mapMesh);
    tempBox.getSize(tempSize);
    const baseSize = Math.max(tempSize.x, tempSize.z, 1);
    const targetPlayableSize = 180;
    const autoScale = (targetPlayableSize / baseSize) * (map.scaleMultiplier || 1.0);
    mapMesh.scale.setScalar(autoScale);

    mapMesh.updateMatrixWorld(true);
    tempBox.setFromObject(mapMesh);
    const groundY = tempBox.min.y;
    const offsetY = (map.yOffset || 0) - groundY;
    mapMesh.position.set(0, offsetY, 0);
    mapMesh.updateMatrixWorld(true);
    tempBox.setFromObject(mapMesh);
    tempBox.setFromObject(mapMesh);

    const geometries = [];
    mapMesh.traverse((child) => {
        if (child.isMesh) {
            child.receiveShadow = true;
            child.castShadow = true;
            const clonedGeo = child.geometry.clone();
            clonedGeo.applyMatrix4(child.matrixWorld);
            geometries.push(clonedGeo);
        }
    });

    if (geometries.length > 0) {
        const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
        mergedGeometry.computeBoundsTree(); 
        mapCollider = new THREE.Mesh(mergedGeometry, new THREE.MeshBasicMaterial({ wireframe: true, visible: false }));
        scene.add(mapCollider);
    }
    
    currentMapMesh = mapMesh;
    scene.add(mapMesh);
    onDone();
}, undefined, () => onDone());
};

loadMap(selectedMap, checkLoadStatus);

gltfLoader.load('/models/player.glb', (gltf) => {
    playerModel = gltf.scene;
    playerModel.animations = gltf.animations;
    playerModel.scale.set(1.0, 1.0, 1.0); 
    checkLoadStatus();
}, undefined, () => checkLoadStatus());

// Positions are now defined per weapon in the WEAPONS config.

const equipWeapon = (weaponId, countLoad = false) => {
    const nextWeapon = WEAPONS[weaponId] || WEAPONS.assault;
    selectedWeaponId = nextWeapon.id;
    currentWeapon = nextWeapon;
    MAX_AMMO = nextWeapon.ammo;
    currentAmmo = Math.min(currentAmmo || nextWeapon.ammo, nextWeapon.ammo);
    reserveAmmo = Math.max(reserveAmmo || nextWeapon.reserve, 0);

    const attachWeapon = (model) => {
        if (weaponModel) camera.remove(weaponModel);
        weaponModel = model.clone();
        weaponModel.scale.set(nextWeapon.scale, nextWeapon.scale, nextWeapon.scale);
        weaponModel.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        // Add Simple Arms
        const armGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.4, 8);
        const armMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a }); // dark gloves
        const rightArm = new THREE.Mesh(armGeo, armMat);
        rightArm.position.set(-0.05, -0.05, -0.1); 
        rightArm.rotation.x = Math.PI / 2;
        rightArm.rotation.z = -0.1;
        weaponModel.add(rightArm);
        
        const leftArm = new THREE.Mesh(armGeo, armMat);
        leftArm.position.set(-0.15, 0.05, 0.2); 
        leftArm.rotation.x = Math.PI / 2;
        leftArm.rotation.z = 0.2;
        weaponModel.add(leftArm);

        weaponModel.position.copy(currentWeapon.basePos); 
        weaponModel.rotation.set(0, Math.PI - 0.05, 0); 
        camera.add(weaponModel);
        updateHud();
        sendProfile();
        if (countLoad) checkLoadStatus();
    };

    if (weaponCache[nextWeapon.id]) {
        attachWeapon(weaponCache[nextWeapon.id]);
        return;
    }

    gltfLoader.load(nextWeapon.path, (gltf) => {
        weaponCache[nextWeapon.id] = gltf.scene;
        attachWeapon(gltf.scene);
    }, undefined, () => {
        if (countLoad) checkLoadStatus();
    });
};

gltfLoader.load(currentWeapon.path, (gltf) => {
    weaponCache[currentWeapon.id] = gltf.scene;
    weaponModel = gltf.scene.clone();
    weaponModel.scale.set(currentWeapon.scale, currentWeapon.scale, currentWeapon.scale);
    weaponModel.position.copy(currentWeapon.basePos); 
    weaponModel.rotation.set(0, Math.PI - 0.05, 0); 
    camera.add(weaponModel); 
    checkLoadStatus();
}, undefined, () => checkLoadStatus());

// ==========================================
// 5. VISUAL EFFECTS (Damage Numbers, Impacts)
// ==========================================
const effectsData = []; 
const trimEffectsBudget = () => {
    if (effectsData.length <= MAX_ACTIVE_EFFECTS) return;
    const dropCount = effectsData.length - MAX_ACTIVE_EFFECTS;
    for (let i = 0; i < dropCount; i++) {
        const effect = effectsData[i];
        if (effect?.type === 'dmgNum') effect.el?.remove();
        else if (effect?.mesh) scene.remove(effect.mesh);
    }
    effectsData.splice(0, dropCount);
};

const createDamageNumber = (point, amount, isHeadshot) => {
    const div = document.createElement('div');
    div.innerText = `-${amount}`;
    div.style.position = 'absolute';
    div.style.color = isHeadshot ? '#ffd700' : '#ffffff';
    div.style.fontWeight = 'bold';
    div.style.fontSize = isHeadshot ? '24px' : '18px';
    div.style.textShadow = '0 0 4px #000';
    div.style.pointerEvents = 'none';
    div.style.userSelect = 'none';
    div.style.zIndex = '1000';
    div.style.transform = 'translate(-50%, -50%)';
    div.style.transition = 'all 0.5s ease-out';
    document.body.appendChild(div);

    // Track it to update its 2D position based on 3D world pos
    const floatTarget = point.clone().add(tempPointB.set(0, 1, 0));
    effectsData.push({ type: 'dmgNum', el: div, pos: point.clone(), endPos: floatTarget, age: 0, maxAge: 0.5 });
    trimEffectsBudget();
};

const createBulletImpact = (point, normal, isFlesh = false) => {
    const decalGeo = new THREE.PlaneGeometry(0.15, 0.15);
    const decalMat = new THREE.MeshBasicMaterial({ 
        color: isFlesh ? 0x880000 : 0x000000, 
        depthWrite: false, 
        transparent: true, 
        opacity: 0.8 
    });
    const decal = new THREE.Mesh(decalGeo, decalMat);
    decal.position.copy(point).add(normal.clone().multiplyScalar(0.02)); 
    decal.lookAt(point.clone().add(normal));
    scene.add(decal);

    const particleCount = isFlesh ? 8 : 3;
    for(let i=0; i<particleCount; i++) {
        const sparkGeo = new THREE.SphereGeometry(0.04, 4, 4);
        const sparkMat = new THREE.MeshBasicMaterial({ color: isFlesh ? 0xff0000 : 0xffaa00 });
        const spark = new THREE.Mesh(sparkGeo, sparkMat);
        spark.position.copy(point);
        // Random velocity away from normal
        const vel = normal.clone().add(new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5)).normalize().multiplyScalar(Math.random() * 5 + 2);
        scene.add(spark);
        effectsData.push({ type: 'particle', mesh: spark, age: 0, maxAge: 0.15, vel: vel });
    }

    // Decals live much longer
    effectsData.push({ type: 'decal', mesh: decal, age: 0, maxAge: 10.0 });
};

const createTracer = (startPoint, endPoint) => {
    const distance = startPoint.distanceTo(endPoint);
    const geometry = new THREE.CylinderGeometry(0.005, 0.005, distance, 3);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true, opacity: 0.8 });
    const tracer = new THREE.Mesh(geometry, material);
    
    tracer.position.copy(tempMidPoint.addVectors(startPoint, endPoint).multiplyScalar(0.5));
    tracer.lookAt(endPoint);
    tracer.rotateX(Math.PI / 2); 

    scene.add(tracer);
    effectsData.push({ type: 'tracer', mesh: tracer, age: 0, maxAge: 0.05 }); 
    trimEffectsBudget();
};

// ==========================================
// 6. MULTIPLAYER SYNC
// ==========================================
const addRemotePlayer = (id, data) => {
    if (!playerModel || id === myId || players[id]) return;
    const mesh = playerModel.clone();

    let mixer = null;
    if (playerModel.animations && playerModel.animations.length > 0) {
        mixer = new THREE.AnimationMixer(mesh);
        const action = mixer.clipAction(playerModel.animations[0]);
        action.play();
    }

    const gunGeo = new THREE.BoxGeometry(0.1, 0.1, 0.6);
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const gunMesh = new THREE.Mesh(gunGeo, gunMat);
    gunMesh.position.set(0.2, 1.0, 0.4); 
    mesh.add(gunMesh);

    mesh.position.copy(data.position);
    mesh.boundingBox = new THREE.Box3().setFromObject(mesh);
    scene.add(mesh);
    players[id] = { 
        mesh: mesh, 
        mixer: mixer,
        data: data,
        name: data.name || `Soldier_${id.slice(0, 4)}`,
        targetPosition: new THREE.Vector3().copy(data.position),
        targetRotationY: data.rotation ? data.rotation.y : 0
    };
};

socket.on('currentPlayers', (serverPlayers) => {
    Object.keys(serverPlayers).forEach((id) => {
        if (id !== myId && !serverPlayers[id].isDead) addRemotePlayer(id, serverPlayers[id]);
    });
});
socket.on('playerJoined', (data) => { addRemotePlayer(data.id, data); });
socket.on('playerMoved', (data) => {
    if (players[data.id] && players[data.id].mesh) {
        // Set target position for interpolation instead of snapping instantly
        players[data.id].targetPosition.copy(data.position);
        players[data.id].targetRotationY = data.rotation.y;
    }
});
socket.on('playerDisconnected', (id) => {
    if (players[id]) { scene.remove(players[id].mesh); delete players[id]; }
    updateScoreboard();
});
socket.on('playerRespawned', (data) => {
    if (data.id === myId) {
        cameraGroup.position.copy(data.position);
        localStats.health = 100;
        isDead = false;
        updateHud();
    } else if (players[data.id]) {
        players[data.id].mesh.position.copy(data.position);
        players[data.id].targetPosition.copy(data.position);
        players[data.id].isDead = false;
    }
});
socket.on('lobbyStats', (data) => {
    if (onlineCount) onlineCount.innerText = data.online || 0;
    lastLobbySnapshot = data.players || {};
    updateScoreboard();
});
socket.on('playerFired', (data) => {
    if (!data || data.id === myId) return;
    const remote = players[data.id];
    if (!remote?.mesh || !data.origin || !data.end) return;
    createTracer(new THREE.Vector3(data.origin.x, data.origin.y, data.origin.z), new THREE.Vector3(data.end.x, data.end.y, data.end.z));
});

// ==========================================
// 7. COMBAT
// ==========================================
const muzzleFlash = new THREE.PointLight(0xffdd00, 0, 10);
muzzleFlash.position.set(0.3, -0.2, -1.5);
camera.add(muzzleFlash);

const shootRaycaster = new THREE.Raycaster();
const centerScreen = new THREE.Vector2(0, 0);

let isShooting = false;
let lastShotTime = 0;
const FIRE_RATE = 100;

const fireBullet = () => {
    if (isDead || currentAmmo <= 0 || isReloading) {
        if (currentAmmo <= 0) reload();
        return;
    }

    currentAmmo--;
    localStats.shots++;
    updateHud();

    playSound(`shoot_${currentWeapon.id}`);

    // Dynamic Recoil (Less when Aiming Down Sights)
    const recoilMult = (isAiming ? 0.35 : 1.0) * currentWeapon.recoil;
    camera.rotation.x += ((Math.random() * 0.015) + 0.005) * recoilMult; 
    camera.rotation.y += ((Math.random() - 0.5) * 0.012) * recoilMult;
    
    // Screen shake
    screenShake += recoilMult * 0.05;
    
    // Kickback animation on weapon
    if(weaponModel) {
        weaponModel.position.z += 0.08 * recoilMult;
        weaponModel.rotation.x += 0.05 * recoilMult;
    }

    muzzleFlash.intensity = 5;
    setTimeout(() => { muzzleFlash.intensity = 0; }, 40);

    // Crosshair dynamic expansion
    const ch = document.getElementById('crosshair');
    if(ch) {
        ch.style.transform = 'translate(-50%, -50%) scale(1.5)';
        setTimeout(() => ch.style.transform = 'translate(-50%, -50%) scale(1)', 50);
    }

    const pelletCount = currentWeapon.pellets || 1;
    const moveSpeed = Math.hypot(velocity.x, velocity.z);
    const movePenalty = THREE.MathUtils.clamp(moveSpeed / 8, 0, 1) * 0.62;
    const airPenalty = playerOnFloor ? 0 : 0.35;
    const crouchBonus = keys.c && playerOnFloor ? 0.18 : 0;
    const landingBonus = landedRecentlyTimer > 0 ? 0.12 : 0;
    let hitPlayerId = null;
    let didHit = false;
    let bestHeadshot = false;
    let finalEndPoint = null;
    let finalBarrelPos = null;

    for (let pellet = 0; pellet < pelletCount; pellet++) {
    const spread = currentWeapon.spread * (isAiming ? 0.42 : 1) * (1 + movePenalty + airPenalty - crouchBonus - landingBonus);
    const aimPoint = new THREE.Vector2(
        centerScreen.x + (Math.random() - 0.5) * spread,
        centerScreen.y + (Math.random() - 0.5) * spread
    );
    shootRaycaster.setFromCamera(aimPoint, camera);
    let closestDist = Infinity;
    let endPoint = new THREE.Vector3().copy(shootRaycaster.ray.origin).add(shootRaycaster.ray.direction.multiplyScalar(100));

    // Map Collision
    if (mapCollider) {
        const wallHits = shootRaycaster.intersectObject(mapCollider);
        if (wallHits.length > 0) {
            closestDist = wallHits[0].distance;
            endPoint = wallHits[0].point;
            createBulletImpact(wallHits[0].point, wallHits[0].face.normal);
        }
    }

    // Player Collision
    let isHeadshot = false;
    Object.keys(players).forEach(id => {
        const p = players[id];
        if (p.mesh && p.mesh.boundingBox) {
            const intersection = shootRaycaster.ray.intersectBox(p.mesh.boundingBox, tempIntersectionPoint);
            if (intersection) {
                const dist = intersection.distanceTo(cameraGroup.position);
                if (dist < closestDist) {
                    closestDist = dist;
                    hitPlayerId = id;
                    endPoint = intersection.clone();
                    // Simple headshot calc (if hit is very high relative to bounding box)
                    if (intersection.y > p.mesh.boundingBox.max.y - 0.3) isHeadshot = true;
                    // Flesh impact normal approximation
                    const dir = endPoint.clone().sub(cameraGroup.position).normalize().negate();
                    createBulletImpact(endPoint, dir, true);
                }
            }
        }
    });

    const barrelPos = new THREE.Vector3();
    if(weaponModel) {
        barrelPos.set(isAiming ? 0.02 : 0.19, isAiming ? -0.19 : -0.18, -0.72);
        barrelPos.applyMatrix4(camera.matrixWorld);
    } else {
        barrelPos.copy(cameraGroup.position);
    }
    createTracer(barrelPos, endPoint);
    finalEndPoint = endPoint;
    finalBarrelPos = barrelPos;

    if (hitPlayerId) {
        didHit = true;
        bestHeadshot = bestHeadshot || isHeadshot;
        // Hit marker
        const hitMarker = document.getElementById('hit-marker');
        if (hitMarker) {
            hitMarker.classList.remove('hidden');
            hitMarker.style.borderColor = bestHeadshot ? '#ff0000' : '#ffffff';
            setTimeout(() => hitMarker.classList.add('hidden'), 100);
        }
        
        playSound(bestHeadshot ? 'headshot' : 'hitmarker');
        
        // Damage number
        createDamageNumber(endPoint, isHeadshot ? Math.round(currentWeapon.damage * 1.8) : currentWeapon.damage, isHeadshot);
    }
    }

    if (didHit) localStats.hits++;
    socket.emit('playerShoot', {
        targetId: hitPlayerId,
        headshot: bestHeadshot,
        damage: currentWeapon.damage,
        origin: finalBarrelPos,
        end: finalEndPoint
    });
};

const reload = () => {
    if (isReloading || currentAmmo === MAX_AMMO || reserveAmmo <= 0) return;
    isReloading = true;
    isAiming = false;
    if(weaponModel) weaponModel.rotation.x = -Math.PI / 4; 
    setTimeout(() => {
        const needed = MAX_AMMO - currentAmmo;
        const loaded = Math.min(needed, reserveAmmo);
        currentAmmo += loaded;
        reserveAmmo -= loaded;
        updateHud();
        if(weaponModel) weaponModel.rotation.x = 0; 
        isReloading = false;
    }, 1500);
};

// ==========================================
// 8. CONTROLS
// ==========================================
const controls = new PointerLockControls(camera, document.body);
const startMatch = () => {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('mode-select')?.classList.add('hidden');
    document.getElementById('map-select')?.classList.add('hidden');
    document.getElementById('pause-menu')?.classList.add('hidden');
    isMatchActive = true;
    controls.lock();

    // Use server spawn point if available, else pick a random edge spawn
    if (players[myId] && players[myId].position) {
        cameraGroup.position.copy(players[myId].position);
    } else {
        const spawns = [
            new THREE.Vector3(18, 8, 16),
            new THREE.Vector3(-18, 8, -16),
            new THREE.Vector3(24, 8, -8),
            new THREE.Vector3(-24, 8, 8)
        ];
        cameraGroup.position.copy(spawns[Math.floor(Math.random() * spawns.length)]);
    }
    velocity.set(0,0,0);
    localStats.health = 100;
    localStats.armor = 100;
    isDead = false;
    updateHud();
};

document.getElementById('btn-play').addEventListener('click', () => {
    document.getElementById('mode-select')?.classList.remove('hidden');
});
document.getElementById('btn-training')?.addEventListener('click', () => {
    socket.emit('startTraining');
    startMatch();
});

controls.addEventListener('lock', () => { document.getElementById('game-hud').classList.remove('hidden'); });
controls.addEventListener('unlock', () => {
    if (!isMatchActive) return;
    document.getElementById('game-hud').classList.add('hidden');
    document.getElementById('pause-menu').classList.remove('hidden');
});
document.getElementById('btn-resume').addEventListener('click', () => {
    document.getElementById('pause-menu').classList.add('hidden');
    controls.lock();
});
document.getElementById('btn-quit')?.addEventListener('click', () => {
    isMatchActive = false;
    document.getElementById('pause-menu')?.classList.add('hidden');
    document.getElementById('game-hud')?.classList.add('hidden');
    document.getElementById('main-menu')?.classList.remove('hidden');
});
document.getElementById('btn-start-game')?.addEventListener('click', () => {
    document.getElementById('mode-select')?.classList.add('hidden');
    document.getElementById('map-select')?.classList.remove('hidden');
});
document.getElementById('btn-confirm-map')?.addEventListener('click', () => {
    if (selectedMap.path !== currentMapPath) {
        document.getElementById('loading-screen')?.classList.remove('hidden');
        loadMap(selectedMap, () => {
            document.getElementById('loading-screen')?.classList.add('hidden');
            startMatch();
        });
        return;
    }
    startMatch();
});

const keys = { w: false, a: false, s: false, d: false, space: false, shift: false, c: false };

document.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') {
        e.preventDefault();
        scoreboard?.classList.remove('hidden');
        updateScoreboard();
    }
    if(e.code === 'KeyW') keys.w = true;
    if(e.code === 'KeyA') keys.a = true;
    if(e.code === 'KeyS') keys.s = true;
    if(e.code === 'KeyD') keys.d = true;
    if(e.code === 'ShiftLeft') keys.shift = true;
    if(e.code === 'KeyC') {
        if (!keys.c && playerOnFloor && keys.shift && !isAiming && slideCooldownLeft <= 0) {
            slideBoost = 1.35; 
            slideCooldownLeft = SLIDE_COOLDOWN;
        }
        keys.c = true; 
    }
    if(e.code === 'KeyR') reload();
    if(e.code === 'Digit1') switchWeapon('assault');
    if(e.code === 'Digit2') switchWeapon('smg');
    if(e.code === 'Digit3') switchWeapon('shotgun');
    
    // Jump - Maintain momentum if jumping out of slide (Slide-hopping/B-hopping)
    if(e.code === 'Space' && playerOnFloor && !isDead) {
        velocity.y = 6;
        playerOnFloor = false;
        if (keys.c) {
            slideBoost = 1.2;
            slideCooldownLeft = Math.max(slideCooldownLeft - 0.45, 0);
        }
    }
});

document.addEventListener('keyup', (e) => {
    if (e.code === 'Tab') scoreboard?.classList.add('hidden');
    if(e.code === 'KeyW') keys.w = false;
    if(e.code === 'KeyA') keys.a = false;
    if(e.code === 'KeyS') keys.s = false;
    if(e.code === 'KeyD') keys.d = false;
    if(e.code === 'ShiftLeft') keys.shift = false;
    if(e.code === 'KeyC') keys.c = false;
});

// Weapon Sway State
let mouseMovementX = 0;
let mouseMovementY = 0;

document.addEventListener('mousemove', (e) => {
    if (controls.isLocked) {
        mouseMovementX = e.movementX;
        mouseMovementY = e.movementY;
    }
});

document.addEventListener('mousedown', (e) => { 
    if (!controls.isLocked) return;
    if (e.button === 0) isShooting = true; 
    if (e.button === 2) isAiming = true; 
});
document.addEventListener('mouseup', (e) => { 
    if (e.button === 0) isShooting = false; 
    if (e.button === 2) isAiming = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

const direction = new THREE.Vector3();
const clock = new THREE.Clock();
let bobTimer = 0;
let stepTimer = 0;
let screenShake = 0;

const animate = () => {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05); 

    if (controls.isLocked && !isDead) {
        const wasOnFloor = playerOnFloor;
        if (slideCooldownLeft > 0) slideCooldownLeft = Math.max(0, slideCooldownLeft - delta);
        if (landedRecentlyTimer > 0) landedRecentlyTimer = Math.max(0, landedRecentlyTimer - delta);
        
        // Auto Fire
        if (isShooting && Date.now() - lastShotTime > currentWeapon.fireRate) {
            fireBullet();
            lastShotTime = Date.now();
        }

        // Aim Down Sights (ADS) Lerping
        const targetFov = isAiming ? currentWeapon.adsFov : 75;
        camera.fov += (targetFov - camera.fov) * 15 * delta;
        camera.updateProjectionMatrix();

        // Realistic Gun Bobbing, Recoil, and Procedural Sway
        if (weaponModel && !isReloading) {
            const targetPos = isAiming ? currentWeapon.adsPos : currentWeapon.basePos;
            
            // Recover from recoil
            if (weaponModel.position.z > targetPos.z) {
                weaponModel.position.z = Math.max(targetPos.z, weaponModel.position.z - 0.5 * delta);
            } else {
                weaponModel.position.z += (targetPos.z - weaponModel.position.z) * 15 * delta;
            }
            
            // Recover pitch recoil
            if (weaponModel.rotation.x > 0) {
                weaponModel.rotation.x = Math.max(0, weaponModel.rotation.x - 2.0 * delta);
            } else {
                weaponModel.rotation.x += (0 - weaponModel.rotation.x) * 15 * delta;
            }

            // Procedural Weapon Sway based on mouse movement
            const swayX = (mouseMovementX * 0.0005) * (isAiming ? 0.2 : 1.0);
            const swayY = (mouseMovementY * 0.0005) * (isAiming ? 0.2 : 1.0);
            
            // Constrain sway
            const maxSway = 0.05;
            const clampedSwayX = Math.max(-maxSway, Math.min(maxSway, swayX));
            const clampedSwayY = Math.max(-maxSway, Math.min(maxSway, swayY));

            weaponModel.rotation.y = (Math.PI - 0.05) - clampedSwayX;
            weaponModel.rotation.x = -clampedSwayY;
            
            // Reset mouse movement so sway recovers
            mouseMovementX *= 0.8;
            mouseMovementY *= 0.8;

            // Head bobbing based on movement speed
            const isMoving = keys.w || keys.a || keys.s || keys.d;
            if (isMoving && playerOnFloor && !isAiming) {
                const bobSpeed = keys.shift ? 15 : 10;
                bobTimer += delta * bobSpeed;
                weaponModel.position.y = targetPos.y + Math.sin(bobTimer) * 0.015;
                weaponModel.position.x = targetPos.x + Math.cos(bobTimer / 2) * 0.01;
                
                // Footsteps
                stepTimer += delta * bobSpeed;
                if (stepTimer > Math.PI) {
                    playSound('step');
                    stepTimer = 0;
                }
            } else {
                weaponModel.position.y += (targetPos.y - weaponModel.position.y) * 15 * delta;
                weaponModel.position.x += (targetPos.x - weaponModel.position.x) * 15 * delta;
                bobTimer = 0;
                stepTimer = 0;
            }
        }
        
        // Screen Shake decay
        if (screenShake > 0) {
            camera.position.x += (Math.random() - 0.5) * screenShake;
            camera.position.y += (Math.random() - 0.5) * screenShake;
            screenShake = Math.max(0, screenShake - delta * 0.5);
        }

        // Apply Movement & Gravity
        velocity.y -= 24 * delta;
        
        // Slide boost decay
        if (slideBoost > 1.0 && playerOnFloor) slideBoost -= 2.0 * delta;
        if (slideBoost < 1.0) slideBoost = 1.0;

        const isSliding = keys.c && playerOnFloor && !isAiming && slideCooldownLeft > 0;
        const targetHeight = isSliding ? 1.08 : 1.68;
        camera.position.y += (targetHeight - camera.position.y) * 10 * delta;

        // Realistic speeds (Tactical shooter feel)
        const baseSpeed = keys.shift ? 7.2 : 4.9;
        const weaponMobility = 0.85 + currentWeapon.stats.mobility / 400;
        const speed = (isSliding ? baseSpeed * slideBoost : baseSpeed) * weaponMobility;

        direction.set(0, 0, 0);
        if (keys.w) direction.z -= 1;
        if (keys.s) direction.z += 1;
        if (keys.a) direction.x -= 1;
        if (keys.d) direction.x += 1;
        direction.normalize();
        direction.applyQuaternion(camera.quaternion);
        direction.y = 0; 
        direction.normalize();

        const friction = playerOnFloor ? (isSliding ? 3.5 : 14) : 0.9;
        velocity.x -= velocity.x * friction * delta;
        velocity.z -= velocity.z * friction * delta;

        if (direction.lengthSq() > 0 && (!isSliding || !playerOnFloor)) {
            const accel = playerOnFloor ? 24 : 3.2;
            velocity.x += direction.x * speed * accel * delta;
            velocity.z += direction.z * speed * accel * delta;
        }
        if (!playerOnFloor && direction.lengthSq() > 0) {
            const airStrafe = 1.25;
            velocity.x += direction.x * airStrafe * delta;
            velocity.z += direction.z * airStrafe * delta;
        }

        const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
        const maxGroundSpeed = speed * (isSliding ? 1.2 : 1.0);
        const maxAirSpeed = speed * 0.95;
        const maxSpeed = playerOnFloor ? maxGroundSpeed : maxAirSpeed;
        if (horizontalSpeed > maxSpeed && horizontalSpeed > 0.0001) {
            const inv = maxSpeed / horizontalSpeed;
            velocity.x *= inv;
            velocity.z *= inv;
        }

        cameraGroup.position.addScaledVector(velocity, delta);

        // Map Collision (BVH)
        playerOnFloor = false;
        if (mapCollider) {
            capsuleBase.copy(cameraGroup.position);
            capsuleBase.y += playerRadius; 
            
            capsuleTop.copy(cameraGroup.position);
            capsuleTop.y += playerHeight - playerRadius;

            capsuleCenters[0].copy(capsuleBase);
            capsuleCenters[1].lerpVectors(capsuleBase, capsuleTop, 0.33);
            capsuleCenters[2].lerpVectors(capsuleBase, capsuleTop, 0.66);
            capsuleCenters[3].copy(capsuleTop);

            mapCollider.geometry.boundsTree.shapecast({
                intersectsBounds: box => {
                    for (let i = 0; i < capsuleCenters.length; i++) {
                        if (box.distanceToPoint(capsuleCenters[i]) <= playerRadius) return true;
                    }
                    return false;
                },
                intersectsTriangle: tri => {
                    for (let i = 0; i < capsuleCenters.length; i++) {
                        const center = capsuleCenters[i];
                        tri.closestPointToPoint(center, tempPoint);
                        const distance = tempPoint.distanceTo(center);

                        if (distance < playerRadius) {
                            const depth = playerRadius - distance;
                            const pushDir = tempPushDir.subVectors(center, tempPoint);
                            if (pushDir.lengthSq() < 1e-6) continue;
                            pushDir.normalize();
                            cameraGroup.position.addScaledVector(pushDir, depth);

                            capsuleBase.copy(cameraGroup.position);
                            capsuleBase.y += playerRadius;
                            capsuleTop.copy(cameraGroup.position);
                            capsuleTop.y += playerHeight - playerRadius;
                            capsuleCenters[0].copy(capsuleBase);
                            capsuleCenters[1].lerpVectors(capsuleBase, capsuleTop, 0.33);
                            capsuleCenters[2].lerpVectors(capsuleBase, capsuleTop, 0.66);
                            capsuleCenters[3].copy(capsuleTop);

                            if (pushDir.y > 0.45) {
                                playerOnFloor = true;
                                if (velocity.y < 0) velocity.y = 0;
                            }
                        }
                    }
                }
            });
        }
        if (!wasOnFloor && playerOnFloor) landedRecentlyTimer = 0.15;

        // Death Plane: If you fall off the map, respawn in the sky
        if (cameraGroup.position.y < -40) {
            cameraGroup.position.copy(spawnPoint);
            velocity.set(0, 0, 0);
        }

        if (myId) {
            socket.emit('playerMovement', {
                position: cameraGroup.position,
                rotation: { y: camera.rotation.y },
                state: keys.shift ? 'sprinting' : 'running'
            });
        }
    }

    // Remote Player Interpolation (Smooth Multiplayer)
    Object.keys(players).forEach(id => {
        const p = players[id];
        if (p.mesh && p.targetPosition) {
            // Lerp X and Z
            p.mesh.position.x += (p.targetPosition.x - p.mesh.position.x) * 10 * delta;
            p.mesh.position.z += (p.targetPosition.z - p.mesh.position.z) * 10 * delta;
            
            // Gravity and Ground Snapping
            p.mesh.userData.velocityY = (p.mesh.userData.velocityY || 0) - 24 * delta;
            p.mesh.position.y += p.mesh.userData.velocityY * delta;
            
            if (mapCollider) {
                shootRaycaster.set(new THREE.Vector3(p.mesh.position.x, p.mesh.position.y + 1, p.mesh.position.z), new THREE.Vector3(0, -1, 0));
                const hits = shootRaycaster.intersectObject(mapCollider);
                if (hits.length > 0 && hits[0].distance <= 1.2) {
                    p.mesh.position.y = hits[0].point.y;
                    p.mesh.userData.velocityY = 0;
                }
            }

            // Simple rotation lerp
            p.mesh.rotation.y += (p.targetRotationY - p.mesh.rotation.y) * 10 * delta;

            // Procedural humanlike bobbing and lean
            const distSq = Math.pow(p.targetPosition.x - p.mesh.position.x, 2) + Math.pow(p.targetPosition.z - p.mesh.position.z, 2);
            if (distSq > 0.01) {
                p.mesh.userData.bobTimer = (p.mesh.userData.bobTimer || 0) + delta * 15;
                const bobOffset = Math.abs(Math.sin(p.mesh.userData.bobTimer)) * 0.05;
                p.mesh.position.y += bobOffset;
                p.mesh.rotation.x = 0.1; // lean forward
                if (p.mixer) p.mixer.update(delta);
            } else {
                p.mesh.rotation.x = 0;
                // If idle, maybe play a different animation or just idle update
                if (p.mixer) p.mixer.update(delta * 0.2); 
            }
            
            // Update bounding box continuously
            p.mesh.boundingBox.setFromObject(p.mesh);
        }
    });

    // Process Effects (Tracers, Decals, Dmg Numbers)
    for (let i = effectsData.length - 1; i >= 0; i--) {
        const effect = effectsData[i];
        effect.age += delta;
        if (effect.age >= effect.maxAge) {
            if (effect.type === 'dmgNum') effect.el.remove();
            else scene.remove(effect.mesh);
            effectsData.splice(i, 1);
        } else {
            if (effect.type === 'tracer') {
                effect.mesh.material.opacity = 1.0 - (effect.age / effect.maxAge);
            } else if (effect.type === 'particle') {
                effect.mesh.position.addScaledVector(effect.vel, delta);
                effect.vel.y -= 9.8 * delta; // Gravity
            } else if (effect.type === 'dmgNum') {
                // Lerp pos up
                effect.pos.lerp(effect.endPos, 2 * delta);
                // Convert 3D to 2D
                const v = effect.pos.clone();
                v.project(camera);
                const x = (v.x * .5 + .5) * window.innerWidth;
                const y = (v.y * -.5 + .5) * window.innerHeight;
                effect.el.style.left = `${x}px`;
                effect.el.style.top = `${y}px`;
                effect.el.style.opacity = 1.0 - (effect.age / effect.maxAge);
            }
        }
    }

    renderer.render(scene, camera);
    minimapAccumulator += delta;
    if (minimapAccumulator >= 0.08) {
        drawMinimap();
        minimapAccumulator = 0;
    }
};

const sendProfile = () => {
    if (!socket.connected) return;
    const name = document.getElementById('player-name-input')?.value || 'SOLDIER_001';
    socket.emit('playerProfile', {
        name,
        loadout: selectedWeaponId
    });
};

const updateHud = () => {
    if (ammoCurrent) ammoCurrent.innerText = currentAmmo;
    if (ammoReserve) ammoReserve.innerText = reserveAmmo;
    if (healthText) healthText.innerText = localStats.health;
    if (healthBar) healthBar.style.width = `${localStats.health}%`;
    if (armorText) armorText.innerText = localStats.armor;
    if (armorBar) armorBar.style.width = `${localStats.armor}%`;
    if (hudWeaponName) hudWeaponName.innerText = currentWeapon.name;
    document.getElementById('slot-1-name').innerText = WEAPONS.assault.name;
    document.getElementById('slot-2-name').innerText = WEAPONS.smg.name;
    document.getElementById('slot-3-name').innerText = WEAPONS.shotgun.name;
};

const switchWeapon = (weaponId) => {
    if (isReloading || selectedWeaponId === weaponId) return;
    const next = WEAPONS[weaponId];
    if (!next) return;
    currentAmmo = next.ammo;
    reserveAmmo = next.reserve;
    equipWeapon(weaponId);
    document.querySelectorAll('.weapon-slot, .weapon-card').forEach((el) => {
        el.classList.toggle('selected', el.dataset.weapon === weaponId || el.dataset.slot === String(Object.keys(WEAPONS).indexOf(weaponId) + 1));
    });
};

const buildMenuData = () => {
    const mapGrid = document.getElementById('map-grid');
    if (mapGrid && !mapGrid.children.length) {
        MAPS.forEach((map) => {
            const card = document.createElement('button');
            card.className = `map-card ${map.id === selectedMap.id ? 'selected' : ''}`;
            card.dataset.map = map.id;
            card.innerHTML = `<strong>${map.name}</strong><span>Close-range lanes, ramps, and fast rotations.</span>`;
            card.addEventListener('click', () => {
                selectedMap = map;
                document.querySelectorAll('.map-card').forEach((el) => el.classList.toggle('selected', el.dataset.map === map.id));
            });
            mapGrid.appendChild(card);
        });
    }

    document.querySelectorAll('.mode-card').forEach((card) => {
        card.addEventListener('click', () => {
            selectedMode = card.dataset.mode;
            document.querySelectorAll('.mode-card').forEach((el) => el.classList.toggle('selected', el === card));
            document.getElementById('mode-display').innerText = card.querySelector('h3')?.innerText || 'DEATHMATCH';
            document.getElementById('scoreboard-mode').innerText = document.getElementById('mode-display').innerText;
        });
    });
    document.querySelector('.mode-card')?.classList.add('selected');

    const primary = document.getElementById('primary-weapons');
    if (primary && !primary.children.length) {
        Object.values(WEAPONS).forEach((weapon) => addWeaponCard(primary, weapon));
    }
    const secondary = document.getElementById('secondary-weapons');
    if (secondary && !secondary.children.length) addWeaponCard(secondary, WEAPONS.smg);
    const melee = document.getElementById('melee-weapons');
    if (melee && !melee.children.length) addWeaponCard(melee, WEAPONS.shotgun);

    bindMenuButton('btn-weapons', 'weapons-panel');
    bindMenuButton('btn-customize', 'customize-panel');
    bindMenuButton('btn-settings', 'settings-panel');
    bindMenuButton('btn-training', 'mode-select');
    bindCloseButton('close-mode', 'mode-select');
    bindCloseButton('close-map', 'map-select');
    bindCloseButton('close-weapons', 'weapons-panel');
    bindCloseButton('close-customize', 'customize-panel');
    bindCloseButton('close-settings', 'settings-panel');
    document.getElementById('player-name-input')?.addEventListener('change', sendProfile);
    document.getElementById('fov-slider')?.addEventListener('input', (e) => {
        document.getElementById('fov-value').innerText = e.target.value;
    });
    document.getElementById('quality-select')?.addEventListener('change', applyGraphicsSettings);
    document.getElementById('shadows-toggle')?.addEventListener('change', applyGraphicsSettings);
    document.getElementById('postfx-toggle')?.addEventListener('change', applyGraphicsSettings);
    document.getElementById('sensitivity-slider')?.addEventListener('input', (e) => {
        const sensitivity = Number(e.target.value || 5);
        document.getElementById('sensitivity-value').innerText = String(sensitivity);
        controls.pointerSpeed = THREE.MathUtils.clamp(sensitivity / 5, 0.4, 3.0);
    });
    applyGraphicsSettings();
};

const addWeaponCard = (parent, weapon) => {
    const card = document.createElement('button');
    card.className = `weapon-card ${weapon.id === selectedWeaponId ? 'selected' : ''}`;
    card.dataset.weapon = weapon.id;
    card.innerHTML = `<strong>${weapon.name}</strong><span>${weapon.ammo} rounds</span>`;
    card.addEventListener('click', () => {
        switchWeapon(weapon.id);
        document.getElementById('weapon-preview-name').innerText = weapon.name;
        Object.entries(weapon.stats).forEach(([key, value]) => {
            const el = document.getElementById(`stat-${key}`);
            if (el) el.style.width = `${value}%`;
        });
    });
    parent.appendChild(card);
};

const bindMenuButton = (buttonId, panelId) => {
    document.getElementById(buttonId)?.addEventListener('click', () => {
        document.querySelectorAll('.overlay-panel').forEach((panel) => panel.classList.add('hidden'));
        document.getElementById(panelId)?.classList.remove('hidden');
    });
};

const bindCloseButton = (buttonId, panelId) => {
    document.getElementById(buttonId)?.addEventListener('click', () => {
        document.getElementById(panelId)?.classList.add('hidden');
    });
};

const addKillFeed = (data) => {
    if (!killFeed) return;
    const killer = data.killerStats?.name || 'Player';
    const victim = data.victimStats?.name || 'Enemy';
    const item = document.createElement('div');
    item.className = 'kill-feed-item';
    item.innerHTML = `<span>${killer}</span><b>${data.headshot ? 'HEADSHOT' : 'ELIM'}</b><span>${victim}</span>`;
    killFeed.prepend(item);
    setTimeout(() => item.remove(), 4500);
};

const showKillNotification = (target, headshot) => {
    const note = document.getElementById('kill-notification');
    if (!note) return;
    document.getElementById('kill-type').innerText = headshot ? 'HEADSHOT' : 'ELIMINATED';
    document.getElementById('kill-target').innerText = target;
    note.classList.remove('hidden');
    setTimeout(() => note.classList.add('hidden'), 1600);
};

const showDamageIndicator = () => {
    const indicator = document.createElement('div');
    indicator.className = 'damage-flash';
    document.getElementById('damage-indicators')?.appendChild(indicator);
    setTimeout(() => indicator.remove(), 350);
};

const updateScoreboard = () => {
    if (!scoreboardBody) return;
    const rows = Object.values(lastLobbySnapshot).map((p) => ({
        id: p.id,
        name: p.id === myId ? (document.getElementById('player-name-input')?.value || p.name || 'You') : (p.name || `Soldier_${p.id.slice(0, 4)}`),
        kills: p.id === myId ? Math.max(localStats.kills, p.kills || 0) : (p.kills || 0),
        deaths: p.id === myId ? Math.max(localStats.deaths, p.deaths || 0) : (p.deaths || 0)
    })).sort((a, b) => b.kills - a.kills);
    scoreboardBody.innerHTML = rows.map((p, index) => {
        const kd = p.deaths === 0 ? p.kills.toFixed(2) : (p.kills / p.deaths).toFixed(2);
        return `<tr><td>${index + 1}</td><td>${p.name}${p.id === myId ? ' (YOU)' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${kd}</td><td>${p.kills * 100}</td></tr>`;
    }).join('');
};

const drawMinimap = () => {
    if (!minimapCtx || !isMatchActive) return;
    const size = minimapCanvas.width;
    minimapCtx.clearRect(0, 0, size, size);
    minimapCtx.fillStyle = 'rgba(5, 10, 20, 0.74)';
    minimapCtx.fillRect(0, 0, size, size);
    minimapCtx.strokeStyle = 'rgba(255,255,255,0.16)';
    minimapCtx.strokeRect(8, 8, size - 16, size - 16);
    const scale = 2.4;
    const drawDot = (x, z, color, radius) => {
        minimapCtx.beginPath();
        minimapCtx.fillStyle = color;
        minimapCtx.arc(size / 2 + x * scale, size / 2 + z * scale, radius, 0, Math.PI * 2);
        minimapCtx.fill();
    };
    drawDot(cameraGroup.position.x, cameraGroup.position.z, '#00ff88', 4);
    Object.values(players).forEach((p) => drawDot(p.mesh.position.x, p.mesh.position.z, '#ff3b62', 3));
};

socket.on('playerDamaged', (data) => {
    if (data.id === myId) {
        localStats.health = data.health;
        if(healthText) healthText.innerText = data.health;
        if(healthBar) healthBar.style.width = `${data.health}%`;
        showDamageIndicator();
    } else if (players[data.id]) {
        players[data.id].data.health = data.health;
    }
});
socket.on('playerKilled', (data) => {
    if (data.victimId === myId) {
        isDead = true;
        localStats.deaths++;
        document.getElementById('death-screen').classList.remove('hidden');
        document.getElementById('killed-by-name').innerText = data.killerStats?.name || 'Enemy';
    } else if (players[data.victimId]) {
        scene.remove(players[data.victimId].mesh);
        delete players[data.victimId];
    }
    if (data.killerId === myId) {
        localStats.kills++;
        if (data.headshot) localStats.headshots++;
        showKillNotification(data.victimStats?.name || 'Enemy', data.headshot);
    }
    addKillFeed(data);
    updateScoreboard();
});
socket.on('playerRespawned', (playerData) => {
    if (playerData.id === myId) {
        isDead = false;
        document.getElementById('death-screen').classList.add('hidden');
        cameraGroup.position.copy(playerData.position); 
        velocity.set(0,0,0);
        localStats.health = playerData.health;
        if(healthText) healthText.innerText = playerData.health;
        if(healthBar) healthBar.style.width = `100%`;
        currentAmmo = MAX_AMMO;
        reserveAmmo = currentWeapon.reserve;
        updateHud();
    } else {
        addRemotePlayer(playerData.id, playerData);
    }
    updateScoreboard();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyGraphicsSettings();
});

animate();


// Decal pool limit to avoid memory leaks during prolonged firefights
const MAX_BULLET_DECALS = 80;
const bulletDecalPool = [];
function pruneOldDecals(scene) {
  while (bulletDecalPool.length > MAX_BULLET_DECALS) {
    const oldest = bulletDecalPool.shift();
    if (oldest && oldest.parent) oldest.parent.remove(oldest);
  }
}
