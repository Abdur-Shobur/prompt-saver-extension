import jwt from 'jsonwebtoken';
import { HttpError } from './http.js';

function secret() {
	const s = process.env.JWT_SECRET;
	if (!s || s.length < 16)
		throw new HttpError(
			500,
			'Server misconfigured: JWT_SECRET is missing or too short'
		);
	return s;
}

export const signToken = (user) =>
	jwt.sign({ uid: String(user._id), email: user.email }, secret(), {
		expiresIn: '180d',
	});

export function requireUser(req) {
	const key = secret();
	const h = req.headers.authorization || '';
	const token = h.startsWith('Bearer ') ? h.slice(7) : '';
	try {
		return jwt.verify(token, key);
	} catch {
		throw new HttpError(401, 'Not logged in');
	}
}

export const validEmail = (e) =>
	typeof e === 'string' &&
	e.length <= 200 &&
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Login/register brute-force limit, stored in MongoDB so it works across serverless instances.
export async function rateLimit(db, key, max = 30, windowMs = 15 * 60 * 1000) {
	const r = await db
		.collection('attempts')
		.findOneAndUpdate(
			{ _id: key },
			{
				$inc: { n: 1 },
				$setOnInsert: { expireAt: new Date(Date.now() + windowMs) },
			},
			{ upsert: true, returnDocument: 'after' }
		);
	const doc = r?.value !== undefined && r?.ok !== undefined ? r.value : r;
	if (doc?.expireAt && new Date(doc.expireAt).getTime() < Date.now()) {
		// window expired — start a new one
		await db
			.collection('attempts')
			.replaceOne(
				{ _id: key },
				{ n: 1, expireAt: new Date(Date.now() + windowMs) },
				{ upsert: true }
			);
		return;
	}
	if ((doc?.n ?? 0) > max)
		throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
}
