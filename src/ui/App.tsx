import { useRef, useState } from 'react';
import { sampleBuilding } from '../core/geometry/primitives';
import { useStore, type ClipAxis } from '../state/store';
import { ACCEPTED_EXTENSIONS, loadFile } from './importFile';
import { LayerPanel } from './LayerPanel';
import { PreparePanel } from './PreparePanel';
import { Viewer } from './Viewer';

const CLIP_AXES: { id: ClipAxis; label: string }[] = [
  { id: 'none', label: 'Sin corte' },
  { id: 'z', label: 'Corte horizontal' },
  { id: 'x', label: 'Corte X' },
  { id: 'y', label: 'Corte Y' },
];

export function App() {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const open = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    try {
      const { result, yUp } = await loadFile(file);
      s.loadImport(file.name, result, yUp);
    } catch (error) {
      s.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      if (input.current) input.current.value = '';
    }
  };

  const loadSample = () =>
    s.loadImport('edificio-ejemplo.obj', {
      objects: sampleBuilding().map((p) => ({ name: p.name, layer: p.layer, mesh: p.mesh })),
      warnings: [],
    });

  const hasModel = s.parts.length > 0;

  return (
    <div
      className={`app${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void open(e.dataTransfer.files[0]);
      }}
    >
      <header>
        <h1>
          Logos <span>· maquetas para impresión 3D</span>
        </h1>
        <div className="row">
          {s.fileName && <span className="file">{s.fileName}</span>}
          <button onClick={() => input.current?.click()} disabled={loading}>
            {loading ? 'Cargando…' : 'Abrir modelo'}
          </button>
          <button onClick={loadSample}>Cargar ejemplo</button>
          <input
            ref={input}
            type="file"
            hidden
            accept={ACCEPTED_EXTENSIONS}
            data-testid="file-input"
            onChange={(e) => void open(e.target.files?.[0])}
          />
        </div>
      </header>

      {s.error && (
        <div className="banner error" role="alert">
          {s.error}
          <button className="link" onClick={() => s.setError(null)}>
            cerrar
          </button>
        </div>
      )}
      {s.warnings.map((w) => (
        <div key={w} className="banner">
          {w}
        </div>
      ))}

      <main>
        <aside>{hasModel && <LayerPanel />}</aside>
        <div className="stage">
          <Viewer />
          {!hasModel && (
            <div className="empty">
              <h2>Abre un modelo 3D de un edificio</h2>
              <p>
                Arrastra aquí un fichero <strong>OBJ, DXF, STL, glTF/GLB o FBX</strong>, o pulsa
                «Abrir modelo».
              </p>
              <p className="hint">
                <strong>¿Vienes de MicroStation?</strong> El formato DGN es propietario y no se
                puede leer directamente. Usa <em>Archivo › Exportar</em> y elige OBJ o DXF
                (conservan los niveles como capas). Todo se procesa en tu navegador: el modelo no
                sale de tu ordenador.
              </p>
              <button className="primary" onClick={loadSample}>
                Probar con un edificio de ejemplo
              </button>
            </div>
          )}
          {hasModel && (
            <div className="toolbar">
              <div className="modes">
                <button
                  className={s.view === 'modelo' ? 'active' : ''}
                  onClick={() => s.setView('modelo')}
                >
                  Modelo original
                </button>
                <button
                  className={s.view === 'resultado' ? 'active' : ''}
                  disabled={!s.result}
                  onClick={() => s.setView('resultado')}
                >
                  Resultado imprimible
                </button>
              </div>
              <select
                aria-label="Plano de corte"
                value={s.clipAxis}
                onChange={(e) => s.setClip(e.target.value as ClipAxis)}
              >
                {CLIP_AXES.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              {s.clipAxis !== 'none' && (
                <input
                  type="range"
                  aria-label="Posición del corte"
                  min={0}
                  max={1}
                  step={0.005}
                  value={s.clipPosition}
                  onChange={(e) => s.setClip(s.clipAxis, Number(e.target.value))}
                />
              )}
            </div>
          )}
        </div>
        <aside>{hasModel && <PreparePanel />}</aside>
      </main>
    </div>
  );
}
