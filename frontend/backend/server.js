import 'dotenv/config';

  res.json({ ok: true, readBy: msg.readBy });
});

app.post('/messages/:id/reaction', auth, async (req, res) => {
  const { emoji } = req.body;
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ error: 'not found' });

  msg.reactions = msg.reactions.filter(r => r.userPublicKey !== req.user.publicKey);
  msg.reactions.push({ userPublicKey: req.user.publicKey, emoji });
  await msg.save();

  io.to(`chat:${msg.chatType}:${msg.chatId}`).emit('message:reaction', {
    messageId: msg._id.toString(),
    reactions: msg.reactions
  });

  res.json({ ok: true, reactions: msg.reactions });
});

const onlineUsers = new Map();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('No token'));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Auth failed'));
  }
});

io.on('connection', async socket => {
  const user = socket.user;
  onlineUsers.set(user.publicKey, socket.id);

  user.online = true;
  user.lastSeenAt = new Date();
  await user.save();

  socket.join(`user:${user.publicKey}`);
  io.emit('user:status', {
    publicKey: user.publicKey,
    online: true,
    lastSeenAt: user.lastSeenAt
  });

  socket.on('chat:join', ({ chatType, chatId }) => {
    socket.join(`chat:${chatType}:${chatId}`);
  });

  socket.on('chat:leave', ({ chatType, chatId }) => {
    socket.leave(`chat:${chatType}:${chatId}`);
  });

  socket.on('disconnect', async () => {
    onlineUsers.delete(user.publicKey);
    user.online = false;
    user.lastSeenAt = new Date();
    await user.save();
    io.emit('user:status', {
      publicKey: user.publicKey,
      online: false,
      lastSeenAt: user.lastSeenAt
    });
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});