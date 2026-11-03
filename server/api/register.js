import bcrypt from 'bcryptjs';
import { route, HttpError, clientIp } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { signToken, validEmail, rateLimit } from '../lib/auth.js';

export default route(['POST'], async (req, res, body) => {
  if ((process.env.ALLOW_REGISTER ?? 'true') === 'false') {
    throw new HttpError(403, 'Registration is disabled on this server.');
  }
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email.');
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');

  const db = await getDb();
  await rateLimit(db, 'auth:' + clientIp(req));

  const user = { email, pass: await bcrypt.hash(password, 10), createdAt: new Date() };
  try {
    const r = await db.collection('users').insertOne(user);
    user._id = r.insertedId;
  } catch (e) {
    if (e?.code === 11000) throw new HttpError(409, 'That email already has an account. Log in instead.');
    throw e;
  }
  res.status(200).json({ token: signToken(user), email });
});
