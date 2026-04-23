const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const multer = require("multer");
const AWS = require("aws-sdk");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const users = [];
const posts = [];

const SECRET = "secretkey";

AWS.config.update({
  region: "us-east-1"
});

const s3 = new AWS.S3();
const upload = multer({ storage: multer.memoryStorage() });

function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.sendStatus(403);

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.sendStatus(403);
  }
}

app.post("/register", async (req, res) => {
  const hash = await bcrypt.hash(req.body.password, 10);
  users.push({ username: req.body.username, password: hash });
  res.send("registered");
});

app.post("/login", async (req, res) => {
  const user = users.find(u => u.username === req.body.username);
  if (!user) return res.sendStatus(401);

  const ok = await bcrypt.compare(req.body.password, user.password);
  if (!ok) return res.sendStatus(401);

  const token = jwt.sign({ username: user.username }, SECRET);
  res.json({ token });
});

app.post("/upload", auth, upload.single("file"), async (req, res) => {
  const params = {
    Bucket: process.env.BUCKET,
    Key: Date.now() + req.file.originalname,
    Body: req.file.buffer
  };

  const data = await s3.upload(params).promise();

  const post = {
    url: data.Location,
    user: req.user.username,
    comments: []
  };

  posts.push(post);
  res.send("uploaded");
});

app.get("/posts", (req, res) => {
  res.json(posts);
});

app.post("/comment", auth, (req, res) => {
  const { index, text } = req.body;
  posts[index].comments.push({
    user: req.user.username,
    text
  });
  res.send("comment added");
});

app.listen(3000, () => console.log("running"));