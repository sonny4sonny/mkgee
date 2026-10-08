
const io = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting && !entry.target.classList.contains('in')) {
      entry.target.classList.add('in');
      handleSectionReveal(entry.target);
    }
  });
}, { threshold: 0.2 });

document.querySelectorAll('.reveal').forEach((el) => io.observe(el));


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

let soundOn = false;
let audioCtx = null;


const buffers = { tick: null, swell: null, bed: null };
let samplesRequested = false;


const TICK_SRC = { url: 'guitar-tick.mp3' };
const SWELL_SRC = { url: 'tone-swell.mp3' };
const BED_SRC = { url: 'bed-loop.mp3' }; 

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
 
  loadBuffer(ctx, BED_SRC.url).then((buf) => {
    buffers.bed = buf;
    if (soundOn && !bedSource) startBed();
  }).catch(() => {});
}

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

const BED_LEVEL = 0.4;
let bedSource = null;
let bedGain = null;

function startBed() {
  if (!buffers.bed || bedSource) return;
  const ctx = ensureAudioContext();

  const source = ctx.createBufferSource();
  source.buffer = buffers.bed;
  source.loop = true;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(BED_LEVEL, ctx.currentTime + 2);

  source.connect(gain).connect(getMaster());
  source.start();

  bedSource = source;
  bedGain = gain;
}

function stopBed() {
  if (!bedGain || !bedSource) return;
  const ctx = ensureAudioContext();
  bedGain.gain.cancelScheduledValues(ctx.currentTime);
  bedGain.gain.setValueAtTime(bedGain.gain.value, ctx.currentTime);
  bedGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  const node = bedSource;
  setTimeout(() => { try { node.stop(); } catch (e) {} }, 900);
  bedSource = null;
  bedGain = null;
}

function duckBed(seconds) {
  if (!bedGain) return;
  const ctx = ensureAudioContext();
  const g = bedGain.gain;
  g.cancelScheduledValues(ctx.currentTime);
  g.setValueAtTime(g.value, ctx.currentTime);
  g.linearRampToValueAtTime(BED_LEVEL * 0.35, ctx.currentTime + 1);
  g.setValueAtTime(BED_LEVEL * 0.35, ctx.currentTime + seconds - 1.5);
  g.linearRampToValueAtTime(BED_LEVEL, ctx.currentTime + seconds);
}

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
  duckBed(SWELL.duration + 1);
}

function handleSectionReveal(sectionEl) {
  if (!soundOn) return;
  if (sectionEl.closest('.beat-climax')) {
    playSwell();
  } else {
    playAccent();
  }
}

const toggleBtn = document.getElementById('soundToggle');
toggleBtn.addEventListener('click', () => {
  soundOn = !soundOn;
  toggleBtn.textContent = soundOn ? '♪' : '♪̸';
  if (soundOn) {
    loadSamples();
    startBed();
  } else {
    stopBed();
  }
});
