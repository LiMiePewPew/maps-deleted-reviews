import {
  binaryInfo,
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
 * CloakBrowser resolves/downloads its own binary inside launchContext(). We do
 * not call ensureBinary() separately because that duplicates license/download
 * resolution and can stall after a first-time Pro download on some platforms.
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
      const info = binaryInfo();
      console.log(
        `CloakBrowser: launching ${options.headless ? 'headless' : 'headed'} context ` +
          `(${info.installed ? `cached ${info.version ?? 'binary'}` : 'binary will be prepared by CloakBrowser'})...`,
      );
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
      const info = binaryInfo();
      console.log(
        `CloakBrowser: started (${info.version ?? 'unknown version'}, ${info.tier ?? 'unknown tier'}, ` +
          `${context.pages().length} initial page${context.pages().length === 1 ? '' : 's'})`,
      );
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
