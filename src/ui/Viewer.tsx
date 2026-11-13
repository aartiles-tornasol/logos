import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { SceneView } from './sceneView';

export function Viewer() {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  const parts = useStore((s) => s.parts);
  const layers = useStore((s) => s.layers);
  const selection = useStore((s) => s.selection);
  const result = useStore((s) => s.result);
  const mode = useStore((s) => s.view);
  const clipAxis = useStore((s) => s.clipAxis);
  const clipPosition = useStore((s) => s.clipPosition);

  useEffect(() => {
    const scene = new SceneView(container.current!, {
      onPick: (id, additive) => {
        const { select } = useStore.getState();
        if (id) select([id], additive);
        else if (!additive) select([]);
      },
    });
    view.current = scene;
    return () => {
      scene.dispose();
      view.current = null;
    };
  }, []);

  useEffect(() => view.current?.setParts(parts), [parts]);
  useEffect(
    () => view.current?.setAppearance(parts, layers, selection),
    [parts, layers, selection],
  );
  useEffect(() => view.current?.setResult(result?.mesh ?? null), [result]);
  useEffect(() => view.current?.setView(mode), [mode, result]);
  useEffect(
    () => view.current?.setClip(clipAxis, clipPosition),
    [clipAxis, clipPosition, mode, result, parts, layers],
  );

  return <div className="viewer" ref={container} data-testid="viewer" />;
}
