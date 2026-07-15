# Sequel Production Deployment Guide

This guide details the steps and code changes required to deploy the **Sequel (NL-to-SQL Assistant)** full-stack application to a production environment.

---

## 1. Necessary Code Changes for Production

To prepare the application for production, we need to transition from dev-only configurations to production-grade settings.

### A. Dynamic Frontend API URL
In development, `API_BASE` is hardcoded to `http://localhost:5000` in the frontend code. In production, the backend might be served from a different URL (or the same URL).

**Recommended Change in [frontend/src/App.jsx](file:///f:/SQLgenerator/frontend/src/App.jsx):**
Update `API_BASE` to check for an environment variable or default to relative paths if deploying a single unified server:
```javascript
const API_BASE = import.meta.env.VITE_API_URL || window.location.origin;
```

### B. Unified Express Static File Serving (Recommended)
Instead of running two separate web services, you can build the Vite frontend into static assets and have the Express backend serve them. This allows you to deploy the entire project as a **single web service** on platforms like Render or Railway.

1. **Build the Frontend**:
   Run `npm run build --prefix frontend`. This compiles the React app into `frontend/dist`.
2. **Serve from Express**:
   Update [backend/server.js](file:///f:/SQLgenerator/backend/server.js) to serve these static assets and fallback to `index.html` for client-side routing.

Add this code in `backend/server.js` before `app.listen()`:
```javascript
// Serve static assets in production
const distPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(distPath));

// Fallback all other routes to index.html (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
```

### C. CORS Protection
Currently, CORS permits all origins (`*`). In production, restrict it to your frontend domain to secure your APIs.

**In [backend/server.js](file:///f:/SQLgenerator/backend/server.js):**
```javascript
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
```

### D. SQLite Database Persistence
The query history database (`history.db`) is stored locally.
> [!WARNING]
> If you deploy to an ephemeral platform like Render Free Tier or Heroku without persistent disks, the local SQLite database file will be deleted every time the server restarts.

*   **Option A**: Attach a Persistent Volume/Disk to your container or service and configure `historyDbFile` path to point to the mounted volume directory (e.g. `/data/history.db`).
*   **Option B**: Use a cloud SQL database (PostgreSQL/MySQL) for the history log in production instead of SQLite.

---

## 2. Deployment Options

### Option A: Cloud Platforms (Single Service - Easiest)
You can deploy the unified app as a single service on **Render**, **Railway**, or **Fly.io**.

#### 1. Configuration on Render/Railway:
*   **Environment Variables**:
    *   `PORT` = `5000` (or the port assigned by host)
    *   `DEEPSEEK_API_KEY` = `your_openrouter_or_deepseek_key`
    *   `DEEPSEEK_API_URL` = `https://openrouter.ai/api/v1/chat/completions`
    *   `DEEPSEEK_MODEL` = `deepseek/deepseek-chat`
*   **Build Command**:
    ```bash
    npm install && npm run build --prefix frontend && npm install --prefix backend
    ```
*   **Start Command**:
    ```bash
    node backend/server.js
    ```

---

### Option B: Docker Containerization
Containerizing the application ensures consistency across dev, staging, and production.

#### 1. Create a `Dockerfile` in the root:
```dockerfile
# Stage 1: Build Frontend
FROM node:20-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Serve Backend & Frontend
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN npm install --prefix backend
COPY backend/ ./backend/
COPY --from=build-frontend /app/frontend/dist ./frontend/dist

# Expose port and start
ENV PORT=5000
EXPOSE 5000
CMD ["node", "backend/server.js"]
```

#### 2. Build and Run:
```bash
docker build -t sequel-app .
docker run -p 5000:5000 \
  -e DEEPSEEK_API_KEY="sk-or-..." \
  -e DEEPSEEK_API_URL="https://openrouter.ai/api/v1/chat/completions" \
  -e DEEPSEEK_MODEL="deepseek/deepseek-chat" \
  sequel-app
```

---

### Option C: Traditional VPS Deployment (Ubuntu/Nginx/PM2)

If you are deploying to a Linux server (DigitalOcean, AWS EC2, Linode):

#### 1. Install Node.js & PM2:
```bash
sudo apt update
sudo apt install nodejs npm
sudo npm install -g pm2
```

#### 2. Start the Backend process with PM2:
From the root directory:
```bash
pm2 start backend/server.js --name "sequel-backend"
pm2 save
pm2 startup
```

#### 3. Build & Configure Web Server (Nginx):
*   Build your frontend using `npm run build --prefix frontend`.
*   Configure Nginx `/etc/nginx/sites-available/default` to serve static files and reverse proxy API calls:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend Static Assets
    location / {
        root /var/www/sequel/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API Proxy
    location /api/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
*   Restart Nginx: `sudo systemctl restart nginx`

---

## 3. 100% Free Hosting Solutions

If you want to host this project completely free of charge, here are the best options.

### Option A: Vercel Serverless Fullstack Deployment (Recommended)
You can deploy both the React frontend and the Express backend completely for free as a single project on Vercel.

*   **Cost**: $0/month.
*   **Pros**: 100% free, fast global CDN, zero-configuration SSL, and no server spin-down (servers are immediately active, with quick serverless cold starts).
*   **Cons**: Ephemeral SQLite history database (the local history database resets on cold starts). It is recommended to use a free cloud PostgreSQL database (like Neon or Supabase) for query history if you want persistence on Vercel.
*   **Step-by-step**:
    1. Push your code to a GitHub repository. (Make sure [vercel.json](file:///f:/SQLgenerator/vercel.json) and [api/index.js](file:///f:/SQLgenerator/api/index.js) are committed in the root).
    2. Go to [Vercel](https://vercel.com) and log in.
    3. Click **Add New** -> **Project** and import your GitHub repository.
    4. Set the following build settings:
        *   **Framework Preset**: `Vite` (or `Other`)
        *   **Build Command**: `npm run build --prefix frontend`
        *   **Output Directory**: `frontend/dist`
    5. Expand the **Environment Variables** section and add:
        *   `NODE_ENV` = `production`
        *   `DEEPSEEK_API_KEY` = `your_key`
        *   `DEEPSEEK_API_URL` = `https://openrouter.ai/api/v1/chat/completions`
        *   `DEEPSEEK_MODEL` = `deepseek/deepseek-chat`
    6. Click **Deploy**. Vercel will build the frontend assets, compile the backend Express app into a serverless handler, and make the site live instantly.

---

### Option B: Hugging Face Spaces (Docker - Free 24/7 Hosting)
Hugging Face Spaces offers completely free Docker hosting that remains active 24/7 (does not spin down like Render unless idle for a long duration, but can be instantly awakened by visiting the page).

*   **Cost**: $0/month.
*   **Pros**: Free container hosting, fast, custom builds.
*   **Step-by-step**:
    1. Create an account on [Hugging Face](https://huggingface.co).
    2. Go to **Spaces** and click **Create new Space**.
    3. Enter a Space name, select **Docker** as the SDK, and choose **Blank** template. Keep the Space **Public** (required for free tier).
    4. Clone the Hugging Face Space repository locally, or upload your files directly to the Space.
    5. Add the following files to the root of the repository:
        *   `Dockerfile` (Use the same Dockerfile as listed in **Option B** of Section 2 of this guide, but change the exposed port from `5000` to `7860` as Hugging Face expects port `7860`).
    6. In the Hugging Face Space, go to **Settings** -> **Variables and Secrets** -> Add new Secret:
        *   `DEEPSEEK_API_KEY` = `your_key`
        *   `DEEPSEEK_API_URL` = `https://openrouter.ai/api/v1/chat/completions`
        *   `DEEPSEEK_MODEL` = `deepseek/deepseek-chat`
    7. Once you push the files to the Hugging Face Space repository, it will automatically build and deploy your container. The app will be accessible via their public URL.

---

### Option C: Render Free Web Service (Single Unified App)
You can host the entire application (frontend and backend combined) as a single service on Render's Free Tier.

*   **Cost**: $0/month.
*   **Cons**: The server goes to sleep (spins down) after 15 minutes of inactivity. The next request takes ~50 seconds to boot up.
*   **Step-by-step**:
    1. Push your code to a GitHub repository.
    2. Go to [Render](https://render.com) and log in.
    3. Click **New** -> **Web Service**.
    4. Connect your GitHub repository.
    5. Set the following details:
        *   **Runtime**: `Node`
        *   **Build Command**: `npm install && npm run build --prefix frontend && npm install --prefix backend`
        *   **Start Command**: `node backend/server.js`
        *   **Instance Type**: `Free`
    6. Under **Advanced** -> Add Environment Variables:
        *   `NODE_ENV` = `production`
        *   `DEEPSEEK_API_KEY` = `your_key`
        *   `DEEPSEEK_API_URL` = `https://openrouter.ai/api/v1/chat/completions`
        *   `DEEPSEEK_MODEL` = `deepseek/deepseek-chat`
    7. Click **Deploy Web Service**.

