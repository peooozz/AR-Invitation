import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { disposeObject, playMarkerChime } from './utils.js';

/**
 * ARScene - Pokemon GO style first-person WebAR experience.
 *
 * Everything is in front of the player (facing -Z).
 * - Player starts at (0, 1.45, 0) at natural eye height.
 * - Hero model (Shivaji Maharaj & client) is placed ~6.5m in front at (0, 0, -6.5).
 * - As the user walks physically or swipes up, they get closer to the monument!
 * - Fort 1 (Raigad Fort) is placed in front at (-1.8, 0, -4.8) with its floating gold marker.
 * - All generated/placeholder forts have been completely removed.
 */
export class ARScene {
  constructor({ onFortSelected, onLoadingStart, onLoadingEnd, onDistanceUpdate } = {}) {
    this.canvas = document.getElementById('three-canvas');
    this.video = document.getElementById('camera-feed');
    this.onFortSelected = onFortSelected || (() => {});
    this.onLoadingStart = onLoadingStart || (() => {});
    this.onLoadingEnd = onLoadingEnd || (() => {});
    this.onDistanceUpdate = onDistanceUpdate || (() => {});

    // ── Three.js Scene ───────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Positions & Hierarchy (Pokemon GO Distance Setup) ───────────
    // Hero monument (Chhatrapati Shivaji Maharaj & client) far in front
    this.heroPos = new THREE.Vector3(0, 0, -9.5);
    // Raigad Fort situated in front to the left
    this.fortPos = new THREE.Vector3(-3.2, 0, -6.5);

    // ── Player & Camera (Pokemon GO First-Person AR Perspective) ────
    this.playerPos = new THREE.Vector3(0, 1.45, 0); // eye-level
    this.targetPlayerZ = 0; // for smooth walking lerp
    this.lookYaw = 0; // horizontal angle
    this.lookPitch = -0.01; // eye-level gaze centered on horizon monument

    // Gyroscope / DeviceOrientation offset
    this.gyro = { alpha: 0, beta: 0, gamma: 0 };
    this.gyroOffset = { x: 0, y: 0 };
    this.hasGyro = false;

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(56, aspect, 0.1, 100);
    this._updateCamera();

    // ── Renderer ─────────────────────────────────────────────────────
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
    this.renderer.toneMappingExposure = 1.25;

    // Handle WebGL context loss/restore safely on mobile devices
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL Context Lost. Awaiting restoration...');
    }, false);
    this.canvas.addEventListener('webglcontextrestored', () => {
      console.log('WebGL Context Restored.');
      this._handleResize();
    }, false);

    // ── Loaders ──────────────────────────────────────────────────────
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    // ── Lighting & Atmosphere ────────────────────────────────────────
    this._setupLights();

    // ── Models & Scene Hierarchy ─────────────────────────────────────
    this.clock = new THREE.Clock();
    this.mixers = [];

    // Hero monument group positioned ~9.5m in front of player
    this.heroGroup = new THREE.Group();
    this.heroGroup.name = 'HeroMonumentGroup';
    this.heroGroup.position.copy(this.heroPos);
    this.scene.add(this.heroGroup);
    this.heroModel = null;

    this._setupHeroPedestalAndAura();

    // Fort container (placed in front of player at -7.0m)
    this.fortGroup = new THREE.Group();
    this.fortGroup.name = 'FortGroup';
    this.fortGroup.position.copy(this.fortPos);
    this.scene.add(this.fortGroup);
    this.fortModel = null;

    // Fort marker group
    this.fortMarkers = [];
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);

    // ── Interaction State ────────────────────────────────────────────
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.isDragging = false;
    this.previousPointer = { x: 0, y: 0 };
    this.dragStartPointer = { x: 0, y: 0 };
    this.pinchDist = 0;
    this.hoveredMarker = null;

    // Running Loop
    this.isRunning = false;
    this.onUpdate = null;

    // Bindings
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._setupInteractionEvents();
    this._setupMotionWalking();
  }

  /* ------------------------------------------------------------------ */
  /*  Lighting & Atmosphere                                              */
  /* ------------------------------------------------------------------ */
  _setupLights() {
    // Ambient warm fill
    const ambientLight = new THREE.AmbientLight(0xfff8ee, 1.2);
    this.scene.add(ambientLight);

    // Sunlit key light pointing down and forward toward the monument
    const keyLight = new THREE.DirectionalLight(0xfffaed, 2.2);
    keyLight.position.set(5, 12, 4);
    keyLight.target.position.set(this.heroPos.x, 2.0, this.heroPos.z);
    this.scene.add(keyLight);
    this.scene.add(keyLight.target);

    // Rim light from behind the monument for dramatic silhouette
    const rimLight = new THREE.DirectionalLight(0xc9a24b, 1.6);
    rimLight.position.set(-3, 8, -14);
    this.scene.add(rimLight);

    // Monument spotlight
    const heroSpot = new THREE.PointLight(0xc9a24b, 2.4, 30);
    heroSpot.position.set(this.heroPos.x, 5.5, this.heroPos.z);
    this.scene.add(heroSpot);

    // Fort spotlight (illuminates Raigad Fort)
    const fortSpot = new THREE.PointLight(0xffd978, 2.2, 25);
    fortSpot.position.set(this.fortPos.x, 4.5, this.fortPos.z);
    this.scene.add(fortSpot);
  }

  _setupHeroPedestalAndAura() {
    // Golden royal Maratha yantra on the ground under the hero monument
    const ringGroup = new THREE.Group();
    const goldMat = new THREE.MeshBasicMaterial({
      color: 0xc9a24b,
      transparent: true,
      opacity: 0.35,
    });

    const outerRing = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.48, 64), goldMat);
    outerRing.rotation.x = -Math.PI / 2;
    ringGroup.add(outerRing);

    const innerRing = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.25, 48), goldMat);
    innerRing.rotation.x = -Math.PI / 2;
    ringGroup.add(innerRing);

    const centerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 32),
      new THREE.MeshBasicMaterial({ color: 0x8a6a1e, transparent: true, opacity: 0.15 })
    );
    centerDisc.rotation.x = -Math.PI / 2;
    ringGroup.add(centerDisc);

    ringGroup.position.set(this.heroPos.x, 0.01, this.heroPos.z);
    this.heroGroundRing = ringGroup;
    this.scene.add(ringGroup);

    // Floating gold dust particles around monument
    const particleCount = 50;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const radius = 0.5 + Math.random() * 3.0;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = this.heroPos.x + Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.2 + Math.random() * 3.5;
      positions[i * 3 + 2] = this.heroPos.z + Math.sin(angle) * radius;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 240, 190, 1)');
    grad.addColorStop(0.35, 'rgba(201, 162, 75, 0.85)');
    grad.addColorStop(1, 'rgba(201, 162, 75, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.PointsMaterial({
      color: 0xffeaad,
      size: 0.18,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  /* ------------------------------------------------------------------ */
  /*  First-Person Camera Movement & Proximity                           */
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
    // Smooth lerp to target walk position
    this.playerPos.z += (this.targetPlayerZ - this.playerPos.z) * 0.12;

    this.camera.position.copy(this.playerPos);

    // Combine manual look with gyroscope
    const totalYaw = this.lookYaw + this.gyroOffset.x;
    const totalPitch = this.lookPitch + this.gyroOffset.y;

    // Look target along forward direction
    const forwardX = Math.sin(totalYaw) * Math.cos(totalPitch);
    const forwardY = Math.sin(totalPitch);
    const forwardZ = -Math.cos(totalYaw) * Math.cos(totalPitch);

    const lookAt = new THREE.Vector3(
      this.playerPos.x + forwardX * 10,
      this.playerPos.y + forwardY * 10,
      this.playerPos.z + forwardZ * 10
    );

    this.camera.lookAt(lookAt);

    // Calculate distance to monument and notify HUD
    const heroZ = (this.heroPos && this.heroPos.z !== undefined) ? this.heroPos.z : -9.5;
    const distanceToHero = Math.abs(heroZ - this.playerPos.z);
    if (this.onDistanceUpdate) {
      this.onDistanceUpdate(distanceToHero);
    }
  }

  /** Walk closer or step back */
  walk(deltaMeters) {
    // Clamp walking between +1.5m (back) and -7.8m (standing right before monument at ~1.7m distance)
    this.targetPlayerZ = Math.max(-7.8, Math.min(1.5, this.targetPlayerZ + deltaMeters));
  }

  resetPosition() {
    this.targetPlayerZ = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.01;
    this.gyroOffset = { x: 0, y: 0 };
    this._updateCamera();
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
      // No camera or permission denied: hide video so royal palace gradient shows!
      this.video.srcObject = null;
      this.video.classList.add('fallback-bg');
      this.video.style.display = 'none';
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Hero 3D Model Loading (Placed Far in Front)                         */
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
          this.onLoadingEnd();
          resolve(this.heroModel);
        }
      }, 25000);

      this.gltfLoader.load(
        modelUrl,
        (gltf) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safetyTimeout);

          this.heroModel = gltf.scene;

          // Normalize scale to ~3.8m tall (monumental presence in distance)
          const box = new THREE.Box3().setFromObject(this.heroModel);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const targetScale = 3.8 / maxDim;
          this.heroModel.scale.setScalar(targetScale);

          // Center horizontally, base on ground
          this.heroModel.position.x = -center.x * targetScale;
          this.heroModel.position.z = -center.z * targetScale;
          this.heroModel.position.y = -box.min.y * targetScale;

          // Double sided materials so all angles look solid
          this.heroModel.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.side = THREE.DoubleSide;
            }
          });

          // Play embedded animations if present
          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(this.heroModel);
            gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
            this.mixers.push(mixer);
          }

          this.heroGroup.add(this.heroModel);
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
          console.warn('Hero model load error, using fallback:', err);
          this.heroModel = this._createFallbackHeroMonument();
          this.heroGroup.add(this.heroModel);
          this.onLoadingEnd();
          resolve(this.heroModel);
        }
      );
    });
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

    const base1 = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.35, 8), stoneMat);
    base1.position.y = 0.175;
    group.add(base1);

    const base2 = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.4, 8), stoneMat);
    base2.position.y = 0.55;
    group.add(base2);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.85, 0.15, 8), goldMat);
    cap.position.y = 0.825;
    group.add(cap);

    const chhatra = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      goldMat
    );
    chhatra.position.y = 2.05;
    group.add(chhatra);

    const kalash = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), goldMat);
    kalash.position.y = 2.5;
    group.add(kalash);

    const emblem = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16), goldMat);
    emblem.position.set(0, 1.4, 0);
    group.add(emblem);

    return group;
  }

  /* ------------------------------------------------------------------ */
  /*  Fort 1 (Raigad) 3D Model & In-Front Marker                         */
  /* ------------------------------------------------------------------ */
  setupFortMarkers(fortsList) {
    while (this.markerGroup.children.length > 0) {
      const obj = this.markerGroup.children[0];
      this.markerGroup.remove(obj);
      disposeObject(obj);
    }
    this.fortMarkers = [];

    // Filter to only the fort(s) the user provided (Raigad / fort1)
    const activeForts = fortsList.slice(0, 1);

    activeForts.forEach((fort) => {
      // Place marker directly in front of the player, hovering above Fort 1
      const marker = this._createMarkerMesh(fort);
      const markerY = 2.4;
      marker.position.set(this.fortPos.x, markerY, this.fortPos.z);
      marker.userData = {
        fort,
        baseY: markerY,
      };

      this.markerGroup.add(marker);
      this.fortMarkers.push(marker);

      // Immediately load the real fort 3D model into fortGroup!
      this._loadInitialFortModel(fort);
    });
  }

  _createMarkerMesh(fort) {
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
    const ringGeo = new THREE.TorusGeometry(0.42, 0.035, 8, 24);
    const ringMesh = new THREE.Mesh(ringGeo, goldMat);
    group.add(ringMesh);
    group.userData.ringMesh = ringMesh;

    // 2. Central gold diamond core
    const coreGeo = new THREE.OctahedronGeometry(0.24, 0);
    const coreMesh = new THREE.Mesh(coreGeo, goldMat);
    group.add(coreMesh);
    group.userData.coreMesh = coreMesh;

    // 3. Vertical beacon beam
    const beamGeo = new THREE.CylinderGeometry(0.05, 0.14, 1.6, 8, 1, true);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffd978,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 0.9;
    group.add(beam);
    group.userData.beam = beam;

    // 4. Floating label sprite
    const labelSprite = this._createFortLabelSprite(fort.name, fort.nameMarathi);
    labelSprite.position.set(0, 0.72, 0);
    group.add(labelSprite);
    group.userData.labelSprite = labelSprite;

    // 5. Touch hit sphere
    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitTarget.userData.parentMarker = group;
    group.add(hitTarget);
    group.userData.hitTarget = hitTarget;

    return group;
  }

  _createFortLabelSprite(nameEn, nameMr) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 144;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(20, 16, 12, 0.85)';
    const r = 24, w = 480, h = 120, x = 16, y = 12;
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
    ctx.font = 'bold 36px "Cinzel", serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(nameEn, 256, 52);

    if (nameMr) {
      ctx.fillStyle = '#C9A24B';
      ctx.font = '500 24px "Inter", sans-serif';
      ctx.fillText(nameMr, 256, 96);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.6, 0.45, 1);
    return sprite;
  }

  async _loadInitialFortModel(fort) {
    const modelPath = `/models/${fort.id}.glb`;
    try {
      const gltf = await this._loadGLBPromise(modelPath);
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
      const targetScale = 3.0 / maxDim;

      model.scale.setScalar(targetScale);
      model.position.x = -center.x * targetScale;
      model.position.z = -center.z * targetScale;
      model.position.y = -box.min.y * targetScale;

      this.fortGroup.add(model);
      this.fortModel = model;
    } catch (e) {
      console.warn(`Could not load model for ${fort.name}:`, e.message);
    }
  }

  selectFort(fort) {
    if (!fort) return;
    playMarkerChime(587.33);

    // Marker pulse
    this.fortMarkers.forEach((m) => {
      if (m.userData.beam) m.userData.beam.material.opacity = 0.85;
      if (m.userData.coreMesh) m.userData.coreMesh.material.emissiveIntensity = 0.9;
    });

    this.onFortSelected(fort);
  }

  deselectFort() {
    this.fortMarkers.forEach((m) => {
      if (m.userData.beam) m.userData.beam.material.opacity = 0.4;
      if (m.userData.coreMesh) m.userData.coreMesh.material.emissiveIntensity = 0.4;
    });
  }

  _loadGLBPromise(url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, resolve, undefined, reject);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Gyroscope & Parallax                                               */
  /* ------------------------------------------------------------------ */
  setupDeviceOrientation() {
    let initialBeta = null;
    let initialGamma = null;

    const handler = (e) => {
      if (e.beta === null || e.gamma === null) return;
      if (typeof e.beta !== 'number' || typeof e.gamma !== 'number') return;

      // Calibrate reference center to how the user holds the phone at startup
      if (initialBeta === null) {
        initialBeta = e.beta;
        initialGamma = e.gamma;
      }

      this.hasGyro = true;
      this.gyro.alpha = e.alpha || 0;
      this.gyro.beta = e.beta;
      this.gyro.gamma = e.gamma;

      // Delta relative to reference holding angle
      const dPitch = (e.beta - initialBeta) * (Math.PI / 180);
      const dYaw = (e.gamma - initialGamma) * (Math.PI / 180);

      // Subtle, stable parallax (clamped so camera never flips away)
      this.gyroOffset.x = Math.max(-0.25, Math.min(0.25, dYaw * 0.4));
      this.gyroOffset.y = Math.max(-0.2, Math.min(0.2, -dPitch * 0.35));
    };
    window.addEventListener('deviceorientation', handler, true);
  }

  /* ------------------------------------------------------------------ */
  /*  Walking Acceleration (DeviceMotion)                                 */
  /* ------------------------------------------------------------------ */
  _setupMotionWalking() {
    let lastZAcc = 0;
    const motionHandler = (e) => {
      if (!e.acceleration) return;
      const zAcc = e.acceleration.z || 0;
      // Step detection: sudden forward acceleration
      if (Math.abs(zAcc - lastZAcc) > 1.8) {
        this.walk(-0.15); // step forward
      }
      lastZAcc = zAcc;
    };
    window.addEventListener('devicemotion', motionHandler, true);
  }

  /* ------------------------------------------------------------------ */
  /*  Touch Drag / Swipe Walking & Looking                               */
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
      // Pinch to walk closer or step back
      if (e.touches && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const diff = dist - this.pinchDist;
        this.walk(-diff * 0.015);
        this.pinchDist = dist;
        return;
      }

      const pos = getPointerPos(e);

      // Check hover
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((pos.x - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((pos.y - rect.top) / rect.height) * 2 + 1;
      this._checkHover();

      if (!this.isDragging) return;

      const deltaX = pos.x - this.previousPointer.x;
      const deltaY = pos.y - this.previousPointer.y;

      // Swiping UP moves forward towards the monument (Pokemon GO walk)
      // Swiping DOWN steps back
      this.walk(-deltaY * 0.012);

      // Swiping Left/Right turns look direction
      this.lookYaw -= deltaX * 0.005;

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

      // If it was a quick tap, check raycast click
      if (distMoved < 15) {
        this._handleClick(pos.x, pos.y);
      }

      this.isDragging = false;
    };

    // Wheel to walk forward/back
    const onWheel = (e) => {
      this.walk(e.deltaY * 0.004);
    };

    dom.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    dom.addEventListener('wheel', onWheel, { passive: true });
  }

  _checkHover() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hitTargets = this.fortMarkers.map((m) => m.userData.hitTarget);
    const intersects = this.raycaster.intersectObjects(hitTargets, false);

    if (intersects.length > 0) {
      const marker = intersects[0].object.userData.parentMarker;
      if (this.hoveredMarker !== marker) {
        this.hoveredMarker = marker;
        this.canvas.style.cursor = 'pointer';
      }
    } else {
      if (this.hoveredMarker) {
        this.hoveredMarker = null;
        this.canvas.style.cursor = 'default';
      }
    }
  }

  _handleClick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hitTargets = this.fortMarkers.map((m) => m.userData.hitTarget);
    const intersects = this.raycaster.intersectObjects(hitTargets, false);

    if (intersects.length > 0) {
      const marker = intersects[0].object.userData.parentMarker;
      if (marker && marker.userData.fort) {
        this.selectFort(marker.userData.fort);
      }
    }
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

    // 1. Update Skeletal Animation Mixers
    this.mixers.forEach((m) => m.update(delta));

    // 2. First-person camera update with smooth walking & gyroscope
    this._updateCamera();

    // 3. Floating Fort 1 Marker idle animation
    this.fortMarkers.forEach((marker) => {
      const { baseY, ringMesh, coreMesh } = marker.userData;
      marker.position.y = baseY + Math.sin(elapsed * 2.2) * 0.08;

      if (ringMesh) ringMesh.rotation.z += 0.015;
      if (coreMesh) coreMesh.rotation.y += 0.02;
    });

    // 4. Subtle rotation on ground ring
    if (this.heroGroundRing) {
      this.heroGroundRing.rotation.y = elapsed * 0.03;
    }

    // 5. Floating golden motes
    if (this.particles) {
      this.particles.rotation.y = elapsed * 0.025;
    }

    // 6. External hook
    if (this.onUpdate) {
      this.onUpdate(delta, elapsed);
    }

    // Render Scene
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
    if (this.heroGroundRing) disposeObject(this.heroGroundRing);
    if (this.particles) disposeObject(this.particles);
    this.renderer.dispose();
    this.dracoLoader.dispose();
  }
}
