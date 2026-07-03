// City detection from Vercel's IP geolocation headers (free, city-level accuracy).
// Used only as a suggestion in onboarding — the user always confirms or types their own.
export default function handler(req, res) {
  const rawCity = req.headers['x-vercel-ip-city'];
  const country = req.headers['x-vercel-ip-country'] || null;
  let city = null;
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }
  return res.status(200).json({ city, country });
}
