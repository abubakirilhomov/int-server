/**
 * Seed initial applicationRouting Setting.
 * Mirrors the hard-coded routing previously in internUp/src/App.jsx:236-243.
 *
 * Safe to re-run: upserts by `key`. If the doc already exists, it will be
 * overwritten with the values below — edit it after first run via the
 * settings admin UI rather than re-seeding.
 *
 * Usage:
 *   cd int-server
 *   node scripts/seed-application-routing.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Setting = require("../src/models/settingModel");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

// Routing mirror of the legacy internUp client logic. Fallback points to
// Abubakir so a new sphere added to grades.js without a routing update never
// silently drops. alwaysInclude duplicates every application to the shared
// MARS lead group, like the old client-side bot did.
//
// Chat IDs updated 2026-05-24 with the authoritative values from the team
// (Nuriddin's prior 6255299983 was stale).
const ABUBAKIR = "1844909205";
const NURIDDIN = "1921911753";
const MAIN_GROUP = "-5297765126";

const ROUTING = {
  routes: [
    { spheres: ["backend-python"], chatIds: [NURIDDIN] },
    {
      spheres: ["frontend-react", "backend-nodejs", "full-stack"],
      chatIds: [ABUBAKIR],
    },
    { spheres: ["mern-stack"], chatIds: [ABUBAKIR, NURIDDIN] },
  ],
  fallbackChatIds: [ABUBAKIR],
  alwaysInclude: [MAIN_GROUP],
};

(async () => {
  await mongoose.connect(MONGODB_URI);
  await Setting.findOneAndUpdate(
    { key: "applicationRouting" },
    { key: "applicationRouting", value: ROUTING },
    { upsert: true, new: true }
  );
  console.log("✅ applicationRouting seeded:", JSON.stringify(ROUTING, null, 2));
  await mongoose.disconnect();
})().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
