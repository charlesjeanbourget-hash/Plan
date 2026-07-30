import logo from '@/assets/logo-arriere-plan.png';

let cached: string | null = null;

export const getLogoDataUrl = async (): Promise<string> => {
  if (cached) return cached;
  const img = new Image();
  img.src = logo;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Logo introuvable'));
  });
  const canvas = document.createElement('canvas');
  const w = 480;
  const h = Math.round((img.height / img.width) * w);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas non disponible');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  cached = canvas.toDataURL('image/jpeg', 0.9);
  return cached;
};
