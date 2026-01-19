const mongoose = require("mongoose");

const notificationSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "userType", 
    required: true,
  },
  userType: {
    type: String,
    enum: ["intern", "mentor"],
    required: true,
  },
  endpoint: String,
  keys: {
    p256dh: String,
    auth: String,
  },
});

module.exports = mongoose.model("NotificationSubscription", notificationSubscriptionSchema);
