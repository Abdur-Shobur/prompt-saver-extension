// Two-way sync.
// Request:  { since, prompts: [...], after?: {ts, id}, pull?: false }
// Response: { now, more, after, changes: [...] }
import { route } from '../lib/http.js';
import { getDb } from '../lib/db.js';
import { requireUser } from '../lib/auth.js';

const MAX_PUSH = 1000; // prompts accepted per request
const PAGE_MAX = 1000; // prompts returned per page
const PAGE_BYTES = 3_000_000; // keep responses under Vercel's 4.5 MB limit
const OVERLAP_MS = 60_000; // re-send last 60s so writes from parallel instances are never missed

const out = (d) => ({
	id: d.id,
	text: d.text || '',
	site: d.site,
	url: d.url || '',
	title: d.title || '',
	favorite: !!d.favorite,
	deleted: !!d.deleted,
	createdAt: d.createdAt,
	updatedAt: d.updatedAt,
});

export default route(['POST'], async (req, res, body) => {
	const user = requireUser(req);
	const userId = user.uid;
	const db = await getDb();
	const col = db.collection('prompts');
	const now = Date.now();

	// ---- push ----
	const incoming = (Array.isArray(body.prompts) ? body.prompts : [])
		.filter((p) => p && typeof p.id === 'string' && p.id && p.id.length <= 64)
		.slice(0, MAX_PUSH);

	if (incoming.length) {
		const ops = incoming.map((p) => {
			const deleted = !!p.deleted;
			const updatedAt = Number(p.updatedAt) || now;
			return {
				updateOne: {
					// only overwrite when the incoming version is the same or newer
					filter: { userId, id: p.id, updatedAt: { $lte: updatedAt } },
					update: {
						$set: {
							text: deleted ? '' : String(p.text || '').slice(0, 200000),
							site: p.site === 'claude' ? 'claude' : 'chatgpt',
							url: String(p.url || '').slice(0, 2000),
							title: String(p.title || '').slice(0, 300),
							favorite: !!p.favorite,
							deleted,
							updatedAt,
							serverTs: now,
						},
						$setOnInsert: { createdAt: Number(p.createdAt) || now },
					},
					upsert: true,
				},
			};
		});
		try {
			await col.bulkWrite(ops, { ordered: false });
		} catch (e) {
			// E11000 = server already has a newer version of that prompt — expected, ignore.
			const errs = e?.writeErrors ? [].concat(e.writeErrors) : [];
			if (!errs.length || errs.some((w) => (w.code ?? w.err?.code) !== 11000))
				throw e;
		}
	}

	if (body.pull === false) return res.status(200).json({ ok: true, now });

	// ---- pull ----
	const after = body.after;
	const filter =
		after && typeof after.ts === 'number' && typeof after.id === 'string'
			? {
					userId,
					$or: [
						{ serverTs: { $gt: after.ts } },
						{ serverTs: after.ts, id: { $gt: after.id } },
					],
			  }
			: { userId, serverTs: { $gt: (Number(body.since) || 0) - OVERLAP_MS } };

	const cursor = col
		.find(filter, { projection: { _id: 0, userId: 0 } })
		.sort({ serverTs: 1, id: 1 })
		.limit(PAGE_MAX + 1);

	const changes = [];
	let bytes = 0;
	let more = false;
	let last = null;
	for await (const d of cursor) {
		const size = Buffer.byteLength(d.text || '') + 400;
		if (
			changes.length >= PAGE_MAX ||
			(changes.length && bytes + size > PAGE_BYTES)
		) {
			more = true;
			break;
		}
		bytes += size;
		changes.push(out(d));
		last = d;
	}

	res.status(200).json({
		now,
		more,
		after: more ? { ts: last.serverTs, id: last.id } : null,
		changes,
	});
});
