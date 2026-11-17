const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'messages.json');
const MAX_BODY_BYTES = 120 * 1024;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CATEGORIES = ['学习', '生活', '班级建议', '同学关系', '心理困扰', '其他'];

// A tiny .env loader keeps the app dependency-free. Existing process variables win.
function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equals = trimmed.indexOf('=');
    if (equals < 1) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = trimmed.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'teacher1234';
const sessions = new Map();
let messages = [];
let saveQueue = Promise.resolve();

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'"
  );
}

function sendJson(res, status, payload, extraHeaders = {}) {
  securityHeaders(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  securityHeaders(res);
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text);
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isSecureRequest(req) {
  return process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https';
}

function sessionCookie(token, req) {
  return `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${isSecureRequest(req) ? '; Secure' : ''}`;
}

function clearSessionCookie(req) {
  return `admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isSecureRequest(req) ? '; Secure' : ''}`;
}

function getAdminSession(req) {
  const token = parseCookies(req.headers.cookie).admin_session;
  if (!token) return null;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function requireAdmin(req, res) {
  if (getAdminSession(req)) return true;
  sendJson(res, 401, { error: '请先登录教师后台' });
  return false;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求内容过大'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('请求格式不正确'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function persistMessages() {
  const snapshot = JSON.stringify(messages, null, 2);
  saveQueue = saveQueue.then(async () => {
    const tempFile = `${DATA_FILE}.tmp`;
    await fsp.writeFile(tempFile, snapshot, 'utf8');
    await fsp.rename(tempFile, DATA_FILE);
  });
  return saveQueue;
}

function cleanMessage(message) {
  return {
    id: message.id,
    category: message.category,
    content: message.content,
    createdAt: message.createdAt,
    read: Boolean(message.read),
  };
}

function routeStatic(req, res, pathname) {
  let relativePath = pathname;
  if (relativePath === '/') relativePath = '/index.html';
  if (relativePath === '/admin' || relativePath === '/admin/') relativePath = '/admin.html';

  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }
  if (decoded.includes('..')) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  const filePath = path.join(PUBLIC_DIR, decoded);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      sendText(res, 404, 'Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };
    securityHeaders(res);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/messages') {
    try {
      const body = await readJson(req);
      const content = String(body.content || '').trim();
      const category = CATEGORIES.includes(body.category) ? body.category : '其他';
      if (content.length < 2) {
        sendJson(res, 400, { error: '请至少填写两字内容' });
        return;
      }
      if (content.length > 2000) {
        sendJson(res, 400, { error: '留言不能超过 2000 字' });
        return;
      }
      messages.unshift({
        id: crypto.randomUUID(),
        category,
        content,
        createdAt: new Date().toISOString(),
        read: false,
      });
      await persistMessages();
      sendJson(res, 201, { ok: true });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || '提交失败，请稍后再试' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    try {
      const body = await readJson(req);
      if (!timingSafeEqualText(body.password || '', ADMIN_PASSWORD)) {
        sendJson(res, 401, { error: '密码不正确' });
        return;
      }
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_TTL_MS);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, req) });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || '登录失败' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    const token = getAdminSession(req);
    if (token) sessions.delete(token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/me') {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { authenticated: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/config') {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { publicUrl: process.env.PUBLIC_URL || '' });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/messages') {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { messages: messages.map(cleanMessage) });
    return;
  }

  const messageMatch = pathname.match(/^\/api\/admin\/messages\/([^/]+)$/);
  if (messageMatch && ['PATCH', 'DELETE'].includes(req.method)) {
    if (!requireAdmin(req, res)) return;
    const message = messages.find((item) => item.id === messageMatch[1]);
    if (!message) {
      sendJson(res, 404, { error: '留言不存在或已删除' });
      return;
    }
    if (req.method === 'DELETE') {
      messages = messages.filter((item) => item.id !== message.id);
      await persistMessages();
      sendJson(res, 200, { ok: true });
      return;
    }
    try {
      const body = await readJson(req);
      if (typeof body.read === 'boolean') message.read = body.read;
      await persistMessages();
      sendJson(res, 200, { message: cleanMessage(message) });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || '更新失败' });
    }
    return;
  }

  sendJson(res, 404, { error: '接口不存在' });
}

async function start() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    messages = JSON.parse(await fsp.readFile(DATA_FILE, 'utf8'));
    if (!Array.isArray(messages)) messages = [];
  } catch {
    messages = [];
    await persistMessages();
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      routeStatic(req, res, url.pathname);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: '服务器发生错误' });
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Anonymous mailbox is running at http://localhost:${PORT}`);
    if (ADMIN_PASSWORD === 'teacher1234') {
      console.warn('Warning: using demo admin password. Set ADMIN_PASSWORD before deployment.');
    }
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
