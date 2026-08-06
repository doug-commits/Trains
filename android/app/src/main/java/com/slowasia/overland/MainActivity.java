package com.slowasia.overland;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.WebViewAssetLoader;

import java.util.Collections;

/**
 * One activity, one WebView, one bundled page.
 *
 * The planner is already a self-contained document that makes no network
 * requests, so the app is not a shell around a website — it is the same
 * program, running with the phone in flight mode. That is the entire reason
 * for it to exist: the moment you most need to know whether the Padang Besar
 * connection holds is the moment you have no signal.
 */
public class MainActivity extends AppCompatActivity {

  /**
   * Assets are served over https rather than file://. Not cosmetic: modern
   * WebView refuses localStorage on a file origin, and the theme choice and
   * the folded search panel both live there. On file:// the app would forget
   * both on every launch and there would be no error to explain why.
   */
  private static final String DOMAIN = "appassets.androidplatform.net";
  private static final String HOME = "https://" + DOMAIN + "/assets/index.html";

  private WebView web;

  /* The WebView sits inside this, and this carries the window insets as
     padding. Painting the strips behind the status and gesture bars is the
     root's job rather than the WebView's, because the WebView has to end
     where the page ends. */
  private FrameLayout root;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);

    final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
        .setDomain(DOMAIN)
        .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
        .build();

    web = new WebView(this);
    web.setLayoutParams(new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);      // the theme and the fold live here
    s.setAllowFileAccess(false);       // nothing outside the bundle, ever
    s.setAllowContentAccess(false);
    s.setSupportZoom(false);           // the map does its own zooming
    s.setBuiltInZoomControls(false);
    s.setMediaPlaybackRequiresUserGesture(true);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        return loader.shouldInterceptRequest(request.getUrl());
      }

      /**
       * If the bundled page ever fails to load, the default is a white screen
       * and no way to tell whether the asset is missing, the loader is
       * misconfigured, or the WebView is too old. Say so instead.
       *
       * This is the failure mode that matters most here, because the app has no
       * network to fall back on and no server-side log to inspect — whatever
       * went wrong went wrong on someone's phone in a place with no signal.
       */
      /* The page reports its own colour on every theme change, but the first
         one happens before the listener above can be talked to. */
      @Override
      public void onPageFinished(WebView view, String url) {
        view.evaluateJavascript(
            "getComputedStyle(document.documentElement).getPropertyValue('--sea')",
            value -> paintBars(value));
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request,
                                  WebResourceError error) {
        if (!request.isForMainFrame()) return;
        view.loadDataWithBaseURL(null,
            "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<style>body{font:16px/1.5 system-ui,sans-serif;margin:2rem;"
            + "background:#0a191f;color:#e7efea}code{color:#e9a63e;"
            + "word-break:break-all}</style></head><body>"
            + "<h1>The planner did not load</h1>"
            + "<p>The page is bundled inside this app, so this is not a "
            + "connection problem — there is nothing to connect to.</p>"
            + "<p><code>" + error.getDescription() + "</code><br>"
            + "<code>" + request.getUrl() + "</code></p>"
            + "<p>Please report this with your Android version.</p>"
            + "</body></html>",
            "text/html", "utf-8", null);
      }

      /**
       * Anything not in the bundle is somebody else's site — Google Maps, an
       * operator's booking page, a hotel search. Those open in the browser,
       * where the address bar tells the reader whose site they are on. Loading
       * them inside our WebView would be both a worse experience and a way of
       * appearing to vouch for a checkout page we do not control.
       */
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (DOMAIN.equals(url.getHost())) return false;
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, url)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
          Toast.makeText(MainActivity.this, R.string.no_browser, Toast.LENGTH_SHORT).show();
        }
        return true;
      }
    });

    root = new FrameLayout(this);
    root.addView(web);
    setContentView(root);

    /* Android 16 makes edge-to-edge mandatory and removed the opt-out, so the
     * window now extends under the status bar and the gesture bar whether or
     * not it wants to. Declared here rather than left to the platform so that
     * every version behaves the same way: without it, an Android 14 phone
     * insets the window and an Android 16 phone does not, and the layout has
     * to be right in both.
     *
     * The insets become padding on the root, which is what keeps the top bar
     * out from under the clock and the sheet's handle off the gesture bar.
     * Doing it here rather than in CSS because Android's WebView reports only
     * display cutouts through env(safe-area-inset-*) — the system bars are not
     * in that number, so the stylesheet cannot see them. */
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
      Insets bars = windowInsets.getInsets(
          WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
      // The keyboard, when it is up, replaces the gesture bar rather than
      // stacking with it — so the larger of the two, not the sum.
      v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
      return WindowInsetsCompat.CONSUMED;
    });

    /* And a channel for the page to say what colour it is now.
     *
     * Origin-scoped to the asset host, so only the bundled document can reach
     * it — which is the difference between this and addJavascriptInterface,
     * and the reason it is acceptable in an app that otherwise exposes nothing
     * to its own web view. */
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      WebViewCompat.addWebMessageListener(
          web, "OverlandShell", Collections.singleton("https://" + DOMAIN),
          (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
            if (isMainFrame) paintBars(message.getData());
          });
    }

    /* The planner keeps its route in the URL hash, so WebView history is a
     * real trail through the app: back walks out of an itinerary to where you
     * started before it leaves. Only then does it close. */
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        if (web.canGoBack()) {
          web.goBack();
        } else {
          setEnabled(false);
          getOnBackPressedDispatcher().onBackPressed();
        }
      }
    });

    if (state != null) {
      web.restoreState(state);
    } else {
      web.loadUrl(HOME);
    }
  }

  /* Fill the strips behind the system bars with whatever the page's sea is,
   * and flip the clock and the gesture bar to whichever of black or white can
   * be read against it.
   *
   * Without this the bars keep the colour the XML theme gave them, which
   * follows the system's dark mode rather than the reader's choice in the app
   * — and since the app opens light even on a dark phone, that mismatch was
   * visible on the very first frame. */
  private void paintBars(String reported) {
    if (reported == null) return;
    String hex = reported.replace("\"", "").trim();
    if (!hex.startsWith("#") || hex.length() < 7) return;
    int colour;
    try {
      colour = Color.parseColor(hex.substring(0, 7));
    } catch (IllegalArgumentException e) {
      return;   // not a colour we can use; leave the theme's own
    }
    root.setBackgroundColor(colour);
    double luminance = (0.299 * Color.red(colour)
                      + 0.587 * Color.green(colour)
                      + 0.114 * Color.blue(colour)) / 255.0;
    WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), web);
    bars.setAppearanceLightStatusBars(luminance > 0.5);
    bars.setAppearanceLightNavigationBars(luminance > 0.5);
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }
}
