import { useState } from 'react';
import { GROUPING_LABEL, type GroupingStrategy } from '../core/layers/grouping';
import { EXCLUDED_LAYER_ID } from '../core/model';
import { useStore } from '../state/store';

export function LayerPanel() {
  const parts = useStore((s) => s.parts);
  const layers = useStore((s) => s.layers);
  const grouping = useStore((s) => s.grouping);
  const selection = useStore((s) => s.selection);
  const actions = useStore.getState();
  const [target, setTarget] = useState('');

  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p.layerId, (counts.get(p.layerId) ?? 0) + 1);

  return (
    <section className="panel">
      <h2>Capas</h2>
      <label className="field">
        <span>Agrupar piezas por</span>
        <select
          aria-label="Agrupar piezas por"
          value={grouping}
          onChange={(e) => actions.setGrouping(e.target.value as GroupingStrategy)}
        >
          {(Object.keys(GROUPING_LABEL) as GroupingStrategy[]).map((g) => (
            <option key={g} value={g}>
              {GROUPING_LABEL[g]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Si el fichero no trae capas útiles, prueba «Exterior / interior» o «Tipo sugerido»: la
        aplicación analiza la geometría y propone la agrupación.
      </p>
      <div className="row">
        <button onClick={() => actions.setAllVisible(true)}>Mostrar todas</button>
        <button onClick={() => actions.setAllVisible(false)}>Ocultar todas</button>
      </div>
      <ul className="layers" data-testid="layers">
        {layers.map((layer) => (
          <li key={layer.id} className={layer.visible ? '' : 'off'}>
            <input
              type="checkbox"
              checked={layer.visible}
              aria-label={`Mostrar ${layer.name}`}
              onChange={() => actions.toggleLayer(layer.id)}
            />
            <span className="swatch" style={{ background: layer.color }} />
            <button
              className="link name"
              title="Seleccionar todas las piezas de la capa"
              onClick={() => actions.selectLayer(layer.id)}
            >
              {layer.name}
            </button>
            <span className="count">{counts.get(layer.id) ?? 0}</span>
            {layer.id !== EXCLUDED_LAYER_ID && (
              <button
                className="link"
                title="Ver solo esta capa"
                onClick={() => actions.soloLayer(layer.id)}
              >
                solo
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3>Selección</h3>
      {selection.length === 0 ? (
        <p className="hint">
          Haz clic en una pieza del visor para seleccionarla (Mayús + clic para añadir). Usa el
          corte para ver el interior.
        </p>
      ) : (
        <div className="selection">
          <p data-testid="selection-count">
            {selection.length}{' '}
            {selection.length === 1 ? 'pieza seleccionada' : 'piezas seleccionadas'}
          </p>
          <div className="row">
            <button onClick={actions.selectSimilar}>Seleccionar similares</button>
            <button onClick={() => actions.select([])}>Deseleccionar</button>
          </div>
          <button className="danger" onClick={actions.excludeSelection}>
            Excluir de la impresión
          </button>
          <div className="row">
            <input
              list="layer-names"
              placeholder="Mover a capa…"
              aria-label="Mover a capa"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
            <datalist id="layer-names">
              {layers
                .filter((l) => l.id !== EXCLUDED_LAYER_ID)
                .map((l) => (
                  <option key={l.id} value={l.name} />
                ))}
            </datalist>
            <button
              disabled={!target.trim()}
              onClick={() => {
                actions.moveSelectionTo(target);
                setTarget('');
              }}
            >
              Mover
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
