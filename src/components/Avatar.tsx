import { useEffect, useRef } from 'react';

interface Props {
  isActive: boolean;
  size?: number;
}

export default function Avatar({ isActive, size = 60 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      timeRef.current += isActive ? 0.05 : 0.01;
      const t = timeRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Outer glow
      const glowRadius = size * 0.45 + Math.sin(t * 2) * 4;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      glow.addColorStop(0, isActive ? 'rgba(108, 92, 231, 0.3)' : 'rgba(108, 92, 231, 0.15)');
      glow.addColorStop(1, 'rgba(108, 92, 231, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Core orb
      const coreRadius = size * 0.25 + Math.sin(t * 3) * 2;
      const core = ctx.createRadialGradient(cx, cy - 4, 0, cx, cy, coreRadius);
      core.addColorStop(0, '#a29bfe');
      core.addColorStop(0.6, '#6c5ce7');
      core.addColorStop(1, '#4a3db5');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
      ctx.fill();

      // Highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.ellipse(cx - 4, cy - coreRadius * 0.3, coreRadius * 0.5, coreRadius * 0.25, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Orbiting particles
      if (isActive) {
        for (let i = 0; i < 3; i++) {
          const angle = t * 1.5 + (i * Math.PI * 2) / 3;
          const orbitR = size * 0.35 + Math.sin(t * 2 + i) * 5;
          const px = cx + Math.cos(angle) * orbitR;
          const py = cy + Math.sin(angle) * orbitR;
          const pr = 2 + Math.sin(t * 4 + i) * 1;
          ctx.fillStyle = `rgba(162, 155, 254, ${0.5 + Math.sin(t * 3 + i) * 0.3})`;
          ctx.beginPath();
          ctx.arc(px, py, pr, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [isActive, size]);

  return (
    <div className="avatar-container" style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        width={size * 2}
        height={size * 2}
        style={{ width: size, height: size }}
      />
    </div>
  );
}
