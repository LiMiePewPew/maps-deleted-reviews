import {
  binaryInfo,
  buildContextOptions,
  buildLaunchOptions,
} from 'cloakbrowser';
import { chromium, type Browser, type BrowserContext } from 'playwright';

let installed = false;
let startupLogged = false;

const CLOAK_STARTUP_TIMEOUT_MS = 45_000;

type PlaywrightPersistentOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

/**
 * Installs CloakBrowser behind the Playwright BrowserType object used by the
 * existing crawler. The crawler keeps its mature Playwright page/locator API,
 * while Chromium itself is CloakBrowser's patched stealth binary.
 *
 * We intentionally use CloakBrowser's official buildLaunchOptions() and
 * buildContextOptions() integration surface, then let our existing Playwright
 * instance perform the launch. This avoids CloakBrowser's higher-level
 * launchContext()/humanize/license-guard wrapping, which caused a Node heap OOM
 * on macOS during startup, while preserving the patched binary and stealth args.
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
    const info = binaryInfo();

    // Reuse an already downloaded binary directly. This prevents another
    // license/update/download resolution after an interrupted first launch.
    if (!process.env.CLOAKBROWSER_BINARY_PATH && info.installed && info.binaryPath) {
      process.env.CLOAKBROWSER_BINARY_PATH = info.binaryPath;
    }

    const headless = options.headless ?? false;
    if (!startupLogged) {
      console.log(
        `CloakBrowser: launching ${headless ? 'headless' : 'headed'} (${info.version ?? 'unknown version'}, ${info.tier ?? 'unknown tier'}, direct Playwright integration)...`,
      );
    }

    const cloakOptions = {
      headless,
      locale: options.locale,
      viewport: headless ? (options.viewport ?? undefined) : null,
      humanize: false,
    };

    const launchOptions = await withTimeout(
      buildLaunchOptions(cloakOptions),
      CLOAK_STARTUP_TIMEOUT_MS,
      'CloakBrowser launch-option preparation timed out',
    );

    const browser = await withTimeout(
      chromium.launch(launchOptions as Parameters<typeof chromium.launch>[0]),
      CLOAK_STARTUP_TIMEOUT_MS,
      'CloakBrowser Chromium launch timed out',
    );

    let context: BrowserContext;
    try {
      context = await withTimeout(
        browser.newContext(
          buildContextOptions(cloakOptions) as Parameters<Browser['newContext']>[0],
        ),
        CLOAK_STARTUP_TIMEOUT_MS,
        'CloakBrowser context creation timed out',
      );
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }

    const originalClose = context.close.bind(context);
    context.close = async () => {
      await originalClose().catch(() => undefined);
      await browser.close().catch(() => undefined);
    };

    if (!startupLogged) {
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
