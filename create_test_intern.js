const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const connectDB = require("./src/config/database");

// Models
const Branch = require("./src/models/branchModel");
const Mentor = require("./src/models/mentorModel");
const Intern = require("./src/models/internModel");

const createIntern = async () => {
    try {
        await connectDB();

        // Find dependencies
        const branch = await Branch.findOne();
        if (!branch) throw new Error("No branches found");

        const mentor = await Mentor.findOne();
        if (!mentor) throw new Error("No mentors found");

        const username = "testintern_" + Date.now();
        const password = "password123";

        const intern = await Intern.create({
            name: "Test",
            lastName: "Intern",
            username: username,
            password: password,
            branch: branch._id,
            mentor: mentor._id,
            grade: "junior",
            probationStartDate: new Date(),
            dateJoined: new Date()
        });

        console.log("SUCCESS");
        console.log("Username:", username);
        console.log("Password:", password);

    } catch (err) {
        console.error("ERROR:", err);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
};

createIntern();
