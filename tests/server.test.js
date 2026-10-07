'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, describe, it } = require('node:test');
const { app, validateFindRequest } = require('../server.js');

describe('ATİK VİEWER yerel HTTP sunucusu', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  });

  it('ana sayfada mevcut görüntüleyiciyi sunar ve Three.js yerel dosyasına başvurur', async () => {
    const response = await fetch(baseUrl);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /ATİK VİEWER/i);
    assert.match(html, /\.\/vendor\/three-r128\.min\.js/);
    assert.doesNotMatch(html, /cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js/);
  });

  it('mevcut görsel kullanım kılavuzunu sentetik örneklerle sunar', async () => {
    const response = await fetch(`${baseUrl}/index.html`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Kurulum ve Kullanım Kılavuzu/);
    assert.match(html, /DEMO-0001/);
  });

  it('resimli mimari kılavuzu yerel sunucudan sunar', async () => {
    const response = await fetch(`${baseUrl}/docs/visuals/local-ai-safety-architecture.svg`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /önerilen yerel AI ve Human-in-the-Loop/);
  });

  it('sabitlenmiş Three.js dosyasını yerelden sunar', async () => {
    const response = await fetch(`${baseUrl}/vendor/three-r128.min.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript|text\/plain/i);
    assert.match(await response.text(), /three\.js|THREE/);
  });

  it('kaynak kodu ve yapılandırma dosyalarını statik olarak dışarı açmaz', async () => {
    for (const file of ['server.js', 'dicom-cfind.js', 'package.json', 'README.md']) {
      const response = await fetch(`${baseUrl}/${file}`);
      assert.equal(response.status, 404, `${file} should not be publicly served`);
    }
  });

  it('hasta verisi içermeyen health yanıtı döndürür', async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.version, require('../package.json').version);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('tanımlanmamış bir web kaynağından API çağrısını reddeder', async () => {
    const response = await fetch(`${baseUrl}/api/pacs/find`, {
      method: 'POST',
      headers: {
        Origin: 'https://untrusted.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
  });

  it('beklenmeyen Host başlığıyla gelen isteği reddeder', async () => {
    const response = await new Promise((resolve, reject) => {
      const request = http.get(`${baseUrl}/api/health`, {
        headers: { Host: 'untrusted.example' },
      }, resolve);
      request.once('error', reject);
    });
    response.resume();
    assert.equal(response.statusCode, 421);
  });

  it('geçerli tarih aralığı ve DICOM çoklu-modalite filtresini kabul eder', () => {
    const modalitySeparator = String.fromCharCode(92);
    const result = validateFindRequest({
      serverIp: '127.0.0.1',
      serverPort: '11112',
      serverAE: 'PACS',
      clientAE: 'ATIKVIEWER',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-07',
      modality: `CT${modalitySeparator}MR`,
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.filters.modality, `CT${modalitySeparator}MR`);
  });

  it('yerel sentetik QIDO-RS yanıtını doğru eşler ve tarih/modalite filtrelerini yollar', async () => {
    let requestedPath = '';
    const mockPacs = http.createServer((request, response) => {
      requestedPath = request.url;
      if (!request.url.startsWith('/wado/rs/studies?')) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify([{
        '00100010': { Value: [{ Alphabetic: 'DEMO^HASTA001' }] },
        '00100020': { Value: ['DEMO-0001'] },
        '00100030': { Value: ['19700101'] },
        '00080020': { Value: ['20000101'] },
        '00080060': { Value: ['CT'] },
        '00081030': { Value: ['SENTETİK BT'] },
        '00080050': { Value: ['DEMO-ACC-01'] },
        '00201208': { Value: ['42'] },
        '0020000D': { Value: ['1.2.3.4'] },
        '00201206': { Value: ['1'] },
      }]));
    });
    mockPacs.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      mockPacs.once('listening', resolve);
      mockPacs.once('error', reject);
    });

    try {
      const modalitySeparator = String.fromCharCode(92);
      const response = await fetch(`${baseUrl}/api/pacs/find`, {
        method: 'POST',
        headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverIp: '127.0.0.1',
          serverPort: String(mockPacs.address().port),
          serverAE: 'DEMO_PACS',
          clientAE: 'ATIKVIEWER',
          patientName: 'ornek*',
          dateFrom: '2026-10-01',
          dateTo: '2026-10-07',
          modality: `CT${modalitySeparator}MR`,
        }),
      });
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.method, 'qido-rs');
      assert.equal(body.results[0].patientId, 'DEMO-0001');
      assert.equal(body.results[0].numImages, 42);
      assert.match(requestedPath, /StudyDate=20261001-20261007/);
      assert.match(requestedPath, /ModalitiesInStudy=CT%5CMR/);
    } finally {
      mockPacs.closeAllConnections?.();
      await new Promise(resolve => mockPacs.close(resolve));
    }
  });

  it('geçersiz PACS adresini ağa bağlanmadan reddeder', async () => {
    const response = await fetch(`${baseUrl}/api/pacs/echo?ip=127.0.0.1&port=0`);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.method, 'tcp');
  });

  it('geçersiz DICOM UID biçimini WADO isteğinde reddeder', async () => {
    const response = await fetch(`${baseUrl}/api/pacs/wado?serverIp=127.0.0.1&serverPort=11112&studyUID=not-a-uid`);
    assert.equal(response.status, 400);
  });

  it('serbest URL görüntü proxy rotasını varsayılan durumda kapalı tutar', async () => {
    const response = await fetch(`${baseUrl}/api/pacs/image?url=http%3A%2F%2F127.0.0.1%2F`);
    assert.equal(response.status, 403);
  });

  it('aynı kaynaktan gelen hatalı JSON gövdesini güvenli biçimde reddeder', async () => {
    const response = await fetch(`${baseUrl}/api/pacs/find`, {
      method: 'POST',
      headers: {
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: '{invalid-json',
    });
    assert.equal(response.status, 400);
    assert.match(response.headers.get('content-type'), /application\/json/i);
  });
});
