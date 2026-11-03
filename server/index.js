// Run the Vercel API functions locally (no Vercel account needed).
// Uses the same code in /api and your real MONGODB_URI from .env
//
//   node index.js      → http://localhost:3000/api/health
//   (Vercel does NOT use this file — it runs the files in /api directly)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));

// --- load .env (simple parser, doesn't override existing env vars) ---
const envFile = path.join(dir, '.env');
if (existsSync(envFile)) {
	for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
		if (!m || line.trim().startsWith('#')) continue;
		let v = m[2].trim();
		if (
			(v.startsWith('"') && v.endsWith('"')) ||
			(v.startsWith("'") && v.endsWith("'"))
		)
			v = v.slice(1, -1);
		if (process.env[m[1]] === undefined) process.env[m[1]] = v;
	}
} else {
	console.warn(
		'⚠  No .env file found. Copy .env.example to .env and fill in MONGODB_URI and JWT_SECRET.'
	);
}

const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((k) => !process.env[k]);
if (missing.length) {
	console.error(`✖  Missing in .env: ${missing.join(', ')}`);
	process.exit(1);
}

const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 4.5 * 1024 * 1024; // same limit as Vercel

// --- load /api routes ---
const routes = {};
for (const name of ['health', 'register', 'login', 'sync']) {
	routes['/api/' + name] = (
		await import(pathToFileURL(path.join(dir, 'api', name + '.js')).href)
	).default;
}

// --- Vercel-like request/response ---
const server = http.createServer((req, res) => {
	const started = Date.now();
	const url = req.url.split('?')[0].replace(/\/+$/, '');
	const chunks = [];
	let size = 0;

	res.status = (code) => {
		res.statusCode = code;
		return res;
	};
	res.json = (obj) => {
		if (!res.headersSent)
			res.setHeader('Content-Type', 'application/json; charset=utf-8');
		res.end(JSON.stringify(obj));
		return res;
	};
	res.on('finish', () => {
		console.log(
			`${req.method.padEnd(7)} ${url.padEnd(16)} ${res.statusCode}  ${Date.now() - started}ms`
		);
	});

	req.on('data', (c) => {
		size += c.length;
		if (size <= MAX_BODY) chunks.push(c);
	});
	req.on('end', async () => {
		if (size > MAX_BODY) {
			return res
				.status(413)
				.json({ error: 'Request body too large (Vercel limit is 4.5 MB)' });
		}
		const raw = Buffer.concat(chunks).toString('utf8');
		try {
			req.body =
				raw && /json/i.test(req.headers['content-type'] || '')
					? JSON.parse(raw)
					: raw;
		} catch {
			return res.status(400).json({ error: 'Invalid JSON' });
		}
		const handler = routes[url];
		if (!handler)
			return res
				.status(404)
				.json({ error: 'Not found', routes: Object.keys(routes) });
		try {
			await handler(req, res);
		} catch (e) {
			console.error(e);
			if (!res.headersSent) res.status(500).json({ error: 'Server error' });
		}
	});
});

server.listen(PORT, () => {
	const host =
		(process.env.MONGODB_URI.match(/@([^/?]+)/) || [])[1] || 'MongoDB';
	console.log(`\n✔  Prompt Saver API running at http://localhost:${PORT}`);
	console.log(
		`   Database: ${host} / ${process.env.MONGODB_DB || 'prompt_saver'}`
	);
	console.log(`   Check:    http://localhost:${PORT}/api/health\n`);
});
