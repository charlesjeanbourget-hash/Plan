import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Eraser } from 'lucide-react';

export const SignaturePad = ({ onSave, saving }: { onSave: (dataUrl: string) => void; saving?: boolean }): JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setEmpty(false);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const clear = (): void => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        data-testid="signature-canvas"
        width={560}
        height={180}
        className="w-full rounded-xl border-2 border-dashed border-slate-300 bg-white touch-none cursor-crosshair"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => { drawing.current = false; }}
        onPointerLeave={() => { drawing.current = false; }}
      />
      <p className="text-[11px] text-slate-400">Signez ci-dessus avec la souris ou le doigt.</p>
      <div className="flex gap-2">
        <Button data-testid="signature-clear-button" type="button" variant="outline" size="sm" onClick={clear} className="rounded-full text-xs">
          <Eraser className="w-3.5 h-3.5 mr-1" /> Effacer
        </Button>
        <Button
          data-testid="signature-save-button"
          type="button"
          size="sm"
          disabled={empty || saving}
          onClick={() => { const c = canvasRef.current; if (c) onSave(c.toDataURL('image/png')); }}
          className="rounded-full bg-emerald-600 hover:bg-emerald-700 text-xs flex-1"
        >
          {saving ? 'Enregistrement…' : 'Signer électroniquement'}
        </Button>
      </div>
    </div>
  );
};
