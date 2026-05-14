/**
 * Adds the Oybek branch to the database.
 *
 * Idempotent: if a branch with name "Oybek" or "Ойбек" already exists, the
 * script updates its address + location and exits without creating a
 * duplicate. Safe to re-run.
 *
 * Usage:
 *   cd int-server
 *   node scripts/add-oybek-branch.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Branch = require("../src/models/branchModel");

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGO_URI not set in .env");
  process.exit(1);
}

const PAYLOAD = {
  name: "Ойбек",
  city: "Ташкент",
  address: "Ташкент, метро Ойбек",
  location: {
    lat: 41.301370,
    lng: 69.276045,
  },
};

(async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");

    // Match either spelling — protect against accidental duplicate.
    const existing = await Branch.findOne({
      name: { $in: ["Ойбек", "Oybek", "oybek"] },
    });

    if (existing) {
      existing.city = PAYLOAD.city;
      existing.address = PAYLOAD.address;
      existing.location = PAYLOAD.location;
      if (existing.name !== PAYLOAD.name) {
        existing.name = PAYLOAD.name;
      }
      await existing.save();
      console.log(
        `Updated existing branch _id=${existing._id}: lat=${PAYLOAD.location.lat}, lng=${PAYLOAD.location.lng}`
      );
    } else {
      const created = await Branch.create(PAYLOAD);
      console.log(`Created new branch _id=${created._id}: ${created.name}`);
    }
  } catch (err) {
    console.error("Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
