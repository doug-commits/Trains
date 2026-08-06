plugins {
  // 8.7 cannot compile against API 36 at all. This is the floor that can.
  id("com.android.application") version "8.11.1" apply false
}
