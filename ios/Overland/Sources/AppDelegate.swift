import UIKit

/// No scene manifest, no storyboard, no state restoration. The app is one
/// screen and putting it on the window is the whole of the lifecycle.
@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = PlannerViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
