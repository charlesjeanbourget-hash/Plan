import { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { loadGoogleMaps, hasGoogleMapsKey } from '@/lib/googleMaps';

interface Props {
  value: string;
  onChange: (address: string) => void;
  placeholder?: string;
  testId?: string;
  required?: boolean;
}

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (el: HTMLInputElement, opts?: { types?: string[]; componentRestrictions?: { country: string } }) => {
            addListener: (ev: string, cb: () => void) => void;
            getPlace: () => { formatted_address?: string; name?: string };
          };
        };
      };
    };
  }
}

export function GoogleAddressInput({ value, onChange, placeholder, testId, required }: Props): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasGoogleMapsKey() || !ref.current) return undefined;
    let cancelled = false;
    void loadGoogleMaps().then(() => {
      if (cancelled || !ref.current || !window.google?.maps?.places) return;
      const ac = new window.google.maps.places.Autocomplete(ref.current, {
        types: ['address'],
        componentRestrictions: { country: 'ca' },
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const addr = place.formatted_address || place.name || '';
        if (addr) onChange(addr);
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [onChange]);

  return (
    <Input
      ref={ref}
      data-testid={testId ?? 'google-address-input'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? 'Commencez à taper l’adresse…'}
      required={required}
      autoComplete="off"
    />
  );
}
