import { playSound, stopSound, useMusic, useRadarAudio } from '../audio/audio';
import ArchiveCard from './components/ArchiveCard';
import { useEffect, useRef, useState } from 'react';
import useSceneGeometry from './useSceneGeometry';
import { expeditions } from '../../data/expeditions';
import './ExpeditionGame.css';

const storageKey = id => `elvira-expedition-v1-${id}`;

function readProgress(id, data) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(id)));
    const valid = new Set(data.scenes.flatMap(s => s.targets.map(t => t.id)));
    return {
      radarUsed: Array.isArray(saved?.radarUsed) ? saved.radarUsed.filter(id => data.scenes.some(scene => scene.id === id)) : [],
      found: Array.isArray(saved?.found) ? saved.found.filter(x => valid.has(x)) : [],
      index: Math.max(0, Math.min(data.scenes.length - 1, Number(saved?.index) || 0))
    };
  } catch {
    return { found: [], index: 0, radarUsed: [] };
  }
}

function radarSignal(point, targets, aspect = 16 / 9) {
  if (!point || !targets.length) return { strength: 0, level: 'AWAITING SCAN', pulseIntervalMs: 650 };
  const distance = Math.min(...targets.map(t => Math.hypot((point.x - t.box[0] - t.box[2] / 2) * aspect, point.y - t.box[1] - t.box[3] / 2))) / Math.hypot(100 * aspect, 100);
  const strength = Math.max(0, Math.min(1, 1 - distance / .65));
  return {
    strength,
    level: strength > .87 ? 'VERY CLOSE' : strength > .7 ? 'CLOSE' : strength > .4 ? 'WARM' : 'DISTANT',
    pulseIntervalMs: Math.round(110 + 540 * (1 - strength) ** 2)
  };
}

// 1) 3 GEZEGENİN İNİŞ VİDEOLARI
const LANDING_VIDEOS = {
  moon: '/videos/moon/landingmoon.mp4',
  mars: '/videos/mars/landingmars.mp4',
  deepSpace: '/videos/deepspace/landingdeepspace.mp4',
};

// 2) HİKAYE EKRANI ARKA PLAN GIF'LERİ
const STORY_BG_GIFS = {
  moon: '/videos/moon/moonstory.gif',
  mars: '/videos/mars/marsstory.gif',
  deepSpace: '/videos/deepspace/deepspacestory.gif',
};

export default function ExpeditionGame({ sector, onExit, onRadarSignal, playerName }) {
  const data = expeditions[sector.id];
  const landingVideoSrc = LANDING_VIDEOS[sector.id] || data.video;
  const storyBgGif = STORY_BG_GIFS[sector.id] || '/videos/gif.gif';

  const explorerName = playerName || sessionStorage.getItem('elvira-player-name') || 'Vildan';

  const [initial] = useState(() => readProgress(sector.id, data));
  const [found, setFound] = useState(initial.found);
  const [radarUsed, setRadarUsed] = useState(initial.radarUsed);
  const [index, setIndex] = useState(initial.index);
  const [phase, setPhase] = useState(landingVideoSrc ? 'landing' : 'story');
  const [card, setCard] = useState(null);
  const [warning, setWarning] = useState(null);
  const [radarUntil, setRadarUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [point, setPoint] = useState(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [imageError, setImageError] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [debug, setDebug] = useState(false);
  const [introKey, setIntroKey] = useState(0);

  useMusic(phase === 'gameover' ? 'gameover' : phase === 'returning' ? 'home' : ['story', 'briefing', 'search'].includes(phase) ? sector.id : null);

  useEffect(() => {
    if (!card) return;
    return () => ['win', 'open', 'flip'].forEach(stopSound);
  }, [card]);

  const scene = data.scenes[index];
  const sceneRef = useRef(null);
  const geometry = useSceneGeometry(sceneRef, scene.id, phase, imageError);
  const hintUsed = radarUsed.includes(scene.id);
  const all = data.scenes.flatMap(s => s.targets);
  const remaining = scene.targets.filter(t => !found.includes(t.id));
  const seconds = Math.max(0, Math.ceil((radarUntil - now) / 1000));
  const active = radarUntil > 0 && seconds > 0 && phase === 'search' && !card;
  const signal = radarSignal(active ? point : null, remaining, geometry?.aspect || aspect);

  useRadarAudio(active, signal.strength, signal.pulseIntervalMs);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(sector.id), JSON.stringify({ found, index, radarUsed }));
    } catch { /* Play remains available without storage. */ }
  }, [found, index, radarUsed, sector.id]);

  useEffect(() => {
    if (!radarUntil) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= radarUntil) setRadarUntil(0);
    }, 100);
    return () => clearInterval(timer);
  }, [radarUntil]);

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => setWarning(null), 2400);
    return () => clearTimeout(timer);
  }, [warning]);

  useEffect(() => {
    onRadarSignal?.({ active, strength: signal.strength, level: signal.level, pulseIntervalMs: signal.pulseIntervalMs });
  }, [active, signal.strength, signal.level, signal.pulseIntervalMs, onRadarSignal]);

  useEffect(() => () => onRadarSignal?.({ active: false, strength: 0, level: 'OFF', pulseIntervalMs: 0 }), [onRadarSignal]);

  function navigate(next, nextPhase = 'briefing') {
    setIndex(next);
    setPhase(nextPhase);
    if (nextPhase === 'briefing') {
      setIntroKey(k => k + 1);
    }
    setRadarUntil(0);
    setPoint(null);
    setWarning(null);
    setImageError(false);
    setCard(null);
  }

  function openCard(target) {
    playSound('open');
    setCard(target);
    setRadarUntil(0);
  }

  function discover(target) {
    setFound(ids => ids.includes(target.id) ? ids : [...ids, target.id]);
    setWarning(null);
    playSound(found.includes(target.id) ? 'open' : 'win');
    setCard(target);
    setRadarUntil(0);
  }

  function locate(event) {
    if (!geometry) return;
    const container = event.currentTarget;
    const rect = container.getBoundingClientRect();
    setAspect(geometry.aspect);
    setPoint({
      x: (event.clientX - rect.left - container.clientLeft - geometry.left) / geometry.width * 100,
      y: (event.clientY - rect.top - container.clientTop - geometry.top) / geometry.height * 100
    });
  }

  const actionText = found.length ? 'RESUME EXPEDITION' : 'BEGIN EXPEDITION';
  const tickerMessage = `✦ ${explorerName}, if you want to discover where the story leads and find the abandoned artifacts, press ${actionText} → ✦`;

// 3 SEKTÖRÜN TAMAMININ BİTİP BİTMEDİĞİNİ KONTROL EDER
  const allSectorsDone = Object.keys(expeditions).every(secId => {
    const secTargets = expeditions[secId].scenes.flatMap(s => s.targets.map(t => t.id));
    if (secId === sector.id) {
      return secTargets.every(id => found.includes(id));
    }
    const saved = readProgress(secId, expeditions[secId]);
    return secTargets.every(id => saved.found.includes(id));
  });

  useEffect(() => {
    if (phase === 'complete' && allSectorsDone) playSound('complete');
  }, [phase, allSectorsDone]);

  return (
    <main className="expedition" style={{ '--sector': sector.themeColor }}>
      <style>{`
        .expedition {
          height: 100vh !important;
          width: 100vw !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
          background: #030308 !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          position: relative !important;
          .ex-silhouette {
          filter: brightness(0.3) contrast(2.4) drop-shadow(0 0 12px var(--sector)) !important;
          }
        }

        /* ÜST HEADER (SADECE LANDING VE STORY EKRANLARINDA GÖRÜNÜR) */
        .ex-header {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          height: 76px !important;
          z-index: 30 !important;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 18px 48px 18px 72px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          text-shadow: 0 3px 0 #000, 0 0 15px rgba(0,0,0,0.9);
        }
        .ex-header h1 {
          font-family: 'Press Start 2P', monospace !important;
          font-size: clamp(13px, 1.4vw, 18px) !important;
          color: var(--sector, #38bdf8) !important;
          letter-spacing: 2px !important;
          margin: 4px 0 0 0 !important;
          text-shadow: 0 3px 0 #000, 0 0 18px rgba(0, 0, 0, 0.9) !important;
        }
        .ex-header button, .ex-archive-top-bar button {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 10px !important;
          padding: 10px 14px !important;
          background: rgba(9, 11, 26, 0.85) !important;
          border: 2px solid rgba(148, 163, 184, 0.45) !important;
          color: #f8fafc !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
        }
        .ex-header button:hover, .ex-archive-top-bar button:hover {
          border-color: var(--sector, #38bdf8) !important;
          color: var(--sector, #38bdf8) !important;
          transform: scale(1.04);
        }
        .ex-header::after, .ex-header::before {
          display: none !important;
        }

        /* LANDING VİDEO EKRANI */
        .ex-landing {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          border: none !important;
          background: #000 !important;
          z-index: 1 !important;
        }
        .ex-landing video {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          max-height: none !important;
          object-fit: cover !important;
          z-index: 1 !important;
        }
        .ex-landing-copy {
          position: fixed !important;
          bottom: 34px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          z-index: 10 !important;
          width: 90% !important;
          max-width: 820px !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          text-align: center !important;
          pointer-events: none;
        }
        .ex-landing-copy .ex-eyebrow {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 11px !important;
          color: #fcd34d !important;
          letter-spacing: 3px !important;
          text-shadow: 0 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000;
          margin-bottom: 10px !important;
        }
        .ex-landing-copy h2 {
          font-family: 'Press Start 2P', monospace !important;
          font-size: clamp(15px, 2vw, 24px) !important;
          margin: 0 0 18px 0 !important;
          text-shadow: 0 3px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, 0 0 22px rgba(0,0,0,0.95);
        }
        .ex-landing-copy button {
          pointer-events: auto !important;
          font-family: 'Press Start 2P', monospace !important;
          font-size: 10px !important;
          padding: 12px 20px !important;
          background: rgba(9, 11, 26, 0.8) !important;
          border: 2px solid #475569 !important;
          color: #e2e8f0 !important;
          cursor: pointer !important;
        }

        /* STORY AŞAMASI */
        .ex-story-bg-gif {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          object-fit: cover !important;
          z-index: 1 !important;
          filter: brightness(0.95) contrast(1.05);
          pointer-events: none !important;
        }
        .ex-story-fullscreen {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          z-index: 10 !important;
          display: flex !important;
          flex-direction: column !important;
          justify-content: center !important;
          align-items: flex-start !important;
          text-align: left !important;
          padding: 60px 6vw 64px 7vw !important;
          background: linear-gradient(90deg, rgba(3, 3, 8, 0.55) 0%, rgba(3, 3, 8, 0.15) 45%, transparent 100%) !important;
        }
        .ex-story-floater {
          position: relative !important;
          z-index: 15 !important;
          max-width: 780px !important;
          width: 100% !important;
          padding: 8px 0 !important;
          animation: storyFadeUp 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards !important;
        }
        @keyframes storyFadeUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .ex-story-title {
          font-family: 'Press Start 2P', monospace !important;
          font-size: clamp(18px, 2.2vw, 27px) !important;
          color: var(--sector, #38bdf8) !important;
          letter-spacing: 2px !important;
          line-height: 1.5 !important;
          margin: 0 0 20px 0 !important;
          white-space: nowrap !important;
          text-transform: uppercase !important;
          text-shadow:
            0 3px 0 #05050d,
            -2px -2px 0 #05050d,
            2px -2px 0 #05050d,
            -2px 2px 0 #05050d,
            2px 2px 0 #05050d,
            0 0 22px rgba(0, 0, 0, 0.9) !important;
        }
        .ex-story-desc {
          font-family: 'Silkscreen', 'Space Mono', monospace !important;
          font-size: clamp(12px, 1.25vw, 15px) !important;
          line-height: 1.85 !important;
          color: #e2e8f0 !important;
          max-width: 720px !important;
          margin: 0 0 30px 0 !important;
          text-shadow:
            0 2px 0 #04040a,
            -2px -2px 0 #04040a,
            2px -2px 0 #04040a,
            0 0 18px rgba(0, 0, 0, 0.95) !important;
        }
        .ex-story-buttons {
          display: flex !important;
          gap: 16px !important;
          justify-content: flex-start !important;
          align-items: center !important;
          flex-wrap: wrap !important;
        }
        @keyframes retroPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 16px rgba(252, 211, 77, 0.4), inset 0 0 8px rgba(252, 211, 77, 0.15); }
          50% { transform: scale(1.03); box-shadow: 0 0 28px rgba(252, 211, 77, 0.8), inset 0 0 14px rgba(252, 211, 77, 0.25); }
        }
        .ex-btn-cosmos {
          font-family: 'Press Start 2P', monospace !important;
          font-size: clamp(10px, 0.95vw, 12px) !important;
          padding: 14px 22px !important;
          background: rgba(9, 11, 26, 0.86) !important;
          color: #fcd34d !important;
          border: 2px solid #fcd34d !important;
          letter-spacing: 1.5px !important;
          cursor: pointer !important;
          animation: retroPulse 2.2s infinite ease-in-out !important;
          transition: background 0.2s, color 0.2s !important;
        }
        .ex-btn-cosmos:hover {
          background: #fcd34d !important;
          color: #05050a !important;
        }
        .ex-btn-cosmos:disabled {
          opacity: 0.4 !important;
          animation: none !important;
          cursor: not-allowed !important;
        }
        .ex-btn-replay {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 10px !important;
          padding: 14px 18px !important;
          background: rgba(15, 23, 42, 0.78) !important;
          color: #cbd5e1 !important;
          border: 2px solid #475569 !important;
          letter-spacing: 1px !important;
          cursor: pointer !important;
          transition: all 0.2s ease !important;
        }
        .ex-btn-replay:hover {
          border-color: var(--sector, #38bdf8) !important;
          color: #f8fafc !important;
          box-shadow: 0 0 16px var(--sector, rgba(56, 189, 248, 0.4)) !important;
          transform: translateY(-2px);
        }

        /* ALTTA KAYAN UZAY BÜLTENİ (TICKER) */
        .ex-ticker-bar {
          position: fixed !important;
          bottom: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 44px !important;
          background: rgba(5, 7, 18, 0.92) !important;
          border-top: 2px solid var(--sector, #fcd34d) !important;
          box-shadow: 0 -4px 25px rgba(0, 0, 0, 0.9), 0 0 18px var(--sector, rgba(56, 189, 248, 0.25)) !important;
          z-index: 25 !important;
          overflow: hidden !important;
          display: flex !important;
          align-items: center !important;
        }
        .ex-ticker-track {
          display: flex !important;
          width: max-content !important;
          white-space: nowrap !important;
          animation: tickerSlide 24s linear infinite !important;
        }
        .ex-ticker-item {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 10px !important;
          color: #fcd34d !important;
          letter-spacing: 1.5px !important;
          padding-right: 90px !important;
          text-shadow: 0 2px 0 #000, 0 0 10px rgba(252, 211, 77, 0.4) !important;
        }
        @keyframes tickerSlide {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        /* =========================================================
           BRIEFING, SEARCH & COMPLETE:
           ÜST BAŞLIK YOK, TAM ORTALI İKİ BÜYÜK DİKDÖRTGEN KUTU,
           HER İKİ KUTU DA KENDİ İÇİNDE KAYDIRILABİLİR (SCROLLABLE)
           ========================================================= */
        .ex-space-backdrop {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          object-fit: cover !important;
          z-index: 0 !important;
          filter: brightness(0.8) contrast(1.08);
          pointer-events: none !important;
        }

        .ex-layout {
          position: fixed !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
          z-index: 10 !important;
          width: 94vw !important;
          max-width: 1380px !important;
          height: 92vh !important;
          margin: 0 !important;
          padding: 0 !important;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 330px !important;
          gap: 24px !important;
          align-items: stretch !important;
        }

        /* SOL BÜYÜK MİSYON DİKDÖRTGENİ VE SAĞ ARŞİV DİKDÖRTGENİ (İKİSİ DE DİKEY KAYDIRILABİLİR) */
        .ex-main {
          height: 100% !important;
          background: rgba(8, 10, 24, 0.86) !important;
          backdrop-filter: blur(10px) !important;
          border: 2px solid var(--sector, rgba(148, 163, 184, 0.4)) !important;
          box-shadow: 0 0 32px rgba(0, 0, 0, 0.85), inset 0 0 22px rgba(56, 189, 248, 0.06) !important;
          border-radius: 14px !important;
          padding: 26px 32px !important;
          display: flex !important;
          flex-direction: column !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
          scroll-behavior: smooth !important;
        }

        .ex-collection {
          height: 100% !important;
          background: rgba(8, 10, 24, 0.86) !important;
          backdrop-filter: blur(10px) !important;
          border: 2px solid rgba(148, 163, 184, 0.35) !important;
          box-shadow: 0 0 32px rgba(0, 0, 0, 0.85) !important;
          border-radius: 14px !important;
          padding: 22px 20px !important;
          display: flex !important;
          flex-direction: column !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
        }

        /* ÖZEL RETRO SCROLLBAR STİLİ */
        .ex-main::-webkit-scrollbar,
        .ex-collection::-webkit-scrollbar {
          width: 8px;
        }
        .ex-main::-webkit-scrollbar-track,
        .ex-collection::-webkit-scrollbar-track {
          background: rgba(5, 7, 18, 0.6);
          border-radius: 8px;
        }
        .ex-main::-webkit-scrollbar-thumb,
        .ex-collection::-webkit-scrollbar-thumb {
          background: var(--sector, #475569);
          border-radius: 8px;
        }

        .ex-archive-top-bar {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 8px !important;
          margin-bottom: 10px !important;
        }

        /* SİNEMATİK TAM EKRAN ORTADAN POP-UP HEADING ANİMASYONU */
        .ex-center-popup-banner {
          position: fixed !important;
          inset: 0 !important;
          z-index: 60 !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          text-align: center !important;
          pointer-events: none !important;
          animation: centerBannerIntro 1.45s cubic-bezier(0.22, 1, 0.36, 1) forwards !important;
        }
        @keyframes centerBannerIntro {
          0% {
            opacity: 0;
            transform: scale(0.85);
            background: rgba(3, 3, 8, 0.78);
          }
          22% {
            opacity: 1;
            transform: scale(1.08);
            background: rgba(3, 3, 8, 0.72);
          }
          62% {
            opacity: 1;
            transform: scale(1.04);
            background: rgba(3, 3, 8, 0.55);
          }
          100% {
            opacity: 0;
            transform: translate(-18vw, -28vh) scale(0.52);
            background: rgba(3, 3, 8, 0);
          }
        }
        .ex-center-popup-banner span {
          font-family: 'Press Start 2P', monospace !important;
          font-size: clamp(13px, 1.5vw, 18px) !important;
          color: #fcd34d !important;
          letter-spacing: 3px !important;
          margin-bottom: 14px !important;
          text-shadow: 0 3px 0 #000, 0 0 20px rgba(252, 211, 77, 0.8) !important;
        }
        .ex-center-popup-banner h2 {
          font-family: 'Press Start 2P', monospace !important;
          font-size: clamp(24px, 3.6vw, 44px) !important;
          color: var(--sector, #38bdf8) !important;
          letter-spacing: 3px !important;
          margin: 0 !important;
          text-transform: uppercase !important;
          text-shadow:
            0 4px 0 #000,
            -3px -3px 0 #000,
            3px -3px 0 #000,
            0 0 35px var(--sector, #38bdf8),
            0 0 65px rgba(0, 0, 0, 0.95) !important;
        }

        /* BRIEFING KUTUSU İÇ DÜZENİ */
        .ex-main > .ex-story {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
          margin: 0 !important;
          flex: 1 !important;
          display: flex !important;
          flex-direction: column !important;
          justify-content: space-between !important;
        }

        /* Clear the fixed menu button by 12px without moving the game panels. */
        .ex-brief-header-settled,
        .ex-mission-heading {
          padding-left: max(0px, calc(38px - 3vw)) !important;
        }

        .ex-brief-header-settled {
          animation: settledHeaderFade 1.45s ease forwards !important;
        }
        @keyframes settledHeaderFade {
          0%, 68% { opacity: 0; transform: translateY(-6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .ex-brief-header-settled .ex-eyebrow {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 11px !important;
          color: #fcd34d !important;
          letter-spacing: 2.5px !important;
          margin: 0 0 10px 0 !important;
          text-shadow: 0 2px 0 #000 !important;
        }
        .ex-brief-header-settled h2 {
          font-family: 'Press Start 2P', monospace !important;
          font-size: clamp(18px, 2.2vw, 28px) !important;
          color: var(--sector, #f8fafc) !important;
          margin: 0 !important;
          letter-spacing: 2px !important;
          text-shadow: 0 4px 0 #000 !important;
        }

        .ex-brief-body-fade {
          display: flex !important;
          flex-direction: column !important;
          justify-content: space-between !important;
          flex: 1 !important;
          margin-top: 14px !important;
          animation: briefBodyAppear 1.45s ease forwards !important;
        }
        @keyframes briefBodyAppear {
          0%, 55% { opacity: 0; transform: translateY(14px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        .ex-brief-targets {
          display: grid !important;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)) !important;
          gap: 18px !important;
          margin: 14px 0 !important;
          flex: 1 !important;
          align-items: stretch !important;
        }
        .ex-brief-targets > div {
          background: rgba(5, 7, 18, 0.76) !important;
          border: 1px solid rgba(148, 163, 184, 0.28) !important;
          border-radius: 10px !important;
          padding: 18px 22px !important;
          display: flex !important;
          flex-direction: column !important;
          justify-content: center !important;
        }
        .ex-brief-targets img {
          max-height: 155px !important;
          width: 100% !important;
          object-fit: contain !important;
          margin-bottom: 14px !important;
        }
        .ex-brief-targets h3 {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 14px !important;
          color: var(--sector, #38bdf8) !important;
          margin: 0 0 10px 0 !important;
        }
        .ex-brief-targets p {
          font-family: 'Silkscreen', 'Space Mono', monospace !important;
          font-size: 13px !important;
          line-height: 1.65 !important;
          margin: 0 !important;
          color: #cbd5e1 !important;
        }

        .ex-brief-actions {
          display: flex !important;
          gap: 14px !important;
          align-items: center !important;
          margin-top: 12px !important;
        }

        /* =========================================================
           SEARCH (ARAMA SAHNESİ): RADAR VE FOTOĞRAF TEK EKRANDA TAM GÖRÜNÜR
           ========================================================= */
        .ex-mission-heading {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 16px !important;
          margin-bottom: 8px !important;
          flex-shrink: 0 !important;
        }
        .ex-mission-heading .ex-eyebrow {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 10px !important;
          color: #fcd34d !important;
          letter-spacing: 2px !important;
          margin: 0 0 4px 0 !important;
        }
        .ex-mission-heading h2 {
          font-family: 'Press Start 2P', monospace !important;
          font-size: clamp(14px, 1.6vw, 20px) !important;
          color: var(--sector, #f8fafc) !important;
          margin: 0 !important;
          letter-spacing: 1.5px !important;
          text-shadow: 0 3px 0 #000 !important;
        }

        /* RETRO 0/1 RECOVERED ROZETİ */
        .ex-recovered-badge {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 10px !important;
          color: #fcd34d !important;
          background: rgba(5, 7, 18, 0.9) !important;
          border: 2px solid var(--sector, #fcd34d) !important;
          padding: 8px 12px !important;
          border-radius: 6px !important;
          letter-spacing: 1.5px !important;
          white-space: nowrap !important;
          text-shadow: 0 2px 0 #000 !important;
          box-shadow: 0 0 16px rgba(0, 0, 0, 0.7), inset 0 0 10px rgba(252, 211, 77, 0.12) !important;
        }

        /* RADAR ÇUBUĞU (HER ZAMAN FOTOĞRAFIN HEMEN ÜSTÜNDE VE GÖRÜNÜR) */
        .ex-radar {
          position: sticky !important;
          top: 0 !important;
          z-index: 20 !important;
          flex-shrink: 0 !important;
          padding: 8px 14px !important;
          margin-bottom: 10px !important;
          background: rgba(5, 7, 18, 0.92) !important;
          backdrop-filter: blur(6px) !important;
          border: 1px solid rgba(148, 163, 184, 0.35) !important;
          border-radius: 8px !important;
        }
        .ex-radar button {
          font-family: 'Press Start 2P', monospace !important;
          font-size: 10px !important;
          padding: 8px 12px !important;
        }
        .ex-radar span[role="status"] {
          font-family: 'Silkscreen', 'Space Mono', monospace !important;
          font-size: 12px !important;
          letter-spacing: 1px !important;
        }

        /* SOL KUTUYU GRID YAPAR: SOL ALTTA DEV FOTOĞRAF, SAĞINDA KONTROL PANELİ */
        .ex-main {
          height: 100% !important;
          overflow: hidden !important;
          padding: 14px 20px !important;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 215px !important;
          grid-template-rows: auto auto minmax(0, 1fr) auto !important;
          column-gap: 20px !important;
          row-gap: 8px !important;
          align-items: stretch !important;
        }

        .ex-main > .ex-story {
          grid-column: 1 / -1 !important;
          grid-row: 1 / -1 !important;
        }

        .ex-mission-heading {
          grid-column: 1 / -1 !important;
          grid-row: 1 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          margin: 0 !important;
        }
        .ex-mission-heading .ex-eyebrow {
          font-size: 9px !important;
          margin: 0 0 2px 0 !important;
        }
        .ex-mission-heading h2 {
          font-size: clamp(13px, 1.4vw, 17px) !important;
          margin: 0 !important;
        }
        .ex-recovered-badge {
          font-size: 9px !important;
          padding: 5px 10px !important;
        }

        .ex-radar {
          grid-column: 1 / -1 !important;
          grid-row: 2 !important;
          padding: 5px 10px !important;
          margin: 0 !important;
          gap: 10px !important;
        }
        .ex-radar button {
          font-size: 9px !important;
          padding: 5px 8px !important;
        }

        /* SOL ALT: Fotoğraf soldan başlar ve en alta kadar büyür */
        .ex-scene {
          grid-column: 1 / 2 !important;
          grid-row: 3 / 5 !important;
          position: relative !important;
          width: 100% !important;
          height: 100% !important;
          max-height: none !important;
          aspect-ratio: 16 / 9 !important;
          margin: 0 !important;
          align-self: center !important;
          justify-self: start !important;
          border-radius: 10px !important;
          border: 2px solid var(--sector, rgba(148, 163, 184, 0.45)) !important;
          overflow: hidden !important;
          background: #050712 !important;
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.8) !important;
        }
        .ex-scene img {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          display: block !important;
        }

        /* SAĞ SÜTUN ÜST: Fotoğrafın sağındaki durum yazısı */
        .ex-feedback {
          grid-column: 2 / 3 !important;
          grid-row: 3 / 4 !important;
          align-self: end !important;
          margin: 0 0 8px 0 !important;
          padding: 12px !important;
          background: rgba(5, 7, 18, 0.75) !important;
          border: 1px dashed rgba(148, 163, 184, 0.35) !important;
          border-radius: 8px !important;
          font-size: 11px !important;
          line-height: 1.55 !important;
          text-align: left !important;
        }

        /* SAĞ SÜTUN ALT: Fotoğrafın sağındaki butonlar */
        .ex-nav {
          grid-column: 2 / 3 !important;
          grid-row: 4 / 5 !important;
          align-self: end !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 10px !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .ex-nav button,
        .ex-nav .ex-btn-cosmos,
        .ex-nav .ex-btn-replay {
          width: 100% !important;
          padding: 12px 10px !important;
          font-size: 9.5px !important;
          text-align: center !important;
          justify-content: center !important;
          box-sizing: border-box !important;
          min-width: 0 !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          white-space: normal !important;
          overflow-wrap: anywhere !important;
        }

        .ex-silhouette {
          filter: brightness(0.3) contrast(1.4) drop-shadow(0 0 12px var(--sector)) !important;
        }

        .ex-clues, .ex-caption, .ex-debug {
          display: none !important;
        }

        /* YAZIYI FOTOĞRAFIN ALTINA ALIR, BUTONLARI SAĞ SÜTUNA ORTALAR */
        .ex-scene {
          grid-column: 1 / 2 !important;
          grid-row: 3 / 4 !important;
        }
        .ex-feedback {
          grid-column: 1 / 2 !important;
          grid-row: 4 / 5 !important;
          margin: 4px 0 0 0 !important;
          padding: 0 !important;
          background: transparent !important;
          border: none !important;
          text-align: center !important;
          color: #fcd34d !important;
        }
        .ex-nav {
          grid-column: 2 / 3 !important;
          grid-row: 3 / 5 !important;
          align-self: center !important;
          justify-content: center !important;
          gap: 14px !important;
        }
        .ex-nav button, .ex-nav .ex-btn-cosmos, .ex-nav .ex-btn-replay {
          white-space: normal !important;
          padding: 13px 8px !important;
          font-size: 8px !important;
          letter-spacing: 0 !important;
          overflow-wrap: anywhere !important;
        }

        .ex-sector-cleared {
          position: fixed;
          inset: 0;
          margin: 0;
          z-index: 2;
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow-y: auto;
          padding: 24px;
          text-align: center;
        }
        .ex-sector-cleared-copy { max-width: 640px; margin: auto; }
        .ex-sector-cleared .ex-eyebrow {
          font: 12px/1.8 'Press Start 2P', monospace;
          color: #fcd34d;
          letter-spacing: 3px;
          margin: 0 0 18px;
          text-shadow: 0 2px 0 #000;
        }
        .ex-sector-cleared h2 {
          font: clamp(24px, 3.2vw, 38px)/1.5 'Press Start 2P', monospace;
          color: var(--sector, #38bdf8);
          margin: 0 0 22px;
          text-shadow: 0 4px 0 #000, 0 0 25px #000;
        }
        .ex-sector-cleared-description {
          font: 14px/1.8 'Silkscreen', 'Space Mono', monospace;
          color: #e2e8f0;
          margin: 0 0 34px;
          text-shadow: 0 2px 8px #000;
        }
        .ex-sector-cleared-actions {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 18px;
        }
        .ex-sector-cleared-actions button {
          max-width: 100%;
          white-space: normal !important;
          overflow-wrap: anywhere;
          font-size: 10px !important;
        }
      `}</style>

      {phase === 'returning' ? (
        <section className="ex-landing" style={{ zIndex: 9999 }}>
          <video
            src="/videos/earth/landingearth.mp4"
            autoPlay
            muted
            playsInline
            onEnded={() => setPhase('gameover')}
            onError={() => setPhase('gameover')}
          />
          <div className="ex-landing-copy">
            <p className="ex-eyebrow">FINAL DESCENT TO EARTH</p>
            <h2>All missions accomplished. Welcome home, {explorerName}!</h2>
            <button onClick={() => setPhase('gameover')}>
              [ COMPLETE LANDING &gt;&gt; ]
            </button>
          </div>
        </section>
      ) : phase === 'gameover' ? (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '24px'
        }}>
          <img src="/videos/gif.gif" alt="Space Backdrop" className="ex-space-backdrop" />
          <style>{`
            @keyframes gameOverPulse {
              0%, 100% { text-shadow: 0 5px 0 #000, 0 0 25px #fcd34d, 0 0 55px rgba(252, 211, 77, 0.55); transform: scale(1); }
              50% { text-shadow: 0 5px 0 #000, 0 0 40px #38bdf8, 0 0 75px rgba(56, 189, 248, 0.75); transform: scale(1.03); }
            }
            @keyframes earthSpinFloat {
              0%, 100% { transform: translateY(0px); }
              50% { transform: translateY(-10px); }
            }
          `}</style>

          <div style={{ position: 'relative', zIndex: 10, maxWidth: '760px', width: '100%' }}>
            <svg
              viewBox="0 0 32 32"
              shapeRendering="crispEdges"
              style={{
                width: '145px',
                height: '145px',
                marginBottom: '18px',
                animation: 'earthSpinFloat 3.5s ease-in-out infinite',
                filter: 'drop-shadow(0 0 26px rgba(56, 189, 248, 0.7))'
              }}
            >
              {/* Dış Siyah Piksel Çerçeve */}
              <path d="M11 1h10v1h3v1h2v1h2v2h1v2h1v3h1v10h-1v3h-1v2h-1v2h-2v1h-2v1h-3v1H11v-1H8v-1H6v-1H4v-2H3v-2H2v-3H1V11h1V8h1V6h1V4h2V3h2V2h3V1z" fill="#090d16" />
              
              {/* Okyanus Baz Katmanları (Derin Mavi -> Açık Mavi) */}
              <path d="M11 2h10v1h3v1h2v2h2v2h1v3h1v10h-1v3h-1v2h-2v2h-2v1h-3v1H11v-1H8v-1H6v-2H4v-2H3v-3H2V11h1V8h1V6h2V4h2V3h3V2z" fill="#0369a1" />
              <path d="M11 3h10v1h3v2h2v2h1v3h1v8h-1v3h-2v2h-2v1h-3v1H11v-1H8v-2H6v-2H4v-3H3V11h1V8h2V6h2V4h3V3z" fill="#0284c7" />
              <path d="M22 18h6v3h-1v3h-2v2h-2v1h-3v1h-6v-2h3v-2h3v-3h2v-3z" fill="#1e3a8a" />

              {/* Kuzey Kutup Buzulu ve Üst Bulutlar */}
              <path d="M11 2h10v1h2v1H9V3h2V2z" fill="#f8fafc" />
              <path d="M12 4h8v1h-8V4z" fill="#bae6fd" />

              {/* Kıtalar: Kıyı Şeridi Turkuaz */}
              <path d="M5 9h5v4H8v4h3v5H9v3H7v-4H5v-4H4v-4h1V9z" fill="#38bdf8" />
              <path d="M13 7h11v5h3v5h-3v4h-3v4h-4v-5h-3v-5h-2v-4h1V7z" fill="#38bdf8" />

              {/* Kıtalar: Yeşil Orman Alanları (Amerika, Avrupa, Afrika, Asya) */}
              <path d="M6 7h4v2h1v3H8v2H5v-3H4V9h2V7z" fill="#65a30d" />
              <path d="M7 16h3v2h1v4H9v3H8v-2H6v-4h1v-3z" fill="#16a34a" />
              <path d="M8 17h2v4H8v-4z" fill="#84cc16" />
              <path d="M15 6h8v2h3v4h2v4h-3v3h-2v-3h-4v-3h-4V9h-1V7h1V6z" fill="#65a30d" />
              <path d="M16 7h6v2h3v3h-4v-2h-5V7z" fill="#84cc16" />
              <path d="M15 16h5v4h-1v3h-2v-3h-2v-4z" fill="#16a34a" />

              {/* Kıtalar: Sarı/Turuncu Çöl ve Kara Tonları (Sahra, Arabistan, İç Asya) */}
              <path d="M13 13h6v3h2v2h-2v3h-2v-2h-3v-2h-1v-4z" fill="#fbbf24" />
              <path d="M14 14h4v2h-4v-2z" fill="#fde68a" />
              <path d="M20 13h4v3h-3v-1h-1v-2z" fill="#f59e0b" />
              <path d="M22 10h4v2h-4v-2z" fill="#fbbf24" />
              <path d="M6 9h2v2H6V9z" fill="#fbbf24" />

              {/* Sarmal Beyaz Bulut Katmanları */}
              <path d="M9 11h4v1h-2v2H9v-1h1v-1H9v-1z" fill="#f8fafc" />
              <path d="M19 8h5v1h-3v1h-2V8z" fill="#f8fafc" />
              <path d="M4 15h3v1H5v1H3v-1h1v-1z" fill="#f8fafc" />
              <path d="M22 19h5v1h-2v1h-4v-1h1v-1z" fill="#f8fafc" />
              <path d="M11 23h5v1h-3v1H9v-1h2v-1z" fill="#f8fafc" />
              <path d="M16 25h8v1h-2v1h-5v-1h-1v-1z" fill="#e2e8f0" />
              <path d="M11 28h9v1h-9v-1z" fill="#cbd5e1" />
            </svg>

            <p className="ex-eyebrow" style={{
              fontFamily: "'Press Start 2P', monospace",
              fontSize: '11px',
              color: '#38bdf8',
              letterSpacing: '4px',
              marginBottom: '14px',
              textShadow: '0 2px 0 #000'
            }}>
              ★ TRANSMISSION ENDED // EARTH ORBIT REACHED ★
            </p>

            <h1 style={{
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 'clamp(32px, 5vw, 60px)',
              color: '#fcd34d',
              letterSpacing: '5px',
              margin: '0 0 18px 0',
              animation: 'gameOverPulse 3s ease-in-out infinite'
            }}>
              GAME OVER
            </h1>

            <h2 style={{
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 'clamp(13px, 1.6vw, 18px)',
              color: '#f8fafc',
              letterSpacing: '2px',
              margin: '0 0 20px 0',
              textShadow: '0 3px 0 #000'
            }}>
              THANK YOU FOR PLAYING, COMMANDER {explorerName.toUpperCase()}!
            </h2>

            <p style={{
              fontFamily: "'Silkscreen', 'Space Mono', monospace",
              fontSize: '14px',
              lineHeight: '1.8',
              color: '#cbd5e1',
              maxWidth: '620px',
              margin: '0 auto 34px auto',
              textShadow: '0 2px 6px #000'
            }}>
              Every silent probe, rover, and telescope across the cosmos has been recovered and archived. Their stories now live on back on Earth.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '18px', flexWrap: 'wrap' }}>
              <button
                className="ex-btn-cosmos"
                style={{ padding: '16px 26px', fontSize: '12px' }}
                onClick={() => {
                  Object.keys(expeditions).forEach(id => sessionStorage.removeItem(storageKey(id)));
                  onExit();
                }}
              >
                [ ↺ PLAY AGAIN / RESTART EXPEDITION ]
              </button>
              <button
                className="ex-btn-replay"
                style={{ padding: '16px 24px', fontSize: '11px' }}
                onClick={onExit}
              >
                [ RETURN TO SECTOR MAP ]
              </button>
            </div>
          </div>
        </div>
      ) : phase === 'landing' ? (
        <section className="ex-landing">
          {!videoError && (
            <video
              key={landingVideoSrc}
              src={landingVideoSrc}
              autoPlay
              muted
              playsInline
              onEnded={() => setPhase('story')}
              onError={() => setVideoError(true)}
            />
          )}
          <div className="ex-landing-copy">
            <p className="ex-eyebrow">DESCENT SEQUENCE</p>
            <h2>{videoError ? 'Your expedition is ready.' : 'A new world. Forgotten stories.'}</h2>
            <button onClick={() => setPhase('story')}>
              {videoError ? 'Continue' : 'Skip landing >>'}
            </button>
          </div>
        </section>
      ) : phase === 'story' ? (
        <>
          <img src={storyBgGif} alt="Sector Story Background" className="ex-story-bg-gif" />
          <section className="ex-story-fullscreen">
            <div className="ex-story-floater">
              <h2 className="ex-story-title">The Silence Has A Story</h2>
              <p className="ex-story-desc">{data.story}</p>
              <div className="ex-story-buttons">
                <button className="ex-btn-cosmos" onClick={() => navigate(index)}>
                  {found.length ? '[ RESUME EXPEDITION >> ]' : '[ BEGIN EXPEDITION >> ]'}
                </button>
                {landingVideoSrc && (
                  <button className="ex-btn-replay" onClick={() => { setVideoError(false); setPhase('landing'); }}>
                    ↺ REPLAY LANDING
                  </button>
                )}
              </div>
            </div>
          </section>

          <div className="ex-ticker-bar">
            <div className="ex-ticker-track">
              <span className="ex-ticker-item">{tickerMessage}</span>
              <span className="ex-ticker-item">{tickerMessage}</span>
              <span className="ex-ticker-item">{tickerMessage}</span>
              <span className="ex-ticker-item">{tickerMessage}</span>
            </div>
          </div>
        </>
      ) : phase === 'complete' && allSectorsDone ? (
        /* 3 SEKTÖRÜN TAMAMI BİTTİĞİNDE AÇILAN TAM EKRAN ASTRONOTLU RETRO SERTİFİKA */
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px'
        }}>
          <img src="/videos/gif.gif" alt="Space Backdrop" className="ex-space-backdrop" />

          <div style={{
            position: 'relative',
            zIndex: 10,
            display: 'grid',
            gridTemplateColumns: '300px minmax(0, 680px)',
            gap: '36px',
            alignItems: 'center',
            maxWidth: '1040px',
            width: '100%',
            background: 'rgba(6, 8, 22, 0.92)',
            border: '3px solid #fcd34d',
            borderRadius: '18px',
            padding: '36px 42px',
            boxShadow: '0 0 60px rgba(252, 211, 77, 0.28), inset 0 0 30px rgba(252, 211, 77, 0.08)',
            backdropFilter: 'blur(12px)'
          }}>
            {/* SOL TARAF: SÜZÜLEN RETRO PIXEL ASTRONOT VE KARTI */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: ' radial-gradient(circle, rgba(56,189,248,0.18) 0%, rgba(5,7,18,0.95) 75%)',
              border: '2px dashed rgba(252, 211, 77, 0.5)',
              borderRadius: '14px',
              padding: '28px 18px',
              textAlign: 'center'
            }}>
              <style>{`
                @keyframes astroFloat {
                  0%, 100% { transform: translateY(0px) rotate(-2deg); }
                  50% { transform: translateY(-12px) rotate(2deg); }
                }
              `}</style>
              <img
                src="/videos/astronaut-wave.png"
                alt="Astronaut waving hello"
                style={{
                  width: '165px',
                  height: '165px',
                  objectFit: 'contain',
                  imageRendering: 'pixelated',
                  animation: 'astroFloat 3.6s ease-in-out infinite',
                  filter: 'drop-shadow(0 0 18px rgba(56, 189, 248, 0.65))'
                }}
              />

              <span style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '10px',
                color: '#38bdf8',
                letterSpacing: '2px',
                marginTop: '14px'
              }}>
                COMMANDER
              </span>
              <strong style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '15px',
                color: '#fcd34d',
                marginTop: '8px',
                textShadow: '0 2px 0 #000'
              }}>
                {explorerName}
              </strong>
              <span style={{
                fontFamily: "'Silkscreen', monospace",
                fontSize: '11px',
                color: '#94a3b8',
                marginTop: '8px'
              }}>
                3 / 3 SECTORS CLEARED
              </span>
            </div>

            {/* SAĞ TARAF: RETRO SERTİFİKA */}
            <div style={{
              border: '4px double #fcd34d',
              background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(5, 7, 18, 0.98) 100%)',
              borderRadius: '12px',
              padding: '30px 34px',
              position: 'relative',
              textAlign: 'center',
              boxShadow: 'inset 0 0 24px rgba(252, 211, 77, 0.15)'
            }}>
              <div style={{
                display: 'inline-block',
                padding: '6px 14px',
                background: 'rgba(252, 211, 77, 0.14)',
                border: '1px solid #fcd34d',
                borderRadius: '4px',
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '10px',
                color: '#fcd34d',
                letterSpacing: '2.5px',
                marginBottom: '16px'
              }}>
                ★ OFFICIAL SPACE ARCHIVE DIPLOMA ★
              </div>

              <h2 style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: 'clamp(16px, 2vw, 22px)',
                color: '#f8fafc',
                letterSpacing: '2px',
                margin: '0 0 18px 0',
                textShadow: '0 3px 0 #000, 0 0 15px rgba(252, 211, 77, 0.5)'
              }}>
                KEEPER OF LOST ECHOES
              </h2>

              <p style={{
                fontFamily: "'Silkscreen', 'Space Mono', monospace",
                fontSize: '13px',
                lineHeight: '1.75',
                color: '#e2e8f0',
                margin: '0 0 16px 0'
              }}>
                This honors astronaut <strong style={{ color: '#fcd34d' }}>{explorerName}</strong> for locating every forgotten probe, rover, and telescope across the Moon, Mars, and Deep Space—illuminating the silent history of human exploration.
              </p>

              <div style={{
                display: 'flex',
                justifyContent: 'space-around',
                alignItems: 'center',
                borderTop: '1px dashed rgba(148, 163, 184, 0.35)',
                borderBottom: '1px dashed rgba(148, 163, 184, 0.35)',
                padding: '12px 0',
                margin: '18px 0 24px 0',
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '9px',
                color: '#38bdf8'
              }}>
                <span>✓ MOON ARCHIVED</span>
                <span>✓ MARS ARCHIVED</span>
                <span>✓ DEEP SPACE ARCHIVED</span>
              </div>

              <p style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: '10px',
                color: '#fcd34d',
                margin: '0 0 22px 0',
                letterSpacing: '1.5px'
              }}>
                ALL MISSIONS COMPLETE — TIME TO RETURN HOME
              </p>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '14px' }}>
                <button
                  className="ex-btn-cosmos"
                  onClick={() => {
                    setVideoError(false);
                    setPhase('returning');
                  }}
                  style={{
                    padding: '16px 28px',
                    fontSize: '12px',
                    boxShadow: '0 0 22px rgba(252, 211, 77, 0.4)'
                  }}
                >
                  [ RETURN TO EARTH &gt;&gt; ]
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <img src="/videos/gif.gif" alt="Space Backdrop" className="ex-space-backdrop" />

          {phase === 'briefing' && (
            <div className="ex-center-popup-banner" key={`popup-${index}-${introKey}`}>
              <span>MISSION {index + 1} / {data.scenes.length}</span>
              <h2>{scene.title}</h2>
            </div>
          )}

          {phase === 'complete' && !allSectorsDone ? (
            <section className="ex-sector-cleared" aria-labelledby="sector-cleared-title">
              <div className="ex-sector-cleared-copy">
                <p className="ex-eyebrow">SECTOR CLEARED</p>
                <h2 id="sector-cleared-title">Forgotten no longer.</h2>
                <p className="ex-sector-cleared-description">
                  You recovered all {found.length} stories in this sector! Continue your journey across the remaining sectors to unlock your final Expedition Certificate and return to Earth.
                </p>
                <div className="ex-sector-cleared-actions">
                  <button className="ex-btn-replay" onClick={() => navigate(0)}>&lt;&lt; Revisit missions</button>
                  <button className="ex-btn-cosmos" onClick={onExit}>Choose next sector &gt;&gt;</button>
                </div>
              </div>
            </section>
          ) : (
          <div className="ex-layout">
            <section className="ex-main">
              {phase === 'briefing' && (
                <section className="ex-story" key={`brief-${index}-${introKey}`}>
                  <div className="ex-brief-header-settled">
                    <p className="ex-eyebrow">MISSION {index + 1} / {data.scenes.length}</p>
                    <h2>{scene.title}</h2>
                  </div>

                  <div className="ex-brief-body-fade">
                    <p style={{ margin: '4px 0 8px 0', fontSize: '13px', color: '#cbd5e1', fontFamily: "'Silkscreen', monospace" }}>
                      Recover {scene.targets.length === 1 ? 'this explorer’s story' : 'both explorers’ stories'}. Look for their shapes among the forgotten machines.
                    </p>

                    <div className="ex-brief-targets">
                      {scene.targets.map(t => (
                        <div key={t.id}>
                          <img className={found.includes(t.id) ? '' : 'ex-silhouette'} src={t.image} alt={found.includes(t.id) ? t.name : `Silhouette of ${t.name}`} />
                          <h3>{t.name}</h3>
                          <p>{t.brief}</p>
                        </div>
                      ))}
                    </div>

                    <div className="ex-brief-actions">
                      <button className="ex-btn-replay" onClick={() => index ? navigate(index - 1) : setPhase('story')}>
                        &lt;&lt; BACK
                      </button>
                      <button className="ex-btn-cosmos" onClick={() => setPhase('search')}>
                        [ ENTER SEARCH AREA &gt;&gt; ]
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {phase === 'search' && (
                <>
                  <div className="ex-mission-heading">
                    <div>
                      <p className="ex-eyebrow">MISSION {index + 1} / {data.scenes.length}</p>
                      <h2>{scene.title}</h2>
                    </div>
                    <span className="ex-recovered-badge">
                      {scene.targets.length - remaining.length}/{scene.targets.length} RECOVERED
                    </span>
                  </div>

                  <div className="ex-radar">
                    <button
                      disabled={active || hintUsed || !remaining.length}
                      onClick={() => {
                        if (hintUsed || !remaining.length) return;
                        const time = Date.now();
                        setRadarUsed(ids => [...new Set([...ids, scene.id])]);
                        setNow(time);
                        setPoint(null);
                        setRadarUntil(time + 5000);
                      }}
                    >
                      Radar hint {active ? seconds + 's' : hintUsed ? ' / Used' : ' / 5s / 1 use'}
                    </button>
                    <span role="status">{active ? point ? signal.level : 'Move pointer or touch scene' : 'SCANNER STANDBY'}</span>
                    <meter min="0" max="1" value={active ? signal.strength : 0} aria-label="Radar proximity" />
                    <span className="ex-pulse" style={{ opacity: active ? 1 : .2, animationDuration: `${signal.pulseIntervalMs}ms` }} />
                  </div>

                  <div
                    className="ex-scene"
                    ref={sceneRef}
                    onPointerMove={locate}
                    onPointerDown={locate}
                    onClick={() => { playSound('wrong', .4); setWarning({ text: 'No match. Keep searching the scene.' }); }}
                  >
                    {imageError ? (
                      <div className="ex-story">
                        <p>Scene could not load.</p>
                        <button onClick={e => { e.stopPropagation(); setImageError(false); }}>Retry</button>
                      </div>
                    ) : (
                      <img key={scene.id} src={scene.image} alt={`${scene.title} scene`} onError={() => setImageError(true)} draggable={false} />
                    )}
                    {!imageError && scene.targets.map((t, i) => (
                      <button
                        key={t.id}
                        aria-label={`Inspect object ${i + 1}`}
                        className={`ex-hit ${found.includes(t.id) ? 'recovered' : ''} ${debug ? 'debug' : ''}`}
                        style={geometry ? { left: geometry.left + t.box[0] / 100 * geometry.width, top: geometry.top + t.box[1] / 100 * geometry.height, width: t.box[2] / 100 * geometry.width, height: t.box[3] / 100 * geometry.height } : { visibility: 'hidden' }}
                        onFocus={() => setPoint({ x: t.box[0] + t.box[2] / 2, y: t.box[1] + t.box[3] / 2 })}
                        onClick={e => { e.stopPropagation(); discover(t); }}
                      >
                        {debug ? t.name : ''}
                      </button>
                    ))}
                  </div>

                  <p className="ex-feedback" role="status">
                    {warning?.text || (remaining.length ? 'Search the scene. Every machine has a story.' : 'All targets recovered!')}
                  </p>

                  <nav className="ex-nav">
                    <button className="ex-btn-replay" onClick={() => navigate(index)}>&lt;&lt; BRIEFING</button>
                    {index > 0 && <button className="ex-btn-replay" onClick={() => navigate(index - 1, 'search')}>&lt;&lt; PREVIOUS</button>}
                    <button
                      className="ex-btn-cosmos"
                      disabled={remaining.length > 0}
                      onClick={() => index + 1 < data.scenes.length ? navigate(index + 1) : navigate(index, 'complete')}
                    >
                      {index + 1 === data.scenes.length ? 'COMPLETE EXPEDITION >>' : '[ NEXT MISSION >> ]'}
                    </button>
                  </nav>
                </>
              )}

            </section>

            <aside className="ex-collection">
              <div className="ex-archive-top-bar">
                <p className="ex-eyebrow" style={{ margin: 0 }}>YOUR FIELD ARCHIVE</p>
                <button onClick={onExit}>&lt;&lt; SECTORS</button>
              </div>
              <h2 style={{ fontFamily: "'Press Start 2P', monospace", fontSize: '15px', margin: '6px 0 8px 0' }}>
                Recovered stories
              </h2>
              <p style={{ fontFamily: "'Silkscreen', monospace", fontSize: '13px', margin: '0 0 14px 0', color: '#cbd5e1' }}>
                {found.length} / {all.length} cards collected
              </p>
              <div className="ex-card-grid">
                {all.map((t, i) => (
                  <button
                    className={`ex-mini ${found.includes(t.id) ? 'unlocked' : ''}`}
                    key={t.id}
                    disabled={!found.includes(t.id)}
                    onClick={() => openCard(t)}
                    aria-label={`${t.name}: ${found.includes(t.id) ? 'open collected card' : 'locked'}`}
                  >
                    <span>#{String(i + 1).padStart(2, '0')}</span>
                    <img className={found.includes(t.id) ? '' : 'ex-silhouette'} src={t.image} alt="" />
                    <strong>{found.includes(t.id) ? t.name : 'UNKNOWN'}</strong>
                    <small>{found.includes(t.id) ? 'VIEW CARD ↗' : 'AWAITING DISCOVERY'}</small>
                  </button>
                ))}
              </div>
            </aside>
          </div>
          )}
        </>
      )}

      {card && <ArchiveCard key={card.id} target={card} onClose={() => setCard(null)} />}
    </main>
  );
}