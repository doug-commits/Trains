import CoreLocation
import WebKit

/// The page's `navigator.geolocation`, answered by Core Location.
///
/// WebKit's own geolocation is the obvious route and the wrong one here. It is
/// only offered to secure contexts, and whether a page served over our own
/// `overlandsea://` scheme counts as one is WebKit's decision, not ours; where
/// it does work it asks twice — the system's permission, then WebKit's own
/// per-site prompt on top. So the page gets a stand-in `navigator.geolocation`
/// at document start, with the same three methods app.js already calls, and
/// this answers it: one prompt, the system's, the first time the reader taps
/// the location button and never at launch.
///
/// The position goes to the page and nowhere else. GPS needs no signal, so the
/// button works with the phone in flight mode.
final class LocationBridge: NSObject, WKScriptMessageHandler, CLLocationManagerDelegate {

    static let name = "OverlandLocation"

    weak var web: WKWebView?
    private let manager = CLLocationManager()
    /// True while the page has at least one watch open.
    private var wanted = false

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
    }

    /// Installed before the page's own scripts run, so app.js sees this as the
    /// geolocation it always had. Watches share one stream of fixes; the last
    /// one cleared stops Core Location, so the GPS is not left running.
    static let shim = """
    (function () {
      var handler = window.webkit && window.webkit.messageHandlers.\(name)
      if (!handler) return
      var watches = {}, next = 1
      function send(m) { handler.postMessage(m) }
      function idle() { for (var k in watches) return false; return true }
      window.__overlandLocation = function (kind, a, b, c, t) {
        for (var id in watches) {
          var w = watches[id]
          if (kind === 'fix') {
            w.ok({ coords: { latitude: a, longitude: b, accuracy: c, altitude: null,
                             altitudeAccuracy: null, heading: null, speed: null },
                   timestamp: t })
            if (w.once) delete watches[id]
          } else {
            if (w.err) w.err({ code: a, message: b, PERMISSION_DENIED: 1,
                               POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
            if (w.once || a === 1) delete watches[id]
          }
        }
        if (idle()) send('stop')
      }
      var geo = {
        watchPosition: function (ok, err) {
          var id = next++; watches[id] = { ok: ok, err: err }; send('start'); return id
        },
        getCurrentPosition: function (ok, err) {
          var id = next++; watches[id] = { ok: ok, err: err, once: true }; send('start')
        },
        clearWatch: function (id) { delete watches[id]; if (idle()) send('stop') }
      }
      Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true })
    })();
    """

    func install(into controller: WKUserContentController) {
        controller.add(WeakHandler(self), name: Self.name)
        controller.addUserScript(WKUserScript(
            source: Self.shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    // MARK: the page

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        switch message.body as? String {
        case "start":
            wanted = true
            begin()
        case "stop":
            wanted = false
            manager.stopUpdatingLocation()
        default:
            break
        }
    }

    private func begin() {
        switch manager.authorizationStatus {
        case .notDetermined:
            // The answer arrives in locationManagerDidChangeAuthorization.
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            fail(code: 1, "Location is off for Overland SEA")
        default:
            manager.startUpdatingLocation()
        }
    }

    // MARK: Core Location

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard wanted else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            break
        case .denied, .restricted:
            fail(code: 1, "Location is off for Overland SEA")
        default:
            manager.startUpdatingLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard wanted, let fix = locations.last, fix.horizontalAccuracy >= 0 else { return }
        let ms = (fix.timestamp.timeIntervalSince1970 * 1000).rounded()
        call("window.__overlandLocation('fix', \(fix.coordinate.latitude), " +
             "\(fix.coordinate.longitude), \(fix.horizontalAccuracy), \(ms))")
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard wanted else { return }
        if (error as? CLError)?.code == .denied {
            fail(code: 1, "Location is off for Overland SEA")
        } else if (error as? CLError)?.code != .locationUnknown {
            // locationUnknown is Core Location saying "still looking", and it
            // keeps looking; anything else is passed on as unavailable.
            fail(code: 2, "Position unavailable")
        }
    }

    private func fail(code: Int, _ message: String) {
        if code == 1 {
            wanted = false
            manager.stopUpdatingLocation()
        }
        call("window.__overlandLocation('error', \(code), '\(message)')")
    }

    private func call(_ js: String) {
        web?.evaluateJavaScript(js, completionHandler: nil)
    }
}

/// `WKUserContentController` retains its handlers, and the bridge holds the
/// web view; registering it directly would be a cycle nothing ever breaks.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
