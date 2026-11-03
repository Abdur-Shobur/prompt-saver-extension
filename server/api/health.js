import { route } from '../lib/http.js';
import { getDb } from '../lib/db.js';

// Shows exactly what's wrong with the setup instead of a generic error.
export default route(['GET'], async (_req, res) => {
	const env = {
		MONGODB_URI: !!process.env.MONGODB_URI,
		JWT_SECRET: !!process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16,
	};
	if (!env.MONGODB_URI || !env.JWT_SECRET) {
		return res.status(500).json({
			ok: false,
			env,
			error:
				'Missing environment variables. Add them in Vercel → Settings → Environment Variables, then Redeploy.',
		});
	}

	try {
		const db = await getDb();
		await db.command({ ping: 1 });
		res.status(200).json({ ok: true, db: 'connected', env });
	} catch (e) {
		const msg = String(e?.message || e);
		let hint = 'Check MONGODB_URI.';
		if (
			/timed out|ETIMEDOUT|ECONNREFUSED|ReplicaSetNoPrimary|MongoServerSelectionError|whitelist/i.test(
				msg
			)
		) {
			hint =
				'Atlas is blocking the connection. Atlas → Network Access → Add IP Address → Allow access from anywhere (0.0.0.0/0).';
		} else if (/bad auth|authentication failed/i.test(msg)) {
			hint =
				'Wrong database username or password in MONGODB_URI (use the Database Access user, URL-encode special characters).';
		} else if (/ENOTFOUND|querySrv|Invalid scheme|URI/i.test(msg)) {
			hint =
				'MONGODB_URI is malformed — copy it again from Atlas → Connect → Drivers.';
		}
		res.status(500).json({ ok: false, db: 'error', error: msg, hint });
	}
});
