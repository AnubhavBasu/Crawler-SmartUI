
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from the "public" folder.
app.use(express.static('public'));

// Middleware to parse URL-encoded and JSON bodies.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ==========================================
   Utility Functions
========================================== */

// Generate a slug from text.
function slugify(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')       // Replace spaces with -
        .replace(/[^\w\-]+/g, '')    // Remove non-word characters
        .replace(/\-\-+/g, '-');     // Replace multiple dashes with a single dash
}

// Fetch the <title> from a given URL.
async function getPageTitle(url) {
    try {
        const response = await axios.get(url, { timeout: 10000 });
        const $ = cheerio.load(response.data);
        let title = $('title').text().trim();
        return title || 'No Title';
    } catch (error) {
        console.error("Error fetching title from " + url + ": " + error.message);
        return 'Error';
    }
}

/**
 * Concurrently crawl the website using a BFS approach.
 * @param {string} startUrl - The starting URL.
 * @param {number} maxDepth - Maximum depth to crawl.
 * @param {number} concurrencyLimit - Maximum number of concurrent requests per level.
 * @param {number} maxPages - Maximum total pages to crawl.
 * @returns {Promise<Set>} - A set of visited URLs.
 */
async function crawlWebsite(startUrl, maxDepth = 2, concurrencyLimit = 10, maxPages = 100) {
    const visited = new Set();
    visited.add(startUrl);
    let currentLevel = [startUrl];
    console.log(`Starting crawl at: ${startUrl}`);

    for (let depth = 0; depth < maxDepth; depth++) {
        let nextLevel = [];
        console.log(`Depth ${depth}: processing ${currentLevel.length} URLs`);
        // Process current level in chunks to limit concurrency.
        for (let i = 0; i < currentLevel.length; i += concurrencyLimit) {
            const chunk = currentLevel.slice(i, i + concurrencyLimit);
            const promises = chunk.map(url =>
                axios.get(url, { timeout: 10000 })
                    .then(response => {
                        console.log(`Crawled: ${url}`);
                        const $ = cheerio.load(response.data);
                        const links = $('a[href]').map((i, el) => {
                            try {
                                return new URL($(el).attr('href'), url).href;
                            } catch (e) {
                                return null;
                            }
                        }).get().filter(link => link !== null);
                        // Filter links on the same domain and not already visited.
                        const newLinks = links.filter(link => {
                            const sameDomain = (new URL(link).hostname === new URL(startUrl).hostname);
                            return sameDomain && !visited.has(link);
                        });
                        newLinks.forEach(link => visited.add(link));
                        return newLinks;
                    })
                    .catch(err => {
                        console.error("Error crawling " + url + ": " + err.message);
                        return [];
                    })
            );
            const results = await Promise.all(promises);
            for (const links of results) {
                nextLevel.push(...links);
            }
            if (visited.size >= maxPages) break;
        }
        currentLevel = nextLevel;
        console.log(`Depth ${depth}: found ${nextLevel.length} new URLs`);
        if (visited.size >= maxPages || currentLevel.length === 0) break;
    }
    console.log(`Crawl finished. Total URLs found: ${visited.size}`);
    return visited;
}

// Save URLs with titles into "urls.json" (fetching titles for each URL).
async function saveUrlsWithTitles(urls, baseUrl) {
    let results = [];
    for (let url of urls) {
        let title = await getPageTitle(url);
        let name = slugify(title);
        if (!name || name === 'error' || name === 'no-title') {
            const pathname = new URL(url).pathname;
            name = (pathname === '/') ? 'home-page' : slugify(pathname.replace(/\//g, ' '));
        }
        let entry = { name, url };
        if (url === baseUrl) {
            entry.waitForTimeout = 1000;
        }
        results.push(entry);
    }
    fs.writeFileSync('urls.json', JSON.stringify(results, null, 2), 'utf-8');
    console.log('Saved URLs and titles to urls.json');
}

// Create the ".smartui.json" configuration file.
function createSmartUIConfig(selectedBrowsers, selectedViewports) {
    if (!Array.isArray(selectedBrowsers)) {
        selectedBrowsers = selectedBrowsers ? [selectedBrowsers] : [];
    }
    if (!Array.isArray(selectedViewports)) {
        selectedViewports = selectedViewports ? [selectedViewports] : [];
    }
    selectedViewports = selectedViewports.map(v => [parseInt(v, 10)]);
    const config = {
        web: {
            browsers: selectedBrowsers,
            viewports: selectedViewports
        }
    };
    fs.writeFileSync('.smartui.json', JSON.stringify(config, null, 2), 'utf-8');
    console.log('Created .smartui.json configuration file');
}

// Poll for the existence of "results.json" and then read its content.
function waitForResultsFile(callback, interval = 2000, maxAttempts = 30) {
    let attempts = 0;
    const checkFile = () => {
        attempts++;
        if (fs.existsSync('results.json')) {
            fs.readFile('results.json', 'utf-8', (err, data) => {
                if (err) {
                    callback(err);
                } else {
                    callback(null, data);
                }
            });
        } else if (attempts < maxAttempts) {
            setTimeout(checkFile, interval);
        } else {
            callback(new Error("results.json not generated within timeout"));
        }
    };
    checkFile();
}

/* ==========================================
   Route Handlers
========================================== */

// GET "/" - Display the initial form.
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
  <head>
    <title>SmartUI Test Crawler</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <div class="container">
      <h1>SmartUI Test Crawler</h1>
      <form action="/start" method="post">
        <label for="websiteUrl">Website URL:</label>
        <input type="text" id="websiteUrl" name="websiteUrl" placeholder="https://example.com" required>
        
        <label for="projectToken">SmartUI Project Token:</label>
        <input type="text" id="projectToken" name="projectToken" required>
        
        <label for="username">Lambdatest Username:</label>
        <input type="text" id="username" name="username" required>
        
        <label for="accessKey">Lambdatest AccessKey:</label>
        <input type="text" id="accessKey" name="accessKey" required>
        
        <div class="remember-container">
          <input type="checkbox" id="remember" name="remember" value="1">
          <label for="remember">Remember my credentials</label>
        </div>
        
        <fieldset>
          <legend>Select Desktop Browsers:</legend>
          <input type="checkbox" id="chrome" name="browsers" value="chrome">
          <label for="chrome" class="inline-label">Chrome</label><br>
          <input type="checkbox" id="firefox" name="browsers" value="firefox">
          <label for="firefox" class="inline-label">Firefox</label><br>
          <input type="checkbox" id="safari" name="browsers" value="safari">
          <label for="safari" class="inline-label">Safari</label><br>
          <input type="checkbox" id="edge" name="browsers" value="edge">
          <label for="edge" class="inline-label">Edge</label>
        </fieldset>
        
        <fieldset>
          <legend>Select Desktop Viewports (width in pixels):</legend>
          <input type="checkbox" id="1920" name="viewports" value="1920">
          <label for="1920" class="inline-label">1920</label><br>
          <input type="checkbox" id="1366" name="viewports" value="1366">
          <label for="1366" class="inline-label">1366</label><br>
          <input type="checkbox" id="1028" name="viewports" value="1028">
          <label for="1028" class="inline-label">1028</label>
        </fieldset>
        
        <input type="submit" value="Start">
      </form>
    </div>
    <script>
      // Pre-populate fields from localStorage if available.
      window.addEventListener('DOMContentLoaded', () => {
        const cachedProjectToken = localStorage.getItem('PROJECT_TOKEN');
        const cachedUsername = localStorage.getItem('LT_USERNAME');
        const cachedAccessKey = localStorage.getItem('LT_ACCESS_KEY');
        if (cachedProjectToken) {
          document.getElementById('projectToken').value = cachedProjectToken;
        }
        if (cachedUsername) {
          document.getElementById('username').value = cachedUsername;
        }
        if (cachedAccessKey) {
          document.getElementById('accessKey').value = cachedAccessKey;
        }
      });
      
      // On form submission, cache the credentials if "Remember my credentials" is checked.
      document.querySelector('form').addEventListener('submit', function(e) {
        const remember = document.getElementById('remember').checked;
        if (remember) {
          localStorage.setItem('PROJECT_TOKEN', document.getElementById('projectToken').value);
          localStorage.setItem('LT_USERNAME', document.getElementById('username').value);
          localStorage.setItem('LT_ACCESS_KEY', document.getElementById('accessKey').value);
        } else {
          localStorage.removeItem('PROJECT_TOKEN');
          localStorage.removeItem('LT_USERNAME');
          localStorage.removeItem('LT_ACCESS_KEY');
        }
      });
    </script>
  </body>
</html>
  `);
});

// POST "/start" - Crawl the site and display a list of crawled URLs with checkboxes.
app.post('/start', async (req, res) => {
    const { websiteUrl, projectToken, username, accessKey, browsers, viewports } = req.body;

    // Set environment variables.
    process.env.PROJECT_TOKEN = projectToken;
    process.env.LT_USERNAME = username;
    process.env.LT_ACCESS_KEY = accessKey;

    // Create the configuration file.
    createSmartUIConfig(browsers, viewports);

    // Crawl the website.
    let visitedUrls = await crawlWebsite(websiteUrl, 2, 10, 100);

    // Render a form with the list of crawled URLs.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write(`
<!DOCTYPE html>
<html>
  <head>
    <title>Select URLs for Testing</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <div class="results-container">
      <h1>Found ${visitedUrls.size} URLs</h1>
      <p>Select the URLs you want to test:</p>
      <div>
        <button type="button" onclick="selectAll()">Select All</button>
        <button type="button" onclick="clearAll()">Clear All</button>
      </div>
      <form action="/run-tests" method="post">
  `);

    // Include hidden fields to carry over credentials and settings.
    res.write(`<input type="hidden" name="websiteUrl" value="${websiteUrl}">`);
    res.write(`<input type="hidden" name="projectToken" value="${projectToken}">`);
    res.write(`<input type="hidden" name="username" value="${username}">`);
    res.write(`<input type="hidden" name="accessKey" value="${accessKey}">`);
    if (browsers) {
        if (Array.isArray(browsers)) {
            browsers.forEach(b => res.write(`<input type="hidden" name="browsers" value="${b}">`));
        } else {
            res.write(`<input type="hidden" name="browsers" value="${browsers}">`);
        }
    }
    if (viewports) {
        if (Array.isArray(viewports)) {
            viewports.forEach(v => res.write(`<input type="hidden" name="viewports" value="${v}">`));
        } else {
            res.write(`<input type="hidden" name="viewports" value="${viewports}">`);
        }
    }

    // List each URL with a checkbox (pre-checked by default).
    for (let url of visitedUrls) {
        res.write(`<div><input type="checkbox" name="selectedUrls" value="${url}" checked> ${url}</div>`);
    }

    res.write(`
        <br>
        <input type="submit" value="Run Tests on Selected URLs">
      </form>
      <script>
        function selectAll() {
          var checkboxes = document.getElementsByName('selectedUrls');
          for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = true;
          }
        }
        function clearAll() {
          var checkboxes = document.getElementsByName('selectedUrls');
          for (var i = 0; i < checkboxes.length; i++) {
            checkboxes[i].checked = false;
          }
        }
      </script>
    </div>
  </body>
</html>
  `);
    res.end();
});

// POST "/run-tests" - Run SmartUI tests on the selected URLs.
app.post('/run-tests', async (req, res) => {
    let selectedUrls = req.body.selectedUrls;
    if (!selectedUrls) {
        res.send("No URLs selected. Please go back and select at least one URL.");
        return;
    }
    if (!Array.isArray(selectedUrls)) {
        selectedUrls = [selectedUrls];
    }

    // Retrieve credentials and settings.
    const { websiteUrl, projectToken, username, accessKey, browsers, viewports } = req.body;
    process.env.PROJECT_TOKEN = projectToken;
    process.env.LT_USERNAME = username;
    process.env.LT_ACCESS_KEY = accessKey;

    // Re-create configuration file.
    createSmartUIConfig(browsers, viewports);

    // Save the selected URLs (with titles) into "urls.json".
    await saveUrlsWithTitles(selectedUrls, websiteUrl);

    // Build test command with Windows-style "set" commands.
    const testCmd = `set LT_USERNAME=${process.env.LT_USERNAME} && set LT_ACCESS_KEY=${process.env.LT_ACCESS_KEY} && set PROJECT_TOKEN=${process.env.PROJECT_TOKEN} && npx smartui capture urls.json --config .smartui.json --fetch-results`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.write(`
<!DOCTYPE html>
<html>
  <head>
    <title>SmartUI Test Results</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="/style.css">
  </head>
  <body>
    <div class="results-container">
      <h1>Running SmartUI Tests...</h1>
      <p>Please wait while tests are executed.</p>
  `);

    exec(testCmd, (error, stdout, stderr) => {
        if (error) {
            console.error("Error triggering SmartUI tests: " + error.message);
            res.write(`<p>Error triggering SmartUI tests: ${error.message}</p>`);
            return res.end(`</div></body></html>`);
        } else {
            console.log("SmartUI tests triggered: " + stdout);
            waitForResultsFile((err, data) => {
                if (err) {
                    console.error("Error waiting for results.json: " + err.message);
                    res.write(`<p>Error: ${err.message}</p>`);
                } else {
                    res.write(`<h2>Test Results:</h2>`);
                    res.write(`<pre>${data}</pre>`);
                }
                res.end(`</div></body></html>`);
            });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
