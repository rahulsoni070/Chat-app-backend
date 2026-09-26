const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const authRoutes = require("./routes/auth");
const User = require("./models/User");
const Messages = require("./models/Messages");
const { requireAuth } = require("./middleware/auth");
const { registerSocketHandlers } = require("./socket");

// CLIENT_URL may hold a comma-separated list of allowed origins.
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function createServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: allowedOrigins } });

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (req, res) => res.json({ status: "ok" }));

  app.use("/auth", authRoutes);

  app.get("/users", requireAuth, async (req, res) => {
    try {
      const users = await User.find({ _id: { $ne: req.user._id } })
        .select("-password")
        .sort({ username: 1 });
      res.json(users);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching users" });
    }
  });

  // Conversation between the authenticated user and ?with=<username>.
  // ?receiver= is still accepted for older clients; ?sender= is ignored.
  app.get("/messages", requireAuth, async (req, res) => {
    const me = req.user.username;
    const other = req.query.with || req.query.receiver;

    if (typeof other !== "string" || !other) {
      return res.status(400).json({ message: "Query parameter 'with' is required." });
    }

    try {
      const messages = await Messages.find({
        $or: [
          { sender: me, receiver: other },
          { sender: other, receiver: me },
        ],
      }).sort({ createdAt: 1 });
      res.json(messages);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching messages" });
    }
  });

  // Unread message counts for the authenticated user, keyed by sender.
  app.get("/messages/unread", requireAuth, async (req, res) => {
    try {
      const rows = await Messages.aggregate([
        { $match: { receiver: req.user.username, status: { $ne: "read" } } },
        { $group: { _id: "$sender", count: { $sum: 1 } } },
      ]);
      res.json(Object.fromEntries(rows.map((row) => [row._id, row.count])));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Error fetching unread counts" });
    }
  });

  registerSocketHandlers(io);

  return { app, server, io };
}

module.exports = { createServer };
