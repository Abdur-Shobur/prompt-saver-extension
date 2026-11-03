export class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

// Wraps a Vercel function: CORS, method check, JSON body, error handling.
export function route(methods, fn) {
	return async (req, res) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader(
			'Access-Control-Allow-Headers',
			'Content-Type, Authorization'
		);
		res.setHeader('Access-Control-Max-Age', '86400');
		if (req.method === 'OPTIONS') return res.status(204).end();
		if (!methods.includes(req.method))
			return res.status(405).json({ error: 'Method not allowed' });

		try {
			let body = req.body ?? {};
			if (typeof body === 'string') body = body ? JSON.parse(body) : {};
			await fn(req, res, body || {});
		} catch (e) {
			if (e?.status && e.status < 500)
				return res.status(e.status).json({ error: e.message });
			console.error(e);
			res.status(500).json({ error: e?.status ? e.message : 'Server error' });
		}
	};
}

export function clientIp(req) {
	const fwd = req.headers['x-forwarded-for'];
	return (
		(Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() ||
		req.socket?.remoteAddress ||
		'unknown'
	);
}
