'use strict';

/**
 * ATİK VİEWER — yerel PACS proxy sunucusu.
 * Varsayılan olarak yalnızca bu bilgisayardan erişime açıktır.
 * Not: /api/pacs/echo TCP erişilebilirliğini ölçer; DICOM C-ECHO değildir.
 */

const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const { cfind } = require('./dicom-cfind.js');
const packageInfo = require('./package.json');

const app = express();
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1'];
const MAX_QIDO_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES = 512 * 1024 * 1024;
const VIEWER_FILE = path.join(__dirname, 'atik-viewer.html');
const GUIDE_FILE = path.join(__dirname, 'index.html');
const VENDOR_DIR = path.join(__dirname, 'vendor');
const DOCS_DIR = path.join(__dirname, 'docs');

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

const allowedHosts = new Set([
  ...DEFAULT_ALLOWED_HOSTS,
  ...parseCsv(process.env.ATIK_ALLOWED_HOSTS).map(normalizeHostname).filter(Boolean),
]);
const allowedOrigins = new Set(parseCsv(process.env.ATIK_ALLOWED_ORIGINS).map(normalizeOrigin).filter(Boolean));
const imageProxyHosts = new Set(parseCsv(process.env.ATIK_PACS_IMAGE_PROXY_HOSTS).map(normalizeHostname).filter(Boolean));

// DNS rebinding protection: reject unexpected Host headers before serving the UI or API.
app.use((req, res, next) => {
  const hostname = normalizeHostname(req.get('host'));
  if (!hostname || !allowedHosts.has(hostname)) {
    return res.status(421).json({ error: 'Bu Host başlığı yerel sunucu için izinli değil.' });
  }
  next();
});

// Same-origin is the default. Cross-origin use must be explicitly configured.
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  let isSameOrigin = false;

  if (origin) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      return res.status(403).json({ error: 'Geçersiz Origin başlığı.' });
    }

    let currentOrigin = '';
    try {
      currentOrigin = new URL(`${req.protocol}://${req.get('host')}`).origin.toLowerCase();
    } catch {
      return res.status(403).json({ error: 'Geçersiz istek kaynağı.' });
    }
    isSameOrigin = ['http:', 'https:'].includes(parsedOrigin.protocol)
      && parsedOrigin.origin.toLowerCase() === currentOrigin;
    const explicitlyAllowed = allowedOrigins.has(parsedOrigin.origin.toLowerCase());

    if (!isSameOrigin && !explicitlyAllowed) {
      return res.status(403).json({ error: 'Bu kaynak için API erişimine izin verilmiyor.' });
    }

    if (!isSameOrigin && explicitlyAllowed) {
      res.setHeader('Access-Control-Allow-Origin', parsedOrigin.origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  if (req.method === 'OPTIONS') {
    if (!origin) return res.sendStatus(400);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '256kb', strict: true }));

// Only the intended UI and local vendor assets are served. Source/config files stay private.
app.get(['/', '/atik-viewer.html'], (req, res, next) => res.sendFile(VIEWER_FILE, err => err && next(err)));
app.get('/index.html', (req, res, next) => res.sendFile(GUIDE_FILE, err => err && next(err)));
app.use('/vendor', express.static(VENDOR_DIR, {
  dotfiles: 'deny',
  index: false,
  maxAge: '1d',
}));
app.use('/docs', express.static(DOCS_DIR, {
  dotfiles: 'deny',
  index: false,
  maxAge: '1d',
}));

// Health check. Contains no patient data or PACS configuration.
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: packageInfo.version, time: new Date().toISOString() });
});

// TCP reachability test only; it does not perform a DICOM Verification SOP (C-ECHO).
app.get('/api/pacs/echo', async (req, res) => {
  const target = validateEndpoint(req.query.ip, req.query.port);
  if (!target.ok) return res.status(400).json({ ok: false, msg: target.error, method: 'tcp' });

  try {
    await tcpPing(target.host, target.port, 4000);
    return res.json({
      ok: true,
      msg: `TCP bağlantısı başarılı: ${target.host}:${target.port}. DICOM C-ECHO doğrulanmadı.`,
      method: 'tcp',
    });
  } catch (error) {
    return res.json({
      ok: false,
      msg: `TCP bağlantı hatası: ${target.host}:${target.port} — ${safeErrorMessage(error)}`,
      method: 'tcp',
    });
  }
});

// C-FIND — QIDO-RS is tried first; the existing JavaScript DICOM C-FIND is the fallback.
app.post('/api/pacs/find', async (req, res) => {
  const input = validateFindRequest(req.body);
  if (!input.ok) return res.status(400).json({ ok: false, results: [], msg: input.error });

  const { serverIp, serverPort, serverAE, clientAE, filters } = input.value;

  try {
    const qido = await tryQIDO(serverIp, serverPort, filters);
    if (qido.length > 0) {
      console.log(`[QIDO-RS] ${qido.length} sonuç`);
      return res.json({ ok: true, results: qido, method: 'qido-rs' });
    }
  } catch (error) {
    console.log(`[QIDO-RS] Başarısız: ${safeErrorMessage(error)}`);
  }

  try {
    console.log(`[C-FIND] ${serverAE}@${serverIp}:${serverPort} sorgulanıyor...`);
    const cfindResults = await cfind(serverIp, serverPort, serverAE, clientAE, filters, 20000);
    console.log(`[C-FIND] ${cfindResults.length} sonuç`);
    if (cfindResults.length > 0) {
      return res.json({ ok: true, results: cfindResults, method: 'c-find' });
    }
    return res.json({ ok: false, results: [], msg: 'Sonuç bulunamadı. Hasta adı veya tarih aralığını kontrol edin.' });
  } catch (error) {
    const message = safeErrorMessage(error);
    console.log(`[C-FIND] Başarısız: ${message}`);
    const hint = message.includes('A-ASSOCIATE-RJ')
      ? message
      : message.includes('TCP') || message.includes('ECONNREFUSED')
        ? `PACS sunucusuna bağlanılamadı: ${serverIp}:${serverPort}. IP/port ve ağ erişimini kontrol edin.`
        : `C-FIND hatası: ${message}`;
    return res.json({ ok: false, results: [], msg: hint });
  }
});

// WADO-RS endpoint discovery. It reports the discovered endpoint; it does not download a study.
app.get('/api/pacs/wado', async (req, res) => {
  const target = validateEndpoint(req.query.serverIp, req.query.serverPort);
  if (!target.ok) return res.status(400).json({ ok: false, msg: target.error });

  const studyUID = normalizeDicomUid(req.query.studyUID);
  const seriesUID = req.query.seriesUID === undefined ? '' : normalizeDicomUid(req.query.seriesUID);
  if (!studyUID || (req.query.seriesUID !== undefined && !seriesUID)) {
    return res.status(400).json({ ok: false, msg: 'Geçerli Study/Series UID gerekli.' });
  }

  const bases = dicomWebBases(target.host, target.port);
  for (const base of bases) {
    const url = seriesUID
      ? `${base}/studies/${studyUID}/series/${seriesUID}`
      : `${base}/studies/${studyUID}`;
    try {
      const data = await httpFetch(url, { Accept: 'application/json' }, 5000, MAX_QIDO_RESPONSE_BYTES);
      return res.json({ ok: true, url, data: data.substring(0, 1000) });
    } catch {
      // Try the next known DICOMweb base path.
    }
  }
  return res.json({ ok: false, msg: 'WADO-RS endpoint bulunamadı.' });
});

// The legacy arbitrary-URL proxy is disabled unless an operator explicitly allowlists PACS hosts.
// It is not used by the current viewer UI.
app.get('/api/pacs/image', (req, res) => {
  if (imageProxyHosts.size === 0) {
    return res.status(403).json({ ok: false, error: 'Görüntü proxy rotası varsayılan olarak kapalıdır.' });
  }

  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return res.status(400).send('Geçerli bir PACS URL gerekli.');
  }
  const hostname = normalizeHostname(target.hostname);
  if (!['http:', 'https:'].includes(target.protocol)
      || target.username
      || target.password
      || !imageProxyHosts.has(hostname)) {
    return res.status(403).json({ ok: false, error: 'URL izin verilen PACS sunucuları arasında değil.' });
  }

  const protocol = target.protocol === 'https:' ? https : http;
  const upstream = protocol.get(target, {
    headers: { Accept: 'application/octet-stream, application/dicom, */*' },
    timeout: 15000,
  }, remote => {
    const declaredLength = Number(remote.headers['content-length'] || 0);
    if (declaredLength > MAX_IMAGE_RESPONSE_BYTES) {
      remote.destroy();
      return res.status(413).send('PACS görüntüsü izin verilen boyutu aşıyor.');
    }
    if (remote.statusCode && remote.statusCode >= 400) {
      remote.resume();
      return res.status(502).send(`PACS yanıtı: HTTP ${remote.statusCode}`);
    }

    let received = 0;
    res.setHeader('Content-Type', remote.headers['content-type'] || 'application/octet-stream');
    remote.on('data', chunk => {
      received += chunk.length;
      if (received > MAX_IMAGE_RESPONSE_BYTES) {
        remote.unpipe(res);
        remote.destroy();
        if (!res.headersSent) res.status(413).send('PACS görüntüsü izin verilen boyutu aşıyor.');
        else res.destroy();
      }
    });
    remote.on('error', error => {
      if (!res.headersSent) res.status(502).send(safeErrorMessage(error));
      else res.destroy();
    });
    remote.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('PACS zaman aşımı.')));
  upstream.on('error', error => {
    if (!res.headersSent) res.status(502).send(safeErrorMessage(error));
    else res.destroy();
  });
});

// Keep parser and route errors structured; never return stack traces to the browser.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error && error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'İstek gövdesi izin verilen boyutu aşıyor.' });
  }
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Geçerli JSON gövdesi gerekli.' });
  }
  console.error(`[HTTP] ${safeErrorMessage(error)}`);
  return res.status(500).json({ error: 'Beklenmeyen sunucu hatası.' });
});

async function tryQIDO(host, port, filters) {
  const params = new URLSearchParams();
  if (filters.patientName) params.set('PatientName', filters.patientName.replace(/\*/g, '') + '*');
  if (filters.patientId) params.set('PatientID', filters.patientId);
  if (filters.accessionNumber) params.set('AccessionNumber', filters.accessionNumber);
  if (filters.dateFrom || filters.dateTo) {
    const dateFrom = filters.dateFrom.replace(/-/g, '');
    const dateTo = filters.dateTo.replace(/-/g, '');
    params.set('StudyDate', dateFrom && dateTo ? `${dateFrom}-${dateTo}` : (dateFrom || dateTo));
  }
  if (filters.modality) params.set('ModalitiesInStudy', filters.modality);
  params.set('limit', '100');
  params.set('includefield', 'all');

  let lastError;
  for (const base of dicomWebBases(host, port)) {
    try {
      const url = `${base}/studies?${params.toString()}`;
      const data = await httpFetch(url, { Accept: 'application/json' }, 5000, MAX_QIDO_RESPONSE_BYTES);
      const json = JSON.parse(data);
      if (Array.isArray(json) && json.length > 0) return json.map(mapQidoStudy);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw new Error(`QIDO-RS yanıt vermedi: ${safeErrorMessage(lastError)}`);
  return [];
}

function dicomWebBases(host, port) {
  const hostForUrl = net.isIP(host) === 6 ? `[${host}]` : host;
  const origin = `http://${hostForUrl}:${port}`;
  return [
    `${origin}/wado/rs`,
    `${origin}/dicomweb`,
    `${origin}/dcm4chee-arc/aets/DCM4CHEE/rs`,
    `${origin}/orthanc/dicom-web`,
    `${origin}/rs`,
  ];
}

function mapQidoStudy(study) {
  return {
    patientName: getTag(study, '00100010', 'Alphabetic') || 'Bilinmeyen',
    patientId: getTag(study, '00100020') || '',
    patientBirth: getTag(study, '00100030') || '',
    studyDate: formatDate(getTag(study, '00080020') || ''),
    modality: getTag(study, '00080060') || getTag(study, '00080061') || '',
    description: getTag(study, '00081030') || 'Çalışma',
    accession: getTag(study, '00080050') || '',
    numImages: Number.parseInt(getTag(study, '00201208') || '0', 10) || 0,
    studyUID: getTag(study, '0020000D') || '',
    seriesCount: Number.parseInt(getTag(study, '00201206') || '1', 10) || 1,
    source: 'qido-rs',
  };
}

function tcpPing(host, port, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Zaman aşımı')); });
    socket.once('error', reject);
    socket.connect(port, host);
  });
}

function httpFetch(rawUrl, headers = {}, timeout = 8000, maxBytes = MAX_QIDO_RESPONSE_BYTES) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new Error('Geçersiz URL'));
      return;
    }

    const protocol = url.protocol === 'https:' ? https : http;
    const chunks = [];
    let bytes = 0;
    const request = protocol.get(url, { headers, timeout }, response => {
      response.on('error', reject);
      if (response.statusCode && response.statusCode >= 400) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength > maxBytes) {
        response.destroy();
        reject(new Error('Sunucu yanıtı izin verilen boyutu aşıyor'));
        return;
      }
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new Error('Sunucu yanıtı izin verilen boyutu aşıyor'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Zaman aşımı')));
  });
}

function validateFindRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'JSON nesnesi gerekli.' };
  }

  const endpoint = validateEndpoint(body.serverIp, body.serverPort);
  if (!endpoint.ok) return endpoint;

  const serverAE = validateAETitle(body.serverAE || 'PACS');
  const clientAE = validateAETitle(body.clientAE || 'ATIKVIEWER');
  if (!serverAE || !clientAE) return { ok: false, error: 'AE Title en fazla 16 yazdırılabilir ASCII karakteri olmalıdır.' };

  const filters = {};
  for (const [name, maxLength] of Object.entries({
    patientName: 128,
    patientId: 64,
    accessionNumber: 64,
    dateFrom: 10,
    dateTo: 10,
    modality: 64,
  })) {
    const value = body[name] === undefined || body[name] === null ? '' : body[name];
    if (typeof value !== 'string' || value.length > maxLength) {
      return { ok: false, error: `${name} alanı geçersiz veya çok uzun.` };
    }
    filters[name] = value.trim();
  }

  if ((filters.dateFrom && !isIsoDate(filters.dateFrom)) || (filters.dateTo && !isIsoDate(filters.dateTo))) {
    return { ok: false, error: 'Tarih YYYY-AA-GG biçiminde olmalıdır.' };
  }
  const modalityParts = filters.modality.split(String.fromCharCode(92));
  if (filters.modality && (modalityParts.length > 16
      || modalityParts.some(value => !/^[A-Za-z0-9,_-]{1,10}$/.test(value)))) {
    return { ok: false, error: 'Modalite filtresi geçersiz.' };
  }

  return {
    ok: true,
    value: {
      serverIp: endpoint.host,
      serverPort: endpoint.port,
      serverAE,
      clientAE,
      filters,
    },
  };
}

function validateEndpoint(hostValue, portValue) {
  const host = normalizeTargetHost(hostValue);
  const port = normalizePort(portValue);
  if (!host) return { ok: false, error: 'PACS IP adresi/ana makine adı geçersiz.' };
  if (!port) return { ok: false, error: 'PACS portu 1–65535 arasında bir sayı olmalıdır.' };
  return { ok: true, host, port };
}

function normalizeTargetHost(value) {
  if (typeof value !== 'string') return '';
  let host = value.trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host || host.length > 253 || /[\s/@?#\\]/.test(host)) return '';
  if (net.isIP(host)) return host.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length > 253 || !host) return '';
  const labels = host.split('.');
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return '';
  return host.toLowerCase();
}

function normalizePort(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const text = String(value);
  if (!/^\d{1,5}$/.test(text)) return 0;
  const port = Number(text);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 0;
}

function normalizeDicomUid(value) {
  if (typeof value !== 'string') return '';
  const uid = value.trim();
  return uid.length <= 64 && /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*$/.test(uid) ? uid : '';
}

function validateAETitle(value) {
  if (typeof value !== 'string') return '';
  const aeTitle = value.trim();
  return aeTitle.length > 0 && aeTitle.length <= 16 && /^[\x20-\x7E]+$/.test(aeTitle) ? aeTitle : '';
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseCsv(value) {
  return typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
}

function normalizeHostname(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const hostHeader = value.trim();
  const forbidden = ['/', '@', '?', '#', '%', String.fromCharCode(92)];
  if (forbidden.some(character => hostHeader.includes(character))
      || Array.from(hostHeader).some(character => character.charCodeAt(0) <= 32)) return '';
  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (parsed.username || parsed.password) return '';
    const hostname = parsed.hostname.toLowerCase();
    return hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  } catch {
    return '';
  }
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin.toLowerCase();
  } catch {
    return '';
  }
}

function getTag(object, tag, subTag) {
  const entry = object && object[tag];
  if (!entry) return '';
  const value = entry.Value && entry.Value[0];
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && subTag) return value[subTag] || Object.values(value)[0] || '';
  return String(value);
}

function formatDate(value) {
  if (!value || value.length < 8) return value || '';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function safeErrorMessage(error) {
  return error && typeof error.message === 'string' ? error.message.slice(0, 300) : 'Bilinmeyen hata';
}

function parseListenPort(value) {
  const port = normalizePort(value);
  if (!port) throw new Error('PORT 1–65535 arasında bir sayı olmalıdır.');
  return port;
}

function startServer({ port = process.env.PORT || '3000', host = process.env.ATIK_HOST || '127.0.0.1' } = {}) {
  const listenPort = parseListenPort(port);
  const server = app.listen(listenPort, host, () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║   ATİK VİEWER — Yerel Proxy Sunucusu        ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║   Adres: http://${host}:${listenPort}`.padEnd(47) + '║');
    console.log('╚══════════════════════════════════════════════╝\n');
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
      console.warn('[GÜVENLİK] Sunucu yerel arayüz dışına açıldı. Kimlik doğrulama olmadan kurum ağına/İnternet’e sunmayın.');
    }
    if (imageProxyHosts.size === 0) {
      console.log('[GÜVENLİK] Eski serbest URL görüntü proxy rotası kapalı.');
    }
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { app, startServer, validateEndpoint, validateFindRequest, normalizeDicomUid };
