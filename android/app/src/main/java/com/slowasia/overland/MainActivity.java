package com.slowasia.overland;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

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

    setContentView(web);

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

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }
}
