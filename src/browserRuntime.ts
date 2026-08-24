import {
  binaryInfo,
  launchPersistentContext as launchCloakPersistentContext,
} from 'cloakbrowser';
import type { BrowserContext } from 'playwright';

const CLOAK_STARTUP_TIMEOUT_MS = 45_000;
const HEADED_WINDOW_WIDTH = 1440;
const HEADED_WINDOW_HEIGHT = 1100;
const MIN_CONTEXT_PAGES = 2;

export interface ExperimentalCloakOptions {
  headless: boolean;
  locale?: string;
  viewport?: { width: number; height: number };
}

/**
 * Experimental CloakBrowser backend.
 *
 * This function is intentionally explicit. It does not patch Playwright's
 * chromium.launchPersistentContext() and therefore cannot recursively intercept
 * CloakBrowser's own internal Playwright launch calls.
 *
 * Production/default crawler paths currently use Playwright Chromium directly,
 * matching the known-working upstream architecture. CloakBrowser can be tested
 * separately through this helper without changing global browser behavior.
 */
export async function launchExperimentalCloakPersistentContext(
  userDataDir: string,
  options: ExperimentalCloakOptions,
): Promise<BrowserContext> {
  const info = binaryInfo();

  if (!process.env.CLOAKBROWSER_BINARY_PATH && info.installed && info.binaryPath) {
    process.env.CLOAKBROWSER_BINARY_PATH = info.binaryPath;
  }

  console.log(
    `CloakBrowser: launching ${options.headless ? 'headless' : 'headed'} (${info.version ?? 'unknown version'}, ${info.tier ?? 'unknown tier'}, explicit experimental backend)...`,
  );

  const context = await withTimeout(
    launchCloakPersistentContext({
      userDataDir,
      headless: options.headless,
      locale: options.locale,
      viewport: options.viewport ?? { width: HEADED_WINDOW_WIDTH, height: HEADED_WINDOW_HEIGHT },
      args: options.headless ? [] : [`--window-size=${HEADED_WINDOW_WIDTH},${HEADED_WINDOW_HEIGHT}`],
      humanize: false,
    }),
    CLOAK_STARTUP_TIMEOUT_MS,
    'CloakBrowser persistent context launch timed out',
  );

  const browserContext = context as unknown as BrowserContext;
  await ensureSpareKeepalivePage(browserContext);

  console.log('CloakBrowser: experimental context started');
  return browserContext;
}

async function ensureSpareKeepalivePage(context: BrowserContext): Promise<void> {
  while (context.pages().length < MIN_CONTEXT_PAGES) {
    await context.newPage();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${message} after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
