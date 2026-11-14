// Optional browser acceptance. Requires local Playwright installation and an already running server.
// npm install --no-save playwright && npx playwright install chromium
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(process.env.HF_URL||'http://127.0.0.1:4173');await page.getByRole('heading',{name:'Operations Centre'}).waitFor();await page.locator('#login input[name="username"]').waitFor();await page.locator('#intel-file').waitFor();console.log('Browser smoke acceptance passed: mobile viewport, login form, evidence import present');}finally{await browser.close()}
