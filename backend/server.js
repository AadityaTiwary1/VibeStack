const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const AWS = require('aws-sdk');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const users = [];
const posts = [];

const SECRET = "secret123";

// IAM ROLE BASED (no keys)
const s3 = new AWS.S3({
  region: "us-east-1"
});

const BUCKET = "vibestack-media-123"; // ← your bucket

// 🔐 AUTH MIDDLEWARE
function auth(req, res, next){
  const token = req.headers.authorization?.split(" ")[1];
  if(!token) return res.status(401).send("No token");

  try {
    const data = jwt.verify(token, SECRET);
    req.user = data.username;
    next();
  } catch {
    res.status(403).send("Invalid token");
  }
}

// REGISTER
app.post('/register', async (req,res)=>{
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password,10);
  users.push({ username, password: hash });
  res.send("Registered");
});

// LOGIN
app.post('/login', async (req,res)=>{
  const { username, password } = req.body;
  const user = users.find(u=>u.username===username);
  if(!user) return res.status(404).send("User not found");

  const ok = await bcrypt.compare(password,user.password);
  if(!ok) return res.status(403).send("Wrong password");

  const token = jwt.sign({ username }, SECRET);
  res.json({ token });
});

// UPLOAD
app.post('/upload', auth, upload.single("file"), async (req,res)=>{
  if(!req.file) return res.status(400).send("No file");

  const key = Date.now() + "_" + req.file.originalname;

  const params = {
    Bucket: BUCKET,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype
  };

  try {
    await s3.upload(params).promise();

    const url = `https://${BUCKET}.s3.amazonaws.com/${key}`;

    posts.push({
      url,
      user: req.user,
      comments:[]
    });

    res.send("Uploaded");
  } catch(err){
    console.log(err);
    res.status(500).send("Upload failed");
  }
});

// POSTS
app.get('/posts',(req,res)=>{
  res.json(posts);
});

// COMMENT
app.post('/comment', auth, (req,res)=>{
  const { index, text } = req.body;
  posts[index].comments.push(req.user + ": " + text);
  res.send("Comment added");
});

app.listen(3000,()=>console.log("Backend running"));