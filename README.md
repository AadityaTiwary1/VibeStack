# VibeStack

A lightweight social photo-sharing platform. Users register, log in, upload images, and comment on each other's posts. The backend runs on **Node.js + Express**, media and app data live in **AWS S3**, and the whole stack is deployed on an **EC2 instance running Kubernetes**.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [EC2 Instance Setup](#ec2-instance-setup)
  - [1. Launch the EC2 Instance](#1-launch-the-ec2-instance)
  - [2. Connect and Install Dependencies](#2-connect-and-install-dependencies)
  - [3. Configure AWS Credentials](#3-configure-aws-credentials)
  - [4. Set Up the S3 Bucket](#4-set-up-the-s3-bucket)
  - [5. Clone the Repo and Build Docker Images](#5-clone-the-repo-and-build-docker-images)
  - [6. Deploy to Kubernetes](#6-deploy-to-kubernetes)
  - [7. Verify Everything Is Running](#7-verify-everything-is-running)
- [Accessing the App](#accessing-the-app)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Local Development](#local-development)
- [Security Notes](#security-notes)

---

## Architecture Overview

```
Browser
  │
  ├─── GET :30008 ──────► Frontend Pod (nginx)
  │                         index.html  /  feed.html
  │
  └─── :30007 ──────────► Backend Pod (Node.js / Express)
                              │
                              ├── JWT Authentication
                              ├── bcrypt Password Hashing
                              ├── Multer (in-memory file handling)
                              │
                              └── AWS S3 (us-east-1)
                                    ├── data.json   ← users + posts store
                                    └── <timestamp>_<filename>  ← media files
```

Both pods run inside a single-node Kubernetes cluster (Minikube) on the EC2 instance. Services are exposed via **NodePort** so the EC2's public IP is the only entry point needed.

---

## Project Structure

```
VibeStack-main/
├── backend/
│   ├── server.js        # Express API — auth, upload, posts, comments
│   ├── package.json     # Node dependencies
│   └── Dockerfile       # node:18 image
│
├── frontend/
│   ├── index.html       # Login / Register page
│   ├── feed.html        # Main feed — upload, browse, comment
│   └── Dockerfile       # nginx:alpine serving static files
│
└── k8s/
    ├── backend.yaml     # Deployment + NodePort Service → 30007
    └── frontend.yaml    # Deployment + NodePort Service → 30008
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JavaScript |
| Backend | Node.js 18, Express 4 |
| Authentication | JSON Web Tokens (`jsonwebtoken`) |
| Password hashing | `bcrypt` (10 salt rounds) |
| File handling | `multer` (in-memory storage) |
| Cloud storage | AWS S3 SDK v2 |
| Data persistence | JSON document in S3 (`data.json`) |
| Containerisation | Docker |
| Orchestration | Kubernetes (Minikube on EC2) |
| Web server (frontend) | nginx:alpine |
| Hosting | AWS EC2 (us-east-1) |

---

## EC2 Instance Setup

### 1. Launch the EC2 Instance

1. Go to **EC2 → Launch Instance** in the AWS Console.
2. Choose **Ubuntu Server 22.04 LTS (x86_64)**.
3. Pick an instance type — **t3.medium** (2 vCPU / 4 GB RAM) is the minimum comfortable size for Minikube.
4. Under **Key pair**, create or select an existing `.pem` key.
5. Under **Network settings → Security group**, open these inbound ports:

   | Port | Protocol | Source | Purpose |
   |---|---|---|---|
   | 22 | TCP | Your IP | SSH access |
   | 30007 | TCP | 0.0.0.0/0 | Backend API (NodePort) |
   | 30008 | TCP | 0.0.0.0/0 | Frontend (NodePort) |

6. Give the instance an **IAM role** with `AmazonS3FullAccess` (or a scoped policy for the `vibestack-media-123` bucket only). This avoids hardcoding AWS credentials.
7. Launch the instance and note its **Public IPv4 address**.

---

### 2. Connect and Install Dependencies

SSH into the instance:

```bash
ssh -i your-key.pem ubuntu@<EC2_PUBLIC_IP>
```

#### Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Allow your user to run docker without sudo
sudo usermod -aG docker $USER
newgrp docker
```

#### Install kubectl

```bash
curl -LO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
```

#### Install Minikube

```bash
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube

# Start Minikube using Docker as the driver
minikube start --driver=docker
```

Verify the cluster is up:

```bash
kubectl get nodes
# Expected: one node in Ready state
```

---

### 3. Configure AWS Credentials

If the EC2 instance has the IAM role attached (recommended), no configuration is needed — the AWS SDK picks up credentials automatically via the instance metadata service.

If you are **not** using an IAM role, configure credentials manually:

```bash
aws configure
# AWS Access Key ID:     <your-key-id>
# AWS Secret Access Key: <your-secret>
# Default region:        us-east-1
# Default output:        json
```

---

### 4. Set Up the S3 Bucket

```bash
# Create the bucket (must match BUCKET constant in server.js)
aws s3 mb s3://vibestack-media-123 --region us-east-1

# The backend will create data.json automatically on first write.
# Make sure the bucket is NOT public — all media URLs are direct S3 object URLs.
# If you want images to be viewable in the browser, set a bucket policy
# that allows s3:GetObject for all principals, or use pre-signed URLs.
```

Example public-read bucket policy (paste in S3 → Permissions → Bucket policy):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::vibestack-media-123/*"
    }
  ]
}
```

> **Note:** Also disable "Block all public access" in the bucket settings before applying the policy.

---

### 5. Clone the Repo and Build Docker Images

Minikube runs its own Docker daemon. Build images inside it so Kubernetes can find them without a registry (`imagePullPolicy: Never`).

```bash
# Point your shell at Minikube's Docker daemon
eval $(minikube docker-env)

# Clone the repository
git clone https://github.com/<your-username>/VibeStack.git
cd VibeStack

# Build the backend image
docker build -t vibestack-backend ./backend

# Build the frontend image
docker build -t vibestack-frontend ./frontend
```

Confirm the images are visible to Minikube:

```bash
docker images | grep vibestack
```

---

### 6. Deploy to Kubernetes

```bash
# Apply manifests
kubectl apply -f k8s/backend.yaml
kubectl apply -f k8s/frontend.yaml

# Watch pods come up
kubectl get pods -w
```

Both pods should reach **Running** status within 30–60 seconds.

---

### 7. Verify Everything Is Running

```bash
kubectl get pods
# NAME                                  READY   STATUS    RESTARTS
# vibestack-backend-<hash>              1/1     Running   0
# vibestack-frontend-<hash>             1/1     Running   0

kubectl get services
# NAME               TYPE       CLUSTER-IP     EXTERNAL-IP   PORT(S)
# backend-service    NodePort   10.x.x.x       <none>        3000:30007/TCP
# frontend-service   NodePort   10.x.x.x       <none>        80:30008/TCP
```

Check the backend health from within the EC2 instance:

```bash
curl http://localhost:30007/posts
# Should return: []
```

---

## Accessing the App

| Page | URL |
|---|---|
| Login / Register | `http://<EC2_PUBLIC_IP>:30008/index.html` |
| Feed | `http://<EC2_PUBLIC_IP>:30008/feed.html` |
| Backend API base | `http://<EC2_PUBLIC_IP>:30007` |

> Replace `<EC2_PUBLIC_IP>` with your instance's actual public IPv4 (e.g., `54.225.39.189`).

---

## API Reference

All routes are prefixed at `http://<host>:30007`.

### `POST /register`

Register a new user.

**Body** `application/json`
```json
{ "username": "aaditya", "password": "hunter2" }
```

**Responses**
- `200` — `{ "msg": "Registration successful" }`
- `400` — `{ "msg": "User already exists" }` or `{ "msg": "All fields required" }`

---

### `POST /login`

Log in and receive a JWT.

**Body** `application/json`
```json
{ "username": "aaditya", "password": "hunter2" }
```

**Responses**
- `200` — `{ "token": "<jwt>", "msg": "Login successful" }`
- `401` — `{ "msg": "User not found" }` or `{ "msg": "Incorrect password" }`

---

### `POST /upload` 🔒

Upload an image. Requires `Authorization: Bearer <token>` header.

**Body** `multipart/form-data`
- `file` — the image file

**Response**
- `200` — `{ "msg": "Upload successful" }`

---

### `GET /posts`

Fetch all posts (public, no auth required).

**Response**
```json
[
  {
    "url": "https://s3.amazonaws.com/vibestack-media-123/...",
    "user": "aaditya",
    "comments": [
      { "user": "someone", "text": "nice shot!" }
    ]
  }
]
```

---

### `POST /comment` 🔒

Add a comment to a post. Requires `Authorization: Bearer <token>` header.

**Body** `application/json`
```json
{ "index": 0, "text": "Looks great!" }
```

**Responses**
- `200` — `{ "msg": "Comment added" }`
- `400` — `{ "msg": "Invalid post" }`

---

## Configuration

All configuration is currently hardcoded in `backend/server.js`. Before going to production, move these to environment variables.

| Constant | Current Value | Description |
|---|---|---|
| `SECRET` | `"secret123"` | JWT signing secret — **change this** |
| `BUCKET` | `"vibestack-media-123"` | S3 bucket name |
| `DATA_KEY` | `"data.json"` | S3 key for the persistent data store |
| AWS Region | `"us-east-1"` | Set via `AWS.config.update` |

Example using environment variables (recommended):

```js
const SECRET  = process.env.JWT_SECRET  || "secret123"
const BUCKET  = process.env.S3_BUCKET   || "vibestack-media-123"
```

Pass them into the pod via a Kubernetes Secret:

```yaml
env:
  - name: JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: vibestack-secrets
        key: jwt-secret
```

---

## Local Development

To run the backend locally (without Kubernetes):

```bash
cd backend
npm install
node server.js
# Server running on http://localhost:3000
```

Serve the frontend with any static file server:

```bash
cd frontend
npx serve .
# Open http://localhost:3000 — update the API URLs in the HTML files to point to localhost:3000
```

---

## Security Notes

These are known issues appropriate to address before any public deployment:

- **JWT secret** — `"secret123"` is hardcoded. Use a long random secret stored in an environment variable or a secrets manager.
- **No HTTPS** — all traffic is plain HTTP. Add a TLS terminator (e.g., an AWS ALB with ACM certificate, or nginx + Certbot) in front of the NodePorts.
- **No rate limiting** — the `/register` and `/login` endpoints have no brute-force protection. Add `express-rate-limit`.
- **In-memory data** — `users` and `posts` arrays are loaded into memory at startup and flushed to S3 on every write. This is not safe for concurrent replicas; consider using a proper database (DynamoDB, RDS, MongoDB Atlas) if scaling beyond one pod.
- **S3 public bucket** — making the bucket public-read exposes all uploaded files to anyone with the URL. Consider pre-signed URLs for private content.
- **No file type validation** — the upload endpoint accepts any file. Add a MIME-type check on the backend before writing to S3.
