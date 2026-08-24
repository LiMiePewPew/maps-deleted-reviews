import {
  binaryInfo,
  buildContextOptions,
  buildLaunchOptions,
} from 'cloakbrowser';
import { chromium, type BrowserContext } from 'playwright';

let installed = false;
let startupLogged = false;

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
 * while Chromium itself is CloakBrowser's patched stealth binary.
 *
 * We intentionally use CloakBrowser's official buildLaunchOptions() and
 * buildContextOptions() integration surface, then call Playwright's original
 * launchPersistentContext(). This avoids CloakBrowser's higher-level
 * launchContext()/humanize/license-guard wrapping, which caused a Node heap OOM
 * on macOS during startup, while preserving both the patched Chromium binary and
 * the crawler's persistent browser profile.
 *
 * We also keep one spare about:blank page alive. Pipeline V3 closes its worker
 * pages between discovery and notice checking; Cloak Chromium on macOS can exit
 * when the final browser window disappears. The spare page is deliberately not
 * part of the worker pools and is closed only when the context itself closes.
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
    const info = binaryInfo();

    if (!process.env.CLOAKBROWSER_BINARY_PATH && info.installed && info.binaryPath) {
      process.env.CLOAKBROWSER_BINARY_PATH = info.binaryPath;
    }

    const headless = options.headless ?? false;
    if (!startupLogged) {
      console.log(
        `CloakBrowser: launching ${headless ? 'headless' : 'headed'} (${info.version ?? 'unknown version'}, ${info.tier ?? 'unknown tier'}, persistent Playwright integration)...`,
      );
    }

    const cloakOptions = {
      headless,
      locale: options.locale,
      viewport: headless ? (options.viewport ?? undefined) : null,
      args: headless ? [] : [`--window-size=${HEADED_WINDOW_WIDTH},${HEADED_WINDOW_HEIGHT}`],
      humanize: false,
    };

    const launchOptions = await withTimeout(
      buildLaunchOptions(cloakOptions),
      CLOAK_STARTUP_TIMEOUT_MS,
      'CloakBrowser launch-option preparation timed out',
    );
    const contextOptions = buildContextOptions(cloakOptions) as PlaywrightPersistentOptions;

    const launchArgs = Array.isArray((launchOptions as PlaywrightPersistentOptions).args)
      ? ((launchOptions as PlaywrightPersistentOptions).args ?? [])
      : [];
    const callerArgs = options.args ?? [];

    const persistentOptions: PlaywrightPersistentOptions = {
      ...(launchOptions as PlaywrightPersistentOptions),
      ...contextOptions,
      ...options,
      headless,
      args: [...new Set([...launchArgs, ...callerArgs])],
      locale: options.locale ?? contextOptions.locale,
      viewport: headless ? (options.viewport ?? contextOptions.viewport) : null,
    };

    const context = await withTimeout(
      playwrightLaunchPersistentContext(userDataDir, persistentOptions),
      CLOAK_STARTUP_TIMEOUT_MS,
      'CloakBrowser persistent context launch timed out',
    );

    await ensureSpareKeepalivePage(context);

    if (!startupLogged) {
      console.log('CloakBrowser: persistent profile enabled');
      console.log('CloakBrowser: started');
      startupLogged = true;
    }

    return context;
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
