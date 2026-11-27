// СИНТЕТИЧЕСКИЙ банк для тестов. Настоящие вопросы в репозиторий не кладём
// (репо публичный) — здесь только выдуманные тексты в формате docx-банка.
const p = (text, extra = {}) => ({ type: "p", text, style: null, mono: false, ...extra });
const h1 = (text) => ({ type: "p", text, style: "Heading1", mono: false });
const h2 = (text) => ({ type: "p", text, style: "Heading2", mono: false });
const code = (text) => ({ type: "p", text, style: null, mono: true });
const table = (rows) => ({ type: "table", rows });

function q(code_, level, practical, text, answer, codeLines = []) {
  return [
    p(`${code_}. [${level}${practical ? " · amaliy" : ""}] ${text}`),
    ...codeLines.map(code),
    p(`Javob (chernovik): ${answer}`),
  ];
}

// Маленький банк: H1-H2, C1-C2, J1-J2, R1-R2, V1-V2, T1-T2.
// Правило для «размера 6»: по уровням 2/2/2, минимум 2 amaliy.
function syntheticBlocks({ brokenSet = false } = {}) {
  return [
    h1("2. To'plam tuzish qoidasi"),
    p("1-yo'nalish (HTML + CSS + JS + React)"),
    table([["Mavzu", "6 savol", "Bankda"], ["HTML", "1", "2"], ["CSS", "1", "2"], ["JavaScript", "2", "2"], ["React", "2", "2"], ["Jami", "6", "8"]]),
    p("2-yo'nalish (Vue + Tailwind CSS)"),
    table([["Mavzu", "6 savol", "Bankda"], ["HTML + CSS", "1", "4"], ["JavaScript", "1", "2"], ["Vue", "2", "2"], ["Tailwind CSS", "2", "2"], ["Jami", "6", "10"]]),
    p("Daraja: 18 savolda 4 oson (isinish uchun) + 9 o'rta + 5 qiyin; 15 savolda 3 + 8 + 4; 20 savolda 4 + 11 + 5."),
    p("Kamida 2 ta amaliy savol (kod bilan)."),
    p("Bir xil g'oyani tekshiradigan savollar bitta suhbatga tushmaydi: C2 va T2 (sintetik); J2 va V2 (sintetik)."),

    h1("3. Tayyor to'plamlar — 1-yo'nalish (HTML + CSS + JS + React)"),
    h2("1-to'plam"),
    table([
      ["№", "ID", "Daraja", "Savol (qisqa)"],
      ["1", "H1", "oson", "Sintetik HTML qisqa"],
      ["2", "C1", "o'rta", "Sintetik CSS qisqa"],
      ["3", "J1", "o'rta, amaliy", "Sintetik JS qisqa"],
      ["4", "J2", "qiyin", "Sintetik JS2 qisqa"],
      ["5", "R1", "oson", "Sintetik React qisqa"],
      ["6", brokenSet ? "R9" : "R2", "qiyin, amaliy", "Sintetik React2 qisqa"],
    ]),
    h2("2–2-to'plamlar (qisqa ko'rinish)"),
    table([["To'plam", "HTML", "CSS", "JavaScript", "React"], ["2", "H2", "C2", "J1, J2", "R1, R2"]]),
    h2("Kim qaysi to'plamni oldi"),
    table([["To'plam", "Sana", "Nomzod", "Intervyu oluvchi", "Izoh"], ["1", "", "", "", ""]]),

    h1("4. Tayyor to'plamlar — 2-yo'nalish (Vue + Tailwind CSS)"),
    h2("1-to'plam"),
    table([
      ["№", "ID", "Daraja", "Savol (qisqa)"],
      ["1", "H1", "oson", "x"], ["2", "J1", "o'rta, amaliy", "x"], ["3", "V1", "o'rta", "x"],
      ["4", "V2", "qiyin", "x"], ["5", "T1", "oson", "x"], ["6", "T2", "qiyin, amaliy", "x"],
    ]),

    h1("5. Savollar banki — 1-yo'nalish va umumiy HTML/CSS/JS"),
    h2("HTML (2 ta)"),
    ...q("H1", "oson", false, "Sintetik savol: teg nima?", "Sintetik javob H1."),
    ...q("H2", "o'rta", true, "Sintetik: kodni tuzating.", "Sintetik javob H2.", ["<div>", "  <p>x</p>", "</div>"]),
    h2("CSS (2 ta)"),
    ...q("C1", "o'rta", false, "Sintetik CSS savol.", "Sintetik javob C1."),
    ...q("C2", "qiyin", false, "Sintetik CSS savol 2.", "Sintetik javob C2."),
    h2("JavaScript (2 ta)"),
    ...q("J1", "o'rta", true, "Mini-topshiriq (3–5 daqiqa): sintetik funksiya yozing.", "Sintetik javob J1.", ["function f() {}"]),
    ...q("J2", "qiyin", false, "Sintetik JS savol 2.", "Sintetik javob J2."),
    h2("React (2 ta)"),
    ...q("R1", "oson", false, "Sintetik React savol.", "Sintetik javob R1."),
    ...q("R2", "qiyin", true, "Sintetik React savol 2.", "Sintetik javob R2."),
    h1("6. Savollar banki — 2-yo'nalish (Vue + Tailwind CSS)"),
    h2("Vue (2 ta)"),
    ...q("V1", "o'rta", false, "Sintetik Vue savol.", "Sintetik javob V1."),
    ...q("V2", "qiyin", false, "Sintetik Vue savol 2.", "Sintetik javob V2."),
    h2("Tailwind CSS (2 ta)"),
    ...q("T1", "oson", false, "Sintetik Tailwind savol.", "Sintetik javob T1."),
    ...q("T2", "qiyin", true, "Sintetik Tailwind savol 2.", "Sintetik javob T2."),
    h1("Ilova: eski savollar qayerga ketdi"),
  ];
}

// Синтетический backend-банк (трек backend-nodejs): Node.js, Express, БД, API.
function syntheticBackendBlocks() {
  return [
    h1("2. To'plam tuzish qoidasi"),
    p("3-yo'nalish (Node.js + Express)"),
    table([["Mavzu", "4 savol", "Bankda"], ["Node.js + Express", "2", "2"], ["MongoDB", "1", "1"], ["API va HTTP", "1", "1"], ["Jami", "4", "4"]]),
    h1("3. Tayyor to'plamlar — Backend (Node.js)"),
    h2("1-to'plam"),
    table([
      ["№", "ID", "Daraja", "Savol (qisqa)"],
      ["1", "N1", "oson", "Sintetik Node qisqa"], ["2", "E1", "o'rta", "Sintetik Express qisqa"],
      ["3", "D1", "o'rta", "Sintetik DB qisqa"], ["4", "A1", "qiyin, amaliy", "Sintetik API qisqa"],
    ]),
    h1("5. Savollar banki — Backend"),
    h2("Node.js (1 ta)"),
    ...q("N1", "oson", false, "Sintetik Node savol.", "Sintetik javob N1."),
    h2("Express (1 ta)"),
    ...q("E1", "o'rta", false, "Sintetik Express savol.", "Sintetik javob E1."),
    h2("MongoDB (1 ta)"),
    ...q("D1", "o'rta", false, "Sintetik DB savol.", "Sintetik javob D1."),
    h2("API va HTTP (1 ta)"),
    ...q("A1", "qiyin", true, "Sintetik API savol.", "Sintetik javob A1.", ["app.get('/x', h);"]),
  ];
}

module.exports = { syntheticBlocks, syntheticBackendBlocks };

// Синтетический Python-банк (формат «mars-intern-savollar-python»): ID с модулем (M3-01),
// раздел 4 — пройденные модули, раздел 5 — ещё не пройденные (импорт неактивными),
// правило набора — квоты по модулям для «6 savol». Тексты выдуманные.
function syntheticPythonBlocks({ brokenSet = false } = {}) {
  const pq = (id, level, practical, text, answer, codeLines = [], answerCode = []) => [
    p(`${id}. [${level}${practical ? " · amaliy" : ""}] ${text}`),
    ...codeLines.map((l) => (l === "" ? p(" ") : code(l))),
    p(`Javob (chernovik): ${answer}`),
    ...answerCode.map(code),
  ];
  return [
    { type: "p", text: "Sintetik intern suhbati: Python yo'nalishi", style: "Title", mono: false },
    h1("1. Hisob-kitob: savollar yetadimi?"),
    p("Sintetik matn."),
    h1("2. To'plam tuzish qoidasi"),
    table([["Modul", "6 savol", "Bankda"], ["M3 · Sintetik asoslar", "2", "4"], ["M4 · Sintetik chuqur", "2", "4"], ["M7 · Sintetik SQL", "2", "3"], ["Jami", "6", "11"]]),
    p("Daraja: 18 savolda 4 oson (isinish uchun) + 9 o'rta + 5 qiyin; 15 savolda 3 + 8 + 4; 20 savolda 4 + 11 + 5."),
    p("Kamida 2 ta amaliy savol (20 savolda — 3), shundan bittasi 3–5 daqiqalik mini-topshiriq."),
    p("Tartib: modul bo'yicha (M3 → M7), har modul ichida osondan qiyinga."),
    p("Bir xil g'oyani tekshiradigan savollar bitta suhbatga tushmaydi: M3-01, M4-01; M3-02, M7-01; M3-03, M7-01."),
    { type: "p", text: "1–2-modullar (HTML/CSS)", style: "Heading3", mono: false },
    p("Intervyu oluvchi HTML/CSS bo'yicha ham so'ramoqchi bo'lsa — ko'pi bilan 1–2 ta savol, qo'shimcha sifatida (jami 20 dan oshmasin)."),
    p("Python yo'nalishiga mos (JS talab qilmaydi): H2 (sintetik), C1 (sintetik)."),
    p("Ishlatmang: H1 (JS'ga bog'liq)."),

    h1("3. Tayyor to'plamlar (sintetik guruh: 3, 4, 7-modullar)"),
    h2("1-to'plam"),
    table([
      ["№", "ID", "Daraja", "Savol (qisqa)"],
      ["1", "M3-01", "oson, amaliy", "Sintetik qisqa M3-01"],
      ["2", "M3-04", "qiyin, amaliy", "Sintetik qisqa M3-04"],
      ["3", "M4-02", "o'rta, amaliy", "Sintetik qisqa M4-02"],
      ["4", brokenSet ? "M4-01" : "M4-03", "o'rta", "x"],
      ["5", "M7-02", "oson, amaliy", "x"],
      ["6", "M7-03", "qiyin", "x"],
    ]),
    h2("2–2-to'plamlar (qisqa ko'rinish)"),
    table([["To'plam", "M3", "M4", "M7"], ["2", "M3-02, M3-03", "M4-01, M4-04", "M7-02, M7-03"]]),
    h2("Kim qaysi to'plamni oldi"),
    table([["To'plam", "Sana", "Nomzod", "Intervyu oluvchi", "Izoh"], ["1", "", "", "", ""]]),

    h1("4. Savollar banki — o'tilgan modullar"),
    h2("M3 · Sintetik asoslar (4 ta)"),
    ...pq("M3-01", "oson", true, "Sintetik: nima chiqadi?", "Sintetik javob M3-01.", ["def f():", "    return 1", "", "print(f())"]),
    ...pq("M3-02", "o'rta", false, "Sintetik: nega?", "Sintetik javob M3-02."),
    ...pq("M3-03", "o'rta", true, "Mini-topshiriq (3–5 daqiqa): sintetik funksiya yozing.", "Namuna:", [], ["with open('a.txt') as f:", "    print(f.read())"]),
    ...pq("M3-04", "qiyin", true, "Sintetik qiyin savol.", "Sintetik javob M3-04."),
    h2("M4 · Sintetik chuqur (4 ta)"),
    ...pq("M4-01", "o'rta", true, "Sintetik M4-01.", "Sintetik javob M4-01."),
    ...pq("M4-02", "o'rta", true, "Sintetik M4-02.", "Sintetik javob M4-02."),
    ...pq("M4-03", "o'rta", false, "Sintetik M4-03.", "Sintetik javob M4-03."),
    ...pq("M4-04", "qiyin", false, "Sintetik M4-04.", "Sintetik javob M4-04."),
    h2("M7 · Sintetik SQL (3 ta)"),
    ...pq("M7-01", "oson", true, "Sintetik SQL: nechta qator?", "Sintetik javob M7-01.", ["SELECT * FROM t WHERE x = NULL;"]),
    ...pq("M7-02", "oson", true, "Sintetik SQL so'rov yozing.", "Namuna:", [], ["SELECT name FROM t ORDER BY name;"]),
    ...pq("M7-03", "qiyin", false, "Sintetik SQL nega?", "Sintetik javob M7-03."),

    h1("5. Qisman o'tilgan va hali o'tilmagan modullar"),
    h2("M10 · Sintetik Django (1 ta)"),
    ...pq("M10-01", "o'rta", true, "[auth] Sintetik auth savol.", "Sintetik javob M10-01.", ["User.objects.create(username='x')"]),
    h2("M5 · Sintetik OOP (hali o'tilmagan) (1 ta)"),
    ...pq("M5-01", "oson", false, "Sintetik OOP savol.", "Sintetik javob M5-01.", [], ["<ul>", "{% for x in xs %}<li>{{ x }}</li>{% endfor %}", "</ul>"]),
  ];
}

module.exports.syntheticPythonBlocks = syntheticPythonBlocks;
