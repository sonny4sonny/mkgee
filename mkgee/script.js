/* ==========================================================
   MK.GEE — scroll reveal + tape counter + sound design
   Sound design now uses three cleared real guitar/tone samples
   instead of synthesized tones:
     guitar-tick.mp3  — a Looperman guitar phrase; a short attack
                         slice from it plays as the per-section tick
     tone-swell.mp3   — a longer tone phrase; a trimmed passage from
                         it plays once, as the 2024 climax swell
     bed-loop.mp3     — a short guitar loop; played continuously at
                         low volume, filtered down, as the ambient bed
   None of the three source files is a clean one-shot hit or a true
   ambient pad — they're musical phrases — so exact start points were
   chosen with ffmpeg silencedetect (not just by ear) to land on real
   attacks and to pick a passage with enough movement for the climax,
   and the gain envelope on each slice does the fade work rather than
   relying on the source audio to start/end cleanly on its own.
   ========================================================== */

// ---------- scroll reveal ----------
const io = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting && !entry.target.classList.contains('in')) {
      entry.target.classList.add('in');
      handleSectionReveal(entry.target);
    }
  });
}, { threshold: 0.2 });

document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

// ---------- tape counter ----------
// Mimics an analog cassette counter: a four-digit readout that climbs
// as the page scrolls, rather than a generic percentage progress bar.
const counterDigits = document.getElementById('counterDigits');
function updateCounter() {
  if (!counterDigits) return;
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
  const count = Math.round(progress * 9999);
  counterDigits.textContent = String(count).padStart(4, '0');
}
window.addEventListener('scroll', updateCounter, { passive: true });
updateCounter();

// ---------- sound design ----------
let soundOn = false;
let audioCtx = null;

// Decoded buffers for the three source files, filled in by loadSamples().
// Playback functions check these before doing anything, since decoding
// happens asynchronously and sound can be toggled on before it finishes.
const buffers = { tick: null, swell: null, bed: null, live: null };
let samplesRequested = false;

// Slice points picked from each source file (seconds), found with
// `ffmpeg -af silencedetect` rather than guessed from the waveform alone:
// each is a real attack after a gap, or a continuous passage with no
// gaps running through it.
const TICK_SRC = { url: 'guitar-tick.mp3' };
const SWELL_SRC = { url: 'tone-swell.mp3' };
const BED_SRC = { url: 'bed-loop.mp3' }; // played whole, looped
// 24s of the live Dream Police performance, cut into a seamless loop
// (the last 1.5s is crossfaded into the first 1.5s). Takes over from the
// bed once the reader reaches the 2024 section.
const LIVE_SRC = { url: 'dream-police-loop.mp3' };

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

async function loadBuffer(ctx, url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return ctx.decodeAudioData(arrayBuffer);
}

function loadSamples() {
  if (samplesRequested) return;
  samplesRequested = true;
  const ctx = ensureAudioContext();
  loadBuffer(ctx, TICK_SRC.url).then((buf) => { buffers.tick = buf; }).catch(() => {});
  loadBuffer(ctx, SWELL_SRC.url).then((buf) => { buffers.swell = buf; }).catch(() => {});
  // The bed loop almost certainly isn't decoded yet when the toggle is
  // first clicked, so start it here once it arrives rather than only
  // from the click handler — but only if sound is still on and nothing
  // is playing yet (the user may have toggled off again in the meantime).
  loadBuffer(ctx, BED_SRC.url).then((buf) => {
    buffers.bed = buf;
    applyScene();
  }).catch(() => {});
  loadBuffer(ctx, LIVE_SRC.url).then((buf) => {
    buffers.live = buf;
    applyScene();
  }).catch(() => {});
}

// ---------- master bus ----------
// Every sound goes through one master gain so the overall level can be
// set in one place. All three files were loudness-normalised to the
// same level, so the per-sound gains below are directly comparable.
let master = null;
function getMaster() {
  const ctx = ensureAudioContext();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return master;
}

// ---------- looping music layers ----------
// Two loops, only one audible at a time. 'bed' plays through the story up
// to 2024; 'live' (the Dream Police performance) replaces it from the 2024
// section onward. Switching is a crossfade, not a cut.
const LOOPS = {
  bed:  { level: 0.4,  source: null, gain: null },
  live: { level: 0.65, source: null, gain: null },
};
let scene = 'bed';
const FADE = 2.5;

function startLoop(key) {
  const loop = LOOPS[key];
  const buf = buffers[key];
  if (!buf || loop.source) return;
  const ctx = ensureAudioContext();

  const source = ctx.createBufferSource();
  source.buffer = buf;
  source.loop = true;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(loop.level, ctx.currentTime + FADE);

  source.connect(gain).connect(getMaster());
  source.start();
  loop.source = source;
  loop.gain = gain;
}

function stopLoop(key, fade) {
  const loop = LOOPS[key];
  if (!loop.source) return;
  const ctx = ensureAudioContext();
  loop.gain.gain.cancelScheduledValues(ctx.currentTime);
  loop.gain.gain.setValueAtTime(loop.gain.gain.value, ctx.currentTime);
  loop.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
  const node = loop.source;
  setTimeout(() => { try { node.stop(); } catch (e) {} }, fade * 1000 + 100);
  loop.source = null;
  loop.gain = null;
}

// Make what is playing match the current scene. Safe to call any time:
// when sound toggles on, when a file finishes decoding, or on a scene change.
function applyScene() {
  if (!soundOn) return;
  const other = scene === 'live' ? 'bed' : 'live';
  startLoop(scene);
  stopLoop(other, FADE);
}

function stopAllLoops() {
  stopLoop('bed', 0.8);
  stopLoop('live', 0.8);
}

// The 2024 section decides the scene. Reaching it switches to the live
// loop; scrolling back above it switches back. Scrolling past it (so it
// is above the viewport) leaves the live loop playing.
const climax = document.querySelector('.beat-climax');
if (climax) {
  new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        scene = 'live';
      } else if (entry.boundingClientRect.top > 0) {
        scene = 'bed'; // section is below the viewport: user is above it
      }
      applyScene();
    });
  }, { threshold: 0.25 }).observe(climax);
}



// ---------- climax swell ----------
// A longer passage from tone-swell.mp3, reserved for the 2024 section
// only. Plays once per visit and ducks the bed underneath it.
const SWELL = { offset: 3.44, duration: 4.8 };
let swellPlayed = false;

function playSwell() {
  if (!soundOn || !buffers.swell || swellPlayed) return;
  swellPlayed = true;
  const ctx = ensureAudioContext();

  const source = ctx.createBufferSource();
  source.buffer = buffers.swell;

  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(1.0, t + 1.5);
  gain.gain.setValueAtTime(1.0, t + SWELL.duration - 1.8);
  gain.gain.linearRampToValueAtTime(0, t + SWELL.duration);

  source.connect(gain).connect(getMaster());
  source.start(t, SWELL.offset, SWELL.duration);
}

function handleSectionReveal(sectionEl) {
  if (!soundOn) return;
  // The live loop carries the 2024 section and everything after it, so no
  // accent notes or swell are layered on top of it. (playSwell is kept in
  // case you want it back: call it from here for the climax section.)
  if (scene === 'live' || sectionEl.closest('.beat-climax')) return;
  playAccent();
}

// ---------- toggle button ----------
const toggleBtn = document.getElementById('soundToggle');
toggleBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  toggleBtn.textContent = soundOn ? '♪' : '♪̸';
  if (soundOn) {
    loadSamples();
    applyScene();
  } else {
    stopAllLoops();
  }
});
