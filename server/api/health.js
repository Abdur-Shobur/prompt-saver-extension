import { route } from '../lib/http.js';
import { getDb } from '../lib/db.js';

export default route(['GET'], async (_req, res) => {
  const db = await getDb();
  await db.command({ ping: 1 });
  res.status(200).json({ ok: true, db: 'connected' });
});
