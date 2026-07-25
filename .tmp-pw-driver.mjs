import { chromium } from "playwright"
import path from "node:path"
import fs from "node:fs/promises"

const shotDir = "C:\\Users\\raava\\AppData\\Local\\Temp\\claude\\c--Users-raava-OneDrive-Desktop-dev-pullsrc\\c078800b-5c0e-452d-b598-82ac729dae21\\scratchpad\\shots"
await fs.mkdir(shotDir, { recursive: true })

const browser = await chromium.launch({ args: ["--no-sandbox"] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const errors = []
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text())
})
page.on("pageerror", (err) => errors.push(String(err)))

async function shot(name) {
  await page.screenshot({ path: path.join(shotDir, `${name}.png`) })
  console.log("screenshot:", name)
}

console.log("== landing ==")
await page.goto("http://localhost:3000", { waitUntil: "networkidle" })
await page.waitForSelector("text=PullSRC")
await shot("01-landing")

console.log("== bare domain warning ==")
await page.locator('input[aria-label="Page url"]').fill("nextjs.org")
await page.getByRole("button", { name: "Scan" }).click()
await page.waitForSelector("text=That looks like a whole site")
await shot("02-bare-domain-warning")

console.log("== real scan: wikipedia ==")
await page.locator('input[aria-label="Page url"]').fill("en.wikipedia.org/wiki/Web_typography")
await page.getByRole("button", { name: "Scan" }).click()
await page.waitForSelector("text=Scanning")
await shot("03-scanning")

await page.waitForFunction(
  () =>
    document.body.innerText.includes("scanned") ||
    document.body.innerText.includes("Couldn't reach") ||
    document.body.innerText.includes("blocked") ||
    document.body.innerText.includes("No assets found"),
  { timeout: 30000 }
)
await shot("04-after-scan")

const bodyText = await page.locator("body").innerText()
console.log("=== page text (first 800 chars) ===")
console.log(bodyText.slice(0, 800))

console.log("console errors so far:", errors)

await browser.close()
