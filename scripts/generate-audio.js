import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const MODEL_ID = 'eleven_multilingual_v2';
const OUTPUT_DIR = path.resolve(__dirname, '../public/audio');
const FORTS_PATH = path.resolve(__dirname, '../src/forts.json');

// Parse CLI flags
const isHelp = process.argv.includes('--help') || process.argv.includes('-h');
const forceRegenerate = process.argv.includes('--force');
const mockMode = process.argv.includes('--mock') || process.argv.includes('--sample');

if (isHelp) {
  console.log(`
🎙  ElevenLabs Audio Narration Generator for AR Invitation

Usage:
  node scripts/generate-audio.js [flags]
  npm run generate-audio [-- flags]

Flags:
  --force    Regenerate all audio files even if they already exist
  --mock     Generate sample synthetic audio files without an API key
  --help     Show this help message

Environment Variables (.env):
  ELEVENLABS_API_KEY    Your ElevenLabs API key (required unless --mock)
  ELEVENLABS_VOICE_ID   Optional voice ID (default: 21m00Tcm4TlvDq8ikWAM)
`);
  process.exit(0);
}

/**
 * Generate synthetic harmonic WAV for mock / testing mode
 */
function createMockWav(durationSec = 7, freq = 432) {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const numChannels = 1;
  const bytesPerSample = 2;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * bytesPerSample;

  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const wave = Math.sin(2 * Math.PI * freq * t) * 0.4 * Math.sin((Math.PI * t) / durationSec);
    buffer.writeInt16LE(Math.floor(wave * 32767), 44 + i * 2);
  }
  return buffer;
}

async function generateAudio(fort, index) {
  const outputPath = path.join(OUTPUT_DIR, `${fort.id}.mp3`);

  // Skip if file already exists (unless --force)
  if (!forceRegenerate && fs.existsSync(outputPath)) {
    console.log(`⏭  Skipping "${fort.name}" — audio already exists (use --force to overwrite)`);
    return false;
  }

  if (mockMode) {
    console.log(`🎵 Generating mock sample audio for "${fort.name}"...`);
    const mockNotes = [216, 243, 270, 288, 324, 360, 405];
    const buf = createMockWav(7, mockNotes[index % mockNotes.length]);
    fs.writeFileSync(outputPath, buf);
    console.log(`✅ Saved sample audio ${outputPath} (${(buf.length / 1024).toFixed(1)} KB)`);
    return true;
  }

  const lang = fort.language || 'en';
  console.log(`🎙  Generating ElevenLabs AI narration for "${fort.name}" (Lang: ${lang}, Voice: ${VOICE_ID})...`);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: fort.history,
        model_id: MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `ElevenLabs API error ${response.status} for "${fort.name}": ${errorBody}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

  const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log(`✅ Saved ${outputPath} (${sizeKB} KB)`);
  return true;
}

async function main() {
  if (!mockMode && !API_KEY) {
    console.error(`
❌ ELEVENLABS_API_KEY is not set.
   Add your API key to your .env file:
   ELEVENLABS_API_KEY=your_key_here

   Or to test audio generation without an API key:
   npm run generate-audio -- --mock
`);
    process.exit(1);
  }

  if (!fs.existsSync(FORTS_PATH)) {
    console.error(`❌ Fort data not found at ${FORTS_PATH}`);
    process.exit(1);
  }

  const forts = JSON.parse(fs.readFileSync(FORTS_PATH, 'utf-8'));
  console.log(`\n🏰 Found ${forts.length} forts in forts.json`);
  console.log(`📂 Output directory: ${OUTPUT_DIR}`);
  console.log(`🔄 Mode: ${mockMode ? 'Mock Synthetic Audio' : 'ElevenLabs Multilingual API'}`);
  console.log(`🔄 Force regenerate: ${forceRegenerate ? 'YES' : 'NO'}\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (let i = 0; i < forts.length; i++) {
    const fort = forts[i];
    try {
      const generated = await generateAudio(fort, i);
      if (generated) {
        successCount++;
        // Small rate limit delay between API requests
        if (!mockMode) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      } else {
        skipCount++;
      }
    } catch (error) {
      console.error(`❌ Failed for "${fort.name}":`, error.message);
      errorCount++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`✅ Generated: ${successCount}`);
  console.log(`⏭  Skipped:   ${skipCount}`);
  if (errorCount > 0) {
    console.log(`❌ Errors:    ${errorCount}`);
    process.exit(1);
  }
  console.log('✨ Done!\n');
}

main();
