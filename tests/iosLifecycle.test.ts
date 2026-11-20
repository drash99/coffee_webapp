import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe.skipIf(process.platform !== 'darwin')('iOS scene lifecycle', () => {
  it('declares the single-window scene and its existing bridge storyboard', () => {
    const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', 'ios/App/App/Info.plist'], { encoding: 'utf8' }));
    const manifest = info.UIApplicationSceneManifest;
    expect(manifest.UIApplicationSupportsMultipleScenes).toBe(false);
    expect(manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication).toEqual([{
      UISceneConfigurationName: 'Default Configuration',
      UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      UISceneStoryboardFile: 'Main',
    }]);
    expect(info.UIMainStoryboardFile).toBeUndefined();
  });

  it('preserves plugin window access and cold/warm URL and universal-link delivery', () => {
    const source = readFileSync(resolve('ios/App/App/SceneDelegate.swift'), 'utf8').replace(/^import (UIKit|Capacitor)\n/gm, '');
    const fixture = `
import Foundation
class UIResponder {}
protocol UIWindowSceneDelegate {}
class UIWindow {}
class UIScene {
    struct ConnectionOptions {
        var urlContexts: Set<UIOpenURLContext> = []
        var userActivities: Set<NSUserActivity> = []
    }
}
class UIWindowScene: UIScene {}
class UISceneSession {}
class AppDelegate { var window: UIWindow? }
class UIApplication {
    static let shared = UIApplication()
    var delegate: AnyObject?
    enum OpenURLOptionsKey { case sourceApplication, annotation, openInPlace }
}
class UIOpenURLContext: NSObject {
    let url = URL(string: "beanlog://auth/callback")!
    let options = Options()
    class Options {
        var sourceApplication: String? = "test.browser"
        var annotation: Any? = "test.annotation"
        var openInPlace = true
    }
}
class ApplicationDelegateProxy {
    static let shared = ApplicationDelegateProxy()
    var urls: [URL] = []
    var activities: [NSUserActivity] = []
    var options: [[UIApplication.OpenURLOptionsKey: Any]] = []
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) -> Bool {
        urls.append(url); self.options.append(options); return true
    }
    func application(_ app: UIApplication, continue activity: NSUserActivity, restorationHandler: ([Any]?) -> Void) -> Bool {
        activities.append(activity); return true
    }
}
${source}
let scene = UIWindowScene()
let delegate = SceneDelegate()
let appDelegate = AppDelegate()
UIApplication.shared.delegate = appDelegate
delegate.window = UIWindow()
let context = UIOpenURLContext()
let activity = NSUserActivity(activityType: NSUserActivityTypeBrowsingWeb)
delegate.scene(scene, willConnectTo: UISceneSession(), options: .init(urlContexts: [context], userActivities: [activity]))
precondition(appDelegate.window === delegate.window)
delegate.scene(scene, openURLContexts: [context])
delegate.scene(scene, continue: activity)
let proxy = ApplicationDelegateProxy.shared
precondition(proxy.urls == [context.url, context.url])
precondition(proxy.activities.count == 2 && proxy.activities.allSatisfy { $0 === activity })
for options in proxy.options {
    precondition(options[.sourceApplication] as? String == "test.browser")
    precondition(options[.annotation] as? String == "test.annotation")
    precondition(options[.openInPlace] as? Bool == true)
}
delegate.scene(UIScene(), willConnectTo: UISceneSession(), options: .init(urlContexts: [context]))
precondition(proxy.urls.count == 2)
print("PASS: scene window and cold/warm links")
`;
    const dir = mkdtempSync(join(tmpdir(), 'beanlog-scene-test-'));
    try {
      const file = join(dir, 'main.swift');
      writeFileSync(file, fixture);
      const output = execFileSync('xcrun', ['swift', '-module-cache-path', join(dir, 'cache'), file], {
        encoding: 'utf8', timeout: 30000,
      });
      expect(output).toContain('PASS: scene window and cold/warm links');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
