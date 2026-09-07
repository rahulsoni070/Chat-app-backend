const express = require("express")
const mongoose = require("mongoose")
const cors = require("cors")
const dotenv = require("dotenv")
const authRoutes = require("./routes/auth")
const http = require("http");
const { Server } = require("socket.io")
const User = require("./models/User")
const Messages = require("./models/Messages")

dotenv.config();

const app = express()
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
  },
});

app.use(cors())
app.use(express.json());

mongoose
.connect(process.env.MONGO_URI)
.then(() => console.log("Mongodb connected."))
.catch((error) => {
  console.error(error);
  process.exit(1);
})

app.use("/auth", authRoutes)

// socket io logic
io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  socket.on("join", (username) => {
    socket.join(username);
    console.log(`${username} joined their room`);
  });

  socket.on("send_message", async (data, callback) => {
    const { sender, receiver, message } = data;
    const newMessage = new Messages({ sender, receiver, message });
    await newMessage.save();

    io.to(receiver).emit("receive_message", newMessage);

    if (callback) callback(newMessage);
  });

  socket.on("message_delivered", async ({ messageId }) => {
    const updated = await Messages.findByIdAndUpdate(
      messageId,
      { status: "delivered" },
      { new: true }
    );
    if (updated) {
      io.to(updated.sender).emit("message_status_update", {
        messageId,
        status: "delivered",
      });
    }
  });

  socket.on("mark_as_read", async ({ sender, receiver }) => {
    await Messages.updateMany(
      { sender, receiver, status: { $ne: "read" } },
      { status: "read" }
    );
    io.to(sender).emit("messages_read", { sender, receiver });
  });

  socket.on("typing", (data) => {
    io.to(data.receiver).emit("user_typing", data);
  });

  socket.on("stop_typing", (data) => {
    io.to(data.receiver).emit("user_stop_typing", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected", socket.id);
  });
});

app.get("/messages", async (req, res) => {
  const { sender, receiver } = req.query;
  try {
    const messages = await Messages.find({
      $or: [
        { sender, receiver },
        { sender: receiver, receiver: sender },
      ],
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages" });
  }
});

app.get("/users", async (req, res) => {
  const { currentUser } = req.query;
  try {
    const users = await User.find({ username: { $ne: currentUser } });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error fetching users" });
  }
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));