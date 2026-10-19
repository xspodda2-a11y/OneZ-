import { useEffect, useRef, useState } from 'react';
import { useGame } from '../state/store';
import { game } from '../game/Game';
import { WORLD, heightAt } from '../game/core/TerrainHeight';

const N = 256; // resolution of the chart
const HALF = WORLD.half;

let cached: ImageData | null = null;

function buildChart(): ImageData {
  if (cached) return cached;
  const img = new ImageData(N, N);
  const d = img.data;
  for (let j = 0; j < N; j++) {
    const wz = -HALF + (j / (N - 1)) * HALF * 2;
    for (let i = 0; i < N; i++) {
      const wx = -HALF + (i / (N - 1)) * HALF * 2;
      const h = heightAt(wx, wz);
      const k = (j * N + i) * 4;
      if (h < WORLD.waterLevel) {
        const depth = Math.min(1, (WORLD.waterLevel - h) / 12);
        d[k] = 26 + (1 - depth) * 26;
        d[k + 1] = 52 + (1 - depth) * 34;
        d[k + 2] = 74 + (1 - depth) * 40;
      } else {
        const t = Math.min(1, (h - WORLD.waterLevel) / 150);
        const snow = Math.max(0, (h - 150) / 70);
        let r = 58 + t * 96, g = 56 + t * 84, b = 42 + t * 58;
        // slope shading (cheap)
        const hx = heightAt(wx + 6, wz) - heightAt(wx - 6, wz);
        const hz = heightAt(wx, wz + 6) - heightAt(wx, wz - 6);
        const sh = 1 + (hx + hz) * 0.018;
        r = Math.min(255, r * sh); g = Math.min(255, g * sh); b = Math.min(255, b * sh);
        r = r * (1 - snow) + 226 * snow;
        g = g * (1 - snow) + 232 * snow;
        b = b * (1 - snow) + 238 * snow;
        d[k] = r; d[k + 1] = g; d[k + 2] = b;
      }
      d[k + 3] = 255;
    }
  }
  cached = img;
  return img;
}

export function WorldMap({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<string | null>(null);
  const mm = useGame((s) => s.minimap);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = N; c.height = N;
    const g = c.getContext('2d');
    if (!g) return;
    g.putImageData(buildChart(), 0, 0);
    setReady(true);
  }, []);

  const toPx = (x: number, z: number) => ({ x: ((x + HALF) / (HALF * 2)) * N, y: ((z + HALF) / (HALF * 2)) * N });

  return (
    <div className="modal" onClick={onClose}>
      <div className="panel modal-panel" onClick={(e) => e.stopPropagation()} style={{ position: 'relative', overflow: 'hidden' }}>
        <div className="panel-title">
          <span>天下舆图 · REALM CHART</span>
          <small>click the map or press M / ESC to close</small>
        </div>
        <div className="panel-body" style={{ position: 'relative', padding: 0, height: '100%' }}>
          <canvas
            ref={ref}
            className="map-canvas"
            style={{ transform: `scale(${zoom})`, transformOrigin: `${toPx(mm.x, mm.z).x}px ${toPx(mm.x, mm.z).y}px`, imageRendering: 'auto' }}
            onWheel={(e) => setZoom((z) => Math.max(1, Math.min(6, z + (e.deltaY > 0 ? -0.4 : 0.4))))}
          />
          <svg
            viewBox={`0 0 ${N} ${N}`}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            {/* undiscovered veil */}
            {!ready && null}
            {game.world?.pois?.map((p) => {
              const q = toPx(p.pos.x, p.pos.z);
              const known = p.discovered;
              return (
                <g key={p.id} opacity={known ? 1 : 0.35}>
                  <circle cx={q.x} cy={q.y} r={4.2} fill="none" stroke="#d8b271" strokeWidth={1} />
                  <circle cx={q.x} cy={q.y} r={1.8} fill="#e0553f" />
                  {known && (
                    <text x={q.x + 7} y={q.y + 3} fontSize={6} fill="#f0e2c2" fontFamily="serif">{p.name}</text>
                  )}
                </g>
              );
            })}
            {mm.quests.map((q0, i) => {
              const q = toPx(q0.x, q0.z);
              return (
                <g key={i}>
                  <path d={`M ${q.x} ${q.y - 6} L ${q.x + 5} ${q.y + 4} L ${q.x - 5} ${q.y + 4} Z`} fill="#d0a4ee" stroke="#2a1a3a" strokeWidth={0.6} />
                </g>
              );
            })}
            {/* player */}
            <g transform={`translate(${toPx(mm.x, mm.z).x} ${toPx(mm.x, mm.z).y}) rotate(${(mm.yaw * 180) / Math.PI})`}>
              <circle r={7} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={0.8} />
              <path d="M 0 -7 L 4.6 6 L 0 3 L -4.6 6 Z" fill="#ffffff" />
              <path d={`M -${60 / zoom} 0 L ${60 / zoom} 0`} stroke="rgba(255,255,255,0.18)" strokeWidth={0.6} />
            </g>
          </svg>
          <div className="map-legend">
            <div><i style={{ background: '#e0553f' }} />settlement · temple · camp</div>
            <div><i style={{ background: '#d0a4ee' }} />current objective</div>
            <div><i style={{ background: '#ffffff' }} />you</div>
            <div style={{ marginTop: 6, opacity: 0.7 }}>
              {mm.x.toFixed(0)}, {mm.z.toFixed(0)} · scroll to zoom ({zoom.toFixed(1)}×)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
