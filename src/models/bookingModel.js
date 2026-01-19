const mongoose = require("mongoose");
const Mentor = require("./mentorModel");
const Branch = require("./branchModel");



const UserSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        surname: { type: String, required: true },
        mentor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Mentor",
            required: true,
        },
        branch: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Branch",
            required: true,
        },
        grade: { type: String, required: true },
        tellegrammUsername: {
            type: String,
            required: true,
            unique: true,
        },
        phone: {
            type: String,
            required: true,
            unique: true,
        },

        yearsOfStudy: { type: Number, required: true },

        direction: {
            type: String,
            enum: ["backend", "frontend", "fullstack"],
            required: true,
        },
        date: {
            type: Date,
            required: true,
            default: Date.now,
        },
        status: {
            type: String,
            ruquired: true,
            enum: ["canceled", "pending", "approved"],
            default: "pending"
        },
        aboutYourself: {
            type: String,
            default: "",
        },
        whatYouKnow: {
            type: String,
            default: "",
        },
        projectLink: {
            type: String,
            required: true,
            default: "",
        },


    },
    { timestamps: true }
);

module.exports = mongoose.model("InternUser", UserSchema);
