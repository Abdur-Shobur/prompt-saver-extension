import bcrypt from 'bcryptjs';
import { route, HttpError, clientIp } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { signToken, rateLimit } from '../lib/auth.js';

export default route(['POST'], async (req, res, body) => {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const db = await getDb();
  await rateLimit(db, 'auth:' + clientIp(req));

  const user = await db.collection('users').findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.pass))) {
    throw new HttpError(401, 'Wrong email or password.');
  }
  res.status(200).json({ token: signToken(user), email: user.email });
});
