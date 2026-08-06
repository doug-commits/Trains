import UIKit
import WebKit

/// One screen, one web view, one bundled page.
///
/// The planner is already a self-contained document that makes no network
/// requests, so this is not a shell around a website — it is the same program,
/// running with the phone in flight mode. That is the entire reason for it to
/// exist: the moment you most need to know whether the Padang Besar connection
/// holds is the moment you have no signal.
final class PlannerViewController: UIViewController {

    private var web: WKWebView!
    private let assets = BundleAssets()
    private let bridge = ShellBridge()

    override func viewDidLoad() {
        super.viewDidLoad()

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(assets, forURLScheme: BundleAssets.scheme)
        installShellBridge(into: config.userContentController)
        config.websiteDataStore = .default()          // persistent localStorage
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all
        // The map does its own zooming, and a pinch that scales the document
        // instead fights it and leaves the layout at 1.4× with no way back.
        config.preferences.isTextInteractionEnabled = true

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.translatesAutoresizingMaskIntoConstraints = false
        web.scrollView.bounces = false                 // the sheet does the scrolling
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = true // the route lives in the hash
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear

        view.backgroundColor = UIColor(red: 6/255, green: 18/255, blue: 23/255, alpha: 1)
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        blockRemoteLoads { [weak self] in
            self?.web.load(URLRequest(url: BundleAssets.home))
        }
    }

    /// The nearest thing iOS has to Android's missing internet permission.
    ///
    /// On Android the guarantee is the operating system's: the app does not
    /// declare `INTERNET`, so it cannot open a socket at all. iOS has no such
    /// declaration — an app either has the network or the platform assumes it
    /// might. So the guarantee here is one level down and narrower, and it is
    /// worth being exact about which: a content rule list that refuses every
    /// load the web view attempts except from our own scheme. A tracking pixel
    /// or a font that crept into the page could not fetch, and neither could
    /// anything injected into it.
    ///
    /// It is not the same promise. It covers the web view, which is the whole
    /// app, but it is enforced by WebKit rather than by the kernel. The privacy
    /// policy says so in those words rather than borrowing Android's stronger
    /// claim.
    private func blockRemoteLoads(then load: @escaping () -> Void) {
        let rules = """
        [
          { "trigger": { "url-filter": ".*" },
            "action": { "type": "block" } },
          { "trigger": { "url-filter": "^\(BundleAssets.scheme)://" },
            "action": { "type": "ignore-previous-rules" } }
        ]
        """
        WKContentRuleListStore.default()?.compileContentRuleList(
            forIdentifier: "offline-only", encodedContentRuleList: rules
        ) { [weak self] list, error in
            if let list { self?.web.configuration.userContentController.add(list) }
            // A failure here means the belt is missing and the braces are not:
            // the page still requests nothing. Loading anyway beats a blank
            // screen over a rule the page does not need.
            if error != nil { NSLog("offline rule list did not compile: \(error!)") }
            load()
        }
    }

    /// Dark map, light map — the status bar has to be legible over whichever
    /// the reader chose, and the page tells us which by its background.
    override var preferredStatusBarStyle: UIStatusBarStyle { statusBar }
    private var statusBar: UIStatusBarStyle = .lightContent {
        didSet { setNeedsStatusBarAppearanceUpdate() }
    }

    /// Asked once, on load. After that the page volunteers it — see below.
    private func matchStatusBarToPage() {
        web.evaluateJavaScript(
            "getComputedStyle(document.documentElement).getPropertyValue('--sea')"
        ) { [weak self] value, _ in
            self?.matchStatusBar(to: value as? String)
        }
    }

    fileprivate func matchStatusBar(to reported: String?) {
        guard let hex = reported?.trimmingCharacters(in: .whitespaces),
              hex.hasPrefix("#"), hex.count >= 7,
              let n = Int(hex.dropFirst().prefix(6), radix: 16) else { return }
        let r = Double((n >> 16) & 0xff), g = Double((n >> 8) & 0xff), b = Double(n & 0xff)
        let luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        statusBar = luminance > 0.5 ? .darkContent : .lightContent
        // The strip behind the bar and around the safe area is the view's, not
        // the page's, and the page cannot paint it. Left at the dark default it
        // shows as a black band above a light map.
        view.backgroundColor = UIColor(red: CGFloat(r) / 255,
                                       green: CGFloat(g) / 255,
                                       blue: CGFloat(b) / 255, alpha: 1)
    }

    /// The page calls `OverlandShell.postMessage(colour)` whenever the theme
    /// changes. On Android that name is a `WebMessageListener`; here it is a
    /// script message handler with a three-line shim in front of it, so the page
    /// has one shell API and neither platform gets a special case.
    ///
    /// Without this the status bar was decided once, at `didFinish`, and pressing
    /// the theme toggle left dark text on a dark bar until the app was relaunched
    /// — which the Info.plist already claimed was handled, and was not.
    private func installShellBridge(into controller: WKUserContentController) {
        bridge.owner = self
        controller.add(bridge, name: "OverlandShell")
        controller.addUserScript(WKUserScript(
            source: """
            window.OverlandShell = {
              postMessage: function (m) {
                window.webkit.messageHandlers.OverlandShell.postMessage(String(m))
              }
            }
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
    }
}

/// Separate, and weak on the way back, because `WKUserContentController` retains
/// its handlers: registering the view controller directly makes a cycle through
/// the configuration that nothing ever breaks.
private final class ShellBridge: NSObject, WKScriptMessageHandler {
    weak var owner: PlannerViewController?

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        owner?.matchStatusBar(to: message.body as? String)
    }
}

extension PlannerViewController: WKNavigationDelegate {

    /// Anything not in the bundle is somebody else's site — Google Maps, an
    /// operator's booking page, a hotel search. Those open in Safari, where the
    /// address bar tells the reader whose site they are on. Loading them in
    /// here would be a worse experience and a way of appearing to vouch for a
    /// checkout page we do not control.
    func webView(_ webView: WKWebView,
                 decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }

        if url.scheme == BundleAssets.scheme {
            return decisionHandler(.allow)
        }
        if url.scheme == "http" || url.scheme == "https" || url.scheme == "mailto" {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        matchStatusBarToPage()
    }

    func webView(_ webView: WKWebView,
                 didFail navigation: WKNavigation!, withError error: Error) {
        showFailure(error)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showFailure(error)
    }

    /// If the bundled page fails to load, the default is a white screen and no
    /// way to tell whether the staging step was skipped, the scheme handler is
    /// misconfigured, or WebKit refused it. Say so instead.
    ///
    /// This is the failure mode that matters most here, because the app has no
    /// network to fall back on and no server-side log to inspect — whatever
    /// went wrong went wrong on someone's phone, somewhere with no signal.
    private func showFailure(_ error: Error) {
        let message = (error as NSError).localizedDescription
        let html = """
        <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:2rem;
        background:#0a191f;color:#e7efea}code{color:#e9a63e;word-break:break-all}</style>
        </head><body>
        <h1>The planner did not load</h1>
        <p>The page is bundled inside this app, so this is not a connection
        problem — there is nothing to connect to.</p>
        <p><code>\(message)</code></p>
        <p>Please report this with your iOS version.</p>
        </body></html>
        """
        web.loadHTMLString(html, baseURL: nil)
    }
}

extension PlannerViewController: WKUIDelegate {

    /// Every outbound link in the itinerary carries `target="_blank"`, and a
    /// web view with no UI delegate silently does nothing with those — the tap
    /// registers, the highlight flashes, and no booking page opens. Which is
    /// worse than an error, because it looks like the app working.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url,
           url.scheme == "http" || url.scheme == "https" {
            UIApplication.shared.open(url)
        }
        return nil
    }
}
