// Visual compass for target bearing.
// Drag the needle (or click anywhere on the dial) to set the bearing 0–360.
// Numbers always read from map-true north (0°=N, 90°=E, 180°=S, 270°=W).

import { useCallback, useEffect, useRef, useState } from "react";

const SIZE = 132;
const RADIUS = 56;
const CENTER = SIZE / 2;
const CARDINALS = [
  { label: "N", deg: 0,   color: "#ef4444" },
  { label: "E", deg: 90,  color: "#e2e8f0" },
  { label: "S", deg: 180, color: "#e2e8f0" },
  { label: "W", deg: 270, color: "#e2e8f0" },
];
const TICK_COUNT = 36; // every 10°

function cardinalQuadrant(deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d >= 337.5 || d < 22.5)  return "N";
  if (d < 67.5)  return "NE";
  if (d < 112.5) return "E";
  if (d < 157.5) return "SE";
  if (d < 202.5) return "S";
  if (d < 247.5) return "SW";
  if (d < 292.5) return "W";
  return "NW";
}

export default function CompassInput({ value = 0, onChange, disabled = false }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const bearing = ((Number(value) || 0) % 360 + 360) % 360;

  // Convert pointer (clientX, clientY) into a bearing using the SVG centre.
  const pointToBearing = useCallback((evt) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = evt.clientX - cx;
    const dy = evt.clientY - cy;
    // atan2 returns (-π, π) measured from +x axis. We want 0 at north (negative y),
    // increasing clockwise.
    const radians = Math.atan2(dx, -dy);
    let deg = (radians * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return Math.round(deg);
  }, []);

  const onPointerDown = (evt) => {
    if (disabled) return;
    evt.preventDefault();
    const next = pointToBearing(evt);
    if (next != null && onChange) onChange(next);
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (evt) => {
      const next = pointToBearing(evt);
      if (next != null && onChange) onChange(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, pointToBearing, onChange]);

  const onWheel = (evt) => {
    if (disabled) return;
    evt.preventDefault();
    const delta = evt.deltaY > 0 ? 1 : -1;
    onChange?.((bearing + delta + 360) % 360);
  };

  const onKeyDown = (evt) => {
    if (disabled) return;
    if (evt.key === "ArrowLeft" || evt.key === "ArrowDown")  { evt.preventDefault(); onChange?.((bearing - 1 + 360) % 360); }
    if (evt.key === "ArrowRight" || evt.key === "ArrowUp")   { evt.preventDefault(); onChange?.((bearing + 1) % 360); }
    if (evt.key === "PageUp")   { evt.preventDefault(); onChange?.((bearing - 5 + 360) % 360); }
    if (evt.key === "PageDown") { evt.preventDefault(); onChange?.((bearing + 5) % 360); }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, userSelect: "none" }}>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={bearing}
        aria-label="Target bearing compass"
        style={{
          cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
          touchAction: "none",
          opacity: disabled ? 0.5 : 1,
          filter: dragging ? "drop-shadow(0 0 12px rgba(56,189,248,0.45))" : "none",
        }}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        {/* Outer rim */}
        <circle cx={CENTER} cy={CENTER} r={RADIUS + 6}
          fill="rgba(15, 23, 42, 0.92)"
          stroke="rgba(148, 163, 184, 0.45)" strokeWidth={1.2} />
        <circle cx={CENTER} cy={CENTER} r={RADIUS + 1}
          fill="none"
          stroke="rgba(56, 189, 248, 0.25)" strokeWidth={0.8} />

        {/* Tick marks every 10° (every 30° major) */}
        {Array.from({ length: TICK_COUNT }).map((_, idx) => {
          const deg = idx * (360 / TICK_COUNT);
          const major = idx % 3 === 0;
          const inner = RADIUS - (major ? 9 : 5);
          const outer = RADIUS - 1;
          const rad = ((deg - 90) * Math.PI) / 180;
          const x1 = CENTER + Math.cos(rad) * inner;
          const y1 = CENTER + Math.sin(rad) * inner;
          const x2 = CENTER + Math.cos(rad) * outer;
          const y2 = CENTER + Math.sin(rad) * outer;
          return (
            <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={major ? "rgba(226, 232, 240, 0.75)" : "rgba(148, 163, 184, 0.45)"}
              strokeWidth={major ? 1.4 : 0.8} />
          );
        })}

        {/* Cardinal letters */}
        {CARDINALS.map(({ label, deg, color }) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const lx = CENTER + Math.cos(rad) * (RADIUS - 18);
          const ly = CENTER + Math.sin(rad) * (RADIUS - 18);
          return (
            <text key={label} x={lx} y={ly + 4}
              textAnchor="middle"
              fontFamily="JetBrains Mono, monospace"
              fontSize={11}
              fontWeight={700}
              fill={color}
            >{label}</text>
          );
        })}

        {/* Pivot */}
        <circle cx={CENTER} cy={CENTER} r={4} fill="#0ea5e9"
          stroke="rgba(15,23,42,0.9)" strokeWidth={1.5} />

        {/* Needle — north half red, south half white */}
        <g transform={`rotate(${bearing} ${CENTER} ${CENTER})`}>
          <polygon
            points={`${CENTER},${CENTER - RADIUS + 12} ${CENTER - 5},${CENTER} ${CENTER + 5},${CENTER}`}
            fill="#ef4444"
            stroke="rgba(15,23,42,0.6)" strokeWidth={0.8}
          />
          <polygon
            points={`${CENTER},${CENTER + RADIUS - 14} ${CENTER - 4},${CENTER} ${CENTER + 4},${CENTER}`}
            fill="#f1f5f9"
            stroke="rgba(15,23,42,0.6)" strokeWidth={0.8}
          />
        </g>
      </svg>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 92 }}>
        <div style={{
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 22,
          fontWeight: 700,
          color: "#e2e8f0",
          letterSpacing: 0.5,
        }}>
          {String(bearing).padStart(3, "0")}°
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "JetBrains Mono, monospace" }}>
          {cardinalQuadrant(bearing)}
        </div>
        <input
          type="number" min={0} max={359} step={1}
          value={bearing}
          disabled={disabled}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n)) onChange?.(((n % 360) + 360) % 360);
          }}
          className="form-input"
          style={{ width: 92, fontFamily: "JetBrains Mono, monospace", textAlign: "center" }}
        />
        <div style={{ fontSize: 9, color: "var(--text-secondary)" }}>
          drag · click · scroll · ←/→
        </div>
      </div>
    </div>
  );
}
