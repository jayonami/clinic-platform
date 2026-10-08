import { createApp } from './app.js';
import { get } from './db.js';
import { seedDefaultSettings } from './lib/settings.js';
import { expireStale } from './lib/waitlist.js';
import { broadcast } from './lib/realtime.js';

seedDefaultSettings();
if (!get('SELECT id FROM staff LIMIT 1')) {
  console.log('Empty database — loading demo data…');
  const { seedDemo } = await import('./seed.js');
  seedDemo();
}

setInterval(() => {
  try {
    expireStale();
    broadcast();
  } catch (e) {
    console.error('sweep failed', e);
  }
}, 60_000).unref();

const port = +process.env.PORT || 3001;
createApp().listen(port, () => console.log(`API ready on http://localhost:${port}`));
