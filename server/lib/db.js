import { MongoClient } from 'mongodb';

// Reuse one connection across warm serverless invocations.
const cache =
	globalThis.__promptSaverMongo ||
	(globalThis.__promptSaverMongo = { promise: null });

export function getDb() {
	const uri = process.env.MONGODB_URI;
	if (!uri) {
		const e = new Error('Server misconfigured: MONGODB_URI is not set');
		e.status = 500;
		throw e;
	}
	if (!cache.promise) {
		cache.promise = (async () => {
			const client = new MongoClient(uri, { maxPoolSize: 10 });
			await client.connect();
			const db = client.db(process.env.MONGODB_DB || 'prompt_saver');
			await Promise.all([
				db.collection('users').createIndex({ email: 1 }, { unique: true }),
				db
					.collection('prompts')
					.createIndex({ userId: 1, id: 1 }, { unique: true }),
				db.collection('prompts').createIndex({ userId: 1, serverTs: 1, id: 1 }),
				// TTL just cleans up old rate-limit rows; rateLimit() works without it.
				db
					.collection('attempts')
					.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 })
					.catch(() => {}),
			]);
			return db;
		})().catch((e) => {
			cache.promise = null;
			throw e;
		});
	}
	return cache.promise;
}
