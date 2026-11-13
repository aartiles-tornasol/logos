import { bboxSize } from '../core/geometry/mesh';
import { modelBBox, visibleParts } from '../core/model';
import type { LengthUnit } from '../core/types';
import { printScaleFactor } from '../core/units';
import type { PrepareMode } from '../core/voxel/pipeline';
import { useStore } from '../state/store';

const MODES: { id: PrepareMode; label: string; help: string }[] = [
  {
    id: 'macizo',
    label: 'Macizo',
    help: 'El edificio se convierte en un volumen cerrado. Lo más robusto; el relleno lo decide el laminador.',
  },
  {
    id: 'cascara',
    label: 'Cáscara hueca',
    help: 'Solo la envolvente exterior con el grosor mínimo, abierta por la base. Ahorra material.',
  },
  {
    id: 'interiores',
    label: 'Con interiores',
    help: 'Conserva las estancias cerradas, con forjados y tabiques engrosados. Pensado para trocear por plantas.',
  },
];

const UNITS: { id: LengthUnit; label: string }[] = [
  { id: 'm', label: 'metros' },
  { id: 'cm', label: 'centímetros' },
  { id: 'mm', label: 'milímetros' },
  { id: 'ft', label: 'pies' },
  { id: 'in', label: 'pulgadas' },
];

const fmt = (v: number, digits = 1) => v.toLocaleString('es-ES', { maximumFractionDigits: digits });

function NumberField(props: {
  label: string;
  value: number;
  min: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field inline">
      <span>{props.label}</span>
      <input
        type="number"
        aria-label={props.label}
        value={props.value}
        min={props.min}
        step={props.step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= props.min) props.onChange(v);
        }}
      />
      {props.suffix && <em>{props.suffix}</em>}
    </label>
  );
}

export function PreparePanel() {
  const s = useStore();
  const shown = visibleParts(s.parts, s.layers);
  const factor = printScaleFactor(s.unit, s.scale);
  const size = shown.length ? bboxSize(modelBBox(shown)).map((v) => v * factor) : [0, 0, 0];
  const realSize = s.parts.length
    ? bboxSize(modelBBox(s.parts)).map((v) => (v * factor * s.scale) / 1000)
    : [0, 0, 0];
  const dims = (s.result?.size ?? size).slice().sort((a, b) => b - a);
  const bed = [s.printer.x, s.printer.y].sort((a, b) => b - a);
  const footprint = (s.result?.size ?? size).slice(0, 2).sort((a, b) => b - a);
  const height = (s.result?.size ?? size)[2];
  const fits = footprint[0] <= bed[0] && footprint[1] <= bed[1] && height <= s.printer.z;
  const mode = MODES.find((m) => m.id === s.options.mode)!;

  return (
    <section className="panel">
      <h2>Escala</h2>
      <label className="field inline">
        <span>Unidades del modelo</span>
        <select
          aria-label="Unidades del modelo"
          value={s.unit}
          onChange={(e) => s.setUnit(e.target.value as LengthUnit)}
        >
          {UNITS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
      <NumberField label="Escala 1:" value={s.scale} min={1} step={10} onChange={s.setScale} />
      <p className="hint" data-testid="model-size">
        Edificio real: {fmt(realSize[0])} × {fmt(realSize[1])} × {fmt(realSize[2])} m · Maqueta:{' '}
        <strong>
          {fmt(size[0])} × {fmt(size[1])} × {fmt(size[2])} mm
        </strong>
      </p>
      <button className="link" onClick={s.rotateUp} title="Para ficheros con el eje Y hacia arriba">
        El modelo aparece tumbado: girar 90°
      </button>

      <h2>Preparar para imprimir</h2>
      <div className="modes" role="radiogroup" aria-label="Tratamiento del interior">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={s.options.mode === m.id}
            className={s.options.mode === m.id ? 'active' : ''}
            onClick={() => s.setOptions({ mode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="hint">{mode.help}</p>
      <NumberField
        label="Grosor mínimo de pared"
        value={s.options.minWall}
        min={0.2}
        step={0.1}
        suffix="mm"
        onChange={(minWall) => s.setOptions({ minWall })}
      />
      <p className="hint">
        Equivale a {fmt((s.options.minWall * s.scale) / 10, 0)} cm reales. Todo lo más fino se
        engrosa.
      </p>
      <NumberField
        label="Resolución (vóxel)"
        value={s.options.voxelSize}
        min={0.1}
        step={0.05}
        suffix="mm"
        onChange={(voxelSize) => s.setOptions({ voxelSize })}
      />
      <NumberField
        label="Cerrar huecos de hasta"
        value={s.options.closeGaps}
        min={0}
        step={0.5}
        suffix="mm"
        onChange={(closeGaps) => s.setOptions({ closeGaps })}
      />
      <p className="hint">
        Tapa ventanas sin vidrio y rendijas para que el interior no quede abierto.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={s.options.sealBottom}
          onChange={(e) => s.setOptions({ sealBottom: e.target.checked })}
        />
        Base plana apoyada en la cama
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={s.simplify}
          onChange={(e) => s.setSimplify(e.target.checked)}
        />
        Reducir triángulos (fichero más ligero)
      </label>

      <h3>Impresora</h3>
      <div className="row bed">
        <NumberField
          label="X"
          value={s.printer.x}
          min={10}
          step={10}
          onChange={(x) => s.setPrinter({ x })}
        />
        <NumberField
          label="Y"
          value={s.printer.y}
          min={10}
          step={10}
          onChange={(y) => s.setPrinter({ y })}
        />
        <NumberField
          label="Z"
          value={s.printer.z}
          min={10}
          step={10}
          onChange={(z) => s.setPrinter({ z })}
        />
      </div>
      {s.parts.length > 0 && !fits && (
        <p className="warn" data-testid="bed-warning">
          La maqueta ({fmt(dims[0])} mm) no cabe en la impresora. Reduce la escala; el troceado en
          piezas ensamblables llegará en la fase 2.
        </p>
      )}

      <button className="primary" disabled={!shown.length || !!s.busy} onClick={s.prepare}>
        {s.busy ? `${s.busy.stage}… ${Math.round(s.busy.fraction * 100)} %` : 'Preparar modelo'}
      </button>
      {s.busy && <progress value={s.busy.fraction} max={1} />}

      {s.result && (
        <div className="result" data-testid="result">
          <h3>Resultado</h3>
          <p className={s.result.report.watertight ? 'ok' : 'warn'} data-testid="watertight">
            {s.result.report.watertight
              ? '✔ Malla cerrada, lista para el laminador'
              : `✖ Malla con defectos (${s.result.report.boundaryEdges} bordes abiertos)`}
          </p>
          <dl>
            <dt>Tamaño</dt>
            <dd>
              {fmt(s.result.size[0])} × {fmt(s.result.size[1])} × {fmt(s.result.size[2])} mm
            </dd>
            <dt>Volumen</dt>
            <dd>{fmt(s.result.volume / 1000)} cm³</dd>
            <dt>Triángulos</dt>
            <dd>{(s.result.mesh.indices.length / 3).toLocaleString('es-ES')}</dd>
            <dt>Vóxel usado</dt>
            <dd>{fmt(s.result.voxelSize, 2)} mm</dd>
          </dl>
          {s.result.warnings.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
          ))}
          <button className="primary" onClick={s.downloadStl}>
            Descargar STL
          </button>
        </div>
      )}
    </section>
  );
}
