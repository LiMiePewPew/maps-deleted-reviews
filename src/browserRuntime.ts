import {
  binaryInfo,
  launchPersistentContext as launchCloakPersistentContext,
} from 'cloakbrowser';
import { chromium, type BrowserContext } from 'playwright';

let installed = false;
let startupLogged = false;
let cloakLaunchDepth = 0;

const CLOAK_STARTUP_TIMEOUT_MS = 45_000;
const HEADED_WINDOW_WIDTH = 1440;
const HEADED_WINDOW_HEIGHT = 1100;
const MIN_CONTEXT_PAGES = 2;

const playwrightLaunchPersistentContext = chromium.launchPersistentContext.bind(chromium);

type PlaywrightPersistentOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

/**
 * Installs CloakBrowser behind the Playwright BrowserType object used by the
 * existing crawler. The crawler keeps its mature Playwright page/locator API,
 * while Chromium itself is launched through CloakBrowser's official persistent
 * context API.
 *
 * CloakBrowser's official persistent launcher delegates back into Playwright's
 * chromium.launchPersistentContext() internally. Because the crawler patches
 * that same method, an unguarded wrapper recursively calls itself forever. We
 * therefore capture Playwright's original persistent launcher before patching
 * and route nested launch calls directly to that original implementation.
 *
 * We keep humanize disabled because the crawler already drives normal Playwright
 * actions and a previous high-level humanize launch path caused excessive Node
 * heap growth. We also avoid a separate ensureBinary() preflight because the
 * official launcher resolves the cached binary itself.
 *
 * Two initial pages are kept so Pipeline V3 can close discovery worker pages
 * without ever removing the last browser window before notice checking starts.
 *
 * We do not add proxy rotation, CAPTCHA solving, or challenge bypass logic.
 */
export function installCloakBrowserRuntime(): void {
  if (installed) {
    return;
  }

  const cloakLaunch = async (
    userDataDir: string,
    options: PlaywrightPersistentOptions = {},
  ): Promise<BrowserContext> => {
    // CloakBrowser itself eventually calls Playwright's persistent launcher.
    // If that nested call reaches this patched method, bypass Cloak and invoke
    // the original Playwright implementation to break the recursion.
    if (cloakLaunchDepth > 0) {
      return playwrightLaunchPersistentContext(userDataDir, options);
    }

    cloakLaunchDepth += 1;
    try {
      const info = binaryInfo();

      if (!process.env.CLOAKBROWSER_BINARY_PATH && info.installed && info.binaryPath) {
        process.env.CLOAKBROWSER_BINARY_PATH = info.binaryPath;
      }

      const headless = options.headless ?? false;
      if (!startupLogged) {
        console.log(
          `CloakBrowser: launching ${headless ? 'headless' : 'headed'} (${info.version ?? 'unknown version'}, ${info.tier ?? 'unknown tier'}, official persistent context)...`,
        );
      }

      const context = await withTimeout(
        launchCloakPersistentContext({
          userDataDir,
          headless,
          locale: options.locale,
          viewport: options.viewport ?? { width: HEADED_WINDOW_WIDTH, height: HEADED_WINDOW_HEIGHT },
          args: headless ? [] : [`--window-size=${HEADED_WINDOW_WIDTH},${HEADED_WINDOW_HEIGHT}`],
          humanize: false,
        }),
        CLOAK_STARTUP_TIMEOUT_MS,
        'CloakBrowser persistent context launch timed out',
      );

      const browserContext = context as unknown as BrowserContext;
      await ensureSpareKeepalivePage(browserContext);

      if (!startupLogged) {
        console.log('CloakBrowser: persistent profile enabled');
        console.log('CloakBrowser: started');
        startupLogged = true;
      }

      return browserContext;
    } finally {
      cloakLaunchDepth -= 1;
    }
  };

  Object.defineProperty(chromium, 'launchPersistentContext', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: cloakLaunch,
  });

  installed = true;
}

export function crawlerBrowserName(): string {
  return 'CloakBrowser';
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
