const mongoose = require("mongoose");

const notificationSubscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: "userType", // динамическая ссылка (intern или mentor)
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
