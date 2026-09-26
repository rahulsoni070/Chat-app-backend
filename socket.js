const User = require("./models/User");
const Messages = require("./models/Messages");
const { userFromToken } = require("./middleware/auth");

const MAX_MESSAGE_LENGTH = 2000;

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim().length > 0;

function registerSocketHandlers(io) {
  // username -> number of open sockets, used for online presence
  const onlineUsers = new Map();

  // Reject any socket that does not present a valid JWT.
  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth?.token);
      if (!user) return next(new Error("unauthorized"));
      socket.data.username = user.username;
      next();
    } catch (error) {
      console.error(error);
      next(new Error("server_error"));
    }
  });

  io.on("connection", (socket) => {
    // The identity always comes from the verified token, never from the client payload.
    const me = socket.data.username;
    socket.join(me);

    const openSockets = (onlineUsers.get(me) || 0) + 1;
    onlineUsers.set(me, openSockets);
    if (openSockets === 1) socket.broadcast.emit("user_online", me);
    socket.emit("online_users", [...onlineUsers.keys()]);

    // Kept for older clients: the room is already joined on connect.
    socket.on("join", () => socket.join(me));

    socket.on("send_message", async (data, callback) => {
      const reply = typeof callback === "function" ? callback : () => {};
      const receiver = data?.receiver;
      const message = typeof data?.message === "string" ? data.message.trim() : "";

      if (!isNonEmptyString(receiver) || !message) {
        return reply({ error: "Receiver and message are required." });
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        return reply({ error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.` });
      }

      try {
        if (!(await User.exists({ username: receiver }))) {
          return reply({ error: "That user does not exist." });
        }

        const newMessage = await Messages.create({ sender: me, receiver, message });
        io.to(receiver).emit("receive_message", newMessage);
        reply(newMessage);
      } catch (error) {
        console.error(error);
        reply({ error: "Could not send message." });
      }
    });

    socket.on("message_delivered", async (data) => {
      try {
        // Only the receiver can acknowledge delivery, and only once.
        const updated = await Messages.findOneAndUpdate(
          { _id: data?.messageId, receiver: me, status: "sent" },
          { status: "delivered" },
          { returnDocument: "after" }
        );
        if (updated) {
          io.to(updated.sender).emit("message_status_update", {
            messageId: String(updated._id),
            status: "delivered",
          });
        }
      } catch (error) {
        console.error(error);
      }
    });

    socket.on("mark_as_read", async (data) => {
      const sender = data?.sender;
      if (!isNonEmptyString(sender)) return;

      try {
        // Only messages addressed to the authenticated user can be marked read.
        await Messages.updateMany(
          { sender, receiver: me, status: { $ne: "read" } },
          { status: "read" }
        );
        io.to(sender).emit("messages_read", { sender, receiver: me });
      } catch (error) {
        console.error(error);
      }
    });

    socket.on("typing", (data) => {
      if (!isNonEmptyString(data?.receiver)) return;
      io.to(data.receiver).emit("user_typing", { sender: me, receiver: data.receiver });
    });

    socket.on("stop_typing", (data) => {
      if (!isNonEmptyString(data?.receiver)) return;
      io.to(data.receiver).emit("user_stop_typing", { sender: me, receiver: data.receiver });
    });

    socket.on("disconnect", () => {
      const remaining = (onlineUsers.get(me) || 1) - 1;
      if (remaining > 0) {
        onlineUsers.set(me, remaining);
      } else {
        onlineUsers.delete(me);
        io.emit("user_offline", me);
      }
    });
  });
}

module.exports = { registerSocketHandlers, MAX_MESSAGE_LENGTH };
