const mongoose = require("mongoose")

const messageSchema = new mongoose.Schema(
    {
        sender: { type: String, required: true },
        receiver: { type: String, required: true },
        message: { type: String, required: true },
        status: { type: String, default: "sent" },
    },
    { timestamps: true }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: 1 });
messageSchema.index({ receiver: 1, status: 1 });

module.exports = mongoose.model("Messages", messageSchema);
