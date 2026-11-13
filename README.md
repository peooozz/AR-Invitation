# 🏰 Swarajya Forts — WebAR Royal Invitation

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-org/ar-invitation)

A mobile-first, production-ready WebAR invitation card celebrating the ascent of **50+ historic forts (killas) of Chhatrapati Shivaji Maharaj**. Guests scan a royal gold QR code and land on an immersive 3D/AR experience featuring:
- **Ivory & Gold Luxury Aesthetic** inspired by Maratha motifs and Hindavi Swarajya.
- **Real-Time Camera AR** with transparent Three.js canvas overlay.
- **Central Hero 3D Model** (the client with Chhatrapati Shivaji Maharaj) with Draco & Meshopt compression.
- **7 Floating Gold Fort Markers** (Raigad, Pratapgad, Sinhagad, Rajgad, Torna, Purandar, Shivneri) with orbital hover animations, tap raycasting, and lazy loading.
- **Audio Narration Player** with scrub bar, mute control, and ElevenLabs AI multilingual narration (English, Hindi, Marathi), plus automatic Web Speech fallback.
- **Surface AR ("View in your space")** using `<model-viewer>` for Android Scene Viewer and iOS Quick Look (`.usdz`).
- **Interactive Controls**: Touch drag to orbit 360°, pinch to zoom, and DeviceOrientation (gyroscope) parallax.
- **Production Performance**: Geometry/material disposal on fort switches, pixel ratio capped at 2, and 60fps optimization.

---

## 🏛 Visual Palette & Typography

- **Theme Palette**:
  - Ivory Base: `#FFFDF7`
  - Royal Gold: `#C9A24B`
  - Deep Heritage Gold: `#8A6A1E`
  - Saffron Accent: `#DE5B10`
  - Soft Shadow: `#00000014`
- **Typography**:
  - Headings: *Cinzel Decorative* & *Cinzel*
  - Subheadings: *Playfair Display*
  - Body & Data: *Inter*

---

## 📁 Project Structure

```
AR Invitation/
├── api/
│   └── tts.js                     # Vercel serverless function (ElevenLabs TTS proxy)
├── public/
│   ├── audio/                     # Narration MP3s (raigad.mp3, pratapgad.mp3, ...)
│   ├── draco/                     # Local Google Draco 3D decompression binaries
│   ├── models/                    # 3D GLB models (hero.glb + 7 fort GLBs)
│   ├── usdz/                      # Apple AR Quick Look USDZ models
│   └── qr.png                     # Royal Gold QR code
├── scripts/
│   ├── generate-audio.js          # ElevenLabs batch audio generator (supports --force, --mock)
│   ├── generate-qr.js             # High-res royal QR code generator
│   └── generate-starter-assets.js # Procedural 3D fort GLB & harmonic audio generator
├── src/
│   ├── config.js                  # Easy configuration: Client name, event, date, venue, RSVP
│   ├── forts.json                 # 7 forts metadata (names, elevations, districts, history)
│   ├── main.js                    # Core application orchestrator & flow manager
│   ├── ar-scene.js                # Three.js AR scene, lighting, loaders, markers & fallbacks
│   ├── utils.js                   # Camera, orientation, fullscreen, dispose & Web Audio synth
│   └── styles/
│       ├── main.css               # Global theme, reset, typography & animations
│       ├── landing.css            # Luxury card layout, Maratha arch & ornamental dividers
│       ├── ar.css                 # Camera video feed, AR top bar, orientation overlays
│       └── components.css         # Sliding info card, audio player, footer & RSVP modal
├── index.html                     # Mobile-first HTML entry
├── package.json
├── vite.config.js                 # Chunk splitting (three, model-viewer) & dev server host
├── vercel.json                    # Vercel deployment with Permissions-Policy headers
├── .env.example                   # Environment variable template
└── README.md
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional for ElevenLabs)
Copy the example environment file:
```bash
cp .env.example .env
```
Add your key to `.env`:
```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

### 3. Start Local Development
```bash
npm run dev
```
Vite will start with `--host` enabled, allowing you to access it over your local Wi-Fi network (e.g. `http://192.168.x.x:5173`).

---

## 📱 Testing on Mobile & HTTPS (Camera & Gyroscope)

Modern mobile browsers require an **HTTPS** context to grant access to the camera (`getUserMedia`) and gyroscope (`DeviceOrientationEvent`).

### Option A: Cloudflare Tunnel (Free, Instant, No Account Needed)
1. Run the dev server:
   ```bash
   npm run dev
   ```
2. In a second terminal, run:
   ```bash
   npx cloudflared tunnel --url http://localhost:5173
   ```
3. Open the generated `https://xxxx.trycloudflare.com` link on your phone!

### Option B: ngrok
```bash
npx ngrok http 5173
```
Open the `https://xxxx.ngrok-free.app` URL on your phone.

---

## 🏰 Adding or Customizing 3D Fort Models

All 7 forts currently have lightweight starter 3D GLB models and procedural fallbacks. When you have your photogrammetry or custom 3D models ready:

1. **Format**: Save each fort as a `.glb` binary file.
2. **File Location**: Place them inside `public/models/`:
   - `public/models/raigad.glb`
   - `public/models/pratapgad.glb`
   - `public/models/sinhagad.glb`
   - `public/models/rajgad.glb`
   - `public/models/torna.glb`
   - `public/models/purandar.glb`
   - `public/models/shivneri.glb`
3. **Apple iOS Quick Look (Optional)**: Place `.usdz` equivalents in `public/usdz/<id>.usdz`.

> **Note on Missing Models:** If any fort model is missing or fails to load, the site automatically renders a procedural 3D Maratha hill fortress with stone battlements, bastions, and a fluttering saffron flag. It will never show an empty screen!

---

## 🗜 Optimizing GLB Models with `gltf-transform`

To maintain a silky 60fps on mid-range Android devices, keep models under 2–3 MB each using Draco and WebP compression:

```bash
# Install gltf-transform CLI globally or use npx
npx @gltf-transform/cli optimize input.glb output.glb --compress draco --texture-compress webp

# Resize oversized textures to 1024x1024 max
npx @gltf-transform/cli resize input.glb output.glb --width 1024 --height 1024
```

---

## 🎙 ElevenLabs Audio Narration

The project includes an automated audio generator that reads `src/forts.json` and produces high-quality audio files for each fort:

```bash
# Generate real ElevenLabs narration (requires ELEVENLABS_API_KEY in .env)
npm run generate-audio

# Force regenerate existing audio files
npm run generate-audio -- --force

# Generate test synthetic ceremonial audio without an API key
npm run generate-audio -- --mock
```

Generated MP3s are saved to `public/audio/<fort-id>.mp3`.

---

## 📲 Generating the Royal QR Code

Generate a high-resolution royal gold QR code for your invitation card:

```bash
# Generate QR code for custom deployment URL
node scripts/generate-qr.js https://your-invitation-domain.vercel.app

# Or use the npm script (defaults to production URL)
npm run generate-qr
```
The resulting QR code is saved to `public/qr.png` with a royal deep gold pattern on an ivory background.

---

## ⚙️ Customizing Invitation Details

To customize the client name, event name, date, venue, maps URL, or RSVP contact, simply edit `src/config.js`:

```javascript
export const INVITATION_CONFIG = {
  clientName: "Shri Vikramaditya Shinde",
  eventName: "50 Forts Swarajya Expedition Celebration",
  tagline: "Celebrating the ascent of 50+ historic forts of Chhatrapati Shivaji Maharaj",
  date: "Sunday, 28 February 2026",
  time: "6:00 PM IST",
  venue: "The Royal Ballroom, Heritage Palace, Pune, Maharashtra",
  googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Pune+Maharashtra",
  rsvpPhone: "+91 98765 43210",
  ...
};
```

All invitation details across the landing card, AR top bar, AR footer, and RSVP modal update dynamically!

---

## 🚢 Deploying to Vercel

### Option 1: Vercel CLI
```bash
npx vercel
```

### Option 2: GitHub Integration
1. Push this repository to GitHub.
2. In Vercel, click **Add New → Project** and select this repository.
3. Add `ELEVENLABS_API_KEY` under **Environment Variables**.
4. Click **Deploy**. Vercel will automatically build with `npm run build` using the included `vercel.json`.

---

## 🛡 License & Credits
Dedicated to the glorious history of Hindavi Swarajya and Chhatrapati Shivaji Maharaj. Built with Three.js, Vite, and Google Model Viewer.
