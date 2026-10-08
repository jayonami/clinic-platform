// Vercel serverless entry: the whole Express API as one function.
// The database lives in /tmp, so it is created and seeded with demo data on a cold start.
import { createApp } from '../server/src/app.js';
import { get } from '../server/src/db.js';
import { seedDefaultSettings } from '../server/src/lib/settings.js';
import { seedDemo } from '../server/src/seed.js';

seedDefaultSettings();
if (!get('SELECT id FROM staff LIMIT 1')) seedDemo();

export default createApp();
