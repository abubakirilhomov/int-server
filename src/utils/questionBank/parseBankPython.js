// Блоки docx (docxReader) → Python-банк: вопросы, наборы и правило трека.
// Формат «mars-intern-savollar-python» (27.11.2026). Отличия от JS-банка:
//  • ID с модулем: «M3-05. [oson · amaliy] …» (тема = модуль курса);
//  • раздел 4 — пройденные модули, раздел 5 — «qisman / hali o'tilmagan»: эти
//    вопросы импортируются неактивными (notCovered — «ещё не пройдено»), в наборы
//    и генератор не попадают, в редакторе банка их можно включить;
//  • M10: метка подтемы в начале вопроса («[auth] …») → поле subtopic;
//  • правило набора — квоты по модулям (таблица «Modul | 15 savol | 18 savol | 20 savol»),
//    amaliy «6 (20 savolda — 7)» + мини-задание, порядок M3 → M9, conflict-группы
//    (вопрос может быть в нескольких), HTML/CSS из JS-банка (extras).
//  • код в одном вопросе бывает Python, SQL и шаблоном Django — язык ```-блока
//    определяется по содержимому.
// Содержимое банка в репозитории не хранится — тесты используют синтетические блоки.
const crypto = require("crypto");
const { checkComposition, trackRules } = require("./trackRules");
const { groupIdsByCode } = require("./conflicts");
const { APOS, BP, defOfCode, PY_CODE_PATTERN } = require("../../config/questionBankTopics");

const Q_HEADER_RE = new RegExp(
  `^M(\\d{1,2})-(\\d{2})\\.\\s*\\[\\s*(oson|o${APOS}rta|qiyin)\\s*(?:·\\s*(amaliy))?\\s*\\]\\s*(?:\\[([a-z][a-z/_ -]{1,30})\\]\\s*)?([\\s\\S]*)$`,
  "i"
);
const ANSWER_RE = /^Javob\s*\(chernovik\)\s*:\s*/i;
const PY_CODE_RE = new RegExp(`\\b${PY_CODE_PATTERN}\\b`, "g");
const PY_CODE_EXACT = new RegExp(`^${PY_CODE_PATTERN}$`);
const JS_EXTRA_RE = /\b[HC]\d{1,2}\b/g;

const normLevel = (s) => (/^o.rta$/i.test(s) ? "orta" : s.toLowerCase());
const isHeading = (b) => b.type === "p" && /^Heading/i.test(b.style || "");
const sha = (obj) => crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
const NBSP = / /g;

// Язык ```-блока по содержимому: SQL, шаблон Django (html) или Python.
const SQL_START = /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|BEGIN|COMMIT|ROLLBACK|EXPLAIN|TRUNCATE|GRANT)\b/; // регистр важен: «with open(…)» — Python
function codeLang(lines) {
  const first = lines.map((l) => l.trim()).find((l) => l && !l.startsWith("--") && !l.startsWith("#"));
  if (!first) return "python";
  if (SQL_START.test(first)) return "sql";
  if (/^(<|\{%|\{\{)/.test(first)) return "html";
  return "python";
}

// Абзацы → markdown. Пустой абзац между строками кода — пустая строка кода
// (в файле код разбит на абзацы, пустая строка между функциями — пустой абзац).
function toMarkdown(parts) {
  const out = [];
  const blocks = [];
  let code = null;
  let pendingBlank = 0;
  const closeCode = () => {
    if (!code) return;
    const lang = codeLang(code);
    blocks.push(lang);
    out.push("```" + lang + "\n" + code.join("\n") + "\n```");
    code = null;
  };
  for (const p of parts) {
    if (p.mono) {
      if (!code) code = [];
      else for (; pendingBlank > 0; pendingBlank -= 1) code.push("");
      pendingBlank = 0;
      code.push(p.text.replace(/\s+$/, ""));
      continue;
    }
    if (!p.text.trim()) { if (code) pendingBlank += 1; continue; }
    pendingBlank = 0;
    closeCode();
    out.push(p.text.trim());
  }
  closeCode();
  return { text: out.join("\n\n"), blocks };
}

// Редактор ответа на amaliy: sql / html, если весь код вопроса (или, если его нет, ответа) — SQL / шаблон;
// без кода — по модулю (M7 → sql); иначе python. Python и SQL в браузере не исполняются.
function editorOf(module, promptBlocks, answerBlocks) {
  const blocks = promptBlocks.length ? promptBlocks : answerBlocks;
  if (blocks.length) {
    if (blocks.every((b) => b === "sql")) return "sql";
    if (blocks.every((b) => b === "html")) return "html"; // шаблон Django — подсветка HTML
    return "python";
  }
  return module === 7 ? "sql" : "python";
}

function parseModuleTable(rows) {
  const header = rows[0] || [];
  const sizes = header.slice(1).map((h) => parseInt(h, 10)).filter((n) => Number.isFinite(n));
  const quotas = {};
  sizes.forEach((s) => { quotas[s] = []; });
  for (const row of rows.slice(1)) {
    const m = String(row[0] || "").trim().match(/^M(\d{1,2})\b/);
    if (!m) continue;
    const def = defOfCode(`M${m[1]}-01`);
    if (!def) continue;
    sizes.forEach((size, i) => {
      const n = parseInt(row[i + 1], 10);
      if (Number.isFinite(n) && n > 0) quotas[size].push({ topics: [def.topic], count: n });
    });
  }
  return quotas;
}

function parsePythonBank(blocks) {
  const questions = [];
  const sets = [];
  const warnings = [];
  const declaredCounts = {};
  const shortByCode = {};
  const rules = {
    levels: {}, minPractical: null, minPracticalBySize: {}, requireMiniTask: null,
    quotas: {}, conflictGroups: [], extras: null, order: null,
  };
  const extras = { codes: [], exclude: [], max: null, maxTotal: null };

  let section = 0; // номер раздела по Heading1 «N. …»
  let pendingSet = null;
  let compactNext = false;
  let current = null;

  const flush = () => {
    if (!current) return;
    const def = defOfCode(current.code);
    const prompt = toMarkdown(current.promptParts);
    const answer = toMarkdown(current.answerParts);
    questions.push({
      code: current.code,
      topic: def.topic,
      tracks: def.tracks,
      module: current.module,
      order: current.order,
      level: current.level,
      isPractical: current.isPractical,
      isMiniTask: /^mini-topshiriq/i.test(current.headerText),
      subtopic: current.subtopic,
      notCovered: current.notCovered,
      prompt: prompt.text,
      expectedAnswer: answer.text,
      editor: current.isPractical ? editorOf(current.module, prompt.blocks, answer.blocks) : null,
    });
    if (!answer.text) warnings.push(`${current.code}: нет «Javob (chernovik)»`);
    current = null;
  };

  for (const b of blocks) {
    if (b.type === "table") {
      flush();
      const head = (b.rows[0] || []).map((c) => c.trim());
      if (pendingSet && head[1] === "ID") {
        const codes = [];
        for (const row of b.rows.slice(1)) {
          const code = String(row[1] || "").trim();
          if (!PY_CODE_EXACT.test(code)) continue;
          codes.push(code);
          if (row[3] && !shortByCode[code]) shortByCode[code] = row[3].replace(/\s+/g, " ").trim();
        }
        sets.push({ track: BP, number: pendingSet, questionCodes: codes });
        pendingSet = null;
      } else if (compactNext && /^to.plam$/i.test(head[0] || "")) {
        for (const row of b.rows.slice(1)) {
          const number = parseInt(row[0], 10);
          if (!Number.isFinite(number)) continue;
          sets.push({ track: BP, number, questionCodes: row.slice(1).join(" ").match(PY_CODE_RE) || [] });
        }
        compactNext = false;
      } else if (/^modul$/i.test(head[0] || "") && head.some((h) => /^\d+\s*savol$/i.test(h))) {
        rules.quotas = parseModuleTable(b.rows);
      } else if (/^to.plam$/i.test(head[0] || "") && head.includes("Nomzod")) {
        const filled = b.rows.slice(1).filter((r) => r.slice(1).some((c) => c.trim()));
        if (filled.length) warnings.push(`Таблица «Kim qaysi to'plamni oldi» заполнена: ${filled.length} строк — не импортируется`);
      }
      continue;
    }

    const text = (b.text || "").replace(NBSP, " ");
    const trimmed = text.trim();

    if (isHeading(b)) {
      flush();
      if (b.style === "Heading1") {
        const sm = trimmed.match(/^(\d+)\./);
        section = sm ? parseInt(sm[1], 10) : 0;
      }
      const setM = trimmed.match(/^(\d+)-to.plam$/i);
      if (setM && section === 3) pendingSet = parseInt(setM[1], 10);
      if (/^\d+\s*[–-]\s*\d+-to.plamlar/i.test(trimmed) && section === 3) compactNext = true;
      const cnt = trimmed.match(/^M(\d{1,2})\s*·.*\((\d+)\s*ta\)\s*$/i);
      if (cnt) {
        const def = defOfCode(`M${cnt[1]}-01`);
        if (def) declaredCounts[def.topic] = parseInt(cnt[2], 10);
      }
      continue;
    }

    if (!current && section === 2) {
      const lv = trimmed.match(/^-?\s*Daraja:\s*18 savolda (\d+) oson.*?\+\s*(\d+) o.rta\s*\+\s*(\d+) qiyin;\s*15 savolda (\d+)\s*\+\s*(\d+)\s*\+\s*(\d+);\s*20 savolda (\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)/i);
      if (lv) {
        const n = lv.slice(1).map(Number);
        rules.levels = {
          18: { oson: n[0], orta: n[1], qiyin: n[2] },
          15: { oson: n[3], orta: n[4], qiyin: n[5] },
          20: { oson: n[6], orta: n[7], qiyin: n[8] },
        };
      }
      const pr = trimmed.match(/^Kamida (\d+) ta amaliy/i);
      if (pr && rules.minPractical == null) {
        rules.minPractical = parseInt(pr[1], 10);
        const by = trimmed.match(/\((\d+) savolda\s*[—–-]\s*(\d+)\)/);
        if (by) rules.minPracticalBySize[parseInt(by[1], 10)] = parseInt(by[2], 10);
        if (/mini-topshiriq/i.test(trimmed)) rules.requireMiniTask = true;
      }
      if (/^Tartib:\s*modul bo.yicha/i.test(trimmed) && /osondan qiyinga/i.test(trimmed)) rules.order = "module-level";
      if (/Bir xil g.oyani tekshiradigan savollar/i.test(trimmed)) {
        const body = trimmed.split(":").slice(1).join(":");
        for (const seg of body.split(";")) {
          const codes = seg.replace(/\([^)]*\)/g, "").match(PY_CODE_RE) || [];
          if (codes.length > 1) rules.conflictGroups.push([...new Set(codes)]);
        }
      }
      // HTML/CSS (1–2-modullar): из JS-банка, «ko'pi bilan 1–2 ta …, jami 20 dan oshmasin».
      const mx = trimmed.match(/ko.pi bilan\s*(\d+)\s*[–-]\s*(\d+)\s*ta savol/i);
      if (mx) extras.max = parseInt(mx[2], 10);
      const tot = trimmed.match(/jami\s*(\d+)\s*dan oshmasin/i);
      if (tot && /HTML\/CSS/i.test(trimmed)) extras.maxTotal = parseInt(tot[1], 10);
      if (/^Python yo.nalishiga mos/i.test(trimmed)) {
        extras.codes = [...new Set(trimmed.split(":").slice(1).join(":").replace(/\([^)]*\)/g, "").match(JS_EXTRA_RE) || [])];
      }
      if (/^Ishlatmang:/i.test(trimmed)) {
        extras.exclude = [...new Set(trimmed.replace(/\([^)]*\)/g, "").match(JS_EXTRA_RE) || [])];
      }
    }

    const qm = b.mono ? null : trimmed.match(Q_HEADER_RE);
    if (qm) {
      flush();
      const module = parseInt(qm[1], 10);
      const header = qm[6].trim();
      current = {
        code: `M${module}-${qm[2]}`,
        module,
        order: parseInt(qm[2], 10),
        level: normLevel(qm[3]),
        isPractical: Boolean(qm[4]),
        subtopic: qm[5] ? qm[5].trim() : null,
        notCovered: section === 5,
        headerText: header,
        promptParts: [{ text: header, mono: false }],
        answerParts: [],
        inAnswer: false,
      };
      continue;
    }
    if (!current) continue;
    if (!b.mono && ANSWER_RE.test(trimmed)) {
      current.inAnswer = true;
      const rest = trimmed.replace(ANSWER_RE, "");
      if (rest) current.answerParts.push({ text: rest, mono: false });
      continue;
    }
    (current.inAnswer ? current.answerParts : current.promptParts).push({ text, mono: b.mono });
  }
  flush();

  if (extras.codes.length) {
    rules.extras = { codes: extras.codes, exclude: extras.exclude, max: extras.max ?? 2, maxTotal: extras.maxTotal ?? 20 };
  }

  const groupOf = groupIdsByCode(rules.conflictGroups, "p");
  for (const q of questions) {
    const first = q.prompt.split("\n")[0];
    q.promptShort = shortByCode[q.code] || (first.length > 140 ? first.slice(0, 137) + "…" : first);
    q.answerKind = q.isPractical ? "code" : "text";
    q.conflictGroup = groupOf[q.code] || null;
    q.isActive = !q.notCovered;
    q.contentHash = sha({
      topic: q.topic, tracks: q.tracks, level: q.level, isPractical: q.isPractical, isMiniTask: q.isMiniTask,
      prompt: q.prompt, promptShort: q.promptShort, expectedAnswer: q.expectedAnswer,
      answerKind: q.answerKind, conflictGroup: q.conflictGroup, editor: q.editor, subtopic: q.subtopic,
      notCovered: q.notCovered,
    });
  }
  for (const s of sets) {
    s.size = s.questionCodes.length;
    s.contentHash = sha({ track: s.track, number: s.number, questionCodes: s.questionCodes });
  }
  return { format: "python", track: BP, questions, sets, rules, declaredCounts, warnings };
}

// Проверка: errors — импорт нельзя; warnings — показать и продолжить.
// jsBank — вопросы JS-банка из БД ({code, topic, tracks, level, isActive}) для extras;
// без него extras проверяются только на формат кода.
function validatePythonBank(parsed, { jsBank = null } = {}) {
  const errors = [];
  const warnings = [...(parsed.warnings || [])];
  const byCode = new Map();
  for (const q of parsed.questions) {
    if (byCode.has(q.code)) errors.push(`Дубль кода ${q.code}`);
    byCode.set(q.code, q);
  }
  const counts = {};
  parsed.questions.forEach((q) => { counts[q.topic] = (counts[q.topic] || 0) + 1; });
  for (const [topic, n] of Object.entries(parsed.declaredCounts || {})) {
    if (counts[topic] !== n) errors.push(`Модуль ${topic}: в заголовке ${n}, распознано ${counts[topic] || 0}`);
  }
  for (const g of parsed.rules.conflictGroups) {
    const unknown = g.filter((c) => !byCode.has(c));
    if (unknown.length) errors.push(`conflict-группа ${g.join(",")}: нет в банке ${unknown.join(", ")}`);
  }
  const r = parsed.rules;
  if (!Object.keys(r.levels || {}).length) errors.push("правило: нет состава по уровням");
  const quotaSizes = Object.keys(r.quotas || {}).map(Number);
  if (!quotaSizes.length) errors.push("правило: нет таблицы квот по модулям");
  for (const size of quotaSizes) {
    const sum = r.quotas[size].reduce((a, g) => a + g.count, 0);
    if (sum !== size) errors.push(`правило: квоты модулей для ${size} — сумма ${sum}`);
  }
  if (r.minPractical == null) errors.push("правило: нет минимума amaliy");
  if (jsBank && r.extras) {
    const js = new Map(jsBank.map((q) => [q.code, q]));
    const missing = r.extras.codes.filter((c) => !js.has(c) || js.get(c).isActive === false);
    if (missing.length) warnings.push(`HTML/CSS из JS-банка не найдены или в архиве: ${missing.join(", ")}`);
  }

  const tr = trackRules({ tracks: { [parsed.track]: r } }, parsed.track);
  const seen = new Set();
  for (const s of parsed.sets) {
    const id = `${s.track} #${s.number}`;
    if (seen.has(id)) errors.push(`Дубль набора ${id}`);
    seen.add(id);
    const missing = s.questionCodes.filter((c) => !byCode.has(c));
    if (missing.length) { errors.push(`${id}: нет в банке ${missing.join(", ")}`); continue; }
    if (new Set(s.questionCodes).size !== s.questionCodes.length) errors.push(`${id}: повтор вопроса в наборе`);
    const qs = s.questionCodes.map((c) => byCode.get(c));
    const off = qs.filter((q) => !q.isActive).map((q) => q.code);
    if (off.length) errors.push(`${id}: вопросы из ещё не пройденных модулей ${off.join(", ")}`);
    const c = checkComposition(qs, tr);
    c.block.forEach((m) => errors.push(`${id}: ${m}`));
    // Готовые наборы обязаны соблюдать правило целиком. Исключение — мини-задание:
    // в файле правило есть (§2), но готовые наборы по нему не составлялись (§1, §3
    // заявляют только модули, уровни и amaliy) — показываем, импорт не останавливаем.
    c.warn.forEach((m, i) => (c.warnKinds[i] === "mini" ? warnings : errors).push(`${id}: ${m}`));
  }
  return { errors, warnings };
}

// Формат файла: Python-банк узнаётся по ID «M3-05.» в заголовках вопросов.
function isPythonBank(blocks) {
  return blocks.some((b) => b.type === "p" && !b.mono && Q_HEADER_RE.test(String(b.text || "").replace(NBSP, " ").trim()));
}

module.exports = { parsePythonBank, validatePythonBank, isPythonBank, toMarkdown, codeLang, editorOf };
