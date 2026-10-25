// In-memory stand-in for the GitHub Contents API (enough for Daily OS sync + the widget).
const crypto = require('crypto');

function createRepo({ token = 'test-token', repo = 'me/daily-os-data' } = {}) {
  const files = new Map();
  let commits = 0;
  const state = { failPuts: 0, puts: 0, gets: 0, lists: 0, beforePut: null };
  const sha = (s) => crypto.createHash('sha1').update(`${s}\n${++commits}`).digest('hex');
  function handle(method, path, bodyText, auth) {
    if (auth !== `Bearer ${token}`) return { status: 401, json: { message: 'Bad credentials' } };
    const m = path.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/?(.*)$/);
    if (!m || m[1] !== repo) return { status: 404, json: { message: 'Not Found' } };
    const name = decodeURIComponent(m[2] || '');
    if (method === 'GET') {
      if (!name) {
        state.lists++;
        if (!files.size) return { status: 404, json: { message: 'This repository is empty.' } };
        return { status: 200, json: [...files].map(([n, f]) => ({ name: n, path: n, sha: f.sha, size: f.text.length, type: 'file' })) };
      }
      state.gets++;
      const f = files.get(name);
      if (!f) return { status: 404, json: { message: 'Not Found' } };
      return { status: 200, json: { name, path: name, sha: f.sha, encoding: 'base64', content: Buffer.from(f.text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n') } };
    }
    if (method === 'PUT') {
      if (state.beforePut) { const fn = state.beforePut; state.beforePut = null; fn(name); }
      const body = JSON.parse(bodyText), cur = files.get(name);
      if (state.failPuts > 0) { state.failPuts--; return { status: 409, json: { message: 'conflict' } }; }
      if (cur && !body.sha) return { status: 422, json: { message: 'Invalid request. "sha" wasn\'t supplied.' } };
      if (cur && body.sha !== cur.sha) return { status: 409, json: { message: `${name} does not match ${body.sha}` } };
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      JSON.parse(text);
      const s = sha(text);
      files.set(name, { text, sha: s });
      state.puts++;
      return { status: cur ? 200 : 201, json: { content: { name, path: name, sha: s }, commit: { message: body.message } } };
    }
    return { status: 405, json: { message: 'Method not allowed' } };
  }
  // fetch() replacement for Node tests
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    const r = handle(opts.method || 'GET', u.pathname.replace(/^\/gh/, ''), opts.body, (opts.headers || {}).Authorization);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.json };
  };
  // Mount on an http server under /gh
  const serve = (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const r = handle(req.method, new URL(req.url, 'http://x').pathname.replace(/^\/gh/, ''), body, req.headers.authorization);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.json));
    });
  };
  const read = (name) => (files.has(name) ? JSON.parse(files.get(name).text) : null);
  const write = (name, data) => files.set(name, { text: JSON.stringify(data), sha: sha(JSON.stringify(data)) });
  return { token, repo, files, state, handle, fetch: fetchFn, serve, read, write };
}
module.exports = { createRepo };
