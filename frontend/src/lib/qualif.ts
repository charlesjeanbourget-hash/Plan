const STOP = new Set(['gestion', 'verification', 'verifier', 'faire', 'avant', 'apres', 'pour', 'dans',
  'avec', 'sans', 'sous', 'tous', 'tout', 'toute', 'toutes', 'cette', 'chaque', 'pharmacie', 'responsable',
  'service', 'prise', 'mise']);

export const normWords = (s: string): string[] => {
  const txt = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (txt.match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));
};

export const isQualified = (label: string, caps: string[]): boolean => {
  const tw = normWords(label);
  if (tw.length === 0 || caps.length === 0) return true;
  return caps.some((c) => normWords(c).some((w) => tw.includes(w)));
};
