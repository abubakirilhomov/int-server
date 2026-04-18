const Intern = require("../models/internModel");

const XP_REWARDS = {
  lessonCreated: 10,
  fiveStarFeedback: 5,
  badgeEarned: 20,
  streakMilestone7: 50,
  streakMilestone14: 100,
  streakMilestone30: 200,
};

function calculateLevel(xp) {
  return Math.floor(Math.sqrt((xp || 0) / 100)) + 1;
}

function xpForLevel(level) {
  return (level - 1) * (level - 1) * 100;
}

function xpForNextLevel(level) {
  return level * level * 100;
}

async function awardXP(internId, amount, reason) {
  if (!amount || amount <= 0) return;

  const intern = await Intern.findById(internId).select("xp level");
  if (!intern) return;

  intern.xp = (intern.xp || 0) + amount;
  intern.level = calculateLevel(intern.xp);
  await intern.save();

  return { xp: intern.xp, level: intern.level, awarded: amount };
}

module.exports = {
  XP_REWARDS,
  calculateLevel,
  xpForLevel,
  xpForNextLevel,
  awardXP,
};
