// Автотесты мини-заданий банка: массив { name, nameRu, code }. Выполняются ТОЛЬКО
// в браузере, в песочнице-iframe (candidates / internship-admin, lib/sandbox/tests.js);
// сервер код тестов не исполняет — максимум компилирует для проверки синтаксиса
// (vm.Script не запускает код).
//
// Тесты — часть банка (КОНФИДЕНЦИАЛЬНО): живут в БД, в git только этот формат.
// Кандидату уходят только названия (serializers/candidateView), код — отдельной
// выдачей перед прогоном «Прогнать у себя» (candidateController.getTests).
//
// Тело теста — тело async-функции с параметрами (assert, sleep, logs, vars):
//   assert.ok / equal / deepEqual / throws / rejects / fail;  sleep(ms);
//   logs — всё, что код кандидата вывел в console.log (массив массивов аргументов);
//   vars() — значения верхнеуровневых имён из кода кандидата ({ summary: {...} }).
// Чистые функции, без БД.
const vm = require("vm");

const LIMITS = { count: 12, name: 200, code: 6000 };

class TestsError extends Error {
  constructor(errors) {
    super(`tests: ${errors.join("; ")}`);
    this.name = "TestsError";
    this.errors = errors;
  }
}

const str = (v) => (v === undefined || v === null ? "" : String(v));

// Только компиляция: SyntaxError ловит «} лишняя» и т. п. Код не выполняется.
function syntaxError(code) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(`(async function (assert, sleep, logs, vars) {\n${code}\n})`, { filename: "test.js" });
    return null;
  } catch (e) {
    return e.message;
  }
}

// → [{ name, nameRu, code }] или TestsError со всеми ошибками сразу.
// null / undefined / [] → [] (тестов нет).
function normalizeTests(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new TestsError(["ожидается массив"]);
  const errors = [];
  if (input.length > LIMITS.count) errors.push(`больше ${LIMITS.count} проверок`);
  const out = [];
  input.forEach((t, i) => {
    const at = `tests[${i}]`;
    if (!t || typeof t !== "object") { errors.push(`${at}: ожидается объект`); return; }
    const name = str(t.name).trim();
    const nameRu = str(t.nameRu).trim();
    const code = str(t.code);
    if (!name) errors.push(`${at}: нужно название (name)`);
    if (name.length > LIMITS.name || nameRu.length > LIMITS.name) errors.push(`${at}: название длиннее ${LIMITS.name}`);
    if (!code.trim()) errors.push(`${at}: нужен код (code)`);
    if (code.length > LIMITS.code) errors.push(`${at}: код длиннее ${LIMITS.code}`);
    else if (code.trim()) {
      const err = syntaxError(code);
      if (err) errors.push(`${at} («${name}»): синтаксис — ${err}`);
    }
    out.push({ name, nameRu, code });
  });
  if (errors.length) throw new TestsError(errors);
  return out;
}

// Для кандидата — только названия на выбранном языке (никакого кода).
function testNames(tests, lang) {
  return (tests || []).map((t) => ({ name: lang === "ru" && t.nameRu && String(t.nameRu).trim() ? String(t.nameRu) : String(t.name || "") }));
}

module.exports = { LIMITS, TestsError, normalizeTests, testNames, syntaxError };
