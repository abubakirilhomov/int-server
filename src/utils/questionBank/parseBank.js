// Блоки docx (docxReader) → банк вопросов, наборы и правила составления.
// Формат файла: «mars-intern-savollar-bank» (27.11.2026). Само содержимое
// банка в репозитории не хранится — тесты используют синтетические блоки.
const crypto = require("crypto");

const PREFIX = {
  H: { topic: "html", tracks: ["frontend-react", "frontend-vue"] },
  C: { topic: "css", tracks: ["frontend-react", "frontend-vue"] },
  J: { topic: "js", tracks: ["frontend-react", "frontend-vue"] },
  R: { topic: "react", tracks: ["frontend-react"] },
  V: { topic: "vue", tracks: ["frontend-vue"] },
  T: { topic: "tailwind", tracks: ["frontend-vue"] },
};
const CODE_LANG = { H: "html", C: "css", J: "js", R: "jsx", V: "vue", T: "html" };

const APOS = "['’ʻ`]";
const LEVEL_RE = new RegExp(`^(oson|o${APOS}rta|qiyin)$`, "i");
const Q_HEADER_RE = new RegExp(
  `^([HCJRVT])(\\d{1,3})\\.\\s*\\[\\s*(oson|o${APOS}rta|qiyin)\\s*(?:·\\s*(amaliy))?\\s*\\]\\s*([\\s\\S]*)$`,
  "i"
);
const ANSWER_RE = /^Javob\s*\(chernovik\)\s*:\s*/i;
const CODE_RE = /\b[HCJRVT]\d{1,3}\b/g;

const normLevel = (s) => (/^o.rta$/i.test(s) ? "orta" : s.toLowerCase());
const isHeading = (b) => b.type === "p" && /^Heading/i.test(b.style || "");
const sha = (obj) => crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");

// Абзацы (текст / моно-код) → markdown; подряд идущие строки кода — один ```-блок.
function toMarkdown(parts, lang) {
  const out = [];
  let code = null;
  for (const p of parts) {
    if (p.mono) {
      if (!code) code = [];
      code.push(p.text.replace(/\s+$/, ""));
      continue;
    }
    if (code) { out.push("```" + lang + "\n" + code.join("\n") + "\n```"); code = null; }
    if (p.text.trim()) out.push(p.text.trim());
  }
  if (code) out.push("```" + lang + "\n" + code.join("\n") + "\n```");
  return out.join("\n\n");
}

function trackOfSection(text) {
  if (/1-yo.nalish/i.test(text)) return "frontend-react";
  if (/2-yo.nalish/i.test(text)) return "frontend-vue";
  return null;
}

// Таблица правила раздела 2: Mavzu | 15 | 18 | 20 | Bankda.
const TOPIC_LABELS = [
  [/^html\s*\+\s*css$/i, ["html", "css"]],
  [/^html$/i, ["html"]],
  [/^css$/i, ["css"]],
  [/^javascript$/i, ["js"]],
  [/^react$/i, ["react"]],
  [/^vue$/i, ["vue"]],
  [/^tailwind/i, ["tailwind"]],
];
function parseQuotaTable(rows) {
  const header = rows[0] || [];
  const sizes = header.slice(1).map((h) => parseInt(h, 10)).filter((n) => Number.isFinite(n));
  const quotas = {};
  for (const size of sizes) quotas[size] = [];
  for (const row of rows.slice(1)) {
    const label = String(row[0] || "").trim();
    if (/^jami$/i.test(label)) continue;
    const match = TOPIC_LABELS.find(([re]) => re.test(label));
    if (!match) continue;
    sizes.forEach((size, i) => {
      const n = parseInt(row[i + 1], 10);
      if (Number.isFinite(n)) quotas[size].push({ topics: match[1], count: n });
    });
  }
  return quotas;
}

function parseBank(blocks) {
  const questions = [];
  const sets = [];
  const warnings = [];
  const shortByCode = {};
  const declaredCounts = {}; // «HTML (8 ta)» → { html: 8 }
  const rules = { quotas: {}, levels: {}, minPractical: null, conflictGroups: [] };

  let sectionTrack = null; // текущий раздел «Tayyor to'plamlar — N-yo'nalish»
  let pendingSet = null; // «N-to'plam» → ждём таблицу
  let compactNext = false; // «6–15-to'plamlar (qisqa)» → ждём таблицу
  let quotaTrack = null; // заголовки «1-yo'nalish …» внутри раздела 2
  let current = null; // текущий вопрос

  const flush = () => {
    if (!current) return;
    const prefix = current.code[0];
    const prompt = toMarkdown(current.promptParts, CODE_LANG[prefix]);
    const expectedAnswer = toMarkdown(current.answerParts, CODE_LANG[prefix]);
    questions.push({
      code: current.code,
      topic: PREFIX[prefix].topic,
      tracks: PREFIX[prefix].tracks,
      order: current.order,
      level: current.level,
      isPractical: current.isPractical,
      isMiniTask: /^mini-topshiriq/i.test(current.headerText),
      prompt,
      expectedAnswer,
    });
    if (!expectedAnswer) warnings.push(`${current.code}: нет «Javob (chernovik)»`);
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
          if (!/^[HCJRVT]\d+$/.test(code)) continue;
          codes.push(code);
          if (row[3] && !shortByCode[code]) shortByCode[code] = row[3].replace(/\s+/g, " ").trim();
        }
        sets.push({ track: pendingSet.track, number: pendingSet.number, questionCodes: codes });
        pendingSet = null;
      } else if (compactNext && /^to.plam$/i.test(head[0] || "")) {
        for (const row of b.rows.slice(1)) {
          const number = parseInt(row[0], 10);
          if (!Number.isFinite(number)) continue;
          const codes = row.slice(1).join(" ").match(CODE_RE) || [];
          sets.push({ track: sectionTrack, number, questionCodes: codes });
        }
        compactNext = false;
      } else if (/^mavzu$/i.test(head[0] || "") && quotaTrack) {
        rules.quotas[quotaTrack] = parseQuotaTable(b.rows);
      } else if (/^to.plam$/i.test(head[0] || "") && head.includes("Nomzod")) {
        const filled = b.rows.slice(1).filter((r) => r.slice(1).some((c) => c.trim()));
        if (filled.length) warnings.push(`Таблица «Kim qaysi to'plamni oldi» (${sectionTrack}) заполнена: ${filled.length} строк — не импортируется`);
      }
      continue;
    }

    const text = (b.text || "").replace(/ /g, " ");
    const trimmed = text.trim();

    if (isHeading(b)) {
      flush();
      if (b.style === "Heading1") {
        sectionTrack = /tayyor to.plam/i.test(trimmed) ? trackOfSection(trimmed) : null;
        quotaTrack = null;
      }
      const setM = trimmed.match(/^(\d+)-to.plam$/i);
      if (setM && sectionTrack) pendingSet = { track: sectionTrack, number: parseInt(setM[1], 10) };
      if (/^\d+\s*[–-]\s*\d+-to.plamlar/i.test(trimmed) && sectionTrack) compactNext = true;
      const cnt = trimmed.match(/^(HTML|CSS|JavaScript|React|Vue|Tailwind CSS)\s*\((\d+)\s*ta\)/i);
      if (cnt) {
        const topic = { html: "html", css: "css", javascript: "js", react: "react", vue: "vue", "tailwind css": "tailwind" }[cnt[1].toLowerCase()];
        declaredCounts[topic] = parseInt(cnt[2], 10);
      }
      continue;
    }

    // Раздел 2: подзаголовки «1-yo'nalish (…)» — обычные абзацы перед таблицей квот.
    if (!current && /^[12]-yo.nalish\s*\(/i.test(trimmed)) quotaTrack = trackOfSection(trimmed);

    if (!current) {
      const lv = trimmed.match(/^-?\s*Daraja:\s*18 savolda (\d+) oson.*?\+\s*(\d+) o.rta\s*\+\s*(\d+) qiyin;\s*15 savolda (\d+)\s*\+\s*(\d+)\s*\+\s*(\d+);\s*20 savolda (\d+)\s*\+\s*(\d+)\s*\+\s*(\d+)/i);
      if (lv) {
        const n = lv.slice(1).map(Number);
        rules.levels = {
          18: { oson: n[0], orta: n[1], qiyin: n[2] },
          15: { oson: n[3], orta: n[4], qiyin: n[5] },
          20: { oson: n[6], orta: n[7], qiyin: n[8] },
        };
      }
      const pr = trimmed.match(/Kamida (\d+) ta amaliy/i);
      if (pr && rules.minPractical == null) rules.minPractical = parseInt(pr[1], 10);
      if (/Bir xil g.oyani tekshiradigan savollar/i.test(trimmed)) {
        const body = trimmed.split(":").slice(1).join(":");
        for (const seg of body.split(";")) {
          const codes = seg.replace(/\([^)]*\)/g, "").match(CODE_RE) || [];
          if (codes.length > 1) rules.conflictGroups.push([...new Set(codes)]);
        }
      }
    }

    const qm = b.mono ? null : trimmed.match(Q_HEADER_RE);
    if (qm) {
      flush();
      current = {
        code: qm[1].toUpperCase() + qm[2],
        order: parseInt(qm[2], 10),
        level: normLevel(qm[3]),
        isPractical: Boolean(qm[4]),
        headerText: qm[5].trim(),
        promptParts: [{ text: qm[5].trim(), mono: false }],
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
    if (!trimmed && !b.mono) continue;
    (current.inAnswer ? current.answerParts : current.promptParts).push({ text, mono: b.mono });
  }
  flush();

  // promptShort: из таблиц наборов 1–5, иначе начало вопроса.
  const groupOf = {};
  rules.conflictGroups.forEach((g, i) => g.forEach((c) => { groupOf[c] = `g${i + 1}`; }));
  for (const q of questions) {
    const first = q.prompt.split("\n")[0];
    q.promptShort = shortByCode[q.code] || (first.length > 140 ? first.slice(0, 137) + "…" : first);
    q.answerKind = q.isPractical ? "code" : "text";
    q.conflictGroup = groupOf[q.code] || null;
    q.contentHash = sha({
      topic: q.topic, tracks: q.tracks, level: q.level, isPractical: q.isPractical, isMiniTask: q.isMiniTask,
      prompt: q.prompt, promptShort: q.promptShort, expectedAnswer: q.expectedAnswer,
      answerKind: q.answerKind, conflictGroup: q.conflictGroup,
    });
  }
  for (const s of sets) {
    s.size = s.questionCodes.length;
    s.contentHash = sha({ track: s.track, number: s.number, questionCodes: s.questionCodes });
  }

  return { questions, sets, rules, declaredCounts, warnings };
}

// Проверки: errors — импорт нельзя; warnings — показать и продолжить.
function validateBank(parsed) {
  const errors = [];
  const warnings = [...(parsed.warnings || [])];
  const byCode = new Map();
  for (const q of parsed.questions) {
    if (byCode.has(q.code)) errors.push(`Дубль кода ${q.code}`);
    byCode.set(q.code, q);
  }
  const counts = {};
  for (const q of parsed.questions) counts[q.topic] = (counts[q.topic] || 0) + 1;
  for (const [topic, n] of Object.entries(parsed.declaredCounts || {})) {
    if (counts[topic] !== n) errors.push(`Тема ${topic}: в заголовке ${n}, распознано ${counts[topic] || 0}`);
  }

  const seen = new Set();
  for (const s of parsed.sets) {
    const id = `${s.track} #${s.number}`;
    if (seen.has(id)) errors.push(`Дубль набора ${id}`);
    seen.add(id);
    const missing = s.questionCodes.filter((c) => !byCode.has(c));
    if (missing.length) { errors.push(`${id}: нет в банке ${missing.join(", ")}`); continue; }
    if (new Set(s.questionCodes).size !== s.questionCodes.length) errors.push(`${id}: повтор вопроса в наборе`);
    const qs = s.questionCodes.map((c) => byCode.get(c));
    const wrongTrack = qs.filter((q) => !q.tracks.includes(s.track)).map((q) => q.code);
    if (wrongTrack.length) errors.push(`${id}: вопросы другого трека ${wrongTrack.join(", ")}`);

    const lv = parsed.rules?.levels?.[s.size];
    if (lv) {
      const got = { oson: 0, orta: 0, qiyin: 0 };
      qs.forEach((q) => { got[q.level] += 1; });
      if (got.oson !== lv.oson || got.orta !== lv.orta || got.qiyin !== lv.qiyin) {
        warnings.push(`${id}: уровни ${got.oson}/${got.orta}/${got.qiyin}, по правилу ${lv.oson}/${lv.orta}/${lv.qiyin}`);
      }
    }
    const practical = qs.filter((q) => q.isPractical).length;
    if (parsed.rules?.minPractical != null && practical < parsed.rules.minPractical) {
      warnings.push(`${id}: amaliy ${practical} < ${parsed.rules.minPractical}`);
    }
    const quota = parsed.rules?.quotas?.[s.track]?.[s.size];
    if (quota) {
      for (const qt of quota) {
        const n = qs.filter((q) => qt.topics.includes(q.topic)).length;
        if (n !== qt.count) warnings.push(`${id}: ${qt.topics.join("+")} ${n}, по правилу ${qt.count}`);
      }
    }
    const groups = qs.map((q) => q.conflictGroup).filter(Boolean);
    if (new Set(groups).size !== groups.length) warnings.push(`${id}: два вопроса одной conflict-группы`);
  }
  return { errors, warnings };
}

module.exports = { parseBank, validateBank, toMarkdown, LEVEL_RE };
