const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

app.post('/api/extract-album', async (req, res) => {
  const { url } = req.body;
  if (!url || (!url.includes('photos.app.goo.gl') && !url.includes('photos.google.com') && !url.includes('goo.gl'))) {
    return res.status(400).json({ error: 'Invalid Google Photos URL. Please provide a valid Google Photos album link.' });
  }

  let browser;
  try {
    // Launch system Chrome on macOS cleanly
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000 });
    
    // Go to the Google Photos album
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Allow client-side JS redirects (e.g. photos.app.goo.gl -> photos.google.com) to settle
    await new Promise(r => setTimeout(r, 1000));

    // Safe execution helpers that recover from context destruction during redirects
    const safeEvaluate = async (fn, maxRetries = 3) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await page.evaluate(fn);
        } catch (err) {
          if (err.message && (err.message.includes('Execution context was destroyed') || err.message.includes('Cannot find context'))) {
            await new Promise(r => setTimeout(r, 700));
            continue;
          }
          throw err;
        }
      }
      return await page.evaluate(fn);
    };

    const safeContent = async (maxRetries = 3) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          return await page.content();
        } catch (err) {
          if (err.message && (err.message.includes('Execution context was destroyed') || err.message.includes('Cannot find context'))) {
            await new Promise(r => setTimeout(r, 700));
            continue;
          }
          throw err;
        }
      }
      return await page.content();
    };

    let uniqueUrls = new Set();
    const regex = /(https:\/\/lh3\.googleusercontent\.com\/(?:pw\/)?[a-zA-Z0-9\-_]{40,})/g;

    // Helper to scrape current DOM
    const extractCurrentDOM = async () => {
      const html = await safeContent();
      let match;
      while ((match = regex.exec(html)) !== null) { 
        uniqueUrls.add(match[1]); 
      }
    };

    // Scroll Loop: Google lazy-loads DOM nodes
    let lastHeight = await safeEvaluate(() => document.body.scrollHeight);
    let retries = 0;
    const MAX_SCROLLS = 100;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      await extractCurrentDOM();
      
      // Scroll down
      await safeEvaluate(() => window.scrollBy(0, 1500));
      
      // Wait for lazy loading
      await new Promise(r => setTimeout(r, 500));
      
      let newHeight = await safeEvaluate(() => document.body.scrollHeight);
      if (newHeight === lastHeight) {
        retries++;
        if (retries >= 4) break; 
      } else {
        retries = 0;
        lastHeight = newHeight;
      }
    }
    
    await extractCurrentDOM();
    await browser.close();

    const photosArray = Array.from(uniqueUrls);
    if (photosArray.length === 0) {
      return res.status(404).json({ error: 'No public photos found in this album link. Make sure the Google Photos link is shared publicly.' });
    }

    const photos = photosArray.map(baseUrl => ({
      url: `${baseUrl}=w1200-h1200-no`,
      title: 'Google Photos Image'
    }));

    res.json({ success: true, count: photos.length, photos });

  } catch (error) {
    console.error('Extract Album Error:', error);
    if (browser) {
      try { await browser.close(); } catch(e) {}
    }
    res.status(500).json({ error: 'Failed to extract photos: ' + error.message });
  }
});

const PORT = 3020;

// Serve static files from Vite build
if (fs.existsSync(path.join(__dirname, 'dist'))) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => console.log(`Google Photos Canvas Server running on port ${PORT}`));
