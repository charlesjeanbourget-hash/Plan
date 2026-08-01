export interface PunchGeo {
  lat: number;
  lng: number;
  accuracy: number;
}

const CONSENT_KEY = 'ap_geo_consent';

export type GeoConsent = 'granted' | 'denied' | null;

export const getGeoConsent = (): GeoConsent => {
  const v = localStorage.getItem(CONSENT_KEY);
  return v === 'granted' || v === 'denied' ? v : null;
};

export const setGeoConsent = (value: 'granted' | 'denied'): void => {
  localStorage.setItem(CONSENT_KEY, value);
};

export const getPunchGeo = (): Promise<PunchGeo | null> =>
  new Promise((resolve) => {
    if (getGeoConsent() !== 'granted' || !('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60000 },
    );
  });
