import java.util.Properties

plugins {
  id("com.android.application")
}

/* Written by tools/build-android.mjs. Derived from the date rather than
 * remembered, because Play rejects a repeated version code and a number you
 * have to remember to increment is a number you will forget. */
val version = Properties().apply {
  val f = rootProject.file("version.properties")
  if (f.exists()) f.inputStream().use { load(it) }
}

android {
  namespace = "com.slowasia.overland"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.slowasia.overland"
    /* Android 8. Set by the adaptive launcher icon, which has no pre-26
     * equivalent, and no loss: a device older than this ships a WebView that
     * cannot render the canvas map or the CSS this page is built on, so it
     * would install and then look broken. */
    minSdk = 26
    targetSdk = 35
    versionCode = version.getProperty("versionCode", "1").toInt()
    versionName = version.getProperty("versionName", "1.0.0")
  }

  /* The assets are already compressed images and one large HTML file. Letting
   * the packager re-compress the HTML is worth it; the JPEGs are not. */
  androidResources {
    noCompress += listOf("jpg", "jpeg", "png", "webp")
  }

  signingConfigs {
    create("release") {
      /* Supplied by CI from repository secrets, or by a local keystore.
       * Absent both, the release build is unsigned and Gradle says so — which
       * is the correct failure, rather than silently shipping a debug key. */
      val store = System.getenv("ANDROID_KEYSTORE_PATH")
      if (store != null && file(store).exists()) {
        storeFile = file(store)
        storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("ANDROID_KEY_ALIAS")
        keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false   // One activity and no library code to shrink.
      isShrinkResources = false
      if (System.getenv("ANDROID_KEYSTORE_PATH") != null) {
        signingConfig = signingConfigs.getByName("release")
      }
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  /* Aligns every kotlin-stdlib* artifact on one version.
   *
   * Without it the build fails on duplicate classes: appcompat brings
   * kotlin-stdlib 1.8.22 while something transitive still asks for
   * kotlin-stdlib-jdk7/jdk8 1.6.21, and since Kotlin 1.8 the jdk7 and jdk8
   * artifacts were folded into the main stdlib — so every one of their classes
   * exists twice. Pinned to a version where those two are empty shims, which
   * is what makes the collision disappear rather than merely be suppressed.
   *
   * No Kotlin is written here. This is transitive weight from AndroidX. */
  implementation(platform("org.jetbrains.kotlin:kotlin-bom:1.9.24"))

  /* WebViewAssetLoader. Serving the bundled page from an https origin rather
   * than file:// is not cosmetic: modern WebView refuses localStorage on file
   * origins, and the theme choice and the folded panel are both stored there.
   * On file:// the app would silently forget both on every launch. */
  implementation("androidx.webkit:webkit:1.12.1")
  implementation("androidx.appcompat:appcompat:1.7.0")
}
