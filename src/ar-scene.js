import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { disposeObject, playMarkerChime } from './utils.js';

/**
 * ARScene - Immersive 3D WebAR Experience for Swarajya Tribute.
 *
 * Features:
 * - Hero Monument (Client with Chhatrapati Shivaji Maharaj) placed directly in front (x: 0, z: -8.0m).
 * - Distant starting view: User approaches monument via walk controls, swipe, pinch, or physical steps.
 * - Interactive 360° Model Rotation: Single finger drag smoothly rotates the 3D model on its Y axis.
 * - Mobile Gyroscope: Calibrated DeviceOrientation parallax works reliably across Android & iOS.
 * - Direct Touch: Tapping anywhere on the 3D hero model or royal beacon opens the story card.
 */
export class ARScene {
  constructor({ onHeroSelected, onLoadingStart, onLoadingEnd, onDistanceUpdate } = {}) {
    this.canvas = document.getElementById('three-canvas');
    this.video = document.getElementById('camera-feed');
    this.onHeroSelected = onHeroSelected || (() => {});
    this.onLoadingStart = onLoadingStart || (() => {});
    this.onLoadingEnd = onLoadingEnd || (() => {});
    this.onDistanceUpdate = onDistanceUpdate || (() => {});

    // ── Three.js Scene ───────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Hero Placement (Directly in front, far distance) ─────────────
    // Starts 8.0 meters in front of the player (x: 0 is dead center)
    this.heroPos = new THREE.Vector3(0, 0, -8.0);

    // ── Player Camera & Walk Navigation ──────────────────────────────
    this.playerPos = new THREE.Vector3(0, 1.45, 0); // eye-level 1.45m
    this.targetPlayerZ = 0; // for walking closer/back
    this.lookPitch = -0.05; // slight downward gaze towards base
    this.lookYaw = 0;

    // Model 360° Rotation Angle
    this.modelRotationY = 0;
    this.autoRotate = false;

    // Mobile Gyroscope / DeviceOrientation State
    this.gyro = { alpha: 0, beta: 0, gamma: 0 };
    this.gyroOffset = { yaw: 0, pitch: 0 };
    this.gyroCalibrated = false;
    this.initialBeta = null;
    this.initialGamma = null;
    this.hasGyro = false;

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
    this.renderer.toneMappingExposure = 1.35;

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost.');
    }, false);
    this.canvas.addEventListener('webglcontextrestored', () => {
      this._handleResize();
    }, false);

    // ── 3D Loaders ───────────────────────────────────────────────────
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    // ── Hierarchy ────────────────────────────────────────────────────
    this.clock = new THREE.Clock();
    this.mixers = [];

    // Hero Monument Group
    this.heroGroup = new THREE.Group();
    this.heroGroup.name = 'HeroMonumentGroup';
    this.heroGroup.position.copy(this.heroPos);
    this.scene.add(this.heroGroup);
    this.heroModel = null;

    // Interactive Floating Marker
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);
    this.heroMarker = null;

    // Lighting & Environment
    this._setupLights();
    this._setupPedestalAndEmbers();

    // ── Interaction State ────────────────────────────────────────────
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-999, -999);
    this.isDragging = false;
    this.previousPointer = { x: 0, y: 0 };
    this.dragStartPointer = { x: 0, y: 0 };
    this.pinchDist = 0;

    // Loop
    this.isRunning = false;

    // Bindings
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._setupInteractionEvents();
    this._setupDeviceOrientation();
    this._setupMotionWalking();
  }

  /* ------------------------------------------------------------------ */
  /*  Lighting & Atmosphere                                              */
  /* ------------------------------------------------------------------ */
  _setupLights() {
    const ambientLight = new THREE.AmbientLight(0xfff7ed, 1.5);
    this.scene.add(ambientLight);

    // Sun key light illuminating the front of the monument
    const sunLight = new THREE.DirectionalLight(0xfffaec, 2.6);
    sunLight.position.set(2, 10, 4);
    sunLight.target.position.set(this.heroPos.x, 1.5, this.heroPos.z);
    this.scene.add(sunLight);
    this.scene.add(sunLight.target);

    // Golden rim light behind monument
    const rimLight = new THREE.DirectionalLight(0xc9a24b, 2.0);
    rimLight.position.set(-2, 7, -12);
    this.scene.add(rimLight);

    // Monument spotlight
    const spotLight = new THREE.PointLight(0xffd978, 2.8, 25);
    spotLight.position.set(this.heroPos.x, 4.0, this.heroPos.z + 2.0);
    this.scene.add(spotLight);
  }

  _setupPedestalAndEmbers() {
    // Royal Maratha Yantra Pedestal under the Monument
    const ringGroup = new THREE.Group();
    const goldMat = new THREE.MeshBasicMaterial({
      color: 0xc9a24b,
      transparent: true,
      opacity: 0.45,
    });

    // Outer Chakra Ring
    const outerRing = new THREE.Mesh(new THREE.RingGeometry(1.8, 1.86, 64), goldMat);
    outerRing.rotation.x = -Math.PI / 2;
    ringGroup.add(outerRing);

    // Middle Ring
    const midRing = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.15, 48), goldMat);
    midRing.rotation.x = -Math.PI / 2;
    ringGroup.add(midRing);

    // Center Disc
    const centerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 32),
      new THREE.MeshBasicMaterial({ color: 0x8a6a1e, transparent: true, opacity: 0.25 })
    );
    centerDisc.rotation.x = -Math.PI / 2;
    ringGroup.add(centerDisc);

    ringGroup.position.set(this.heroPos.x, 0.02, this.heroPos.z);
    this.heroGroundRing = ringGroup;
    this.scene.add(ringGroup);

    // Floating golden embers around the monument
    const count = 40;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const radius = 0.4 + Math.random() * 2.5;
      const angle = Math.random() * Math.PI * 2;
      positions[i * 3] = this.heroPos.x + Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.2 + Math.random() * 2.8;
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
      size: 0.15,
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
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
  /*  Camera, Distance & Walking Movement                               */
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

    // Combine manual pitch/yaw with gyroscope parallax
    const finalPitch = this.lookPitch + this.gyroOffset.pitch;
    const finalYaw = this.lookYaw + this.gyroOffset.yaw;

    const forwardX = Math.sin(finalYaw) * Math.cos(finalPitch);
    const forwardY = Math.sin(finalPitch);
    const forwardZ = -Math.cos(finalYaw) * Math.cos(finalPitch);

    const lookTarget = new THREE.Vector3(
      this.playerPos.x + forwardX * 10,
      this.playerPos.y + forwardY * 10,
      this.playerPos.z + forwardZ * 10
    );

    this.camera.lookAt(lookTarget);

    // Update real-time distance to monument
    const distance = Math.abs(this.heroPos.z - this.playerPos.z);
    if (this.onDistanceUpdate) {
      this.onDistanceUpdate(distance);
    }
  }

  walk(deltaMeters) {
    // Can walk from initial 0m down to -6.2m (which puts user 1.8m in front of the monument)
    this.targetPlayerZ = Math.max(-6.2, Math.min(1.0, this.targetPlayerZ + deltaMeters));
  }

  resetPosition() {
    this.targetPlayerZ = 0;
    this.lookPitch = -0.05;
    this.lookYaw = 0;
    this.modelRotationY = 0;
    if (this.heroModel) {
      this.heroModel.rotation.y = 0;
    }
    this.gyroCalibrated = false;
    this.gyroOffset = { yaw: 0, pitch: 0 };
    this._updateCamera();
  }

  /* ------------------------------------------------------------------ */
  /*  Robust Mobile Gyroscope / DeviceOrientation Engine               */
  /* ------------------------------------------------------------------ */
  _setupDeviceOrientation() {
    const orientationHandler = (e) => {
      // Must have at least beta and gamma
      if (e.beta === null || e.gamma === null) return;
      if (typeof e.beta !== 'number' || typeof e.gamma !== 'number') return;

      this.hasGyro = true;
      this.gyro.alpha = e.alpha || 0;
      this.gyro.beta = e.beta;
      this.gyro.gamma = e.gamma;

      // Calibrate reference holding angle on first arrival
      if (!this.gyroCalibrated) {
        this.initialBeta = e.beta;
        this.initialGamma = e.gamma;
        this.gyroCalibrated = true;
        return;
      }

      // Calculate deltas relative to user's natural holding position
      const deltaBeta = (e.beta - this.initialBeta) * (Math.PI / 180);
      const deltaGamma = (e.gamma - this.initialGamma) * (Math.PI / 180);

      // Smooth parallax look (yaw & pitch)
      // Clamped comfortably so camera never flips away from the monument
      const targetYaw = Math.max(-0.6, Math.min(0.6, deltaGamma * 0.7));
      const targetPitch = Math.max(-0.45, Math.min(0.45, -deltaBeta * 0.6));

      // Lerp for buttery smoothness
      this.gyroOffset.yaw += (targetYaw - this.gyroOffset.yaw) * 0.15;
      this.gyroOffset.pitch += (targetPitch - this.gyroOffset.pitch) * 0.15;
    };

    // Listen to both standard deviceorientation and Android's absolute event
    window.addEventListener('deviceorientationabsolute', orientationHandler, true);
    window.addEventListener('deviceorientation', orientationHandler, true);
  }

  /* ------------------------------------------------------------------ */
  /*  Physical Step Walking (Accelerometer Motion)                       */
  /* ------------------------------------------------------------------ */
  _setupMotionWalking() {
    let lastZ = 0;
    const motionHandler = (e) => {
      if (!e.acceleration) return;
      const z = e.acceleration.z || 0;
      if (Math.abs(z - lastZ) > 1.6) {
        this.walk(-0.15); // step forward
      }
      lastZ = z;
    };
    window.addEventListener('devicemotion', motionHandler, true);
  }

  /* ------------------------------------------------------------------ */
  /*  Hero 3D Model Loading (In-Front View)                             */
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
      }, 25000);

      this.gltfLoader.load(
        modelUrl,
        (gltf) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(safetyTimeout);

          this.heroModel = gltf.scene;

          // Normalize scale to ~3.2m tall (monumental presence seen from distance)
          const box = new THREE.Box3().setFromObject(this.heroModel);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const targetScale = 3.2 / maxDim;
          this.heroModel.scale.setScalar(targetScale);

          // Center horizontally, base directly on ground level
          this.heroModel.position.x = -center.x * targetScale;
          this.heroModel.position.z = -center.z * targetScale;
          this.heroModel.position.y = -box.min.y * targetScale;

          // Ensure model faces directly towards the camera (not side view)
          // If the model had sideways geometry, rotation aligns it
          this.heroModel.rotation.y = 0;

          // Double sided materials so all angles look solid
          this.heroModel.traverse((child) => {
            if (child.isMesh && child.material) {
              child.material.side = THREE.DoubleSide;
            }
          });

          // Play embedded skeletal animations if present
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
          console.warn('Hero model load error, using fallback:', err);
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
    group.name = 'HeroRoyalMarker';

    // Royal Crown / Saffron Emblem Sprite
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');

    // Royal pill container
    ctx.fillStyle = 'rgba(20, 16, 12, 0.90)';
    const r = 24, w = 480, h = 116, x = 16, y = 12;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#DE5B10';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.fillStyle = '#FFD978';
    ctx.font = 'bold 34px "Cinzel", serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑 50 Forts Tribute', 256, 50);

    ctx.fillStyle = '#FFFDF7';
    ctx.font = '500 24px "Inter", sans-serif';
    ctx.fillText('Tap Model to Hear Story', 256, 92);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.6, 0.44, 1);
    sprite.position.set(0, 3.4, 0);
    group.add(sprite);

    // Touch hit sphere encompassing the upper monument
    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 12, 12),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitTarget.position.set(0, 1.8, 0);
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

    const base1 = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.35, 8), stoneMat);
    base1.position.y = 0.175;
    group.add(base1);

    const base2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.0, 0.4, 8), stoneMat);
    base2.position.y = 0.55;
    group.add(base2);

    const chhatra = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      goldMat
    );
    chhatra.position.y = 2.0;
    group.add(chhatra);

    const kalash = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), goldMat);
    kalash.position.y = 2.45;
    group.add(kalash);

    return group;
  }

  /* ------------------------------------------------------------------ */
  /*  Interactive Touch & 360° Model Drag Rotation                      */
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
      // Two-finger pinch: walk closer / step back
      if (e.touches && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const diff = dist - this.pinchDist;
        this.walk(-diff * 0.012);
        this.pinchDist = dist;
        return;
      }

      const pos = getPointerPos(e);

      // Desktop hover check
      const rect = dom.getBoundingClientRect();
      this.mouse.x = ((pos.x - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((pos.y - rect.top) / rect.height) * 2 + 1;
      this._checkHover();

      if (!this.isDragging) return;

      const deltaX = pos.x - this.previousPointer.x;
      const deltaY = pos.y - this.previousPointer.y;

      // ── 360° MODEL ROTATION: Horizontal drag directly rotates the model!
      this.modelRotationY += deltaX * 0.01;
      if (this.heroModel) {
        this.heroModel.rotation.y = this.modelRotationY;
      }

      // Vertical swipe: walk closer (swipe up) or step back (swipe down)
      if (Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
        this.walk(-deltaY * 0.012);
      }

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

      // Tap / Touch Detection: quick tap on the model
      if (distMoved < 15) {
        this._handleClick(pos.x, pos.y);
      }

      this.isDragging = false;
    };

    const onWheel = (e) => {
      this.walk(e.deltaY * 0.005);
    };

    dom.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    dom.addEventListener('wheel', onWheel, { passive: true });
  }

  _checkHover() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      [this.heroGroup, this.markerGroup],
      true
    );
    this.canvas.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
  }

  /**
   * Raycast Touch Handler:
   * Tapping anywhere on the Hero 3D model or its marker triggers onHeroSelected()
   */
  _handleClick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

    const targets = [];
    if (this.heroGroup) targets.push(this.heroGroup);
    if (this.markerGroup) targets.push(this.markerGroup);

    const intersects = this.raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
      playMarkerChime(528);
      this.onHeroSelected();
    }
  }

  /** Rotate model 360° continuously or toggle */
  toggleAutoRotate() {
    this.autoRotate = !this.autoRotate;
    return this.autoRotate;
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

    // 3. Auto rotation if enabled
    if (this.autoRotate && this.heroModel) {
      this.modelRotationY += delta * 0.5;
      this.heroModel.rotation.y = this.modelRotationY;
    }

    // 4. Marker bobbing
    if (this.heroMarker) {
      this.heroMarker.position.y = this.heroMarker.userData.baseY + Math.sin(elapsed * 2.2) * 0.06;
    }

    // 5. Subtle pedestal ground ring rotation
    if (this.heroGroundRing) {
      this.heroGroundRing.rotation.y = elapsed * 0.03;
    }

    // 6. Floating golden embers
    if (this.particles) {
      this.particles.rotation.y = elapsed * 0.02;
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
    if (this.heroMarker) disposeObject(this.heroMarker);
    if (this.heroGroundRing) disposeObject(this.heroGroundRing);
    if (this.particles) disposeObject(this.particles);
    this.renderer.dispose();
    this.dracoLoader.dispose();
  }
}
