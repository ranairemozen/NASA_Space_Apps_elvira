import { useLayoutEffect, useState } from 'react';

// Match the scene image's centered object-fit: cover, including cropped edges.
export function coverGeometry(width, height, naturalWidth, naturalHeight) {
  const scale = Math.max(width / naturalWidth, height / naturalHeight);
  const imageWidth = naturalWidth * scale;
  const imageHeight = naturalHeight * scale;
  return { width: imageWidth, height: imageHeight,
    left: (width - imageWidth) / 2, top: (height - imageHeight) / 2,
    aspect: naturalWidth / naturalHeight };
}

export default function useSceneGeometry(ref, sceneId, phase, imageError) {
  const [geometry, setGeometry] = useState(null);
  useLayoutEffect(() => {
    const container = ref.current;
    const image = container?.querySelector('img');
    if (!image) return;
    const update = () => {
      if (!image.naturalWidth || !container.clientWidth || !container.clientHeight) return;
      setGeometry(coverGeometry(container.clientWidth, container.clientHeight, image.naturalWidth, image.naturalHeight));
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    image.addEventListener('load', update);
    update();
    return () => { observer.disconnect(); image.removeEventListener('load', update); };
  }, [ref, sceneId, phase, imageError]);
  return geometry;
}
