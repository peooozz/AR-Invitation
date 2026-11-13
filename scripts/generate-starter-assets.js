import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';

// Polyfill FileReader for Node.js environment
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        if (this.onload) this.onload({ target: this });
        if (this.onloadend) this.onloadend({ target: this });
      });
    }
  };
}

import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../public/models');
const AUDIO_DIR = path.resolve(__dirname, '../public/audio');
const FORTS_PATH = path.resolve(__dirname, '../src/forts.json');

fs.mkdirSync(MODELS_DIR, { recursive: true });
fs.mkdirSync(AUDIO_DIR, { recursive: true });

const forts = JSON.parse(fs.readFileSync(FORTS_PATH, 'utf-8'));

/**
 * Procedurally build a distinct Maratha fort model in Three.js
 */
function createFortMesh(fort) {
  const group = new THREE.Group();
  group.name = fort.name;

  // Materials
  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x3d3a36,
    roughness: 0.85,
    metalness: 0.1,
  });

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x5a5248,
    roughness: 0.8,
    metalness: 0.15,
  });

  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: 0xc9a24b,
    roughness: 0.35,
    metalness: 0.85,
  });

  const saffronMat = new THREE.MeshStandardMaterial({
    color: 0xde5b10,
    roughness: 0.6,
    metalness: 0.1,
  });

  // Mountain / Hill Base (weathered rocky plateau)
  const mountainGeo = new THREE.CylinderGeometry(2.2, 3.2, 1.4, 8);
  const mountain = new THREE.Mesh(mountainGeo, stoneMat);
  mountain.position.y = 0.7;
  group.add(mountain);

  // Upper Plateau
  const plateauGeo = new THREE.CylinderGeometry(1.8, 2.2, 0.4, 8);
  const plateau = new THREE.Mesh(plateauGeo, stoneMat);
  plateau.position.y = 1.6;
  group.add(plateau);

  // Outer Fort Ramparts (Ring of battlements)
  const wallRingGeo = new THREE.TorusGeometry(1.7, 0.12, 6, 8);
  const wallRing = new THREE.Mesh(wallRingGeo, wallMat);
  wallRing.rotation.x = Math.PI / 2;
  wallRing.position.y = 1.85;
  group.add(wallRing);

  // 4 Bastions (Buruj / Watchtowers)
  const towerGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.9, 12);
  const roofGeo = new THREE.ConeGeometry(0.35, 0.35, 12);

  const numTowers = fort.id === 'rajgad' ? 6 : 4;
  for (let i = 0; i < numTowers; i++) {
    const angle = (i / numTowers) * Math.PI * 2;
    const radius = 1.65;
    const tx = Math.cos(angle) * radius;
    const tz = Math.sin(angle) * radius;

    const tower = new THREE.Mesh(towerGeo, wallMat);
    tower.position.set(tx, 2.1, tz);

    const roof = new THREE.Mesh(roofGeo, goldTrimMat);
    roof.position.set(tx, 2.7, tz);

    group.add(tower);
    group.add(roof);
  }

  // Central Citadel (Balekilla / Palace / Shrine)
  const citadelGeo = new THREE.BoxGeometry(0.9, 0.7, 0.9);
  const citadel = new THREE.Mesh(citadelGeo, wallMat);
  citadel.position.set(0, 2.15, 0);
  group.add(citadel);

  const domeGeo = new THREE.SphereGeometry(0.38, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, goldTrimMat);
  dome.position.set(0, 2.5, 0);
  group.add(dome);

  // Grand Gateway (Maha Darwaja)
  const gateLeft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.3), stoneMat);
  gateLeft.position.set(1.6, 2.05, 0.3);
  const gateRight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.3), stoneMat);
  gateRight.position.set(1.6, 2.05, -0.3);
  const gateArch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.8), goldTrimMat);
  gateArch.position.set(1.6, 2.45, 0);
  group.add(gateLeft);
  group.add(gateRight);
  group.add(gateArch);

  // Flagstaff & Saffron Maratha Flag (Bhagwa Jhenda)
  const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.3, 8);
  const pole = new THREE.Mesh(poleGeo, goldTrimMat);
  pole.position.set(0, 3.2, 0);
  group.add(pole);

  // Swallow-tailed triangular Maratha flag
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.5, -0.15);
  flagShape.lineTo(0.35, -0.25);
  flagShape.lineTo(0.55, -0.4);
  flagShape.lineTo(0, -0.4);
  flagShape.closePath();

  const flagGeo = new THREE.ShapeGeometry(flagShape);
  const flagMesh = new THREE.Mesh(flagGeo, saffronMat);
  flagMesh.position.set(0.02, 3.8, 0);
  flagMesh.rotation.y = -Math.PI / 4;
  group.add(flagMesh);

  // Gold commemorative plinth ring
  const plinthGeo = new THREE.TorusGeometry(3.3, 0.06, 8, 32);
  const plinth = new THREE.Mesh(plinthGeo, goldTrimMat);
  plinth.rotation.x = Math.PI / 2;
  plinth.position.y = 0.05;
  group.add(plinth);

  return group;
}

/**
 * Generate a valid playable WAV file (fallback for audio before ElevenLabs key is provided)
 * Encodes audio header + gentle ceremonial harmonic tone
 */
function createCeremonialAudioWav(durationSec = 8, freq = 432) {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const numChannels = 1;
  const bytesPerSample = 2; // 16-bit
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * bytesPerSample;

  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Synthesize royal meditative tambura / bell drone
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Harmonic blend
    const wave1 = Math.sin(2 * Math.PI * freq * t);
    const wave2 = 0.4 * Math.sin(2 * Math.PI * (freq * 1.5) * t);
    const wave3 = 0.25 * Math.sin(2 * Math.PI * (freq * 2.0) * t);
    const swell = Math.sin((Math.PI * t) / durationSec); // smooth fade in / out
    const sample = Math.max(-1, Math.min(1, (wave1 + wave2 + wave3) * swell * 0.4));
    const intSample = Math.floor(sample * 32767);
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

async function exportFortGLB(fort) {
  const outputPath = path.join(MODELS_DIR, `${fort.id}.glb`);
  // Only create if not already present
  if (fs.existsSync(outputPath)) {
    console.log(`⏩ ${fort.id}.glb already exists, skipping.`);
    return;
  }

  const model = createFortMesh(fort);
  const exporter = new GLTFExporter();

  return new Promise((resolve, reject) => {
    exporter.parse(
      model,
      (gltf) => {
        const buffer = Buffer.from(gltf);
        fs.writeFileSync(outputPath, buffer);
        console.log(`✅ Created starter 3D GLB: public/models/${fort.id}.glb (${(buffer.length / 1024).toFixed(1)} KB)`);
        resolve();
      },
      (err) => reject(err),
      { binary: true }
    );
  });
}

async function exportFortAudio(fort, index) {
  const outputPath = path.join(AUDIO_DIR, `${fort.id}.mp3`);
  if (fs.existsSync(outputPath)) {
    console.log(`⏩ ${fort.id}.mp3 already exists, skipping.`);
    return;
  }

  // Generate 7-second harmonic chord (different root note per fort: Sa, Re, Ga, Ma, Pa, Dha, Ni)
  const notes = [216, 243, 270, 288, 324, 360, 405]; // Indian classical scale frequencies
  const freq = notes[index % notes.length];
  const audioBuf = createCeremonialAudioWav(7, freq);
  fs.writeFileSync(outputPath, audioBuf);
  console.log(`🎵 Created starter audio: public/audio/${fort.id}.mp3 (${(audioBuf.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log('🏛 Generating starter assets for 7 Maratha forts...\n');
  for (let i = 0; i < forts.length; i++) {
    const fort = forts[i];
    await exportFortGLB(fort);
    await exportFortAudio(fort, i);
  }
  console.log('\n🌟 Starter assets generated! Real custom models can be dropped in at any time.');
}

main().catch(console.error);
