import { useRef, useState } from 'react';
import { ibg, PATHS } from '../lib/icons.js';

// Real photo slot: click OR drag-and-drop an image (ports the handoff <image-slot>).
export default function AvatarSlot({ size = 100, placeholderGrad }) {
  const [url, setUrl] = useState(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);

  const take = (file) => { if (file && file.type.startsWith('image/')) setUrl(URL.createObjectURL(file)); };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
      style={{
        width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
        background: url ? undefined : (placeholderGrad || 'linear-gradient(150deg, oklch(0.72 0.15 285), oklch(0.78 0.13 20))'),
        outline: over ? '2px dashed rgba(255,255,255,.9)' : 'none', outlineOffset: '-4px',
      }}
      title="Клікни або перетягни фото"
    >
      {url
        ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ ...ibg(PATHS.cam, { stroke: 'rgba(255,255,255,.9)', sw: 1.6, size: 26 }), opacity: 0.9 }} />}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files?.[0])} />
    </div>
  );
}
