// Каким способом собеседовать трек: живой режим по банку или старый чек-лист.
// Живой — только если трек в bankTracks И у него есть хотя бы один активный
// набор. Так backend-nodejs остаётся на чек-листе, пока банк не наполнят.
const InterviewSet = require("../models/interviewSetModel");
const { getCandidateInterviewConfig } = require("../config/candidateInterviews");

async function resolveInterviewMode(track, cfg) {
  const config = cfg || (await getCandidateInterviewConfig());
  if (!config.bankTracks.includes(track)) return "checklist";
  const hasSet = await InterviewSet.exists({ track, isActive: true, size: { $gt: 0 } });
  return hasSet ? "live" : "checklist";
}

async function interviewModes(tracks) {
  const cfg = await getCandidateInterviewConfig();
  const list = tracks || cfg.bankTracks;
  const modes = await Promise.all(list.map((t) => resolveInterviewMode(t, cfg)));
  return Object.fromEntries(list.map((t, i) => [t, modes[i]]));
}

module.exports = { resolveInterviewMode, interviewModes };
