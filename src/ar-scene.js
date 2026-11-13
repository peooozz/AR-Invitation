import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { disposeObject, playMarkerChime } from './utils.js';

/**
 * ARScene - Immersive WebAR 3D Experience with 360° Gyroscopic View.
 *
 * Designed for mobile rear-camera AR with realistic golden & ivory aesthetics.
 * - Hero Monument (Client with Chhatrapati Shivaji Maharaj) placed in front at (0.55, -0.3, -2.8).
 * - Fort Citadel (Raigad / Fort 1) placed gracefully beside hero at (-0.85, -0.3, -2.7).
 * - 360° Gyroscopic device orientation tracking allows looking around in all directions.
 * - Interactive touch drag allows 360° orbit/look around, and pinch-to-zoom for close-up inspection.
 * - Direct touch detection on BOTH 3D models (Hero model & Fort model) triggers historical narration.
 */
export class ARScene {
  constructor({ onHeroSelected, onFortSelected, onLoadingStart, onLoadingEnd, onDistanceUpdate } = {}) {
    this.canvas = document.getElementById('three-canvas');
    this.video = document.getElementById('camera-feed');
    this.onHeroSelected = onHeroSelected || (() => {});
    this.onFortSelected = onFortSelected || (() => {});
    this.onLoadingStart = onLoadingStart || (() => {});
    this.onLoadingEnd = onLoadingEnd || (() => {});
    this.onDistanceUpdate = onDistanceUpdate || (() => {});

    // ── Three.js Scene ───────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Accurate Ground Placement (Majestic Viewport Setup) ──────────
    // Hero monument (Shivaji Maharaj & client)
    this.heroPos = new THREE.Vector3(0.55, -0.35, -2.8);
    // Fort Citadel (Raigad Fort / Fort 1)
    this.fortPos = new THREE.Vector3(-0.85, -0.35, -2.7);

    // ── Camera & Orbit Perspective ──────────────────────────────────
    this.playerPos = new THREE.Vector3(0, 0, 0); // camera origin
    this.targetPlayerZ = 0; // for pinch / walk zoom
    this.lookYaw = 0; // horizontal angle
    this.lookPitch = -0.05; // slight downward gaze towards monuments

    // Gyroscope / DeviceOrientation state
    this.gyro = { alpha: 0, beta: 0, gamma: 0 };
    this.gyroQuaternion = new THREE.Quaternion();
    this.gyroInitialYaw = null;
    this.hasGyro = false;
    this.useGyro = true;

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(54, aspect, 0.1, 100);
    this._updateCamera();

    // ── WebGL Renderer ───────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;

    // WebGL Context recovery
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost.');
    }, false);
    this.canvas.addEventListener('webglcontextrestored', () => {
      this._handleResize();
    }, false);

    // ── 3D Model Loaders (Draco & Meshopt) ───────────────────────────
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    // ── Lighting ─────────────────────────────────────────────────────
    this._setupLights();

    // ── Hierarchy ────────────────────────────────────────────────────
    this.clock = new THREE.Clock();
    this.mixers = [];

    // Hero monument group
    this.heroGroup = new THREE.Group();
    this.heroGroup.name = 'HeroMonumentGroup';
    this.heroGroup.position.copy(this.heroPos);
    this.scene.add(this.heroGroup);
    this.heroModel = null;

    // Fort container group
    this.fortGroup = new THREE.Group();
    this.fortGroup.name = 'FortGroup';
    this.fortGroup.position.copy(this.fortPos);
    this.scene.add(this.fortGroup);
    this.fortModel = null;
    this.currentFort = null;

    // Interactive floating markers
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
    this.fortMarkers = [];
    this.heroMarker = null;

    // Ground rings & atmosphere
    this._setupPedestalsAndEmbers();

    // ── Interaction State ────────────────────────────────────────────
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.isDragging = false;
    this.previousPointer = { x: 0, y: 0 };
    this.dragStartPointer = { x: 0, y: 0 };
    this.pinchDist = 0;
    this.hoveredObject = null;

    // Loop
    this.isRunning = false;
    this.onUpdate = null;

    // Bindings
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._setupInteractionEvents();
    this._setupDeviceOrientation();
  }

  /* ------------------------------------------------------------------ */
  /*  Lighting & Atmosphere                                              */
  /* ------------------------------------------------------------------ */
  _setupLights() {
    // Warm natural sunlight
    const ambientLight = new THREE.AmbientLight(0xfff6e8, 1.4);
    this.scene.add(ambientLight);

    // Key light pointing towards both models
    const sunLight = new THREE.DirectionalLight(0xfffaec, 2.4);
    sunLight.position.set(4, 8, 3);
    sunLight.target.position.set(0, 0, -2.8);
    this.scene.add(sunLight);
    this.scene.add(sunLight.target);

    // Golden rim light behind models for royal silhouette
    const rimLight = new THREE.DirectionalLight(0xc9a24b, 1.8);
    rimLight.position.set(-2, 5, -6);
    this.scene.add(rimLight);

    // Spotlights for hero & fort
    const heroSpot = new THREE.PointLight(0xc9a24b, 2.5, 8);
    heroSpot.position.set(this.heroPos.x, 2.5, this.heroPos.z + 0.5);
    this.scene.add(heroSpot);

    const fortSpot = new THREE.PointLight(0xffd978, 2.2, 8);
    fortSpot.position.set(this.fortPos.x, 2.2, this.fortPos.z + 0.5);
    this.scene.add(fortSpot);
  }

  _setupPedestalsAndEmbers() {
    // 1. Royal Maratha Yantra Ring under Hero
    const heroRing = this._createRoyalGroundRing(0.9, 0xc9a24b);
    heroRing.position.set(this.heroPos.x, -0.34, this.heroPos.z);
    this.heroGroundRing = heroRing;
    this.scene.add(heroRing);

    // 2. Royal Maratha Yantra Ring under Fort
    const fortRing = this._createRoyalGroundRing(0.8, 0x8a6a1e);
    fortRing.position.set(this.fortPos.x, -0.34, this.fortPos.z);
    this.fortGroundRing = fortRing;
    this.scene.add(fortRing);

    // 3. Floating golden embers / particles
    const particleCount = 45;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 4.0;
      positions[i * 3 + 1] = -0.3 + Math.random() * 2.2;
      positions[i * 3 + 2] = -2.8 + (Math.random() - 0.5) * 2.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 240, 190, 1)');
    grad.addColorStop(0.4, 'rgba(201, 162, 75, 0.85)');
    grad.addColorStop(1, 'rgba(201, 162, 75, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.PointsMaterial({
      color: 0xffeaad,
      size: 0.12,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  _createRoyalGroundRing(radius, colorHex) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.45,
    });

    const outerRing = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 0.04, 48), mat);
    outerRing.rotation.x = -Math.PI / 2;
    group.add(outerRing);

    const innerRing = new THREE.Mesh(new THREE.RingGeometry(radius * 0.5, radius * 0.53, 36), mat);
    innerRing.rotation.x = -Math.PI / 2;
    group.add(innerRing);

    return group;
  }

  /* ------------------------------------------------------------------ */
  /*  Live Camera Feed                                                   */
  /* ------------------------------------------------------------------ */
  async startCamera(stream) {
    if (stream && stream.getVideoTracks && stream.getVideoTracks().length > 0) {
      this.video.srcObject = stream;
      this.video.classList.remove('fallback-bg');
      this.video.style.display = 'block';
      try {
        const p = this.video.play();
        if (p) p.catch(() => {});
      } catch {
        // silent
      }
    } else {
      this.video.srcObject = null;
      this.video.classList.add('fallback-bg');
      this.video.style.display = 'none';
    }
  }

  /* ------------------------------------------------------------------ */
  /*  First-Person Camera Movement & 360° Gyroscope                     */
  /* ------------------------------------------------------------------ */
  _handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  _updateCamera() {
    // Smooth lerp to target walk/zoom position
    this.playerPos.z += (this.targetPlayerZ - this.playerPos.z) * 0.15;
    this.camera.position.copy(this.playerPos);

    if (this.hasGyro && this.useGyro) {
      // Gyroscopic 360° Orientation
      this.camera.quaternion.copy(this.gyroQuaternion);
      // Combine manual drag yaw & pitch offset on top of gyro
      const manualEuler = new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ');
      const manualQuat = new THREE.Quaternion().setFromEuler(manualEuler);
      this.camera.quaternion.multiply(manualQuat);
    } else {
      // Touch/Mouse 360° Orbit Look
      const euler = new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(euler);
    }

    // Distance update for HUD
    const dist = Math.abs(-2.8 - this.playerPos.z);
    if (this.onDistanceUpdate) {
      this.onDistanceUpdate(dist);
    }
  }

  /**
   * 360-Degree Gyroscope Setup (DeviceOrientation)
   */
  _setupDeviceOrientation() {
    const zee = new THREE.Vector3(0, 0, 1);
    const euler = new THREE.Euler();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // - PI/2 on X

    const onDeviceOrientation = (e) => {
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      if (typeof e.alpha !== 'number') return;

      this.hasGyro = true;
      this.gyro.alpha = e.alpha;
      this.gyro.beta = e.beta;
      this.gyro.gamma = e.gamma;

      // Calibrate initial yaw so models start right in front of the user
      if (this.gyroInitialYaw === null) {
        this.gyroInitialYaw = e.alpha;
      }

      const alphaRad = ((e.alpha - this.gyroInitialYaw) * Math.PI) / 180;
      const betaRad = (e.beta * Math.PI) / 180;
      const gammaRad = (e.gamma * Math.PI) / 180;

      // Screen orientation angle (0 for portrait, 90 / -90 for landscape)
      let screenAngle = 0;
      if (window.screen && window.screen.orientation) {
        screenAngle = window.screen.orientation.angle || 0;
      } else if (typeof window.orientation === 'number') {
        screenAngle = window.orientation;
      }
      const orientRad = (screenAngle * Math.PI) / 180;

      // Full 360° spherical device orientation mapping
      euler.set(betaRad, alphaRad, -gammaRad, 'YXZ');
      this.gyroQuaternion.setFromEuler(euler);
      this.gyroQuaternion.multiply(q1); // orient camera out rear of phone
      this.gyroQuaternion.multiply(q0.setFromAxisAngle(zee, -orientRad));
    };

    window.addEventListener('deviceorientation', onDeviceOrientation, true);
  }

  walk(deltaMeters) {
    // Zoom closer or step back (clamped safely between +1.0m and -1.8m)
    this.targetPlayerZ = Math.max(-1.8, Math.min(1.0, this.targetPlayerZ + deltaMeters));
  }

  resetPosition() {
    this.targetPlayerZ = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.05;
    if (this.gyro.alpha !== undefined) {
      this.gyroInitialYaw = this.gyro.alpha;
    }
    this._updateCamera();
  }

  /* ------------------------------------------------------------------ */
  /*  Hero 3D Model Loading (Client & Shivaji Maharaj)                  */
  /* ------------------------------------------------------------------ */
  async loadHero(modelUrl = '/models/hero.glb', onProgress = null) {
    this.onLoadingStart('Loading Chhatrapati Shivaji Maharaj & Hero...');
    return new Promise((resolve) => {
      let resolved = false;

      const safetyTimeout = setTimeout(() => {
        if (!resolved) {
          console.warn('Hero model loading timed out, using fallback');
          resolved = true;
          this.heroModel = this._createFallbackHeroMonument();
          this.heroGroup.add(this.heroModel);
          this._setupHeroMarker();
          this.onLoadingEnd();
          resolve(this.heroModel);
        }
      }, 20000);

      this.gltfLoader.load(
        modelUrl,
        (gltf) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safetyTimeout);

          this.heroModel = gltf.scene;

          // Normalize scale to ~1.6m tall for comfortable AR viewing
          const box = new THREE.Box3().setFromObject(this.heroModel);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const targetScale = 1.6 / maxDim;
          this.heroModel.scale.setScalar(targetScale);

          // Center horizontally, base on ground
          this.heroModel.position.x = -center.x * targetScale;
          this.heroModel.position.z = -center.z * targetScale;
          this.heroModel.position.y = -box.min.y * targetScale;

          // Double sided materials
          this.heroModel.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.side = THREE.DoubleSide;
            }
          });

          // Embedded animations
          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(this.heroModel);
            gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
            this.mixers.push(mixer);
          }

          this.heroGroup.add(this.heroModel);
          this._setupHeroMarker();
          this.onLoadingEnd();
          resolve(this.heroModel);
        },
        (xhr) => {
          if (xhr.lengthComputable && xhr.total > 0) {
            const percent = Math.min(100, Math.round((xhr.loaded / xhr.total) * 100));
            this.onLoadingStart(`Loading Chhatrapati Shivaji Maharaj (${percent}%)...`);
            if (onProgress) onProgress(percent);
          }
        },
        (err) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safetyTimeout);
          console.warn('Hero model load error, using royal fallback:', err);
          this.heroModel = this._createFallbackHeroMonument();
          this.heroGroup.add(this.heroModel);
          this._setupHeroMarker();
          this.onLoadingEnd();
          resolve(this.heroModel);
        }
      );
    });
  }

  _setupHeroMarker() {
    if (this.heroMarker) {
      this.markerGroup.remove(this.heroMarker);
      disposeObject(this.heroMarker);
    }

    const group = new THREE.Group();
    group.name = 'HeroMarker';

    // Royal Crown / Saffron Emblem Sprite
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 130;
    const ctx = canvas.getContext('2d');

    // Pill background
    ctx.fillStyle = 'rgba(20, 16, 12, 0.88)';
    const r = 22, w = 480, h = 106, x = 16, y = 12;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#DE5B10'; // Saffron royal accent
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.fillStyle = '#FFD978';
    ctx.font = 'bold 32px "Cinzel", serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑 50 Forts Tribute', 256, 48);

    ctx.fillStyle = '#FFFDF7';
    ctx.font = '500 22px "Inter", sans-serif';
    ctx.fillText('Tap to hear Royal Story', 256, 88);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.4, 0.36, 1);
    sprite.position.set(0, 1.7, 0);
    group.add(sprite);

    // Touch hit target sphere
    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.85, 12, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitTarget.position.set(0, 0.8, 0);
    hitTarget.userData.isHero = true;
    group.add(hitTarget);

    group.position.set(this.heroPos.x, this.heroPos.y, this.heroPos.z);
    group.userData.baseY = this.heroPos.y;
    group.userData.isHero = true;

    this.markerGroup.add(group);
    this.heroMarker = group;
  }

  _createFallbackHeroMonument() {
    const group = new THREE.Group();
    group.name = 'HeroMonumentFallback';

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xc9a24b,
      metalness: 0.85,
      roughness: 0.25,
    });
    const stoneMat = new THREE.MeshStandardMaterial({
      color: 0x3a3328,
      roughness: 0.8,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 8), stoneMat);
    base.position.y = 0.1;
    group.add(base);

    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.8, 8), stoneMat);
    pillar.position.y = 0.55;
    group.add(pillar);

    const chhatra = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      goldMat
    );
    chhatra.position.y = 1.35;
    group.add(chhatra);

    const kalash = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 8), goldMat);
    kalash.position.y = 1.65;
    group.add(kalash);

    return group;
  }

  /* ------------------------------------------------------------------ */
  /*  Fort 3D Model & Interactive Marker                                 */
  /* ------------------------------------------------------------------ */
  setupFortMarkers(fortsList) {
    while (this.markerGroup.children.length > 0) {
      const obj = this.markerGroup.children[0];
      if (obj === this.heroMarker) {
        this.markerGroup.remove(obj);
        continue;
      }
      this.markerGroup.remove(obj);
      disposeObject(obj);
    }
    this.fortMarkers = [];

    // Re-add hero marker if already created
    if (this.heroMarker) {
      this.markerGroup.add(this.heroMarker);
    }

    if (!fortsList || fortsList.length === 0) return;

    // Use Fort 1 (Raigad) as the primary placed fort
    const fort = fortsList[0];
    this.currentFort = fort;

    const marker = this._createFortMarkerMesh(fort);
    const markerY = 1.1;
    marker.position.set(this.fortPos.x, markerY, this.fortPos.z);
    marker.userData = {
      fort,
      baseY: markerY,
    };

    this.markerGroup.add(marker);
    this.fortMarkers.push(marker);

    // Load fort 3D model
    this.loadFortModel(fort);
  }

  _createFortMarkerMesh(fort) {
    const group = new THREE.Group();
    group.name = `Marker_${fort.id}`;

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xc9a24b,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x3d2c0b,
      emissiveIntensity: 0.4,
    });

    // 1. Rotating gold chakra ring
    const ringGeo = new THREE.TorusGeometry(0.32, 0.025, 8, 24);
    const ringMesh = new THREE.Mesh(ringGeo, goldMat);
    group.add(ringMesh);
    group.userData.ringMesh = ringMesh;

    // 2. Central gold diamond core
    const coreGeo = new THREE.OctahedronGeometry(0.18, 0);
    const coreMesh = new THREE.Mesh(coreGeo, goldMat);
    group.add(coreMesh);
    group.userData.coreMesh = coreMesh;

    // 3. Vertical beacon beam
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.1, 1.2, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd978,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 0.65;
    group.add(beam);
    group.userData.beam = beam;

    // 4. Floating label sprite
    const labelSprite = this._createFortLabelSprite(fort.name, fort.nameMarathi);
    labelSprite.position.set(0, 0.6, 0);
    group.add(labelSprite);
    group.userData.labelSprite = labelSprite;

    // 5. Touch hit sphere
    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitTarget.userData.parentMarker = group;
    hitTarget.userData.fort = fort;
    group.add(hitTarget);
    group.userData.hitTarget = hitTarget;

    return group;
  }

  _createFortLabelSprite(nameEn, nameMr) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(20, 16, 12, 0.88)';
    const r = 22, w = 480, h = 116, x = 16, y = 12;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#C9A24B';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.fillStyle = '#FFFDF7';
    ctx.font = 'bold 34px "Cinzel", serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nameEn, 256, 50);

    if (nameMr) {
      ctx.fillStyle = '#C9A24B';
      ctx.font = '500 24px "Inter", sans-serif';
      ctx.fillText(nameMr, 256, 92);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.4, 0.38, 1);
    return sprite;
  }

  async loadFortModel(fort) {
    this.currentFort = fort;
    while (this.fortGroup.children.length > 0) {
      const child = this.fortGroup.children[0];
      this.fortGroup.remove(child);
      disposeObject(child);
    }
    this.fortModel = null;

    // Check paths: /models/raigad.glb or /models/fort1.glb or fort.modelPath
    const candidatePaths = [
      fort.modelPath,
      `/models/${fort.id}.glb`,
      '/models/fort1.glb',
      '/models/raigad.glb'
    ].filter(Boolean);

    let loaded = false;
    for (const path of candidatePaths) {
      try {
        const gltf = await this._loadGLBPromise(path);
        const model = gltf.scene;

        model.traverse((child) => {
          if (child.isMesh && child.material) {
            child.material.side = THREE.DoubleSide;
          }
        });

        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const targetScale = 1.4 / maxDim;

        model.scale.setScalar(targetScale);
        model.position.x = -center.x * targetScale;
        model.position.z = -center.z * targetScale;
        model.position.y = -box.min.y * targetScale;

        this.fortGroup.add(model);
        this.fortModel = model;
        loaded = true;
        break;
      } catch {
        // try next candidate
      }
    }

    if (!loaded) {
      // Procedural Maratha hill fortress fallback
      const fallback = this._createProceduralFort(fort);
      this.fortGroup.add(fallback);
      this.fortModel = fallback;
    }
  }

  _createProceduralFort(fort) {
    const group = new THREE.Group();
    group.name = `ProceduralFort_${fort.id}`;

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a4338, roughness: 0.9 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8a7a60, roughness: 0.7 });
    const saffronMat = new THREE.MeshStandardMaterial({ color: 0xde5b10, roughness: 0.4 });

    // Mountain hill base
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.6, 7), rockMat);
    mountain.position.y = 0.3;
    group.add(mountain);

    // Citadel walls
    const citadel = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.25, 8), wallMat);
    citadel.position.y = 0.65;
    group.add(citadel);

    // Bastions
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const bastion = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8), wallMat);
      bastion.position.set(Math.cos(angle) * 0.35, 0.65, Math.sin(angle) * 0.35);
      group.add(bastion);
    }

    // Fluttering Saffron Bhagwa Zenda (Flag)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), rockMat);
    pole.position.set(0, 0.95, 0);
    group.add(pole);

    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.25, 3), saffronMat);
    flag.rotation.z = Math.PI / 2;
    flag.position.set(0.1, 1.1, 0);
    group.add(flag);

    return group;
  }

  _loadGLBPromise(url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, resolve, undefined, reject);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Touch Interaction & Raycasting (BOTH MODELS CLICKABLE!)            */
  /* ------------------------------------------------------------------ */
  _setupInteractionEvents() {
    const dom = this.canvas;

    const getPointerPos = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { x: clientX, y: clientY };
    };

    const onPointerDown = (e) => {
      if (e.touches && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.pinchDist = Math.hypot(dx, dy);
        return;
      }

      this.isDragging = true;
      const pos = getPointerPos(e);
      this.previousPointer = { x: pos.x, y: pos.y };
      this.dragStartPointer = { x: pos.x, y: pos.y };
    };

    const onPointerMove = (e) => {
      // Two-finger pinch to zoom in/out
      if (e.touches && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const diff = dist - this.pinchDist;
        this.walk(-diff * 0.008);
        this.pinchDist = dist;
        return;
      }

      const pos = getPointerPos(e);

      // Check hover on desktop
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((pos.x - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((pos.y - rect.top) / rect.height) * 2 + 1;
      this._checkHover();

      if (!this.isDragging) return;

      const deltaX = pos.x - this.previousPointer.x;
      const deltaY = pos.y - this.previousPointer.y;

      // Full 360-degree horizontal yaw rotation
      this.lookYaw -= deltaX * 0.006;
      // Clamped vertical pitch tilt (-60° to +60°)
      this.lookPitch = Math.max(-1.0, Math.min(0.8, this.lookPitch - deltaY * 0.004));

      this.previousPointer = { x: pos.x, y: pos.y };
    };

    const onPointerUp = (e) => {
      const pos = e.changedTouches
        ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
        : { x: e.clientX, y: e.clientY };
      const distMoved = Math.hypot(
        pos.x - this.dragStartPointer.x,
        pos.y - this.dragStartPointer.y
      );

      // Tap / Touch Detection
      if (distMoved < 15) {
        this._handleClick(pos.x, pos.y);
      }

      this.isDragging = false;
    };

    const onWheel = (e) => {
      this.walk(e.deltaY * 0.003);
    };

    dom.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    dom.addEventListener('wheel', onWheel, { passive: true });
  }

  _checkHover() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      [this.heroGroup, this.fortGroup, this.markerGroup],
      true
    );

    if (intersects.length > 0) {
      this.canvas.style.cursor = 'pointer';
    } else {
      this.canvas.style.cursor = 'default';
    }
  }

  /**
   * Raycast Touch Handler:
   * Detects clicks on:
   * 1. Hero 3D Model or Hero Marker -> invokes onHeroSelected()
   * 2. Fort 3D Model or Fort Marker -> invokes onFortSelected()
   */
  _handleClick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

    // Test intersection against Hero group, Fort group, and Marker group
    const targets = [];
    if (this.heroGroup) targets.push(this.heroGroup);
    if (this.fortGroup) targets.push(this.fortGroup);
    if (this.markerGroup) targets.push(this.markerGroup);

    const intersects = this.raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
      let curr = intersects[0].object;
      let isHero = false;
      let isFort = false;

      while (curr && curr !== this.scene) {
        if (curr === this.heroGroup || curr.userData?.isHero || (this.heroMarker && curr === this.heroMarker)) {
          isHero = true;
          break;
        }
        if (curr === this.fortGroup || curr.userData?.parentMarker || curr.userData?.fort) {
          isFort = true;
          break;
        }
        curr = curr.parent;
      }

      if (isHero) {
        playMarkerChime(528);
        this.onHeroSelected();
        return;
      }

      if (isFort) {
        playMarkerChime(587.33);
        const fort = intersects[0].object.userData?.fort ||
                     intersects[0].object.userData?.parentMarker?.userData?.fort ||
                     this.currentFort;
        this.onFortSelected(fort);
        return;
      }
    }
  }

  selectFort(fort) {
    this.currentFort = fort;
    this.loadFortModel(fort);
    playMarkerChime(587.33);
    this.onFortSelected(fort);
  }

  deselectFort() {
    // reset marker highlights
  }

  /* ------------------------------------------------------------------ */
  /*  Render Loop & Animations                                           */
  /* ------------------------------------------------------------------ */
  start() {
    this.isRunning = true;
    this.clock.start();
    this._animate();
  }

  _animate() {
    if (!this.isRunning) return;
    requestAnimationFrame(() => this._animate());

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    // 1. Skeletal animations
    this.mixers.forEach((m) => m.update(delta));

    // 2. Camera & orientation update
    this._updateCamera();

    // 3. Floating markers bobbing
    this.fortMarkers.forEach((marker) => {
      const { baseY, ringMesh, coreMesh } = marker.userData;
      marker.position.y = baseY + Math.sin(elapsed * 2.2) * 0.05;
      if (ringMesh) ringMesh.rotation.z += 0.015;
      if (coreMesh) coreMesh.rotation.y += 0.02;
    });

    if (this.heroMarker) {
      this.heroMarker.position.y = this.heroMarker.userData.baseY + Math.sin(elapsed * 2.0 + 1) * 0.04;
    }

    // 4. Ground rings slow rotation
    if (this.heroGroundRing) {
      this.heroGroundRing.rotation.y = elapsed * 0.04;
    }
    if (this.fortGroundRing) {
      this.fortGroundRing.rotation.y = -elapsed * 0.03;
    }

    // 5. Floating embers
    if (this.particles) {
      this.particles.rotation.y = elapsed * 0.025;
    }

    // 6. External update callback
    if (this.onUpdate) {
      this.onUpdate(delta, elapsed);
    }

    this.renderer.render(this.scene, this.camera);
  }

  stop() {
    this.isRunning = false;
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    if (this.heroModel) disposeObject(this.heroModel);
    if (this.fortModel) disposeObject(this.fortModel);
    this.fortMarkers.forEach((m) => disposeObject(m));
    if (this.heroMarker) disposeObject(this.heroMarker);
    if (this.heroGroundRing) disposeObject(this.heroGroundRing);
    if (this.fortGroundRing) disposeObject(this.fortGroundRing);
    if (this.particles) disposeObject(this.particles);
    this.renderer.dispose();
    this.dracoLoader.dispose();
  }
}
