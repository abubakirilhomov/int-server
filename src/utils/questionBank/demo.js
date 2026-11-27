// Живая сцена к вопросу банка («как в тесте на права»): HTML/CSS, который
// фронт рендерит в изолированном iframe (sandbox без allow-same-origin, CSP
// без сети), плюс декларативный сценарий «▶ проиграть».
//
// demo     — то, что видно (кандидату — только при audience "candidate").
// demoFix  — та же сцена после исправления, ТОЛЬКО для интервьюера.
//
// Содержимое сцен — часть банка: живёт в БД, в git — только этот формат.
// Чистые функции, без БД.

const AUDIENCES = ["candidate", "interviewer"];
const STEP_TYPES = ["wait", "click", "hover", "unhover", "scroll", "addClass", "removeClass"];
const LIMITS = {
  html: 20000,
  css: 20000,
  caption: 500,
  steps: 40,
  selector: 200,
  className: 60,
  ms: 10000,
  scrollTo: 20000,
  minHeight: 120,
  maxHeight: 900,
  minWidth: 320,
  maxWidth: 1440,
};
const SLIDER_RANGE = { min: 375, max: 1440 };
const CLASS_RE = /^[A-Za-z_-][\w-]*$/;

class DemoError extends Error {
  constructor(errors) {
    super(`demo: ${errors.join("; ")}`);
    this.name = "DemoError";
    this.errors = errors;
  }
}

const str = (v) => (v === undefined || v === null ? "" : String(v));

function checkText(errors, name, value, max) {
  const s = str(value);
  if (s.length > max) errors.push(`${name} длиннее ${max} символов`);
  return s;
}

function int(errors, name, value, min, max, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push(`${name} должно быть целым ${min}…${max}`);
    return fallback;
  }
  return n;
}

function selector(errors, name, value, required = true) {
  const s = str(value).trim();
  if (!s) {
    if (required) errors.push(`${name}: нужен CSS-селектор`);
    return undefined;
  }
  if (s.length > LIMITS.selector) errors.push(`${name}: селектор длиннее ${LIMITS.selector}`);
  return s;
}

// Шаг сценария → чистый объект (только известные поля) или ошибка.
function normalizeStep(step, i, errors) {
  const at = `steps[${i}]`;
  if (!step || typeof step !== "object") {
    errors.push(`${at}: ожидается объект`);
    return null;
  }
  const type = str(step.type);
  if (!STEP_TYPES.includes(type)) {
    errors.push(`${at}: неизвестный тип "${type}" (можно: ${STEP_TYPES.join(", ")})`);
    return null;
  }
  switch (type) {
    case "wait":
      return { type, ms: int(errors, `${at}.ms`, step.ms, 0, LIMITS.ms, 500) };
    case "click":
    case "hover":
    case "unhover":
      return { type, target: selector(errors, `${at}.target`, step.target) };
    case "scroll": {
      const out = { type, to: int(errors, `${at}.to`, step.to, 0, LIMITS.scrollTo, 0),
        ms: int(errors, `${at}.ms`, step.ms, 0, LIMITS.ms, 1200) };
      const target = selector(errors, `${at}.target`, step.target, false);
      if (target) out.target = target;
      return out;
    }
    case "addClass":
    case "removeClass": {
      const className = str(step.className).trim();
      if (!CLASS_RE.test(className) || className.length > LIMITS.className) {
        errors.push(`${at}.className: недопустимое имя класса`);
      }
      return { type, target: selector(errors, `${at}.target`, step.target), className };
    }
    default:
      return null;
  }
}

function normalizeSteps(steps, errors) {
  if (steps === undefined || steps === null) return [];
  if (!Array.isArray(steps)) {
    errors.push("steps: ожидается массив");
    return [];
  }
  if (steps.length > LIMITS.steps) errors.push(`steps: больше ${LIMITS.steps} шагов`);
  return steps.map((s, i) => normalizeStep(s, i, errors)).filter(Boolean);
}

// Сцена → нормализованный объект; пустая сцена (нет html) → null.
// Бросает DemoError со списком всех ошибок сразу.
function normalizeDemo(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object") throw new DemoError(["ожидается объект"]);
  const errors = [];
  const html = checkText(errors, "html", input.html, LIMITS.html);
  if (!html.trim()) {
    if (errors.length) throw new DemoError(errors);
    return null;
  }
  const audience = str(input.audience || "candidate");
  if (!AUDIENCES.includes(audience)) errors.push(`audience: ${AUDIENCES.join(" | ")}`);
  const slider = input.slider === true;
  const demo = {
    html,
    css: checkText(errors, "css", input.css, LIMITS.css),
    steps: normalizeSteps(input.steps, errors),
    caption: checkText(errors, "caption", input.caption, LIMITS.caption),
    captionRu: checkText(errors, "captionRu", input.captionRu, LIMITS.caption),
    height: int(errors, "height", input.height, LIMITS.minHeight, LIMITS.maxHeight, 320),
    width: int(errors, "width", input.width, LIMITS.minWidth, LIMITS.maxWidth, slider ? SLIDER_RANGE.max : 375),
    slider,
    layers3d: input.layers3d === true,
    audience,
  };
  if (errors.length) throw new DemoError(errors);
  return demo;
}

// Исправленная сцена: всё необязательно, недостающее берётся из demo.
// Рендер: fix.html заменяет html, fix.css ДОПИСЫВАЕТСЯ после demo.css,
// fix.steps заменяет сценарий. Пустой fix (ни html, ни css, ни шагов) → null.
function normalizeDemoFix(input) {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object") throw new DemoError(["fix: ожидается объект"]);
  const errors = [];
  const fix = {
    html: checkText(errors, "fix.html", input.html, LIMITS.html),
    css: checkText(errors, "fix.css", input.css, LIMITS.css),
    steps: input.steps === undefined ? undefined : normalizeSteps(input.steps, errors),
    caption: checkText(errors, "fix.caption", input.caption, LIMITS.caption),
    captionRu: checkText(errors, "fix.captionRu", input.captionRu, LIMITS.caption),
  };
  if (errors.length) throw new DemoError(errors);
  if (fix.steps === undefined) delete fix.steps;
  if (!fix.html.trim() && !fix.css.trim() && !fix.steps) return null;
  return fix;
}

module.exports = { AUDIENCES, STEP_TYPES, LIMITS, SLIDER_RANGE, DemoError, normalizeDemo, normalizeDemoFix };
