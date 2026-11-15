import { playSound } from '../../audio/audio';
import { useEffect, useRef, useState } from 'react';
import { expeditions } from '../../../data/expeditions';
import ArchiveCard from './ArchiveCard';
import './MyCollection.css';

const labels = { moon: 'The Moon', mars: 'Mars', deepSpace: 'Deep Space' };
export default function MyCollection({ onClose }) {
  const dialog = useRef(null);
  const [card, setCard] = useState(null);
  const [groups] = useState(() => Object.entries(expeditions).map(([id, data]) => {
    let found = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(`elvira-expedition-v1-${id}`));
      if (Array.isArray(saved?.found)) found = saved.found;
    } catch { /* An unavailable save has no collected cards. */ }
    return { id, targets: data.scenes.flatMap(scene => scene.targets).filter(target => found.includes(target.id)) };
  }));
  useEffect(() => {
    const panel = dialog.current;
    panel.showModal();
    return () => panel.close();
  }, []);
  const total = groups.reduce((sum, group) => sum + group.targets.length, 0);
  return <>
    <dialog ref={dialog} className="elvira-collection" aria-labelledby="collection-title" onCancel={e => { e.preventDefault(); onClose(); }}>
      <header><div><h2 id="collection-title">My collection</h2><p>{total} cards collected</p></div><button onClick={onClose} aria-label="Close collection">&times;</button></header>
      <div className={`elvira-collection-body${total ? "" : " is-empty"}`}>
      {!total && <p className="elvira-empty">Your collection is empty. Discover objects in the levels to unlock their cards.</p>}
      {groups.filter(group => group.targets.length).map(group => <section key={group.id}>
        <h3>{labels[group.id]}</h3>
        <div className="elvira-collection-grid">{group.targets.map(target => <button key={target.id} className="elvira-collection-card" onClick={() => { playSound('open'); setCard(target); }}>
          <img src={target.image} alt="" /><strong>{target.name}</strong><span>VIEW CARD &#8599;</span>
        </button>)}</div>
      </section>)}
      </div>
      <footer className="elvira-collection-footer"><button onClick={onClose}>Back to game</button></footer>
    </dialog>
    {card && <ArchiveCard key={card.id} target={card} onClose={() => setCard(null)} />}
  </>;
}
