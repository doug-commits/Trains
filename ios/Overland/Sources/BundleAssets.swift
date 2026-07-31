import Foundation
import WebKit

/// Serves the bundled page to the web view over a scheme of our own.
///
/// The obvious thing is `loadFileURL(_:allowingReadAccessTo:)`, and it is a
/// trap: WKWebView gives every `file://` document an opaque security origin,
/// and an opaque origin has no `localStorage`. The theme choice and the folded
/// search panel both live there, so the app would forget both on every launch
/// and there would be no error anywhere to explain why. This is the same
/// reason the Android build serves its assets over https from
/// `appassets.androidplatform.net` rather than from `file://`.
///
/// A custom scheme gets a real origin — `overlandsea://app` — which persists
/// storage exactly as a website would. Nothing leaves the device: the handler
/// only ever reads out of the app bundle, and returns nothing for a path that
/// is not in it.
final class BundleAssets: NSObject, WKURLSchemeHandler {

    /// Not `app` or `assets`: a short common word is one an unrelated app or a
    /// future WebKit release could plausibly claim, and a collision here is a
    /// blank screen.
    static let scheme = "overlandsea"
    static let host = "app"
    static let home = URL(string: "\(scheme)://\(host)/index.html")!

    /// The staged page, as a directory inside the bundle. `www` is a folder
    /// reference rather than a group precisely so this path exists.
    private let root: URL? = Bundle.main.url(forResource: "www", withExtension: nil)

    private static let types = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "webp": "image/webp",
        "woff2": "font/woff2",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root else {
            task.didFailWithError(Failure.notBundled)
            return
        }

        // Resolve inside the bundle and prove it stayed there. The page is
        // ours and asks for two files, but a handler that will read any path
        // it is handed is a handler that will read any path it is handed.
        let relative = url.path.hasPrefix("/") ? String(url.path.dropFirst()) : url.path
        let file = root.appendingPathComponent(relative).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(Failure.noSuchAsset(relative))
            return
        }

        let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": type,
                "Content-Length": String(data.count),
                // Everything here shipped inside the binary and changes only
                // when the app is replaced, so there is nothing to revalidate.
                "Cache-Control": "no-cache",
            ]
        )!

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        // Reads are synchronous and already finished by the time this could
        // arrive. Nothing to cancel.
    }

    enum Failure: LocalizedError {
        case notBundled
        case noSuchAsset(String)

        var errorDescription: String? {
            switch self {
            case .notBundled:
                return "The planner was not staged into this build. "
                     + "Run tools/build-ios.mjs before archiving."
            case .noSuchAsset(let path):
                return "The bundle has no \(path)."
            }
        }
    }
}
