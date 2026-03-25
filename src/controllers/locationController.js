const Location = require("../models/locationModel");
const Intern = require("../models/internModel");

// POST /api/locations/update — intern JWT
exports.updateLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ message: "lat и lng должны быть числами" });
    }
    if (lat < -90 || lat > 90) {
      return res.status(400).json({ message: "lat должен быть от -90 до 90" });
    }
    if (lng < -180 || lng > 180) {
      return res.status(400).json({ message: "lng должен быть от -180 до 180" });
    }

    const location = await Location.findOneAndUpdate(
      { intern: req.user.id },
      { lat, lng, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({ data: location });
  } catch (err) {
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// DELETE /api/locations/stop — intern JWT
exports.stopSharing = async (req, res) => {
  try {
    await Location.deleteOne({ intern: req.user.id });
    res.json({ message: "Геопозиция отключена" });
  } catch (err) {
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// GET /api/locations/my-interns — mentor JWT
exports.getMentorInternLocations = async (req, res) => {
  try {
    const mentorId = req.user.id;

    // Find all interns where this mentor is assigned
    const interns = await Intern.find(
      { "branches.mentor": mentorId },
      { _id: 1, name: 1, lastName: 1, grade: 1, profilePhoto: 1 }
    ).lean();

    if (!interns.length) {
      return res.json({ data: [] });
    }

    const internIds = interns.map((i) => i._id);

    // Find locations updated within the last 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const locations = await Location.find({
      intern: { $in: internIds },
      updatedAt: { $gte: tenMinAgo },
    }).lean();

    // Map intern data onto locations
    const internMap = {};
    for (const intern of interns) {
      internMap[intern._id.toString()] = intern;
    }

    const result = locations.map((loc) => {
      const intern = internMap[loc.intern.toString()] || {};
      return {
        internId: loc.intern,
        name: intern.name || "",
        lastName: intern.lastName || "",
        grade: intern.grade || "",
        profilePhoto: intern.profilePhoto || "",
        lat: loc.lat,
        lng: loc.lng,
        updatedAt: loc.updatedAt,
      };
    });

    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ message: "Ошибка сервера" });
  }
};
