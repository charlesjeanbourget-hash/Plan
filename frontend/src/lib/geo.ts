export interface PunchGeo {
  lat: number;
  lng: number;
  accuracy: number;
}

export const getPunchGeo = (): Promise<PunchGeo | null> =>
  new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60000 },
    );
  });
