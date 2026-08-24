import {
  binaryInfo,
  ensureBinary,
  launchContext as launchCloakContext,
} from 'cloakbrowser';
import { chromium, type BrowserContext } from 'playwright';

let installed = false;
let startupLogged = false;

const CLOAK_STARTUP_TIMEOUT_MS = 45_000;

type PlaywrightPersistentOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

/**
 * Installs CloakBrowser behind the Playwright BrowserType object used by the
 * existing crawler. The crawler keeps its mature Playwright page/locator API,
 * while Chromium itself is launched by CloakBrowser.
 *
 * We intentionally use CloakBrowser's normal context path instead of reusing
 * the historical Playwright persistent profile. The old profile is not needed
 * for Google Maps discovery and can make a browser migration fail because of
 * stale Chromium profile locks or incompatible profile state.
 *
 * We do not add proxy rotation, CAPTCHA solving, or challenge bypass logic.
 */
export function installCloakBrowserRuntime(): void {
  if (installed) {
    return;
  }

  const cloakLaunch = async (
    _userDataDir: string,
    options: PlaywrightPersistentOptions = {},
  ): Promise<BrowserContext> => {
    if (!startupLogged) {
      console.log('CloakBrowser: checking stealth Chromium binary...');
    }

    const binaryPath = await withTimeout(
      ensureBinary(),
      CLOAK_STARTUP_TIMEOUT_MS,
      'CloakBrowser binary preparation timed out',
    );

    if (!startupLogged) {
      const info = binaryInfo();
      console.log(
        `CloakBrowser: binary ready (${info.version ?? 'unknown version'}, ${info.tier ?? 'unknown tier'})`,
      );
      console.log(`CloakBrowser: launching ${options.headless ? 'headless' : 'headed'} context...`);
      // Keep the path out of normal logs unless diagnosing startup. The existence
      // check above already guarantees that the wrapper resolved a binary.
      void binaryPath;
    }

    const context = await withTimeout(
      launchCloakContext({
        headless: options.headless ?? false,
        locale: options.locale,
        viewport: options.headless ? (options.viewport ?? undefined) : null,
        humanize: true,
      }),
      CLOAK_STARTUP_TIMEOUT_MS,
      'CloakBrowser context launch timed out',
    );

    if (!startupLogged) {
      console.log(`CloakBrowser: started (${context.pages().length} initial page${context.pages().length === 1 ? '' : 's'})`);
      startupLogged = true;
    }

    return context as unknown as BrowserContext;
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
