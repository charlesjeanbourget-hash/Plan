import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { suggestOsm, GeoPos } from '@/lib/osmRoute';

export function OsmAddressInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string;
  onChange: (address: string, pos?: GeoPos) => void;
  placeholder?: string;
  testId?: string;
}): JSX.Element {
  const [hints, setHints] = useState<GeoPos[]>([]);

  useEffect(() => {
    if (value.trim().length < 6) { setHints([]); return undefined; }
    const t = window.setTimeout(() => {
      void suggestOsm(value).then(setHints).catch(() => setHints([]));
    }, 350);
    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <div className="relative">
      <Input data-testid={testId ?? 'osm-address-input'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Adresse (OpenStreetMap)…'} autoComplete="off" />
      {hints.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg max-h-48 overflow-auto text-xs">
          {hints.map((h) => (
            <li key={`${h.lat}-${h.lng}`}>
              <button type="button" className="w-full text-left px-3 py-2 hover:bg-emerald-50" onClick={() => { onChange(h.label, h); setHints([]); }}>
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
