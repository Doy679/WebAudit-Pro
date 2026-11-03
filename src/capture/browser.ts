import { chromium, type Browser } from "playwright";

/** Launches the configured installed browser (e.g. Edge), falling back to Playwright's bundled Chromium. */
export async function launchBrowser(channel?: string): Promise<Browser> {
  if (channel) {
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      console.warn(`Could not launch "${channel}" (${(e as Error).message.split("\n")[0]}); trying bundled Chromium.`);
    }
  }
  return chromium.launch();
}
