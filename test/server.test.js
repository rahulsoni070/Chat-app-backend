const { test, describe, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { io: connect } = require("socket.io-client");

process.env.JWT_SECRET = "test-secret";

const User = require("../models/User");
const Messages = require("../models/Messages");
const { createServer } = require("../app");

// In-memory stand-ins for the database; mongoose is never connected in these tests.
const users = {
  u1: { _id: "u1", username: "alice" },
  u2: { _id: "u2", username: "bob" },
};
const tokenFor = (id) => jwt.sign({ id }, process.env.JWT_SECRET);

let server;
let baseUrl;
let selectCalls;

const openSockets = [];
const connectAs = (token) =>
  new Promise((resolve, reject) => {
    const socket = connect(baseUrl, {
      auth: token ? { token } : {},
      transports: ["websocket"],
      reconnection: false,
    });
    openSockets.push(socket);
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });

const once = (socket, event) =>
  new Promise((resolve) => socket.once(event, resolve));

before(async () => {
  ({ server } = createServer());
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  openSockets.forEach((s) => s.close());
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  mock.restoreAll();
  selectCalls = [];
  mock.method(User, "findById", (id) => ({
    select: async (fields) => {
      selectCalls.push(fields);
      return users[id] || null;
    },
  }));
  mock.method(User, "exists", async ({ username }) =>
    Object.values(users).some((u) => u.username === username)
  );
});

describe("REST auth", () => {
  test("GET /users rejects requests without a token", async () => {
    const res = await fetch(`${baseUrl}/users`);
    assert.equal(res.status, 401);
  });

  test("GET /users rejects a forged token", async () => {
    const forged = jwt.sign({ id: "u1" }, "wrong-secret");
    const res = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: `Bearer ${forged}` },
    });
    assert.equal(res.status, 401);
  });

  test("GET /users excludes the caller and never selects the password", async () => {
    let filter;
    mock.method(User, "find", (f) => {
      filter = f;
      return {
        select: (fields) => {
          selectCalls.push(fields);
          return { sort: async () => [users.u2] };
        },
      };
    });

    const res = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: `Bearer ${tokenFor("u1")}` },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [users.u2]);
    assert.deepEqual(filter, { _id: { $ne: "u1" } });
    assert.ok(selectCalls.length > 0);
    assert.ok(selectCalls.every((fields) => fields === "-password"));
  });

  test("GET /messages uses the token identity, not the sender query", async () => {
    let filter;
    mock.method(Messages, "find", (f) => {
      filter = f;
      return { sort: async () => [] };
    });

    const res = await fetch(`${baseUrl}/messages?sender=mallory&receiver=bob`, {
      headers: { Authorization: `Bearer ${tokenFor("u1")}` },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(filter.$or, [
      { sender: "alice", receiver: "bob" },
      { sender: "bob", receiver: "alice" },
    ]);
  });

  test("GET /auth/me returns the token owner", async () => {
    const res = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${tokenFor("u2")}` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { username: "bob" });
  });
});

describe("socket auth", () => {
  test("connection without a token is refused", async () => {
    await assert.rejects(connectAs(null), /unauthorized/);
  });

  test("connection with an invalid token is refused", async () => {
    await assert.rejects(connectAs("not-a-jwt"), /unauthorized/);
  });

  test("send_message takes the sender from the token", async () => {
    let created;
    mock.method(Messages, "create", async (doc) => {
      created = doc;
      return { _id: "m1", status: "sent", ...doc };
    });

    const alice = await connectAs(tokenFor("u1"));
    const bob = await connectAs(tokenFor("u2"));

    const received = once(bob, "receive_message");
    const ack = await alice.emitWithAck("send_message", {
      sender: "mallory",
      receiver: "bob",
      message: "  hi bob  ",
    });

    assert.deepEqual(created, { sender: "alice", receiver: "bob", message: "hi bob" });
    assert.equal(ack.sender, "alice");
    assert.equal((await received).sender, "alice");
  });

  test("send_message rejects unknown receivers and oversized messages", async () => {
    const create = mock.method(Messages, "create", async (doc) => doc);
    const alice = await connectAs(tokenFor("u1"));

    const unknown = await alice.emitWithAck("send_message", { receiver: "nobody", message: "hi" });
    assert.match(unknown.error, /does not exist/);

    const tooLong = await alice.emitWithAck("send_message", {
      receiver: "bob",
      message: "x".repeat(2001),
    });
    assert.match(tooLong.error, /limited/);
    assert.equal(create.mock.callCount(), 0);
  });

  test("mark_as_read only touches messages addressed to the caller", async () => {
    const updateMany = mock.method(Messages, "updateMany", async () => ({}));
    const alice = await connectAs(tokenFor("u1"));
    const bob = await connectAs(tokenFor("u2"));

    const readEvent = once(alice, "messages_read");
    bob.emit("mark_as_read", { sender: "alice", receiver: "someone-else" });

    assert.deepEqual(await readEvent, { sender: "alice", receiver: "bob" });
    assert.deepEqual(updateMany.mock.calls[0].arguments[0], {
      sender: "alice",
      receiver: "bob",
      status: { $ne: "read" },
    });
  });

  test("typing events carry the authenticated sender", async () => {
    const alice = await connectAs(tokenFor("u1"));
    const bob = await connectAs(tokenFor("u2"));

    const typing = once(bob, "user_typing");
    alice.emit("typing", { sender: "mallory", receiver: "bob" });

    assert.equal((await typing).sender, "alice");
  });
});
