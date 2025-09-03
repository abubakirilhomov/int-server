import mongoose from "mongoose";

const ruleSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      enum: ["green", "yellow", "red", "black"],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    example: {
      type: String,
      default: "",
    },
    consequence: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Rule", ruleSchema);
