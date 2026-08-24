import { chromium, type Browser, type BrowserContext } from 'playwright';

export type BrowserBackend = 'playwright' | 'cloak';

let cloakInstalled = false;
let startupLogged = false;

const CLOAK_STARTUP_TIMEOUT_MS = 45_000;

type PlaywrightPersistentOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

type CloakModule = {
  binaryInfo: () => {
    installed?: boolean;
    binaryPath?: string;
    version?: string;
    tier?: string;
  };
  buildLaunchOptions: (options: Record<string, unknown>) => Promise<unknown>;
  buildContextOptions: (options: Record<string, unknown>) => unknown;
};

/**
 * Experimental A/B runtime for the known-good scraper.
 *
 * This deliberately leaves all Maps discovery, review clicking, extraction and
 * parsing code untouched. Only the Chromium launch is swapped. The wrapper uses
 * CloakBrowser's patched Chromium through Playwright's normal page/locator API.
 *
 * It is opt-in via --browser cloak. The default remains Playwright Chromium.
 */
export async function installBrowserBackend(backend: BrowserBackend): Promise<void> {
  if (backend !== 'cloak' || cloakInstalled) {
    return;
  }

  const cloak = await loadCloakBrowser();

  const cloakLaunch = async (
    _userDataDir: string,
    options: PlaywrightPersistentOptions = {},
  ): Promise<BrowserContext> => {
    const info = cloak.binaryInfo();

    if (!process.env.CLOAKBROWSER_BINARY_PATH && info.installed && info.binaryPath) {
      process.env.CLOAKBROWSER_BINARY_PATH = info.binaryPath;
    }

    const headless = options.headless ?? false;
    if (!startupLogged) {
      console.log(
        `CloakBrowser: launching ${headless ? 'headless' : 'headed'} (${info.version ?? 'unknown version'}, ${info.tier ?? 'unknown tier'}, isolated direct Playwright integration)...`,
      );
    }

    const cloakOptions = {
      headless,
      locale: options.locale,
      viewport: headless ? (options.viewport ?? undefined) : null,
      humanize: false,
    };

    const launchOptions = await withTimeout(
      cloak.buildLaunchOptions(cloakOptions),
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
          cloak.buildContextOptions(cloakOptions) as Parameters<Browser['newContext']>[0],
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

  cloakInstalled = true;
}

export function browserDisplayName(backend: BrowserBackend): string {
  return backend === 'cloak' ? 'CloakBrowser (experimental A/B)' : 'Playwright Chromium';
}

async function loadCloakBrowser(): Promise<CloakModule> {
  try {
    const moduleName = 'cloakbrowser';
    return (await import(moduleName)) as CloakModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `CloakBrowser is not installed. Run "npm install cloakbrowser@0.5.8 --no-save" for the A/B test. Cause: ${detail}`,
    );
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
