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

module.exports = { syntheticBlocks };
