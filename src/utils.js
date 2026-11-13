/** @module utils – shared utility functions for the WebAR invitation */

/**
 * Request rear camera, return MediaStream or null.
 * Prefers the environment-facing camera at 720p/1080p.
 */
export async function requestCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn('getUserMedia is not supported on this browser or context (requires HTTPS).');
    return null;
  }
  // 1. Try environment-facing (rear) camera first for mobile AR
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch (e1) {
    console.warn('Environment camera request failed, falling back to any available camera:', e1);
    // 2. Fallback to any user/front camera (e.g. laptop webcam)
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
    } catch (e2) {
      console.warn('All camera access denied or unavailable:', e2);
      return null;
    }
  }
}

/** Try to go fullscreen on the document element. */
export async function requestFullscreen() {
  try {
    const el = document.documentElement;
    const fn =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.mozRequestFullScreen ||
      el.msRequestFullscreen;
    if (fn) await fn.call(el);
  } catch (e) {
    console.warn('Fullscreen request bypassed:', e);
  }
}

/** Try to lock orientation to landscape. Returns true on success. */
export async function lockLandscape() {
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape');
      return true;
    }
  } catch (e) {
    console.warn('Orientation lock failed (common on iOS / unprompted):', e);
  }
  return false;
}

/** Check if device is in portrait. */
export function isPortrait() {
  return window.innerHeight > window.innerWidth;
}

/**
 * Request iOS DeviceOrientation permission.
 * Must be invoked directly within a user-gesture handler (e.g. click/tap).
 * Returns true when permission is granted or not required (non-iOS).
 */
export async function requestOrientationPermission() {
  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      return perm === 'granted';
    } catch (e) {
      console.warn('iOS orientation permission denied:', e);
      return false;
    }
  }
  return true; // Non-iOS, permission not required
}

/**
 * Dispose a Three.js object tree (geometries + materials + textures).
 * Safe to call with null/undefined.
 */
export function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((mat) => {
        if (!mat) return;
        Object.keys(mat).forEach((prop) => {
          const val = mat[prop];
          if (val && typeof val === 'object' && typeof val.dispose === 'function') {
            val.dispose();
          }
        });
        mat.dispose();
      });
    }
  });
}

// ── Web Audio Synth (Royal Sound Effects) ────────────────────────────
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/** Play a gentle crystal gold chime on marker tap */
export function playMarkerChime(freq = 528) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.85);
  } catch {
    // audio failure silent
  }
}

/** Play royal gong/fanfare tone on beginning journey */
export function playRoyalIntro() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    [220, 277.18, 329.63, 440].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + idx * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.1);
      osc.stop(ctx.currentTime + 2.6);
    });
  } catch {
    // audio failure silent
  }
}

/**
 * Locate best available realistic Indian female voice in browser Web Speech API
 */
export function getIndianFemaleVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  // 1. Check known Indian female voice identifiers (iOS, Android, Windows, Mac)
  const preferredNames = ['veena', 'neerja', 'heera', 'lekha', 'aditi', 'priya', 'swara', 'anjali'];
  for (const name of preferredNames) {
    const match = voices.find((v) => v.name.toLowerCase().includes(name));
    if (match) return match;
  }

  // 2. English (India) female voice
  const inFemale = voices.find(
    (v) => (v.lang === 'en-IN' || v.lang === 'hi-IN') &&
           (v.name.toLowerCase().includes('female') || !v.name.toLowerCase().includes('male'))
  );
  if (inFemale) return inFemale;

  // 3. Any English (India) or Hindi (India) voice
  const anyIn = voices.find((v) => v.lang === 'en-IN' || v.lang === 'hi-IN');
  if (anyIn) return anyIn;

  // 4. Any clear female voice
  const generalFemale = voices.find(
    (v) => v.name.toLowerCase().includes('female') ||
           v.name.toLowerCase().includes('samantha') ||
           v.name.toLowerCase().includes('natural')
  );
  return generalFemale || voices[0] || null;
}
