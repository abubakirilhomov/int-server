const Interview = require("../models/bookingModel");

// 🎯 Списки навыков
const FRONTEND_SKILLS = [
  "HTML", "CSS", "JavaScript", "TypeScript",
  "React", "Redux", "Redux Toolkit", "Next.js", "Vue.js", "Angular",
  "Tailwind", "Bootstrap", "Sass", "Styled Components",
  "Webpack", "Vite", "Babel",
  "Jest", "React Testing Library", "Cypress",
  "GSAP", "Framer Motion", "PWA", "Responsive Design", "Accessibility (A11y)",
  "WebSockets", "Service Workers", "REST API (Frontend)", "GraphQL (Frontend)"
];

const BACKEND_SKILLS = [
  "Node.js", "Express", "NestJS", "Fastify",
  "MongoDB", "Mongoose", "PostgreSQL", "MySQL", "SQLite",
  "Redis", "Prisma", "Sequelize",
  "REST API (Backend)", "GraphQL (Backend)", "WebSockets (Backend)",
  "Socket.IO", "gRPC",
  "JWT Auth", "OAuth2", "Passport.js", "Session Auth",
  "Stripe API", "PayPal API",
  "File Upload (Multer)", "Image Processing (Sharp)",
  "Unit Testing (Mocha/Chai)", "Jest (Backend)", "Supertest",
  "Docker Basics", "Nginx Reverse Proxy"
];

const ALL_SKILLS = [...FRONTEND_SKILLS, ...BACKEND_SKILLS];

// 🎯 Веса навыков
const SKILL_WEIGHTS = {
  HTML: 1, CSS: 1, JavaScript: 2, TypeScript: 3,
  React: 3, Redux: 3, "Redux Toolkit": 4, "Next.js": 4, "Vue.js": 3, Angular: 4,
  Tailwind: 2, Bootstrap: 1, Sass: 2, "Styled Components": 2,
  Webpack: 3, Vite: 2, Babel: 2,
  Jest: 3, "React Testing Library": 3, Cypress: 4,
  GSAP: 2, "Framer Motion": 2, PWA: 3, "Responsive Design": 1, "Accessibility (A11y)": 2,
  WebSockets: 3, "Service Workers": 3, "REST API (Frontend)": 2, "GraphQL (Frontend)": 3,

  "Node.js": 3, Express: 3, NestJS: 4, Fastify: 3,
  MongoDB: 3, Mongoose: 2, PostgreSQL: 4, MySQL: 3, SQLite: 2,
  Redis: 3, Prisma: 3, Sequelize: 3,
  "REST API (Backend)": 3, "GraphQL (Backend)": 4, "WebSockets (Backend)": 3,
  "Socket.IO": 3, gRPC: 4,
  "JWT Auth": 3, OAuth2: 4, "Passport.js": 3, "Session Auth": 2,
  "Stripe API": 3, "PayPal API": 3,
  "File Upload (Multer)": 2, "Image Processing (Sharp)": 3,
  "Unit Testing (Mocha/Chai)": 3, "Jest (Backend)": 3, Supertest: 2,
  "Docker Basics": 3, "Nginx Reverse Proxy": 4,
};

// 🎯 Алгоритм сложности
const calculateDifficulty = (skills) => {
  if (!skills || skills.length === 0) return "easy";

  let total = 0;
  skills.forEach((skill) => {
    total += SKILL_WEIGHTS[skill] || 1;
  });

  if (total <= 8) return "easy";
  if (total <= 18) return "medium";
  return "hard";
};

// 📌 Создать интервью с валидацией
const registerInterview = async (req, res) => {
  try {
    const { firstName, lastName, age, branch, monthsStudied, direction, skills, mentor, interviewDate } = req.body;

    if (!firstName || !lastName || !age || !branch || !monthsStudied || !direction || !skills || !mentor || !interviewDate) {
      return res.status(400).json({ message: "Все поля обязательны" });
    }

    const difficulty = calculateDifficulty(skills);

    const interview = new Interview({ firstName, lastName, age, branch, monthsStudied, direction, skills, mentor, difficulty, interviewDate });
    await interview.save();

    res.status(201).json({ message: "Interview registered successfully", interview });
  } catch (error) {
    res.status(500).json({ message: "Error registering interview", error: error.message });
  }
};

// 📌 Получить все интервью
const getAllInterviews = async (req, res) => {
  try {
    const interviews = await Interview.find().sort({ createdAt: -1 });
    res.json(interviews);
  } catch (error) {
    res.status(500).json({ error: "Ошибка сервера при получении интервью" });
  }
};

// 📌 Получить навыки по направлению
const getSkillsByDirection = (req, res) => {
  const { direction } = req.query;
  if (!direction || !["Frontend", "Backend", "Fullstack"].includes(direction)) {
    return res.status(400).json({ error: "Неверное направление. Допустимые значения: Frontend, Backend, Fullstack" });
  }

  const skills =
    direction === "Frontend" ? FRONTEND_SKILLS :
    direction === "Backend" ? BACKEND_SKILLS : ALL_SKILLS;

  res.json(skills);
};

// 📌 Рассчитать сложность отдельно
const getDifficulty = (req, res) => {
  const { skills } = req.body;
  if (!skills || !Array.isArray(skills) || skills.length === 0)пше 
    return res.status(400).json({ error: "Нужно передать массив навыков для расчета сложности" });

  const difficulty = calculateDifficulty(skills);
  res.json({ difficulty });
};

module.exports = {
  registerInterview,
  getAllInterviews,
  getSkillsByDirection,
  getDifficulty,
};
