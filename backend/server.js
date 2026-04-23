const express = require('express')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const multer = require('multer')
const AWS = require('aws-sdk')
const cors = require('cors')

const app = express()
app.use(express.json())
app.use(cors())

const upload = multer({ storage: multer.memoryStorage() })

const SECRET = "secret123"
const BUCKET = "vibestack-media-123"
const DATA_KEY = "data.json"

AWS.config.update({ region: "us-east-1" })
const s3 = new AWS.S3()

let users = []
let posts = []

// ================= LOAD FROM S3 =================
async function loadData() {
  try {
    const data = await s3.getObject({
      Bucket: BUCKET,
      Key: DATA_KEY
    }).promise()

    const parsed = JSON.parse(data.Body.toString())
    users = parsed.users || []
    posts = parsed.posts || []
  } catch {
    users = []
    posts = []
  }
}

// ================= SAVE TO S3 =================
async function saveData() {
  await s3.putObject({
    Bucket: BUCKET,
    Key: DATA_KEY,
    Body: JSON.stringify({ users, posts }),
    ContentType: "application/json"
  }).promise()
}

// ================= AUTH =================
function auth(req, res, next) {
  let token = req.headers.authorization

  if (!token) {
    return res.status(403).json({ msg: "No token provided" })
  }

  if (token.startsWith("Bearer ")) {
    token = token.split(" ")[1]
  }

  try {
    req.user = jwt.verify(token, SECRET)
    next()
  } catch {
    return res.status(403).json({ msg: "Invalid or expired token" })
  }
}

// ================= INIT =================
loadData()

// ================= AUTH ROUTES =================

app.post('/register', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password)
    return res.status(400).json({ msg: "All fields required" })

  if (users.find(u => u.username === username))
    return res.status(400).json({ msg: "User already exists" })

  const hash = await bcrypt.hash(password, 10)
  users.push({ username, password: hash })

  await saveData()

  res.json({ msg: "Registration successful" })
})

app.post('/login', async (req, res) => {
  const { username, password } = req.body

  const user = users.find(u => u.username === username)
  if (!user)
    return res.status(401).json({ msg: "User not found" })

  const valid = await bcrypt.compare(password, user.password)
  if (!valid)
    return res.status(401).json({ msg: "Incorrect password" })

  const token = jwt.sign({ username }, SECRET)
  res.json({ token, msg: "Login successful" })
})

// ================= POSTS =================

app.post('/upload', auth, upload.single('file'), async (req, res) => {
  const fileKey = Date.now() + "_" + req.file.originalname

  const data = await s3.upload({
    Bucket: BUCKET,
    Key: fileKey,
    Body: req.file.buffer
  }).promise()

  posts.push({
    url: data.Location,
    user: req.user.username,
    comments: []
  })

  await saveData()

  res.json({ msg: "Upload successful" })
})

app.get('/posts', async (req, res) => {
  await loadData()
  res.json(posts)
})

app.post('/comment', auth, async (req, res) => {
  const { index, text } = req.body

  if (!posts[index])
    return res.status(400).json({ msg: "Invalid post" })

  posts[index].comments.push({
    user: req.user.username,
    text
  })

  await saveData()

  res.json({ msg: "Comment added" })
})

app.listen(3000, () => console.log("Server running"))