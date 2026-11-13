import '@google/model-viewer';
import { INVITATION_CONFIG, HERO_DATA } from './config.js';
import { ARScene } from './ar-scene.js';
import {
  requestCamera,
  requestFullscreen,
  lockLandscape,
  isPortrait,
  requestOrientationPermission,
  playRoyalIntro,
  playMarkerChime,
  getIndianFemaleVoice,
} from './utils.js';

/**
 * Main Application Orchestrator
 */
class App {
  constructor() {
    this.arScene = null;
    this.activeItem = HERO_DATA;
    this.audioElement = new Audio();
    this.isMuted = false;
    this.speechUtterance = null;
    this.isSpeechPlaying = false;
    this.cachedTTSBlobUrls = new Map();

    // DOM Elements
    this.landingSection = document.getElementById('landing');
    this.permissionScreen = document.getElementById('permission-screen');
    this.rotateOverlay = document.getElementById('rotate-overlay');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.loadingMsg = document.getElementById('loading-msg');
    this.arSection = document.getElementById('ar-scene');
    this.infoCard = document.getElementById('info-card');
    this.instructionPill = document.getElementById('ar-instruction-pill');
    this.arModelViewer = document.getElementById('ar-model-viewer');
    this.fortLoading = document.getElementById('fort-loading');

    // Audio Elements
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.playIcon = document.getElementById('play-icon');
    this.btnMute = document.getElementById('btn-mute');
    this.muteIcon = document.getElementById('mute-icon');
    this.progressContainer = document.getElementById('progress-container');
    this.progressFill = document.getElementById('progress-fill');
    this.audioTime = document.getElementById('audio-time');

    // RSVP Modal Elements
    this.rsvpModal = document.getElementById('rsvp-modal');
    this.btnCloseRsvp = document.getElementById('btn-close-rsvp');
    this.btnSubmitWhatsApp = document.getElementById('btn-submit-whatsapp');

    this.init();
  }

  init() {
    this.populateConfig();
    this.bindLandingEvents();
    this.bindPermissionEvents();
    this.bindRotateEvents();
    this.bindAREvents();
    this.bindAudioEvents();
    this.bindRSVPEvents();

    // Pre-load / warm up Web Speech Synthesis voices for mobile browsers
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        getIndianFemaleVoice();
      };
      // Initial check
      getIndianFemaleVoice();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  1. Populate Template from Config                                  */
  /* ------------------------------------------------------------------ */
  populateConfig() {
    const setIf = (id, val) => {
      const el = document.getElementById(id);
      if (el && val) el.textContent = val;
    };

    setIf('landing-client-name', `${INVITATION_CONFIG.clientName}'s`);
    setIf('landing-event-name', INVITATION_CONFIG.eventName);
    setIf('landing-tagline', INVITATION_CONFIG.tagline);
    setIf('landing-date', `${INVITATION_CONFIG.date} • ${INVITATION_CONFIG.time}`);
    setIf('landing-venue', INVITATION_CONFIG.venue);
    setIf('footer-date-display', `📅 ${INVITATION_CONFIG.date.split(',')[1] || INVITATION_CONFIG.date}`);

    const btnMaps = document.getElementById('btn-maps');
    if (btnMaps && INVITATION_CONFIG.googleMapsUrl) {
      btnMaps.href = INVITATION_CONFIG.googleMapsUrl;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  2. Landing Page & Flow Transitions                                 */
  /* ------------------------------------------------------------------ */
  bindLandingEvents() {
    const btnBegin = document.getElementById('btn-begin');
    if (btnBegin) {
      btnBegin.addEventListener('click', () => {
        playRoyalIntro();
        this.landingSection.classList.add('hidden');
        this.permissionScreen.classList.remove('hidden');
      });
    }

    const btnOpenRsvpLanding = document.getElementById('btn-open-rsvp-landing');
    if (btnOpenRsvpLanding) {
      btnOpenRsvpLanding.addEventListener('click', () => {
        this.openRSVP();
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  3. Permission Screen & Camera Flow                                 */
  /* ------------------------------------------------------------------ */
  bindPermissionEvents() {
    const btnGrant = document.getElementById('btn-grant');
    const btnSkip = document.getElementById('btn-skip-camera');

    if (btnGrant) {
      btnGrant.addEventListener('click', async () => {
        // Immediate synchronous call for iOS permission on touch gesture
        await requestOrientationPermission();
        await this.handleEnterExperience(true);
      });
    }

    if (btnSkip) {
      btnSkip.addEventListener('click', async () => {
        await requestOrientationPermission();
        await this.handleEnterExperience(false);
      });
    }
  }

  async handleEnterExperience(useCamera = true) {
    this.permissionScreen.classList.add('hidden');

    // Attempt fullscreen & orientation lock (safe fallbacks)
    await requestFullscreen();
    const locked = await lockLandscape();

    if (!locked && isPortrait()) {
      this.rotateOverlay.classList.remove('hidden');
    }

    // Show loading overlay
    this.loadingOverlay.classList.remove('hidden');
    this.loadingMsg.textContent = 'Summoning Swarajya Citadels...';

    // Reveal AR section
    this.arSection.classList.remove('hidden');

    let stream = null;
    if (useCamera) {
      this.loadingMsg.textContent = 'Opening Back Camera AR Viewport...';
      try {
        stream = await requestCamera();
      } catch (err) {
        console.warn('Camera error:', err);
      }
    }

    try {
      await this.initARScene(stream);
    } catch (err) {
      console.error('AR Scene initialization failed:', err);
    } finally {
      this.loadingOverlay.classList.add('hidden');
    }
  }

  bindRotateEvents() {
    const btnContinuePortrait = document.getElementById('btn-continue-portrait');
    if (btnContinuePortrait) {
      btnContinuePortrait.addEventListener('click', () => {
        this.rotateOverlay.classList.add('hidden');
      });
    }

    const checkOrientation = () => {
      if (!isPortrait() && !this.rotateOverlay.classList.contains('hidden')) {
        this.rotateOverlay.classList.add('hidden');
      }
    };
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
  }

  /* ------------------------------------------------------------------ */
  /*  4. AR Scene Initialization & Events                                */
  /* ------------------------------------------------------------------ */
  async initARScene(cameraStream) {
    if (this.arScene) {
      this.arScene.dispose();
    }

    this.arScene = new ARScene({
      onHeroSelected: () => this.showHeroInfo(),
      onLoadingStart: (msg) => {
        if (this.loadingMsg && msg) {
          this.loadingMsg.textContent = msg;
        }
        if (this.fortLoading) this.fortLoading.classList.remove('hidden');
      },
      onLoadingEnd: () => {
        if (this.fortLoading) this.fortLoading.classList.add('hidden');
      },
      onDistanceUpdate: (dist) => {
        if (this.instructionPill) {
          const formatted = dist.toFixed(1);
          if (dist <= 2.8) {
            this.instructionPill.innerHTML = `<span>👑 <b>At the Swarajya Monument (${formatted}m)</b> &bull; Tap Model to hear Story</span>`;
            this.instructionPill.style.background = 'rgba(201, 162, 75, 0.95)';
            this.instructionPill.style.color = '#14100c';
            this.instructionPill.style.borderColor = '#ffffff';
          } else if (dist <= 5.5) {
            this.instructionPill.innerHTML = `<span>⚔️ <b>Approaching (${formatted}m)</b> &bull; Walk closer</span>`;
            this.instructionPill.style.background = 'rgba(30, 24, 16, 0.82)';
            this.instructionPill.style.color = '#ffd978';
            this.instructionPill.style.borderColor = 'rgba(201, 162, 75, 0.45)';
          } else {
            this.instructionPill.innerHTML = `<span>📍 <b>${formatted}m to Swarajya Monument</b> &bull; Walk closer or tap ▲</span>`;
            this.instructionPill.style.background = 'rgba(20, 16, 12, 0.70)';
            this.instructionPill.style.color = '#ffeed0';
            this.instructionPill.style.borderColor = 'rgba(201, 162, 75, 0.30)';
          }
        }
      },
    });

    // Start back camera video feed or royal fallback
    await this.arScene.startCamera(cameraStream);

    // Load central hero model (client with Shivaji Maharaj)
    if (this.loadingMsg) {
      this.loadingMsg.textContent = 'Loading Chhatrapati Shivaji Maharaj & Hero...';
    }
    await this.arScene.loadHero(INVITATION_CONFIG.heroModelPath, (pct) => {
      if (this.loadingMsg) {
        this.loadingMsg.textContent = `Loading Chhatrapati Shivaji Maharaj (${pct}%)...`;
      }
    });

    // Start render loop
    this.arScene.start();
  }

  bindAREvents() {
    // Back to Landing Card button
    const btnBack = document.getElementById('btn-back-landing');
    if (btnBack) {
      btnBack.addEventListener('click', () => {
        this.stopAudio();
        this.infoCard.classList.add('hidden');
        this.arSection.classList.add('hidden');
        this.landingSection.classList.remove('hidden');
        if (this.arScene) {
          this.arScene.stop();
        }
      });
    }

    // 360° Rotate Model Toggle button
    const btnRotate360 = document.getElementById('btn-rotate-360');
    if (btnRotate360) {
      btnRotate360.addEventListener('click', () => {
        playMarkerChime(587.33);
        if (this.arScene) {
          const isRotating = this.arScene.toggleAutoRotate();
          btnRotate360.classList.toggle('active', isRotating);
        }
      });
    }

    // Recenter / Reset Position button
    const btnRecenter = document.getElementById('btn-recenter');
    if (btnRecenter) {
      btnRecenter.addEventListener('click', () => {
        playMarkerChime(440);
        if (this.arScene) {
          this.arScene.resetPosition();
        }
      });
    }

    // Walk Forward (Approach) button
    const btnWalkForward = document.getElementById('btn-walk-forward');
    if (btnWalkForward) {
      btnWalkForward.addEventListener('click', () => {
        playMarkerChime(520);
        if (this.arScene) {
          this.arScene.walk(-0.8); // step 0.8m closer
        }
      });
    }

    // Walk Backward (Step back) button
    const btnWalkBackward = document.getElementById('btn-walk-backward');
    if (btnWalkBackward) {
      btnWalkBackward.addEventListener('click', () => {
        playMarkerChime(380);
        if (this.arScene) {
          this.arScene.walk(0.8); // step 0.8m back
        }
      });
    }

    // Close Info Card button
    const btnCloseInfo = document.getElementById('btn-close-info');
    if (btnCloseInfo) {
      btnCloseInfo.addEventListener('click', () => {
        this.infoCard.classList.add('hidden');
        this.stopAudio();
      });
    }

    // Surface AR Button (<model-viewer>)
    const btnViewAR = document.getElementById('btn-view-ar');
    if (btnViewAR) {
      btnViewAR.addEventListener('click', () => {
        this.activateSurfaceAR();
      });
    }

    // Footer RSVP Button
    const btnFooterRsvp = document.getElementById('btn-footer-rsvp');
    if (btnFooterRsvp) {
      btnFooterRsvp.addEventListener('click', () => {
        this.openRSVP();
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  5. Info Panel: Hero Celebration & Surface AR                      */
  /* ------------------------------------------------------------------ */
  showHeroInfo() {
    this.activeItem = HERO_DATA;

    document.getElementById('fort-name').textContent = HERO_DATA.name;
    document.getElementById('fort-name-marathi').textContent = HERO_DATA.nameMarathi || '';
    document.getElementById('fort-year').textContent = HERO_DATA.badge || '50+ Forts';
    document.getElementById('fort-district').textContent = HERO_DATA.district;
    document.getElementById('fort-elevation').textContent = HERO_DATA.elevation;
    document.getElementById('fort-history').textContent = HERO_DATA.history;

    this.infoCard.classList.remove('hidden');

    if (this.arModelViewer) {
      this.arModelViewer.setAttribute('src', HERO_DATA.modelPath);
      this.arModelViewer.setAttribute('alt', `${HERO_DATA.name} 3D Monument`);
    }

    this.playNarration(HERO_DATA);
  }

  activateSurfaceAR() {
    if (!this.arModelViewer) return;
    playMarkerChime(659.25);
    if (typeof this.arModelViewer.activateAR === 'function') {
      this.arModelViewer.activateAR();
    } else {
      this.arModelViewer.click();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  6. Audio Narration Player & Realistic Indian Female Voice         */
  /* ------------------------------------------------------------------ */
  bindAudioEvents() {
    this.btnPlayPause.addEventListener('click', () => {
      this.togglePlayPause();
    });

    this.btnMute.addEventListener('click', () => {
      this.toggleMute();
    });

    // Scrubbable progress bar
    const seek = (e) => {
      if (!this.audioElement.duration) return;
      const rect = this.progressContainer.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      this.audioElement.currentTime = ratio * this.audioElement.duration;
      this.progressFill.style.width = `${ratio * 100}%`;
    };

    this.progressContainer.addEventListener('click', seek);

    this.audioElement.addEventListener('timeupdate', () => {
      if (!this.audioElement.duration) return;
      const progress = (this.audioElement.currentTime / this.audioElement.duration) * 100;
      this.progressFill.style.width = `${progress}%`;
      this.audioTime.textContent = `${this.formatTime(this.audioElement.currentTime)} / ${this.formatTime(this.audioElement.duration)}`;
    });

    this.audioElement.addEventListener('ended', () => {
      this.playIcon.textContent = '▶';
      this.progressFill.style.width = '0%';
    });

    this.audioElement.addEventListener('error', () => {
      if (this.activeItem) {
        this.speakWithElevenLabsOrWebSpeech(this.activeItem.history);
      }
    });
  }

  playNarration(item) {
    this.stopAudio();

    const audioSrc = item.audioPath || `/audio/${item.id}.mp3`;
    this.audioElement.src = audioSrc;
    this.audioElement.currentTime = 0;
    this.audioElement.muted = this.isMuted;
    this.progressFill.style.width = '0%';
    this.audioTime.textContent = '0:00 / 0:00';

    const playPromise = this.audioElement.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.playIcon.textContent = '❚❚';
        })
        .catch(() => {
          this.speakWithElevenLabsOrWebSpeech(item.history);
        });
    }
  }

  /**
   * Speak narration using ElevenLabs API with graceful Indian female Web Speech fallback
   */
  async speakWithElevenLabsOrWebSpeech(text) {
    if (!text) return;
    this.stopAudio();

    // Check cached TTS blob
    if (this.cachedTTSBlobUrls.has(text)) {
      this.audioElement.src = this.cachedTTSBlobUrls.get(text);
      this.audioElement.play().then(() => {
        this.playIcon.textContent = '❚❚';
      }).catch(() => {
        this.fallbackWebSpeech(text);
      });
      return;
    }

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.cachedTTSBlobUrls.set(text, blobUrl);
        this.audioElement.src = blobUrl;
        await this.audioElement.play();
        this.playIcon.textContent = '❚❚';
        return;
      }
    } catch {
      // API call failed, fallback immediately
    }

    this.fallbackWebSpeech(text);
  }

  /**
   * Realistic Indian Female Voice Synthesizer
   */
  fallbackWebSpeech(text) {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();

    this.speechUtterance = new SpeechSynthesisUtterance(text);
    this.speechUtterance.rate = 0.95;
    this.speechUtterance.pitch = 1.05;

    // Prioritize natural Indian female voice
    const indianVoice = getIndianFemaleVoice();
    if (indianVoice) {
      this.speechUtterance.voice = indianVoice;
    }

    this.speechUtterance.onstart = () => {
      this.isSpeechPlaying = true;
      this.playIcon.textContent = '❚❚';
    };

    this.speechUtterance.onend = () => {
      this.isSpeechPlaying = false;
      this.playIcon.textContent = '▶';
    };

    this.speechUtterance.onerror = () => {
      this.isSpeechPlaying = false;
      this.playIcon.textContent = '▶';
    };

    window.speechSynthesis.speak(this.speechUtterance);
  }

  togglePlayPause() {
    if (this.isSpeechPlaying) {
      window.speechSynthesis.cancel();
      this.isSpeechPlaying = false;
      this.playIcon.textContent = '▶';
      return;
    }

    if (this.audioElement.paused) {
      this.audioElement.play().catch(() => {
        if (this.activeItem) {
          this.speakWithElevenLabsOrWebSpeech(this.activeItem.history);
        }
      });
      this.playIcon.textContent = '❚❚';
    } else {
      this.audioElement.pause();
      this.playIcon.textContent = '▶';
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.audioElement.muted = this.isMuted;
    this.muteIcon.textContent = this.isMuted ? '🔇' : '🔊';
  }

  stopAudio() {
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.currentTime = 0;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.isSpeechPlaying = false;
    }
    this.playIcon.textContent = '▶';
    this.progressFill.style.width = '0%';
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  /* ------------------------------------------------------------------ */
  /*  7. Royal RSVP Modal                                               */
  /* ------------------------------------------------------------------ */
  bindRSVPEvents() {
    this.btnCloseRsvp.addEventListener('click', () => {
      this.rsvpModal.classList.add('hidden');
    });

    this.btnSubmitWhatsApp.addEventListener('click', () => {
      const name = document.getElementById('rsvp-guest-name').value.trim() || 'A Grateful Guest';
      const status = document.getElementById('rsvp-attend-status').value;
      const count = document.getElementById('rsvp-guest-count').value || '1';
      const wishes = document.getElementById('rsvp-wishes').value.trim();

      const text = `*Jai Shivray! Royal RSVP Confirmation*\n` +
        `👤 *Name:* ${name}\n` +
        `🚩 *Attendance:* ${status}\n` +
        `👥 *Guests:* ${count}\n` +
        (wishes ? `✉️ *Wishes:* ${wishes}\n` : '') +
        `\nEvent: ${INVITATION_CONFIG.eventName} (${INVITATION_CONFIG.date})`;

      const waPhone = INVITATION_CONFIG.rsvpPhone.replace(/[^0-9]/g, '');
      const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank', 'noopener');
      this.rsvpModal.classList.add('hidden');
    });
  }

  openRSVP() {
    playMarkerChime(528);
    this.rsvpModal.classList.remove('hidden');
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
});
