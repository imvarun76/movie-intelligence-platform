# 🌐 ShowDyme — 100% Free Public Cloud Deployment Guide

This guide walks you through deploying **ShowDyme** to the public internet for **$0.00** so anyone can access it live in their browser.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SHOWDYME FREE PRODUCTION TOPOLOGY                    │
├─────────────────────┬──────────────────────────┬───────────────────────┤
│ Tier                │ Provider                 │ Free Tier Allowance   │
├─────────────────────┼──────────────────────────┼───────────────────────┤
│ **Frontend UI**     │ **Vercel**               │ 100% Free Unlimited   │
│ **Backend API**     │ **Render.com / Koyeb**   │ 100% Free Web Service │
│ **Database**        │ **Neon.tech / Supabase** │ 100% Free Serverless  │
│                     │                          │ PostgreSQL + pgvector │
└─────────────────────┴──────────────────────────┴───────────────────────┘
```

---

## ⚡ Quick 3-Step Deployment (Under 10 Minutes)

### Step 1: Create Free Cloud Database (Neon.tech or Supabase)

1. Go to [Neon.tech](https://neon.tech/) (or [Supabase.com](https://supabase.com/)) and sign in with GitHub for free.
2. Click **Create Project** -> Name: `showdyme-db`.
3. Copy your connection string. It will look like:
   ```text
   postgresql://user:password@ep-cool-snowflake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Seed your cloud database in **1 command** from your local terminal:
   ```bash
   PYTHONPATH=. backend/.venv/bin/python backend/scripts/deploy_cloud_db.py "postgresql+psycopg://user:password@ep-cool-snowflake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
   ```
   > This automatically creates all tables, runs Alembic migrations, loads all 442 movies, and computes the real-time feature store!

---

### Step 2: Deploy Backend to Render.com (100% Free)

1. Go to [Render.com](https://render.com/) and sign in with GitHub.
2. Click **New +** -> **Web Service**.
3. Connect your repository: `imvarun76/movie-intelligence-platform`.
4. Render will detect the repository:
   - **Environment**: `Docker` (using the included [`Dockerfile`](file:///Users/varunmishra/Projects/movie-intelligence-platform/Dockerfile))
   - **Instance Type**: `Free`
5. Under **Environment Variables**, add:
   - `DATABASE_URL`: Your Neon/Supabase connection string with `postgresql+psycopg://...`
   - `TMDB_API_KEY`: `d3e1ef6b712ff648df62d639a9f09428`
   - `FRONTEND_URL`: `*` (or your future Vercel URL)
6. Click **Deploy Web Service**.
7. Once deployed, Render will give you a public URL like:
   `https://showdyme-api.onrender.com`

---

### Step 3: Deploy Frontend to Vercel (100% Free)

1. Go to [Vercel.com](https://vercel.com/) and sign in with GitHub.
2. Click **Add New Project** -> Import `movie-intelligence-platform`.
3. In Project Settings:
   - **Root Directory**: Click Edit -> select `frontend` (or leave root since `vercel.json` is configured).
   - **Framework Preset**: `Vite`
4. Under **Environment Variables**, add:
   - `VITE_API_URL`: Your Render backend URL (e.g., `https://showdyme-api.onrender.com`)
5. Click **Deploy**.

Vercel will build and launch **ShowDyme** at a public URL (e.g. `https://showdyme.vercel.app`) in under 60 seconds!

---

## 🛠️ Included Deployment Artifacts in Repository

- [`Dockerfile`](file:///Users/varunmishra/Projects/movie-intelligence-platform/Dockerfile): Production container for FastAPI + Alembic.
- [`render.yaml`](file:///Users/varunmishra/Projects/movie-intelligence-platform/render.yaml): Render Blueprint for automated web service.
- [`vercel.json`](file:///Users/varunmishra/Projects/movie-intelligence-platform/frontend/vercel.json): Vercel routing configuration for Vite SPA.
- [`backend/scripts/deploy_cloud_db.py`](file:///Users/varunmishra/Projects/movie-intelligence-platform/backend/scripts/deploy_cloud_db.py): Automated cloud database migrator and seeder.
