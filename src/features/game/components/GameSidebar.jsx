import { useAudioSettings, updateAudioSettings } from '../../audio/audio';
import { useEffect, useRef, useState } from 'react';
import MyCollection from './MyCollection';
import './GameSidebar.css';

export default function GameSidebar({ onRestart }) {
  const audioSettings = useAudioSettings();
  const [open, setOpen] = useState(false);
  const [collection, setCollection] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const panel = dialog.current;
    const opener = trigger.current;
    panel.showModal();
    return () => { panel.close(); opener?.focus(); };
  }, [open]);
  function restart() {
    try {
      for (const storage of [sessionStorage, localStorage]) {
        for (const id of ['moon', 'mars', 'deepSpace']) storage.removeItem(`elvira-expedition-v1-${id}`);
        storage.removeItem('elvira-player-name');
      }
    } catch {
      setError('Progress could not be cleared. Please allow browser storage and try again.');
      return;
    }
    onRestart();
  }
  return <>
    <button ref={trigger} className="elvira-menu-trigger" aria-label="Open game menu" aria-expanded={open} onClick={() => setOpen(true)}>&#9776;</button>
    {open && <dialog ref={dialog} className="elvira-sidebar" aria-labelledby="game-menu-title" onCancel={e => { e.preventDefault(); setOpen(false); }} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="elvira-sidebar-content">
        <header><h2 id="game-menu-title">EXPLORER MENU</h2><button aria-label="Close menu" onClick={() => setOpen(false)}>&times;</button></header>
        <nav aria-label="Game menu">
          <button onClick={() => { setOpen(false); setCollection(true); }}>My collection</button>
          <button onClick={restart}>Restart the game</button>
        </nav>
        <section className="elvira-audio-settings" aria-labelledby="audio-settings-title">
          <h3 id="audio-settings-title">AUDIO SETTINGS</h3>
          {[['music', 'Music'], ['effects', 'Sound effects']].map(([channel, label]) => (
            <div className="elvira-audio-channel" key={channel}>
              <label htmlFor={`audio-${channel}`}>{label}<span>{Math.round(audioSettings[`${channel}Volume`] * 100)}%</span></label>
              <input id={`audio-${channel}`} type="range" min="0" max="100" step="1" value={Math.round(audioSettings[`${channel}Volume`] * 100)}
                onChange={event => updateAudioSettings({ [`${channel}Volume`]: Number(event.target.value) / 100 })} />
              <label className="elvira-audio-mute"><input type="checkbox" checked={audioSettings[`${channel}Muted`]}
                onChange={event => updateAudioSettings({ [`${channel}Muted`]: event.target.checked })} />Mute {label.toLowerCase()}</label>
            </div>
          ))}
        </section>
        {error && <p role="alert">{error}</p>}
      </div>
    </dialog>}
    {collection && <MyCollection onClose={() => { setCollection(false); trigger.current?.focus(); }} />}
  </>;
}
