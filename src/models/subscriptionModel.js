const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            refPath: "userType",
        },
        userType: {
            type: String,
            required: true,
            enum: ["mentor", "intern", "Mentor", "Intern"], // Support both cases
        },
        endpoint: {
            type: String,
            required: true,
        },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true },
        },
    },
    { timestamps: true }
);

// Index for fast lookup by userId
subscriptionSchema.index({ userId: 1, userType: 1 });

// Prevent duplicate subscriptions (same endpoint)
subscriptionSchema.index({ endpoint: 1 }, { unique: true });

module.exports = mongoose.model("Subscription", subscriptionSchema);
