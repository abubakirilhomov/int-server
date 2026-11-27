const zlib = require("zlib");
const { readDocxBlocks, documentXmlToBlocks } = require("../src/utils/questionBank/docxReader");
const { parseBank, validateBank } = require("../src/utils/questionBank/parseBank");
const { syntheticBlocks } = require("./helpers/syntheticBank");

// Минимальный zip-писатель для теста ридера (метод 8 = deflate).
function makeZip(name, content) {
  const data = Buffer.from(content, "utf8");
  const comp = zlib.deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, comp, central, nameBuf, eocd]);
}

const run = (text, mono) =>
  `<w:r><w:rPr>${mono ? '<w:rFonts w:ascii="Courier New"/>' : '<w:rFonts w:ascii="Arial"/>'}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

describe("docxReader", () => {
  test("zip → document.xml → абзацы, моно-код, заголовки, таблицы", () => {
    const xml = `<?xml version="1.0"?><w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run("HTML (1 ta)")}</w:p>
      <w:p>${run("H1. [oson · amaliy] Sintetik &lt;b&gt; savol")}</w:p>
      <w:p>${run("  &lt;div&gt;x&lt;/div&gt;", true)}</w:p>
      <w:tbl><w:tr><w:tc><w:p>${run("To&apos;plam")}</w:p></w:tc><w:tc><w:p>${run("H1, H2")}</w:p></w:tc></w:tr></w:tbl>
    </w:body></w:document>`;
    const blocks = readDocxBlocks(makeZip("word/document.xml", xml));
    expect(blocks[0]).toMatchObject({ type: "p", style: "Heading2", text: "HTML (1 ta)" });
    expect(blocks[1]).toMatchObject({ text: "H1. [oson · amaliy] Sintetik <b> savol", mono: false });
    expect(blocks[2]).toMatchObject({ text: "  <div>x</div>", mono: true });
    expect(blocks[3]).toEqual({ type: "table", rows: [["To'plam", "H1, H2"]] });
  });

  test("абзац со смешанными шрифтами — не код", () => {
    const [b] = documentXmlToBlocks(`<w:body><w:p>${run("a", true)}${run("b", false)}</w:p></w:body>`);
    expect(b.mono).toBe(false);
  });
});

describe("parseBank на синтетическом банке", () => {
  const parsed = parseBank(syntheticBlocks());

  test("вопросы: код, тема, треки, уровень, amaliy, mini, ответ отдельно от вопроса", () => {
    expect(parsed.questions).toHaveLength(12);
    const h2 = parsed.questions.find((q) => q.code === "H2");
    expect(h2).toMatchObject({ topic: "html", level: "orta", isPractical: true, answerKind: "code" });
    expect(h2.tracks).toEqual(["frontend-react", "frontend-vue"]);
    expect(h2.prompt).toContain("```html\n<div>\n  <p>x</p>\n</div>\n```");
    expect(h2.prompt).not.toContain("Sintetik javob");
    expect(h2.expectedAnswer).toBe("Sintetik javob H2.");
    expect(parsed.questions.find((q) => q.code === "J1").isMiniTask).toBe(true);
    expect(parsed.questions.find((q) => q.code === "R1").tracks).toEqual(["frontend-react"]);
    expect(parsed.questions.find((q) => q.code === "T1").tracks).toEqual(["frontend-vue"]);
  });

  test("наборы: подробные таблицы и сводная, по трекам", () => {
    const react = parsed.sets.filter((s) => s.track === "frontend-react");
    expect(react.map((s) => s.number)).toEqual([1, 2]);
    expect(react[0].questionCodes).toEqual(["H1", "C1", "J1", "J2", "R1", "R2"]);
    expect(react[1].questionCodes).toEqual(["H2", "C2", "J1", "J2", "R1", "R2"]);
    expect(parsed.sets.filter((s) => s.track === "frontend-vue")).toHaveLength(1);
    expect(parsed.questions.find((q) => q.code === "C1").promptShort).toBe("Sintetik CSS qisqa");
  });

  test("правила: квоты, уровни, минимум amaliy, conflict-группы", () => {
    expect(parsed.rules.quotas["frontend-vue"][6][0]).toEqual({ topics: ["html", "css"], count: 1 });
    expect(parsed.rules.levels[18]).toEqual({ oson: 4, orta: 9, qiyin: 5 });
    expect(parsed.rules.minPractical).toBe(2);
    expect(parsed.rules.conflictGroups).toEqual([["C2", "T2"], ["J2", "V2"]]);
    expect(parsed.questions.find((q) => q.code === "T2").conflictGroup).toBe("g1");
  });

  test("валидатор: чистый банк без ошибок; заявленные количества сходятся", () => {
    const v = validateBank(parsed);
    expect(v.errors).toEqual([]);
    expect(parsed.declaredCounts).toEqual({ html: 2, css: 2, js: 2, react: 2, vue: 2, tailwind: 2 });
  });

  test("валидатор: набор с несуществующим вопросом — ошибка", () => {
    const v = validateBank(parseBank(syntheticBlocks({ brokenSet: true })));
    expect(v.errors.join("\n")).toMatch(/нет в банке R9/);
  });

  test("валидатор: два вопроса одной conflict-группы — предупреждение", () => {
    const v = validateBank(parsed); // набор react #2 содержит C2 и J2 — разные группы, нет
    expect(v.warnings.some((w) => /conflict/.test(w))).toBe(false);
    const p2 = parseBank(syntheticBlocks());
    p2.sets[0].questionCodes = ["H1", "C2", "J1", "J2", "R1", "R2"];
    p2.questions.find((q) => q.code === "J2").conflictGroup = "g1";
    expect(validateBank(p2).warnings.some((w) => /conflict/.test(w))).toBe(true);
  });

  test("contentHash стабилен и меняется при правке текста", () => {
    const again = parseBank(syntheticBlocks());
    expect(again.questions[0].contentHash).toBe(parsed.questions[0].contentHash);
    const blocks = syntheticBlocks();
    const idx = blocks.findIndex((b) => /^H1\./.test(b.text || ""));
    blocks[idx] = { ...blocks[idx], text: blocks[idx].text + " (o'zgardi)" };
    expect(parseBank(blocks).questions[0].contentHash).not.toBe(parsed.questions[0].contentHash);
  });
});
