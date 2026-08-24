import { launchPersistentContext as launchCloakPersistentContext } from 'cloakbrowser';
import { chromium, type BrowserContext } from 'playwright';

let installed = false;

type PlaywrightPersistentOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

/**
 * Installs CloakBrowser behind the Playwright BrowserType object used by the
 * existing crawler. This keeps the mature Playwright page/locator code intact
 * while all persistent Chromium launches use CloakBrowser's patched binary.
 *
 * We intentionally do not add proxy rotation, CAPTCHA solving, or challenge
 * bypass logic. Existing blocker detection remains authoritative.
 */
export function installCloakBrowserRuntime(): void {
  if (installed) {
    return;
  }

  const cloakLaunch = async (
    userDataDir: string,
    options: PlaywrightPersistentOptions = {},
  ): Promise<BrowserContext> => {
    const context = await launchCloakPersistentContext({
      userDataDir,
      headless: options.headless ?? false,
      locale: options.locale,
      viewport: options.viewport ?? undefined,
      humanize: true,
    });

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
