/**
 * Seed script — restore DB from collected CSV data (April 2026).
 *
 * Usage:
 *   cd int-server
 *   node -r dotenv/config scripts/seed-db.js
 *
 * What it does:
 *   1. Seeds GradeConfig
 *   2. Creates all 7 branches
 *   3. Creates mentors (linked to branches)
 *   4. Creates interns (linked to branches + mentors)
 *
 * Default password for everyone: 12345678
 */

const mongoose = require("mongoose");
const Branch = require("../src/models/branchModel");
const Mentor = require("../src/models/mentorModel");
const Intern = require("../src/models/internModel");
const GradeConfig = require("../src/models/gradeConfigModel");
const grades = require("../src/config/grades");

const bcrypt = require("bcrypt");

const DEFAULT_PASSWORD = "12345678";

// ──────────────────────────────────────
// Helper: parse DD.MM.YYYY → Date
// ──────────────────────────────────────
function parseDate(str) {
  if (!str) return new Date();
  const cleaned = str.trim().replace(/\s+/g, "");
  // Handle DD.MM.YY or DD.MM.YYYY
  const parts = cleaned.split(".");
  if (parts.length !== 3) return new Date();
  let [d, m, y] = parts.map(Number);
  if (y < 100) y += 2000;
  return new Date(y, m - 1, d);
}

// ──────────────────────────────────────
// Data
// ──────────────────────────────────────

const BRANCHES = [
  "Yunusobod",
  "Chilonzor",
  "Tinchlik",
  "Gorkiy",
  "Sergeli",
  "Minor",
  "Oybek",
];

// Mentors per branch. key = mentor reference name used by interns below.
const MENTORS_DATA = {
  Yunusobod: [
    { name: "Azim", lastName: "Qurbonov", role: "mentor" },
    { name: "Diyor", lastName: "Raxmatullayev", role: "mentor" },
    { name: "Sunnatbek", lastName: "Yusupov", role: "mentor" },
    { name: "Bekzod", lastName: "Mirzaaliyev", role: "mentor" },
    { name: "Ertan", lastName: "Emirhan", role: "mentor" },
    { name: "Abdulaziz", lastName: "Yormatov", role: "mentor" },
    { name: "Zilola", lastName: "Ixtiyorova", role: "mentor" },
    { name: "Dilshod", lastName: "Muxtorov", role: "mentor" },
    { name: "Akmaljon", lastName: "Mordayev", role: "mentor" },
  ],
  Gorkiy: [
    { name: "Aziz", lastName: "Badalov", role: "mentor" },
    { name: "Jasurbek", lastName: "Hakimbekov", role: "mentor" },
    { name: "Behruz", lastName: "Satimbayev", role: "mentor", alsoBranches: ["Yunusobod"] },
    { name: "Asadbek", lastName: "Mamatkarimov", role: "mentor" },
  ],
  Sergeli: [
    { name: "Azizbek", lastName: "Ergashev", role: "mentor" },
    { name: "Ziyovuddin", lastName: "Abdurashidov", role: "mentor" },
    { name: "Mirfozil", lastName: "Mirsharipov", role: "mentor" },
    { name: "Jamil", lastName: "Qandimov", role: "mentor" },
    { name: "Muhamadaziz", lastName: "Xakimov", role: "mentor" },
    { name: "Akmal", lastName: "Mordayev", role: "mentor" },
    { name: "Ilyos", lastName: "Suyunov", role: "mentor" },
  ],
  Minor: [
    { name: "Mavlon", lastName: "Haqijonov", role: "mentor" },
    { name: "Abbos", lastName: "Hamidov", role: "mentor" },
    { name: "Javohir", lastName: "Eshmo'minov", role: "mentor" },
    { name: "Yusuf", lastName: "Kasimov", role: "mentor" },
    { name: "Timur", lastName: "Tukfatullin", role: "mentor" },
    { name: "Otabek", lastName: "Davronbekov", role: "mentor" },
  ],
};

// mentorRef: "Name LastName" — must match a mentor created above in the same branch
const INTERNS_DATA = {
  Yunusobod: [
    { name: "Otabek", lastName: "G'ayratov", username: "OtabekGayratov", sphere: "mern-stack", grade: "junior", dateJoined: "30.03.2026", mentorRef: "Azim Qurbonov" },
    { name: "Ibrohim", lastName: "Sobirov", username: "Underscore", sphere: "mern-stack", grade: "junior", dateJoined: "16.03.2026", mentorRef: "Diyor Raxmatullayev" },
    { name: "Azizbek", lastName: "Xudoyberdiyev", username: "AzizX", sphere: "frontend-react", grade: "strongJunior", dateJoined: "19.01.2026", mentorRef: "Sunnatbek Yusupov" },
    { name: "Jafarbek", lastName: "Ulugbekov", username: "Jafarbek", sphere: "mern-stack", grade: "junior", dateJoined: "01.04.2026", mentorRef: "Bekzod Mirzaaliyev" },
    { name: "Saidazim", lastName: "Buriboyev", username: "SaidazimBuriboyev", sphere: "mern-stack", grade: "strongMiddle", dateJoined: "15.11.2025", mentorRef: "Ertan Emirhan" },
    { name: "Yahyo", lastName: "Komilov", username: "YahyoKomilov", sphere: "mern-stack", grade: "junior", dateJoined: "16.03.2026", mentorRef: "Azim Qurbonov" },
    { name: "Navruz", lastName: "Murodullaev", username: "navruzMurodullayev", sphere: "frontend-react", grade: "junior", dateJoined: "27.03.2026", mentorRef: "Bekzod Mirzaaliyev" },
    { name: "Abduvoris", lastName: "G'ayratov", username: "AbduvorisGayratov", sphere: "frontend-react", grade: "junior", dateJoined: "02.02.2026", mentorRef: "Sunnatbek Yusupov" },
    { name: "Elshod", lastName: "Turgunjonov", username: "elshod123", sphere: "backend-python", grade: "strongJunior", dateJoined: "01.12.2025", mentorRef: "Dilshod Muxtorov" },
    { name: "Azizbek", lastName: "Amangeldiev", username: "Azizbek", sphere: "full-stack", grade: "middle", dateJoined: "16.12.2025", mentorRef: "Ertan Emirhan" },
    { name: "Xondamir", lastName: "Madaliyev", username: "XondamirMadaliyev", sphere: "frontend-react", grade: "strongJunior", dateJoined: "01.01.2026", mentorRef: "Diyor Raxmatullayev" },
    { name: "Firdavs", lastName: "Sodiqov", username: "sodiqov123", sphere: "frontend-react", grade: "strongJunior", dateJoined: "22.01.2026", mentorRef: "Sunnatbek Yusupov" },
    { name: "Munisa", lastName: "Abdullayeva", username: "abdullayeva", sphere: "full-stack", grade: "strongMiddle", dateJoined: "08.09.2025", mentorRef: "Bekzod Mirzaaliyev" },
    { name: "Jasur", lastName: "Rustamov", username: "JasurRustamov", sphere: "mern-stack", grade: "strongMiddle", dateJoined: "02.08.2025", mentorRef: "Ertan Emirhan" },
    { name: "Odiljon", lastName: "Xamidullayev", username: "OdiljonXamidullayev", sphere: "frontend-react", grade: "junior", dateJoined: "12.03.2026", mentorRef: "Ertan Emirhan" },
    { name: "Aziz", lastName: "Sabirov", username: "Azizbek2010", sphere: "frontend-react", grade: "middle", dateJoined: "10.11.2025", mentorRef: "Sunnatbek Yusupov" },
  ],
  Gorkiy: [
    { name: "Javodbek", lastName: "Abdusalimov", username: "Javodbek", sphere: "frontend-react", grade: "junior", dateJoined: "10.02.2026", mentorRef: "Behruz Satimbayev" },
  ],
  Sergeli: [
    { name: "Alibek", lastName: "Azimov", username: "azimov", sphere: "frontend-react", grade: "strongJunior", dateJoined: "01.02.2026", mentorRef: "Azizbek Ergashev" },
    { name: "Abdunabi", lastName: "Tolqinov", username: "tolqinov", sphere: "frontend-react", grade: "strongJunior", dateJoined: "01.02.2026", mentorRef: "Azizbek Ergashev" },
    { name: "Madina", lastName: "Abdullayeva", username: "abdullayeva_s", sphere: "frontend-react", grade: "strongJunior", dateJoined: "01.02.2026", mentorRef: "Azizbek Ergashev" },
    { name: "Mahmudjon", lastName: "Oripov", username: "oripov", sphere: "frontend-react", grade: "junior", dateJoined: "01.02.2026", mentorRef: "Azizbek Ergashev" },
    { name: "Jobirbek", lastName: "Rahmonberdiyev", username: "rahmonberdiyev", sphere: "frontend-react", grade: "junior", dateJoined: "01.02.2026", mentorRef: "Azizbek Ergashev" },
    { name: "Jasmina", lastName: "Esanova", username: "esanova", sphere: "backend-python", grade: "junior", dateJoined: "01.02.2026", mentorRef: "Azizbek Ergashev" },
    { name: "Muslima", lastName: "Shukrullayeva", username: "shukrullayeva", sphere: "backend-python", grade: "junior", dateJoined: "01.02.2026", mentorRef: "Azizbek Ergashev" },
    { name: "Asadbek", lastName: "Toirov", username: "toirov", sphere: "frontend-react", grade: "strongJunior", dateJoined: "01.02.2026", mentorRef: "Azizbek Ergashev" },
  ],
  Minor: [
    { name: "Muhammadamin", lastName: "Ismailov", username: "MuhammadaminIsmailov", sphere: "frontend-react", grade: "junior", dateJoined: "19.03.2026", mentorRef: "Mavlon Haqijonov" },
    { name: "Muhammadali", lastName: "Zabihullayev", username: "MuhammadaliZabihullayev", sphere: "frontend-react", grade: "junior", dateJoined: "06.01.2026", mentorRef: "Abbos Hamidov" },
    { name: "Muhammadrasul", lastName: "Mansurov", username: "MuhammadrasulMansurov", sphere: "frontend-react", grade: "junior", dateJoined: "19.03.2026", mentorRef: "Javohir Eshmo'minov" },
    { name: "Ozodbek", lastName: "Abduqahhorov", username: "OzodbekAbduqahhorov", sphere: "frontend-react", grade: "junior", dateJoined: "06.01.2026", mentorRef: "Yusuf Kasimov" },
  ],
};

// ──────────────────────────────────────
// Seed logic
// ──────────────────────────────────────
async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set in .env");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  // 1. Seed GradeConfig
  console.log("\n--- Seeding GradeConfig ---");
  for (const [grade, cfg] of Object.entries(grades)) {
    await GradeConfig.findOneAndUpdate(
      { grade },
      { grade, lessonsPerMonth: cfg.lessonsPerMonth, trialPeriod: cfg.trialPeriod, perks: cfg.plus || [] },
      { upsert: true, new: true }
    );
    console.log(`  ${grade}: ${cfg.lessonsPerMonth} lessons/mo, ${cfg.trialPeriod}mo trial`);
  }

  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // 2. Create branches
  console.log("\n--- Creating branches ---");
  const branchMap = {}; // name → ObjectId
  for (const name of BRANCHES) {
    const branch = await Branch.findOneAndUpdate(
      { name },
      { name },
      { upsert: true, new: true }
    );
    branchMap[name] = branch._id;
    console.log(`  ${name}: ${branch._id}`);
  }

  // 3. Create mentors
  console.log("\n--- Creating mentors ---");
  const mentorMap = {}; // "Name LastName" → { doc, branches[] }

  for (const [branchName, mentors] of Object.entries(MENTORS_DATA)) {
    for (const m of mentors) {
      const key = `${m.name} ${m.lastName}`;
      const branchIds = [branchMap[branchName]];

      // Some mentors belong to multiple branches
      if (m.alsoBranches) {
        for (const ab of m.alsoBranches) {
          if (branchMap[ab]) branchIds.push(branchMap[ab]);
        }
      }

      if (mentorMap[key]) {
        // Mentor already created for another branch — add this branch
        const existing = mentorMap[key].doc;
        const newBranches = [...new Set([...existing.branches.map(String), ...branchIds.map(String)])];
        existing.branches = newBranches.map((id) => new mongoose.Types.ObjectId(id));
        await existing.save();
        console.log(`  ${key}: added branch ${branchName} (${existing._id})`);
      } else {
        const mentor = new Mentor({
          name: m.name,
          lastName: m.lastName,
          password: hashedPassword,
          role: m.role || "mentor",
          branches: branchIds,
        });
        await mentor.save();
        mentorMap[key] = { doc: mentor };
        console.log(`  ${key}: ${mentor._id} [${branchName}]`);
      }
    }
  }

  // 4. Create interns
  console.log("\n--- Creating interns ---");
  let internCount = 0;

  for (const [branchName, interns] of Object.entries(INTERNS_DATA)) {
    const branchId = branchMap[branchName];

    for (const intern of interns) {
      // Find mentor
      const mentorEntry = mentorMap[intern.mentorRef];
      if (!mentorEntry) {
        console.warn(`  WARNING: mentor "${intern.mentorRef}" not found for ${intern.username} — skipping`);
        continue;
      }
      const mentorId = mentorEntry.doc._id;

      const dateJoined = parseDate(intern.dateJoined);

      try {
        const doc = new Intern({
          name: intern.name,
          lastName: intern.lastName,
          username: intern.username,
          password: DEFAULT_PASSWORD,
          sphere: intern.sphere,
          grade: intern.grade,
          dateJoined,
          probationStartDate: dateJoined,
          branches: [
            {
              branch: branchId,
              mentor: mentorId,
              isHeadIntern: intern.isHeadIntern || false,
              joinedAt: dateJoined,
            },
          ],
        });
        await doc.save();
        internCount++;
        console.log(`  ${intern.name} ${intern.lastName} (@${intern.username}) → ${branchName} [${intern.grade}]`);
      } catch (err) {
        console.error(`  ERROR creating ${intern.username}: ${err.message}`);
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Branches: ${BRANCHES.length}`);
  console.log(`Mentors:  ${Object.keys(mentorMap).length}`);
  console.log(`Interns:  ${internCount}`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
