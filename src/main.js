import '@google/model-viewer';
import fortsData from './forts.json';
import { INVITATION_CONFIG } from './config.js';
import { ARScene } from './ar-scene.js';
import {
  requestCamera,
  requestFullscreen,
  lockLandscape,
  isPortrait,
  requestOrientationPermission,
  playRoyalIntro,
  playMarkerChime,
} from './utils.js';

/**
 * Main Application Orchestrator
 */
class App {
  constructor() {
    this.arScene = null;
    this.activeFort = null;
    this.audioElement = new Audio();
    this.isMuted = false;
    this.speechUtterance = null;
    this.isSpeechPlaying = false;

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
        await this.handleEnterExperience(true);
      });
    }

    if (btnSkip) {
      btnSkip.addEventListener('click', async () => {
        await this.handleEnterExperience(false);
      });
    }
  }

  async handleEnterExperience(useCamera = true) {
    this.permissionScreen.classList.add('hidden');

    // Crucial: iOS DeviceOrientation must be requested directly in this user touch event
    await requestOrientationPermission();

    // Request fullscreen and attempt orientation lock
    await requestFullscreen();
    const locked = await lockLandscape();

    // If landscape lock failed and screen is portrait, notify user
    if (!locked && isPortrait()) {
      this.rotateOverlay.classList.remove('hidden');
    }

    // Show loading overlay
    this.loadingOverlay.classList.remove('hidden');
    this.loadingMsg.textContent = 'Summoning Swarajya Citadels...';

    // Reveal AR section first so canvas & video have non-zero dimensions
    this.arSection.classList.remove('hidden');

    let stream = null;
    if (useCamera) {
      this.loadingMsg.textContent = 'Accessing Camera AR Viewport...';
      try {
        stream = await requestCamera();
      } catch (err) {
        console.warn('Camera error:', err);
      }
    }

    try {
      // Initialize 3D AR Scene
      await this.initARScene(stream);
    } catch (err) {
      console.error('AR Scene initialization failed:', err);
    } finally {
      // Always dismiss loading overlay so UI never gets stuck
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

    // Automatically dismiss rotate overlay when device rotates to landscape
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
      onFortSelected: (fort) => this.showFortInfo(fort),
      onLoadingStart: (msg) => {
        if (this.loadingMsg && msg) {
          this.loadingMsg.textContent = msg;
        }
        this.fortLoading.classList.remove('hidden');
      },
      onLoadingEnd: () => {
        this.fortLoading.classList.add('hidden');
      },
      onDistanceUpdate: (dist) => {
        if (this.instructionPill) {
          const formatted = dist.toFixed(1);
          if (dist <= 2.8) {
            this.instructionPill.innerHTML = `<span>👑 <b>At the Swarajya Throne (${formatted}m)</b> &bull; Tap Raigad Fort</span>`;
            this.instructionPill.style.background = 'rgba(201, 162, 75, 0.92)';
            this.instructionPill.style.color = '#14100c';
            this.instructionPill.style.borderColor = '#ffffff';
          } else if (dist <= 5.5) {
            this.instructionPill.innerHTML = `<span>⚔️ <b>Approaching (${formatted}m)</b> &bull; Walk closer</span>`;
            this.instructionPill.style.background = 'rgba(30, 24, 16, 0.78)';
            this.instructionPill.style.color = '#ffd978';
            this.instructionPill.style.borderColor = 'rgba(201, 162, 75, 0.45)';
          } else {
            this.instructionPill.innerHTML = `<span>📍 <b>${formatted}m to Swarajya Monument</b> &bull; Walk closer or swipe up</span>`;
            this.instructionPill.style.background = 'rgba(20, 16, 12, 0.65)';
            this.instructionPill.style.color = '#ffeed0';
            this.instructionPill.style.borderColor = 'rgba(201, 162, 75, 0.25)';
          }
        }
      },
    });

    // Start video feed or fallback
    await this.arScene.startCamera(cameraStream);

    // Setup gyroscope parallax
    this.arScene.setupDeviceOrientation();

    // Load central hero model (client with Shivaji Maharaj)
    if (this.loadingMsg) {
      this.loadingMsg.textContent = 'Loading Chhatrapati Shivaji Maharaj & Hero...';
    }
    await this.arScene.loadHero(INVITATION_CONFIG.heroModelPath, (pct) => {
      if (this.loadingMsg) {
        this.loadingMsg.textContent = `Loading Chhatrapati Shivaji Maharaj (${pct}%)...`;
      }
    });

    // Setup the 7 orbital fort markers
    this.arScene.setupFortMarkers(fortsData);

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
        if (this.arScene) {
          this.arScene.deselectFort();
        }
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
  /*  5. Fort Info Panel & Surface AR                                    */
  /* ------------------------------------------------------------------ */
  showFortInfo(fort) {
    this.activeFort = fort;

    // Populate data
    document.getElementById('fort-name').textContent = fort.name;
    document.getElementById('fort-name-marathi').textContent = fort.nameMarathi || '';
    document.getElementById('fort-year').textContent = fort.year || 'Historic';
    document.getElementById('fort-district').textContent = fort.district;
    document.getElementById('fort-elevation').textContent = fort.elevation;
    document.getElementById('fort-history').textContent = fort.history;

    // Show panel
    this.infoCard.classList.remove('hidden');

    // Configure <model-viewer> for Surface AR
    if (this.arModelViewer) {
      this.arModelViewer.setAttribute('src', `/models/${fort.id}.glb`);
      this.arModelViewer.setAttribute('ios-src', `/usdz/${fort.id}.usdz`);
      this.arModelViewer.setAttribute('alt', `${fort.name} 3D Citadel`);
    }

    // Start Narration Audio
    this.playFortNarration(fort);
  }

  activateSurfaceAR() {
    if (!this.arModelViewer) return;
    playMarkerChime(659.25); // E5

    // If model-viewer has activateAR method
    if (typeof this.arModelViewer.activateAR === 'function') {
      this.arModelViewer.activateAR();
    } else {
      // Fallback: trigger click on the model-viewer element
      this.arModelViewer.click();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  6. Audio Narration Player                                         */
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

    // Audio element state listeners
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
      console.warn('Audio file playback fallback to Web Speech Synthesis');
      this.fallbackWebSpeech();
    });
  }

  playFortNarration(fort) {
    this.stopAudio();

    const audioSrc = `/audio/${fort.id}.mp3`;
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
        .catch((e) => {
          console.log('Autoplay restriction or missing file, standing by for manual play:', e.message);
          this.playIcon.textContent = '▶';
        });
    }
  }

  fallbackWebSpeech() {
    if (!('speechSynthesis' in window) || !this.activeFort) return;
    window.speechSynthesis.cancel();

    const textToSpeak = `${this.activeFort.name}. ${this.activeFort.district} district. Elevation ${this.activeFort.elevation}. ${this.activeFort.history}`;
    this.speechUtterance = new SpeechSynthesisUtterance(textToSpeak);
    this.speechUtterance.rate = 0.95;
    this.speechUtterance.pitch = 1.0;

    this.speechUtterance.onstart = () => {
      this.isSpeechPlaying = true;
      this.playIcon.textContent = '❚❚';
    };

    this.speechUtterance.onend = () => {
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
      this.audioElement.play().catch(() => this.fallbackWebSpeech());
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
