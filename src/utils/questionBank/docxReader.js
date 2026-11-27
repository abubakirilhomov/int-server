// Минимальное чтение .docx без зависимостей: zip (central directory +
// inflateRaw) → word/document.xml → блоки «абзац» и «таблица».
// Нужен только скрипту импорта банка вопросов.
const zlib = require("zlib");

function readZipEntry(buf, wanted) {
  // End of central directory: сигнатура 0x06054b50, ищем с конца.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Не zip/docx: нет End of Central Directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Битый central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error(`Неподдерживаемый метод сжатия ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`В архиве нет ${wanted}`);
}

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });

// <w:p>…</w:p> → { type:"p", text, mono, style }.
// mono = все текстовые фрагменты абзаца набраны моноширинным шрифтом (код).
function parseParagraph(xml) {
  const style = (xml.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || null;
  let text = "";
  let runs = 0;
  let monoRuns = 0;
  const runRe = /<w:r[ >][\s\S]*?<\/w:r>/g;
  let m;
  while ((m = runRe.exec(xml))) {
    const run = m[0];
    const parts = [];
    const tRe = /<w:(t|tab|br)(?: [^>]*)?(?:\/>|>([\s\S]*?)<\/w:t>)/g;
    let t;
    while ((t = tRe.exec(run))) {
      if (t[1] === "t") parts.push(decode(t[2] || ""));
      else if (t[1] === "tab") parts.push("\t");
      else parts.push("\n");
    }
    const runText = parts.join("");
    if (!runText) continue;
    text += runText;
    if (runText.trim()) {
      runs += 1;
      if (/w:rFonts[^>]*(Courier|Consolas|Mono|Menlo)/i.test(run)) monoRuns += 1;
    }
  }
  return { type: "p", text, style, mono: runs > 0 && monoRuns === runs };
}

// <w:tbl> → { type:"table", rows: [[cellText, …], …] } (абзацы ячейки через \n).
function parseTable(xml) {
  const rows = [];
  const rowRe = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
  let r;
  while ((r = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<w:tc[ >][\s\S]*?<\/w:tc>/g;
    let c;
    while ((c = cellRe.exec(r[0]))) {
      const paras = c[0].match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
      cells.push(paras.map((p) => parseParagraph(p).text).join("\n").trim());
    }
    rows.push(cells);
  }
  return { type: "table", rows };
}

// document.xml → плоский список блоков верхнего уровня в порядке документа.
function documentXmlToBlocks(xml) {
  const body = xml.slice(xml.indexOf("<w:body"));
  const blocks = [];
  const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  let m;
  while ((m = re.exec(body))) {
    const chunk = m[0];
    if (chunk.startsWith("<w:tbl>")) blocks.push(parseTable(chunk));
    else if (chunk === "<w:p/>") blocks.push({ type: "p", text: "", style: null, mono: false });
    else blocks.push(parseParagraph(chunk));
  }
  return blocks;
}

function readDocxBlocks(buffer) {
  const xml = readZipEntry(buffer, "word/document.xml").toString("utf8");
  return documentXmlToBlocks(xml);
}

module.exports = { readZipEntry, documentXmlToBlocks, readDocxBlocks, parseParagraph };
