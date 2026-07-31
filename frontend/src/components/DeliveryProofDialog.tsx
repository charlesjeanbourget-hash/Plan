import { useState, useRef, useEffect, PointerEvent as ReactPointerEvent, ChangeEvent } from 'react';
import { Delivery } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, PenLine, Eraser, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';

export interface DeliveryProof {
  image: string;
  type: 'photo' | 'signature';
}

const compressImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const max = 1200;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('canvas'));
      return;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    resolve(canvas.toDataURL('image/jpeg', 0.75));
  };
  img.onerror = () => reject(new Error('image'));
  img.src = url;
});

export const DeliveryProofDialog = ({ delivery, busy, onClose, onConfirm }: {
  delivery: Delivery | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (proof: DeliveryProof | null) => void;
}): JSX.Element => {
  const [mode, setMode] = useState<'photo' | 'signature'>('photo');
  const [photo, setPhoto] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (delivery) {
      setPhoto('');
      setHasInk(false);
      setMode('photo');
    }
  }, [delivery]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== 'signature') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }, [mode, delivery]);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (e.currentTarget.width / rect.width),
      y: (e.clientY - rect.top) * (e.currentTarget.height / rect.height),
    };
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    drawing.current = true;
    last.current = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setHasInk(true);
  };

  const up = (): void => {
    drawing.current = false;
  };

  const clearSignature = (): void => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    setHasInk(false);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch {
      toast.error('Impossible de lire cette image.');
    }
  };

  const hasProof = mode === 'photo' ? photo !== '' : hasInk;

  const confirm = (): void => {
    if (mode === 'photo' && photo) {
      onConfirm({ image: photo, type: 'photo' });
    } else if (mode === 'signature' && hasInk && canvasRef.current) {
      onConfirm({ image: canvasRef.current.toDataURL('image/png'), type: 'signature' });
    } else {
      onConfirm(null);
    }
  };

  return (
    <Dialog open={delivery !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="proof-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Livraison chez {delivery?.client_name}</DialogTitle>
          <DialogDescription>
            Ajoutez une preuve de livraison : une photo du colis déposé ou la signature du client.
          </DialogDescription>
        </DialogHeader>
        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1 self-start">
          <button
            type="button"
            data-testid="proof-mode-photo"
            onClick={() => setMode('photo')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${mode === 'photo' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-emerald-700'}`}
          >
            <Camera className="w-3.5 h-3.5" /> Photo
          </button>
          <button
            type="button"
            data-testid="proof-mode-signature"
            onClick={() => setMode('signature')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${mode === 'signature' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:text-emerald-700'}`}
          >
            <PenLine className="w-3.5 h-3.5" /> Signature
          </button>
        </div>

        {mode === 'photo' ? (
          <div className="space-y-3">
            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 hover:border-emerald-400 transition-colors p-6 cursor-pointer text-slate-500">
              <Camera className="w-6 h-6 text-slate-400" />
              <span className="text-sm font-medium">{photo ? 'Changer la photo' : 'Prendre ou choisir une photo'}</span>
              <input
                data-testid="proof-photo-input"
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void onFile(e)}
              />
            </label>
            {photo && <img data-testid="proof-photo-preview" src={photo} alt="Aperçu de la preuve" className="w-full max-h-64 object-contain rounded-lg border border-slate-200" />}
          </div>
        ) : (
          <div className="space-y-2">
            <canvas
              ref={canvasRef}
              data-testid="proof-signature-canvas"
              width={440}
              height={180}
              className="w-full rounded-xl border border-slate-300 bg-white cursor-crosshair"
              style={{ touchAction: 'none' }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerLeave={up}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">Faites signer le client dans le cadre ci-dessus.</p>
              <button type="button" data-testid="proof-clear-signature" onClick={clearSignature} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors">
                <Eraser className="w-3.5 h-3.5" /> Effacer
              </button>
            </div>
          </div>
        )}

        <Button
          data-testid="proof-confirm-button"
          disabled={busy}
          onClick={confirm}
          className="w-full rounded-full bg-emerald-600 hover:bg-emerald-700"
        >
          <CircleCheck className="w-4 h-4 mr-1.5" />
          {busy ? 'Enregistrement…' : hasProof ? 'Confirmer la livraison avec preuve' : 'Confirmer la livraison'}
        </Button>
        {!hasProof && (
          <p className="text-xs text-slate-400 text-center -mt-2">Aucune preuve ajoutée — la livraison sera confirmée sans preuve.</p>
        )}
      </DialogContent>
    </Dialog>
  );
};
