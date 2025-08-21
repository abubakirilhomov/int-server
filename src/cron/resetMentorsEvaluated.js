const mongoose = require('mongoose');
const cron = require('node-cron');
const Intern = require('../models/internModel');

const resetMentorsEvaluated = () => {
  cron.schedule('0 0 * * 1', async () => {
    try {
      console.log('Clearing mentorsEvaluated for all interns...');
      await Intern.updateMany({}, { $set: { mentorsEvaluated: {} } });
      console.log('mentorsEvaluated cleared successfully.');
    } catch (error) {
      console.error('Error clearing mentorsEvaluated:', error);
    }
  });
};

module.exports = resetMentorsEvaluated;