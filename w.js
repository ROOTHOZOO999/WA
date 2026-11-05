// =====================================================
// HOZOO MD WHATSAPP CLONE PROMAX - SINGLE FILE BUILD
// VPS READY - FIXED VERSION
// =====================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const multer = require('multer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static('uploads'));

// =================== PASTIKAN FOLDER UPLOADS ADA ===================
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads', { recursive: true });
  console.log('📁 Folder uploads dibuat');
}

// =================== KONEKSI MONGODB (VPS-FRIENDLY) ===================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hozoo_whatsapp_promax';
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB error:', err.message);
    console.error('💡 Pastikan MongoDB sudah terinstall dan berjalan di VPS!');
    console.error('   Jalankan: sudo systemctl start mongod');
    process.exit(1);
  });

// =================== SCHEMA ===================
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  displayName: { type: String, default: '' },
  avatar: { type: String, default: '' },
  bio: { type: String, default: 'Hey there! I am using HOZOO MD.' },
  verified: { type: Boolean, default: false },
  online: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String,
  media: String,
  mediaType: String,
  voiceNote: String,
  sticker: String,
  gif: String,
  location: { lat: Number, lng: Number },
  reactions: [{ emoji: String, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  edited: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  scheduled: Date,
  autoDelete: Date,
  encrypted: Boolean,
  delivered: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const StatusSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['image', 'video', 'text'], required: true },
  content: String,
  caption: String,
  viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) }
});
const Status = mongoose.model('Status', StatusSchema);

// =================== ENKRIPSI ===================
const ENCRYPTION_KEY = crypto.randomBytes(32);
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// =================== MULTER ===================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s/g, '_'));
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
});

// =================== AUTH ===================
const JWT_SECRET = 'hozoo_super_secret_key_2026';

app.post('/register', upload.single('avatar'), async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ error: 'Username sudah dipakai' });
    const hashed = await bcrypt.hash(password, 10);
    const avatarUrl = req.file ? '/uploads/' + req.file.filename : '';
    const user = await User.create({
      username, password: hashed,
      displayName: displayName || username,
      avatar: avatarUrl, verified: false
    });
    res.json({ message: 'Registrasi sukses! Silakan login.', userId: user._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User tidak ditemukan' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Password salah' });
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    await User.findByIdAndUpdate(user._id, { online: true, lastSeen: new Date() });
    res.json({
      token, userId: user._id, username: user.username,
      displayName: user.displayName, avatar: user.avatar,
      verified: user.verified, bio: user.bio
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== MIDDLEWARE ===================
function authMiddleware(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Token tidak ada' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token tidak valid' });
  }
}

// =================== API ===================
app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId).select('-password');
  res.json(user);
});

app.put('/api/profile', authMiddleware, upload.single('avatar'), async (req, res) => {
  const { displayName, bio } = req.body;
  const update = {};
  if (displayName) update.displayName = displayName;
  if (bio !== undefined) update.bio = bio;
  if (req.file) update.avatar = '/uploads/' + req.file.filename;
  const user = await User.findByIdAndUpdate(req.userId, update, { new: true }).select('-password');
  res.json(user);
});

app.get('/api/chats', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId).select('-password');
  const allUsers = await User.find({ _id: { $ne: req.userId } }).select('username displayName avatar online lastSeen verified');
  const messages = await Message.find({
    $or: [{ sender: req.userId }, { receiver: req.userId }],
    deleted: false
  }).sort({ createdAt: -1 }).limit(200).populate('sender', 'username displayName avatar verified');
  res.json({ user, allUsers, messages: messages.reverse() });
});

app.post('/api/message', authMiddleware, async (req, res) => {
  try {
    const { receiver, text, media, mediaType, voiceNote, sticker, gif, location, replyTo, scheduled, autoDelete } = req.body;
    let encryptedText = null;
    if (text) encryptedText = encrypt(text);
    const msg = await Message.create({
      sender: req.userId, receiver, text: encryptedText,
      media, mediaType, voiceNote, sticker, gif, location, replyTo,
      encrypted: !!text,
      scheduled: scheduled ? new Date(scheduled) : null,
      autoDelete: autoDelete ? new Date(autoDelete) : null,
      readBy: [req.userId],
      delivered: scheduled ? false : true
    });
    if (scheduled && new Date(scheduled) > new Date()) {
      return res.json({ message: 'Pesan terjadwal', msgId: msg._id });
    }
    const populated = await Message.findById(msg._id).populate('sender', 'username displayName avatar verified');
    io.emit('new-message', populated);
    res.json({ msgId: msg._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/message/:id', authMiddleware, async (req, res) => {
  const { text } = req.body;
  const msg = await Message.findById(req.params.id);
  if (!msg || msg.sender.toString() !== req.userId) return res.status(403).json({ error: 'Tidak diizinkan' });
  msg.text = encrypt(text);
  msg.edited = true;
  await msg.save();
  io.emit('message-edited', { id: msg._id, text, edited: true });
  res.json({ success: true });
});

app.delete('/api/message/:id', authMiddleware, async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Tidak ditemukan' });
  msg.deleted = true;
  await msg.save();
  io.emit('message-deleted', msg._id);
  res.json({ success: true });
});

app.post('/api/message/:id/react', authMiddleware, async (req, res) => {
  const { emoji } = req.body;
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Tidak ditemukan' });
  msg.reactions = msg.reactions.filter(r => r.user.toString() !== req.userId);
  if (emoji) msg.reactions.push({ emoji, user: req.userId });
  await msg.save();
  io.emit('message-reaction', { id: msg._id, reactions: msg.reactions });
  res.json({ success: true });
});

app.get('/api/message/:id/read', authMiddleware, async (req, res) => {
  const msg = await Message.findById(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Tidak ditemukan' });
  if (!msg.readBy.includes(req.userId)) {
    msg.readBy.push(req.userId);
    await msg.save();
    io.emit('message-read', { id: msg._id, userId: req.userId });
  }
  res.json({ success: true });
});

// STATUS
app.post('/api/status', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const { type, content, caption } = req.body;
    let statusContent = content;
    if (req.file) statusContent = '/uploads/' + req.file.filename;
    const status = await Status.create({
      user: req.userId,
      type: type || (req.file ? (req.file.mimetype.startsWith('video') ? 'video' : 'image') : 'text'),
      content: statusContent,
      caption: caption || ''
    });
    const populated = await Status.findById(status._id).populate('user', 'username displayName avatar verified');
    io.emit('new-status', populated);
    res.json({ status: populated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', authMiddleware, async (req, res) => {
  const statuses = await Status.find({ expiresAt: { $gt: new Date() } })
    .populate('user', 'username displayName avatar verified')
    .populate('viewers', 'username displayName avatar')
    .sort({ createdAt: -1 });
  const grouped = {};
  statuses.forEach(s => {
    if (!grouped[s.user._id]) grouped[s.user._id] = { user: s.user, statuses: [] };
    grouped[s.user._id].statuses.push(s);
  });
  res.json(Object.values(grouped));
});

app.post('/api/status/:id/view', authMiddleware, async (req, res) => {
  const status = await Status.findById(req.params.id);
  if (!status) return res.status(404).json({ error: 'Status tidak ditemukan' });
  if (!status.viewers.includes(req.userId)) {
    status.viewers.push(req.userId);
    await status.save();
    io.emit('status-viewed', { statusId: status._id, viewerId: req.userId, totalViewers: status.viewers.length });
  }
  res.json({ success: true, totalViewers: status.viewers.length });
});

// VERIFIED
app.post('/api/verify/:userId', async (req, res) => {
  const { secret } = req.body;
  if (secret !== 'HOZOO_VERIFY_SECRET_2026') return res.status(403).json({ error: 'Akses ditolak' });
  const user = await User.findByIdAndUpdate(req.params.userId, { verified: true }, { new: true }).select('-password');
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });
  io.emit('user-verified', { userId: user._id, verified: true });
  res.json({ success: true, user });
});

// =================== SOCKET ===================
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('register-user', async (userId) => {
    socket.userId = userId;
    await User.findByIdAndUpdate(userId, { online: true });
    io.emit('user-online', { userId, online: true });
  });

  socket.on('typing', ({ to }) => {
    const target = [...io.sockets.sockets.values()].find(s => s.userId === to);
    if (target) target.emit('typing', { userId: socket.userId });
  });

  socket.on('voice-call', ({ to, sdp }) => {
    const target = [...io.sockets.sockets.values()].find(s => s.userId === to);
    if (target) target.emit('incoming-call', { from: socket.userId, sdp, type: 'voice' });
  });

  socket.on('video-call', ({ to, sdp }) => {
    const target = [...io.sockets.sockets.values()].find(s => s.userId === to);
    if (target) target.emit('incoming-call', { from: socket.userId, sdp, type: 'video' });
  });

  socket.on('call-answer', ({ to, sdp }) => {
    const target = [...io.sockets.sockets.values()].find(s => s.userId === to);
    if (target) target.emit('call-answered', { from: socket.userId, sdp });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const target = [...io.sockets.sockets.values()].find(s => s.userId === to);
    if (target) target.emit('ice-candidate', { from: socket.userId, candidate });
  });

  socket.on('disconnect', async () => {
    if (socket.userId) {
      await User.findByIdAndUpdate(socket.userId, { online: false, lastSeen: new Date() });
      io.emit('user-offline', { userId: socket.userId });
    }
  });
});

// =================== SCHEDULER ===================
setInterval(async () => {
  try {
    const now = new Date();
    await Message.deleteMany({ autoDelete: { $lte: now } });
    const scheduled = await Message.find({ scheduled: { $lte: now }, delivered: false });
    for (const msg of scheduled) {
      msg.delivered = true;
      await msg.save();
      const populated = await Message.findById(msg._id).populate('sender', 'username displayName avatar verified');
      io.emit('new-message', populated);
    }
    await Status.deleteMany({ expiresAt: { $lte: now } });
  } catch (e) { /* silent */ }
}, 10000);

// =====================================================
// FRONTEND HTML (INLINE) - MOBILE-FIRST
// =====================================================
const HTML_PAGE = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#111b21">
<title>HOZOO MD Chat ProMax</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif;-webkit-tap-highlight-color:transparent;}
body{background:#111b21;color:#e9edef;height:100dvh;display:flex;overflow:hidden;position:fixed;width:100%;top:0;left:0;}
#auth-screen{width:100%;height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#111b21,#005c4b);padding:20px;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);}
#auth-screen h1{color:#00a884;font-size:2rem;margin-bottom:20px;text-align:center;}
.form-box{background:#202c33;padding:25px 20px;border-radius:15px;width:100%;max-width:400px;box-shadow:0 0 30px rgba(0,0,0,0.5);}
.form-box h2{margin-bottom:15px;text-align:center;font-size:1.3rem;}
#auth-screen input,#auth-screen button{width:100%;padding:14px;margin:8px 0;border-radius:10px;border:none;font-size:16px;}
#auth-screen input[type="text"],#auth-screen input[type="password"],#auth-screen input[type="file"]{background:#2a3942;color:white;}
#auth-screen button{background:#00a884;color:white;cursor:pointer;font-weight:bold;font-size:16px;}
#auth-screen button:hover{background:#00c9a7;}
.toggle-link{text-align:center;margin-top:12px;color:#8696a0;cursor:pointer;font-size:14px;}
.toggle-link span{color:#00a884;font-weight:bold;}
#register-box{display:none;}
#app-screen{display:none;width:100%;height:100dvh;display:flex;position:relative;overflow:hidden;}
#sidebar{width:100%;height:100dvh;background:#202c33;display:flex;flex-direction:column;position:absolute;top:0;left:0;z-index:10;transition:transform 0.3s ease;padding-top:env(safe-area-inset-top);}
#sidebar.hidden-mobile{transform:translateX(-100%);}
#sidebar-header{background:#2a3942;padding:12px 15px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.my-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover;margin-right:10px;background:#00a884;display:inline-flex;align-items:center;justify-content:center;font-weight:bold;color:white;overflow:hidden;flex-shrink:0;}
.my-avatar img{width:100%;height:100%;object-fit:cover;}
.my-name{font-weight:bold;flex:1;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.verified-badge{display:inline-block;width:16px;height:16px;background:#00a884;border-radius:50%;color:white;font-size:10px;text-align:center;line-height:16px;margin-left:5px;flex-shrink:0;}
#tabs{display:flex;background:#202c33;flex-shrink:0;}
#tabs button{flex:1;padding:14px;background:transparent;border:none;color:#8696a0;cursor:pointer;font-weight:bold;border-bottom:3px solid transparent;font-size:14px;}
#tabs button.active{color:#00a884;border-bottom-color:#00a884;}
#chat-list,#status-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.chat-item,.status-item{padding:12px 15px;cursor:pointer;border-bottom:1px solid #2a3942;display:flex;align-items:center;}
.chat-item:hover,.status-item:hover{background:#2a3942;}
.chat-item:active,.status-item:active{background:#2a3942;}
.avatar{width:48px;height:48px;border-radius:50%;background:#00a884;display:flex;align-items:center;justify-content:center;margin-right:12px;font-weight:bold;color:white;overflow:hidden;flex-shrink:0;font-size:18px;}
.avatar img{width:100%;height:100%;object-fit:cover;}
.online-dot{width:10px;height:10px;border-radius:50%;background:#00a884;display:inline-block;margin-left:5px;}
.offline-dot{width:10px;height:10px;border-radius:50%;background:#8696a0;display:inline-block;margin-left:5px;}
.verified-badge-small{display:inline-block;width:14px;height:14px;background:#00a884;border-radius:50%;color:white;font-size:9px;text-align:center;line-height:14px;margin-left:3px;}
#main{width:100%;height:100dvh;display:none;flex-direction:column;position:absolute;top:0;left:0;z-index:20;background:#0b141a;padding-top:env(safe-area-inset-top);}
#main.active{display:flex;}
#chat-header{padding:10px 12px;background:#202c33;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #2a3942;flex-shrink:0;gap:8px;}
.chat-info{display:flex;align-items:center;flex:1;overflow:hidden;}
.chat-info span{font-weight:bold;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.back-btn{background:transparent;border:none;color:#00a884;font-size:24px;cursor:pointer;margin-right:5px;padding:0 5px;}
#messages{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:4px;background:#0b141a;-webkit-overflow-scrolling:touch;}
.msg{max-width:80%;padding:8px 12px;border-radius:10px;word-wrap:break-word;position:relative;font-size:15px;line-height:1.4;}
.msg.sent{align-self:flex-end;background:#005c4b;border-bottom-right-radius:3px;}
.msg.received{align-self:flex-start;background:#202c33;border-bottom-left-radius:3px;}
.msg .time{font-size:10px;color:#8696a0;text-align:right;margin-top:2px;}
.msg .reactions{font-size:13px;margin-top:2px;}
.msg .reply-quote{font-size:11px;color:#aaa;border-left:2px solid #00a884;padding-left:5px;margin-bottom:3px;}
.msg .read-status{font-size:10px;margin-left:3px;color:#53bdeb;}
.msg .sender-name{font-size:11px;color:#00a884;font-weight:bold;margin-bottom:2px;}
.msg img,.msg video{max-width:100%;border-radius:8px;margin-top:3px;display:block;}
#typing-indicator{padding:5px 12px;font-size:12px;color:#8696a0;min-height:22px;flex-shrink:0;}
#input-area{padding:8px 10px;background:#202c33;display:flex;align-items:center;gap:5px;flex-wrap:nowrap;flex-shrink:0;padding-bottom:calc(8px + env(safe-area-inset-bottom));}
#input-area input[type="text"]{flex:1;padding:12px 15px;border-radius:25px;border:none;background:#2a3942;color:white;outline:none;font-size:15px;min-width:0;}
#input-area button{padding:8px;border-radius:50%;border:none;background:#00a884;color:white;cursor:pointer;flex-shrink:0;font-size:16px;}
.icon-btn{background:transparent!important;font-size:20px;border:none;color:#00a884;cursor:pointer;padding:6px!important;flex-shrink:0;}
#status-viewer{position:fixed;top:0;left:0;width:100%;height:100dvh;background:rgba(0,0,0,0.97);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:2000;padding:10px;}
#status-viewer img,#status-viewer video{max-width:100%;max-height:75vh;border-radius:10px;}
.status-caption{color:white;margin-top:15px;text-align:center;font-size:15px;padding:0 20px;}
.status-nav{position:absolute;top:50%;transform:translateY(-50%);width:100%;display:flex;justify-content:space-between;padding:0 10px;}
.status-nav button{background:rgba(255,255,255,0.3);border:none;color:white;font-size:28px;padding:10px 18px;border-radius:50%;cursor:pointer;}
.status-header{position:absolute;top:calc(15px + env(safe-area-inset-top));left:15px;display:flex;align-items:center;color:white;font-size:14px;max-width:70%;}
.status-viewers-info{position:absolute;bottom:calc(15px + env(safe-area-inset-bottom));color:#8696a0;font-size:14px;}
.close-status{position:absolute;top:calc(15px + env(safe-area-inset-top));right:15px;background:rgba(255,0,0,0.6);color:white;border:none;padding:8px 15px;border-radius:20px;cursor:pointer;font-size:14px;}
#emoji-picker{display:flex;gap:5px;flex-wrap:wrap;padding:8px;background:#2a3942;border-radius:8px;position:absolute;bottom:60px;left:10px;right:10px;display:none;z-index:100;max-height:180px;overflow-y:auto;}
#emoji-picker span{cursor:pointer;font-size:24px;padding:3px;}
#call-modal{position:fixed;top:0;left:0;width:100%;height:100dvh;background:rgba(0,0,0,0.97);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:3000;padding:10px;}
#call-modal video{width:100%;max-height:65vh;background:black;border-radius:10px;}
#call-modal button{margin:10px;padding:14px 30px;border-radius:25px;border:none;background:#ff3b30;color:white;cursor:pointer;font-size:16px;}
#schedule-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#202c33;padding:20px;border-radius:15px;display:none;z-index:2500;width:calc(100% - 30px);max-width:400px;}
#schedule-modal h3{margin-bottom:10px;font-size:16px;}
#schedule-modal input,#schedule-modal button{display:block;margin:10px 0;padding:12px;width:100%;border-radius:8px;border:none;background:#2a3942;color:white;font-size:15px;}
#schedule-modal button{background:#00a884;cursor:pointer;font-weight:bold;}
#status-creator{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#202c33;padding:20px;border-radius:15px;display:none;z-index:2500;width:calc(100% - 30px);max-width:400px;}
#status-creator h3{margin-bottom:10px;font-size:16px;}
#status-creator input,#status-creator textarea,#status-creator button{display:block;margin:10px 0;padding:12px;width:100%;border-radius:8px;border:none;background:#2a3942;color:white;font-size:15px;}
#status-creator button{background:#00a884;cursor:pointer;font-weight:bold;}
#profile-edit-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#202c33;padding:20px;border-radius:15px;display:none;z-index:2500;width:calc(100% - 30px);max-width:400px;}
#profile-edit-modal h3{margin-bottom:10px;font-size:16px;}
#profile-edit-modal input,#profile-edit-modal button{display:block;margin:10px 0;padding:12px;width:100%;border-radius:8px;border:none;background:#2a3942;color:white;font-size:15px;}
#profile-edit-modal button{background:#00a884;cursor:pointer;font-weight:bold;}
.hidden{display:none!important;}
@media (min-width: 768px) {
  #sidebar{width:30%;min-width:300px;position:relative;transform:none!important;}
  #main{position:relative;display:flex!important;width:70%;}
  #app-screen{flex-direction:row;}
  #sidebar.hidden-mobile{transform:none;}
  .back-btn{display:none;}
  body{position:static;}
  #auth-screen h1{font-size:2.5rem;}
}
</style>
</head>
<body>
<div id="auth-screen">
  <h1>📱 HOZOO MD</h1>
  <div class="form-box" id="login-box">
    <h2>Login</h2>
    <input type="text" id="login-username" placeholder="Username">
    <input type="password" id="login-password" placeholder="Password">
    <button onclick="login()">Login</button>
    <div class="toggle-link" onclick="showRegister()">Belum punya akun? <span>Registrasi</span></div>
  </div>
  <div class="form-box" id="register-box">
    <h2>Registrasi</h2>
    <input type="text" id="reg-username" placeholder="Username">
    <input type="text" id="reg-displayname" placeholder="Nama Tampilan">
    <input type="password" id="reg-password" placeholder="Password">
    <input type="file" id="reg-avatar" accept="image/*">
    <button onclick="register()">Daftar</button>
    <div class="toggle-link" onclick="showLogin()">Sudah punya akun? <span>Login</span></div>
  </div>
</div>
<div id="app-screen">
  <div id="sidebar">
    <div id="sidebar-header">
      <div class="my-avatar" id="my-avatar-container"></div>
      <div class="my-name" id="my-name"></div>
      <button class="icon-btn" onclick="openProfileEdit()">⚙️</button>
    </div>
    <div id="tabs">
      <button class="active" onclick="switchTab('chats')">💬 Chat</button>
      <button onclick="switchTab('status')">📸 Status</button>
    </div>
    <div id="chat-list"></div>
    <div id="status-list" class="hidden"></div>
  </div>
  <div id="main">
    <div id="chat-header">
      <div class="chat-info">
        <button class="back-btn" onclick="closeChat()">←</button>
        <span id="chat-name">Pilih chat</span>
      </div>
      <div>
        <button class="icon-btn" onclick="startCall('voice')">📞</button>
        <button class="icon-btn" onclick="startCall('video')">🎥</button>
        <button class="icon-btn" onclick="showSchedule()">⏰</button>
        <button class="icon-btn" onclick="showStatusCreator()">📸</button>
      </div>
    </div>
    <div id="messages"></div>
    <div id="typing-indicator"></div>
    <div id="input-area">
      <button class="icon-btn" onclick="document.getElementById('file-input').click()">📎</button>
      <input type="file" id="file-input" style="display:none" onchange="uploadFile(this)">
      <button class="icon-btn" onclick="toggleEmoji()">😊</button>
      <button class="icon-btn" onclick="toggleSticker()">🩷</button>
      <button class="icon-btn" onclick="sendLocation()">📍</button>
      <button class="icon-btn" onclick="recordVoice()">🎤</button>
      <input type="text" id="message-input" placeholder="Ketik pesan..." onkeypress="if(event.key==='Enter')sendMessage()">
      <button onclick="sendMessage()">➤</button>
    </div>
    <div id="emoji-picker"></div>
  </div>
</div>
<div id="status-viewer">
  <button class="close-status" onclick="closeStatusViewer()">✕ Tutup</button>
  <div class="status-header" id="status-header"></div>
  <div id="status-content"></div>
  <div class="status-caption" id="status-caption"></div>
  <div class="status-viewers-info" id="status-viewers-info"></div>
  <div class="status-nav"><button onclick="prevStatus()">‹</button><button onclick="nextStatus()">›</button></div>
</div>
<div id="call-modal">
  <h2 id="call-title">Panggilan</h2>
  <video id="remote-video" autoplay></video>
  <video id="local-video" autoplay muted style="width:25%;position:absolute;bottom:80px;right:10px;border-radius:10px;"></video>
  <button onclick="endCall()">Akhiri Panggilan</button>
</div>
<div id="schedule-modal">
  <h3>⏰ Pesan Terjadwal</h3>
  <input type="text" id="schedule-text" placeholder="Pesan">
  <input type="datetime-local" id="schedule-time">
  <label style="color:#8696a0;font-size:13px;">Auto-delete setelah (detik): <input type="number" id="auto-delete" value="0" style="width:80px;display:inline;background:#2a3942;color:white;border:none;padding:5px;border-radius:5px;"></label>
  <button onclick="scheduleMessage()">Jadwalkan</button>
  <button onclick="document.getElementById('schedule-modal').style.display='none'" style="background:#ff3b30;">Batal</button>
</div>
<div id="status-creator">
  <h3>📸 Buat Status</h3>
  <input type="text" id="status-caption-input" placeholder="Caption (opsional)">
  <input type="file" id="status-file-input" accept="image/*,video/*">
  <textarea id="status-text-input" placeholder="Atau tulis teks status..." rows="3"></textarea>
  <button onclick="uploadStatus()">Upload Status</button>
  <button onclick="document.getElementById('status-creator').style.display='none'" style="background:#ff3b30;">Batal</button>
</div>
<div id="profile-edit-modal">
  <h3>⚙️ Edit Profil</h3>
  <input type="text" id="edit-displayname" placeholder="Nama Tampilan">
  <input type="text" id="edit-bio" placeholder="Bio">
  <input type="file" id="edit-avatar" accept="image/*">
  <button onclick="saveProfile()">Simpan</button>
  <button onclick="document.getElementById('profile-edit-modal').style.display='none'" style="background:#ff3b30;">Batal</button>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
let token,userId,username,displayName,avatar,verified,bio;
let socket,currentChat,currentChatType='user';
let pc,localStream;
let allStatuses=[],currentStatusUserIndex=0,currentStatusIndex=0;
const API=window.location.origin;
let allUsers=[];
function showRegister(){document.getElementById('login-box').style.display='none';document.getElementById('register-box').style.display='block';}
function showLogin(){document.getElementById('register-box').style.display='none';document.getElementById('login-box').style.display='block';}
async function register(){
  const u=document.getElementById('reg-username').value.trim();
  const dn=document.getElementById('reg-displayname').value.trim();
  const p=document.getElementById('reg-password').value;
  const avatarFile=document.getElementById('reg-avatar').files[0];
  if(!u||!p)return alert('Username dan password wajib diisi');
  const formData=new FormData();
  formData.append('username',u);formData.append('password',p);formData.append('displayName',dn||u);
  if(avatarFile)formData.append('avatar',avatarFile);
  try{
    const res=await fetch(API+'/register',{method:'POST',body:formData});
    const data=await res.json();
    if(data.error)return alert(data.error);
    alert(data.message);showLogin();
  }catch(err){alert('Error: '+err.message);}
}
async function login(){
  const u=document.getElementById('login-username').value.trim();
  const p=document.getElementById('login-password').value;
  if(!u||!p)return alert('Isi username dan password');
  try{
    const res=await fetch(API+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const data=await res.json();
    if(data.error)return alert(data.error);
    token=data.token;userId=data.userId;username=data.username;
    displayName=data.displayName;avatar=data.avatar;verified=data.verified;bio=data.bio||'';
    localStorage.setItem('token',token);localStorage.setItem('user',JSON.stringify(data));
    initApp();
  }catch(err){alert('Error: '+err.message);}
}
function initApp(){
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('app-screen').style.display='flex';
  socket=io(API);
  socket.emit('register-user',userId);
  document.getElementById('my-avatar-container').innerHTML=avatar?`<img src="${avatar}" alt="avatar">`:username[0].toUpperCase();
  document.getElementById('my-name').innerHTML=`${displayName||username} ${verified?'<span class="verified-badge">✓</span>':''}`;
  socket.on('new-message',(msg)=>{appendMessage(msg);if(msg.sender._id!==userId)markRead(msg._id);});
  socket.on('message-edited',(data)=>{const el=document.querySelector(`[data-id="${data.id}"] .msg-text`);if(el)el.textContent=data.text;});
  socket.on('message-deleted',(id)=>{const el=document.querySelector(`[data-id="${id}"]`);if(el)el.remove();});
  socket.on('message-reaction',(data)=>{const el=document.querySelector(`[data-id="${data.id}"] .reactions`);if(el)el.textContent=data.reactions.map(r=>r.emoji).join('');});
  socket.on('message-read',(data)=>{const el=document.querySelector(`[data-id="${data.id}"] .read-status`);if(el)el.textContent='✓✓';});
  socket.on('typing',()=>{document.getElementById('typing-indicator').textContent='sedang mengetik...';setTimeout(()=>document.getElementById('typing-indicator').textContent='',2000);});
  socket.on('incoming-call',async({from,sdp,type})=>{
    if(confirm(`Panggilan ${type} masuk. Terima?`)){
      await setupPeer();await pc.setRemoteDescription(sdp);
      const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
      socket.emit('call-answer',{to:from,sdp:answer});
    }
  });
  socket.on('call-answered',async({sdp})=>{await pc.setRemoteDescription(sdp);});
  socket.on('ice-candidate',async({candidate})=>{if(pc)await pc.addIceCandidate(candidate);});
  socket.on('new-status',()=>{loadStatuses();});
  socket.on('status-viewed',()=>{loadStatuses();});
  socket.on('user-verified',()=>{loadChats();});
  loadChats();loadStatuses();
}
async function loadChats(){
  try{
    const res=await fetch(API+'/api/chats',{headers:{'Authorization':token}});
    const data=await res.json();
    allUsers=data.allUsers||[];
    const list=document.getElementById('chat-list');list.innerHTML='';
    if(allUsers.length===0)list.innerHTML='<div style="padding:20px;color:#8696a0;text-align:center;">Belum ada user lain. Ajak teman daftar!</div>';
    allUsers.forEach(u=>{
      const div=document.createElement('div');div.className='chat-item';
      const av=u.avatar?`<img src="${u.avatar}" alt="">`:u.username[0].toUpperCase();
      const onlineDot=u.online?'<span class="online-dot"></span>':'<span class="offline-dot"></span>';
      const verBadge=u.verified?'<span class="verified-badge-small">✓</span>':'';
      div.innerHTML=`<div class="avatar">${av}</div><div style="flex:1;min-width:0;"><div style="font-weight:bold;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.displayName||u.username}${verBadge} ${onlineDot}</div><div style="font-size:12px;color:#8696a0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.bio||''}</div></div>`;
      div.onclick=()=>openChat(u._id,'user',u.displayName||u.username,u.verified);
      list.appendChild(div);
    });
    (data.messages||[]).forEach(m=>{if(!m.sender)return;const senderId=m.sender._id||m.sender;const receiverId=m.receiver?._id||m.receiver;if(senderId===userId||receiverId===userId)appendMessage(m);});
  }catch(err){console.error(err);}
}
function openChat(id,type,name,isVerified){
  currentChat=id;currentChatType=type;
  document.getElementById('chat-name').innerHTML=name+(isVerified?' <span class="verified-badge" style="display:inline-block;width:16px;height:16px;background:#00a884;border-radius:50%;color:white;font-size:10px;text-align:center;line-height:16px;">✓</span>':'');
  document.getElementById('messages').innerHTML='';
  if(window.innerWidth<768){
    document.getElementById('sidebar').classList.add('hidden-mobile');
    document.getElementById('main').classList.add('active');
  }
}
function closeChat(){
  if(window.innerWidth<768){
    document.getElementById('sidebar').classList.remove('hidden-mobile');
    document.getElementById('main').classList.remove('active');
  }
}
async function sendMessage(){
  const input=document.getElementById('message-input');
  const text=input.value.trim();
  if(!text||!currentChat)return;
  await fetch(API+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({receiver:currentChat,text})});
  input.value='';socket.emit('typing',{to:currentChat});
}
function markRead(id){fetch(API+`/api/message/${id}/read`,{headers:{'Authorization':token}});}
function appendMessage(msg){
  if(!msg.sender)return;
  const senderId=msg.sender._id||msg.sender;
  const container=document.getElementById('messages');
  const div=document.createElement('div');
  const sent=senderId===userId;
  div.className='msg '+(sent?'sent':'received');
  div.dataset.id=msg._id;
  const senderName=msg.sender.displayName||msg.sender.username||'?';
  const senderVerified=msg.sender.verified?' ✓':'';
  let content='';
  if(!sent&&msg.sender)content+=`<div class="sender-name">${senderName}${senderVerified}</div>`;
  if(msg.text)content+=`<span class="msg-text">${msg.text}</span>`;
  if(msg.media){if(msg.mediaType&&msg.mediaType.startsWith('video')){content+=`<br><video src="${msg.media}" controls style="max-width:100%;border-radius:5px;"></video>`;}else{content+=`<br><img src="${msg.media}" style="max-width:100%;border-radius:5px;">`;}}
  if(msg.voiceNote)content+=`<br><audio controls src="${msg.voiceNote}" style="max-width:100%;"></audio>`;
  if(msg.sticker)content+=`<br><img src="${msg.sticker}" style="width:80px;">`;
  if(msg.gif)content+=`<br><img src="${msg.gif}" style="max-width:100%;">`;
  if(msg.location)content+=`<br><a href="https://maps.google.com/?q=${msg.location.lat},${msg.location.lng}" target="_blank" style="color:#00a884;">📍 Lokasi</a>`;
  if(msg.replyTo)content=`<div class="reply-quote">Membalas pesan</div>`+content;
  content+=`<div class="time">${new Date(msg.createdAt).toLocaleTimeString()} <span class="read-status">${sent?'✓':''}</span></div><div class="reactions"></div>`;
  div.innerHTML=content;
  div.ondblclick=()=>{
    const emoji=prompt('Reaksi emoji (❤️😂👍😮😢):');
    if(emoji)fetch(API+`/api/message/${msg._id}/react`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({emoji})});
  };
  div.oncontextmenu=(e)=>{
    e.preventDefault();
    if(sent){
      if(confirm('Edit pesan?')){const newText=prompt('Edit:',msg.text);if(newText)fetch(API+`/api/message/${msg._id}`,{method:'PUT',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({text:newText})});}
      if(confirm('Hapus pesan?')){fetch(API+`/api/message/${msg._id}`,{method:'DELETE',headers:{'Authorization':token}});}
    }
  };
  container.appendChild(div);
  container.scrollTop=container.scrollHeight;
}
async function uploadFile(input){
  const file=input.files[0];
  if(!file||!currentChat)return;
  const formData=new FormData();formData.append('file',file);
  const res=await fetch(API+'/upload',{method:'POST',body:formData});
  const data=await res.json();
  if(data.url)await fetch(API+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({receiver:currentChat,media:data.url,mediaType:data.type})});
  input.value='';
}
let mediaRecorder,audioChunks=[];
async function recordVoice(){
  if(!currentChat)return alert('Pilih chat dulu');
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    mediaRecorder=new MediaRecorder(stream);audioChunks=[];
    mediaRecorder.ondataavailable=e=>audioChunks.push(e.data);
    mediaRecorder.onstop=async()=>{
      const blob=new Blob(audioChunks,{type:'audio/webm'});
      const formData=new FormData();formData.append('file',blob,'voice.webm');
      const res=await fetch(API+'/upload',{method:'POST',body:formData});
      const data=await res.json();
      await fetch(API+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({receiver:currentChat,voiceNote:data.url})});
    };
    mediaRecorder.start();setTimeout(()=>mediaRecorder.stop(),5000);
  }catch(err){alert('Mic tidak tersedia: '+err.message);}
}
function toggleEmoji(){
  const picker=document.getElementById('emoji-picker');
  picker.style.display=picker.style.display==='flex'?'none':'flex';
  if(picker.innerHTML===''){
    ['😀','😂','😍','😎','🔥','❤️','👍','🎉','😈','💀','😢','😡','🤔','🙏','👏','🥰','😘','🤩','😴','🤮'].forEach(e=>{
      const span=document.createElement('span');span.textContent=e;
      span.onclick=()=>{document.getElementById('message-input').value+=e;};
      picker.appendChild(span);
    });
  }
}
function toggleSticker(){
  const sticker=prompt('URL Sticker:');
  if(sticker&&currentChat)fetch(API+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({receiver:currentChat,sticker})});
}
function sendLocation(){
  if(!currentChat)return alert('Pilih chat dulu');
  navigator.geolocation.getCurrentPosition(async(pos)=>{
    await fetch(API+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({receiver:currentChat,location:{lat:pos.coords.latitude,lng:pos.coords.longitude}})});
  },(err)=>alert('Gagal dapat lokasi: '+err.message));
}
function showSchedule(){document.getElementById('schedule-modal').style.display='block';}
async function scheduleMessage(){
  const text=document.getElementById('schedule-text').value;
  const time=document.getElementById('schedule-time').value;
  const autoDelete=parseInt(document.getElementById('auto-delete').value)||0;
  if(!text||!time||!currentChat)return alert('Isi semua field');
  await fetch(API+'/api/message',{method:'POST',headers:{'Content-Type':'application/json','Authorization':token},body:JSON.stringify({receiver:currentChat,text,scheduled:time,autoDelete:autoDelete>0?new Date(Date.now()+autoDelete*1000):null})});
  document.getElementById('schedule-modal').style.display='none';
}
function switchTab(tab){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.remove('active'));
  if(tab==='chats'){
    document.querySelectorAll('#tabs button')[0].classList.add('active');
    document.getElementById('chat-list').classList.remove('hidden');
    document.getElementById('status-list').classList.add('hidden');
  }else{
    document.querySelectorAll('#tabs button')[1].classList.add('active');
    document.getElementById('chat-list').classList.add('hidden');
    document.getElementById('status-list').classList.remove('hidden');
    loadStatuses();
  }
}
async function loadStatuses(){
  try{
    const res=await fetch(API+'/api/status',{headers:{'Authorization':token}});
    allStatuses=await res.json();
    const list=document.getElementById('status-list');list.innerHTML='';
    const createBtn=document.createElement('div');createBtn.className='status-item';createBtn.style.background='#005c4b';
    createBtn.innerHTML=`<div class="avatar" style="background:#00a884;">+</div><div><b>Buat Status Baru</b></div>`;
    createBtn.onclick=showStatusCreator;list.appendChild(createBtn);
    if(allStatuses.length===0){list.innerHTML+='<div style="padding:20px;color:#8696a0;text-align:center;">Belum ada status dari siapa pun.</div>';return;}
    allStatuses.forEach((group,idx)=>{
      const u=group.user;
      const div=document.createElement('div');div.className='status-item';
      const av=u.avatar?`<img src="${u.avatar}" alt="">`:u.username[0].toUpperCase();
      const verBadge=u.verified?'<span class="verified-badge-small">✓</span>':'';
      const totalViewers=group.statuses.reduce((sum,s)=>sum+(s.viewers?.length||0),0);
      div.innerHTML=`<div class="avatar" style="border:3px solid #00a884;">${av}</div><div style="flex:1;min-width:0;"><div style="font-weight:bold;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.displayName||u.username}${verBadge}</div><div style="font-size:12px;color:#8696a0;">${group.statuses.length} status · ${totalViewers} tonton</div></div>`;
      div.onclick=()=>openStatusViewer(idx);list.appendChild(div);
    });
  }catch(err){console.error(err);}
}
function showStatusCreator(){document.getElementById('status-creator').style.display='block';}
async function uploadStatus(){
  const caption=document.getElementById('status-caption-input').value;
  const file=document.getElementById('status-file-input').files[0];
  const textContent=document.getElementById('status-text-input').value;
  if(!file&&!textContent)return alert('Pilih file atau tulis teks status');
  const formData=new FormData();formData.append('caption',caption);
  if(file)formData.append('file',file);
  if(textContent){formData.append('type','text');formData.append('content',textContent);}
  await fetch(API+'/api/status',{method:'POST',headers:{'Authorization':token},body:formData});
  document.getElementById('status-creator').style.display='none';
  document.getElementById('status-caption-input').value='';
  document.getElementById('status-file-input').value='';
  document.getElementById('status-text-input').value='';
  loadStatuses();
}
function openStatusViewer(userIndex){
  currentStatusUserIndex=userIndex;currentStatusIndex=0;
  document.getElementById('status-viewer').style.display='flex';
  renderStatus();
}
function renderStatus(){
  const group=allStatuses[currentStatusUserIndex];
  if(!group)return closeStatusViewer();
  const status=group.statuses[currentStatusIndex];
  if(!status)return closeStatusViewer();
  const u=group.user;
  const av=u.avatar?`<img src="${u.avatar}" style="width:36px;height:36px;border-radius:50%;margin-right:10px;">`:`<div style="width:36px;height:36px;border-radius:50%;background:#00a884;display:flex;align-items:center;justify-content:center;margin-right:10px;font-weight:bold;">${u.username[0].toUpperCase()}</div>`;
  document.getElementById('status-header').innerHTML=`${av}<div><b>${u.displayName||u.username}</b> ${u.verified?'✓':''}<br><small style="color:#8696a0;font-size:11px;">${new Date(status.createdAt).toLocaleTimeString()}</small></div>`;
  const contentDiv=document.getElementById('status-content');
  if(status.type==='image')contentDiv.innerHTML=`<img src="${status.content}" alt="status">`;
  else if(status.type==='video')contentDiv.innerHTML=`<video src="${status.content}" controls autoplay></video>`;
  else contentDiv.innerHTML=`<div style="color:white;font-size:22px;text-align:center;padding:40px;">${status.content}</div>`;
  document.getElementById('status-caption').textContent=status.caption||'';
  const viewerCount=status.viewers?.length||0;
  document.getElementById('status-viewers-info').innerHTML=`👁️ ${viewerCount} orang menonton`;
  if(u._id!==userId)fetch(API+`/api/status/${status._id}/view`,{method:'POST',headers:{'Authorization':token}});
}
function nextStatus(){
  const group=allStatuses[currentStatusUserIndex];
  if(!group)return;
  if(currentStatusIndex<group.statuses.length-1)currentStatusIndex++;
  else if(currentStatusUserIndex<allStatuses.length-1){currentStatusUserIndex++;currentStatusIndex=0;}
  else return closeStatusViewer();
  renderStatus();
}
function prevStatus(){
  if(currentStatusIndex>0)currentStatusIndex--;
  else if(currentStatusUserIndex>0){currentStatusUserIndex--;currentStatusIndex=allStatuses[currentStatusUserIndex].statuses.length-1;}
  renderStatus();
}
function closeStatusViewer(){document.getElementById('status-viewer').style.display='none';loadStatuses();}
function openProfileEdit(){
  document.getElementById('edit-displayname').value=displayName||'';
  document.getElementById('edit-bio').value=bio||'';
  document.getElementById('profile-edit-modal').style.display='block';
}
async function saveProfile(){
  const dn=document.getElementById('edit-displayname').value;
  const newBio=document.getElementById('edit-bio').value;
  const avatarFile=document.getElementById('edit-avatar').files[0];
  const formData=new FormData();formData.append('displayName',dn);formData.append('bio',newBio);
  if(avatarFile)formData.append('avatar',avatarFile);
  const res=await fetch(API+'/api/profile',{method:'PUT',headers:{'Authorization':token},body:formData});
  const data=await res.json();
  if(data.error)return alert(data.error);
  displayName=data.displayName;bio=data.bio;avatar=data.avatar;
  document.getElementById('my-avatar-container').innerHTML=avatar?`<img src="${avatar}" alt="avatar">`:username[0].toUpperCase();
  document.getElementById('my-name').innerHTML=`${displayName||username} ${verified?'<span class="verified-badge">✓</span>':''}`;
  document.getElementById('profile-edit-modal').style.display='none';
  loadChats();
}
async function setupPeer(){
  pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
  localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:true});
  localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
  document.getElementById('local-video').srcObject=localStream;
  pc.onicecandidate=(e)=>{if(e.candidate)socket.emit('ice-candidate',{to:currentChat,candidate:e.candidate});};
  pc.ontrack=(e)=>{document.getElementById('remote-video').srcObject=e.streams[0];};
}
async function startCall(type){
  if(!currentChat)return alert('Pilih chat dulu');
  document.getElementById('call-modal').style.display='flex';
  document.getElementById('call-title').textContent=(type==='voice'?'📞 Panggilan Suara':'🎥 Panggilan Video');
  await setupPeer();
  const offer=await pc.createOffer();await pc.setLocalDescription(offer);
  socket.emit(type==='voice'?'voice-call':'video-call',{to:currentChat,sdp:offer});
}
function endCall(){
  if(pc)pc.close();
  if(localStream)localStream.getTracks().forEach(t=>t.stop());
  document.getElementById('call-modal').style.display='none';
}
if(localStorage.getItem('token')){
  token=localStorage.getItem('token');
  const saved=JSON.parse(localStorage.getItem('user')||'{}');
  userId=saved.userId;username=saved.username;displayName=saved.displayName;avatar=saved.avatar;verified=saved.verified;bio=saved.bio;
  if(token&&userId)initApp();
}
</script>
</body>
</html>`;

// =================== SERVE HTML ===================
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(HTML_PAGE);
});

// =================== JALANKAN ===================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 HOZOO MD WhatsApp Clone ProMax berjalan!');
  console.log('📍 Local: http://localhost:' + PORT);
  console.log('🌐 VPS: http://IP_VPS_LO:' + PORT);
  console.log('📡 Tunnel: cloudflared tunnel --url http://localhost:' + PORT);
  console.log('🔑 Secret verify: HOZOO_VERIFY_SECRET_2026\n');
});
