import { useEffect, useRef, useSyncExternalStore } from 'react';

const url = name => `${import.meta.env.BASE_URL}audio/${name === 'originalIntro' ? 'original-intro.mp4' : `${name}.${name === 'name' ? 'wav' : 'mp3'}`}`;
let music = null;
let track = null;
let unlocked = false;
let musicOwner = null;
let introPaused = false;
const voices = new Set();
let audioContext;
const fastBuffers = new Map();
const requests = new Map();
function prepareFastSound(name) {
  if (fastBuffers.has(name)) return fastBuffers.get(name);
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    const pending = fetch(url(name)).then(response => {
      if (!response.ok) throw new Error('Audio unavailable');
      return response.arrayBuffer();
    }).then(bytes => audioContext.decodeAudioData(bytes)).then(buffer => {
      // Skip leading silence so the audible transient starts with the interaction.
      let first = buffer.length;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < first; i++) if (Math.abs(samples[i]) > .015) { first = i; break; }
      }
      return { buffer, offset: Math.max(0, first / buffer.sampleRate - .005) };
    });
    fastBuffers.set(name, pending);
    pending.catch(() => { fastBuffers.delete(name); });
    return pending;
  } catch { return Promise.reject(new Error('Web Audio unavailable')); }
}
function playFastSound(name, volume, duration, request) {
  prepareFastSound(name).then(({ buffer, offset }) => {
    if (requests.get(name) !== request || document.hidden || !effectsGain()) return;
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    source.connect(gain); gain.connect(audioContext.destination);
    const length = Math.min(buffer.duration - offset, duration ? duration / 1000 : buffer.duration);
    if (length <= 0) return;
    // Short fades keep rapid radar pulses free of cut-off clicks.
    const envelope = audioContext.createGain();
    gain.disconnect(); gain.connect(envelope); envelope.connect(audioContext.destination);
    const start = audioContext.currentTime;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(1, start + .003);
    envelope.gain.setValueAtTime(1, start + Math.max(.003, length - .008));
    envelope.gain.linearRampToValueAtTime(0, start + length);
    const voice = { effectName: name, baseVolume: volume,
      set volume(value) { gain.gain.value = value; },
      pause() { try { source.stop(); } catch { /* Already stopped. */ } } };
    voice.volume = volume * effectsGain();
    voices.add(voice);
    source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); envelope.disconnect(); };
    source.start(start, offset, length);
  }).catch(() => { /* Missing effects never interrupt the game. */ });
}

const settingsKey = 'elvira-audio-settings-v1';
const defaults = { musicVolume: 1, effectsVolume: 1, musicMuted: false, effectsMuted: false };
let settings = { ...defaults };
try {
  const saved = JSON.parse(localStorage.getItem(settingsKey));
  for (const key of ['musicVolume', 'effectsVolume']) {
    if (typeof saved?.[key] === 'number' && Number.isFinite(saved[key])) settings[key] = Math.max(0, Math.min(1, saved[key]));
  }
  for (const key of ['musicMuted', 'effectsMuted']) if (typeof saved?.[key] === 'boolean') settings[key] = saved[key];
} catch { /* Audio controls also work without browser storage. */ }
const listeners = new Set();
const subscribe = callback => { listeners.add(callback); return () => listeners.delete(callback); };
const snapshot = () => settings;
const musicGain = () => settings.musicMuted ? 0 : settings.musicVolume;
const effectsGain = () => settings.effectsMuted ? 0 : settings.effectsVolume;
export function updateAudioSettings(patch) {
  settings = { ...settings, ...patch };
  if (music) music.volume = (['launch', 'originalIntro'].includes(track) ? .7 : .22) * musicGain();
  voices.forEach(sound => { sound.volume = sound.baseVolume * effectsGain(); });
  try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* Keep in-memory settings. */ }
  listeners.forEach(callback => callback());
}
export function useAudioSettings() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const attempt = audio => { const promise = audio.play(); promise?.catch(() => {}); };
export function playSound(name, volume = .55, duration) {
  if (document.hidden) return;
  stopSound(name);
  if (!effectsGain()) return;
  if (name === 'flip' || name === 'radar') {
    playFastSound(name, volume, duration, requests.get(name));
    return;
  }
  if (name === 'win' && duration === undefined) duration = 2200;
  const sound = new Audio(url(name));
  sound.effectName = name;
  sound.baseVolume = volume;
  sound.volume = volume * effectsGain();
  voices.add(sound);
  const clean = () => voices.delete(sound);
  sound.onended = clean;
  sound.onerror = clean;
  attempt(sound);
  if (duration) setTimeout(() => { sound.pause(); clean(); }, duration);
}
export function stopSound(name) {
  requests.set(name, (requests.get(name) || 0) + 1);
  voices.forEach(sound => { if (sound.effectName === name) { sound.pause(); voices.delete(sound); } });
}
function stopEffects() {
  for (const name of requests.keys()) requests.set(name, requests.get(name) + 1);
  voices.forEach(sound => sound.pause());
  voices.clear();
}
function setMusic(name, loop = true) {
  if (track === name) return;
  music?.pause();
  introPaused = false;
  track = name;
  music = name ? new Audio(url(name)) : null;
  if (music) {
    music.loop = loop;
    music.volume = (['launch', 'originalIntro'].includes(name) ? .7 : .22) * musicGain();
    if (!document.hidden) attempt(music);
  }
}
export function useAudioControls() {
  useEffect(() => {
    for (const name of ['flip', 'radar']) prepareFastSound(name).catch(() => {});
    const unlock = () => {
      audioContext?.resume().catch(() => {});
      unlocked = true; if (music?.paused && !document.hidden && !introPaused) attempt(music); };
    const click = event => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('button');
      if (!button || button.disabled || button.closest('.ex-hit, .ex-mini, .elvira-collection-card, .archive-original-flip, .archive-flip-button')) return;
      playSound('button', .35);
    };
    const visibility = () => {
      if (document.hidden) { music?.pause(); stopEffects(); }
      else if (unlocked && music && !introPaused) attempt(music);
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    document.addEventListener('click', click, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('click', click, true);
      document.removeEventListener('visibilitychange', visibility);
      setMusic(null); stopEffects();
    };
  }, []);
}
export function useMusic(name, loop = true) {
  useEffect(() => {
    if (!name) return;
    const owner = {};
    musicOwner = owner;
    setMusic(name, loop);
    return () => { if (musicOwner === owner) { musicOwner = null; setMusic(null); } };
  }, [name, loop]);
}
export function useRadarAudio(active, strength, interval) {
  const latest = useRef({ strength, interval });
  useEffect(() => { latest.current = { strength, interval }; }, [strength, interval]);
  useEffect(() => {
    if (!active) return;
    let nextPing = 0;
    let lastPing = -Infinity;
    const tick = () => {
      const signal = latest.current;
      const now = performance.now();
      // Re-evaluate the due time on movement instead of waiting for an old, slow timeout.
      nextPing = lastPing + signal.interval;
      if (now >= nextPing) {
        if (!document.hidden) playSound('radar', .24 + signal.strength * .42, 85);
        lastPing = now;
      }
    };
    tick();
    const timer = setInterval(tick, 20);
    return () => { clearInterval(timer); stopSound('radar'); };
  }, [active]);
}

export function syncIntroAudio(time, paused = false) {
  introPaused = paused;
  if (track !== 'originalIntro' || !music) return;
  if (Number.isFinite(time) && Math.abs(music.currentTime - time) > .3) {
    try { music.currentTime = time; } catch { /* Metadata may still be loading. */ }
  }
  if (paused) music.pause();
  else if (!document.hidden && music.paused) attempt(music);
}
