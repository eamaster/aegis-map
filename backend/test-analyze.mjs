/**
 * Bounded verification of POST /api/analyze (Workers AI path).
 *
 * Usage:
 *   API_URL=http://localhost:8787/api/analyze node test-analyze.mjs
 *
 * Does not print secrets. Requires a running Worker with AI binding.
 */
const API_URL = process.env.API_URL || 'http://localhost:8787/api/analyze';

const request = {
  disasterTitle: 'California Wildfire',
  satelliteName: 'LANDSAT 9',
  passTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  cloudCover: 15,
  disasterType: 'fire',
};

console.log('Testing /api/analyze');
console.log('API_URL:', API_URL);
console.log('Request:', request);

try {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  console.log('Status:', response.status);
  if (response.ok) {
    console.log('source:', data.source);
    console.log('cached:', data.cached);
    console.log('analysis:', data.analysis);
  } else {
    console.log('error body:', data);
  }
  process.exit(response.ok && data.source === 'workers-ai' ? 0 : 1);
} catch (error) {
  console.error('Network error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
