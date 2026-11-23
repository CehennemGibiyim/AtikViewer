/**
 * DICOMweb (QIDO-RS / WADO-RS) MOCK sunucusu — test ve yerel doğrulama için.
 *
 * Kullanım:
 *   node tests/mockPacsServer.cjs [port]     # varsayılan 8899
 *
 * Davranış:
 *  - Tüm uçlar HTTP Basic ister: kullanıcı `atik`, parola `atik123` → 401 döner.
 *  - GET /dicom-web/studies      → dicom+json liste; `limit` yoksa 400 (QIDO zorunluluğu)
 *  - PatientName=*yok*           → 204 No Content (boş sonuç)
 *  - OPTIONS /dicom-web          → 204 (yetenek sorgusu)
 *  - GET .../instances           → 2 örnek instance
 *  - GET .../instances/{sop}     → multipart/related (DICM imzalı gövde)
 *  - Diğer yollar                 → 404
 */
const http = require("node:http");

// Port 0 verilirse işletim sistemi boş bir port seçer; hazır satırında gerçek yazılır
// (paralel koşan testlerde 8899 çakışmasını önlemek için).
const PORT = Number(process.argv[2] ?? 8899);
const AUTH = "Basic " + Buffer.from("atik:atik123").toString("base64");

const STUDY = {
  "00080020": { Value: ["20261030"] },
  "00080061": { Value: ["CT", "SR"] },
  "00081030": { Value: ["BT BEYIN KONTRASTSUZ"] },
  "00100010": { Value: [{ Alphabetic: "YILMAZ^AHMET" }] },
  "00100020": { Value: ["P123456"] },
  "0020000D": { Value: ["1.2.840.113619.2.55.3.604688119.868.1699000000.1"] },
  "00201208": { Value: [2] },
};
const INSTANCES = [
  { "00080018": { Value: ["1.2.840.113619.2.55.3.604688119.868.1699000000.11"] }, "0020000E": { Value: ["1.2.3.4.5.6.7.1"] } },
  { "00080018": { Value: ["1.2.840.113619.2.55.3.604688119.868.1699000000.12"] }, "0020000E": { Value: ["1.2.3.4.5.6.7.1"] } },
];

/** DICM imzalı sahte Part-10 gövdesi (wado yanıtının gerçekten ayrıştığını doğrular). */
function dicomPart() {
  const head = Buffer.alloc(128, 0);
  const dicm = Buffer.from("DICM", "latin1");
  const rest = Buffer.from("MOCK-DICOM-PAYLOAD-FOR-TESTS", "latin1");
  return Buffer.concat([head, dicm, rest]);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = u.pathname;
  console.log(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { Allow: "GET, OPTIONS", "Access-Control-Allow-Methods": "GET, OPTIONS" });
    res.end();
    return;
  }
  if (req.headers.authorization !== AUTH) {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": 'Basic realm="pacs"' });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (path === "/dicom-web/studies") {
    if (!u.searchParams.has("limit")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "limit gerekli" }));
      return;
    }
    const name = u.searchParams.get("PatientName") || "";
    if (name.includes("yok")) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/dicom+json" });
    res.end(JSON.stringify([STUDY]));
    return;
  }

  let m = /^\/dicom-web\/studies\/([^/]+)\/instances$/.exec(path);
  if (m) {
    res.writeHead(200, { "Content-Type": "application/dicom+json" });
    res.end(JSON.stringify(INSTANCES));
    return;
  }

  m = /^\/dicom-web\/studies\/([^/]+)\/series\/([^/]+)\/instances\/([^/]+)$/.exec(path);
  if (m) {
    const boundary = "atikmockboundary";
    const part = dicomPart();
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/dicom\r\n\r\n`, "latin1"),
      part,
      Buffer.from(`\r\n--${boundary}--\r\n`, "latin1"),
    ]);
    res.writeHead(200, { "Content-Type": `multipart/related; type="application/dicom"; boundary=${boundary}` });
    res.end(payload);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  const actual = server.address().port;
  console.log(`mock-pacs-ready ${actual}`);
});
server.on("error", (e) => {
  console.error(`mock-pacs-error ${e.message}`);
  process.exit(1);
});
