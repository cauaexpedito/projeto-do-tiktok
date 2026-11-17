const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, '.data');
const TOKEN_FILE = path.join(DATA_DIR, 'tiktok-token.enc');
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/';
const USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name';
const AUTHORIZATION_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const CALLBACK_PATH = '/auth/tiktok/callback';
const STATE_COOKIE = 'ritmo_tiktok_state';
const OAUTH_STATE_TTL = 10 * 60 * 1000;
const oauthStates = new Map();

loadEnvironmentFile();

function loadEnvironmentFile() {
  const filePath = path.join(ROOT, '.env');
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

function isValidRedirectUri(value) {
  try {
    const redirect = new URL(value);
    return redirect.protocol === 'https:'
      && redirect.pathname === CALLBACK_PATH
      && !redirect.search
      && !redirect.hash
      && !redirect.username
      && !redirect.password;
  } catch {
    return false;
  }
}

function getConfiguration() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY || '';
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET || '';
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || '';
  const encryptionValue = process.env.TIKTOK_TOKEN_ENCRYPTION_KEY || '';
  const encryptionKey = /^[A-Za-z0-9+/]{43}=$/.test(encryptionValue)
    ? Buffer.from(encryptionValue, 'base64')
    : Buffer.alloc(0);
  const missing = [];

  if (!clientKey) missing.push('TIKTOK_CLIENT_KEY');
  if (!clientSecret) missing.push('TIKTOK_CLIENT_SECRET');
  if (!redirectUri || !isValidRedirectUri(redirectUri)) {
    missing.push('TIKTOK_REDIRECT_URI (URL HTTPS terminando em /auth/tiktok/callback)');
  }
  if (encryptionKey.length !== 32) missing.push('TIKTOK_TOKEN_ENCRYPTION_KEY (chave Base64 de 32 bytes)');

  const scopes = (process.env.TIKTOK_SCOPES || 'user.info.basic,video.publish')
    .split(',')
    .map(scope => scope.trim())
    .filter(Boolean);

  return {
    clientKey,
    clientSecret,
    redirectUri,
    encryptionKey,
    scopes,
    missing,
    configured: missing.length === 0,
  };
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function redirect(response, location, headers = {}) {
  response.writeHead(302, { 'Cache-Control': 'no-store', Location: location, ...headers });
  response.end();
}

function stateCookie(value, config, maxAge) {
  const secure = config.redirectUri.startsWith('https://') ? '; Secure' : '';
  return `${STATE_COOKIE}=${value}; Path=${CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(request, name) {
  const cookies = request.headers.cookie || '';
  for (const item of cookies.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return '';
}

function matchesState(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encryptTokens(tokens, config) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  const record = JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  });

  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const temporaryFile = `${TOKEN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, record, { mode: 0o600 });
  try {
    fs.renameSync(temporaryFile, TOKEN_FILE);
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    throw error;
  }
}

function decryptTokens(config) {
  if (!fs.existsSync(TOKEN_FILE)) return null;

  const record = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    config.encryptionKey,
    Buffer.from(record.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  const tokens = JSON.parse(plaintext);
  if (!tokens.accessToken || !tokens.refreshToken || !tokens.openId) {
    throw new Error('O arquivo criptografado de tokens está incompleto.');
  }
  return tokens;
}

function deleteTokenFile() {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
}

async function readTikTokResponse(response, operation) {
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`${operation}: resposta JSON inválida (HTTP ${response.status}).`);
    }
  }

  const apiError = payload.error;
  const errorCode = typeof apiError === 'string' ? apiError : apiError && apiError.code;
  if (!response.ok || (errorCode && errorCode !== 'ok')) {
    throw new Error(`${operation}: TikTok retornou ${errorCode || `HTTP ${response.status}`}.`);
  }
  return payload;
}

async function requestToken(form, operation) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15000),
  });
  return readTikTokResponse(response, operation);
}

function normalizeTokens(payload, config, previousTokens = null) {
  const accessToken = payload.access_token;
  const refreshToken = payload.refresh_token;
  const openId = payload.open_id || (previousTokens && previousTokens.openId);
  const accessLifetime = Number(payload.expires_in);
  const refreshLifetime = Number(payload.refresh_expires_in);
  if (!accessToken || !refreshToken || !openId || !accessLifetime || !refreshLifetime) {
    throw new Error('A resposta de autorização do TikTok não contém todos os tokens necessários.');
  }

  return {
    accessToken,
    refreshToken,
    openId,
    scope: payload.scope || (previousTokens && previousTokens.scope) || '',
    accessTokenExpiresAt: Date.now() + accessLifetime * 1000,
    refreshTokenExpiresAt: Date.now() + refreshLifetime * 1000,
    profile: previousTokens ? previousTokens.profile : null,
  };
}

async function getTikTokProfile(accessToken) {
  const response = await fetch(USER_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await readTikTokResponse(response, 'Consulta da conta TikTok');
  const user = payload.data && payload.data.user;
  if (!user || !user.open_id) throw new Error('O TikTok não retornou os dados da conta autorizada.');
  return {
    openId: user.open_id,
    displayName: user.display_name || 'TikTok',
  };
}

async function getValidTokens(config) {
  let tokens = decryptTokens(config);
  if (!tokens) return null;

  if (tokens.accessTokenExpiresAt <= Date.now() + 60_000) {
    if (tokens.refreshTokenExpiresAt <= Date.now()) {
      throw new Error('A autorização do TikTok expirou. Conecte a conta novamente.');
    }
    const refreshed = await requestToken({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    }, 'Renovação da autorização TikTok');
    tokens = normalizeTokens(refreshed, config, tokens);
    encryptTokens(tokens, config);
  }

  if (!tokens.profile || !tokens.profile.displayName) {
    tokens.profile = await getTikTokProfile(tokens.accessToken);
    tokens.openId = tokens.profile.openId;
    encryptTokens(tokens, config);
  }
  return tokens;
}

function hasScope(tokens, requestedScope) {
  return tokens.scope.split(',').map(scope => scope.trim()).includes(requestedScope);
}

function makeAuthorizationUrl(config, state) {
  const authorization = new URL(AUTHORIZATION_URL);
  authorization.searchParams.set('client_key', config.clientKey);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('scope', config.scopes.join(','));
  authorization.searchParams.set('redirect_uri', config.redirectUri);
  authorization.searchParams.set('state', state);
  return authorization.toString();
}

function sameOriginRequest(request) {
  const origin = request.headers.origin;
  if (!origin || !request.headers.host) return false;
  try {
    return new URL(origin).host.toLowerCase() === request.headers.host.toLowerCase();
  } catch {
    return false;
  }
}

async function handleTikTokCallback(requestUrl, request, response, config) {
  const state = requestUrl.searchParams.get('state') || '';
  const cookieState = readCookie(request, STATE_COOKIE);
  const stateExpiresAt = oauthStates.get(state);
  const clearCookie = stateCookie('', config, 0);

  if (!state || !cookieState || !matchesState(state, cookieState)
    || !stateExpiresAt || stateExpiresAt <= Date.now()) {
    if (state) oauthStates.delete(state);
    redirect(response, '/?tiktok=invalid_state', { 'Set-Cookie': clearCookie });
    return;
  }
  oauthStates.delete(state);

  if (requestUrl.searchParams.has('error')) {
    redirect(response, '/?tiktok=denied', { 'Set-Cookie': clearCookie });
    return;
  }

  const code = requestUrl.searchParams.get('code');
  if (!code) {
    redirect(response, '/?tiktok=error', { 'Set-Cookie': clearCookie });
    return;
  }

  try {
    const tokenPayload = await requestToken({
      client_key: config.clientKey,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }, 'Troca do código de autorização');
    const tokens = normalizeTokens(tokenPayload, config);
    tokens.profile = await getTikTokProfile(tokens.accessToken);
    tokens.openId = tokens.profile.openId;
    encryptTokens(tokens, config);
    redirect(response, '/?tiktok=connected', { 'Set-Cookie': clearCookie });
  } catch (error) {
    console.error('Falha no retorno OAuth do TikTok:', error.message);
    redirect(response, '/?tiktok=error', { 'Set-Cookie': clearCookie });
  }
}

function serveStaticFile(requestUrl, response) {
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  };
  const file = files[requestUrl.pathname];
  if (!file) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Content-Type': file[1],
  });
  fs.createReadStream(path.join(ROOT, file[0])).pipe(response);
}

async function handleRequest(request, response) {
  setSecurityHeaders(response);
  const requestUrl = new URL(request.url, 'http://localhost');
  const config = getConfiguration();

  if (request.method === 'GET' && requestUrl.pathname === '/api/tiktok/status') {
    if (!config.configured) {
      sendJson(response, 200, { configured: false, connected: false, missing: config.missing });
      return;
    }
    try {
      const tokens = await getValidTokens(config);
      if (!tokens) {
        sendJson(response, 200, { configured: true, connected: false });
        return;
      }
      sendJson(response, 200, {
        configured: true,
        connected: true,
        account: { displayName: tokens.profile.displayName },
        canPublish: hasScope(tokens, 'video.publish'),
      });
    } catch (error) {
      console.error('Falha ao consultar a conexão TikTok:', error.message);
      sendJson(response, 502, { error: 'tiktok_status_unavailable' });
    }
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/auth/tiktok') {
    if (!config.configured) {
      sendJson(response, 503, { error: 'tiktok_not_configured', missing: config.missing });
      return;
    }
    const now = Date.now();
    for (const [state, expiresAt] of oauthStates) {
      if (expiresAt <= now) oauthStates.delete(state);
    }
    const state = crypto.randomBytes(32).toString('base64url');
    oauthStates.set(state, now + OAUTH_STATE_TTL);
    redirect(response, makeAuthorizationUrl(config, state), {
      'Set-Cookie': stateCookie(state, config, Math.floor(OAUTH_STATE_TTL / 1000)),
    });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === CALLBACK_PATH) {
    if (!config.configured) {
      redirect(response, '/?tiktok=setup');
      return;
    }
    await handleTikTokCallback(requestUrl, request, response, config);
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/tiktok/disconnect') {
    if (request.headers['x-requested-with'] !== 'Ritmo' || !sameOriginRequest(request)) {
      sendJson(response, 403, { error: 'request_forbidden' });
      return;
    }
    if (!config.configured) {
      sendJson(response, 503, { error: 'tiktok_not_configured' });
      return;
    }
    try {
      const tokens = await getValidTokens(config);
      if (tokens) {
        const revokeResponse = await fetch(REVOKE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: config.clientKey,
            client_secret: config.clientSecret,
            token: tokens.accessToken,
          }),
          signal: AbortSignal.timeout(15000),
        });
        await readTikTokResponse(revokeResponse, 'Desconexão da conta TikTok');
        deleteTokenFile();
      }
      sendJson(response, 200, { connected: false });
    } catch (error) {
      console.error('Falha ao desconectar a conta TikTok:', error.message);
      sendJson(response, 502, { error: 'tiktok_disconnect_failed' });
    }
    return;
  }

  if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname.endsWith('.html')
    || requestUrl.pathname.endsWith('.css') || requestUrl.pathname.endsWith('.js'))) {
    serveStaticFile(requestUrl, response);
    return;
  }

  sendJson(response, 404, { error: 'not_found' });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    console.error('Erro inesperado no servidor Ritmo:', error.message);
    if (!response.headersSent) sendJson(response, 500, { error: 'internal_server_error' });
    else response.destroy();
  });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 8765);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`Ritmo disponível em http://${host}:${port}`);
    const config = getConfiguration();
    if (!config.configured) {
      console.log(`Conexão TikTok aguardando configuração: ${config.missing.join(', ')}`);
    }
  });
}

module.exports = { getConfiguration, server };
